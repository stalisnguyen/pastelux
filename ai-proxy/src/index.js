/**
 * Pastelux AI proxy (Stas) — a Cloudflare Worker that holds the AI key so the
 * static site never has to.
 *
 * One endpoint: POST /chat with the access code in `x-pastelux-code`, from an
 * allowed origin. Body: { system, messages: [{ role: 'user'|'assistant',
 * text, image?: { mime, data(base64) } }] }. The reply streams back as
 * server-sent events: `data: {"t":"text chunk"}` … then `data: [DONE]`.
 *
 * The provider follows whichever key is set:
 *   GEMINI_API_KEY → Google Gemini (default model GEMINI_MODEL)
 *   GROQ_API_KEY   → Groq (default model GROQ_MODEL)
 * Secrets (never committed): the key above and ACCESS_CODE.
 */

const MAX_OUTPUT = 4096;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_TURNS = 30;

const allowedOrigin = (origin, env) =>
  String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .includes(origin)
    ? origin
    : null;

const cors = (origin, req) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': req.headers.get('Access-Control-Request-Headers') || 'content-type, x-pastelux-code',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
});

const json = (status, message, headers = {}) =>
  new Response(JSON.stringify({ error: { message, status } }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** Constant-time comparison so the code cannot be guessed byte by byte. */
function sameSecret(a, b) {
  const ea = new TextEncoder().encode(String(a || ''));
  const eb = new TextEncoder().encode(String(b || ''));
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0 && ea.length > 0;
}

// ------------------------------------------------------------ providers
// Flash-Lite answers in a second or two on the free plan; the bigger
// Flash is often overloaded there (503 or no answer at all). On "not
// found", "overloaded" or "too slow", try the next model.
const GEMINI_FALLBACKS = ['gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
const RETRY_ON = new Set([404, 500, 503, 504]);

async function geminiRequest(env, system, messages) {
  const models = [...new Set([env.GEMINI_MODEL, ...GEMINI_FALLBACKS].filter(Boolean))];
  let res;
  for (const model of models) {
    const t0 = Date.now();
    res = await geminiCall(env, model, system, messages);
    console.log('gemini headers', model, res.status, `${Date.now() - t0}ms`);
    if (!RETRY_ON.has(res.status)) return res;
    console.log('gemini model unavailable, trying next', model, res.status);
  }
  return res;
}

// Google must start answering within this time, or the request fails
// with a clear message instead of "thinking" forever.
const FIRST_BYTE_MS = 25000;

async function geminiCall(env, model, system, messages) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FIRST_BYTE_MS);
  try {
    return await geminiFetch(env, model, system, messages, ctl.signal);
  } catch (e) {
    console.log('gemini fetch failed', model, String(e));
    return new Response(JSON.stringify({ error: { message: ctl.signal.aborted ? 'Google did not answer in time' : String(e) } }), { status: 504 });
  } finally {
    clearTimeout(timer);
  }
}

function geminiFetch(env, model, system, messages, signal) {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
    signal,
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [
          ...(m.image ? [{ inline_data: { mime_type: m.image.mime, data: m.image.data } }] : []),
          { text: m.text || ' ' },
        ],
      })),
      generationConfig: { maxOutputTokens: MAX_OUTPUT },
    }),
  });
}
const geminiText = (evt) => (evt.candidates?.[0]?.content?.parts ?? []).map((p) => p.text || '').join('');

function groqRequest(env, system, messages) {
  return fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: env.GROQ_MODEL || 'qwen/qwen3.8-27b',
      stream: true,
      // the model may reason; only the final answer is wanted
      reasoning_format: 'hidden',
      max_tokens: MAX_OUTPUT,
      messages: [
        { role: 'system', content: system },
        ...messages.map((m) =>
          m.image && m.role === 'user'
            ? {
                role: 'user',
                content: [
                  { type: 'text', text: m.text || ' ' },
                  { type: 'image_url', image_url: { url: `data:${m.image.mime};base64,${m.image.data}` } },
                ],
              }
            : { role: m.role, content: m.text || ' ' }
        ),
      ],
    }),
  });
}
const groqText = (evt) => evt.choices?.[0]?.delta?.content || '';

/** Re-emit a provider's SSE stream as our minimal `{"t": …}` events,
 *  dropping any <think>…</think> span a reasoning model leaks into content. */
function relay(upstream, pick) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let buf = '';
  let thinking = false;
  let chars = 0;
  let finish = '';
  const scrub = (t) => {
    let out = '';
    while (t) {
      if (thinking) {
        const e = t.indexOf('</think>');
        if (e < 0) return out;
        thinking = false;
        t = t.slice(e + 8);
      } else {
        const b = t.indexOf('<think>');
        if (b < 0) return out + t;
        out += t.slice(0, b);
        thinking = true;
        t = t.slice(b + 7);
      }
    }
    return out;
  };
  return upstream.body.pipeThrough(
    new TransformStream({
      transform(chunk, ctl) {
        buf += dec.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const evt = JSON.parse(payload);
            if (evt.error) {
              console.log('stream error', JSON.stringify(evt.error).slice(0, 300));
              ctl.enqueue(enc.encode(`data: ${JSON.stringify({ e: String(evt.error.message || 'error') })}\n\n`));
              continue;
            }
            const fin = evt.candidates?.[0]?.finishReason || evt.promptFeedback?.blockReason || evt.choices?.[0]?.finish_reason;
            if (fin) finish = fin;
            const t = scrub(pick(evt));
            if (t) {
              chars += t.length;
              ctl.enqueue(enc.encode(`data: ${JSON.stringify({ t })}\n\n`));
            }
          } catch {}
        }
      },
      flush(ctl) {
        console.log('stream done', `${chars} chars`, finish || '-');
        if (!chars) ctl.enqueue(enc.encode(`data: ${JSON.stringify({ e: `No answer came back (${finish || 'empty'})` })}\n\n`));
        ctl.enqueue(enc.encode('data: [DONE]\n\n'));
      },
    })
  );
}

export default {
  async fetch(req, env) {
    const origin = allowedOrigin(req.headers.get('Origin') || '', env);
    if (!origin) return json(403, 'Origin not allowed');
    const h = cors(origin, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });

    const url = new URL(req.url);
    if (req.method !== 'POST' || url.pathname !== '/chat') return json(404, 'Not found', h);

    const provider = env.GEMINI_API_KEY ? 'gemini' : env.GROQ_API_KEY ? 'groq' : null;
    if (!provider || !env.ACCESS_CODE) return json(503, 'Stas is not configured yet', h);
    if (!sameSecret(req.headers.get('x-pastelux-code'), env.ACCESS_CODE)) return json(401, 'Wrong access code', h);
    if (Number(req.headers.get('content-length') || 0) > MAX_BODY_BYTES) return json(413, 'Request too large', h);

    let body;
    try {
      body = await req.json();
    } catch {
      return json(400, 'Invalid JSON', h);
    }
    const system = String(body.system || '').slice(0, 8000);
    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .slice(-MAX_TURNS)
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        text: String(m.text || '').slice(0, 20000),
        image: m.image && typeof m.image.data === 'string' ? { mime: String(m.image.mime || 'image/jpeg'), data: m.image.data } : undefined,
      }));
    if (!messages.length || messages[messages.length - 1].role !== 'user') return json(400, 'Last message must be from the user', h);

    const upstream = provider === 'gemini' ? await geminiRequest(env, system, messages) : await groqRequest(env, system, messages);
    if (!upstream.ok) {
      const detail = (await upstream.text()).slice(0, 400);
      console.log('upstream error', provider, upstream.status, detail);
      return json(upstream.status === 429 ? 429 : 502, `${provider} ${upstream.status}: ${detail}`, h);
    }
    return new Response(relay(upstream, provider === 'gemini' ? geminiText : groqText), {
      headers: { ...h, 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-stas-provider': provider },
    });
  },
};
