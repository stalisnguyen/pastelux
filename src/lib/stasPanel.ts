/*
 * Stas chat panel: the same chat as the Ask page, opened in place so she
 * never leaves what she is working on. On ordinary pages it floats in the
 * bottom-right corner; on the Board it is docked inside the board and can
 * attach a picture of it.
 *
 * Each place keeps its own conversation (`thread`): one per page, one per
 * board project. Like the Ask page, a conversation left alone for an hour
 * starts fresh.
 */
import '../styles/stas-panel.css';
import { CODE_STORE, CHAT_STORE, askStream, describeError, readCode, renderMarkdown, toJpeg, StasError, type Turn } from './ask';

export type PanelOptions = {
  /** The element the panel is added to. */
  host: HTMLElement;
  /** Conversation key, e.g. `page:/tools/schedule` or `board:<project id>`. */
  thread: string;
  /** Docked inside an app (the Board) instead of floating over the page. */
  docked?: boolean;
  /** A line for Stas about where she is asking from. */
  context?: () => string;
  /** Small label under the title, e.g. the page or project name. */
  subtitle?: () => string;
  /** A picture of the work (the board); null when there is nothing to show. */
  snapshot?: () => Promise<string | null>;
  onOpenChange?: (open: boolean) => void;
};

const FRESH_AFTER_MS = 60 * 60 * 1000;
const NAME_STORE = 'pastelux-ask-name';
const vi = () => document.documentElement.classList.contains('lang-vi');
const t = (en: string, v: string) => (vi() ? v : en);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const store = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

const ICON_STAS =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.6L18.5 9.5l-4.7 1.9L12 16l-1.8-4.6L5.5 9.5l4.7-1.9z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>';
const ICON_NEW =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const ICON_CLOSE =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

type Pending = { media_type: 'image/jpeg'; data: string; preview: string; board?: boolean };

export class StasPanel {
  readonly el: HTMLElement;
  private o: PanelOptions;
  private turns: Turn[] = [];
  private pending: Pending | null = null;
  private controller: AbortController | null = null;
  private q = <T extends HTMLElement>(sel: string) => this.el.querySelector(sel) as T;

  constructor(o: PanelOptions) {
    this.o = o;
    const el = document.createElement('section');
    el.className = `sp${o.docked ? ' sp-docked' : ''}`;
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Stas');
    el.innerHTML = `
      <header class="sp-head">
        <span class="sp-badge">${ICON_STAS}</span>
        <div class="sp-titles"><strong>Stas</strong><span class="sp-sub"></span></div>
        <button type="button" class="sp-iconbtn sp-new" data-l="new">${ICON_NEW}</button>
        <button type="button" class="sp-iconbtn sp-close" data-l="close">${ICON_CLOSE}</button>
      </header>
      <form class="sp-lock" hidden>
        <p class="sp-lock-text"></p>
        <div class="sp-lock-row">
          <input class="sp-code" type="password" autocomplete="off" />
          <button type="submit" class="sp-send sp-unlock"></button>
        </div>
      </form>
      <div class="sp-log" aria-live="polite"></div>
      <form class="sp-form">
        <div class="sp-attach" hidden></div>
        <textarea class="sp-input" rows="2"></textarea>
        <div class="sp-row">
          <label class="sp-chip"><input class="sp-file" type="file" accept="image/*" /><span class="sp-l-image"></span></label>
          ${o.snapshot ? '<button type="button" class="sp-chip sp-snap"></button>' : ''}
          <button type="submit" class="sp-send sp-go"></button>
          <button type="button" class="sp-send sp-stop" hidden></button>
        </div>
      </form>
      <p class="sp-foot"></p>`;
    o.host.appendChild(el);
    this.el = el;

    this.q('.sp-close').addEventListener('click', () => this.close());
    this.q('.sp-new').addEventListener('click', () => {
      if (this.controller) return;
      this.turns = [];
      this.save();
      this.renderAll();
      this.input.focus();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
    });
    const input = this.input;
    input.addEventListener('keydown', (e) => {
      // Enter sends, Shift+Enter is a new line (as in most chats)
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.q<HTMLFormElement>('.sp-form').requestSubmit();
      }
    });
    input.addEventListener('paste', async (e) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
      if (!f) return;
      e.preventDefault();
      this.pending = await toJpeg(f);
      this.showAttach();
    });
    this.q<HTMLInputElement>('.sp-file').addEventListener('change', async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) {
        this.pending = await toJpeg(f);
        this.showAttach();
      }
      (e.target as HTMLInputElement).value = '';
    });
    this.el.querySelector('.sp-snap')?.addEventListener('click', () => this.attachSnapshot());
    this.q('.sp-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if ((!text && !this.pending) || this.controller) return;
      this.send(text);
    });
    this.q('.sp-stop').addEventListener('click', () => this.controller?.abort());
    this.q('.sp-lock').addEventListener('submit', (e) => {
      e.preventDefault();
      const code = this.q<HTMLInputElement>('.sp-code').value.trim();
      if (!code) return;
      store(() => localStorage.setItem(CODE_STORE, code), undefined);
      this.q<HTMLInputElement>('.sp-code').value = '';
      // the proxy checks the code on the first question; a wrong code locks again
      this.refresh();
      this.input.focus();
    });
  }

  private get input() {
    return this.q<HTMLTextAreaElement>('.sp-input');
  }
  get isOpen() {
    return !this.el.hidden;
  }

  /** Switches to another conversation (the board changed project). */
  setThread(thread: string) {
    if (thread === this.o.thread) return;
    this.controller?.abort();
    this.controller = null;
    this.o.thread = thread;
    this.pending = null;
    if (this.isOpen) this.refresh();
  }

  async open() {
    this.el.hidden = false;
    this.o.onOpenChange?.(true);
    this.refresh();
    if (readCode()) {
      this.input.focus();
      // from the board: bring a fresh picture of it along
      if (this.o.snapshot && !this.controller) await this.attachSnapshot(!this.turns.length);
    } else this.q<HTMLInputElement>('.sp-code').focus();
  }
  close() {
    if (!this.isOpen) return;
    this.el.hidden = true;
    this.o.onOpenChange?.(false);
  }
  toggle() {
    return this.isOpen ? this.close() : this.open();
  }

  // ------------------------------------------------------------ state
  private get key() {
    return `${CHAT_STORE}:${this.o.thread}`;
  }
  private get atKey() {
    return `${CHAT_STORE}-at:${this.o.thread}`;
  }
  private save() {
    // images are too heavy for localStorage: keep a marker instead
    const light = this.turns.map((m) => ({ role: m.role, text: m.text, hadImage: Boolean(m.image) || Boolean((m as any).hadImage) }));
    store(() => {
      localStorage.setItem(this.key, JSON.stringify(light.slice(-40)));
      localStorage.setItem(this.atKey, String(Date.now()));
    }, undefined);
  }
  private load() {
    this.turns = store(() => {
      if (Date.now() - Number(localStorage.getItem(this.atKey) || 0) > FRESH_AFTER_MS) {
        localStorage.removeItem(this.key);
        return [];
      }
      return JSON.parse(localStorage.getItem(this.key) || '[]');
    }, []);
  }

  /** Labels (the language may have changed), lock state and the log. */
  private refresh() {
    const L = (sel: string, text: string) => {
      const n = this.el.querySelector(sel);
      if (n) n.textContent = text;
    };
    this.q('.sp-sub').textContent = this.o.subtitle?.() ?? '';
    this.q('.sp-new').setAttribute('aria-label', t('New chat', 'Trò chuyện mới'));
    this.q('.sp-new').title = t('New chat', 'Trò chuyện mới');
    this.q('.sp-close').setAttribute('aria-label', t('Close', 'Đóng'));
    this.q('.sp-close').title = t('Close (Esc)', 'Đóng (Esc)');
    L('.sp-lock-text', t('Stas is private. Enter the access code to chat.', 'Stas là riêng tư. Nhập mã truy cập để trò chuyện.'));
    this.q<HTMLInputElement>('.sp-code').placeholder = t('Access code', 'Mã truy cập');
    L('.sp-unlock', t('Unlock', 'Mở'));
    this.input.placeholder = this.o.snapshot ? t('Ask about this board…', 'Hỏi về bảng này…') : t('Ask Stas anything…', 'Hỏi Stas bất cứ điều gì…');
    L('.sp-l-image', t('Image', 'Ảnh'));
    L('.sp-snap', t('Board picture', 'Ảnh bảng'));
    L('.sp-go', t('Send', 'Gửi'));
    L('.sp-stop', t('Stop', 'Dừng'));
    L('.sp-foot', t('Stas can be wrong. Check important facts and lighting numbers.', 'Stas có thể sai. Thông tin quan trọng và số liệu chiếu sáng nhớ kiểm tra lại.'));

    const unlocked = Boolean(readCode());
    this.q('.sp-lock').hidden = unlocked;
    this.q('.sp-log').hidden = !unlocked;
    this.q('.sp-form').hidden = !unlocked;
    this.q('.sp-new').hidden = !unlocked;
    if (!unlocked) return;
    if (!this.controller) {
      this.load();
      this.renderAll();
    }
    this.showAttach();
  }

  // ------------------------------------------------------------ rendering
  private bubble(role: 'user' | 'ai' | 'err', html: string) {
    const log = this.q('.sp-log');
    const el = document.createElement('div');
    el.className = `ask-msg ${role}`;
    el.innerHTML = html;
    log.appendChild(el);
    this.scrollDown();
    return el;
  }
  // scroll the log only, never the page or the board behind it
  private scrollDown() {
    const log = this.q('.sp-log');
    log.scrollTop = log.scrollHeight;
  }
  private renderAll() {
    this.q('.sp-log').innerHTML = '';
    if (!this.turns.length) {
      const name = store(() => (localStorage.getItem(NAME_STORE) || '').replace(/[*_`#<>\[\]()!]/g, '').trim(), '');
      const hi = name ? t(`Hi ${name}`, `Chào ${name}`) : t('Hello', 'Xin chào');
      this.bubble(
        'ai',
        renderMarkdown(
          this.o.snapshot
            ? t(`${hi}! I can see this board when you attach its picture. What would you like to look at?`, `${hi}! Gửi kèm ảnh bảng là mình thấy được bảng này. Cậu muốn xem chỗ nào?`)
            : t(`${hi}, I’m Stas. Ask me anything about this page, or anything else.`, `${hi}, mình là Stas. Cậu hỏi về trang này hay chuyện gì khác cũng được.`)
        )
      );
      return;
    }
    for (const m of this.turns) {
      const img = m.image || (m as any).hadImage ? `<p style="opacity:.7">🖼 ${t('image', 'ảnh')}</p>` : '';
      if (m.role === 'user') this.bubble('user', img + esc(m.text || ''));
      else this.bubble('ai', renderMarkdown(m.text || ''));
    }
  }
  private showAttach() {
    const box = this.q('.sp-attach');
    if (!this.pending) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.innerHTML = `<img src="${this.pending.preview}" alt="" /><span>${this.pending.board ? t('Board picture attached', 'Đã đính kèm ảnh bảng') : t('Image attached', 'Đã đính kèm ảnh')}</span>
      <button type="button" class="sp-unattach">${t('remove', 'bỏ')}</button>`;
    box.querySelector('.sp-unattach')!.addEventListener('click', () => {
      this.pending = null;
      this.showAttach();
      this.input.focus();
    });
  }
  private async attachSnapshot(prefill = false) {
    const url = await this.o.snapshot?.().catch(() => null);
    if (!url) return;
    this.pending = { ...(await toJpeg(url)), board: true };
    this.showAttach();
    if (prefill && !this.input.value.trim()) {
      this.input.value = t('Here is my board. What would you change in the lighting?', 'Đây là bảng của mình. Cậu sẽ chỉnh gì về chiếu sáng?');
      this.input.select();
    }
  }

  // ------------------------------------------------------------ sending
  private async send(text: string) {
    const code = readCode();
    if (!code) return this.refresh();
    const p = this.pending;
    const userTurn: Turn = {
      role: 'user',
      text: text || t('Please review this.', 'Góp ý giúp mình nhé.'),
      ...(p ? { image: { mime: p.media_type, data: p.data } } : {}),
    };
    this.turns.push(userTurn);
    this.bubble('user', (p ? `<img src="${p.preview}" alt="" />` : '') + esc(userTurn.text));
    this.pending = null;
    this.showAttach();
    this.input.value = '';
    this.save();

    const out = this.bubble('ai', `<p style="opacity:.6">${t('Thinking…', 'Đang nghĩ…')}</p>`);
    const go = this.q('.sp-go'), stop = this.q('.sp-stop');
    go.hidden = true;
    stop.hidden = false;
    const ctl = new AbortController();
    this.controller = ctl;
    const thread = this.o.thread;
    let frame = 0;
    try {
      // only the newest image travels; older turns keep their text
      const wire = this.turns.map((m, i) => (i === this.turns.length - 1 ? m : { role: m.role, text: m.text }));
      const answer = await askStream(
        code,
        wire,
        (so) => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            out.innerHTML = renderMarkdown(so);
            this.scrollDown();
          });
        },
        ctl.signal,
        this.o.context?.() ?? ''
      );
      cancelAnimationFrame(frame);
      if (thread !== this.o.thread) return; // the board switched project meanwhile
      const final = answer.trim() || t('No answer came back. Try asking again.', 'Không có câu trả lời. Thử hỏi lại nhé.');
      out.innerHTML = renderMarkdown(final);
      this.scrollDown();
      this.turns.push({ role: 'assistant', text: final });
      this.save();
    } catch (err) {
      cancelAnimationFrame(frame);
      if (thread !== this.o.thread) return;
      out.className = 'ask-msg err';
      out.textContent = describeError(err, vi());
      this.turns.pop(); // let her resend the same question
      this.save();
      if (!this.input.value) this.input.value = text;
      if ((err as StasError)?.status === 401) {
        store(() => localStorage.removeItem(CODE_STORE), undefined);
        setTimeout(() => this.refresh(), 1200);
      }
    } finally {
      if (this.controller === ctl) this.controller = null;
      stop.hidden = true;
      go.hidden = false;
    }
  }
}
