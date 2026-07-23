# Pastelux

**Architectural lighting, kept current.**

A reference site for architectural lighting designers, with a digest of the industry
refreshed every morning. Static, free to host, no database and no server.

The site is deliberately split into two layers:

| Layer | What it is | How it changes |
|---|---|---|
| **Fixed** — Learn, Standards, Tools, Glossary | The part of the craft that does not change weekly | Edited by hand |
| **Moving** — Today, Archive, Events | What happened in the industry | Written each morning by a scheduled job |

---

## Running it locally

```bash
npm install
```

```bash
npm run dev
```

Then open <http://localhost:4321>.

Note that **search does not work in dev mode** — Pagefind builds its index from the
compiled output. To test search, run a full build and preview it:

```bash
npm run build && npm run preview
```

## Publishing to GitHub Pages

1. Create a repository and push this directory to `main`.
2. In the repository, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push. The `Deploy to GitHub Pages` workflow builds and publishes automatically.

The site URL and base path are derived from the repository name, so
`https://<user>.github.io/<repo>/` works with no configuration.

For a custom domain, set two repository variables under
**Settings → Secrets and variables → Actions → Variables**:

| Variable | Example |
|---|---|
| `SITE_URL` | `https://pastelux.com` |
| `BASE_PATH` | `/` |

## The daily digest

`scripts/fetch-news.mjs` reads the RSS feeds in `src/data/feeds.json`, filters them for
professional relevance, writes a short original summary of each item, and commits the
result to `src/content/daily/YYYY-MM-DD.json`. The `Daily digest` workflow runs it at
23:00 UTC — 06:00 in Vietnam — and triggers a deploy only if something new was found.

Run it by hand any time:

```bash
npm run news
```

Useful flags:

```bash
node scripts/fetch-news.mjs --dry --no-ai
```

- `--dry` prints the result instead of writing a file
- `--no-ai` skips the summariser
- `--date 2026-07-23` rebuilds a specific day

### Enabling AI summaries

Without an API key the job still succeeds — it publishes headlines and links, and marks
the day `degraded` so the site can say so. With a key it writes a two-sentence summary of
each item, tags it by topic, and discards items that are not genuinely relevant to
professional practice.

Add `ANTHROPIC_API_KEY` under **Settings → Secrets and variables → Actions → Secrets**.
Cost is a few cents a month. Locally, export it before running `npm run news`.

Optional environment variables: `PASTELUX_MODEL` (default `claude-sonnet-5`),
`PASTELUX_MAX_ITEMS` (12), `PASTELUX_LOOKBACK_HOURS` (336).

### On copyright

The bot stores only the **headline, publisher, link and a summary written here**. Source
article text is never copied into this repository, and every item links back to its
publisher. Keep it that way if you change the summariser prompt.

---

## Adding content

Everything below can be edited directly in GitHub's web editor — no local setup needed.
Commit to `main` and the site rebuilds itself.

| To add | Edit |
|---|---|
| An article | a new `.mdx` file in `src/content/learn/` |
| A glossary term | `src/content/glossary.json` |
| A row in the criteria table | `src/content/criteria.json` |
| An event | `src/content/events.json` |
| A news source | `src/data/feeds.json` |

An article's frontmatter looks like this:

```yaml
---
title: 'Beam angles, spot sizes and the inverse square law'
summary: 'One sentence shown on cards and in search results.'
chapter: 1                    # groups articles on /learn
chapterTitle: 'Fundamentals'
order: 2                      # position within the chapter
topics: ['optics']
readingMinutes: 6
updated: 2026-07-18
draft: false
---
```

The schemas live in `src/content.config.ts`. If a field is wrong, the build fails with a
message naming the file and the field — it will not publish broken content.

---

## Design system

Dark-first, with a light theme that follows the system preference and a manual toggle.
All colours live as CSS custom properties at the top of `src/styles/global.css`.

Body text is 16.2:1 against the background (WCAG AAA) and muted text 6.6:1 (AA) in both
themes. The amber accent is darkened in light mode specifically so it keeps passing 4.5:1
— if you change the palette, check that pair again.

The recurring gradient bar is a 2200 K → 6500 K colour-temperature ramp.

---

## Notes and caveats

- **The numbers are a working reference, not a certification.** Standards are copyrighted
  documents that must be purchased, editions differ, and the version a contract calls up
  is often not the newest. The criteria table exists to orient you quickly; verify against
  the purchased standard before anything leaves the office.
- **Bookmarks are per-browser.** They live in `localStorage`, are never transmitted, and
  disappear if site data is cleared. That is the trade-off for having no accounts.
- **Two feeds are disabled** in `src/data/feeds.json`: LEDs Magazine returns HTTP 403 to
  automated clients, and LED professional has no working RSS endpoint at the usual paths.
  Both are worth retrying periodically — the content is good.

---

## Stack

Astro 5 · Tailwind CSS 4 · Pagefind · GitHub Pages.
No database, no analytics, no cookies, no tracking.
