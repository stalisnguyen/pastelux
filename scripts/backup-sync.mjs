#!/usr/bin/env node
/*
 * Read-only backup of the board sync store (the Pastelux Worker).
 *
 *   npm run backup                 → asks for the access code, saves to ~/Pastelux-backups
 *   npm run backup -- --label thy  → adds a name to the folder (one backup per code)
 *   npm run backup -- --out <dir>  → saves somewhere else
 *
 * Each access code has its own store, so run it once per code.
 *
 * It only READS. The script can call four server operations and all four
 * are reads: projects (sent without a list), pull, files-get, docs-pull.
 * Anything else is refused before it leaves this computer.
 *
 * The code is typed at a hidden prompt (never an argument, so it stays out
 * of the shell history) and is not written anywhere. Backups go outside the
 * repository by default, because the repository is public.
 *
 * What a backup folder holds:
 *   projects.json              the project list (including hidden ones)
 *   boards/<project>.json      every element of that board, with deleted ones
 *   boards/<project>.excalidraw  the live board + its images, opens in Excalidraw
 *   files/<id>.<ext>           every image the boards use
 *   docs/<kind>.json           library, My stickers, fixture schedules
 *   manifest.json              counts and anything that could not be fetched
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const DEFAULT_URL = 'https://pastelux-ai.minhnguyen94-reve.workers.dev';
const ORIGIN = 'https://pasteluxvn.com';
const READ_OPS = new Set(['projects', 'pull', 'files-get', 'docs-pull']);
const DOC_KINDS = ['library', 'stickers', 'schedule'];

// ------------------------------------------------------------ arguments
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const url = (arg('url') || DEFAULT_URL).replace(/\/$/, '');
const label = (arg('label') || '').replace(/[^\w-]/g, '').slice(0, 30);
const outRoot = resolve(arg('out') || join(homedir(), 'Pastelux-backups'));
// a local test server needs its own origin
const origin = url.startsWith('http://localhost') ? arg('origin') || 'http://localhost:4550' : ORIGIN;

// ------------------------------------------------------------ hidden prompt
function askHidden(question) {
  return new Promise((done) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    if (!stdin.isTTY) {
      // piped input (tests): read the first line
      let buf = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (c) => (buf += c));
      stdin.on('end', () => done(buf.split('\n')[0].trim()));
      return;
    }
    let s = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          return done(s.trim());
        }
        if (c === '\u0003') {
          process.stdout.write('\n');
          process.exit(130);
        }
        if (c === '\u007f' || c === '\b') s = s.slice(0, -1);
        else s += c;
      }
    };
    stdin.on('data', onData);
  });
}

// ------------------------------------------------------------ server calls
let code = '';
async function call(op, body = {}) {
  if (!READ_OPS.has(op)) throw new Error(`refused: "${op}" is not a read`);
  if (op === 'projects' && 'projects' in body) throw new Error('refused: projects must be sent without a list');
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${url}/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, 'x-pastelux-code': code },
      body: JSON.stringify({ op, ...body }),
    }).catch((e) => ({ ok: false, status: 0, e }));
    if (res.ok) return res.json();
    if (res.status === 401) throw new Error('Wrong access code (401). Nothing was saved.');
    if (res.status === 403) throw new Error(`The server refused this origin (403).`);
    if (attempt >= 4) throw new Error(`${op} failed (${res.status || res.e}) after ${attempt} tries`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

async function pullAll(project) {
  const out = [];
  let since = 0;
  for (;;) {
    const r = await call('pull', { project, since });
    out.push(...r.elements);
    if (!r.more || r.seq === since) return out;
    since = r.seq;
  }
}
async function docsAll(kind) {
  const out = [];
  let since = 0;
  for (;;) {
    const r = await call('docs-pull', { kind, since });
    out.push(...r.items);
    if (!r.more || r.seq === since) return out;
    since = r.seq;
  }
}
async function filesAll(ids) {
  const got = [];
  let rest = ids;
  while (rest.length) {
    const r = await call('files-get', { ids: rest.slice(0, 500) });
    got.push(...r.files);
    // r.rest = ones that did not fit this answer; ids the server lacks are dropped
    rest = [...r.rest, ...rest.slice(500)];
  }
  return got;
}

/** Every fileId mentioned anywhere inside a value (elements, library items). */
function collectFileIds(value, into) {
  if (Array.isArray(value)) value.forEach((v) => collectFileIds(v, into));
  else if (value && typeof value === 'object') {
    if (typeof value.fileId === 'string') into.add(value.fileId);
    Object.values(value).forEach((v) => collectFileIds(v, into));
  }
  return into;
}

// keeps Vietnamese letters, drops what file systems dislike
const safeName = (s) => String(s).normalize('NFC').replace(/[^\p{L}\p{N}._ -]+/gu, '_').trim().slice(0, 60) || 'project';
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };

// ------------------------------------------------------------ run
async function main() {
  console.log(`Pastelux backup (read-only) from ${url}`);
  code = await askHidden('Access code (hidden): ');
  if (!code) throw new Error('No code entered. Nothing was saved.');

  const { projects } = await call('projects');
  console.log(`  ${projects.length} project(s)`);

  const boards = [];
  for (const p of projects) {
    const elements = await pullAll(p.id);
    boards.push({ project: p, elements });
    console.log(`  · ${p.name}${p.deleted ? ' (hidden)' : ''}: ${elements.length} element(s)`);
  }

  const docs = {};
  for (const kind of DOC_KINDS) {
    docs[kind] = await docsAll(kind);
    console.log(`  · ${kind}: ${docs[kind].length} item(s)`);
  }

  const wanted = collectFileIds(boards.map((b) => b.elements), new Set());
  collectFileIds(docs.library, wanted);
  const files = await filesAll([...wanted]);
  const missing = [...wanted].filter((id) => !files.some((f) => f.id === id));
  console.log(`  · images: ${files.length} of ${wanted.size}${missing.length ? ` (${missing.length} not on the server)` : ''}`);

  // write only after everything was read, so a failed run leaves no half backup
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
  const dir = join(outRoot, `${stamp}${label ? `-${label}` : ''}`);
  mkdirSync(join(dir, 'boards'), { recursive: true });
  mkdirSync(join(dir, 'files'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });
  const json = (path, v) => writeFileSync(join(dir, path), JSON.stringify(v, null, 1));

  json('projects.json', projects);
  const used = new Set();
  for (const { project, elements } of boards) {
    let name = safeName(project.name);
    while (used.has(name)) name += `_${project.id.slice(0, 6)}`;
    used.add(name);
    json(`boards/${name}.json`, { project, elements });
    const live = elements.filter((e) => !e.isDeleted);
    const ids = collectFileIds(live, new Set());
    json(`boards/${name}.excalidraw`, {
      type: 'excalidraw',
      version: 2,
      source: 'pastelux-backup',
      elements: live,
      appState: { viewBackgroundColor: '#ffffff' },
      files: Object.fromEntries(files.filter((f) => ids.has(f.id)).map((f) => [f.id, f])),
    });
  }
  for (const f of files) {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(f.dataURL || '');
    if (m) writeFileSync(join(dir, 'files', `${safeName(f.id)}.${EXT[m[1]] || 'bin'}`), Buffer.from(m[2], 'base64'));
  }
  for (const kind of DOC_KINDS) json(`docs/${kind}.json`, docs[kind]);
  json('manifest.json', {
    savedAt: new Date().toISOString(),
    server: url,
    projects: boards.map((b) => ({ id: b.project.id, name: b.project.name, hidden: b.project.deleted, elements: b.elements.length, live: b.elements.filter((e) => !e.isDeleted).length })),
    docs: Object.fromEntries(DOC_KINDS.map((k) => [k, docs[k].length])),
    images: { saved: files.length, missingOnServer: missing },
  });
  console.log(`\nSaved to ${dir}`);
}

main().catch((e) => {
  console.error(`\nBackup failed: ${e.message}`);
  process.exit(1);
});
