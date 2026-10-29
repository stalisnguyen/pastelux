/*
 * Stas — a private lighting-design consult for Pastel. Requests go to the
 * Pastelux AI proxy (ai-proxy/, a Cloudflare Worker) which holds the AI key
 * (Gemini or Groq) and only answers requests carrying the access code. The
 * site holds no key; the code and the conversation live in this browser.
 */

import { AI_PROXY_URL } from '../site';

export const CODE_STORE = 'pastelux-ai-code';
export const CHAT_STORE = 'pastelux-ask-chat';
export const ATTACH_STORE = 'pastelux-ask-attach'; // image handed over from the board

export const SYSTEM_PROMPT = `Your name is Stas. You are a warm, sharp, all-round assistant for a lighting and interior architect based in Vietnam. She can ask you anything: work, study, writing, English, travel, cooking, everyday questions, ideas. Architectural lighting is your specialty, so when a question touches design you answer like a senior lighting designer would.

How to answer:
- Reply in the language she writes in. In Vietnamese, write naturally (not like a translation) and call yourself "mình" and her "cậu", like a close friend. Keep lighting industry terms in English as they appear on drawings and datasheets (lux, UGR, CRI/Ra, R9, CCT, beam angle, DALI, driver, wall washer, downlight…).
- Be practical and specific. For lighting: quantities, target values, fixture families, beam angles, mounting positions, control ideas, and what you would check in a calculation or a mock-up.
- When you cite standards (EN 12464-1, TCVN 7114, IES, WELL, CIE S 026), give values only when you are confident and say they must be checked against the edition the project uses. Never invent product codes, manufacturer data, prices or facts; say when you are not sure.
- When she sends an image (sketch, render, plan, photo or anything else): read what is actually there first, then answer what she asked. For lighting work, comment on layering, focal points, glare, uniformity, contrast, colour temperature, colour rendering and controls. Point out what is unclear rather than guessing.
- Keep answers tight. Use short paragraphs and bullet lists; headings only for longer answers.`;

export type Turn = { role: 'user' | 'assistant'; text: string; image?: { mime: string; data: string } };

/** Stas is on for this browser when the proxy exists and a code is stored. */
export function readCode(): string {
  try {
    return localStorage.getItem(CODE_STORE) || '';
  } catch {
    return '';
  }
}
export const aiAvailable = () => Boolean(AI_PROXY_URL && readCode());

export class StasError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** The name she chose on the Ask page, if any, so Stas can use it. */
function nameNote(): string {
  try {
    const n = (localStorage.getItem('pastelux-ask-name') || '').trim().slice(0, 40);
    return n ? `\n\nHer name is ${n}.` : '';
  } catch {
    return '';
  }
}

/** Streams one reply. Calls onText with the text so far. */
export async function askStream(code: string, turns: Turn[], onText: (textSoFar: string) => void, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${AI_PROXY_URL}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pastelux-code': code },
    body: JSON.stringify({ system: SYSTEM_PROMPT + nameNote(), messages: turns }),
    signal,
  });
  if (!res.ok || !res.body) {
    let message = `HTTP ${res.status}`;
    try {
      message = (await res.json())?.error?.message || message;
    } catch {}
    throw new StasError(res.status, message);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '';
  for (;;) {
    // nothing for 90 s: give up instead of "thinking" forever
    let stall: ReturnType<typeof setTimeout> | undefined;
    const { done, value } = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        stall = setTimeout(() => {
          reader.cancel().catch(() => {});
          reject(new StasError(504, 'No reply from Stas for 90 seconds'));
        }, 90000);
      }),
    ]).finally(() => clearTimeout(stall));
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const evt = buf.slice(0, i).trim();
      buf = buf.slice(i + 2);
      if (!evt.startsWith('data:')) continue;
      const payload = evt.slice(5).trim();
      if (payload === '[DONE]') return text;
      let evtData: { t?: string; e?: string } | null = null;
      try {
        evtData = JSON.parse(payload);
      } catch {}
      if (evtData?.e) throw new StasError(502, evtData.e);
      if (evtData?.t) {
        text += evtData.t;
        onText(text);
      }
    }
  }
  return text;
}

export function describeError(err: unknown, vi: boolean): string {
  const t = (en: string, v: string) => (vi ? v : en);
  if ((err as Error)?.name === 'AbortError') return t('Stopped.', 'Đã dừng.');
  if (err instanceof StasError) {
    if (err.status === 401) return t('That access code is not right. Enter it again.', 'Mã truy cập chưa đúng. Nhập lại nhé.');
    if (err.status === 429) return t('Stas has hit the free plan’s limit for now — try again in a minute.', 'Stas đang chạm giới hạn của gói miễn phí — đợi một phút rồi hỏi lại nhé.');
    if (err.status === 503) return t('Stas is not switched on yet — tell Stalis.', 'Stas chưa được bật — báo Stalis nhé.');
    if (err.status === 413) return t('That image is too large.', 'Ảnh quá lớn.');
    // the provider's own reason (never contains the key) helps Stalis fix it
    const why = (() => {
      const m = String(err.message || '');
      try {
        const j = JSON.parse(m.slice(m.indexOf('{')));
        return String(j?.error?.message || j?.[0]?.error?.message || m);
      } catch {
        return m;
      }
    })().slice(0, 220);
    return t(
      `Stas could not answer (${err.status}). Try again${why ? `. Details for Stalis: ${why}` : '.'}`,
      `Stas chưa trả lời được (${err.status}). Thử lại nhé${why ? `. Chi tiết để báo Stalis: ${why}` : '.'}`
    );
  }
  if (err instanceof TypeError) return t('Could not reach Stas. Check the connection and try again.', 'Không kết nối được tới Stas. Kiểm tra mạng rồi thử lại.');
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
