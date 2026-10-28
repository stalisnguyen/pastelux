/**
 * Pastelux AI proxy — a Cloudflare Worker that holds Stalis's Anthropic API
 * key so the static site never has to.
 *
 * Only one thing passes: POST /v1/messages carrying the right access code in
 * the `x-pastelux-code` header, from an allowed origin. The request is pinned
 * to one model and an output cap before it is forwarded, so a leaked access
 * code cannot be used to run arbitrary or oversized jobs on the key.
 *
 * Secrets (set with `wrangler secret put`, never committed):
 *   ANTHROPIC_API_KEY — the key to spend
 *   ACCESS_CODE       — the code Pastel types once on each of her devices
 */

const MODEL = 'claude-opus-5-5';
const MAX_TOKENS = 16000;
const ALLOWED_BETAS = new Set(['server-side-fallback-2026-07-01']);
const MAX_BODY_BYTES = 8 * 1024 * 1024; // room for a few images

const allowedOrigin = (origin, env) => {
  const list = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(origin) ? origin : null;
};

const cors = (origin, req) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // the SDK adds its own x-stainless-* headers; reflect what the browser asks for
  'Access-Control-Allow-Headers': req.headers.get('Access-Control-Request-Headers') || '*',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
});

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** Constant-time comparison so the code cannot be guessed byte by byte. */
function sameSecret(a, b) {
  const ea = new TextEncoder().encode(String(a || ''));
  const eb = new TextEncoder().encode(String(b || ''));
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0 && ea.length > 0;
}

export default {
  async fetch(req, env) {
    const origin = allowedOrigin(req.headers.get('Origin') || '', env);
    if (!origin) return json(403, { type: 'error', error: { type: 'forbidden', message: 'Origin not allowed' } });
    const h = cors(origin, req);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });

    const url = new URL(req.url);
    if (req.method !== 'POST' || url.pathname !== '/v1/messages')
      return json(404, { type: 'error', error: { type: 'not_found_error', message: 'Not found' } }, h);

    if (!env.ANTHROPIC_API_KEY || !env.ACCESS_CODE)
      return json(500, { type: 'error', error: { type: 'api_error', message: 'Proxy is not configured' } }, h);

    if (!sameSecret(req.headers.get('x-pastelux-code'), env.ACCESS_CODE))
      return json(401, { type: 'error', error: { type: 'authentication_error', message: 'Wrong access code' } }, h);

    const len = Number(req.headers.get('content-length') || 0);
    if (len > MAX_BODY_BYTES)
      return json(413, { type: 'error', error: { type: 'request_too_large', message: 'Request too large' } }, h);

    let body;
    try {
      body = await req.json();
    } catch {
      return json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Invalid JSON' } }, h);
    }

    // pin what the key can be spent on
    body.model = MODEL;
    body.max_tokens = Math.min(Number(body.max_tokens) || MAX_TOKENS, MAX_TOKENS);
    delete body.tools;
    delete body.mcp_servers;
    delete body.container;

    const betas = String(req.headers.get('anthropic-beta') || '')
      .split(',')
      .map((s) => s.trim())
      .filter((b) => ALLOWED_BETAS.has(b));

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': req.headers.get('anthropic-version') || '2023-06-01',
        ...(betas.length ? { 'anthropic-beta': betas.join(',') } : {}),
      },
      body: JSON.stringify(body),
    });

    // stream straight through (SSE for streaming requests)
    const out = new Headers(h);
    out.set('content-type', upstream.headers.get('content-type') || 'application/json');
    const rid = upstream.headers.get('request-id');
    if (rid) out.set('request-id', rid);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
