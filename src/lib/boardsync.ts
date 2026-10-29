/*
 * Board sync client. Devices unlocked with the Stas access code share their
 * projects and boards through the Pastelux proxy (a Durable Object). Each
 * board stays in this browser first; sync only adds to it.
 */
import { get, set } from 'idb-keyval';
import { AI_PROXY_URL } from '../site';
import { readCode } from './ask';
import { allProjects, listProjects, mergeProjects, type Project } from './projects';

export const syncEnabled = () => Boolean(AI_PROXY_URL && readCode());

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
const seqKey = (pid: string) => `pastelux-sync-seq:${pid}`;
const pushedKey = (pid: string) => `pastelux-sync-pushed:${pid}`;
const UPLOADED_KEY = 'pastelux-sync-files';

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
  const done = new Set(((await get(UPLOADED_KEY).catch(() => null)) as string[] | null) ?? []);
  const todo = ids.filter((id) => !done.has(id) && files[id]?.dataURL);
  if (!todo.length) return;
  const { missing } = await call<{ missing: string[] }>('files-missing', { ids: todo });
  for (const id of missing) {
    const f = files[id];
    await call('file-put', { file: { id, mimeType: f.mimeType, created: f.created, dataURL: f.dataURL } });
  }
  todo.forEach((id) => done.add(id));
  await set(UPLOADED_KEY, [...done]).catch(() => {});
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
  const done = new Set(((await get(UPLOADED_KEY).catch(() => null)) as string[] | null) ?? []);
  got.forEach((f) => done.add(f.id));
  await set(UPLOADED_KEY, [...done]).catch(() => {});
  return got;
}
