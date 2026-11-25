/**
 * Static, crawlable copies of the docs articles (public/docs/<lang>/<slug>.md), written at build time
 * to dist/learn/<lang>/<slug>/index.html, plus a contents page per language, sitemap.xml and robots.txt.
 *
 * The atlas itself is a WebGPU canvas: a search engine sees almost no text in it, and the in-app reader
 * loads articles with fetch. These pages carry the same text as plain HTML, with a title, description,
 * canonical URL, hreflang alternates, Open Graph tags and schema.org Article / BreadcrumbList data, and a
 * button that opens the article inside the 3D atlas (#doc=<slug>).
 *
 * Pure functions (no file system) so the output can be unit-tested; the Vite plugin does the I/O.
 */
import { parseFrontMatter, type DocMeta } from '../docs/frontmatter.ts';
import { escapeHtml, renderMarkdown } from '../docs/markdown.ts';

export const LANGS = ['en', 'uz', 'ru'] as const;
export type Lang = (typeof LANGS)[number];

export interface SourceDoc {
  lang: Lang;
  slug: string;
  text: string;
}

export interface SiteOptions {
  /** absolute site URL with a trailing slash, e.g. https://cosmic.bristleconelab.org/ */
  site: string;
  /** ISO date used when an article has no `updated:` */
  today: string;
}

export interface OutFile {
  path: string;
  content: string;
}

const UI: Record<Lang, { learn: string; open: string; contents: string; related: string; sources: string; updated: string; cite: string; about: string; home: string; langLabel: string }> = {
  en: {
    learn: 'Learn', open: 'Open in the 3D atlas', contents: 'All articles', related: 'Related articles', sources: 'Sources',
    updated: 'Updated', cite: 'Cite the atlas', home: 'Cosmic Atlas: 3D map of the universe', langLabel: 'Language',
    about: 'Cosmic Atlas is a free 3D map of the real universe in the browser: 39.6 million Gaia stars, 15 million DESI galaxies, the Solar System, black holes and the cosmic web, each at its measured position.',
  },
  uz: {
    learn: 'Maqolalar', open: '3D atlasda ochish', contents: 'Barcha maqolalar', related: 'Bogʻliq maqolalar', sources: 'Manbalar',
    updated: 'Yangilangan', cite: 'Atlasga havola', home: 'Cosmic Atlas: koinotning 3D xaritasi', langLabel: 'Til',
    about: 'Cosmic Atlas: brauzerdagi haqiqiy koinotning bepul 3D xaritasi. Gaia oʻlchagan 39,6 million yulduz, DESI xaritalagan 15 million galaktika, Quyosh tizimi, qora tuynuklar va kosmik toʻr, har biri oʻlchangan joyida.',
  },
  ru: {
    learn: 'Статьи', open: 'Открыть в 3D-атласе', contents: 'Все статьи', related: 'Связанные статьи', sources: 'Источники',
    updated: 'Обновлено', cite: 'Как цитировать', home: 'Cosmic Atlas: 3D-карта Вселенной', langLabel: 'Язык',
    about: 'Cosmic Atlas — бесплатная 3D-карта настоящей Вселенной в браузере: 39,6 млн звёзд Gaia, 15 млн галактик DESI, Солнечная система, чёрные дыры и космическая паутина, каждый объект на измеренном месте.',
  },
};

const LOCALE: Record<Lang, string> = { en: 'en_US', uz: 'uz_UZ', ru: 'ru_RU' };
const SOFTWARE_DOI = '10.5281/zenodo.24224239';
const REPO = 'https://github.com/bristleconelab/cosmic-atlas';

/** "… (doi:10.1051/…)" → https://doi.org/10.1051/…; a bare https URL is kept */
export function sourceUrl(source: string): string | null {
  const doi = source.match(/\bdoi:\s*(10\.\d{4,9}\/[^\s)]+)/i) ?? source.match(/https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/[^\s)]+)/i);
  if (doi) return `https://doi.org/${doi[1].replace(/[.,;]$/, '')}`;
  const url = source.match(/https:\/\/[^\s)<>"]+/);
  return url ? url[0].replace(/[.,;]$/, '') : null;
}

/** in-app links of the rendered markdown → links that work on a static page */
export function rewriteLinks(html: string, lang: Lang, toArticle: (slug: string) => string, app: string): string {
  return html
    .replace(/href="#doc=([a-z0-9-]+)" data-doc="[a-z0-9-]+"/g, (_, slug: string) => `href="${toArticle(slug)}"`)
    .replace(/href="#((?:focus|layer)=[^"]*)"/g, (_, frag: string) => `href="${app}?lang=${lang}#${frag}"`);
}

function jsonLd(data: unknown): string {
  // "</" cannot appear inside a script element
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

const CSS = `
:root{color-scheme:dark;--bg:#05070c;--panel:#0c111b;--ink:#ece6da;--dim:#b6ad9d;--brass:#e3c48f;--line:rgba(201,166,107,.25)}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;color:var(--ink);background:var(--bg);font:17px/1.65 -apple-system,'Segoe UI','Helvetica Neue',Arial,sans-serif}
a{color:var(--brass)}a:hover{color:#fff}:focus-visible{outline:2px solid var(--brass);outline-offset:2px}
header,main,footer{max-width:760px;margin:0 auto;padding:0 16px}
header{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;justify-content:space-between;padding-top:18px;padding-bottom:10px;border-bottom:1px solid var(--line)}
.brand{font:italic 500 24px/1 Georgia,'Times New Roman',serif;color:var(--brass);text-decoration:none}
nav.langs a{margin-left:10px;font-size:14px;text-decoration:none;color:var(--dim)}nav.langs a[aria-current]{color:var(--brass);font-weight:600}
.crumbs{font-size:14px;color:var(--dim);margin:18px 0 0}.crumbs a{color:var(--dim)}
h1{font:500 40px/1.15 Georgia,'Times New Roman',serif;margin:10px 0 12px}
h2{font:500 26px/1.25 Georgia,'Times New Roman',serif;margin:34px 0 10px}h3{margin:24px 0 8px}
.lede{font-size:19px;color:var(--dim);margin:0 0 20px}
.open{display:inline-block;margin:4px 0 18px;padding:11px 18px;border:1px solid var(--line);border-radius:22px;background:rgba(201,166,107,.12);color:var(--brass);text-decoration:none;font-weight:600}
.open:hover{background:rgba(201,166,107,.22);color:#fff}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:15px;display:block;overflow-x:auto}th,td{border-bottom:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
figure{margin:18px 0}img{max-width:100%;height:auto;border-radius:8px}figcaption{font-size:13px;color:var(--dim)}
code{background:var(--panel);padding:1px 5px;border-radius:4px;font-size:.92em}pre{background:var(--panel);padding:12px;overflow-x:auto;border-radius:8px}
blockquote{margin:16px 0;padding:4px 16px;border-left:3px solid var(--line);color:var(--dim)}
.box{margin:34px 0 0;padding:16px 18px;background:var(--panel);border:1px solid var(--line);border-radius:12px}
.box h2{margin-top:0;font-size:20px}.box ul{margin:0;padding-left:20px}.box li{margin:4px 0}
.list{list-style:none;padding:0}.list li{margin:0 0 14px}.list b{display:block}.list span{color:var(--dim);font-size:15px}
footer{margin-top:44px;padding-top:16px;padding-bottom:40px;border-top:1px solid var(--line);font-size:14px;color:var(--dim)}
@media (max-width:520px){h1{font-size:31px}body{font-size:16px}}
`;

interface Article {
  lang: Lang;
  slug: string;
  meta: DocMeta;
  body: string;
}

function parseAll(docs: SourceDoc[]): Article[] {
  const out: Article[] = [];
  for (const d of docs) {
    const fm = parseFrontMatter(d.text);
    if (!fm || fm.meta.placeholder || !fm.meta.title) continue;
    out.push({ lang: d.lang, slug: d.slug, meta: fm.meta, body: fm.body });
  }
  return out;
}

export function buildLearnSite(docs: SourceDoc[], opts: SiteOptions): OutFile[] {
  const site = opts.site.endsWith('/') ? opts.site : `${opts.site}/`;
  const articles = parseAll(docs);
  const by = new Map(articles.map((a) => [`${a.lang}/${a.slug}`, a]));
  const langsOf = (slug: string) => LANGS.filter((l) => by.has(`${l}/${slug}`));
  const pageUrl = (lang: Lang, slug: string) => `${site}learn/${lang}/${slug === 'index' ? '' : `${slug}/`}`;
  const ogImage = `${site}og-image.jpg`;
  const files: OutFile[] = [];
  const sitemap: { loc: string; lastmod: string; alts: { lang: Lang; href: string }[] }[] = [];

  const page = (a: Article) => {
    const { lang, slug, meta } = a;
    const ui = UI[lang];
    const isIndex = slug === 'index';
    const url = pageUrl(lang, slug);
    // relative links keep the pages working on a custom domain or a fork
    const root = isIndex ? '../../' : '../../../';
    const toArticle = (s: string) => {
      if (!by.has(`${lang}/${s}`)) return `${root}?lang=${lang}#doc=${s}`;
      if (s === 'index') return isIndex ? './' : '../';
      return isIndex ? `./${s}/` : `../${s}/`;
    };
    const app = root;
    const bodyHtml = rewriteLinks(
      renderMarkdown(a.body, { resolveImage: (src) => `${root}docs/${lang}/${src}` }),
      lang, toArticle, app,
    );
    const alts = langsOf(slug).map((l) => ({ lang: l, href: pageUrl(l, slug) }));
    const updated = meta.updated ?? opts.today;
    const title = isIndex ? `${ui.learn}: ${meta.title} · Cosmic Atlas` : `${meta.title} · Cosmic Atlas`;
    const sources = meta.sources.map((s) => ({ text: s, url: sourceUrl(s) }));
    const related = meta.related.filter((s) => by.has(`${lang}/${s}`)).map((s) => by.get(`${lang}/${s}`)!);

    const ld = [
      {
        '@context': 'https://schema.org',
        '@type': isIndex ? 'CollectionPage' : 'Article',
        headline: meta.title,
        name: meta.title,
        description: meta.summary,
        inLanguage: lang,
        url,
        mainEntityOfPage: url,
        image: ogImage,
        dateModified: updated,
        author: { '@type': 'Person', name: 'ismoilovdevml', url: 'https://github.com/ismoilovdevml' },
        publisher: { '@type': 'Organization', name: 'Cosmic Atlas', url: site, logo: { '@type': 'ImageObject', url: ogImage } },
        isPartOf: { '@type': 'WebSite', name: 'Cosmic Atlas', url: site },
        isAccessibleForFree: true,
        ...(sources.length ? { citation: sources.map((s) => (s.url ? { '@type': 'CreativeWork', name: s.text, url: s.url } : s.text)) } : {}),
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Cosmic Atlas', item: site },
          { '@type': 'ListItem', position: 2, name: ui.learn, item: pageUrl(lang, 'index') },
          ...(isIndex ? [] : [{ '@type': 'ListItem', position: 3, name: meta.title, item: url }]),
        ],
      },
    ];

    const head = [
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${escapeHtml(title)}</title>`,
      `<meta name="description" content="${escapeHtml(meta.summary)}">`,
      `<link rel="canonical" href="${escapeHtml(url)}">`,
      ...alts.map((x) => `<link rel="alternate" hreflang="${x.lang}" href="${escapeHtml(x.href)}">`),
      ...(alts.some((x) => x.lang === 'en') ? [`<link rel="alternate" hreflang="x-default" href="${escapeHtml(pageUrl('en', slug))}">`] : []),
      `<meta property="og:type" content="${isIndex ? 'website' : 'article'}">`,
      '<meta property="og:site_name" content="Cosmic Atlas">',
      `<meta property="og:title" content="${escapeHtml(meta.title)}">`,
      `<meta property="og:description" content="${escapeHtml(meta.summary)}">`,
      `<meta property="og:url" content="${escapeHtml(url)}">`,
      `<meta property="og:locale" content="${LOCALE[lang]}">`,
      `<meta property="og:image" content="${escapeHtml(ogImage)}">`,
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      '<meta name="twitter:card" content="summary_large_image">',
      '<meta name="theme-color" content="#04060b">',
      `<style>${CSS.trim()}</style>`,
      ...ld.map(jsonLd),
    ].join('\n');

    const langNav = LANGS.map((l) => {
      const href = by.has(`${l}/${slug}`) ? (l === lang ? './' : `${isIndex ? '../' : '../../'}${l}/${isIndex ? '' : `${slug}/`}`) : null;
      if (!href) return '';
      return `<a href="${href}" hreflang="${l}" lang="${l}"${l === lang ? ' aria-current="page"' : ''}>${l.toUpperCase()}</a>`;
    }).join('');

    const relatedHtml = related.length
      ? `<section class="box"><h2>${ui.related}</h2><ul>${related.map((r) => `<li><a href="${toArticle(r.slug)}">${escapeHtml(r.meta.title)}</a>: ${escapeHtml(r.meta.summary)}</li>`).join('')}</ul></section>`
      : '';
    const sourcesHtml = sources.length && !isIndex
      ? `<section class="box"><h2>${ui.sources}</h2><ul>${sources.map((s) => `<li>${s.url ? `<a href="${escapeHtml(s.url)}" rel="noopener">${escapeHtml(s.text)}</a>` : escapeHtml(s.text)}</li>`).join('')}</ul></section>`
      : '';
    const openHref = isIndex ? `${app}?lang=${lang}` : `${app}?lang=${lang}#doc=${slug}`;

    const html = `<!doctype html>
<html lang="${lang}">
<head>
${head}
</head>
<body>
<header><a class="brand" href="${app}?lang=${lang}">Cosmic Atlas</a><nav class="langs" aria-label="${escapeHtml(ui.langLabel)}">${langNav}</nav></header>
<main>
<nav class="crumbs" aria-label="Breadcrumb"><a href="${app}?lang=${lang}">Cosmic Atlas</a> › ${isIndex ? ui.learn : `<a href="${isIndex ? './' : '../'}">${ui.learn}</a> › ${escapeHtml(meta.title)}`}</nav>
<article>
<h1>${escapeHtml(meta.title)}</h1>
<p class="lede">${escapeHtml(meta.summary)}</p>
<a class="open" href="${openHref}">${ui.open} →</a>
${bodyHtml}
</article>
${isIndex ? '' : relatedHtml}
${sourcesHtml}
${isIndex ? '' : `<p><a href="../">${ui.contents}</a></p>`}
</main>
<footer>
<p>${escapeHtml(ui.about)}</p>
<p>${ui.updated}: ${escapeHtml(updated)} · ${ui.cite}: <a href="https://doi.org/${SOFTWARE_DOI}">doi:${SOFTWARE_DOI}</a> · <a href="${REPO}">GitHub</a></p>
</footer>
</body>
</html>
`;
    files.push({ path: `learn/${lang}/${isIndex ? '' : `${slug}/`}index.html`, content: html });
    sitemap.push({ loc: url, lastmod: updated, alts });
  };

  for (const a of articles) page(a);

  // /learn/ itself: send people to the contents page in their language
  const learnRoot = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Learn · Cosmic Atlas</title><link rel="canonical" href="${escapeHtml(`${site}learn/`)}">
<meta name="robots" content="noindex, follow"><style>${CSS.trim()}</style></head>
<body><main><h1>Cosmic Atlas</h1><ul class="list">${LANGS.filter((l) => by.has(`${l}/index`)).map((l) => `<li><a href="${l}/" hreflang="${l}" lang="${l}"><b>${escapeHtml(UI[l].contents)}</b></a><span>${escapeHtml(UI[l].home)}</span></li>`).join('')}</ul></main></body></html>
`;
  files.push({ path: 'learn/index.html', content: learnRoot });

  const today = opts.today;
  const urls = [
    `  <url><loc>${escapeHtml(site)}</loc><lastmod>${escapeHtml(today)}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
    ...sitemap.map((u) => [
      `  <url><loc>${escapeHtml(u.loc)}</loc><lastmod>${escapeHtml(u.lastmod)}</lastmod>`,
      ...u.alts.map((x) => `    <xhtml:link rel="alternate" hreflang="${x.lang}" href="${escapeHtml(x.href)}"/>`),
      ...(u.alts.length > 1 && u.alts.some((x) => x.lang === 'en') ? [`    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeHtml(u.alts.find((x) => x.lang === 'en')!.href)}"/>`] : []),
      '  </url>',
    ].join('\n')),
  ];
  files.push({
    path: 'sitemap.xml',
    content: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`,
  });
  // robots.txt is only honoured at the host root; on a project page (github.io/<repo>/) it is a no-op,
  // but it takes effect as soon as the atlas moves to its own domain
  files.push({ path: 'robots.txt', content: `User-agent: *\nAllow: /\n\nSitemap: ${site}sitemap.xml\n` });
  return files;
}
