/*
 * Board sync client. Devices unlocked with the same Stas access code share
 * their projects and boards through the Pastelux proxy (a Durable Object);
 * a different code has its own, separate store. Each
 * board stays in this browser first; sync only adds to it.
 */
import { get, set } from 'idb-keyval';
import { AI_PROXY_URL } from '../site';
import { readCode } from './ask';
import { allProjects, listProjects, mergeProjects, type Project } from './projects';
import { loadSchedule, saveSchedule, type Schedule } from './schedule';

export const syncEnabled = () => Boolean(AI_PROXY_URL && readCode());

/**
 * Each access code has its own store on the server, so this device keeps
 * its sync bookkeeping (what it has sent and seen) per code. A short hash
 * is enough: it only tells codes apart, and the code itself is already in
 * this browser.
 */
export function syncOwner() {
  let h = 0x811c9dc5;
  for (const ch of readCode()) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return (h >>> 0).toString(36);
}

export class SyncError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(op: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${AI_PROXY_URL}/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pastelux-code': readCode() },
    body: JSON.stringify({ op, ...body }),
  });
  if (!res.ok) throw new SyncError(res.status, `sync ${op} ${res.status}`);
  return res.json() as Promise<T>;
}

/** Sends this device's project list and takes in the server's. */
export async function syncProjects(): Promise<Project[]> {
  const local = allProjects();
  const { projects } = await call<{ projects: (Project & { deleted?: boolean })[] }>('projects', { projects: local });
  mergeProjects(projects);
  return listProjects();
}

// ------------------------------------------------------------ per board state
const seqKey = (pid: string) => `pastelux-sync-seq:${syncOwner()}:${pid}`;
const pushedKey = (pid: string) => `pastelux-sync-pushed:${syncOwner()}:${pid}`;
const uploadedKey = () => `pastelux-sync-files:${syncOwner()}`;

export function readSeq(pid: string) {
  try {
    return Number(localStorage.getItem(seqKey(pid)) || 0);
  } catch {
    return 0;
  }
}
export function writeSeq(pid: string, seq: number) {
  try {
    localStorage.setItem(seqKey(pid), String(seq));
  } catch {}
}
export async function readPushed(pid: string): Promise<Map<string, number>> {
  const raw = ((await get(pushedKey(pid)).catch(() => null)) as Record<string, number> | null) ?? {};
  return new Map(Object.entries(raw));
}
export async function writePushed(pid: string, m: Map<string, number>) {
  await set(pushedKey(pid), Object.fromEntries(m)).catch(() => {});
}

export async function pullElements(pid: string, since: number) {
  const out: any[] = [];
  let seq = since;
  for (let i = 0; i < 20; i++) {
    const r = await call<{ elements: any[]; seq: number; more: boolean }>('pull', { project: pid, since: seq });
    out.push(...r.elements);
    seq = r.seq;
    if (!r.more) break;
  }
  return { elements: out, seq };
}

export async function pushElements(pid: string, elements: any[]) {
  for (let i = 0; i < elements.length; i += 1000) await call('push', { project: pid, elements: elements.slice(i, i + 1000) });
}

/** Uploads the images the server does not have yet (each image only once). */
export async function pushFiles(files: Record<string, any>, ids: string[]) {
  const done = new Set(((await get(uploadedKey()).catch(() => null)) as string[] | null) ?? []);
  const todo = ids.filter((id) => !done.has(id) && files[id]?.dataURL);
  if (!todo.length) return;
  const { missing } = await call<{ missing: string[] }>('files-missing', { ids: todo });
  for (const id of missing) {
    const f = files[id];
    await call('file-put', { file: { id, mimeType: f.mimeType, created: f.created, dataURL: f.dataURL } });
  }
  todo.forEach((id) => done.add(id));
  await set(uploadedKey(), [...done]).catch(() => {});
}

export async function pullFiles(ids: string[]) {
  const got: any[] = [];
  let rest = ids;
  for (let i = 0; i < 30 && rest.length; i++) {
    const r = await call<{ files: any[]; rest: string[] }>('files-get', { ids: rest });
    got.push(...r.files);
    if (!r.files.length) break;
    rest = r.rest;
  }
  // what came from the server is on the server: no need to upload it again
  const done = new Set(((await get(uploadedKey()).catch(() => null)) as string[] | null) ?? []);
  got.forEach((f) => done.add(f.id));
  await set(uploadedKey(), [...done]).catch(() => {});
  return got;
}

// ------------------------------------------------------------ shared lists
// The Excalidraw library and My stickers: one list each, shared by every
// unlocked device. `known` is what this device last agreed with the server,
// so an item missing locally but known was deleted here.
export type DocKind = 'library' | 'stickers' | 'schedule';
const docSeqKey = (k: DocKind) => `pastelux-sync-${k}-seq:${syncOwner()}`;
const docKnownKey = (k: DocKind) => `pastelux-sync-${k}-known:${syncOwner()}`;

export async function pullDocs(kind: DocKind) {
  let since = Number(store(() => localStorage.getItem(docSeqKey(kind)), '0') || 0);
  const items: { id: string; deleted: boolean; data: any }[] = [];
  for (let i = 0; i < 20; i++) {
    const r = await call<{ items: typeof items; seq: number; more: boolean }>('docs-pull', { kind, since });
    items.push(...r.items);
    since = r.seq;
    if (!r.more) break;
  }
  return { items, seq: since };
}
export const saveDocSeq = (kind: DocKind, seq: number) => store(() => localStorage.setItem(docSeqKey(kind), String(seq)), undefined);
export async function readKnown(kind: DocKind) {
  return new Set(((await get(docKnownKey(kind)).catch(() => null)) as string[] | null) ?? []);
}
export async function writeKnown(kind: DocKind, ids: Iterable<string>) {
  await set(docKnownKey(kind), [...ids]).catch(() => {});
}
export async function pushDocs(kind: DocKind, items: { id: string; deleted?: boolean; data?: any }[]) {
  for (let i = 0; i < items.length; i += 200) await call('docs-push', { kind, items: items.slice(i, i + 200) });
}

/**
 * One round for a shared list: take in the server's changes, then send
 * this device's additions and deletions. Returns the new list, or null
 * when nothing changed locally.
 */
export async function syncList<T extends { id: string }>(kind: DocKind, local: T[], toData: (x: T) => Promise<any> | any, fromData: (id: string, d: any) => Promise<T | null> | T | null) {
  const known = await readKnown(kind);
  const { items: remote, seq } = await pullDocs(kind);
  let list = [...local];
  let changed = false;
  for (const r of remote) {
    const i = list.findIndex((x) => x.id === r.id);
    if (r.deleted) {
      known.delete(r.id);
      if (i >= 0) {
        list.splice(i, 1);
        changed = true;
      }
    } else {
      known.add(r.id);
      if (i < 0) {
        const item = await fromData(r.id, r.data);
        if (item) {
          list.push(item);
          changed = true;
        }
      }
    }
  }
  const ids = new Set(list.map((x) => x.id));
  const out: { id: string; deleted?: boolean; data?: any }[] = [];
  for (const x of list) if (!known.has(x.id)) out.push({ id: x.id, data: await toData(x) });
  for (const id of known) if (!ids.has(id)) out.push({ id, deleted: true });
  if (out.length) await pushDocs(kind, out);
  saveDocSeq(kind, seq);
  await writeKnown(kind, ids);
  return changed ? list : null;
}

/**
 * Fixture schedules: one document per project. The copy edited last wins
 * (schedules are small and usually edited on one device at a time).
 */
const schedPushedKey = () => `pastelux-sync-schedule-pushed:${syncOwner()}`;
export async function syncSchedules() {
  const { items, seq } = await pullDocs('schedule');
  for (const it of items) {
    if (it.deleted || !it.data || !Array.isArray(it.data.fixtures)) continue;
    const local = loadSchedule(it.id);
    if ((Number(it.data.updatedAt) || 0) > (local.updatedAt || 0)) saveSchedule(it.data as Schedule, it.id, Number(it.data.updatedAt));
  }
  const pushed: Record<string, number> = store(() => JSON.parse(localStorage.getItem(schedPushedKey()) || '{}'), {});
  // what just came in counts as already on the server
  for (const it of items) if (!it.deleted && it.data) pushed[it.id] = Math.max(pushed[it.id] || 0, Number(it.data.updatedAt) || 0);
  const out: { id: string; data: Schedule }[] = [];
  for (const p of allProjects()) {
    const s = loadSchedule(p.id);
    if (s.updatedAt && s.updatedAt > (pushed[p.id] || 0)) {
      out.push({ id: p.id, data: s });
      pushed[p.id] = s.updatedAt;
    }
  }
  if (out.length) await pushDocs('schedule', out);
  store(() => localStorage.setItem(schedPushedKey(), JSON.stringify(pushed)), undefined);
  saveDocSeq('schedule', seq);
}

const store = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};
