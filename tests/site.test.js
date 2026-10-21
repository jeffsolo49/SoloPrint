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
    settings: { about: { text: 'I am a veteran spouse who prints on the side.', replyTime: 'I usually reply within a day.' },
      links: { messenger: 'https://m.me/soloprint' },
      colors: [{ id: 'black', name: 'Black', hex: '#1e1e24' }, { id: 'red', name: 'Red', hex: '#d22b2b' }, { id: 'silk', name: 'Silk Gold', hex: '#d4af37', special: true }],
      reviews: [{ id: 'r1', name: 'Mike T.', text: 'Came out perfect.', designId: 'g1' }] },
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
    if (rest.startsWith('/site_settings')) {
      if (method === 'GET') return route.fulfill({ json: [{ data: db.settings }] });
      if (!owner) return route.fulfill({ status: 401, json: {} });
      if (method === 'POST') { db.settings = JSON.parse(req.postData()).data; return route.fulfill({ status: 201, body: '' }); }
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
async function open(db, { width = 1100, height = 900, suffix = '', init } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => d.accept());
  await mockBackend(page, db);
  if (init) await page.addInitScript(init);
  await page.goto(SITE + suffix);
  await page.waitForFunction(() => !state.loading);
  await page.waitForTimeout(250);
  return page;
}

const asOwner = tab => `(async () => { state.ownerUnlocked = true; ownerSession = { token: 'OWNER-TOKEN', expiresAt: Date.now() + 3e6 }; state.view = 'owner'; state.ownerTab = '${tab}'; await loadBatches(); await loadGallery(); render(); })()`;
const STATES = {
  'home': '0',
  'home with an item': "(() => { state.draftItems[0].mode = 'idea'; updateDraft(0, 'notes', 'A desk hook'); updateDraftPrintTime(0, 'hours', '1'); updateDraft(0, 'grams', 20); render(); })()",
  'home with a multi-color print': "(() => { state.draftItems[0].mode = 'idea'; updateDraft(0, 'notes', 'A sign'); state.draftItems[0].showExtras = true; render(); toggleExtraColor(0, 0); })()",
  'home with a special order color': "(() => { state.draftItems[0].mode = 'idea'; updateDraft(0, 'notes', 'A vase'); pickColor(0, ''); render(); })()",
  'design work': "(async () => { await loadGallery(); setTab('gallery'); })()",
  'design page': "(async () => { await loadGallery(); openWork('g1'); })()",
  'my requests': "(async () => { state.historyEmail = 'jane@example.com'; await loadBatches('jane@example.com'); state.clientTab = 'jobs'; render(); })()",
  'owner login': "(() => { state.view = 'owner'; render(); })()",
  'owner dashboard': asOwner('dashboard'),
  'owner calculator': asOwner('calculator'),
  'owner gallery': asOwner('gallery'),
  'owner saved models': asOwner('library'),
  'owner sales data': asOwner('analytics'),
  'owner site settings': asOwner('settings'),
  'owner emails': asOwner('emails')
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
    for (const view of ['home', 'my requests', 'owner dashboard', 'owner gallery', 'owner emails']) {
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

  for (const width of [320, 390]) {
    await check(`request icons stay round at ${width}px`, async () => {
      const page = await open(fixtures(), { width, height: 800 });
      const sizes = await page.$$eval('.mode-icon', els => els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
      assert(sizes.length && sizes.every(([w, h]) => w === 42 && h === 42), `icon sizes ${JSON.stringify(sizes)}`);
      await page.close();
    });
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
    await page.click('text=I have an idea');
    await page.fill('#notes-0', 'A stand for my phone on the desk');
    await page.click('.swatch-pill:has-text("Red")');
    await page.click('#submit-btn');
    await page.waitForTimeout(400);
    const job = Object.values(db.jobs).find(j => j.clientName === 'Sam');
    assert(job, 'request was not saved');
    assert(job.phase === 'estimate', `new request phase is ${job.phase}`);
    assert(job.items[0].name === 'Custom: A stand for my phone on', `custom idea name: ${job.items[0].name}`);
    assert(job.items[0].color === 'Red' && job.items[0].filType === 'color', `color: ${job.items[0].color}/${job.items[0].filType}`);
    assert(/received your request/.test(await page.textContent('#submit-ok')), 'missing confirmation message');
    await page.close();
  });
  await check('special order color: explains the policy, asks which color, and saves it', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.fill('#client-name', 'Lee');
    await page.fill('#client-email', 'lee@example.com');
    await page.click('text=I have an idea');
    await page.fill('#notes-0', 'A vase');
    await page.click('button:has-text("Special order")');
    const note = await page.textContent('.special-order-note');
    assert(/1 kg/.test(note) && /about \$20/.test(note) && /2 months/.test(note) && /keep any leftover/.test(note) && /Red TPU/.test(note), note);
    assert(/PLA unless noted/.test(await page.textContent('body')), 'PLA note missing');
    await page.click('#submit-btn');
    await page.waitForTimeout(200);
    assert(!Object.values(db.jobs).some(j => j.clientName === 'Lee'), 'sent without a special color name');
    await page.fill('#special-color-0', 'Red TPU');
    await page.click('#submit-btn');
    await page.waitForTimeout(400);
    const job = Object.values(db.jobs).find(j => j.clientName === 'Lee');
    assert(job && job.items[0].specialColor === 'Red TPU' && job.items[0].filType === 'special_order', `saved ${JSON.stringify(job && job.items[0])}`);
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
    await page.click('text=I have a link');
    await page.fill('#link-0', 'https://makerworld.com/en/models/123');
    await page.waitForFunction(() => (document.getElementById('grams-0') || {}).value, null, { timeout: 5000 });
    assert(await page.inputValue('#hours-0') === '2' && await page.inputValue('#minutes-0') === '30', 'hours/minutes not filled from lookup');
    await page.evaluate(() => { state.draftItems = [{ ...blankItem(), mode: 'link' }]; render(); });
    await page.fill('#name-0', 'Planter');
    await page.waitForTimeout(200);
    assert(await page.evaluate(() => state.draftItems[0].knownMinutes) === 200, 'saved model from the database was not offered');
    await page.close();
  });

  await check('home page shows about, how it works, reviews and Message me', async () => {
    const page = await open(fixtures());
    const text = await page.textContent('main');
    assert(text.includes('veteran spouse') && text.includes('How it works') && text.includes('Came out perfect'), 'a home section is missing');
    assert(await page.locator('a.btn-contact[href="https://m.me/soloprint"]').count() === 1, 'Message me button missing');
    await page.close();
  });
  await check('half-filled request survives a reload, and is cleared after sending', async () => {
    const page = await open(fixtures());
    await page.fill('#client-name', 'Dana');
    await page.click('text=I have an idea');
    await page.fill('#notes-0', 'A name sign');
    await page.waitForTimeout(600);
    await page.reload();
    await page.waitForFunction(() => !state.loading);
    assert(await page.inputValue('#client-name') === 'Dana' && await page.inputValue('#notes-0') === 'A name sign', 'draft was not restored');
    await page.fill('#client-email', 'dana@example.com');
    await page.click('#submit-btn');
    await page.waitForTimeout(500);
    assert(!(await page.evaluate(() => localStorage.getItem('soloprint_request_draft_v1'))), 'draft not cleared after sending');
    await page.close();
  });
  await check('email links open the order, and never load other customers on the owner\'s device', async () => {
    const db = fixtures();
    const page = await open(db, { suffix: '?requests=jane%40example.com#order-2', init: () => localStorage.setItem('soloprint_owner_session_v1', JSON.stringify({ token: 'OWNER-TOKEN', expiresAt: Date.now() + 3e6 })) });
    assert(await page.evaluate(() => state.clientTab === 'jobs' && state.historyEmail === 'jane@example.com'), 'did not open My Requests for the linked email');
    assert(!db.log.includes('GET /jobs owner'), 'customer view loaded every order');
    assert(await page.locator('#order-2').count() === 1, 'linked order not shown');
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
  const withRolls = db => {
    const day = 1440;
    db.jobs['r1'] = { id: 'r1', clientName: 'Lee', clientEmail: 'lee@example.com', createdAt: ago(12 * day), phase: 'delivered', phaseHistory: { order_received: ago(10 * day) },
      items: [{ name: 'Phone case', qty: 1, filType: 'special_order', specialColor: 'Red TPU', minutes: 90, grams: 300 }] };
    db.jobs['r2'] = { id: 'r2', clientName: 'Lee', clientEmail: 'lee@example.com', createdAt: ago(5 * day), phase: 'delivered', phaseHistory: { order_received: ago(5 * day) },
      items: [{ name: 'Case 2', qty: 2, filType: 'special_order', specialColor: 'Red TPU', useLeftover: true, leftoverFrom: 'r1', minutes: 90, grams: 100 }] };
    db.jobs['r3'] = { id: 'r3', clientName: 'Lee', clientEmail: 'lee@example.com', createdAt: ago(80 * day), phase: 'delivered', phaseHistory: { order_received: ago(70 * day) },
      items: [{ name: 'Old', qty: 1, filType: 'special_order', specialColor: 'Blue PLA', minutes: 30, grams: 50 }] };
    db.jobs['r4'] = { id: 'r4', clientName: 'Lee', clientEmail: 'lee@example.com', createdAt: ago(day), phase: 'quote_sent', phaseHistory: {},
      items: [{ name: 'Not bought yet', qty: 1, filType: 'special_order', specialColor: 'Green PETG', minutes: 30, grams: 50 }] };
    return db;
  };
  await check('leftover roll: same color only, 1000 g in all, within 2 months', async () => {
    const db = withRolls(fixtures());
    const page = await open(db);
    await page.fill('#client-name', 'Lee');
    await page.fill('#client-email', 'lee@example.com');
    await page.click('text=I have an idea');
    await page.fill('#notes-0', 'Another case');
    await page.click('button:has-text("Special order")');
    await page.click('#special-leftover-0');
    await page.waitForSelector('[aria-label="Your leftover rolls"]');
    const offered = await page.$$eval('[aria-label="Your leftover rolls"] button', bs => bs.map(b => b.textContent.trim()));
    assert(offered.length === 1 && /^Red TPU: about 500 g left/.test(offered[0]), `offered ${JSON.stringify(offered)} (1000 - 300 - 2x100; Blue expired, Green not bought)`);
    await page.click('[aria-label="Your leftover rolls"] button');
    assert(await page.inputValue('#special-color-0') === 'Red TPU', 'color should be the roll color');
    assert(await page.getAttribute('#special-color-0', 'readonly') !== null, 'roll color should be locked');
    await page.evaluate(() => updateDraft(0, 'grams', 600));
    await page.click('#submit-btn');
    await page.waitForTimeout(200);
    assert(/500 g left/.test(await page.textContent('#submit-err')), 'over-limit request should be stopped');
    await page.evaluate(() => updateDraft(0, 'grams', 400));
    await page.click('#submit-btn');
    await page.waitForTimeout(400);
    const job = Object.values(db.jobs).find(j => j.items[0] && j.items[0].notes === 'Another case');
    assert(job && job.items[0].useLeftover === true && job.items[0].leftoverFrom === 'r1', `saved ${JSON.stringify(job && job.items[0])}`);
    await page.close();
  });
  await check('multi-color print can mix stocked colors with a leftover roll', async () => {
    const db = withRolls(fixtures());
    const page = await open(db);
    await page.fill('#client-name', 'Lee');
    await page.fill('#client-email', 'lee@example.com');
    await page.click('text=I have an idea');
    await page.fill('#notes-0', 'Two-tone case');
    await page.click('.swatch-pill:has-text("Black")');
    await page.click('text=+ Add another color');
    await page.click('#extra-leftover-0');
    await page.waitForSelector('[aria-label="Other colors in this print"] button:has-text("Red TPU")');
    const chips = await page.$$eval('[aria-label="Other colors in this print"] button', bs => bs.map(b => b.textContent.replace(/\s+/g, ' ').trim()));
    assert(chips.length === 3 && /^Red$/.test(chips[0]) && /^Red TPU/.test(chips[1]) && /^Silk Gold/.test(chips[2]), `chips ${JSON.stringify(chips)}`);
    await page.click('[aria-label="Other colors in this print"] button:has-text("Red TPU")');
    await page.click('[aria-label="Other colors in this print"] button >> text=/^\\s*Red\\s*$/');
    await page.evaluate(() => updateDraft(0, 'grams', 1800));   // 600 g per color: more than the 500 g left
    await page.click('#submit-btn');
    await page.waitForTimeout(200);
    assert(/500 g left/.test(await page.textContent('#submit-err')), 'over-limit share should be stopped');
    await page.evaluate(() => updateDraft(0, 'grams', 300));
    const rate = await page.evaluate(() => itemRate(state.draftItems[0]));
    assert(Math.abs(rate - 0.016) < 1e-9, `rate ${rate} (Black and Red at 0.024, roll at 0)`);
    await page.click('#submit-btn');
    await page.waitForTimeout(400);
    const job = Object.values(db.jobs).find(j => j.items[0] && j.items[0].notes === 'Two-tone case');
    const it = job && job.items[0];
    assert(it && it.color === 'Black' && it.extraColors.map(p => p.name).join(',') === 'Red,Red TPU'
      && it.extraColors[1].filType === 'leftover' && it.extraColors[1].leftoverFrom === 'r1', `saved ${JSON.stringify(it)}`);
    await page.close();
  });
  await check('colors are kept in A-Z order for customers and the owner', async () => {
    const db = fixtures();
    db.settings.colors = [{ id: 'w', name: 'White', hex: '#f4f4f4' }, { id: 'b', name: 'Black', hex: '#1e1e24' }, { id: 'r', name: 'red', hex: '#d22b2b' }];
    const page = await open(db);
    await page.click('text=I have an idea');
    const pills = await page.$$eval('.swatch-pill', bs => bs.map(b => b.textContent.trim()));
    assert(pills.join(',') === 'Black,red,White', `customer order ${pills}`);
    await page.evaluate(asOwner('settings'));
    await page.click('text=Add a color');
    const last = page.locator('input[aria-label="Color name"]').nth(3);
    await last.fill('Aqua');
    await last.dispatchEvent('change');
    const names = await page.$$eval('input[aria-label="Color name"]', is => is.map(i => i.value));
    assert(names.join(',') === 'Aqua,Black,red,White', `owner order ${names}`);
    await page.click('#settings-save');
    await page.waitForTimeout(300);
    assert(db.settings.colors.map(c => c.name).join(',') === 'Aqua,Black,red,White', `saved ${db.settings.colors.map(c => c.name)}`);
    await page.close();
  });
  await check('owner sees whether a leftover roll covers the order', async () => {
    const db = withRolls(fixtures());
    const item = { name: 'More', qty: 1, filType: 'special_order', specialColor: 'Red TPU', useLeftover: true, leftoverFrom: 'r1', grams: 450 };
    db.jobs['ok1'] = { id: 'ok1', clientName: 'Lee', clientEmail: 'lee@example.com', createdAt: ago(60), phase: 'estimate', items: [item] };
    db.jobs['bad1'] = { id: 'bad1', clientName: 'Lee', clientEmail: 'lee@example.com', createdAt: ago(50), phase: 'estimate', items: [{ ...item, grams: 600 }] };
    db.jobs['bad2'] = { id: 'bad2', clientName: 'Lee', clientEmail: 'lee@example.com', createdAt: ago(40), phase: 'estimate', items: [{ ...item, specialColor: 'Blue PLA', leftoverFrom: 'r3', grams: 10 }] };
    db.jobs['bad3'] = { id: 'bad3', clientName: 'Sam', clientEmail: 'sam@example.com', createdAt: ago(30), phase: 'estimate', items: [{ ...item, grams: 10 }] };
    const page = await open(db);
    await page.evaluate(asOwner('dashboard'));
    const text = id => page.textContent(`#order-${id} .roll-check`);
    // ok1 and bad1 both draw on r1 (500 g left after r2); each is checked against the other's use too.
    assert(/Needs 600 g but their Red TPU roll has 50 g left/.test(await text('bad1')), await text('bad1'));
    assert(/No Blue PLA roll|expired/.test(await text('bad2')), await text('bad2'));
    assert(/No Red TPU roll found/.test(await text('bad3')), await text('bad3'));
    assert(await page.inputValue('#special-cost-bad1') === '20.00', 'a roll problem should pre-fill a new roll charge');
    await page.close();
  });
  await check('owner sets the special order color cost and it is added to the quote', async () => {
    const db = fixtures();
    db.jobs['s1'] = { id: 's1', clientName: 'Pat', clientEmail: 'pat@example.com', createdAt: ago(60), phase: 'estimate',
      items: [{ name: 'Vase', qty: 1, filType: 'special_order', specialColor: 'Red TPU', grams: 10 }] };
    const page = await open(db);
    await page.evaluate(asOwner('dashboard'));
    assert(await page.inputValue('#special-cost-s1') === '20.00', 'cost should default to $20');
    await page.fill('#hours-s1-0', '1');
    await page.fill('#special-cost-s1', '18');
    await page.click('#approve-btn-s1');
    await page.waitForTimeout(300);
    assert(db.jobs['s1'].specialOrderCost === 18 && db.jobs['s1'].phase === 'quote_sent', `saved ${db.jobs['s1'].specialOrderCost}/${db.jobs['s1'].phase}`);
    const total = await page.evaluate(() => batchTotal(state.batches.find(b => b.id === 's1')));
    assert(Math.abs(total - 21.44) < 0.001, `total ${total} (2 + 1.44 print time + 18 roll, no per-gram charge)`);
    const costs = await page.evaluate(() => [
      specialOrderCost({ items: [{ filType: 'special', colorId: 'silk', color: 'Silk Gold' }] }),
      specialOrderCost({ items: [{ filType: 'special_order', specialColor: 'Red TPU', useLeftover: true }] }),
      cleanItem({ filType: 'special', specialColor: 'Red TPU' }).filType
    ]);
    assert(costs[0] === 0, 'a stocked special color is not a special order');
    assert(costs[1] === 0, 'leftover roll should not add a roll cost');
    assert(costs[2] === 'special_order', 'first-version special orders should be recognized');
    await page.close();
  });
  await check('typing a color name fills in the color picker', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.evaluate(asOwner('settings'));
    await page.click('text=Add a color');
    const n = await page.evaluate(() => state.settingsDraft.colors.length - 1);
    const name = page.locator('input[aria-label="Color name"]').nth(n);
    for (const [typed, hex] of [['Silk Rose Gold', '#b76e79'], ['Matte Dark Blue', '#00008b'], ['Glow-in-the-dark green', '#c8f5a0'], ['crimson', '#dc143c']]) {
      await name.fill(typed);
      const got = await page.inputValue(`#color-hex-${n}`);
      assert(got === hex, `${typed}: ${got}, expected ${hex}`);
    }
    await page.evaluate(n => { const el = document.getElementById(`color-hex-${n}`); el.value = '#123456'; el.dispatchEvent(new Event('input')); }, n);
    await name.fill('Red');
    assert(await page.inputValue(`#color-hex-${n}`) === '#123456', 'a hand-picked color should not be replaced');
    await page.close();
  });
  await check('site settings save', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.evaluate(asOwner('settings'));
    await page.waitForTimeout(200);
    await page.fill('#set-reply', 'Replies within two days');
    await page.click('#settings-save');
    await page.waitForTimeout(300);
    assert(db.settings.about.replyTime === 'Replies within two days', `saved reply time: ${db.settings.about && db.settings.about.replyTime}`);
    await page.close();
  });
  await check('emails page: edit, preview, save and reset', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.evaluate(asOwner('emails'));
    const cards = await page.$$eval('.email-card', els => els.length);
    assert(cards === 11, `${cards} email cards`);
    assert(/Your SoloPrint quote: \$15\.68/.test(await page.textContent('#email-preview-quote')), 'quote preview should fill in the sample total');
    await page.fill('#email-subject-quote', 'Quote for {title}: ${total}');
    assert(/Quote for Benchy, Phone stand: \$15\.68/.test(await page.textContent('#email-preview-quote')), 'preview should update while typing');
    await page.fill('#email-body-footer', 'Thanks!\nJeff');
    assert(/Thanks!\s+Jeff/.test(await page.textContent('#email-preview-printing')), 'sign-off change should show in other previews');
    await page.click('#emails-save');
    await page.waitForTimeout(300);
    assert(db.settings.emails.quote.subject === 'Quote for {title}: ${total}' && !db.settings.emails.quote.body, `saved ${JSON.stringify(db.settings.emails)}`);
    assert(db.settings.emails.footer.body === 'Thanks!\nJeff', 'footer not saved');
    assert(db.settings.about.text.includes('veteran spouse'), 'other settings should be kept');
    await page.click('#email-quote button:has-text("Reset to default")');
    await page.click('#emails-save');
    await page.waitForTimeout(300);
    assert(!db.settings.emails.quote && db.settings.emails.footer, `after reset ${JSON.stringify(db.settings.emails)}`);
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
