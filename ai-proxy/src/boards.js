/*
 * Board sync store: one SQLite-backed Durable Object holding every project,
 * every board element (with its Excalidraw version) and every image.
 *
 * Merging is per element: the copy with the higher version wins, and on a
 * tie the lower versionNonce wins (Excalidraw's own rule), so two devices
 * editing different things never overwrite each other. Deleted elements are
 * kept as tombstones so a delete reaches every device.
 */
import { DurableObject } from 'cloudflare:workers';

const CHUNK = 900_000; // SQLite values stay well under the 2 MB row limit
const PULL_LIMIT = 1500;
const FILES_RESPONSE_BYTES = 6_000_000;
const DOC_KINDS = new Set(['library', 'stickers']);

export class BoardStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, updated INTEGER, deleted INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS elements (project TEXT, id TEXT, version INTEGER, nonce INTEGER, seq INTEGER, data TEXT, PRIMARY KEY (project, id));
      CREATE INDEX IF NOT EXISTS elements_seq ON elements (project, seq);
      CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, mime TEXT, created INTEGER, chunks INTEGER, size INTEGER);
      CREATE TABLE IF NOT EXISTS file_chunks (id TEXT, n INTEGER, data TEXT, PRIMARY KEY (id, n));
      CREATE TABLE IF NOT EXISTS docs (kind TEXT, id TEXT, seq INTEGER, deleted INTEGER, data TEXT, PRIMARY KEY (kind, id));
      CREATE INDEX IF NOT EXISTS docs_seq ON docs (kind, seq);
    `);
  }

  nextSeq() {
    const row = this.sql.exec(`INSERT INTO meta (k, v) VALUES ('seq', 1) ON CONFLICT(k) DO UPDATE SET v = v + 1 RETURNING v`).one();
    return row.v;
  }

  async fetch(req) {
    let body;
    try {
      body = await req.json();
    } catch {
      return reply(400, { error: 'Invalid JSON' });
    }
    const op = body.op;
    if (op === 'projects') return reply(200, this.projects(body.projects));
    if (op === 'pull') return reply(200, this.pull(String(body.project || ''), Number(body.since) || 0));
    if (op === 'push') return reply(200, this.push(String(body.project || ''), body.elements));
    if (op === 'files-missing') return reply(200, this.filesMissing(body.ids));
    if (op === 'file-put') return reply(200, this.filePut(body.file));
    if (op === 'files-get') return reply(200, this.filesGet(body.ids));
    if (op === 'docs-pull') return reply(200, this.docsPull(String(body.kind || ''), Number(body.since) || 0));
    if (op === 'docs-push') return reply(200, this.docsPush(String(body.kind || ''), body.items));
    return reply(400, { error: 'Unknown op' });
  }

  projects(incoming) {
    if (Array.isArray(incoming)) {
      for (const p of incoming.slice(0, 200)) {
        if (!p || typeof p.id !== 'string' || !p.id) continue;
        const updated = Number(p.updatedAt) || 0;
        this.sql.exec(
          `INSERT INTO projects (id, name, updated, deleted) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated = excluded.updated, deleted = excluded.deleted
           WHERE excluded.updated > projects.updated`,
          p.id.slice(0, 64),
          String(p.name || 'Untitled').slice(0, 120),
          updated,
          p.deleted ? 1 : 0
        );
      }
    }
    const projects = this.sql.exec(`SELECT id, name, updated AS updatedAt, deleted FROM projects`).toArray().map((p) => ({ ...p, deleted: Boolean(p.deleted) }));
    return { projects };
  }

  pull(project, since) {
    const rows = this.sql
      .exec(`SELECT seq, data FROM elements WHERE project = ? AND seq > ? ORDER BY seq LIMIT ?`, project, since, PULL_LIMIT)
      .toArray();
    const seq = rows.length ? rows[rows.length - 1].seq : since;
    return { elements: rows.map((r) => JSON.parse(r.data)), seq, more: rows.length === PULL_LIMIT };
  }

  push(project, elements) {
    if (!project || !Array.isArray(elements)) return { accepted: 0 };
    let accepted = 0;
    this.ctx.storage.transactionSync(() => {
      for (const el of elements.slice(0, 5000)) {
        if (!el || typeof el.id !== 'string' || typeof el.version !== 'number') continue;
        const cur = this.sql.exec(`SELECT version, nonce FROM elements WHERE project = ? AND id = ?`, project, el.id).toArray()[0];
        const nonce = Number(el.versionNonce) || 0;
        if (cur && (cur.version > el.version || (cur.version === el.version && cur.nonce <= nonce))) continue;
        this.sql.exec(
          `INSERT OR REPLACE INTO elements (project, id, version, nonce, seq, data) VALUES (?, ?, ?, ?, ?, ?)`,
          project,
          el.id,
          el.version,
          nonce,
          this.nextSeq(),
          JSON.stringify(el)
        );
        accepted++;
      }
    });
    return { accepted };
  }

  // Shared lists that are not boards (the Excalidraw library, My stickers):
  // one row per item, the latest write wins, deletes kept as tombstones.
  docsPull(kind, since) {
    if (!DOC_KINDS.has(kind)) return { items: [], seq: since };
    const rows = this.sql.exec(`SELECT id, seq, deleted, data FROM docs WHERE kind = ? AND seq > ? ORDER BY seq LIMIT 500`, kind, since).toArray();
    return {
      items: rows.map((r) => ({ id: r.id, deleted: Boolean(r.deleted), data: r.deleted ? null : JSON.parse(r.data) })),
      seq: rows.length ? rows[rows.length - 1].seq : since,
      more: rows.length === 500,
    };
  }

  docsPush(kind, items) {
    if (!DOC_KINDS.has(kind) || !Array.isArray(items)) return { accepted: 0 };
    let accepted = 0;
    this.ctx.storage.transactionSync(() => {
      for (const it of items.slice(0, 2000)) {
        if (!it || typeof it.id !== 'string' || !it.id) continue;
        this.sql.exec(
          `INSERT OR REPLACE INTO docs (kind, id, seq, deleted, data) VALUES (?, ?, ?, ?, ?)`,
          kind,
          it.id.slice(0, 128),
          this.nextSeq(),
          it.deleted ? 1 : 0,
          it.deleted ? null : JSON.stringify(it.data ?? null)
        );
        accepted++;
      }
    });
    return { accepted };
  }

  filesMissing(ids) {
    if (!Array.isArray(ids)) return { missing: [] };
    const missing = [];
    for (const id of ids.slice(0, 500)) {
      if (typeof id !== 'string') continue;
      if (!this.sql.exec(`SELECT 1 FROM files WHERE id = ?`, id).toArray().length) missing.push(id);
    }
    return { missing };
  }

  filePut(file) {
    if (!file || typeof file.id !== 'string' || typeof file.dataURL !== 'string') return { ok: false };
    if (this.sql.exec(`SELECT 1 FROM files WHERE id = ?`, file.id).toArray().length) return { ok: true };
    const d = file.dataURL;
    const chunks = Math.ceil(d.length / CHUNK) || 1;
    this.ctx.storage.transactionSync(() => {
      for (let n = 0; n < chunks; n++) this.sql.exec(`INSERT OR REPLACE INTO file_chunks (id, n, data) VALUES (?, ?, ?)`, file.id, n, d.slice(n * CHUNK, (n + 1) * CHUNK));
      this.sql.exec(`INSERT INTO files (id, mime, created, chunks, size) VALUES (?, ?, ?, ?, ?)`, file.id, String(file.mimeType || 'image/png'), Number(file.created) || Date.now(), chunks, d.length);
    });
    return { ok: true };
  }

  filesGet(ids) {
    if (!Array.isArray(ids)) return { files: [], rest: [] };
    const files = [];
    const rest = [];
    let bytes = 0;
    for (const id of ids.slice(0, 500)) {
      if (typeof id !== 'string') continue;
      const meta = this.sql.exec(`SELECT mime, created, size FROM files WHERE id = ?`, id).toArray()[0];
      if (!meta) continue;
      if (files.length && bytes + meta.size > FILES_RESPONSE_BYTES) {
        rest.push(id);
        continue;
      }
      const parts = this.sql.exec(`SELECT data FROM file_chunks WHERE id = ? ORDER BY n`, id).toArray();
      files.push({ id, mimeType: meta.mime, created: meta.created, dataURL: parts.map((p) => p.data).join('') });
      bytes += meta.size;
    }
    return { files, rest };
  }
}

const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
