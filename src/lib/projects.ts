/*
 * Projects: each has its own board and fixture schedule. The list and the
 * current project live in localStorage; board scenes live in IndexedDB.
 * Sync (when Stas is unlocked on this device) is in lib/sync.ts.
 */

export type Project = { id: string; name: string; updatedAt: number };

const LIST = 'pastelux-projects';
const CURRENT = 'pastelux-project';
export const DEFAULT_ID = 'default';

const read = <T>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

export function listProjects(): Project[] {
  const list = read<Project[]>(LIST, []);
  if (!list.length) {
    const first = { id: DEFAULT_ID, name: 'My first project', updatedAt: Date.now() };
    write(LIST, [first]);
    return [first];
  }
  return list;
}

export function currentProjectId(): string {
  const id = (() => {
    try {
      return localStorage.getItem(CURRENT) || DEFAULT_ID;
    } catch {
      return DEFAULT_ID;
    }
  })();
  return listProjects().some((p) => p.id === id) ? id : listProjects()[0].id;
}

export function setCurrentProject(id: string) {
  try {
    localStorage.setItem(CURRENT, id);
  } catch {}
  window.dispatchEvent(new CustomEvent('pastelux:project', { detail: id }));
}

export function createProject(name: string): Project {
  const p = { id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.trim() || 'Untitled', updatedAt: Date.now() };
  write(LIST, [...listProjects(), p]);
  return p;
}

export function renameProject(id: string, name: string) {
  write(LIST, listProjects().map((p) => (p.id === id ? { ...p, name: name.trim() || p.name, updatedAt: Date.now() } : p)));
}

export function touchProject(id: string, at = Date.now()) {
  write(LIST, listProjects().map((p) => (p.id === id ? { ...p, updatedAt: at } : p)));
}

/** Replace the local list (used by sync when the server knows more projects). */
export function mergeProjects(remote: Project[]) {
  const local = listProjects();
  const byId = new Map(local.map((p) => [p.id, p]));
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l || r.updatedAt > l.updatedAt) byId.set(r.id, { ...l, ...r });
  }
  write(LIST, [...byId.values()]);
}

export function deleteProject(id: string) {
  const rest = listProjects().filter((p) => p.id !== id);
  write(LIST, rest.length ? rest : [{ id: DEFAULT_ID, name: 'My first project', updatedAt: Date.now() }]);
  if (currentProjectId() === id) setCurrentProject(listProjects()[0].id);
}

/** Storage keys of one project's board. The default project keeps the
 *  original keys so boards saved before projects existed carry over. */
export const boardKeys = (id: string) =>
  id === DEFAULT_ID
    ? { scene: 'pastelux-board', files: 'pastelux-board-files' }
    : { scene: `pastelux-board:${id}`, files: `pastelux-board-files:${id}` };
