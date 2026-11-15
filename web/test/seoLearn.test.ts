import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLearnSite, LANGS, rewriteLinks, sourceUrl, type SourceDoc } from '../src/seo/learn';

const SITE = 'https://example.org/atlas/';
const docsRoot = resolve(__dirname, '../public/docs');
const docs: SourceDoc[] = LANGS.flatMap((lang) =>
  readdirSync(resolve(docsRoot, lang)).filter((f) => f.endsWith('.md')).map((f) => ({ lang, slug: f.slice(0, -3), text: readFileSync(resolve(docsRoot, lang, f), 'utf8') })));
const files = buildLearnSite(docs, { site: SITE, today: '2026-11-16' });
const byPath = new Map(files.map((f) => [f.path, f.content]));

describe('static learn pages for search engines', () => {
  it('writes one page per article and language, plus the sitemap and robots.txt', () => {
    const pages = files.filter((f) => f.path.startsWith('learn/') && f.path !== 'learn/index.html');
    expect(pages.length).toBe(docs.length);
    expect(byPath.get('robots.txt')).toContain(`Sitemap: ${SITE}sitemap.xml`);
    const sitemap = byPath.get('sitemap.xml')!;
    expect((sitemap.match(/<url>/g) ?? []).length).toBe(docs.length + 1);
  });

  it('gives each article a title, description, canonical URL, hreflang alternates and valid JSON-LD', () => {
    const html = byPath.get('learn/en/gaia-bh3/index.html')!;
    expect(html).toContain('<title>Gaia BH3 · Cosmic Atlas</title>');
    expect(html).toMatch(/<meta name="description" content="[^"]{40,}">/);
    expect(html).toContain(`<link rel="canonical" href="${SITE}learn/en/gaia-bh3/">`);
    for (const l of LANGS) expect(html).toContain(`hreflang="${l}" href="${SITE}learn/${l}/gaia-bh3/"`);
    expect(html).toContain('hreflang="x-default"');
    const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
    expect(ld.map((x) => x['@type'])).toEqual(['Article', 'BreadcrumbList']);
    expect(ld[0].citation[0].url).toBe('https://doi.org/10.1051/0004-6361/202449763');
  });

  it('turns in-app links into links that work on a static page, and opens the article in the atlas', () => {
    const html = byPath.get('learn/uz/gaia-bh3/index.html')!;
    expect(html).toContain('href="../black-hole/"');
    expect(html).toContain('href="../../../?lang=uz#doc=gaia-bh3"');
    expect(html).not.toMatch(/href="#(doc|focus|layer)=/);
    // every relative article link points at a page that exists
    for (const [path, content] of byPath) {
      if (!path.endsWith('index.html')) continue;
      const dir = path.split('/').slice(0, -1);
      for (const [, href] of content.matchAll(/href="(\.{1,2}\/[^"?#]*)"/g)) {
        const parts = [...dir];
        for (const seg of href.split('/').filter(Boolean)) seg === '..' ? parts.pop() : seg !== '.' && parts.push(seg);
        const target = parts.length ? `${parts.join('/')}/index.html` : 'index.html';
        if (target === 'index.html') continue; // the atlas itself
        expect(byPath.has(target), `${path} → ${href}`).toBe(true);
      }
    }
  });

  it('reads DOIs and URLs from source lines', () => {
    expect(sourceUrl('Smith 2020, ApJ 1, 2 (doi:10.3847/1538-4357/ab1234)')).toBe('https://doi.org/10.3847/1538-4357/ab1234');
    expect(sourceUrl('NASA, https://ssd.jpl.nasa.gov/horizons/.')).toBe('https://ssd.jpl.nasa.gov/horizons/');
    expect(sourceUrl('IAU WGSN list')).toBeNull();
    expect(rewriteLinks('<a href="#focus=M31" class="focus-link">', 'ru', (s) => s, '../../../')).toBe('<a href="../../../?lang=ru#focus=M31" class="focus-link">');
  });
});
