#!/usr/bin/env node
/**
 * Fills the Vietnamese layer (viTitle / viSummary) on digest items that do
 * not have it yet — the backfill for digests written before the summariser
 * produced Vietnamese, and a safety net for any day it came back without.
 *
 * Idempotent: a file whose items are all translated is never sent to the
 * API, so in steady state this costs nothing.
 *
 *   node scripts/translate-digests.mjs            # every file still missing VI
 *   node scripts/translate-digests.mjs --limit 5  # at most 5 files this run
 *   node scripts/translate-digests.mjs --dry      # list what would be sent
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'src/content/daily');
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const LIMIT = Number(args[args.indexOf('--limit') + 1]) || Infinity;
const log = (m) => console.log(`[vi] ${m}`);

const SYSTEM_PROMPT = `You translate the daily news digest of Pastelux, a reference site for architectural lighting designers, into Vietnamese for a Vietnamese lighting designer.

For each item you receive a headline and (when present) an English summary. Return:
- "viTitle": the headline in natural Vietnamese.
- "viSummary": the summary in natural, concise Vietnamese — not word-for-word. Empty string if the English summary is empty.

Keep product names, brand names, organisations, standards and industry terms (lux, UGR, CRI, DALI, LED, beam angle…) in English. Established Vietnamese terms: illuminance = độ rọi, luminance = độ chói, luminous flux = quang thông, glare = chói, colour temperature = nhiệt độ màu, colour rendering = độ hoàn màu, luminaire = bộ đèn, facade = mặt dựng, controls = điều khiển. No hype, no exclamation marks.

Return ONLY a JSON array, one object per input item, in the same order, each with keys id, viTitle, viSummary. No prose, no markdown fences.`;

const needsVi = (it) => !it.viTitle || (it.summary && !it.viSummary);

async function translate(items) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: JSON.stringify(items.map((it, id) => ({ id, title: it.title, summary: it.summary ?? '' })), null, 1),
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const text = (body.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '');
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('translator did not return an array');
  return new Map(parsed.map((o) => [Number(o.id), o]));
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY && !DRY) {
    log('ANTHROPIC_API_KEY not set — nothing to do');
    return;
  }
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort().reverse();
  let done = 0;
  for (const f of files) {
    if (done >= LIMIT) break;
    const path = join(DIR, f);
    const day = JSON.parse(await readFile(path, 'utf8'));
    const items = day.items ?? [];
    if (!items.some(needsVi)) continue;
    done++;
    if (DRY) {
      log(`${f}: ${items.filter(needsVi).length}/${items.length} items need Vietnamese`);
      continue;
    }
    try {
      const out = await translate(items);
      day.items = items.map((it, i) => {
        const t = out.get(i);
        return {
          ...it,
          viTitle: it.viTitle || t?.viTitle?.trim() || '',
          viSummary: it.viSummary || (it.summary ? t?.viSummary?.trim() || '' : ''),
        };
      });
      await writeFile(path, JSON.stringify(day, null, 2) + '\n', 'utf8');
      log(`${f}: translated ${items.length} items`);
    } catch (err) {
      // One bad day must not stop the rest; it is retried on the next run.
      log(`${f}: failed (${err.message})`);
    }
  }
  log(`${done} file(s) ${DRY ? 'pending' : 'processed'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
