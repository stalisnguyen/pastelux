#!/usr/bin/env node
/**
 * Validates every outbound URL the site publishes: event links and news feeds.
 *
 *   node scripts/check-links.mjs [--strict]
 *
 * Exists because the first version of events.json shipped a Vietbuild link that
 * pointed at an unrelated building-materials shop, and several invented dates.
 * A 200 response is not enough — this also checks that the page looks like the
 * thing it claims to be, and flags events whose dates have gone stale.
 *
 * Exit codes: 0 all good (warnings allowed), 1 hard failure.
 * With --strict, warnings fail too. CI runs it non-strict weekly.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');
const TIMEOUT = 25_000;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const errors = [];
const warnings = [];
const ok = [];

const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

async function fetchPage(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*' },
    });
    const body = res.ok ? (await res.text()).slice(0, 200_000) : '';
    return { status: res.status, finalUrl: res.url, body };
  } finally {
    clearTimeout(timer);
  }
}

const titleOf = (html) =>
  (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
    .replace(/&#8211;|&ndash;/g, '-')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);

/** Visible text of a page, tags and scripts stripped. */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8211;|&ndash;/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

async function checkEvents() {
  const events = JSON.parse(await readFile(join(ROOT, 'src/content/events.json'), 'utf8'));
  const today = new Date().toISOString().slice(0, 10);

  console.log(`\n${c.dim('── events ──')}`);

  for (const e of events) {
    const tag = `${e.id}`;

    // --- date sanity, independent of the network ---
    if (e.end && e.end < e.start) {
      errors.push(`${tag}: end (${e.end}) is before start (${e.start})`);
    }
    if (!e.verified) {
      errors.push(`${tag}: missing "verified" date`);
    } else {
      const ageDays = Math.floor((Date.parse(today) - Date.parse(e.verified)) / 86_400_000);
      if (ageDays > 180) {
        warnings.push(`${tag}: last verified ${ageDays} days ago — re-check the organiser`);
      }
    }

    // --- URL ---
    if (e.unverifiableUrl) {
      warnings.push(`${tag}: URL check skipped — ${e.unverifiableUrl.split('.')[0]}.`);
      console.log(`${c.yellow('SKIP')} ${tag.padEnd(28)} ${e.url}`);
      continue;
    }

    let res;
    try {
      res = await fetchPage(e.url);
    } catch (err) {
      errors.push(`${tag}: ${e.url} — request failed (${err.message})`);
      console.log(`${c.red('FAIL')} ${tag.padEnd(28)} ${e.url}`);
      continue;
    }

    if (res.status >= 400) {
      errors.push(`${tag}: ${e.url} returned HTTP ${res.status}`);
      console.log(`${c.red('FAIL')} ${tag.padEnd(28)} HTTP ${res.status}`);
      continue;
    }

    // A 200 proves a host answered, not that it is the right host.
    // 1. Did the link silently drift to another domain (expired domain, parking
    //    page, redirect to a shop)?
    if (host(res.finalUrl) !== host(e.url)) {
      errors.push(
        `${tag}: ${e.url} redirected off-domain to ${res.finalUrl}. Confirm the organiser still owns it.`
      );
      console.log(`${c.red('FAIL')} ${tag.padEnd(28)} redirected to ${host(res.finalUrl)}`);
      continue;
    }

    // 2. Does the page say the thing only the real organiser would say?
    const text = `${titleOf(res.body)} ${visibleText(res.body)}`;
    if (!text.includes(e.expectText.toLowerCase())) {
      errors.push(
        `${tag}: page does not contain expectText "${e.expectText}". Title was "${titleOf(res.body)}". Either the link is wrong or the site changed.`
      );
      console.log(`${c.red('FAIL')} ${tag.padEnd(28)} missing "${e.expectText}"`);
      continue;
    }

    ok.push(tag);
    console.log(`${c.green(' OK ')} ${tag.padEnd(28)} ${titleOf(res.body)}`);
  }
}

async function checkFeeds() {
  const cfg = JSON.parse(await readFile(join(ROOT, 'src/data/feeds.json'), 'utf8'));
  console.log(`\n${c.dim('── feeds ──')}`);

  for (const f of cfg.feeds) {
    if (f.disabled) {
      console.log(`${c.dim('OFF ')} ${f.name.padEnd(28)} ${c.dim(f.disabled.slice(0, 60))}`);
      continue;
    }
    let res;
    try {
      res = await fetchPage(f.url);
    } catch (err) {
      warnings.push(`feed ${f.name}: request failed (${err.message})`);
      console.log(`${c.yellow('WARN')} ${f.name.padEnd(28)} ${err.message}`);
      continue;
    }

    if (res.status >= 400) {
      warnings.push(`feed ${f.name}: HTTP ${res.status} — consider disabling it`);
      console.log(`${c.yellow('WARN')} ${f.name.padEnd(28)} HTTP ${res.status}`);
      continue;
    }

    const items = (res.body.match(/<item[\s>]|<entry[\s>]/gi) ?? []).length;
    if (items === 0) {
      warnings.push(`feed ${f.name}: responded 200 but contains no items — wrong URL?`);
      console.log(`${c.yellow('WARN')} ${f.name.padEnd(28)} 0 items`);
      continue;
    }

    // A feed nobody updates is dead weight; surface it rather than silently
    // carrying it forever.
    const dates = [...res.body.matchAll(/<(?:pubDate|published|updated)>([^<]+)</gi)]
      .map((m) => Date.parse(m[1]))
      .filter((n) => !Number.isNaN(n));
    const newest = dates.length ? Math.max(...dates) : NaN;
    const ageDays = Number.isNaN(newest)
      ? null
      : Math.floor((Date.now() - newest) / 86_400_000);

    if (ageDays !== null && ageDays > 120) {
      warnings.push(`feed ${f.name}: newest item is ${ageDays} days old — feed looks stale`);
      console.log(`${c.yellow('WARN')} ${f.name.padEnd(28)} ${items} items, newest ${ageDays}d old`);
    } else {
      ok.push(`feed ${f.name}`);
      console.log(
        `${c.green(' OK ')} ${f.name.padEnd(28)} ${items} items${ageDays !== null ? `, newest ${ageDays}d old` : ''}`
      );
    }
  }
}

/**
 * The directory carries the most outbound links on the site, so it rots the
 * fastest. Same rules as events: status, off-domain drift, and expectText.
 */
async function checkDirectory() {
  const entries = JSON.parse(await readFile(join(ROOT, 'src/content/directory.json'), 'utf8'));
  console.log(`\n${c.dim('── directory ──')}`);

  for (const d of entries) {
    const tag = d.id;

    if (d.unverifiableUrl) {
      warnings.push(`${tag}: URL check skipped — blocked to automated clients.`);
      console.log(`${c.yellow('SKIP')} ${tag.padEnd(24)} ${d.url}`);
      continue;
    }

    let res;
    try {
      res = await fetchPage(d.url);
    } catch (err) {
      errors.push(`${tag}: ${d.url} — request failed (${err.message})`);
      console.log(`${c.red('FAIL')} ${tag.padEnd(24)} ${err.message}`);
      continue;
    }

    if (res.status >= 400) {
      errors.push(`${tag}: ${d.url} returned HTTP ${res.status}`);
      console.log(`${c.red('FAIL')} ${tag.padEnd(24)} HTTP ${res.status}`);
      continue;
    }

    if (host(res.finalUrl) !== host(d.url)) {
      warnings.push(`${tag}: redirects off-domain to ${res.finalUrl} — confirm the company still owns it.`);
      console.log(`${c.yellow('WARN')} ${tag.padEnd(24)} -> ${host(res.finalUrl)}`);
      continue;
    }

    const text = `${titleOf(res.body)} ${visibleText(res.body)}`;
    if (!text.includes(d.expectText.toLowerCase())) {
      errors.push(
        `${tag}: page does not contain expectText "${d.expectText}". Title was "${titleOf(res.body)}".`
      );
      console.log(`${c.red('FAIL')} ${tag.padEnd(24)} missing "${d.expectText}"`);
      continue;
    }

    ok.push(tag);
    console.log(`${c.green(' OK ')} ${tag.padEnd(24)} ${titleOf(res.body).slice(0, 46)}`);
  }
}

await checkEvents();
await checkDirectory();
await checkFeeds();

console.log(`\n${c.dim('── summary ──')}`);
console.log(`${ok.length} ok · ${warnings.length} warnings · ${errors.length} errors\n`);

for (const w of warnings) console.log(`${c.yellow('warning')} ${w}`);
for (const e of errors) console.log(`${c.red('error  ')} ${e}`);

if (errors.length || (STRICT && warnings.length)) {
  console.log(`\n${c.red('Link check failed.')}\n`);
  process.exit(1);
}
console.log(`\n${c.green('Link check passed.')}\n`);
