import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Excalidraw,
  convertToExcalidrawElements,
  exportToBlob,
  CaptureUpdateAction,
  useHandleLibrary,
  viewportCoordsToSceneCoords,
  sceneCoordsToViewportCoords,
} from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { get, set } from 'idb-keyval';
import { lightingLibrary } from './library';
import { NOTE_COLORS, STAMPS, CCT_SWATCHES, EMOJI_GROUPS, templates } from './stickers';
import FLUENT from './fluent-stickers.json';
import { loadMine, addMine, removeMine, MAX_MINE, type MySticker } from './mystickers';
import { AI_PROXY_URL } from '../../site';

/*
 * A free-form board laid out like Miro: a vertical toolbar on the left
 * (select, hand, notes, text, shapes, connector, pen/highlighter/eraser,
 * frame, image, stickers, comments, votes, templates, lighting symbols),
 * built on Excalidraw. Everything stays in this browser (IndexedDB).
 */

// Naming this tab lets libraries.excalidraw.com send "Add to Excalidraw"
// back into it (a hash change, no reload, no confirm) instead of opening
// a second board tab that has to load the whole editor again.
if (typeof window !== 'undefined' && !window.name) window.name = 'pastelux-board';

const SCENE_KEY = 'pastelux-board';
const FILES_KEY = 'pastelux-board-files';
const LIB_KEY = 'pastelux-board-library';
const UI_OPTIONS = { canvasActions: { toggleTheme: false } } as const;
const GRID_KEY = 'pastelux-board-grid';
const NAME_KEY = 'pastelux-board-name';
const CANVAS_BG = '#f5f6f8';

type Saved = { elements: any[]; appState: Record<string, unknown>; files: Record<string, any> };
type Comment = { by: string; text: string; at: number };

const readLang = () => (document.documentElement.classList.contains('lang-vi') ? 'vi' : 'en');
const store = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

// ------------------------------------------------------------------ icons
const I = {
  select: 'M4 3l7 17 2.5-7.5L21 10z',
  hand: 'M8 13V5.5a1.5 1.5 0 013 0V12m0-6.5a1.5 1.5 0 013 0V12m0-5a1.5 1.5 0 013 0v7c0 4-3 7-7 7-3 0-4.5-1.5-6-4l-2-3.5a1.5 1.5 0 012.5-1.5L8 13',
  note: 'M4 4h16v11l-5 5H4zM15 20v-5h5',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  shapes: 'M3 14h7v7H3zM17.5 3l4 7h-8zM17.5 14a3.5 3.5 0 110 7 3.5 3.5 0 010-7z',
  connector: 'M5 19L19 5M19 5h-7M19 5v7',
  pen: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3',
  frame: 'M7 3v18M17 3v18M3 7h18M3 17h18',
  image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
  sticker: 'M12 3a9 9 0 109 9h-6a3 3 0 01-3-3zM12 3l9 9M8.5 10h.01M14 15c-1 1-3 1-4 0',
  emoji: 'M12 21a9 9 0 100-18 9 9 0 000 18zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  comment: 'M4 5h16v11H9l-5 4z',
  vote: 'M12 21s-7-4.5-7-10a4 4 0 017-2.6A4 4 0 0119 11c0 5.5-7 10-7 10z',
  template: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  library: 'M5 4h4v16H5zM11 4h4v16h-4zM17 5l3 .8-3.6 14.5-3-.8',
  ai: 'M12 3l1.8 4.6L18.5 9.5l-4.7 1.9L12 16l-1.8-4.6L5.5 9.5l4.7-1.9zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
};
const Icon = ({ d }: { d: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

export default function BoardApp() {
  const [lang, setLang] = useState<'vi' | 'en'>(readLang);
  const [grid, setGrid] = useState<boolean>(() => store(() => localStorage.getItem(GRID_KEY) === '1', false));
  const [api, setApi] = useState<any>(null);
  const [tool, setTool] = useState('selection');
  const [menu, setMenu] = useState<string | null>(null);
  const [anchorTop, setAnchorTop] = useState(0);
  // Figma-style comments: comment mode, then click anywhere to drop a pin
  const [commentMode, setCommentMode] = useState(false);
  const [draft, setDraft] = useState<{ left: number; top: number; sceneX: number; sceneY: number } | null>(null);
  const [viewTick, setViewTick] = useState(0);
  const popRef = useRef<HTMLDivElement>(null);
  const [selectedComment, setSelectedComment] = useState<any>(null);
  const [showComments, setShowComments] = useState(false);
  const [toast, setToast] = useState('');
  const [sceneTick, setSceneTick] = useState(0);
  const [stickerTab, setStickerTab] = useState('react');
  const [emojiTab, setEmojiTab] = useState('smileys');
  const [stickerQuery, setStickerQuery] = useState('');
  const [mine, setMine] = useState<MySticker[] | null>(null);
  const [clearBg, setClearBg] = useState(true);
  const mineInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string>(() => store(() => localStorage.getItem(NAME_KEY) || 'Pastel', 'Pastel'));
  const saveTimer = useRef<number | undefined>(undefined);
  const cascade = useRef(0);
  const lastTool = useRef('selection');
  const lastSelection = useRef('');
  const openPin = useRef<any>(null);
  const lastFileIds = useRef('');
  const lastCounts = useRef('');
  const fileInput = useRef<HTMLInputElement>(null);
  const libChannel = useRef<BroadcastChannel | null>(null);
  const libQuiet = useRef(false);
  const libCount = useRef(-1);
  const vi = lang === 'vi';
  const t = (en: string, v: string) => (vi ? v : en);
  const aiOn = Boolean(AI_PROXY_URL);

  // ---------------------------------------------------- site theme & language
  useEffect(() => {
    // Excalidraw writes its own language to <html lang>; the site owns it.
    const restoreLang = () => {
      const want = readLang();
      if (document.documentElement.lang !== want) document.documentElement.lang = want;
    };
    const timer = window.setTimeout(restoreLang, 0);
    const langMo = new MutationObserver(restoreLang);
    langMo.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    const mo = new MutationObserver(() => setLang(readLang()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      window.clearTimeout(timer);
      langMo.disconnect();
      mo.disconnect();
    };
  }, []);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((m) => (m === msg ? '' : m)), 2600);
  }, []);

  const toggleGrid = useCallback(() => {
    setGrid((g) => {
      store(() => localStorage.setItem(GRID_KEY, g ? '0' : '1'), undefined);
      return !g;
    });
  }, []);

  const initialData = useMemo(
    () => async () => {
      const saved = await get<Saved>(SCENE_KEY).catch(() => undefined);
      const stored = await get<Record<string, any>>(FILES_KEY).catch(() => undefined);
      const files = stored ?? saved?.files ?? {};
      // boards saved before files had their own record: force one write so
      // their images move across before the old record is overwritten
      lastFileIds.current = stored ? Object.keys(stored).sort().join('|') : '__migrate__';
      return {
        elements: saved?.elements ?? [],
        // a light Miro-like canvas, whatever the site theme
        appState: { viewBackgroundColor: CANVAS_BG, ...(saved?.appState ?? {}), collaborators: new Map() },
        files,
        scrollToContent: Boolean(saved?.elements?.length),
      };
    },
    []
  );

  // Excalidraw calls this on every pointer move: keep the per-event work tiny
  // and only touch React state when something we show actually changed.
  const onChange = useCallback((elements: readonly any[], appState: any, files: any) => {
    const type = appState.activeTool?.type;
    if (type !== lastTool.current) {
      lastTool.current = type;
      setTool(type);
    }
    const ids = Object.keys(appState.selectedElementIds || {});
    const selKey = ids.join(',');
    if (selKey !== lastSelection.current) {
      lastSelection.current = selKey;
      const pin = ids.length === 1 ? elements.find((e) => e.id === ids[0] && e.customData?.kind === 'comment' && !e.isDeleted) : null;
      openPin.current = pin ?? null;
      setSelectedComment(pin ?? null);
    } else if (openPin.current) {
      // the open thread may have gained a reply
      const pin = elements.find((e) => e.id === openPin.current.id);
      if (pin && pin.version !== openPin.current.version) {
        openPin.current = pin.isDeleted ? null : pin;
        setSelectedComment(openPin.current);
      }
    }
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const live = elements.filter((e) => !e.isDeleted);
      // badges and pins changed? only then re-render the counters
      let c = 0, v = 0;
      for (const e of live) {
        if (e.customData?.kind === 'comment') c += 1 + (e.customData.thread?.length ?? 0);
        else if (e.customData?.kind === 'vote') v += e.customData.count ?? 0;
      }
      const counts = `${c}|${v}`;
      if (counts !== lastCounts.current) {
        lastCounts.current = counts;
        setSceneTick((n) => n + 1);
      }
      set(SCENE_KEY, {
        elements: live,
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor,
          currentItemStrokeColor: appState.currentItemStrokeColor,
          currentItemBackgroundColor: appState.currentItemBackgroundColor,
          currentItemFontFamily: appState.currentItemFontFamily,
          scrollX: appState.scrollX,
          scrollY: appState.scrollY,
          zoom: appState.zoom,
        },
        files: {},
      } satisfies Saved).catch(() => {});
      // images are heavy: write them only when the set of images changes
      const fileIds = Object.keys(files || {}).sort().join('|');
      if (fileIds !== lastFileIds.current) {
        lastFileIds.current = fileIds;
        set(FILES_KEY, files).catch(() => {});
      }
    }, 500);
  }, []);

  // Library: persisted in this browser, always including the lighting
  // symbols, and able to receive libraries added from libraries.excalidraw.com
  // (they come back to /board/#addLibrary=…).
  const libraryAdapter = useMemo(
    () => ({
      load: async () => {
        const saved = ((await get(LIB_KEY).catch(() => null)) as any[] | null) ?? [];
        const ids = new Set(saved.map((x: any) => x.id));
        const missing = lightingLibrary(convertToExcalidrawElements).filter((x) => !ids.has(x.id));
        libCount.current = saved.length + missing.length;
        return { libraryItems: [...saved, ...missing] as any };
      },
      save: async ({ libraryItems }: { libraryItems: any }) => {
        await set(LIB_KEY, libraryItems);
        // Tell other open board tabs (the install opens a new one) to reload it.
        const n = libraryItems?.length ?? 0;
        if (n !== libCount.current) {
          const added = n > libCount.current;
          libCount.current = n;
          if (!libQuiet.current) libChannel.current?.postMessage({ added });
        }
      },
    }),
    []
  );
  useHandleLibrary({ excalidrawAPI: api, adapter: libraryAdapter });

  // Mouse wheel zooms around the pointer, like Miro. Excalidraw zooms on
  // Ctrl + wheel, so a plain mouse-wheel turn is re-sent with Ctrl held.
  // Touchpads (small or sideways deltas) keep scrolling to pan, and
  // pinch already arrives with Ctrl.
  useEffect(() => {
    const shell = document.querySelector('.board-shell');
    if (!shell) return;
    const onWheel = (e: Event) => {
      const w = e as WheelEvent;
      if (!w.isTrusted || w.ctrlKey || w.metaKey || w.shiftKey || w.altKey) return;
      if (!(w.target instanceof HTMLCanvasElement)) return; // lists and popovers scroll normally
      // a wheel notch is ~100 px (or lines); touchpads send small, often sideways steps
      const mouse = w.deltaMode !== 0 || (w.deltaX === 0 && Math.abs(w.deltaY) >= 40);
      if (!mouse) return;
      w.preventDefault();
      w.stopPropagation();
      w.target.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: w.clientX,
          clientY: w.clientY,
          deltaX: 0,
          deltaY: w.deltaMode === 0 ? w.deltaY : w.deltaY * 33,
          deltaMode: 0,
          ctrlKey: true,
        })
      );
    };
    shell.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => shell.removeEventListener('wheel', onWheel, { capture: true } as any);
  }, [api]);

  // A library installed in another tab shows up here without a reload, and
  // this tab's older copy never overwrites it.
  useEffect(() => {
    if (!api || typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('pastelux-board-library');
    libChannel.current = ch;
    ch.onmessage = async (e) => {
      const items = ((await get(LIB_KEY).catch(() => null)) as any[] | null) ?? [];
      libQuiet.current = true;
      libCount.current = items.length;
      try {
        await api.updateLibrary({ libraryItems: items as any, merge: false });
      } finally {
        libQuiet.current = false;
      }
      if (e.data?.added) {
        api.toggleSidebar({ name: 'default', tab: 'library', force: true });
        flash(vi ? 'Đã thêm thư viện mới' : 'New library added');
      }
    };
    return () => {
      ch.close();
      libChannel.current = null;
    };
  }, [api, flash, vi]);

  // ---------------------------------------------------- scene helpers
  const viewCenter = useCallback(() => {
    const s = api.getAppState();
    const z = s.zoom?.value || 1;
    return { x: -s.scrollX + s.width / 2 / z, y: -s.scrollY + s.height / 2 / z };
  }, [api]);

  /** Adds skeletons centred on the view, selects them, undoable. */
  const addAtCenter = useCallback(
    (skeletons: any[], opts: { select?: boolean; jitter?: boolean } = {}) => {
      if (!api) return [];
      const made = convertToExcalidrawElements(skeletons as any, { regenerateIds: true });
      // bounding box of what was made
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const e of made) {
        minX = Math.min(minX, e.x);
        minY = Math.min(minY, e.y);
        maxX = Math.max(maxX, e.x + e.width);
        maxY = Math.max(maxY, e.y + e.height);
      }
      const c = viewCenter();
      // successive items step down-right instead of landing on top of each other
      const step = opts.jitter ? (cascade.current++ % 8) * 34 - 120 : 0;
      const dx = c.x - (minX + maxX) / 2 + step, dy = c.y - (minY + maxY) / 2 + step;
      const moved = made.map((e: any) => ({ ...e, x: e.x + dx, y: e.y + dy }));
      const selected: Record<string, true> = {};
      if (opts.select !== false) for (const e of moved) if (!e.containerId) selected[e.id] = true;
      api.updateScene({
        elements: [...api.getSceneElementsIncludingDeleted(), ...moved],
        appState: opts.select !== false ? { selectedElementIds: selected } : undefined,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      api.setActiveTool({ type: 'selection' });
      return moved;
    },
    [api, viewCenter]
  );

  const useTool = (type: string, appState?: Record<string, unknown>) => {
    if (!api) return;
    if (appState) api.updateScene({ appState, captureUpdate: CaptureUpdateAction.EVENTUALLY });
    api.setActiveTool({ type });
    setMenu(null);
  };

  // ---------------------------------------------------- notes, stickers
  const addNote = (c = NOTE_COLORS[0]) => {
    addAtCenter(
      [
        {
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 200,
          height: 200,
          backgroundColor: c.fill,
          strokeColor: c.edge,
          fillStyle: 'solid',
          strokeWidth: 1,
          roughness: 0,
          roundness: null,
          label: { text: ' ', fontSize: 20, fontFamily: 2, strokeColor: '#1e1e1e', verticalAlign: 'middle' },
          customData: { kind: 'note' },
        },
      ],
      { jitter: true }
    );
    setMenu(null);
    flash(t('Note added — press Enter or double-click to write', 'Đã thêm note — bấm Enter hoặc nhấp đúp để viết'));
  };

  const addEmoji = (e: string) => {
    addAtCenter([{ type: 'text', x: 0, y: 0, text: e, fontSize: 64, fontFamily: 2, customData: { kind: 'emoji' } }], { jitter: true });
    setMenu(null);
  };
  const addStamp = (s: (typeof STAMPS)[number]) => {
    addAtCenter(
      [
        {
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 190,
          height: 54,
          strokeColor: s.color,
          strokeWidth: 3,
          roughness: 0,
          roundness: { type: 3 },
          backgroundColor: 'transparent',
          angle: -0.08,
          label: { text: vi ? s.vi : s.en, fontSize: 22, fontFamily: 2, strokeColor: s.color },
          customData: { kind: 'stamp' },
        },
      ],
      { jitter: true }
    );
    setMenu(null);
  };
  const addSwatch = (s: (typeof CCT_SWATCHES)[number]) => {
    addAtCenter(
      [
        {
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 120,
          height: 80,
          backgroundColor: s.color,
          strokeColor: '#adb5bd',
          fillStyle: 'solid',
          roughness: 0,
          roundness: { type: 3 },
          label: { text: s.label, fontSize: 16, fontFamily: 2, strokeColor: '#1e1e1e' },
        },
      ],
      { jitter: true }
    );
    setMenu(null);
  };

  // ---------------------------------------------------- images & stickers
  const readAsDataURL = (blob: Blob): Promise<string> =>
    new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsDataURL(blob);
    });
  const addImage = async (blob: Blob, maxSide: number, customData?: Record<string, unknown>, fileId?: string) => {
    if (!api) return;
    const dataURL = await readAsDataURL(blob);
    const img = new Image();
    await new Promise((res) => {
      img.onload = res;
      img.src = dataURL;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const id = fileId ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    if (!api.getFiles()[id]) api.addFiles([{ id, dataURL, mimeType: blob.type || 'image/png', created: Date.now() }]);
    addAtCenter(
      [{ type: 'image', x: 0, y: 0, width: img.naturalWidth * scale, height: img.naturalHeight * scale, fileId: id, customData }],
      { jitter: Boolean(customData) }
    );
  };
  const onPickImage = (file: File) => {
    if (file.type.startsWith('image/')) addImage(file, 600);
  };
  const stickerUrl = (id: string, thumb = false) =>
    `${import.meta.env.BASE_URL.replace(/\/$/, '')}/stickers/fluent/${thumb ? 'thumbs/' : ''}${id}.png`;
  const addSticker = async (id: string) => {
    setMenu(null);
    try {
      const res = await fetch(stickerUrl(id));
      if (!res.ok) throw new Error(String(res.status));
      // one stored file per sticker, however many times it is placed
      await addImage(await res.blob(), 120, { kind: 'sticker' }, `sticker-${id}`);
    } catch {
      flash(t('Could not load that sticker', 'Không tải được sticker này'));
    }
  };

  // My stickers: her own images, kept in this browser.
  const mineUrls = useMemo(() => new Map((mine ?? []).map((m) => [m.id, URL.createObjectURL(m.blob)])), [mine]);
  useEffect(() => () => mineUrls.forEach((u) => URL.revokeObjectURL(u)), [mineUrls]);
  useEffect(() => {
    if (menu === 'stickers' && mine === null) loadMine().then(setMine);
  }, [menu, mine]);
  const placeMine = (m: MySticker) => {
    setMenu(null);
    addImage(m.blob, 160, { kind: 'sticker' }, `mine-${m.id}`);
  };
  const uploadMine = async (files: FileList | null) => {
    const list = [...(files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    const r = await addMine(list, list.map((f) => f.name.replace(/\.[^.]+$/, '')), clearBg);
    setMine(r.list);
    setStickerTab('mine');
    flash(r.full ? t(`Sticker box is full (${MAX_MINE})`, `Hộp sticker đã đầy (${MAX_MINE})`) : t(`Added ${r.added} sticker${r.added === 1 ? '' : 's'}`, `Đã thêm ${r.added} sticker`));
  };
  const saveSelectionAsSticker = async () => {
    if (!api) return;
    const s = api.getAppState();
    const files = api.getFiles();
    const imgs = api.getSceneElements().filter((e: any) => s.selectedElementIds[e.id] && e.type === 'image' && e.fileId && files[e.fileId]);
    if (!imgs.length) {
      flash(t('Select an image on the board first', 'Chọn một ảnh trên bảng trước đã'));
      return;
    }
    const blobs = await Promise.all(imgs.map((e: any) => fetch(files[e.fileId].dataURL).then((r) => r.blob())));
    const r = await addMine(blobs, blobs.map(() => 'From board'), clearBg);
    setMine(r.list);
    setStickerTab('mine');
    flash(t(`Saved ${r.added} to My stickers`, `Đã lưu ${r.added} vào Sticker của tôi`));
  };
  const deleteMine = async (id: string) => {
    setMine(await removeMine(id));
  };

  // ---------------------------------------------------- votes
  const votable = (e: any) => !e.isDeleted && !['vote', 'comment'].includes(e.customData?.kind) && !e.containerId;
  const vote = (delta: 1 | -1) => {
    if (!api) return;
    const s = api.getAppState();
    const all: any[] = api.getSceneElementsIncludingDeleted();
    const targets = all.filter((e) => s.selectedElementIds[e.id] && votable(e));
    // a selected group counts once: vote on its first element
    const seen = new Set<string>();
    const picks = targets.filter((e) => {
      const g = e.groupIds?.[e.groupIds.length - 1] ?? e.id;
      if (seen.has(g)) return false;
      seen.add(g);
      return true;
    });
    if (!picks.length) {
      flash(t('Select something to vote on first', 'Chọn một mục trước rồi mới vote'));
      return;
    }
    let next = [...all];
    for (const target of picks) {
      const badge = next.find((e) => !e.isDeleted && e.customData?.kind === 'vote' && e.customData.for === target.id);
      const count = Math.max(0, (badge?.customData?.count ?? 0) + delta);
      next = next.filter((e) => e !== badge);
      if (!count) continue;
      const [made] = convertToExcalidrawElements(
        [{ type: 'text', x: 0, y: 0, text: `● ${count}`, fontSize: 18, fontFamily: 2, strokeColor: '#e03131', customData: { kind: 'vote', for: target.id, count } }] as any,
        { regenerateIds: true }
      ) as any[];
      // ride along with the voted element when it moves
      let groupIds = target.groupIds ?? [];
      if (!groupIds.length) {
        const gid = `vote-${target.id}`;
        groupIds = [gid];
        next = next.map((e) => (e.id === target.id ? { ...e, groupIds: [gid], version: e.version + 1 } : e));
      }
      next.push({ ...made, x: target.x + target.width - 8, y: target.y - 26, groupIds });
    }
    api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    setMenu(null);
  };
  const clearVotes = () => {
    if (!api) return;
    const next = api.getSceneElementsIncludingDeleted().filter((e: any) => e.customData?.kind !== 'vote');
    api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    setMenu(null);
  };
  const voteTotals = useMemo(() => {
    if (!api) return [] as Array<{ id: string; label: string; count: number }>;
    const all: any[] = api.getSceneElements();
    const byId = new Map(all.map((e) => [e.id, e]));
    return all
      .filter((e) => e.customData?.kind === 'vote')
      .map((b) => {
        const el = byId.get(b.customData.for);
        const bound = el?.boundElements?.find((x: any) => x.type === 'text');
        const text = (bound && byId.get(bound.id)?.text) || el?.text || el?.type || '—';
        return { id: b.customData.for, label: String(text).trim().slice(0, 40) || '—', count: b.customData.count };
      })
      .sort((a, b) => b.count - a.count);
    // sceneTick re-reads after edits
  }, [api, sceneTick, menu]);

  // ---------------------------------------------------- comments
  const addCommentAt = (sceneX: number, sceneY: number, text: string) => {
    if (!api || !text.trim()) return;
    const thread: Comment[] = [{ by: name, text: text.trim(), at: Date.now() }];
    const [pin] = convertToExcalidrawElements(
      [{ type: 'text', x: 0, y: 0, text: '💬', fontSize: 30, fontFamily: 2, customData: { kind: 'comment', thread, resolved: false } }] as any,
      { regenerateIds: true }
    ) as any[];
    // the pin's tail sits on the clicked point
    api.updateScene({
      elements: [...api.getSceneElementsIncludingDeleted(), { ...pin, x: sceneX - 4, y: sceneY - pin.height + 4 }],
      appState: { selectedElementIds: { [pin.id]: true } },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    setDraft(null);
  };
  const startCommentMode = (on: boolean) => {
    setCommentMode(on);
    setDraft(null);
    setMenu(null);
    if (on && api) api.setActiveTool({ type: 'selection' });
  };
  const onCommentClick = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!api) return;
    const shell = (e.currentTarget.closest('.board-shell') as HTMLElement).getBoundingClientRect();
    const { x, y } = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, api.getAppState());
    setDraft({ left: e.clientX - shell.left, top: e.clientY - shell.top, sceneX: x, sceneY: y });
  };
  const updateComment = (pinId: string, patch: (cd: any) => any) => {
    const next = api.getSceneElementsIncludingDeleted().map((e: any) =>
      e.id === pinId ? { ...e, customData: patch(e.customData), version: e.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31) } : e
    );
    api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  };
  const deleteElement = (id: string) => {
    const next = api.getSceneElementsIncludingDeleted().map((e: any) => (e.id === id ? { ...e, isDeleted: true, version: e.version + 1 } : e));
    api.updateScene({ elements: next, appState: { selectedElementIds: {} }, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  };
  const comments = useMemo(
    () => (api ? (api.getSceneElements() as any[]).filter((e) => e.customData?.kind === 'comment') : []),
    [api, sceneTick, showComments, selectedComment]
  );
  const jumpTo = (el: any) => {
    api.scrollToContent(el, { animate: true, fitToViewport: false });
    api.updateScene({ appState: { selectedElementIds: { [el.id]: true } } });
  };

  // ---------------------------------------------------- templates, library, AI
  /** Templates land in free space to the right of what is already there. */
  const addTemplate = (build: () => any[]) => {
    if (!api) return;
    const existing: any[] = api.getSceneElements();
    const made = convertToExcalidrawElements(build() as any, { regenerateIds: true }) as any[];
    let ox = 0, oy = 0;
    if (existing.length) {
      const right = Math.max(...existing.map((e) => e.x + e.width));
      const top = Math.min(...existing.map((e) => e.y));
      const minX = Math.min(...made.map((e) => e.x));
      const minY = Math.min(...made.map((e) => e.y));
      ox = right + 240 - minX;
      oy = top - minY;
    } else {
      const c = viewCenter();
      ox = c.x - 400;
      oy = c.y - 300;
    }
    const moved = made.map((e) => ({ ...e, x: e.x + ox, y: e.y + oy }));
    api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...moved], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    // fit the template, then keep it clear of the left toolbar
    api.scrollToContent(moved, { fitToViewport: true, viewportZoomFactor: 0.85, animate: false });
    const st = api.getAppState();
    api.updateScene({ appState: { scrollX: st.scrollX + 40 / (st.zoom?.value || 1) } });
    setMenu(null);
  };
  const openLibrary = () => {
    api?.toggleSidebar({ name: 'default', tab: 'library', force: true });
    setMenu(null);
  };
  const askAI = async () => {
    if (!api) return;
    const elements = api.getSceneElements();
    const askUrl = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/ask/`;
    // an empty board: just open the chat, nothing to attach
    if (!elements.length) {
      window.location.href = askUrl;
      return;
    }
    const blob = await exportToBlob({
      elements,
      appState: { ...api.getAppState(), exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false },
      files: api.getFiles(),
      mimeType: 'image/png',
      maxWidthOrHeight: 1600,
    });
    const dataUrl: string = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsDataURL(blob);
    });
    store(() => sessionStorage.setItem('pastelux-ask-attach', dataUrl), undefined);
    window.location.href = askUrl;
  };
  const askRef = useRef(askAI);
  askRef.current = askAI;

  useLayoutEffect(() => {
    const pop = popRef.current;
    const shell = pop?.closest('.board-shell') as HTMLElement | null;
    if (!pop || !shell) return;
    const maxTop = shell.clientHeight - pop.offsetHeight - 12;
    pop.style.top = `${Math.max(12, Math.min(anchorTop, maxTop))}px`;
  }, [menu, anchorTop, stickerTab, emojiTab, stickerQuery, mine]);

  // N adds a note, C a comment (when not typing)
  useEffect(() => {
    if (!api) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (el && typeof el.closest === 'function' && el.closest('input, textarea, [contenteditable="true"]')) return;
      if (api.getAppState().editingTextElement) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        addNote();
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        startCommentMode(!commentMode);
      } else if (e.key === 'Escape') {
        if (draft) setDraft(null);
        else if (commentMode) setCommentMode(false);
        else if (menu) setMenu(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // ---------------------------------------------------- toolbar
  const Btn = ({ id, icon, label, active, onClick }: { id: string; icon: string; label: string; active?: boolean; onClick: () => void }) => (
    <button
      type="button"
      className={`mb-btn${active ? ' on' : ''}${menu === id ? ' open' : ''}`}
      data-tool={id}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      <Icon d={icon} />
    </button>
  );
  // popovers open beside the button that opened them, kept inside the board
  const toggleMenu = (id: string) => {
    const btn = document.querySelector<HTMLElement>(`.mb-bar [data-tool="${id}"]`);
    const shell = btn?.closest('.board-shell') as HTMLElement | null;
    if (btn && shell) setAnchorTop(btn.getBoundingClientRect().top - shell.getBoundingClientRect().top);
    setMenu((m) => (m === id ? null : id));
  };
  const commentCount = comments.length;
  const renderTopRight = useCallback(
    () => (
          <div className="mb-top">
            <button
              type="button"
              className={`board-grid-btn${grid ? ' on' : ''}`}
              onClick={toggleGrid}
              aria-pressed={grid}
              title={t('Show / hide grid', 'Bật / tắt ô lưới')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
                <rect x="3" y="3" width="18" height="18" rx="2" />
              </svg>
              <span>{grid ? t('Grid', 'Có lưới') : t('Plain', 'Giấy trơn')}</span>
            </button>
            <button type="button" className={`board-grid-btn${showComments ? ' on' : ''}`} onClick={() => setShowComments((v) => !v)}>
              <Icon d={I.comment} />
              <span>{commentCount}</span>
            </button>
            {aiOn && (
              <button
                type="button"
                className="board-stas-btn"
                onClick={() => askRef.current()}
                title={t('Ask Stas about this board (sends a picture of it)', 'Hỏi Stas về bảng này (gửi kèm ảnh chụp bảng)')}
              >
                <Icon d={I.ai} />
                <span>{t('Ask Stas', 'Hỏi Stas')}</span>
              </button>
            )}
          </div>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, showComments, commentCount, vi]
  );
  const thread: Comment[] = selectedComment?.customData?.thread ?? [];
  /** Place the thread card beside its pin, kept inside the board. */
  const pinAnchor = (pin: any): React.CSSProperties => {
    void viewTick;
    if (!api || !pin) return {};
    const st = api.getAppState();
    const v = sceneCoordsToViewportCoords({ sceneX: pin.x + pin.width, sceneY: pin.y }, st);
    const left = v.x - st.offsetLeft + 10;
    const top = v.y - st.offsetTop;
    const maxLeft = st.width - 332;
    return {
      left: Math.max(70, Math.min(left, maxLeft)),
      top: Math.max(12, Math.min(top, st.height - 260)),
      right: 'auto',
    };
  };

  return (
    <div className="board-shell">
      {aiOn && (
        <button type="button" className="board-stas-btn board-stas-float" onClick={() => askRef.current()} aria-label={t('Ask Stas about this board', 'Hỏi Stas về bảng này')}>
          <Icon d={I.ai} />
          <span>Stas</span>
        </button>
      )}
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={initialData}
        onChange={onChange}
        onScrollChange={() => (openPin.current || draft) && setViewTick((n) => n + 1)}
        theme="light"
        langCode="en"
        gridModeEnabled={grid}
        name="Pastelux board"
        libraryReturnUrl={typeof window !== 'undefined' ? `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/board/` : undefined}
        UIOptions={UI_OPTIONS}
        renderTopRightUI={renderTopRight}
      />


      {/* comment mode: the next click anywhere drops a pin there */}
      {commentMode && (
        <div className="mb-comment-layer" onPointerDown={onCommentClick} aria-label={t('Click to comment', 'Bấm để bình luận')}>
          {!draft && <div className="mb-comment-hint">{t('Click anywhere to comment · Esc to leave', 'Bấm vào bất kỳ đâu để bình luận · Esc để thoát')}</div>}
        </div>
      )}
      {draft && (
        <form
          className="mb-draft"
          style={{ left: draft.left, top: draft.top }}
          onPointerDown={(e) => e.stopPropagation()}
          onSubmit={(e) => {
            e.preventDefault();
            const box = e.currentTarget.elements.namedItem('c') as HTMLTextAreaElement;
            addCommentAt(draft.sceneX, draft.sceneY, box.value);
          }}
        >
          <span className="mb-draft-dot" aria-hidden="true" />
          <textarea
            name="c"
            rows={2}
            autoFocus
            placeholder={t('Add a comment…', 'Viết bình luận…')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement).requestSubmit();
              }
            }}
          />
          <div className="mb-draft-actions">
            <button type="button" onClick={() => setDraft(null)}>{t('Cancel', 'Huỷ')}</button>
            <button type="submit" className="mb-primary">{t('Post', 'Đăng')}</button>
          </div>
        </form>
      )}

      {/* Miro-style vertical toolbar */}
      <nav className="mb-bar" aria-label={t('Board tools', 'Công cụ bảng')}>
        <Btn id="select" icon={I.select} label={t('Select (V)', 'Chọn (V)')} active={tool === 'selection'} onClick={() => useTool('selection')} />
        <Btn id="hand" icon={I.hand} label={t('Pan (H)', 'Kéo bảng (H)')} active={tool === 'hand'} onClick={() => useTool('hand')} />
        <span className="mb-sep" />
        <Btn id="templates" icon={I.template} label={t('Templates', 'Mẫu')} onClick={() => toggleMenu('templates')} />
        <Btn id="notes" icon={I.note} label={t('Sticky note (N)', 'Note (N)')} onClick={() => toggleMenu('notes')} />
        <Btn id="text" icon={I.text} label={t('Text (T)', 'Chữ (T)')} active={tool === 'text'} onClick={() => useTool('text')} />
        <Btn id="shapes" icon={I.shapes} label={t('Shapes', 'Hình')} active={['rectangle', 'ellipse', 'diamond', 'line'].includes(tool)} onClick={() => toggleMenu('shapes')} />
        <Btn id="connector" icon={I.connector} label={t('Connection line (A)', 'Đường nối (A)')} active={tool === 'arrow'} onClick={() => useTool('arrow')} />
        <Btn id="pen" icon={I.pen} label={t('Pen', 'Bút')} active={['freedraw', 'eraser', 'laser'].includes(tool)} onClick={() => toggleMenu('pen')} />
        <Btn id="frame" icon={I.frame} label={t('Frame (F)', 'Khung (F)')} active={tool === 'frame'} onClick={() => useTool('frame')} />
        <Btn id="image" icon={I.image} label={t('Upload image', 'Tải ảnh lên')} onClick={() => fileInput.current?.click()} />
        <span className="mb-sep" />
        <Btn id="emoji" icon={I.emoji} label={t('Emoji', 'Emoji')} onClick={() => toggleMenu('emoji')} />
        <Btn id="stickers" icon={I.sticker} label={t('Stickers & stamps', 'Sticker & con dấu')} onClick={() => toggleMenu('stickers')} />
        <Btn id="comment" icon={I.comment} label={t('Comment (C)', 'Bình luận (C)')} active={commentMode} onClick={() => startCommentMode(!commentMode)} />
        <Btn id="vote" icon={I.vote} label={t('Vote', 'Bình chọn')} onClick={() => toggleMenu('vote')} />
        <Btn id="library" icon={I.library} label={t('Lighting symbols', 'Ký hiệu đèn')} onClick={openLibrary} />
        {aiOn && <Btn id="ai" icon={I.ai} label={t('Ask Stas about this board', 'Hỏi Stas về bảng này')} onClick={askAI} />}
      </nav>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPickImage(f);
          e.target.value = '';
        }}
      />

      {/* popovers */}
      {menu && (
        <div ref={popRef} className={`mb-pop mb-pop-${menu}`} role="dialog" style={{ top: anchorTop }}>
          {menu === 'notes' && (
            <>
              <p className="mb-pop-title">{t('Sticky notes', 'Note')}</p>
              <div className="mb-grid mb-notes">
                {NOTE_COLORS.map((c) => (
                  <button key={c.id} type="button" className="mb-note" style={{ background: c.fill, borderColor: c.edge }} onClick={() => addNote(c)} aria-label={c.id} />
                ))}
              </div>
            </>
          )}
          {menu === 'shapes' && (
            <div className="mb-row">
              {[
                ['rectangle', t('Rectangle (R)', 'Chữ nhật (R)'), 'M4 6h16v12H4z'],
                ['ellipse', t('Ellipse (O)', 'Elip (O)'), 'M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z'],
                ['diamond', t('Diamond (D)', 'Hình thoi (D)'), 'M12 3l9 9-9 9-9-9z'],
                ['line', t('Line (L)', 'Đường thẳng (L)'), 'M4 20L20 4'],
              ].map(([type, label, d]) => (
                <button key={type} type="button" className={`mb-btn${tool === type ? ' on' : ''}`} title={label} aria-label={label} onClick={() => useTool(type)}>
                  <Icon d={d} />
                </button>
              ))}
            </div>
          )}
          {menu === 'pen' && (
            <div className="mb-col">
              <button type="button" className="mb-item" onClick={() => useTool('freedraw', { currentItemStrokeColor: '#1e1e1e', currentItemStrokeWidth: 1, currentItemOpacity: 100 })}>
                ✏️ {t('Pen', 'Bút')}
              </button>
              <button type="button" className="mb-item" onClick={() => useTool('freedraw', { currentItemStrokeColor: '#e03131', currentItemStrokeWidth: 2, currentItemOpacity: 100 })}>
                🖍️ {t('Red marker', 'Bút đỏ')}
              </button>
              <button type="button" className="mb-item" onClick={() => useTool('freedraw', { currentItemStrokeColor: '#fab005', currentItemStrokeWidth: 4, currentItemOpacity: 40 })}>
                🖊️ {t('Highlighter', 'Bút dạ quang')}
              </button>
              <button type="button" className="mb-item" onClick={() => useTool('eraser')}>
                🧽 {t('Eraser (E)', 'Tẩy (E)')}
              </button>
              <button type="button" className="mb-item" onClick={() => useTool('laser')}>
                🔴 {t('Laser pointer (K)', 'Bút laser (K)')}
              </button>
            </div>
          )}
          {menu === 'emoji' && (
            <>
              <div className="mb-tabs" role="tablist">
                {EMOJI_GROUPS.map((g) => (
                  <button key={g.id} type="button" role="tab" aria-selected={emojiTab === g.id} className={emojiTab === g.id ? 'on' : ''} onClick={() => setEmojiTab(g.id)}>
                    {vi ? g.vi : g.en}
                  </button>
                ))}
              </div>
              <div className="mb-grid mb-emoji mb-emoji-text">
                {(EMOJI_GROUPS.find((g) => g.id === emojiTab)?.items ?? []).filter(Boolean).map((e, i) => (
                  <button key={`${e}${i}`} type="button" onClick={() => addEmoji(e)}>
                    {e}
                  </button>
                ))}
              </div>
            </>
          )}
          {menu === 'stickers' && (
            <>
              <input
                className="mb-search"
                type="search"
                value={stickerQuery}
                onChange={(e) => setStickerQuery(e.target.value)}
                placeholder={t('Search stickers: cat, cake, star…', 'Tìm sticker: cat, cake, star…')}
                aria-label={t('Search stickers', 'Tìm sticker')}
              />
              {!stickerQuery.trim() && (
                <div className="mb-tabs" role="tablist">
                  {[
                    ['mine', t('Mine', 'Của tôi')],
                    ['react', t('React', 'Phản ứng')],
                    ['faces', t('Faces', 'Mặt cười')],
                    ['animals', t('Animals', 'Con vật')],
                    ['hearts', t('Hearts', 'Tim')],
                    ['food', t('Food', 'Đồ ăn')],
                    ['party', t('Fun', 'Vui chơi')],
                    ['nature', t('Sky & nature', 'Trời & thiên nhiên')],
                    ['work', t('Work & home', 'Công việc & nhà')],
                    ['stamps', t('Stamps & colour', 'Con dấu & màu')],
                  ].map(([id, label]) => (
                    <button key={id} type="button" role="tab" aria-selected={stickerTab === id} className={stickerTab === id ? 'on' : ''} onClick={() => setStickerTab(id)}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {stickerQuery.trim() ? (
                (() => {
                  const q = stickerQuery.trim().toLowerCase();
                  const hits = (FLUENT as Array<{ id: string; name: string; cat: string; kw?: string[] }>).filter(
                    (x) => x.name.toLowerCase().includes(q) || x.kw?.some((k) => k.toLowerCase().startsWith(q))
                  );
                  const mineHits = (mine ?? []).filter((m) => m.name.toLowerCase().includes(q));
                  return hits.length || mineHits.length ? (
                    <div className="mb-grid mb-emoji">
                      {mineHits.map((m) => (
                        <button key={m.id} type="button" title={m.name} aria-label={m.name} onClick={() => placeMine(m)}>
                          <img src={mineUrls.get(m.id)} alt="" width="36" height="36" />
                        </button>
                      ))}
                      {hits.map((x) => (
                        <button key={x.id} type="button" title={x.name} aria-label={x.name} onClick={() => addSticker(x.id)}>
                          <img src={stickerUrl(x.id, true)} alt="" loading="lazy" width="36" height="36" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mb-empty">{t('No sticker matches. Try an English word, like “dog” or “sun”.', 'Không có sticker nào khớp. Thử một từ tiếng Anh, ví dụ “dog” hoặc “sun”.')}</p>
                  );
                })()
              ) : stickerTab === 'mine' ? (
                <>
                  <div className="mb-mine-actions">
                    <button type="button" className="mb-cta" onClick={() => mineInput.current?.click()}>
                      {t('+ Add your own', '+ Thêm sticker của bạn')}
                    </button>
                    <button type="button" className="mb-cta mb-cta-ghost" onClick={saveSelectionAsSticker}>
                      {t('Save selected image', 'Lưu ảnh đang chọn')}
                    </button>
                  </div>
                  <label className="mb-check">
                    <input type="checkbox" checked={clearBg} onChange={(e) => setClearBg(e.target.checked)} />
                    {t('Remove white background', 'Xoá nền trắng')}
                  </label>
                  <input ref={mineInput} type="file" accept="image/*" multiple hidden onChange={(e) => { uploadMine(e.target.files); e.target.value = ''; }} />
                  {mine && mine.length ? (
                    <div className="mb-grid mb-emoji">
                      {mine.map((m) => (
                        <span key={m.id} className="mb-mine">
                          <button type="button" title={m.name} aria-label={m.name} onClick={() => placeMine(m)}>
                            <img src={mineUrls.get(m.id)} alt="" width="36" height="36" />
                          </button>
                          <button type="button" className="mb-mine-x" title={t('Remove from My stickers', 'Bỏ khỏi Sticker của tôi')} aria-label={t('Remove', 'Bỏ')} onClick={() => deleteMine(m.id)}>
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mb-empty">
                      {t(
                        'Your own stickers live here: PNG, JPG, GIF or WebP. They stay in this browser and can be used on any board. Stickers already placed stay on the board even if you remove them here.',
                        'Sticker riêng của bạn nằm ở đây: PNG, JPG, GIF hoặc WebP. Chúng được lưu trong trình duyệt này và dùng được trên mọi bảng. Sticker đã đặt lên bảng vẫn giữ nguyên dù bạn bỏ chúng khỏi đây.'
                      )}
                    </p>
                  )}
                </>
              ) : stickerTab !== 'stamps' ? (
                <div className="mb-grid mb-emoji">
                  {(FLUENT as Array<{ id: string; name: string; cat: string }>)
                    .filter((x) => x.cat === stickerTab)
                    .map((x) => (
                      <button key={x.id} type="button" title={x.name} aria-label={x.name} onClick={() => addSticker(x.id)}>
                        <img src={stickerUrl(x.id, true)} alt="" loading="lazy" width="36" height="36" />
                      </button>
                    ))}
                </div>
              ) : (
                <>
                  <p className="mb-pop-title">{t('Stamps', 'Con dấu')}</p>
                  <div className="mb-stamps">
                    {STAMPS.map((st) => (
                      <button key={st.en} type="button" style={{ color: st.color, borderColor: st.color }} onClick={() => addStamp(st)}>
                        {vi ? st.vi : st.en}
                      </button>
                    ))}
                  </div>
                  <p className="mb-pop-title">{t('Colour temperature', 'Nhiệt độ màu')}</p>
                  <div className="mb-cct">
                    {CCT_SWATCHES.map((sw) => (
                      <button key={sw.label} type="button" style={{ background: sw.color }} onClick={() => addSwatch(sw)}>
                        {sw.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <p className="mb-credit">Fluent Emoji © Microsoft · MIT</p>
            </>
          )}
          {menu === 'vote' && (
            <div className="mb-col">
              <button type="button" className="mb-item" onClick={() => vote(1)}>
                ➕ {t('+1 on selection', '+1 cho mục đang chọn')}
              </button>
              <button type="button" className="mb-item" onClick={() => vote(-1)}>
                ➖ {t('−1 on selection', '−1 cho mục đang chọn')}
              </button>
              {voteTotals.length > 0 && (
                <>
                  <p className="mb-pop-title">{t('Results', 'Kết quả')}</p>
                  {voteTotals.map((v) => (
                    <div key={v.id} className="mb-tally">
                      <span>{v.label}</span>
                      <b>{v.count}</b>
                    </div>
                  ))}
                </>
              )}
              <button type="button" className="mb-item mb-danger" onClick={clearVotes}>
                {t('Clear all votes', 'Xoá toàn bộ vote')}
              </button>
            </div>
          )}
          {menu === 'templates' && (
            <div className="mb-col">
              {templates(vi).map((tp) => (
                <button key={tp.id} type="button" className="mb-item" onClick={() => addTemplate(tp.build)}>
                  {tp.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* comment thread of the selected pin */}
      {selectedComment && (
        <aside className="mb-panel mb-thread-pop" aria-label={t('Comment', 'Bình luận')} style={pinAnchor(selectedComment)}>
          <div className="mb-panel-head">
            <b>{t('Comment', 'Bình luận')}</b>
            <button type="button" onClick={() => api.updateScene({ appState: { selectedElementIds: {} } })} aria-label={t('Close', 'Đóng')}>
              ×
            </button>
          </div>
          <ul className="mb-thread">
            {thread.map((c, i) => (
              <li key={i}>
                <p className="mb-meta">
                  <b>{c.by}</b> · {new Date(c.at).toLocaleString(vi ? 'vi-VN' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                </p>
                <p>{c.text}</p>
              </li>
            ))}
          </ul>
          <form
            className="mb-reply"
            onSubmit={(e) => {
              e.preventDefault();
              const input = (e.currentTarget.elements.namedItem('reply') as HTMLInputElement);
              const text = input.value.trim();
              if (!text) return;
              updateComment(selectedComment.id, (cd) => ({ ...cd, thread: [...(cd.thread ?? []), { by: name, text, at: Date.now() }] }));
              input.value = '';
            }}
          >
            <input name="reply" placeholder={t('Reply…', 'Trả lời…')} autoComplete="off" />
            <button type="submit">{t('Send', 'Gửi')}</button>
          </form>
          <div className="mb-panel-foot">
            <button type="button" onClick={() => deleteElement(selectedComment.id)}>
              ✓ {t('Resolve', 'Đã xử lý')}
            </button>
            <label>
              {t('Name', 'Tên')}{' '}
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  store(() => localStorage.setItem(NAME_KEY, e.target.value), undefined);
                }}
              />
            </label>
          </div>
        </aside>
      )}

      {/* all comments */}
      {showComments && !selectedComment && (
        <aside className="mb-panel" aria-label={t('All comments', 'Tất cả bình luận')}>
          <div className="mb-panel-head">
            <b>{t('Comments', 'Bình luận')}</b>
            <button type="button" onClick={() => setShowComments(false)} aria-label={t('Close', 'Đóng')}>
              ×
            </button>
          </div>
          {comments.length === 0 ? (
            <p className="mb-empty">
              {t('No comments yet. Select something and press the comment tool.', 'Chưa có bình luận. Chọn một mục rồi bấm công cụ bình luận.')}
            </p>
          ) : (
            <ul className="mb-thread">
              {comments.map((c: any) => (
                <li key={c.id}>
                  <button type="button" className="mb-jump" onClick={() => jumpTo(c)}>
                    <p className="mb-meta">
                      <b>{c.customData.thread?.[0]?.by}</b> · {c.customData.thread?.length ?? 0} {t('message(s)', 'tin')}
                    </p>
                    <p>{c.customData.thread?.[0]?.text}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}

      {toast && <div className="mb-toast">{toast}</div>}
    </div>
  );
}
