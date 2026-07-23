import { defineCollection, z } from 'astro:content';
import { glob, file } from 'astro/loaders';

/** Long-form articles — the fixed knowledge layer. Hand written, rarely changes. */
const learn = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/learn' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    /** Vietnamese one-liner, shown under the English on cards and article heads. */
    viSummary: z.string().optional(),
    /** Chapter number drives ordering and the "01 · Fundamentals" grouping. */
    chapter: z.number(),
    chapterTitle: z.string(),
    order: z.number().default(0),
    topics: z.array(z.string()).default([]),
    readingMinutes: z.number().default(5),
    updated: z.coerce.date(),
    draft: z.boolean().default(false),
  }),
});

/** One JSON file per day, written by scripts/fetch-news.mjs. */
const daily = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/daily' }),
  schema: z.object({
    date: z.string(),
    generatedAt: z.string(),
    /** Set by the bot when the AI summariser was unavailable. */
    degraded: z.boolean().default(false),
    items: z
      .array(
        z.object({
          title: z.string(),
          url: z.string().url(),
          source: z.string(),
          published: z.string(),
          summary: z.string().default(''),
          topics: z.array(z.string()).default([]),
        })
      )
      .default([]),
    termOfDay: z.string().optional(),
    projectOfDay: z.string().optional(),
  }),
});

/** Glossary — one flat JSON array, easy for a non-developer to extend. */
const glossary = defineCollection({
  loader: file('./src/content/glossary.json'),
  schema: z.object({
    id: z.string(),
    term: z.string(),
    /**
     * Vietnamese runs alongside the English, never instead of it: specs,
     * datasheets and standards are all written in English, so the English term
     * has to stay the one you recognise on a drawing. `vi` is the term itself,
     * `viDefinition` and `viNote` are the fuller explanations. All optional —
     * a term with none simply shows English only.
     */
    vi: z.string().optional(),
    viDefinition: z.string().optional(),
    viNote: z.string().optional(),
    /** A concrete worked example — what the term looks like on a real job. */
    viExample: z.string().optional(),
    symbol: z.string().optional(),
    unit: z.string().optional(),
    definition: z.string(),
    note: z.string().optional(),
    topics: z.array(z.string()).default([]),
    seeAlso: z.array(z.string()).default([]),
  }),
});

/**
 * Events carry a mandatory `verified` date and `source`. An event whose dates
 * and URL have not actually been checked cannot be published — the build fails
 * with the offending field named. This exists because the first version of this
 * file shipped guessed dates and a URL that pointed at an unrelated shop.
 */
const events = defineCollection({
  loader: file('./src/content/events.json'),
  schema: z.object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(['conference', 'fair', 'award', 'deadline']),
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'start must be YYYY-MM-DD'),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'end must be YYYY-MM-DD').optional(),
    city: z.string(),
    country: z.string(),
    venue: z.string().optional(),
    url: z.string().url(),
    /** Date the dates and URL were last checked against the organiser. */
    verified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'verified must be YYYY-MM-DD'),
    /** Where the information came from. Required, so claims stay traceable. */
    source: z.string().min(10),
    /**
     * A distinctive phrase the destination page must contain. Required, because
     * matching on words from the event name is not enough: `vietbuild.vn` is a
     * building-materials shop whose title contains "Vietbuild" and it sailed
     * through a name-based check. Pick something only the real organiser says.
     */
    expectText: z.string().min(4),
    /** Set when the host blocks automated checks, so check-links.mjs can skip it. */
    unverifiableUrl: z.string().optional(),
    note: z.string().optional(),
  }),
});

/** Room-by-room comparison of lighting criteria across standards. */
const criteria = defineCollection({
  loader: file('./src/content/criteria.json'),
  schema: z.object({
    id: z.string(),
    group: z.string(),
    /** Vietnamese names sit beside the English so the table can be scanned in
     *  either language — this is a lookup used mid-meeting, not a document. */
    viGroup: z.string().optional(),
    space: z.string(),
    viSpace: z.string().optional(),
    em: z.string(),
    ugr: z.string(),
    uo: z.string(),
    ra: z.string(),
    ies: z.string(),
    vn: z.string(),
    note: z.string().optional(),
  }),
});

/**
 * Case studies. Images live in `public/projects/<slug>/` and are referenced by
 * filename, so a non-developer can add a project by dropping files into a folder
 * and editing one markdown file — no build tooling, no imports.
 *
 * `credit` is required: never publish a photograph without recording who took it
 * and on what terms. This repository is public.
 */
const projects = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    studio: z.string(),
    location: z.string(),
    year: z.number(),
    typology: z.string(),
    /** Folder under public/projects/ holding the images. */
    folder: z.string(),
    images: z
      .array(
        z.object({
          src: z.string(),
          alt: z.string().min(8),
          caption: z.string().optional(),
        })
      )
      .min(1),
    credit: z.string().min(4),
    /** Set true for the shipped example so the UI can label it honestly. */
    placeholder: z.boolean().default(false),
    facts: z
      .array(z.object({ label: z.string(), value: z.string() }))
      .default([]),
    topics: z.array(z.string()).default([]),
    updated: z.coerce.date(),
    draft: z.boolean().default(false),
  }),
});

/**
 * Manufacturers, LED source makers, controls vendors, design practices and
 * standards bodies. Carries the same verification discipline as events —
 * `verified`, `source` and `expectText` are mandatory, so an unchecked entry
 * cannot build and check-links can prove each destination is still the right
 * one rather than merely alive.
 */
const directory = defineCollection({
  loader: file('./src/content/directory.json'),
  schema: z.object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(['manufacturer', 'source', 'controls', 'studio', 'body']),
    country: z.string(),
    url: z.string().url(),
    what: z.string(),
    viWhat: z.string(),
    verified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'verified must be YYYY-MM-DD'),
    source: z.string().min(8),
    expectText: z.string().min(3),
    unverifiableUrl: z.string().optional(),
  }),
});

export const collections = { learn, daily, glossary, events, criteria, projects, directory };
