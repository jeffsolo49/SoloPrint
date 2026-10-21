// Browser checks for the SoloPrint site, run against the real index.html/app.js/styles.css with
// Supabase, Google and image hosts mocked. Run: npm install && npm test
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { check, assert, finish } = require('./harness');

const SITE = 'file://' + path.resolve(__dirname, '..', 'index.html');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==', 'base64');
const OWNER = 'Bearer OWNER-TOKEN';
const now = Date.now();
const ago = mins => new Date(now - mins * 60000).toISOString();

function fixtures() {
  return {
    jobs: {
      '1': { id: '1', clientName: 'Jane', clientEmail: 'jane@example.com', createdAt: ago(600), phase: 'quote_sent', paymentStatus: 'payment_requested',
        phaseHistory: { estimate: ago(600), quote_sent: ago(30) }, items: [{ name: 'Benchy', qty: 2, filType: 'black', minutes: 90, grams: 20, imageLinks: ['https://img.test/a.png'] }] },
      '2': { id: '2', clientName: 'Jane', clientEmail: 'jane@example.com', createdAt: ago(900), phase: 'production', paymentStatus: 'payment_requested',
        items: [{ name: 'Hook', qty: 1, filType: 'white', minutes: 40, grams: 12 }] },
      "x');alert(1);('": { id: "x');alert(1);('", clientName: 'Evil', clientEmail: 'jane@example.com', createdAt: ago(5), items: [] },
      '3': { id: '3', clientName: '<img src=x onerror=window.__xss=1>', clientEmail: 'jane@example.com', createdAt: ago(5), phase: 'estimate',
        items: [{ name: 'A', filType: '"><img src=x onerror=window.__xss=2>', qty: '<b>', grams: '<img src=x onerror=window.__xss=3>' }] }
    },
    gallery: {
      g1: { id: 'g1', published: true, sort_order: 0, data: { title: 'Dragon Organizer', description: 'Started as a request.\n\nPrinted three test versions.', photos: ['https://img.test/d1.png', 'https://img.test/d2.png'], filType: 'black', minutes: 150, grams: 85.4 } },
      g2: { id: 'g2', published: true, sort_order: 1, data: { title: 'Name Sign', photos: ['https://img.test/s.png'] } },
      g3: { id: 'g3', published: false, sort_order: 2, data: { title: 'Hidden prototype', photos: [] } }
    },
    library: { 'name:planter': { name: 'Planter', minutes: 200, grams: 110, filType: 'black' } },
    log: []
  };
}

// Mock of the Supabase REST API with the same access rules as supabase/*.sql.
async function mockBackend(page, db) {
  await page.route('**/*', async route => {
    const req = route.request(), url = req.url(), method = req.method();
    const owner = (req.headers()['authorization'] || '') === OWNER;
    if (url.startsWith('file:') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    if (url.startsWith('https://img.test/')) return route.fulfill({ body: PNG, contentType: 'image/png' });
    const rest = url.split('/rest/v1')[1] || '';
    if (rest) db.log.push(`${method} ${rest.split('?')[0]} ${owner ? 'owner' : 'anon'}`);
    if (rest.startsWith('/rpc/customer_jobs')) {
      const { email } = JSON.parse(req.postData());
      return route.fulfill({ json: Object.values(db.jobs).filter(j => j.clientEmail === email) });
    }
    if (rest.startsWith('/rpc/submit_job')) { const { job } = JSON.parse(req.postData()); db.jobs[job.id] = job; return route.fulfill({ status: 204, body: '' }); }
    if (rest.startsWith('/rpc/customer_approve_quote')) { const { job_id } = JSON.parse(req.postData()); db.jobs[job_id].customerApprovedAt = new Date().toISOString(); return route.fulfill({ status: 204, body: '' }); }
    if (rest.startsWith('/jobs')) {
      if (!owner) return route.fulfill({ status: 401, json: {} });
      if (method === 'GET') return route.fulfill({ json: Object.values(db.jobs).map(data => ({ data })) });
      if (method === 'POST') { const row = JSON.parse(req.postData()); db.jobs[row.id] = row.data; return route.fulfill({ json: [row] }); }
      if (method === 'DELETE') return route.fulfill({ status: 204, body: '' });
    }
    if (rest.startsWith('/gallery_items')) {
      if (method === 'GET') return route.fulfill({ json: Object.values(db.gallery).filter(g => owner || g.published) });
      if (!owner) return route.fulfill({ status: 401, json: {} });
      if (method === 'POST') { const row = JSON.parse(req.postData()); db.gallery[row.id] = row; return route.fulfill({ status: 201, body: '' }); }
      if (method === 'DELETE') { delete db.gallery[decodeURIComponent(url.split('id=eq.')[1])]; return route.fulfill({ status: 204, body: '' }); }
    }
    if (rest.startsWith('/model_library')) {
      if (method === 'GET') return route.fulfill({ json: Object.entries(db.library).map(([key, data]) => ({ key, data })) });
      if (!owner) return route.fulfill({ status: 401, json: {} });
      if (method === 'POST') { JSON.parse(req.postData()).forEach(r => { db.library[r.key] = r.data; }); return route.fulfill({ status: 201, body: '' }); }
      if (method === 'DELETE') { delete db.library[decodeURIComponent(url.split('key=eq.')[1])]; return route.fulfill({ status: 204, body: '' }); }
    }
    if (url.includes('/auth/v1/token')) {
      const body = JSON.parse(req.postData());
      return body.password === 'right-password'
        ? route.fulfill({ json: { access_token: 'OWNER-TOKEN', expires_in: 3600 } })
        : route.fulfill({ status: 400, json: { error: 'invalid_grant' } });
    }
    if (url.startsWith('https://script.google.com/')) return route.fulfill({ json: { ok: true, source: 'MakerWorld', name: 'Articulated Dragon', image: 'https://img.test/d1.png', profile: '0.2mm', plates: 1, minutes: 150, grams: 85.4 } });
    if (url.startsWith('https://api.microlink.io/')) return route.fulfill({ json: { status: 'success', data: { title: 'Model', image: { url: 'https://img.test/m.png' } } } });
    return route.abort(); // fonts, CDNs and anything else stay offline
  });
}

let browser;
async function open(db, { width = 1100, height = 900 } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => d.accept());
  await mockBackend(page, db);
  await page.goto(SITE);
  await page.waitForFunction(() => !state.loading);
  await page.waitForTimeout(250);
  return page;
}

const asOwner = tab => `(async () => { state.ownerUnlocked = true; ownerSession = { token: 'OWNER-TOKEN', expiresAt: Date.now() + 3e6 }; state.view = 'owner'; state.ownerTab = '${tab}'; await loadBatches(); await loadGallery(); render(); })()`;
const STATES = {
  'home': '0',
  'home with an item': "(() => { updateDraft(0, 'name', 'Desk hook'); updateDraftPrintTime(0, 'hours', '1'); updateDraft(0, 'grams', 20); render(); })()",
  'design work': "(async () => { await loadGallery(); setTab('gallery'); })()",
  'design page': "(async () => { await loadGallery(); openWork('g1'); })()",
  'my requests': "(async () => { state.historyEmail = 'jane@example.com'; await loadBatches('jane@example.com'); state.clientTab = 'jobs'; render(); })()",
  'owner login': "(() => { state.view = 'owner'; render(); })()",
  'owner dashboard': asOwner('dashboard'),
  'owner calculator': asOwner('calculator'),
  'owner gallery': asOwner('gallery'),
  'owner saved models': asOwner('library'),
  'owner sales data': asOwner('analytics')
};

(async () => {
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  console.log('Pages load cleanly and meet WCAG 2.2 AA (axe-core):');
  for (const [name, code] of Object.entries(STATES)) {
    await check(name, async () => {
      const page = await open(fixtures());
      await page.evaluate(code);
      await page.waitForTimeout(250);
      await page.addScriptTag({ content: AXE });
      const violations = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } })).violations
        .map(v => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ')}`));
      assert(!page.errors.length, `page errors: ${page.errors.join('; ')}`);
      assert(!violations.length, `accessibility violations:\n${violations.join('\n')}`);
      await page.close();
    });
  }

  console.log('\nNo sideways scrolling:');
  for (const width of [320, 390, 900]) {
    for (const view of ['home', 'my requests', 'owner dashboard', 'owner gallery']) {
      await check(`${view} at ${width}px`, async () => {
        const page = await open(fixtures(), { width, height: 800 });
        await page.evaluate(STATES[view]);
        await page.waitForTimeout(200);
        const sw = await page.evaluate(() => document.documentElement.scrollWidth);
        assert(sw <= width, `page is ${sw}px wide at ${width}px`);
        await page.close();
      });
    }
  }

  console.log('\nSecurity:');
  await check('forged orders are dropped or escaped, never run code', async () => {
    const page = await open(fixtures());
    await page.evaluate(STATES['my requests']);
    await page.evaluate(asOwner('dashboard'));
    await page.waitForTimeout(200);
    assert(!(await page.evaluate(() => window.__xss)), 'injected script ran');
    assert(!(await page.evaluate(() => state.batches.some(b => b.id.includes("'")))), 'order with a forged id was kept');
    await page.close();
  });
  await check('customers only use the narrow database routes', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.evaluate(STATES['my requests']);
    assert(!db.log.some(l => l.startsWith('GET /jobs')), `customer read the jobs table directly: ${db.log.join(', ')}`);
    await page.close();
  });
  await check('owner login: wrong password refused, right password sends the owner token', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.evaluate(STATES['owner login']);
    await page.fill('#owner-pw', 'wrong');
    await page.click('#owner-login-btn');
    await page.waitForTimeout(200);
    assert(/Incorrect/.test(await page.textContent('#pw-err')), 'no error for a wrong password');
    await page.fill('#owner-pw', 'right-password');
    await page.click('#owner-login-btn');
    await page.waitForSelector('.stats-row');
    assert(db.log.includes('GET /jobs owner'), 'dashboard did not load orders with the owner token');
    await page.close();
  });

  console.log('\nCustomer flows:');
  await check('submit a request: waits for review, saved through submit_job', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.fill('#client-name', 'Sam');
    await page.fill('#client-email', 'sam@example.com');
    await page.fill('#link-0', 'Phone stand');
    await page.fill('#name-0', 'Phone stand');
    await page.click('#submit-btn');
    await page.waitForTimeout(400);
    const job = Object.values(db.jobs).find(j => j.clientName === 'Sam');
    assert(job, 'request was not saved');
    assert(job.phase === 'estimate', `new request phase is ${job.phase}`);
    assert(/received your request/.test(await page.textContent('#submit-ok')), 'missing confirmation message');
    await page.close();
  });
  await check('approve a quote', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.evaluate(STATES['my requests']);
    await page.click('#customer-approve-1');
    await page.waitForSelector('text=We got your go-ahead');
    assert(db.jobs['1'].customerApprovedAt, 'approval not saved');
    await page.close();
  });
  await check('MakerWorld link fills time and grams; saved model match fills estimate', async () => {
    const page = await open(fixtures());
    await page.fill('#link-0', 'https://makerworld.com/en/models/123');
    await page.waitForFunction(() => document.getElementById('grams-0').value !== '', null, { timeout: 5000 });
    assert(await page.inputValue('#hours-0') === '2' && await page.inputValue('#minutes-0') === '30', 'hours/minutes not filled from lookup');
    await page.evaluate(() => { state.draftItems = [blankItem()]; render(); });
    await page.fill('#link-0', 'Planter');
    await page.fill('#name-0', 'Planter');
    await page.waitForTimeout(200);
    assert(await page.evaluate(() => state.draftItems[0].knownMinutes) === 200, 'saved model from the database was not offered');
    await page.close();
  });

  console.log('\nPricing:');
  await check('price formula and hours/minutes split', async () => {
    const page = await open(fixtures());
    const r = await page.evaluate(() => ({
      p1: calcPerPrint(90, 20, 'black'), p2: calcPerPrint(150, 85.4, 'black'), p3: calcPerPrint(60, 100, 'special'),
      split: [40, 90, 150, 59.6, 600].map(m => `${hoursFromMinutes(m)}:${minuteRemainder(m)}`).join(' ')
    }));
    assert(Math.abs(r.p1 - 4.64) < 0.005, `90 min / 20 g = ${r.p1}`);
    assert(Math.abs(r.p2 - 7.6496) < 0.005, `150 min / 85.4 g = ${r.p2}`);
    assert(Math.abs(r.p3 - (2 + 1.44 + 3.4)) < 0.005, `special filament = ${r.p3}`);
    assert(r.split === '0:40 1:30 2:30 1:0 10:0', `hours/minutes split: ${r.split}`);
    await page.close();
  });

  console.log('\nOwner tools:');
  await check('dashboard loads recent orders; Load all fetches everything', async () => {
    const db = fixtures();
    const page = await open(db);
    const urls = [];
    page.on('request', r => { if (r.url().includes('/rest/v1/jobs')) urls.push(decodeURIComponent(r.url())); });
    await page.evaluate(asOwner('dashboard'));
    await page.click('text=Load all orders');
    await page.waitForTimeout(200);
    assert(urls[0] && urls[0].includes('or=(data->>phase.is.null,data->>phase.neq.delivered,created_at.gte.'), `recent query was ${urls[0]}`);
    assert(urls.some(u => u.endsWith('/jobs?order=created_at.asc')), 'Load all did not fetch full history');
    await page.close();
  });
  await check('saved model edits sync to the database', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.evaluate(asOwner('library'));
    await page.evaluate(() => { saveModelLibraryEntry({ name: 'Vase', minutes: 300, grams: 150 }); deleteLibraryEntry(encodeURIComponent('name:planter')); });
    await page.waitForTimeout(1200);
    assert(db.library['name:vase'] && !db.library['name:planter'], `library is now: ${Object.keys(db.library).join(', ')}`);
    await page.close();
  });
  await check('gallery: add, hide and delete a design', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.evaluate(asOwner('gallery'));
    await page.fill('#gallery-title', 'Coin Display');
    await page.fill('#gallery-hours', '1');
    await page.fill('#gallery-grams', '30');
    await page.click('#gallery-save');
    await page.waitForTimeout(300);
    const added = Object.values(db.gallery).find(g => g.data.title === 'Coin Display');
    assert(added, 'design not saved');
    await page.click('.gallery-card:has-text("Coin Display") >> text=Hide');
    await page.waitForTimeout(300);
    assert(db.gallery[added.id].published === false, 'design not hidden');
    await page.click('.gallery-card:has-text("Coin Display") >> text=Delete');
    await page.waitForTimeout(300);
    assert(!db.gallery[added.id], 'design not deleted');
    await page.close();
  });

  await browser.close();
  finish();
})();
