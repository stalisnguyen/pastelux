import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { get, set } from 'idb-keyval';
import { lightingLibrary } from './library';

/*
 * A free-form board (Miro-style) for sketching, moodboards and quick ceiling
 * plans. Everything stays in this browser (IndexedDB) — nothing is uploaded.
 * Excalidraw's own menu handles open/save as a file and PNG/SVG export.
 */

const SCENE_KEY = 'pastelux-board';
const GRID_KEY = 'pastelux-board-grid';

type Saved = { elements: any[]; appState: Record<string, unknown>; files: Record<string, any> };

const readTheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
const readLang = () => (document.documentElement.classList.contains('lang-vi') ? 'vi' : 'en');

export default function BoardApp() {
  const [theme, setTheme] = useState<'light' | 'dark'>(readTheme);
  const [lang, setLang] = useState<'vi' | 'en'>(readLang);
  const [grid, setGrid] = useState<boolean>(() => {
    try {
      return localStorage.getItem(GRID_KEY) === '1';
    } catch {
      return false;
    }
  });
  const saveTimer = useRef<number | undefined>(undefined);

  // follow the site's theme toggle and EN / VI switch
  useEffect(() => {
    // Excalidraw writes its own language to <html lang>; the site owns it.
    // (Its Vietnamese translation is too incomplete for Excalidraw to offer,
    // so the editor UI itself stays English.)
    const restoreLang = () => {
      const want = readLang();
      if (document.documentElement.lang !== want) document.documentElement.lang = want;
    };
    const t = window.setTimeout(restoreLang, 0);
    const langMo = new MutationObserver(restoreLang);
    langMo.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    const mo = new MutationObserver(() => {
      setTheme(readTheme());
      setLang(readLang());
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    return () => {
      window.clearTimeout(t);
      langMo.disconnect();
      mo.disconnect();
    };
  }, []);

  const toggleGrid = useCallback(() => {
    setGrid((g) => {
      try {
        localStorage.setItem(GRID_KEY, g ? '0' : '1');
      } catch {}
      return !g;
    });
  }, []);

  const initialData = useMemo(
    () => async () => {
      const libraryItems = lightingLibrary(convertToExcalidrawElements);
      let saved: Saved | undefined;
      try {
        saved = await get<Saved>(SCENE_KEY);
      } catch {}
      return {
        elements: saved?.elements ?? [],
        appState: { ...(saved?.appState ?? {}), collaborators: new Map() },
        files: saved?.files ?? {},
        libraryItems,
        scrollToContent: Boolean(saved?.elements?.length),
      };
    },
    []
  );

  const onChange = useCallback((elements: readonly any[], appState: any, files: any) => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      // keep only what defines the drawing and the view, not transient UI state
      const keep: Saved = {
        elements: elements.filter((e) => !e.isDeleted),
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor,
          currentItemStrokeColor: appState.currentItemStrokeColor,
          currentItemBackgroundColor: appState.currentItemBackgroundColor,
          currentItemFontFamily: appState.currentItemFontFamily,
          scrollX: appState.scrollX,
          scrollY: appState.scrollY,
          zoom: appState.zoom,
        },
        files,
      };
      set(SCENE_KEY, keep).catch(() => {});
    }, 400);
  }, []);

  const vi = lang === 'vi';

  return (
    <div className="board-shell">
      <Excalidraw
        initialData={initialData}
        onChange={onChange}
        theme={theme}
        langCode="en"
        gridModeEnabled={grid}
        name="Pastelux board"
        UIOptions={{ canvasActions: { toggleTheme: false } }}
        renderTopRightUI={() => (
          <button
            type="button"
            className={`board-grid-btn${grid ? ' on' : ''}`}
            onClick={toggleGrid}
            aria-pressed={grid}
            title={vi ? 'Bật / tắt ô lưới' : 'Show / hide grid'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
            <span>{vi ? (grid ? 'Có lưới' : 'Giấy trơn') : grid ? 'Grid' : 'Plain'}</span>
          </button>
        )}
      />
    </div>
  );
}
