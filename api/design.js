// Link previews for design pages (Vercel serverless function).
// Facebook, Messenger and text apps read a page's <meta> tags without running the site's JavaScript, so
// every link would show the general SoloPrint card. vercel.json sends "/?design=<id>" here; this returns
// the normal index.html with the design's name, description and first photo in the preview tags. The
// address doesn't change, and the page itself opens the design as usual.
const fs = require('fs');
const path = require('path');
const SUPA_URL = 'https://xpssamjjyarajtwtrwqx.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhwc3NhbWpqeWFyYWp0d3Ryd3F4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMjIxNjMsImV4cCI6MjA5MDc5ODE2M30.nGzAlBtFxdGHLSMThRGTgGH4-0ijpStMSDy2UDApyaM';

// Design links use the design's name (?design=name-sign). Must match designSlug in email-templates.js
// (a test checks): lowercase words joined by dashes; designs with the same name get -2, -3... by age.
function slugify(text) {
  return String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}
function designSlug(design, all) {
  const base = slugify(design.title) || String(design.id).toLowerCase();
  const same = all.filter(d => (slugify(d.title) || String(d.id).toLowerCase()) === base)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)));
  const n = same.findIndex(d => d.id === design.id);
  return n > 0 ? `${base}-${n + 1}` : base;
}
function findDesign(ref, all) {
  return all.find(d => d.id === ref) || all.find(d => designSlug(d, all) === String(ref).toLowerCase()) || null;
}

function attr(text) {
  return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Plain-text summary of a write-up (drops markdown-ish symbols), at most `max` characters.
function summary(text, max) {
  const plain = String(text || '').replace(/^[#>\s]+/gm, '').replace(/[*_`\[\]]/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > max ? plain.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : plain;
}

// Swaps the preview tags in index.html for the design's. Pure, so it can be tested.
function designHtml(html, design, pageUrl) {
  const title = `${design.title || 'Design'} | SoloPrint`;
  const description = summary(design.description, 180) || 'Custom 3D printing and design by SoloPrint. Tap to see this design and request your own.';
  const tags = [
    `<meta property="og:title" content="${attr(title)}" />`,
    `<meta property="og:description" content="${attr(description)}" />`,
    `<meta property="og:url" content="${attr(pageUrl)}" />`,
    design.photo ? `<meta property="og:image" content="${attr(design.photo)}" />` : '',
    design.photo ? `<meta property="og:image:alt" content="${attr(design.title || 'SoloPrint design')}" />` : '',
    design.photo ? `<meta name="twitter:image" content="${attr(design.photo)}" />` : ''
  ].filter(Boolean).join('\n');
  let out = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${attr(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${attr(description)}" />`)
    .replace(/<meta property="og:title"[^>]*>\n?/, '')
    .replace(/<meta property="og:description"[^>]*>\n?/, '');
  if (design.photo) {
    out = out
      .replace(/<meta property="og:image(:width|:height|:alt)?"[^>]*>\n?/g, '')
      .replace(/<meta name="twitter:image"[^>]*>\n?/, '');
  }
  return out.replace('<meta property="og:site_name" content="SoloPrint" />', `<meta property="og:site_name" content="SoloPrint" />\n${tags}`);
}

// `ref` is a design's name link (name-sign) or, for older links, its id.
async function loadDesign(ref) {
  const res = await fetch(`${SUPA_URL}/rest/v1/gallery_items?published=eq.true&select=id,data,created_at`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
  });
  if (!res.ok) return null;
  const all = (await res.json() || []).map(r => ({ id: r.id, createdAt: r.created_at, ...(r.data || {}) }));
  const d = findDesign(ref, all);
  if (!d) return null;
  const photo = (Array.isArray(d.photos) ? d.photos : []).find(u => /^https:\/\//.test(String(u)));
  return { title: d.title, description: d.description, photo };
}

// The page itself: the copy bundled with this function (vercel.json includeFiles), else fetched from the site.
async function loadIndex(host) {
  for (const file of [path.join(__dirname, '..', 'index.html'), path.join(process.cwd(), 'index.html')]) {
    try { return fs.readFileSync(file, 'utf8'); } catch (err) { /* try the next place */ }
  }
  try {
    const page = await fetch(`https://${host}/index.html`);
    return page.ok ? await page.text() : null;
  } catch (err) {
    return null;
  }
}

// Last resort when the page can't be read: just the preview tags, then straight on to the normal page.
function previewOnlyHtml(design, pageUrl, ref) {
  const target = `/index.html?design=${encodeURIComponent(ref)}`;
  const shell = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>SoloPrint</title>
<meta property="og:type" content="website" />
<meta property="og:site_name" content="SoloPrint" />
<meta http-equiv="refresh" content="0;url=${attr(target)}" />
</head><body><a href="${attr(target)}">Open this design on SoloPrint</a><script>location.replace(${JSON.stringify(target)});</script></body></html>`;
  return designHtml(shell, design, pageUrl);
}

module.exports = async function handler(req, res) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'soloprint.vercel.app';
  const ref = String((req.query && req.query.design) || new URL(req.url || '/', `https://${host}`).searchParams.get('design') || '');
  const pageUrl = `https://${host}/?design=${encodeURIComponent(ref)}`;
  const [html, design] = await Promise.all([
    loadIndex(host),
    /^[A-Za-z0-9_-]{1,80}$/.test(ref) ? loadDesign(ref).catch(() => null) : null
  ]);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
  if (html) { res.status(200).send(design ? designHtml(html, design, pageUrl) : html); return; }
  if (design) { res.status(200).send(previewOnlyHtml(design, pageUrl, ref)); return; }
  // Nothing to add: send them to the plain page, which opens the design itself.
  res.setHeader('Location', `/index.html?design=${encodeURIComponent(ref)}`);
  res.status(307).end();
};
module.exports.designHtml = designHtml;
module.exports.summary = summary;
module.exports.designSlug = designSlug;
module.exports.findDesign = findDesign;
