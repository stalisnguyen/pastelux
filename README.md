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

## Where it is published

Live at **<https://pasteluxvn.com>**, from `main`, via the `Deploy to GitHub Pages`
workflow. `stalisnguyen.github.io/pastelux` now 301-redirects to the custom domain.

### How the domain is configured

`public/CNAME` is the **single source of truth**. GitHub Pages reads it to serve the
custom domain, and both `astro.config.mjs` and the deploy workflow derive `site` and
`base` from the same file — so the served domain and the built asset paths cannot drift
apart. (The classic failure is a site answering on a custom domain while every asset
still points at `/<repo>/`.)

Precedence is: repository variables → `public/CNAME` → `<user>.github.io/<repo>`.
Delete `public/CNAME` and everything falls back to the project Pages URL automatically.

To move to a different domain: change `public/CNAME`, set the same value under
**Settings → Pages → Custom domain**, and point DNS at GitHub:

| Type | Host | Value |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `<user>.github.io.` |

Leave any MX and SPF records alone — deleting them silently breaks email on the domain.

HTTPS is issued automatically by GitHub once DNS resolves; it can take up to an hour.
Tick **Enforce HTTPS** in Settings → Pages once it becomes available.

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
| A case study | a new `.mdx` file in `src/content/projects/` + images in `public/projects/<folder>/` |
| A glossary term | `src/content/glossary.json` |
| A row in the criteria table | `src/content/criteria.json` |
| An event | `src/content/events.json` — see the rules below |
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

### Adding a case study

1. Create `public/projects/my-project/` and drop the photographs in (plain `.jpg`/`.webp`;
   no imports, no build step).
2. Create `src/content/projects/my-project.mdx` and list the filenames under `images`,
   each with an `alt` description.
3. Fill in `credit` — it is required. **Never publish a photograph without recording who
   took it and on what terms.** This repository is public: a photographer or client
   usually holds the rights even to pictures of your own built work, so get permission
   in writing before publishing.

Set `placeholder: true` while you are still using stand-in images; the page then labels
itself honestly instead of implying the imagery is real.

### Adding an event — the rules

The first version of this file shipped guessed dates and a Vietbuild link that pointed at
an unrelated building-materials shop. The schema now makes that impossible to repeat:

- `verified` — the date you checked, `YYYY-MM-DD`. Required.
- `source` — where the information came from. Required.
- `expectText` — a distinctive phrase the destination page must contain. Required, and
  **not** a word from the event's own name: `vietbuild.vn` is a shop whose title contains
  "Vietbuild" and it passed a name-based check. Pick something only the real organiser
  says, like `Exhibition Corporation`.
- `unverifiableUrl` — set only when the host blocks automated checks (IALD sits behind
  Cloudflare and returns 403), with a note explaining why.

Then run the checker before committing:

```bash
npm run check
```

It verifies every event URL and every news feed: HTTP status, whether the link silently
redirects to a different domain, whether the page still contains `expectText`, whether an
event's `verified` date has gone stale, and whether a feed has stopped publishing. It also
runs weekly in CI and opens an issue when something breaks.

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
