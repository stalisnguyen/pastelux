#!/usr/bin/env node
/**
 * Builds one day's digest: src/content/daily/YYYY-MM-DD.json
 *
 *   node scripts/fetch-news.mjs [--date 2026-07-23] [--dry] [--no-ai]
 *
 * Only the headline, the publisher, the link and a summary written here are
 * stored. Source article text is never copied into the repository.
 *
 * Set ANTHROPIC_API_KEY to get written summaries and topic tags. Without it the
 * script still succeeds, marks the day `degraded: true`, and falls back to
 * keyword-based tagging with no summaries.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'src/content/daily');

const MODEL = process.env.PASTELUX_MODEL ?? 'claude-sonnet-5';
const MAX_ITEMS = Number(process.env.PASTELUX_MAX_ITEMS ?? 12);
const MIN_ITEMS = Number(process.env.PASTELUX_MIN_ITEMS ?? 4);
// The lighting trade press publishes a few times a week, not daily — a 72-hour
// window empties the digest most mornings. A wide window is safe because step 4
// drops anything already published in the last fortnight of digests, so each day
// surfaces only what has not been seen yet.
const LOOKBACK_HOURS = Number(process.env.PASTELUX_LOOKBACK_HOURS ?? 336);
const FETCH_TIMEOUT_MS = 20_000;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const DRY = flag('dry');
const USE_AI = !flag('no-ai') && Boolean(process.env.ANTHROPIC_API_KEY);

const log = (...a) => console.log('[news]', ...a);

// ---------------------------------------------------------------- utilities

/** Minimal RSS/Atom reader. Feeds are simple enough that a parser dependency
 *  is not worth the supply-chain surface in a scheduled job. */
function parseFeed(xml, sourceName) {
  const blocks = [
    ...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi),
  ].map((m) => m[0]);

  return blocks
    .map((block) => {
      const title = clean(pick(block, 'title'));
      let url = clean(pick(block, 'link'));
      if (!url) {
        // Atom: <link href="..."/>, preferring rel="alternate"
        const alt =
          block.match(/<link[^>]+rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) ??
          block.match(/<link[^>]+href=["']([^"']+)["']/i);
        url = alt?.[1] ?? '';
      }
      const published =
        clean(pick(block, 'pubDate')) ||
        clean(pick(block, 'published')) ||
        clean(pick(block, 'updated')) ||
        clean(pick(block, 'dc:date'));

      // Used only for relevance filtering and as summariser input; never stored.
      const blurb = clean(
        pick(block, 'description') || pick(block, 'summary') || pick(block, 'content')
      ).slice(0, 1200);

      return { title, url, published, blurb, source: sourceName };
    })
    .filter((i) => i.title && /^https?:\/\//.test(i.url));
}

function pick(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m?.[1] ?? '';
}

function clean(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&#8217;|&rsquo;/gi, '’')
    .replace(/&#8216;|&lsquo;/gi, '‘')
    .replace(/&#8220;|&ldquo;/gi, '“')
    .replace(/&#8221;|&rdquo;/gi, '”')
    .replace(/&#8211;|&ndash;/gi, '–')
    .replace(/&#8212;|&mdash;/gi, '—')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip tracking parameters so the same article from two feeds dedupes. */
function canonical(rawUrl) {
  try {
    const u = new URL(rawUrl);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$|source$)/i.test(k)) u.searchParams.delete(k);
    }
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return rawUrl;
  }
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        // Header values must be ASCII only.
        'user-agent': 'PasteluxDigest/0.1 (static site news digest; +https://github.com/)',
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- filtering

/** Word-boundary matcher. Plain `includes` is unusable here: "led" matches
 *  "called" and "fuelled", "lux" matches "luxury", and the digest fills with
 *  articles that have nothing to do with lighting. */
const reCache = new Map();
function matches(term, hay) {
  let re = reCache.get(term);
  if (!re) {
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Trailing \w* so "optic" catches "optics", "sustainab" catches "sustainable".
    re = new RegExp(`(?<![\\w-])${esc}\\w*`, 'i');
    reCache.set(term, re);
  }
  return re.test(hay);
}

function relevance(item, kw) {
  const hay = `${item.title} ${item.blurb}`;
  if (kw.reject.some((t) => matches(t, hay))) return 0;

  // A hit in the headline counts for more than one buried in the blurb.
  const strong = kw.strong.filter((t) => matches(t, hay)).length;
  const strongTitle = kw.strong.filter((t) => matches(t, item.title)).length;
  const weak = kw.weak.filter((t) => matches(t, hay)).length;

  if (strong >= 1) return 10 + strong * 2 + strongTitle * 3 + weak;
  if (weak >= 2) return weak;
  return 0;
}

function ruleTopics(item, rules) {
  const hay = `${item.title} ${item.blurb}`;
  return Object.entries(rules)
    .filter(([, terms]) => terms.some((t) => matches(t, hay)))
    .map(([topic]) => topic)
    .slice(0, 3);
}

// ---------------------------------------------------------------- summariser

const SYSTEM_PROMPT = `You write the daily digest for Pastelux, a reference site read by practising architectural lighting designers.

For each article you receive a headline, publisher and the publisher's own blurb.

Return, for each item:
- "summary": 1-2 sentences, maximum 45 words, in your OWN words. Never copy phrasing from the blurb. Lead with what a lighting designer would need to know: the technical substance, the standard affected, the specification consequence. Skip marketing language entirely. If the blurb is too thin to say anything substantive, write a plain factual sentence about what the article covers. Plain declarative English, no hype, no exclamation marks.
- "topics": 1-3 tags from exactly this list: circadian, standards, controls, facade, sustainability, optics, product, awards, research, practice.
- "keep": false if the item is not genuinely relevant to professional architectural lighting practice (consumer product roundups, deals, unrelated architecture with no lighting content), otherwise true.

Return ONLY a JSON array, one object per input item, in the same order, each with keys id, summary, topics, keep. No prose, no markdown fences.`;

async function summarise(items) {
  const payload = items.map((it, i) => ({
    id: i,
    title: it.title,
    source: it.source,
    blurb: it.blurb.slice(0, 600),
  }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(payload, null, 1) }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 400)}`);

  const body = await res.json();
  const text = (body.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '');

  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('Summariser did not return an array');
  return parsed;
}

// ---------------------------------------------------------------- rotations

/** Deterministic pick so the same date always yields the same term/project. */
function rotate(list, dateStr) {
  if (!list.length) return undefined;
  const days = Math.floor(Date.parse(`${dateStr}T00:00:00Z`) / 86_400_000);
  return list[((days % list.length) + list.length) % list.length];
}

// ---------------------------------------------------------------- main

async function main() {
  // The digest is dated in Asia/Ho_Chi_Minh (UTC+7), not UTC: the job runs at
  // local midnight, and the reader's "today" is the local date. Labelling in
  // UTC made the site look a day stale every morning.
  const localNow = new Date(Date.now() + 7 * 3600_000);
  const date = opt('date') ?? localNow.toISOString().slice(0, 10);
  const config = JSON.parse(await readFile(join(ROOT, 'src/data/feeds.json'), 'utf8'));

  log(`building digest for ${date} (ai: ${USE_AI ? MODEL : 'off'})`);

  // 1. Fetch every enabled feed; one failure must never fail the run.
  const feeds = config.feeds.filter((f) => !f.disabled);
  const fetched = await Promise.allSettled(
    feeds.map(async (f) => parseFeed(await fetchText(f.url), f.name))
  );

  let items = [];
  fetched.forEach((r, i) => {
    const name = feeds[i].name;
    if (r.status === 'fulfilled') {
      log(`  ${name}: ${r.value.length} items`);
      items.push(...r.value);
    } else {
      log(`  ${name}: FAILED — ${r.reason?.message ?? r.reason}`);
    }
  });

  if (!items.length) {
    log('no items from any feed; leaving existing content untouched');
    process.exit(0);
  }

  // 2. Recency window.
  const cutoff = Date.now() - LOOKBACK_HOURS * 3600_000;
  items = items.filter((i) => {
    const t = Date.parse(i.published);
    return Number.isNaN(t) ? true : t >= cutoff;
  });

  // 3. Dedupe by canonical URL, then by normalised title.
  const byUrl = new Map();
  for (const i of items) {
    i.url = canonical(i.url);
    if (!byUrl.has(i.url)) byUrl.set(i.url, i);
  }
  const byTitle = new Map();
  for (const i of byUrl.values()) {
    const key = i.title.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!byTitle.has(key)) byTitle.set(key, i);
  }
  items = [...byTitle.values()];

  // 4+5. Score, then dedupe against past digests — but never publish a
  // near-empty page. The trade press is slow and a rebuild after a manual
  // trigger can leave a single fresh item, so if the strict window yields
  // fewer than MIN_ITEMS the dedup window relaxes step by step (14 digests,
  // then 7, 3, 1, none) until the page has enough. A repeated good story
  // beats an empty digest.
  const scored = items
    .map((i) => ({ ...i, score: relevance(i, config.keywords) }))
    .filter((i) => i.score > 0)
    .sort((a, b) => b.score - a.score || Date.parse(b.published) - Date.parse(a.published));

  // per-digest seen sets, oldest -> newest, excluding today's own file
  const seenSets = [];
  if (existsSync(OUT_DIR)) {
    const recent = (await readdir(OUT_DIR)).filter((f) => f.endsWith('.json')).sort().slice(-14);
    for (const f of recent) {
      try {
        const day = JSON.parse(await readFile(join(OUT_DIR, f), 'utf8'));
        if (day.date === date) continue; // rebuilding today is fine
        seenSets.push(new Set((day.items ?? []).map((it) => canonical(it.url))));
      } catch {}
    }
  }

  let usedWindow = seenSets.length;
  for (const win of [seenSets.length, 7, 3, 1, 0]) {
    const seen = new Set();
    for (const s of seenSets.slice(seenSets.length - Math.min(win, seenSets.length))) {
      for (const u of s) seen.add(u);
    }
    const picked = scored.filter((i) => !seen.has(i.url)).slice(0, MAX_ITEMS);
    items = picked;
    usedWindow = win;
    if (picked.length >= MIN_ITEMS) break;
  }

  log(`${items.length} items after filtering (dedup window: ${usedWindow} digests)`);

  // 6. Summarise, degrading gracefully.
  let degraded = !USE_AI;
  if (USE_AI && items.length) {
    try {
      const out = await summarise(items);
      const byId = new Map(out.map((o) => [Number(o.id), o]));
      items = items
        .map((it, i) => {
          const s = byId.get(i);
          if (s && s.keep === false) return null;
          return {
            ...it,
            summary: s?.summary?.trim() ?? '',
            topics: Array.isArray(s?.topics) && s.topics.length ? s.topics : ruleTopics(it, config.topicRules),
          };
        })
        .filter(Boolean);
      log(`summarised, ${items.length} kept`);
    } catch (err) {
      log(`summariser failed (${err.message}); falling back to headlines only`);
      degraded = true;
    }
  }

  if (degraded) {
    items = items.map((it) => ({ ...it, summary: '', topics: ruleTopics(it, config.topicRules) }));
  }

  // 7. Rotations.
  const glossary = JSON.parse(await readFile(join(ROOT, 'src/content/glossary.json'), 'utf8'));
  const learnFiles = existsSync(join(ROOT, 'src/content/learn'))
    ? (await readdir(join(ROOT, 'src/content/learn')))
        .filter((f) => /\.mdx?$/.test(f))
        .map((f) => f.replace(/\.mdx?$/, ''))
        .sort()
    : [];

  // Relevance ranked the selection; the published file reads chronologically,
  // newest first, like any news page.
  items.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));

  const day = {
    date,
    generatedAt: new Date().toISOString(),
    degraded,
    items: items.map(({ title, url, source, published, summary, topics }) => ({
      title,
      url,
      source,
      published: published || new Date().toISOString(),
      summary,
      topics: (topics ?? []).slice(0, 3),
    })),
    termOfDay: rotate(glossary.map((g) => g.id), date),
    projectOfDay: rotate(learnFiles, date),
  };

  if (DRY) {
    console.log(JSON.stringify(day, null, 2));
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, `${date}.json`), JSON.stringify(day, null, 2) + '\n', 'utf8');
  log(`wrote src/content/daily/${date}.json — ${day.items.length} items`);
}

main().catch((err) => {
  console.error('[news] fatal:', err);
  process.exit(1);
});
