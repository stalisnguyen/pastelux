import Anthropic from '@anthropic-ai/sdk';

/*
 * "Ask AI" — a private lighting-design consult for Pastel. Requests go to the
 * Pastelux AI proxy (ai-proxy/, a Cloudflare Worker), which holds Stalis's API
 * key and only answers requests carrying the access code. The site holds no
 * key; the access code and the conversation live in this browser only.
 */

import { AI_PROXY_URL } from '../site';

export const CODE_STORE = 'pastelux-ai-code';
export const CHAT_STORE = 'pastelux-ask-chat';
export const ATTACH_STORE = 'pastelux-ask-attach'; // image handed over from the board
export const MODEL = 'claude-opus-5-5';

export const SYSTEM_PROMPT = `Your name is Stas. You are a senior architectural lighting designer acting as a consultant to a practising lighting and interior architect based in Vietnam. She uses you for quick second opinions while she works.

How to answer:
- Reply in the language she writes in. In Vietnamese, write naturally, the way a Vietnamese lighting designer talks to a colleague — not a translation — and keep industry terms in English as they appear on drawings and datasheets (lux, UGR, CRI/Ra, R9, CCT, beam angle, DALI, driver, wall washer, downlight…).
- Be practical and specific: quantities, target values, fixture families, beam angles, mounting positions, control ideas. Say what you would check on site or in a calculation.
- When you cite standards (EN 12464-1, TCVN 7114, IES, WELL, CIE S 026), give values only when you are confident and say they must be verified against the edition the project uses. Never invent product codes, manufacturer data or prices.
- When she sends a sketch, render, plan or photo: read what is actually there first, then comment on layering, focal points, glare, uniformity, contrast, colour temperature, colour rendering and controls. Point out what is unclear rather than guessing.
- Keep answers tight. Use short paragraphs and bullet lists; headings only for longer answers.`;

export type Turn = { role: 'user' | 'assistant'; content: Anthropic.Beta.BetaContentBlockParam[] | string };

/** Ask AI is on for this browser when the proxy exists and a code is stored. */
export function readCode(): string {
  try {
    return localStorage.getItem(CODE_STORE) || '';
  } catch {
    return '';
  }
}
export const aiAvailable = () => Boolean(AI_PROXY_URL && readCode());

export function makeClient(code: string) {
  // The real key lives in the proxy; 'proxied' only satisfies the SDK.
  return new Anthropic({
    apiKey: 'proxied',
    baseURL: AI_PROXY_URL,
    defaultHeaders: { 'x-pastelux-code': code },
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
  });
}

/** Streams one assistant reply. Calls onText with the text so far. */
export async function askStream(
  client: Anthropic,
  turns: Turn[],
  onText: (textSoFar: string) => void,
  signal?: AbortSignal
): Promise<{ text: string; refused: boolean }> {
  const stream = client.beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: turns as Anthropic.Beta.BetaMessageParam[],
    },
    { signal }
  );

  let text = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text;
      onText(text);
    }
  }
  const final = await stream.finalMessage();
  return { text, refused: final.stop_reason === 'refusal' };
}

export function describeError(err: unknown, vi: boolean): string {
  const t = (en: string, v: string) => (vi ? v : en);
  if (err instanceof Anthropic.AuthenticationError)
    return t('That access code is not right. Enter it again.', 'Mã truy cập chưa đúng. Nhập lại nhé.');
  if (err instanceof Anthropic.PermissionDeniedError)
    return t('This site is not allowed to use the AI service.', 'Trang này chưa được phép dùng dịch vụ AI.');
  if (err instanceof Anthropic.RateLimitError)
    return t('Too many requests right now — wait a moment and try again.', 'Đang gửi quá nhiều yêu cầu — đợi một chút rồi thử lại.');
  if (err instanceof Anthropic.BadRequestError) {
    const msg = String((err as Error).message || '');
    if (/credit balance/i.test(msg))
      return t('The AI account is out of credit — tell Stalis.', 'Tài khoản AI đã hết credit — báo Stalis nhé.');
    return t(`The request was rejected: ${msg.slice(0, 160)}`, `Yêu cầu bị từ chối: ${msg.slice(0, 160)}`);
  }
  if (err instanceof Anthropic.APIConnectionError)
    return t('Could not reach the AI service. Check the connection and try again.', 'Không kết nối được tới dịch vụ AI. Kiểm tra mạng rồi thử lại.');
  if (err instanceof Anthropic.APIError)
    return t(`AI service error (${err.status}). Try again.`, `Lỗi từ dịch vụ AI (${err.status}). Thử lại nhé.`);
  if ((err as Error)?.name === 'AbortError' || err instanceof Anthropic.APIUserAbortError)
    return t('Stopped.', 'Đã dừng.');
  return t(`Something went wrong: ${String((err as Error)?.message ?? err).slice(0, 160)}`, `Có lỗi: ${String((err as Error)?.message ?? err).slice(0, 160)}`);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Small, safe Markdown renderer for answers: escapes first, then formats. */
export function renderMarkdown(src: string): string {
  const blocks: string[] = [];
  const codes: string[] = [];
  let s = src.replace(/```[\w-]*\n?([\s\S]*?)(```|$)/g, (_m, code) => {
    codes.push(`<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  const inline = (t: string) =>
    esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  const lines = s.split('\n');
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const code = line.match(/^\u0000(\d+)\u0000$/);
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (code) {
      flushPara();
      flushList();
      blocks.push(codes[Number(code[1])]);
    } else if (h) {
      flushPara();
      flushList();
      blocks.push(`<h4>${inline(h[2])}</h4>`);
    } else if (ul || ol) {
      flushPara();
      const tag = ul ? 'ul' : 'ol';
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push((ul ?? ol)![1]);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks.join('');
}
