// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// CHANGE THESE TWO LINES when you create the GitHub repo.
// For https://<user>.github.io/<repo>  -> site: 'https://<user>.github.io', base: '/<repo>'
// For a custom domain                  -> site: 'https://your-domain.com',    base: '/'
const SITE = process.env.SITE_URL ?? 'https://example.github.io';
const BASE = process.env.BASE_PATH ?? '/';

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
