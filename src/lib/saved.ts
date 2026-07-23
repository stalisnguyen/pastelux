/**
 * Bookmarks live entirely in localStorage — no account, no backend, no tracking.
 * They are per-browser by design; that is the trade-off for a fully static site.
 */
export interface SavedItem {
  id: string;
  title: string;
  href: string;
  source: string;
  kind: string;
  savedAt: string;
}

const KEY = 'pastelux-saved';

export function readSaved(): SavedItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedItem[]) : [];
  } catch {
    return [];
  }
}

function write(items: SavedItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* quota or private mode — fail quietly, the page still works */
  }
}

export function isSaved(id: string): boolean {
  return readSaved().some((i) => i.id === id);
}

export function toggleSaved(item: SavedItem): boolean {
  const items = readSaved();
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx >= 0) {
    items.splice(idx, 1);
    write(items);
    return false;
  }
  items.unshift(item);
  write(items);
  return true;
}

export function removeSaved(id: string) {
  write(readSaved().filter((i) => i.id !== id));
}
