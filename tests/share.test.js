// Checks for api/design.js, the Vercel function that gives design links their own preview card.
const fs = require('fs');
const path = require('path');
const { check, assert, finish } = require('./harness');
const api = require('../api/design.js');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const design = { title: 'Name Sign "Deluxe"', description: '## The story\nPrinted in **two** colors <for> a friend\'s door. '.repeat(6), photo: 'https://img.test/sign.jpg' };
const url = 'https://soloprint.vercel.app/?design=g1';

(async () => {
console.log('Design link previews (api/design.js):');
await check('the design\'s title, description and photo replace the general preview', () => {
  const out = api.designHtml(html, design, url);
  const meta = (attr, key) => (out.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`, 'g')) || []);
  assert(meta('property', 'og:image').length === 1 && out.includes('<meta property="og:image" content="https://img.test/sign.jpg" />'), 'og:image');
  assert(meta('name', 'twitter:image').length === 1 && out.includes('content="https://img.test/sign.jpg"'), 'twitter:image');
  assert(!/content="[^"]*og-image\.png"/.test(out) && !out.includes('og:image:width'), 'general image still there');
  assert(meta('property', 'og:title').length === 1 && out.includes('<meta property="og:title" content="Name Sign &quot;Deluxe&quot; | SoloPrint" />'), 'og:title');
  assert(out.includes('<title>Name Sign &quot;Deluxe&quot; | SoloPrint</title>'), 'page title');
  const desc = (out.match(/<meta property="og:description" content="([^"]*)"/) || [])[1] || '';
  assert(desc.startsWith('The story Printed in two colors &lt;for&gt; a friend') && desc.length < 200 && desc.endsWith('…'), desc);
  assert(out.includes('<meta property="og:url" content="https://soloprint.vercel.app/?design=g1" />'), 'og:url');
  assert(out.includes('<script src="app.js"></script>'), 'the page itself must be unchanged');
});
await check('a design without photos keeps the general image', () => {
  const out = api.designHtml(html, { title: 'Hook' }, url);
  assert(out.includes('og-image.png') && out.includes('<meta property="og:title" content="Hook | SoloPrint" />'), 'fallback image missing');
});
await check('vercel.json sends design links to the function', () => {
  const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'vercel.json'), 'utf8'));
  const r = (cfg.rewrites || []).find(x => x.destination === '/api/design');
  assert(r && r.source === '/' && r.has[0].key === 'design', JSON.stringify(cfg.rewrites));
});
await check('the function falls back to the plain page if anything fails', async () => {
  const saved = global.fetch;
  global.fetch = async () => { throw new Error('offline'); };
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, end() {}, send() {} };
  await api({ headers: { host: 'soloprint.vercel.app' }, query: { design: 'g1' } }, res);
  global.fetch = saved;
  assert(res.code === 307 && res.headers.Location === '/index.html?design=g1', JSON.stringify(res));
});
await check('the function serves the page with the design filled in', async () => {
  const saved = global.fetch;
  global.fetch = async u => String(u).endsWith('/index.html')
    ? { ok: true, text: async () => html }
    : { ok: true, json: async () => [{ id: 'g7', created_at: '2026-01-01', data: { title: 'Name Sign', photos: ['https://img.test/s.png'] } }, { id: 'g8', data: { title: 'Other', photos: ['https://img.test/o.png'] } }] };
  let body = '';
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { body = b; }, end() {} };
  await api({ headers: { host: 'soloprint.vercel.app' }, query: { design: 'name-sign' } }, res);
  global.fetch = saved;
  assert(res.code === 200 && body.includes('content="https://img.test/s.png"') && body.includes('Name Sign | SoloPrint'), res.code);
});

finish();
})();
