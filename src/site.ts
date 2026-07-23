export const site = {
  name: 'Pastelux',
  tagline: 'Architectural lighting, kept current.',
  description:
    'A working knowledge base for architectural lighting designers: photometrics, standards, controls and human-centric lighting — plus a digest of the industry, refreshed every morning.',
  author: 'Pastelux',
  locale: 'en',
};

export const nav = [
  { href: '/', label: 'Today' },
  { href: '/learn', label: 'Learn' },
  { href: '/projects', label: 'Projects' },
  { href: '/standards', label: 'Standards' },
  { href: '/tools', label: 'Tools' },
  { href: '/glossary', label: 'Glossary' },
  { href: '/events', label: 'Events' },
];

/**
 * Four primary destinations in the mobile bar; everything else lives behind
 * "More". The bar is chosen for what gets opened on site or between meetings —
 * the morning digest, an article, a calculator, a lux figure to quote.
 */
export const mobileNav = [
  { href: '/', label: 'Today', icon: 'sun' },
  { href: '/learn', label: 'Learn', icon: 'book' },
  { href: '/tools', label: 'Tools', icon: 'calc' },
  { href: '/standards', label: 'Standards', icon: 'rule' },
];

/** Reachable from the "More" sheet on mobile. */
export const mobileMore = [
  { href: '/projects', label: 'Projects', icon: 'image', hint: 'Case studies' },
  { href: '/glossary', label: 'Glossary', icon: 'book', hint: 'Term definitions' },
  { href: '/events', label: 'Events', icon: 'calendar', hint: 'Fairs and deadlines' },
  { href: '/saved', label: 'Saved', icon: 'heart', hint: 'Your bookmarks' },
  { href: '/archive', label: 'Archive', icon: 'clock', hint: 'Past digests' },
  { href: '/about', label: 'About', icon: 'info', hint: 'Sources and colophon' },
];

/** Topic tags shared by the news bot and the learn section. */
export const TOPICS = [
  'circadian',
  'standards',
  'controls',
  'facade',
  'sustainability',
  'optics',
  'product',
  'awards',
  'research',
  'practice',
] as const;

export type Topic = (typeof TOPICS)[number];

export const TOPIC_LABEL: Record<string, string> = {
  circadian: 'Circadian & health',
  standards: 'Standards & codes',
  controls: 'Controls & protocols',
  facade: 'Façade & exterior',
  sustainability: 'Sustainability',
  optics: 'Optics & sources',
  product: 'Products',
  awards: 'Awards & events',
  research: 'Research',
  practice: 'Practice & business',
};

/** Resolve a site-relative path against the configured base path. */
export function url(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  if (path === '/') return base || '/';
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
