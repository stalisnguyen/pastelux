import { defineCollection, z } from 'astro:content';
import { glob, file } from 'astro/loaders';

/** Long-form articles — the fixed knowledge layer. Hand written, rarely changes. */
const learn = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/learn' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
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
    /** Optional Vietnamese gloss. Delete the field to hide it site-wide. */
    vi: z.string().optional(),
    symbol: z.string().optional(),
    unit: z.string().optional(),
    definition: z.string(),
    note: z.string().optional(),
    topics: z.array(z.string()).default([]),
    seeAlso: z.array(z.string()).default([]),
  }),
});

const events = defineCollection({
  loader: file('./src/content/events.json'),
  schema: z.object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(['conference', 'fair', 'award', 'deadline']),
    start: z.string(),
    end: z.string().optional(),
    city: z.string(),
    country: z.string(),
    url: z.string().url(),
    note: z.string().optional(),
  }),
});

/** Room-by-room comparison of lighting criteria across standards. */
const criteria = defineCollection({
  loader: file('./src/content/criteria.json'),
  schema: z.object({
    id: z.string(),
    group: z.string(),
    space: z.string(),
    em: z.string(),
    ugr: z.string(),
    uo: z.string(),
    ra: z.string(),
    ies: z.string(),
    vn: z.string(),
    note: z.string().optional(),
  }),
});

export const collections = { learn, daily, glossary, events, criteria };
