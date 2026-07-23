// @ts-check
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

/**
 * `public/CNAME` is the single source of truth for where this site lives.
 * GitHub Pages reads that same file to serve the custom domain, so deriving the
 * build config from it means the two can never disagree. The classic failure is
 * a site served at a custom domain while every asset still points at /<repo>/.
 *
 * Delete public/CNAME and the build falls back to <user>.github.io/<repo>.
 * Either value can still be overridden with SITE_URL / BASE_PATH.
 */
const cnameFile = fileURLToPath(new URL('./public/CNAME', import.meta.url));
const customDomain = existsSync(cnameFile) ? readFileSync(cnameFile, 'utf8').trim() : '';

const SITE =
  process.env.SITE_URL || (customDomain ? `https://${customDomain}` : 'https://example.github.io');
const BASE = process.env.BASE_PATH || '/';

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'ignore',
  integrations: [mdx(), sitemap()],
  vite: { plugins: [tailwindcss()] },
  markdown: {
    shikiConfig: { theme: 'github-dark-default', wrap: true },
  },
});
