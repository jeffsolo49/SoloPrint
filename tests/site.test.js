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
      g1: { id: 'g1', published: true, sort_order: 0, data: { title: 'Dragon Organizer', description: 'Started as a request.\n\nPrinted three test versions.', photos: ['https://img.test/d1.png', 'https://img.test/d2.png'], videos: ['dQw4w9WgXcQ'], filType: 'black', minutes: 150, grams: 85.4 } },
      g2: { id: 'g2', published: true, sort_order: 1, data: { title: 'Name Sign', photos: ['https://img.test/s.png'], parts: [{ id: 'p1', name: 'Plate', grams: 30, photo: 'https://img.test/s.png' }, { id: 'p2', name: 'Letters', grams: 5, optional: true }] } },
      g3: { id: 'g3', published: false, sort_order: 2, data: { title: 'Hidden prototype', photos: [] } }
    },
    library: { 'name:planter': { name: 'Planter', minutes: 200, grams: 110, filType: 'black' } },
    settings: { about: { text: 'I print custom designs in my spare time.', replyTime: 'I usually reply within a day.' },
      links: { messenger: 'https://m.me/soloprint' },
      colors: [{ id: 'black', name: 'Black', hex: '#1e1e24' }, { id: 'red', name: 'Red', hex: '#d22b2b' }, { id: 'silk', name: 'Silk Gold', hex: '#d4af37', special: true }],
      reviews: [{ id: 'r1', name: 'Mike T.', text: 'Came out perfect.', designId: 'g1' }] },
    private: {}, reviews: {}, uploads: [], drafts: {}, messages: [],
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
    if (url.startsWith('https://api.github.com/repos/jeffsolo49/soloprint/deployments')) {
      return route.fulfill({ json: [{ created_at: new Date(Date.now() - (db.deployedMinsAgo ?? 59) * 60000 - 5000).toISOString() }], headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.startsWith('https://api.github.com/repos/jeffsolo49/soloprint/pulls')) {
      return route.fulfill({ json: [
        { number: 2, title: 'CLAUDE.md note', merged_at: new Date().toISOString(), body: 'x' },
        { number: 1, title: 'Links work everywhere', merged_at: new Date().toISOString(), body: '- Links: https://example.com/a\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nhttps://claude.ai/code/session_abc' }
      ], headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    const rest = url.split('/rest/v1')[1] || '';
    if (rest) db.log.push(`${method} ${rest.split('?')[0]} ${owner ? 'owner' : 'anon'}`);
    // Like supabase/messages.sql: the owner reads and writes all messages; customers only through the RPCs.
    if (rest.startsWith('/order_messages')) {
      if (!owner) return route.fulfill({ status: 401, json: {} });
      if (method === 'GET') return route.fulfill({ json: db.messages });
      if (method === 'POST') {
        const m = JSON.parse(req.postData());
        const row = { id: db.messages.length + 1, subject: '', created_at: new Date().toISOString(), ...m };
        db.messages.push(row);
        return route.fulfill({ status: 201, json: [row] });
      }
    }
    if (rest.startsWith('/rpc/customer_messages') || rest.startsWith('/rpc/customer_send_message')) {
      const a = JSON.parse(req.postData());
      const job = db.jobs[a.p_job_id];
      const mine = job && String(job.clientEmail).toLowerCase() === String(a.p_email).trim().toLowerCase();
      if (rest.startsWith('/rpc/customer_send_message')) {
        if (!mine || !String(a.p_body || '').trim()) return route.fulfill({ status: 400, json: {} });
        db.messages.push({ id: db.messages.length + 1, job_id: a.p_job_id, sender: 'customer', via: 'site', subject: '', body: a.p_body.trim(), created_at: new Date().toISOString() });
        return route.fulfill({ status: 204, body: '' });
      }
      return route.fulfill({ json: mine ? db.messages.filter(m => m.job_id === a.p_job_id).map(m => ({ id: m.id, sender: m.sender, via: m.via, subject: m.subject, body: m.body, at: m.created_at })) : [] });
    }
    if (rest.startsWith('/rpc/customer_jobs')) {
      const { email } = JSON.parse(req.postData());
      return route.fulfill({ json: Object.values(db.jobs).filter(j => j.clientEmail === email) });
    }
    if (rest.startsWith('/rpc/submit_job')) {
      // Like supabase/security.sql: prices, charges and order records are the owner's to set.
      const { job } = JSON.parse(req.postData());
      ['extraCharges', 'rates', 'specialOrderCost', 'designTerms', 'stockTaken', 'paidAt', 'finishedPhotos', 'ownerEditedAt', 'depositAt', 'depositAmount', 'customerApprovedAt', 'status'].forEach(k => delete job[k]);
      job.phase = 'estimate'; job.paymentStatus = 'unpaid';
      job.items = job.items.map(it => { const { ownerPrice, ...rest } = it; return rest; });
      db.jobs[job.id] = job; return route.fulfill({ status: 204, body: '' });
    }
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
    if (rest.startsWith('/rpc/submit_review')) {
      const r = JSON.parse(req.postData());
      const job = db.jobs[r.p_job_id];
      if (!job || job.phase !== 'delivered' || String(job.clientEmail).toLowerCase() !== String(r.p_email).toLowerCase()) return route.fulfill({ status: 400, json: { message: 'order not found' } });
      db.reviews[r.p_job_id] = { job_id: r.p_job_id, name: r.p_name, text: r.p_text, rating: r.p_rating, photos: r.p_photos || [], status: 'new' };
      return route.fulfill({ status: 204, body: '' });
    }
    if (rest.startsWith('/rpc/order_queue')) {
      const q = Object.values(db.jobs).filter(j => ['order_received', 'production'].includes(j.phase))
        // Like supabase/queue.sql: place in line = deposit (or full payment) time; none yet = last.
        .map(j => ({ at: j.depositAt || j.paidAt || null, printing: j.phase === 'production', custom: !!j.designTerms || (j.items || []).some(it => it.mode === 'idea') }))
        .sort((a, b) => (a.at ? 0 : 1) - (b.at ? 0 : 1) || String(a.at).localeCompare(String(b.at)));
      return route.fulfill({ json: q });
    }
    if (rest.startsWith('/rpc/save_request_draft')) {
      const d = JSON.parse(req.postData());
      db.drafts[d.p_email.toLowerCase()] = { id: '11111111-2222-3333-4444-555555555555', email: d.p_email, name: d.p_name, data: d.p_data };
      return route.fulfill({ status: 204, body: '' });
    }
    if (rest.startsWith('/rpc/clear_request_draft')) { delete db.drafts[JSON.parse(req.postData()).p_email.toLowerCase()]; return route.fulfill({ status: 204, body: '' }); }
    if (rest.startsWith('/rpc/get_request_draft')) {
      const id = JSON.parse(req.postData()).p_id;
      const d = Object.values(db.drafts).find(x => x.id === id);
      return route.fulfill({ json: d ? { name: d.name, email: d.email, data: d.data } : null });
    }
    if (rest.startsWith('/owner_private')) {
      if (!owner) return route.fulfill({ status: 401, json: {} });
      if (method === 'GET') return route.fulfill({ json: Object.entries(db.private).map(([key, data]) => ({ key, data })) });
      if (method === 'POST') { const row = JSON.parse(req.postData()); db.private[row.key] = row.data; return route.fulfill({ status: 201, body: '' }); }
    }
    if (rest.startsWith('/customer_reviews')) {
      if (!owner) return route.fulfill({ status: 401, json: {} });
      if (method === 'GET') return route.fulfill({ json: Object.values(db.reviews).filter(r => r.status === 'new') });
      if (method === 'PATCH') { db.reviews[decodeURIComponent(url.split('job_id=eq.')[1])].status = JSON.parse(req.postData()).status; return route.fulfill({ status: 204, body: '' }); }
    }
    if (url.includes('/storage/v1/object/public/')) {
      const file = (db.files || {})[url.split('/storage/v1/object/public/')[1]];
      return route.fulfill({ body: file ? file.body : PNG, contentType: file ? file.type : 'image/png', headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.includes('/storage/v1/object/')) {
      if (!owner && !url.includes('/object/gallery/reviews/')) return route.fulfill({ status: 401, json: {} });
      db.uploads.push(url.split('/storage/v1/object/')[1]);
      (db.files = db.files || {})[url.split('/storage/v1/object/')[1]] = { body: req.postDataBuffer(), type: req.headers()['content-type'] };
      return route.fulfill({ json: { Key: 'ok' } });
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

// Waits for the "we received your request" message instead of a fixed time (CI machines can be slow).
const requestSent = page => page.waitForFunction(() => /received your request/.test((document.getElementById('submit-ok') || {}).textContent || ''), null, { timeout: 15000 });

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

// 'settings/colors' opens a Settings section.
const asOwner = tab => `(async () => { state.ownerUnlocked = true; ownerSession = { token: 'OWNER-TOKEN', expiresAt: Date.now() + 3e6 }; state.view = 'owner'; state.ownerTab = '${tab.split('/')[0]}'; state.settingsTab = '${tab.split('/')[1] || ''}'; await loadBatches(); await loadGallery(); render(); })()`;
const STATES = {
  'home': '0',
  'home with an item': "(() => { state.draftItems[0].mode = 'idea'; updateDraft(0, 'notes', 'A desk hook'); updateDraftPrintTime(0, 'hours', '1'); updateDraft(0, 'grams', 20); render(); })()",
  'home with a multi-color print': "(() => { state.draftItems[0].mode = 'idea'; updateDraft(0, 'notes', 'A sign'); state.draftItems[0].showExtras = true; render(); toggleExtraColor(0, 0); })()",
  'home with color info': "(() => { state.settings.colors[2].description = 'Shimmery gold'; state.settings.colors[2].link = 'https://example.com/silk'; state.draftItems[0].mode = 'idea'; pickColor(0, 'silk'); render(); })()",
  'quote with design terms': "(async () => { state.historyEmail = 'jane@example.com'; await loadBatches('jane@example.com'); state.batches.find(b => b.id === '1').designTerms = DEFAULT_DESIGN_TERMS; state.clientTab = 'jobs'; render(); })()",
  'home picking past work': "(async () => { await loadGallery(); setItemMode(0, 'gallery'); })()",
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
  'owner settings colors': asOwner('settings/colors'),
  'owner settings prices': asOwner('settings/prices'),
  'owner settings wording': asOwner('settings/wording'),
  'owner settings vacation': asOwner('settings/vacation'),
  'owner settings reviews': asOwner('settings/reviews'),
  'owner numbers': asOwner('numbers'),
  'faq page': "(() => { state.settings.faq = [{ id: 'q1', q: 'How long?', a: 'About a week.', live: true }, { id: 'q2', q: 'Shipping?', a: 'USPS.', live: true }, { id: 'q3', q: 'Pay?', a: 'Venmo.', live: true }]; setTab('faq'); })()",
  'owner settings site text': asOwner('settings/text'),
  'color with a photo picked': "(() => { state.settings.colors.find(c => c.id === 'red').photo = 'https://img.test/red.png'; state.draftItems[0].mode = 'idea'; render(); pickColor(0, 'red'); })()",
  'owner settings faq': "(async () => { await " + asOwner('settings/faq') + "; state.settingsDraft.faq = [{ id: 'f1', q: 'How long?', a: 'About a week.', live: false }]; render(); })()",
  'owner settings show/hide': asOwner('settings/features'),
  'owner emails': asOwner('emails'),
  'owner filament': "(async () => { await " + asOwner('filament') + "; state.ownerPrivate.inventory = { black: { grams: 120 }, red: { grams: 900 } }; render(); })()",
  'owner money': asOwner('money'),
  'design page with parts': "(async () => { await loadGallery(); openWork('g2'); })()",
  'request with a color per part': "(async () => { await loadGallery(); requestGalleryItem('g2'); })()",
  'owner gallery parts': "(async () => { await " + asOwner('gallery') + "; editGalleryItem('g2'); })()",
  'owner editing a request': "(async () => { await " + asOwner('dashboard') + "; startOwnerEdit('3'); })()",
  'leftover rolls and a review form': "(async () => { state.historyEmail = 'jane@example.com'; await loadBatches('jane@example.com'); state.batches[1].phase = 'delivered'; state.clientTab = 'jobs'; state.reviewFor = { id: '2', email: 'jane@example.com' }; render(); })()",
  'home in vacation mode': "(() => { state.settings.vacation = { on: true, until: 'Nov 3' }; render(); })()"
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
    for (const view of ['home', 'my requests', 'owner dashboard', 'owner gallery', 'owner emails', 'owner filament', 'owner money', 'leftover rolls and a review form']) {
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
      assert(sizes.length && sizes.every(([w, h]) => w === h && w >= 28), `icon sizes ${JSON.stringify(sizes)}`);
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
    await requestSent(page);
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
    await requestSent(page);
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
    assert(text.includes('spare time') && text.includes('How it works') && text.includes('Came out perfect'), 'a home section is missing');
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
    await requestSent(page);
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
    await requestSent(page);
    const job = Object.values(db.jobs).find(j => j.items[0] && j.items[0].notes === 'Another case');
    assert(job && job.items[0].useLeftover === true && job.items[0].leftoverFrom === 'r1', `saved ${JSON.stringify(job && job.items[0])}`);
    await page.close();
  });
  await check('multi-color: customer says which parts go in which color; owner prices each color by its grams', async () => {
    const db = fixtures();
    db.settings.colors.find(c => c.id === 'red').rate = 0.044;
    const page = await open(db);
    await page.fill('#client-name', 'Lou');
    await page.fill('#client-email', 'lou@example.com');
    await page.click('text=I have an idea');
    await page.fill('#notes-0', 'Owl with red eyes');
    await page.click('.swatch-pill:has-text("Black")');
    assert(!(await page.$('#color-parts-0-0')), 'one color should not ask about parts');
    await page.click('text=+ Add another color');
    await page.click('[aria-label="Other colors in this print"] button >> text=/^\\s*Red\\s*$/');
    assert(/Which parts should be which color/.test(await page.textContent('.color-parts')), 'no parts question');
    await page.fill('#color-parts-0-0', 'the body');
    await page.fill('#color-parts-0-1', 'the eyes');
    await page.click('#submit-btn');
    await requestSent(page);
    await page.close();
    const job = Object.values(db.jobs).find(j => j.clientName === 'Lou');
    assert(job.items[0].mainParts === 'the body' && job.items[0].extraColors[0].parts === 'the eyes', JSON.stringify(job.items[0]));
    const owner = await open(db);
    await owner.evaluate(asOwner('dashboard'));
    assert(/Which parts: Black: the body; Red: the eyes/.test(await owner.textContent(`#order-${job.id}`)), 'owner does not see which parts');
    await owner.fill(`#hours-${job.id}-0`, '1');
    await owner.fill(`#minutes-${job.id}-0`, '0');
    await owner.fill(`#ograms-${job.id}-0`, '80');
    await owner.fill(`#ograms-${job.id}-0-x0`, '20');
    assert(/\$6\.24/.test(await owner.textContent(`#opval-${job.id}-0`)), 'preview should be 2 + 1.44 + 80 g x 0.024 + 20 g x 0.044');
    await owner.click(`#approve-btn-${job.id}`);
    await owner.waitForTimeout(300);
    assert(db.jobs[job.id].items[0].extraColors[0].grams === 20 && db.jobs[job.id].items[0].grams === 80, JSON.stringify(db.jobs[job.id].items[0]));
    assert(await owner.evaluate(id => +batchTotal(state.batches.find(b => b.id === id)).toFixed(2), job.id) === 6.24, 'quote total');
    // Calculator: the same print, colors added with their own grams.
    await owner.evaluate(asOwner('calculator'));
    await owner.fill('#owner-calc-hours', '1');
    await owner.fill('#owner-calc-mins', '0');
    await owner.fill('#owner-calc-grams', '80');
    await owner.selectOption('#owner-calc-fil', 'black');
    await owner.click('#calc-add-color');
    await owner.selectOption('#calc-extra-color-0', 'red');
    await owner.fill('#calc-extra-grams-0', '20');
    const live = await owner.textContent('#owner-calc-live-preview');
    assert(/\$6\.24/.test(live) && /Black \+ Red/.test(live) && /100\.0g/.test(live), live);
    await owner.close();
  });
  await check('estimates everywhere use color prices and parts: past work, design form, order card, edit form', async () => {
    const db = fixtures();
    db.settings.colors.find(c => c.id === 'red').rate = 0.044;
    db.gallery.g1.data.colorId = 'red';   // 2 + 150 min x 0.024 + 85.4 g x 0.044 = 9.36
    db.gallery.g2.data = { title: 'Name Sign', photos: ['https://img.test/s.png'], minutes: 60, filType: 'color',
      parts: [{ id: 'p1', name: 'Plate', grams: 30 }, { id: 'p2', name: 'Letters', grams: 5, defaultColor: 'red' }] };   // 2 + 1.44 + 30 x 0.024 + 5 x 0.044 = 4.38
    const page = await open(db);
    await page.evaluate(async () => { await loadGallery(); setTab('gallery'); });
    const grid = await page.textContent('main');
    assert(/\$9\.36/.test(grid) && /\$4\.38/.test(grid), 'past work prices should use the color price and the parts');
    await page.close();
    const owner = await open(db);
    await owner.evaluate(asOwner('gallery'));
    await owner.evaluate(() => editGalleryItem('g1'));
    assert((await owner.inputValue('#gallery-fil')) === 'red' && /\$9\.36/.test(await owner.textContent('#gallery-form-price')), 'design form price');
    await owner.selectOption('#gallery-fil', 'black');
    assert(/\$7\.65/.test(await owner.textContent('#gallery-form-price')), 'design form price after picking Black');   // 2 + 3.6 + 85.4 x 0.024
    // A request for the parts design, edited by the owner: parts keep their colors; the estimate updates.
    db.jobs.pe = { id: 'pe', clientName: 'Lin', clientEmail: 'lin@example.com', createdAt: ago(60), phase: 'estimate', paymentStatus: 'unpaid',
      items: [{ name: 'Name Sign', mode: 'gallery', galleryId: 'g2', qty: 1, minutes: 60, grams: 30, filType: 'color', colorId: 'black', color: 'Black', mainParts: 'Plate',
        extraColors: [{ name: 'Red', filType: 'color', colorId: 'red', grams: 5, parts: 'Letters' }],
        designParts: [{ id: 'p1', name: 'Plate', grams: 30, colorId: 'black', include: true }, { id: 'p2', name: 'Letters', grams: 5, colorId: 'red', include: true }] }] };
    await owner.evaluate(asOwner('dashboard'));
    const card = await owner.textContent('#order-pe');
    assert(/Red: 5\.0 g × \$0\.044/.test(card) && /Black: 30\.0 g × \$0\.024/.test(card), 'order card should show each color and its price');
    await owner.click('#edit-request-pe');
    assert(/\$4\.38/.test(await owner.textContent('#oe-est-0')), 'edit form estimate');
    await owner.selectOption('#oe-part-color-0-1', 'silk');   // special rate 0.034
    assert(/\$4\.33/.test(await owner.textContent('#oe-est-0')) && /Silk Gold: 5\.0 g/.test(await owner.textContent('#oe-est-0')), await owner.textContent('#oe-est-0'));
    await owner.fill('#oe-minutes-0', '90');
    assert(/\$5\.05/.test(await owner.textContent('#oe-est-0')), 'print time should update the estimate');
    await owner.click('#owner-edit-save');
    await owner.waitForSelector('#edit-request-pe');
    assert(db.jobs.pe.items[0].extraColors[0].colorId === 'silk' && db.jobs.pe.items[0].minutes === 90, JSON.stringify(db.jobs.pe.items[0]));
    await owner.close();
  });
  await check('colors start as White; the owner picks a starting color for each part', async () => {
    const db = fixtures();
    db.settings.colors.push({ id: 'white', name: 'White', hex: '#f4f4f4' });
    db.gallery.g1.data.parts = [{ id: 'p1', name: 'Body', grams: 60 }, { id: 'p2', name: 'Eyes', grams: 5 }];
    const owner = await open(db);
    await owner.evaluate(asOwner('gallery'));
    await owner.evaluate(() => editGalleryItem('g1'));
    assert((await owner.inputValue('#part-default-0')) === '', 'parts should start as White');
    await owner.selectOption('#part-default-1', 'red');
    await owner.click('#gallery-save');
    await owner.waitForTimeout(300);
    assert(db.gallery.g1.data.parts[1].defaultColor === 'red' && !db.gallery.g1.data.parts[0].defaultColor, JSON.stringify(db.gallery.g1.data.parts));
    await owner.close();
    const page = await open(db);
    await page.click('text=I have an idea');
    assert(await page.evaluate(() => state.draftItems[0].colorId === 'white'), 'a new item should start White');
    await page.evaluate(async () => { await loadGallery(); requestGalleryItem('g1'); });
    await page.waitForSelector('#part-color-0-1');
    assert((await page.inputValue('#part-color-0-0')) === 'white' && (await page.inputValue('#part-color-0-1')) === 'red', 'parts should start White and in the owner\'s starting color');
    await page.close();
  });
  await check('optional add-on parts: customers choose them; they add grams, or their price to a set price', async () => {
    const db = fixtures();
    db.gallery.g1.data.parts = [{ id: 'p1', name: 'Body', grams: 60 }, { id: 'p2', name: 'Stand', grams: 15, optional: true, price: 4, minutes: 30 }];
    const owner = await open(db);
    await owner.evaluate(asOwner('gallery'));
    await owner.evaluate(() => editGalleryItem('g1'));
    assert(await owner.isChecked('#part-optional-1') && !(await owner.isChecked('#part-optional-0')) && (await owner.inputValue('#part-price-1')) === '4' && (await owner.inputValue('#part-minutes-1')) === '30', 'owner form should show the add-on, its price and time');
    assert(!(await owner.$('#part-price-0')), 'required parts have no add-on price');
    await owner.close();
    const page = await open(db, { suffix: '?design=dragon-organizer' });
    await page.waitForSelector('.design-parts');
    assert(/Optional add-on/.test(await page.textContent('.design-parts')), 'design page should mark the add-on');
    await page.click('button:has-text("Request this")');
    await page.waitForSelector('#part-add-0-1');
    assert(!(await page.$('#part-color-0-1')) && !(await page.isChecked('#part-add-0-1')), 'add-on starts off, with no color menu');
    assert(/\$7\.04/.test(await page.textContent('#customer-price-preview-0')), 'without the add-on: 2 + 150 x 0.024 + 60 g x 0.024');
    await page.check('#part-add-0-1');
    await page.waitForSelector('#part-color-0-1');
    let it = await page.evaluate(() => state.draftItems[0]);
    assert(it.grams === 75 && it.knownMinutes === 180 && it.mainParts === 'Body, Stand (add-on)', JSON.stringify(it));
    assert(/\$8\.12/.test(await page.textContent('#customer-price-preview-0')), 'with the add-on: 2 + 180 min x 0.024 + 75 g x 0.024');
    await page.uncheck('#part-add-0-1');
    assert(await page.evaluate(() => state.draftItems[0].knownMinutes === 150), 'unticking should take the time back off');
    await page.close();
    // A request started before the part was made optional (saved in the customer's draft) follows the design now.
    const stale = await open(db);
    await stale.evaluate(async () => {
      await loadGallery();
      state.draftItems[0] = { ...blankItem(), mode: 'gallery', galleryId: 'g1', name: 'Dragon Organizer', knownMinutes: 150, knownFromLibrary: true,
        designParts: [{ id: 'p1', name: 'Body', grams: 60, colorId: 'black', include: true }, { id: 'p2', name: 'Stand', grams: 15, colorId: 'red', include: true }] };
      render();
    });
    await stale.waitForSelector('#part-add-0-1');
    assert(!(await stale.isChecked('#part-add-0-1')) && await stale.evaluate(() => state.draftItems[0].grams === 60 && !state.draftItems[0].extraColors.length), 'old draft still treats the add-on as required');
    await stale.close();
    // A design with a set price: the add-on adds its own price, re-read from the gallery when quoting.
    db.gallery.g1.data.price = 20;
    const shop = await open(db, { suffix: '?design=dragon-organizer' });
    await shop.waitForSelector('.design-parts');
    await shop.click('button:has-text("Request this")');
    await shop.waitForSelector('#part-add-0-1');
    assert(/\$20\.00/.test(await shop.textContent('#customer-price-preview-0')), 'set price without the add-on');
    await shop.check('#part-add-0-1');
    await shop.waitForSelector('#part-color-0-1');
    assert(/\$24\.00/.test(await shop.textContent('#customer-price-preview-0')), 'set price plus the $4 add-on');
    await shop.evaluate(() => { state.draftItems[0].designParts[1].price = 0; state.draftItems[0].setPrice = 1; });   // tampered
    await shop.fill('#client-name', 'Max');
    await shop.fill('#client-email', 'max@example.com');
    await shop.click('#submit-btn');
    await requestSent(shop);
    await shop.close();
    const job = Object.values(db.jobs).find(j => j.clientName === 'Max');
    const quoting = await open(db);
    await quoting.evaluate(asOwner('dashboard'));
    await quoting.click(`#approve-btn-${job.id}`);
    await quoting.waitForTimeout(300);
    assert(db.jobs[job.id].items[0].setPrice === 24, `quoted ${JSON.stringify(db.jobs[job.id].items[0])}`);
    await quoting.close();
  });
  await check('design parts: owner lists parts with grams and photos; customers pick a color for each part', async () => {
    const db = fixtures();
    db.settings.colors.find(c => c.id === 'red').rate = 0.044;
    const owner = await open(db);
    await owner.evaluate(asOwner('gallery'));
    await owner.evaluate(() => editGalleryItem('g1'));
    await owner.click('#add-design-part');
    await owner.fill('#part-name-0', 'Body');
    await owner.fill('#part-grams-0', '60');
    await owner.setInputFiles('label:has-text("Add photo") input[type=file]', { name: 'body.png', mimeType: 'image/png', buffer: PNG });
    await owner.waitForSelector('text=Photo added');
    await owner.click('#add-design-part');
    await owner.fill('#part-name-1', 'Eyes');
    await owner.fill('#part-grams-1', '10');
    await owner.click('#gallery-save');
    await owner.waitForTimeout(300);
    const parts = db.gallery.g1.data.parts;
    assert(parts.length === 2 && parts[0].name === 'Body' && parts[0].grams === 60 && /\/storage\/v1\/object\/public\/gallery\/g1\/part-/.test(parts[0].photo) && parts[1].grams === 10, JSON.stringify(parts));
    await owner.close();
    const page = await open(db, { suffix: '?design=dragon-organizer' });
    await page.waitForSelector('.design-parts');
    const list = await page.textContent('.design-parts');
    assert(/Body/.test(list) && /60 g/.test(list) && /Eyes/.test(list) && /10 g/.test(list), list);
    await page.click('button:has-text("Request this")');
    await page.waitForSelector('#part-color-0-1');
    assert(!(await page.$('#pills-0')), 'per-part colors should replace the single color picker');
    await page.selectOption('#part-color-0-1', 'red');
    const it = await page.evaluate(() => state.draftItems[0]);
    assert(it.colorId === 'black' && it.grams === 60 && it.mainParts === 'Body' && it.extraColors.length === 1
      && it.extraColors[0].colorId === 'red' && it.extraColors[0].grams === 10 && it.extraColors[0].parts === 'Eyes', JSON.stringify(it));
    // 2 + 150 min x 0.024 + 60 g x 0.024 + 10 g x 0.044
    assert(/\$7\.48/.test(await page.textContent('#customer-price-preview-0')), await page.textContent('#customer-price-preview-0'));
    await page.selectOption('#part-color-0-1', 'black');
    assert(await page.evaluate(() => state.draftItems[0].extraColors.length === 0 && state.draftItems[0].grams === 70), 'one color again should be a single 70 g color');
    await page.selectOption('#part-color-0-0', 'silk');
    await page.fill('#client-name', 'Ivy');
    await page.fill('#client-email', 'ivy@example.com');
    await page.click('#submit-btn');
    await requestSent(page);
    const job = Object.values(db.jobs).find(j => j.clientName === 'Ivy');
    assert(job.items[0].colorId === 'silk' && job.items[0].mainParts === 'Body' && job.items[0].extraColors[0].name === 'Black' && job.items[0].extraColors[0].parts === 'Eyes', JSON.stringify(job.items[0]));
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
    await requestSent(page);
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
    await page.evaluate(asOwner('settings/colors'));
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
  await check('each color can have its own price per gram; sent quotes keep theirs', async () => {
    const db = fixtures();
    db.jobs.e2 = { id: 'e2', clientName: 'Kim', clientEmail: 'kim@example.com', createdAt: ago(60), phase: 'estimate', paymentStatus: 'unpaid',
      items: [{ name: 'Rose', mode: 'idea', qty: 1, filType: 'color', colorId: 'red', color: 'Red', minutes: 60, grams: 100 }] };
    const page = await open(db);
    await page.evaluate(asOwner('settings/colors'));
    const names = await page.$$eval('input[aria-label="Color name"]', is => is.map(i => i.value));
    const red = names.indexOf('Red');
    assert(/0\.024/.test(await page.getAttribute(`#color-rate-${red}`, 'placeholder')), 'blank rate should say it uses the regular rate');
    await page.fill(`#color-rate-${red}`, '0.034');
    await page.click('#settings-save');
    await page.waitForTimeout(300);
    assert(db.settings.colors.find(c => c.id === 'red').rate === 0.034 && db.settings.colors.find(c => c.id === 'black').rate === null, JSON.stringify(db.settings.colors));
    const price = it => page.evaluate(it => +calcPerPrint(60, 100, it, currentRules()).toFixed(2), it);
    const redItem = { filType: 'color', colorId: 'red', color: 'Red' };
    assert(await price(redItem) === 6.84 && await price({ filType: 'color', colorId: 'black', color: 'Black' }) === 5.84, 'red should cost 0.034/g, black 0.024/g');
    await page.evaluate(asOwner('dashboard'));
    assert(/\$0\.034\/g/.test(await page.textContent('#order-e2')), 'owner card should show the color rate');
    await page.click('#approve-btn-e2');
    await page.waitForTimeout(300);
    assert(db.jobs.e2.rates.colorRates.red === 0.034, JSON.stringify(db.jobs.e2.rates));
    // Another day: red goes to 0.044. New estimates change, the sent quote doesn't.
    await page.evaluate(asOwner('settings/colors'));
    await page.fill(`#color-rate-${red}`, '0.044');
    await page.click('#settings-save');
    await page.waitForTimeout(300);
    assert(await price(redItem) === 7.84, 'new rate not used for new estimates');
    assert(await price({ ...redItem, extraColors: [{ name: 'Black', filType: 'color', colorId: 'black' }] }) === 5.84 + 1, 'multi-color should average the two colors');
    assert(await page.evaluate(() => +batchTotal(state.batches.find(b => b.id === 'e2')).toFixed(2)) === 6.84, 'sent quote changed price');
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
    await page.evaluate(asOwner('settings/colors'));
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
  await check('a page opened earlier never puts back old settings: FAQ added elsewhere is kept', async () => {
    const db = fixtures();
    db.settings.faq = [{ id: 'q1', q: 'How long?', a: 'About a week.', live: true }];
    const page = await open(db);
    await page.evaluate(asOwner('settings'));
    await page.waitForTimeout(200);
    // Meanwhile, on the phone: more questions saved.
    db.settings = { ...db.settings, faq: [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ id: 'q' + n, q: 'Question ' + n, a: 'Answer', live: true })) };
    await page.fill('#set-reply', 'Replies within two days');
    await page.click('#settings-save');
    await page.waitForTimeout(300);
    assert(db.settings.faq.length === 8 && db.settings.about.replyTime === 'Replies within two days', `faq ${db.settings.faq.length}, reply ${db.settings.about.replyTime}`);
    // A background save (best sellers on the home page) from the same old page.
    await page.evaluate(() => saveSettings({ ...state.settings, topWork: ['g1'] }));
    assert(db.settings.faq.length === 8 && db.settings.topWork[0] === 'g1', `after a background save: faq ${db.settings.faq.length}`);
    await page.close();
  });
  await check('emails page: edit, preview, save and reset', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.evaluate(asOwner('emails'));
    const cards = await page.$$eval('.email-card', els => els.length);
    assert(cards > 10, `${cards} email cards found`);
    assert(/Your SoloPrint quote: \$15\.68/.test(await page.textContent('#email-preview-quote')), 'quote preview should fill in the sample total');
    await page.fill('#email-subject-quote', 'Quote for {title}: ${total}');
    assert(/Quote for Benchy, Phone stand: \$15\.68/.test(await page.textContent('#email-preview-quote')), 'preview should update while typing');
    await page.fill('#email-body-footer', 'Thanks!\nJeff');
    assert(/Thanks!\s+Jeff/.test(await page.textContent('#email-preview-confirmed')), 'footer change should show in other previews');
    assert(/Shown at the end of: Request received, Quote ready, Quote reminder/.test(await page.textContent('#email-footer')), 'footer card should list where it is used');
    assert(await page.evaluate(() => document.querySelector('.email-card').id) === 'email-footer', 'footer should be first');
    const groups = await page.evaluate(() => [...document.querySelectorAll('.email-group-title, .email-card')].map(e => e.id || e.textContent.trim()));
    assert(groups.join(',') === 'email-footer,Emails to customers,email-draft_reminder,email-customer_received,email-details_check,email-quote,email-reminder,email-confirmed,email-deposit,email-final_payment_needed,email-payment,email-delivered,email-delivery_update,email-review_request,email-roll_reminder,Emails to you,email-owner_new,email-owner_approved,email-weekly_summary', groups.join(','));
    assert(/To you/.test(await page.textContent('#email-owner_new .email-to')), 'owner email should say To you');
    await page.click('#emails-save');
    await page.waitForTimeout(300);
    assert(db.settings.emails.quote.subject === 'Quote for {title}: ${total}' && !db.settings.emails.quote.body, `saved ${JSON.stringify(db.settings.emails)}`);
    assert(db.settings.emails.footer.body === 'Thanks!\nJeff', 'footer not saved');
    assert(db.settings.about.text.includes('spare time'), 'other settings should be kept');
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

  console.log('\nNew features:');
  await check('vacation mode shows a notice on the home page', async () => {
    const db = fixtures();
    db.settings.vacation = { on: true, until: 'Monday, Nov 3' };
    const page = await open(db);
    assert(/Away for now\.\s+I'm away until Monday, Nov 3\. I'll review your request when I'm back\./.test(await page.textContent('.vacation-banner')), 'banner missing');
    await page.evaluate(asOwner('settings/vacation'));
    await page.waitForTimeout(200);
    await page.uncheck('#vacation-on');
    await page.click('#settings-save');
    await page.waitForTimeout(300);
    assert(db.settings.vacation.on === false && db.settings.vacation.until === 'Monday, Nov 3', `saved ${JSON.stringify(db.settings.vacation)}`);
    await page.close();
  });
  await check('order again fills the request form from a past order', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.evaluate(STATES['my requests']);
    await page.click('#order-1 >> text=Order again');
    await page.waitForTimeout(200);
    const draft = await page.evaluate(() => ({ tab: state.clientTab, items: state.draftItems.map(it => [it.name, it.qty, it.printHours, it.printMinutes]) }));
    assert(draft.tab === 'submit' && JSON.stringify(draft.items) === JSON.stringify([['Benchy', 2, '1', '30']]), JSON.stringify(draft));
    assert(/past order is filled in/.test(await page.textContent('#submit-ok')), 'no message');
    await page.close();
  });
  await check('customers see their leftover rolls and can start a request with one', async () => {
    const db = withRolls(fixtures());
    const page = await open(db);
    await page.evaluate(async () => { state.historyEmail = 'lee@example.com'; await loadBatches('lee@example.com'); state.clientTab = 'jobs'; render(); });
    const card = await page.textContent('.rolls-card');
    assert(/Red TPU: about 500 g left, until/.test(card) && !/Blue PLA|Green PETG/.test(card), card);
    await page.click('.rolls-card >> text=Use it in a new request');
    const it = await page.evaluate(() => state.draftItems[state.draftItems.length - 1]);
    assert(it.filType === 'special_order' && it.useLeftover && it.leftoverFrom === 'r1' && it.specialColor === 'Red TPU', JSON.stringify(it));
    assert(await page.inputValue('#special-color-0') === 'Red TPU', 'form not showing the roll');
    await page.close();
  });
  await check('private notes save for the owner only', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.evaluate(asOwner('dashboard'));
    await page.fill('#owner-note-1', 'Pickup Saturday');
    await page.waitForTimeout(1000);
    assert(db.private.notes && db.private.notes['1'] === 'Pickup Saturday', `notes ${JSON.stringify(db.private.notes)}`);
    assert(!JSON.stringify(db.jobs['1']).includes('Pickup Saturday'), 'note stored on the order, which customers can read');
    await page.close();
  });
  await check('finished-print photo: upload, customer sees it, add to gallery', async () => {
    const db = fixtures();
    db.jobs['2'].phase = 'delivered';
    const page = await open(db);
    await page.evaluate(asOwner('dashboard'));
    await page.setInputFiles('#finished-2', { name: 'done.png', mimeType: 'image/png', buffer: PNG });
    for (let t = 0; t < 40 && !(db.jobs['2'].finishedPhotos || []).length; t++) await page.waitForTimeout(100);
    assert(db.uploads.some(u => u.startsWith('gallery/orders/2-')) && db.jobs['2'].finishedPhotos[0].includes('/storage/v1/object/public/gallery/orders/2-'), JSON.stringify(db.jobs['2'].finishedPhotos));
    await page.click('#order-2 >> text=Add to gallery');
    await page.waitForTimeout(400);
    const g = Object.values(db.gallery).find(x => x.data.title === 'Hook');
    assert(g && g.published === false && g.data.photos.length === 1, `gallery ${JSON.stringify(g)}`);
    await page.close();
    const customer = await open(db);
    await customer.evaluate(STATES['my requests']);
    assert(await customer.$('#order-2 .finished-photos img'), 'customer does not see the photo');
    await customer.close();
  });
  await check('reviews: the email link opens a form, the owner approves before it shows', async () => {
    const db = fixtures();
    db.jobs['2'].phase = 'delivered';
    db.jobs['2'].clientName = 'Jane Doe';
    const page = await open(db, { suffix: '?requests=jane%40example.com&review=2#order-2' });
    await page.waitForSelector('#review-card');
    assert(await page.inputValue('#review-name') === 'Jane D.', 'name should default to first name and initial');
    await page.click('.review-stars button[aria-label="5 stars"]');
    await page.fill('#review-text', 'Sturdy hook, holds my bag.');
    const img = n => ({ name: `p${n}.png`, mimeType: 'image/png', buffer: PNG });
    await page.setInputFiles('#review-photos', [img(1), img(2), img(3)]);
    assert(/first 2/.test(await page.textContent('#review-photo-status')), 'should say only 2 photos are sent');
    await page.click('#review-send');
    await page.waitForSelector('text=Thank you for the review');
    assert((db.reviews['2'].photos || []).length === 2 && db.reviews['2'].photos.every(u => /\/gallery\/reviews\/2-\d+-\d\.jpg$/.test(u)), JSON.stringify(db.reviews['2']));
    assert(db.reviews['2'] && db.reviews['2'].rating === 5 && db.reviews['2'].status === 'new', JSON.stringify(db.reviews));
    assert(!db.settings.reviews.some(r => r.text.includes('Sturdy')), 'review shown before approval');
    await page.close();
    const owner = await open(db);
    await owner.evaluate(async () => { await loadCustomerReviews(); });
    await owner.evaluate(asOwner('settings/reviews'));
    await owner.evaluate(() => loadCustomerReviews().then(render));
    await owner.waitForSelector('text=Approve and show');
    await owner.click('text=Approve and show');
    await owner.waitForTimeout(300);
    assert(db.reviews['2'].status === 'approved' && db.settings.reviews[0].text === 'Sturdy hook, holds my bag.' && db.settings.reviews[0].name === 'Jane D.', JSON.stringify(db.settings.reviews));
    assert(db.settings.reviews[0].photos.length === 2, 'approved review should keep its photos');
    await owner.evaluate(() => { state.ownerTab = 'dashboard'; });
    await owner.close();
    const shop = await open(db);
    await shop.waitForSelector('.review-photos img');
    assert(await shop.locator('.review-photos img').count() === 2, 'home page should show the review photos');
    await shop.close();
  });
  await check('FAQ: a fourth menu button next to My Requests, and the FAQ sits at the bottom of every page', async () => {
    const db = fixtures();
    db.settings.faq = [{ id: 'q1', q: 'How long?', a: 'About a week.', live: true }];
    const page = await open(db);
    assert(await page.locator('.bubble-nav .bubble').count() === 4, 'menu should have 4 buttons');
    assert(/FAQ/.test(await page.textContent('.bubble-nav .bubble:nth-child(4)')), 'fourth button should be the FAQ');
    for (const tab of ['submit', 'gallery', 'jobs']) {
      await page.evaluate(t => setTab(t), tab);
      assert(await page.locator('#faq-list').count() === 1, `FAQ missing at the bottom of ${tab}`);
    }
    await page.click('.bubble-nav .bubble:nth-child(4)');
    assert(await page.locator('#faq-list').count() === 1 && await page.locator('.faq').count() === 1, 'FAQ page should show the FAQ once');
    await page.close();
  });
  await check('owner menu: Clients and Numbers sit inside Orders, Calculator & Models inside Designs', async () => {
    const owner = await open(fixtures());
    await owner.evaluate(asOwner('dashboard'));
    const tabs = (await owner.locator('nav.nav .nav-tab').allTextContents()).map(x => x.replace(/\d+$/, '').trim());
    assert(tabs.join('|') === 'Orders|Designs|Money & Sales|Practice|Settings|Change Password', tabs.join('|'));
    assert((await owner.locator('nav.sub-nav .sub-tab').allTextContents()).join('|') === 'Orders|By customer|Fix numbers', 'Orders sub-menu');
    await owner.click('.sub-tab:has-text("By customer")');
    await owner.waitForSelector('#client-notes');
    await owner.click('.sub-tab:has-text("Orders")');
    await owner.locator('button:has-text("Fix numbers")').nth(1).click();
    await owner.waitForSelector('.card[id^="numbers-"]');
    assert(await owner.locator('.card[id^="numbers-"]').count() === 1, 'the order card button should open just that order');
    await owner.click('text=Show all orders');
    assert(await owner.locator('.card[id^="numbers-"]').count() > 1, 'Show all orders');
    await owner.click('nav.nav .nav-tab:has-text("Designs")');
    assert((await owner.locator('nav.sub-nav .sub-tab').allTextContents()).map(x => x.replace(/\d+$/, '')).join('|') === 'Designs|Calculator & Models', 'Designs sub-menu');
    await owner.click('.sub-tab:has-text("Calculator")');
    await owner.waitForSelector('#owner-calc-print-time');
    await owner.close();
  });
  await check('Numbers page: fix a deposit amount, postage and an added charge', async () => {
    const db = fixtures();
    Object.assign(db.jobs['1'], { paymentStatus: 'deposit_received', depositAt: new Date().toISOString(), depositAmount: 5, extraCharges: [{ label: 'Sanding', amount: 3 }] });
    const owner = await open(db);
    await owner.evaluate(asOwner('numbers'));
    await owner.waitForSelector('#num-dep-1');
    await owner.fill('#num-dep-1', '8.5');
    await owner.fill('#num-post-1', '9.25');
    await owner.fill('#num-x0-1', '4');
    await owner.click('#numbers-1 .btn-primary');
    await owner.waitForSelector('#numbers-ok-1');
    await owner.waitForTimeout(300);
    const j = db.jobs['1'];
    assert(j.depositAmount === 8.5 && j.postageCost === 9.25 && j.extraCharges[0].amount === 4 && j.extraCharges[0].label === 'Sanding', JSON.stringify(j));
    // balance + shipping deposit paid: the summary says paid in full and the order is marked paid
    const total = await owner.evaluate(() => orderSum(state.batches.find(b => b.id === '1')));
    await owner.fill('#num-dep-1', '8.5');
    await owner.fill('#num-bal-1', String((total - 8.5).toFixed(2)));
    await owner.fill('#num-ship-1', '15');
    await owner.fill('#num-refund-1', '4.5');
    await owner.click('#numbers-1 .btn-primary');
    await owner.waitForTimeout(400);
    assert(db.jobs['1'].balancePaid > 0 && db.jobs['1'].shippingDepositPaid === 15 && db.jobs['1'].refundSent === 4.5 && db.jobs['1'].refundSentAt && db.jobs['1'].paymentStatus === 'payment_received', JSON.stringify(db.jobs['1']));
    assert(/paid in full/.test(await owner.textContent('#numbers-1 .numbers-summary')) && /sent \$4\.50/.test(await owner.textContent('#numbers-1 .numbers-summary')), await owner.textContent('#numbers-1 .numbers-summary'));
    await owner.fill('#num-dep-1', '-3');
    await owner.click('#numbers-1 .btn-primary');
    assert(/number/.test(await owner.textContent('#numbers-err-1')), 'a bad amount should be refused');
    await owner.close();
  });
  await check('filament stock: grams come off when printing is done, out-of-stock colors hide from customers', async () => {
    const db = fixtures();
    db.private.inventory = { black: { grams: 120, low: 200 } };
    db.jobs['1'].phase = 'order_received';
    db.jobs['1'].items[0] = { ...db.jobs['1'].items[0], color: 'Black', colorId: 'black', filType: 'color', grams: 50 };   // 2 x 50 g
    const page = await open(db);
    await page.evaluate(asOwner('dashboard'));
    assert(/Running low:\s+Black \(120 g\)/.test(await page.textContent('.stock-alert')), 'no low stock warning');
    await page.evaluate(() => updateBatchPhase('1', 'final_payment_needed'));
    await page.waitForTimeout(300);
    assert(db.private.inventory.black.grams === 20 && db.jobs['1'].stockTaken === true, `stock ${JSON.stringify(db.private.inventory)}`);
    await page.evaluate(() => setStock('black', '0'));
    await page.waitForTimeout(300);
    assert(db.settings.colors.find(c => c.id === 'black').outOfStock === true, 'black should be marked out of stock');
    await page.close();
    const customer = await open(db);
    await customer.click('text=I have an idea');
    const pills = await customer.$$eval('.swatch-pill', bs => bs.map(b => b.textContent.trim()));
    assert(!pills.some(p => /^Black/.test(p)) && pills.some(p => /^Red/.test(p)), `customer colors ${pills}`);
    await customer.close();
    const owner = await open(db);
    await owner.evaluate(asOwner('filament'));
    await owner.click('button[aria-label="Add a 1 kg roll of Black"]');
    await owner.waitForTimeout(300);
    assert(db.private.inventory.black.grams === 1000 && !db.settings.colors.find(c => c.id === 'black').outOfStock, 'restocking should show black again');
    await owner.close();
  });
  await check('money: sales, material and expenses by month, and a tax export', async () => {
    const db = fixtures();
    const year = new Date().getFullYear();
    db.private.money = { costPerKg: 20, expenses: [{ id: 'e1', date: `${year}-01-15`, what: 'Black PLA x3', amount: 60 }] };
    db.jobs['2'].paymentStatus = 'payment_received';
    db.jobs['2'].paidAt = `${year}-01-20T12:00:00.000Z`;
    const page = await open(db, { init: () => { window.__sheets = []; window.XLSX = { utils: { book_new: () => ({}), aoa_to_sheet: rows => rows, book_append_sheet: (wb, rows, name) => window.__sheets.push([name, rows]) }, writeFile: (wb, name) => { window.__file = name; } }; } });
    await page.evaluate(asOwner('money'));
    await page.waitForTimeout(400);
    const stats = await page.$$eval('.money-stats .stat-val', els => els.map(e => e.textContent));
    // Hook: 2 + 40 x 0.024 + 12 x 0.024 = 3.25 sale; 12 g x $0.02 = 0.24 material
    assert(JSON.stringify(stats) === JSON.stringify(['$3.25', '$0.24', '$3.01', '$60.00', '-$56.75']), `stats ${stats}`);
    await page.fill('#exp-what', 'Nozzles');
    await page.fill('#exp-amount', '12.5');
    await page.fill('#exp-date', `${year}-02-01`);
    await page.click('text=Add expense');
    await page.waitForTimeout(300);
    assert(db.private.money.expenses.length === 2 && db.private.money.expenses[1].amount === 12.5, JSON.stringify(db.private.money));
    await page.click(`text=Download ${year} for taxes (Excel)`);
    const out = await page.evaluate(() => ({ file: window.__file, sheets: window.__sheets.map(s => s[0]), jan: window.__sheets[0][1][1] }));
    assert(out.file === `soloprint-${year}-taxes.xlsx` && out.sheets.join() === 'Summary,Paid orders,Expenses' && out.jan.join() === 'January,1,3.25,0.24,3.01,60', JSON.stringify(out));
    await page.close();
  });
  await check('prices and wording are edited in Site Settings; sent quotes keep their prices', async () => {
    const db = fixtures();
    db.jobs['s1'] = { id: 's1', clientName: 'Pat', clientEmail: 'pat@example.com', createdAt: ago(60), phase: 'estimate', items: [{ name: 'Stand', qty: 1, filType: 'color', color: 'Red', colorId: 'red', grams: 10 }] };
    const page = await open(db);
    await page.evaluate(asOwner('settings/prices'));
    await page.waitForTimeout(200);
    await page.fill('#rule-baseFee', '3');
    assert(/costs \$5\.64 in a regular color/.test(await page.textContent('#rules-example')), await page.textContent('#rules-example'));   // 3 + 90 x .024 + 20 x .024
    await page.fill('#rule-venmo', '@Shop-Name');
    await page.click('.sub-tab:has-text("Wording")');   // changes carry between the Settings tabs until saved
    await page.fill('#material-note', 'Printed in PETG unless noted.');
    await page.fill('#how-title-0', 'Send me your idea');
    await page.click('#settings-save');
    await page.waitForTimeout(300);
    assert(db.settings.rules.baseFee === 3 && db.settings.rules.venmo === 'Shop-Name' && db.settings.materialNote === 'Printed in PETG unless noted.' && db.settings.howItWorks[0].title === 'Send me your idea', JSON.stringify(db.settings));
    const quoted = await page.evaluate(() => batchTotal(state.batches.find(b => b.id === '1')));
    assert(Math.abs(quoted - 9.28) < 1e-9, `a quote sent before the change moved to ${quoted}`);
    await page.evaluate(() => setOwnerTab('dashboard'));
    await page.fill('#hours-s1-0', '1');
    await page.click('#approve-btn-s1');
    await page.waitForTimeout(300);
    assert(db.jobs['s1'].rates && db.jobs['s1'].rates.baseFee === 3, `rates not saved on the quote: ${JSON.stringify(db.jobs['s1'].rates)}`);
    await page.close();
    const customer = await open(db);
    const home = await customer.textContent('body');
    assert(home.includes('Send me your idea'), 'edited how-it-works step missing');
    await customer.click('text=I have an idea');
    assert((await customer.textContent('body')).includes('Printed in PETG unless noted.'), 'material note missing on the form');
    await customer.evaluate(() => { updateDraftPrintTime(0, 'hours', '1'); updateDraft(0, 'grams', 10); });
    assert(/\$3\.00 flat/.test(await customer.textContent('.price-breakdown')), 'estimate does not use the new base fee');
    await customer.close();
  });
  await check('request form: choices stay on top, the chosen form appears below, switching keeps what was typed', async () => {
    const page = await open(fixtures());
    const order = await page.$$eval('.mode-title', ts => ts.map(t => t.textContent));
    assert(order.join() === 'Something from my past work,I have a link,I have an idea', `choice order ${order}`);
    assert(await page.$('.mode-option.selected:has-text("Something from my past work")') && await page.$('.gallery-pick-tile'), 'past work should be picked to start with, showing the designs');
    await page.click('text=I have an idea');
    assert(await page.$('.mode-option.selected[aria-pressed="true"]:has-text("I have an idea")') && await page.$('#mode-form-0 #notes-0'), 'idea form not shown below the choices');
    assert(!(await page.$('text=Change')), 'the old Change link is still there');
    assert(await page.$eval('.time-toggle', el => el.tagName) === 'BUTTON', 'print time is not a button');
    await page.fill('#notes-0', 'A hook for my bike helmet');
    await page.click('text=I have a link');
    assert(await page.inputValue('#link-0') === '' && (await page.$$('.mode-option')).length === 3, 'link form should start empty with the choices still shown');
    await page.click('text=I have an idea');
    assert(await page.inputValue('#notes-0') === 'A hook for my bike helmet', 'the idea typed earlier was lost');
    assert(/what you started earlier/.test(await page.textContent('.draft-restored')), 'no note that the draft came back');
    await page.close();
  });
  await check('a choice tapped with nothing typed is not remembered: past work is picked again on return', async () => {
    const page = await open(fixtures(), { init: () => localStorage.setItem('soloprint_request_draft_v1', JSON.stringify({ clientName: '', clientEmail: '', savedAt: Date.now(), items: [{ mode: 'link', qty: 1 }] })) });
    assert(await page.$('.mode-option.selected:has-text("Something from my past work")'), 'an old empty "I have a link" choice was restored');
    await page.close();
  });
  await check('past work: pick a design right in the form, with a way back', async () => {
    const page = await open(fixtures());
    await page.click('text=Something from my past work');
    await page.waitForSelector('.gallery-pick-tile');
    const tiles = await page.$$eval('.gallery-pick-tile', ts => ts.map(t => t.textContent.trim()));
    assert(tiles.join() === 'Dragon Organizer,Name Sign', `tiles ${tiles}`);
    await page.click('.gallery-pick-tile:has-text("Dragon Organizer")');
    assert(await page.inputValue('#name-0') === 'Dragon Organizer' && await page.evaluate(() => state.draftItems[0].galleryId) === 'g1', 'design not picked');
    await page.click('text=Pick a different design');
    assert(await page.$('.gallery-pick-tile'), 'no way back to the designs');
    await page.click('text=I have an idea');
    assert(await page.$('#notes-0'), 'could not switch away from past work');
    await page.close();
  });
  await check('unsent requests are saved for the reminder email, and cleared once sent', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.fill('#client-name', 'Kim');
    await page.fill('#client-email', 'kim@example.com');
    await page.click('text=I have an idea');
    await page.fill('#notes-0', 'A phone stand');
    for (let t = 0; t < 60 && !db.drafts['kim@example.com']; t++) await page.waitForTimeout(100);
    assert(db.drafts['kim@example.com'] && db.drafts['kim@example.com'].data.items[0].notes === 'A phone stand', `draft ${JSON.stringify(db.drafts)}`);
    await page.click('#submit-btn');
    await requestSent(page);
    for (let t = 0; t < 30 && db.drafts['kim@example.com']; t++) await page.waitForTimeout(100);
    assert(!db.drafts['kim@example.com'], 'draft not cleared after sending');
    await page.close();
  });
  await check('the reminder link reopens the saved request', async () => {
    const db = fixtures();
    db.drafts['kim@example.com'] = { id: '11111111-2222-3333-4444-555555555555', email: 'kim@example.com', name: 'Kim',
      data: { items: [{ mode: 'idea', notes: 'A phone stand', qty: 2 }] } };
    const page = await open(db, { suffix: '?resume=11111111-2222-3333-4444-555555555555' });
    assert(await page.inputValue('#client-email') === 'kim@example.com' && await page.inputValue('#notes-0') === 'A phone stand' && await page.inputValue('#qty-0') === '2', 'draft not restored');
    assert(/Welcome back/.test(await page.textContent('#resume-note')), 'no welcome back message');
    assert(!(await page.evaluate(() => location.search.includes('resume'))), 'resume id left in the address bar');
    await page.close();
  });
  await check('colors can have a description and a link that customers see when they pick them', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.evaluate(asOwner('settings/colors'));
    await page.waitForTimeout(200);
    const n = await page.evaluate(() => state.settingsDraft.colors.findIndex(c => c.id === 'silk'));
    await page.fill(`#color-desc-${n}`, 'Shimmery gold that shifts in the light');
    await page.fill(`#color-link-${n}`, 'https://example.com/silk-gold');
    await page.click('#settings-save');
    await page.waitForTimeout(300);
    const silk = db.settings.colors.find(c => c.id === 'silk');
    assert(silk.description === 'Shimmery gold that shifts in the light' && silk.link === 'https://example.com/silk-gold', JSON.stringify(silk));
    await page.close();
    db.settings.colors.find(c => c.id === 'red').link = 'javascript:alert(1)';
    const customer = await open(db);
    await customer.click('text=I have an idea');
    assert(await customer.$('.swatch-pill:has-text("Silk Gold") .info-mark'), 'no info mark on the color');
    assert(!(await customer.$('.color-info')), 'info shown before the color is picked');
    await customer.click('.swatch-pill:has-text("Silk Gold")');
    const info = await customer.textContent('.color-info');
    assert(/Silk Gold: Shimmery gold that shifts in the light/.test(info) && await customer.getAttribute('.color-info a', 'href') === 'https://example.com/silk-gold', info);
    await customer.click('.swatch-pill:has-text("Red")');
    assert(!(await customer.$('.color-info a')), 'an unsafe link was shown');
    await customer.close();
  });
  await check('design terms include the 50% deposit, 60-day balance and unclaimed print rules', async () => {
    const db = fixtures();
    const page = await open(db);
    const terms = await page.evaluate(() => designTermsText());
    assert(/50% deposit/.test(terms) && /within 60 days after I tell you the design is done, I keep the deposit/.test(terms) && /may throw the print away/.test(terms), terms);
    // A saved copy of the old default terms picks up the new ones; edited terms are kept.
    assert(await page.evaluate(() => { state.settings.designTerms = PREVIOUS_DESIGN_TERMS; return designTermsText() === DEFAULT_DESIGN_TERMS; }), 'old default terms were not updated');
    assert(await page.evaluate(() => { state.settings.designTerms = 'My own terms'; return designTermsText() === 'My own terms'; }), 'edited terms were replaced');
    await page.close();
  });
  await check('custom designs: the customer must agree to the design terms before approving', async () => {
    const db = fixtures();
    db.jobs['c1'] = { id: 'c1', clientName: 'Jane', clientEmail: 'jane@example.com', createdAt: ago(60), phase: 'estimate',
      items: [{ name: 'Brush holder', mode: 'idea', notes: 'Holds three brushes', qty: 1, filType: 'black', grams: 30 }] };
    const owner = await open(db);
    await owner.evaluate(asOwner('dashboard'));
    assert(await owner.isChecked('#terms-c1'), 'terms should be on by default for a custom design');
    await owner.fill('#hours-c1-0', '1');
    await owner.click('#approve-btn-c1');
    await owner.waitForTimeout(300);
    assert(/Custom design terms/.test(db.jobs['c1'].designTerms) && /I own the design/.test(db.jobs['c1'].designTerms), 'terms not saved on the quote');
    await owner.close();
    const page = await open(db);
    await page.evaluate(STATES['my requests']);
    assert(/I may make, sell and share prints of the design/.test(await page.textContent('#order-c1 .design-terms-text')), 'terms not shown to the customer');
    await page.click('#customer-approve-c1');
    await page.waitForTimeout(300);
    assert(!db.jobs['c1'].customerApprovedAt && /tick the box/.test(await page.textContent('#terms-err-c1')), 'approved without agreeing');
    await page.check('#terms-agree-c1');
    await page.click('#customer-approve-c1');
    await page.waitForSelector('text=We got your go-ahead');
    assert(db.jobs['c1'].customerApprovedAt, 'approval not saved after agreeing');
    await page.close();
    const after = await open(db);
    await after.evaluate(asOwner('dashboard'));
    assert(/Agreed to design terms/.test(await after.textContent('#order-c1')), 'owner does not see the agreement');
    await after.close();
  });
  await check('home page My Work: best sellers first, newest to fill, names under the photos, then SEE MORE', async () => {
    const db = fixtures();
    db.gallery.g4 = { id: 'g4', published: true, sort_order: 3, created_at: '2026-10-01T00:00:00Z', data: { title: 'Newest', photos: ['https://img.test/n.png'] } };
    db.gallery.g1.created_at = '2026-01-01T00:00:00Z'; db.gallery.g2.created_at = '2026-02-01T00:00:00Z';
    db.jobs['b1'] = { id: 'b1', clientName: 'A', clientEmail: 'a@example.com', createdAt: ago(100), phase: 'delivered', items: [{ name: 'Name Sign', mode: 'gallery', galleryId: 'g2', qty: 3, grams: 5 }] };
    const owner = await open(db);
    await owner.evaluate(asOwner('dashboard'));
    await owner.waitForTimeout(300);
    assert(JSON.stringify(db.settings.topWork) === '["g2"]', `best sellers ${JSON.stringify(db.settings.topWork)}`);
    await owner.close();
    const page = await open(db);
    const names = await page.$$eval('.work-grid .work-card-name', els => els.map(e => e.textContent.trim()));
    assert(names.join('|') === 'Name Sign|Newest|Dragon Organizer|', `tiles ${names.join('|')}`);
    const covered = await page.$$eval('.work-grid .work-card', cards => cards.some(c => { const img = c.querySelector('img'), name = c.querySelector('.work-card-name'); return img && name && name.getBoundingClientRect().top < img.getBoundingClientRect().bottom - 1; }));
    assert(!covered, 'a name covers its photo');
    await page.click('.work-more');
    assert(await page.evaluate(() => state.clientTab) === 'gallery', 'SEE MORE does not open Past Work');
    await page.close();
  });
  await check('your name and email: one label, short one-line note', async () => {
    const page = await open(fixtures(), { width: 390 });
    assert(/Your name and email/i.test(await page.textContent('#client-label')) && await page.getAttribute('#client-name', 'placeholder') === 'Jane Smith', 'label or placeholder wrong');
    assert(!(await page.$('text=Your email *')), 'the separate Your email label is still there');
    const lines = await page.$eval('#client-label ~ .field-help', el => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
    assert(lines === 1, `the saved note takes ${lines} lines on a phone`);
    await page.close();
  });
  await check('past work prices say automated estimate, and orders are made to custom specifications', async () => {
    const page = await open(fixtures());
    await page.evaluate(STATES['design work']);
    const list = await page.textContent('main');
    assert(/each · automated estimate/.test(list) && /made to your custom specifications/.test(list), 'gallery page is missing the notes');
    await page.evaluate(() => openWork('g1'));
    const detail = await page.textContent('main');
    assert(/each · automated estimate/.test(detail) && /made to your custom specifications/.test(detail), 'design page is missing the notes');
    await page.close();
  });
  await check('past work set price: replaces the estimate, no calculation shown, used in the quote', async () => {
    const db = fixtures();
    const owner = await open(db);
    await owner.evaluate(asOwner('gallery'));
    await owner.evaluate(() => editGalleryItem('g1'));
    await owner.fill('#gallery-price', '12');
    assert(/\$12\.00/.test(await owner.textContent('#gallery-form-price')) && !/print time|g Black/.test(await owner.textContent('#gallery-form-price')), 'owner preview should show only the set price');
    await owner.click('#gallery-save');
    await owner.waitForTimeout(300);
    assert(db.gallery.g1.data.price === 12, `saved ${JSON.stringify(db.gallery.g1.data)}`);
    await owner.close();
    const page = await open(db);
    await page.evaluate(async () => { await loadGallery(); openWork('g1'); });
    const detail = await page.textContent('main');
    assert(/\$12\.00 each/.test(detail) && !/automated estimate/.test(detail) && !/to print/.test(detail), 'design page still shows the estimate or calculation');
    await page.evaluate(() => { setTab('submit'); pickGalleryForItem(0, 'g1'); });
    const preview = await page.textContent('#customer-price-preview-0');
    assert(/\$12\.00/.test(preview) && !(await page.$('#customer-price-preview-0 .price-breakdown')) && !(await page.$('.time-toggle')), 'request form shows a calculation for a set price');
    await page.fill('#client-name', 'Ann'); await page.fill('#client-email', 'ann@example.com');
    await page.evaluate(() => { state.draftItems[0].setPrice = 1; });   // a tampered price
    await page.click('#submit-btn');
    await requestSent(page);
    await page.close();
    const job = Object.values(db.jobs).find(j => j.clientName === 'Ann');
    const quoting = await open(db);
    await quoting.evaluate(asOwner('dashboard'));
    await quoting.click(`#approve-btn-${job.id}`);
    await quoting.waitForTimeout(300);
    assert(db.jobs[job.id].phase === 'quote_sent' && db.jobs[job.id].items[0].setPrice === 12, `quote ${JSON.stringify(db.jobs[job.id].items[0])}`);
    assert(await quoting.evaluate(id => batchTotal(state.batches.find(b => b.id === id)), job.id) === 12, 'quote total should be the set price');
    await quoting.close();
  });
  await check('owner can edit a request: items, colors, special orders, own prices and added charges', async () => {
    const db = fixtures();
    db.jobs.e1 = { id: 'e1', clientName: 'Pat', clientEmail: 'pat@example.com', createdAt: ago(60), phase: 'estimate', paymentStatus: 'unpaid',
      items: [{ name: 'Bracket', mode: 'idea', notes: 'Can it be red TPU?', qty: 1, filType: 'color', colorId: 'black', color: 'Black' }] };
    const owner = await open(db);
    await owner.evaluate(asOwner('dashboard'));
    await owner.click('#edit-request-e1');
    await owner.fill('#oe-name-0', 'Wall bracket');
    await owner.fill('#oe-notes-0', 'Red TPU, thicker arm');
    await owner.fill('#oe-qty-0', '3');
    await owner.selectOption('#oe-color-0', 'special_order');
    await owner.fill('#oe-special-0', 'Red TPU');
    await owner.selectOption('#oe-extra-0', 'silk');
    await owner.fill('#oe-price-0', '7.5');
    await owner.click('text=+ Add an item');
    await owner.fill('#oe-name-1', 'Spare');
    await owner.click('text=+ Add a charge');
    await owner.fill('#oe-charge-amount-0', '15');
    await owner.click('#owner-edit-save');
    await owner.waitForSelector('#edit-request-e1');
    const saved = db.jobs.e1;
    const it = saved.items[0];
    assert(it.name === 'Wall bracket' && it.notes === 'Red TPU, thicker arm' && it.qty === 3 && it.filType === 'special_order' && it.specialColor === 'Red TPU'
      && it.ownerPrice === 7.5 && it.extraColors.map(p => p.name).join() === 'Silk Gold' && saved.items.length === 2, JSON.stringify(saved.items));
    assert(JSON.stringify(saved.extraCharges) === '[{"label":"Special costs","amount":15}]', JSON.stringify(saved.extraCharges));
    assert(/Your price \$7\.50 each/.test(await owner.textContent('#order-e1')), 'owner card does not show your price');
    // Cancel throws changes away.
    await owner.click('#edit-request-e1');
    await owner.fill('#oe-client-name', 'Nobody');
    await owner.click('#order-e1 >> text=Cancel');
    assert(db.jobs.e1.clientName === 'Pat' && /Pat/.test(await owner.textContent('#order-e1')), 'cancel kept the changes');
    // Remove the spare item, then quote it: your price x 3 + roll + your charge.
    await owner.click('#edit-request-e1');
    await owner.click('text=Remove item 2');
    await owner.click('#owner-edit-save');
    await owner.waitForSelector('#edit-request-e1');
    await owner.fill('#special-cost-e1', '20');
    await owner.click('#approve-btn-e1');
    await owner.waitForTimeout(300);
    assert(db.jobs.e1.phase === 'quote_sent' && db.jobs.e1.items.length === 1, JSON.stringify(db.jobs.e1));
    assert(await owner.evaluate(() => batchTotal(state.batches.find(b => b.id === 'e1'))) === 57.5, 'total should be 3 x 7.50 + 20 roll + 15 charge');
    await owner.close();
    const page = await open(db);
    await page.evaluate(async () => { state.historyEmail = 'pat@example.com'; await loadBatches('pat@example.com'); state.clientTab = 'jobs'; render(); });
    const card = await page.textContent('#order-e1');
    assert(/Special costs/.test(card) && /\$15\.00/.test(card) && /\$57\.50/.test(card) && !/added by you|Your price/.test(card), card);
    // A customer can't send their own price or charges.
    await page.evaluate(() => setTab('submit'));
    await page.fill('#client-name', 'Pat');
    await page.fill('#client-email', 'pat@example.com');
    await page.click('text=I have an idea');
    await page.fill('#notes-0', 'Another one');
    await page.evaluate(() => { state.draftItems[0].ownerPrice = 0; });
    await page.click('#submit-btn');
    await requestSent(page);
    const sent = Object.values(db.jobs).find(j => j.id !== 'e1' && j.clientEmail === 'pat@example.com');
    assert(sent && sent.items[0].ownerPrice == null && !(sent.extraCharges || []).length, JSON.stringify(sent));
    await page.close();
  });
  await check('YouTube videos play on the design page and are never thumbnails', async () => {
    const db = fixtures();
    const page = await open(db, { suffix: '?design=dragon-organizer' });
    await page.waitForSelector('#work-detail');
    const frames = await page.$$eval('iframe', els => els.map(e => e.getAttribute('src')));
    assert(frames.length === 1 && frames[0].startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'), `players: ${frames}`);
    const notPlayer = await page.$$eval('img', els => els.map(e => e.getAttribute('src') || '').filter(u => /youtu|ytimg/.test(u)));
    assert(!notPlayer.length && !(await page.$('.gallery-strip iframe, .work-card iframe, .gallery-card iframe')), `video used as a picture: ${notPlayer}`);
    await page.evaluate(() => { setTab('submit'); });
    assert(!(await page.$('iframe')) && !(await page.$$eval('img', els => els.some(e => /youtu|ytimg/.test(e.src)))), 'video shows outside the design page');
    await page.close();
    const owner = await open(db);
    await owner.evaluate(asOwner('gallery'));
    await owner.evaluate(() => editGalleryItem('g1'));
    assert((await owner.inputValue('#gallery-videos')) === 'https://youtu.be/dQw4w9WgXcQ', 'saved video not shown in the form');
    await owner.fill('#gallery-videos', 'not a video');
    await owner.click('#gallery-save');
    assert(/isn't a YouTube link/.test(await owner.textContent('#gallery-err')), 'bad link accepted');
    await owner.fill('#gallery-videos', 'https://www.youtube.com/watch?v=abcdefghijk&t=5s\nhttps://youtube.com/shorts/ABCDEFGHIJK');
    await owner.fill('#gallery-photos', 'https://img.test/d1.png\nhttps://youtu.be/zyxwvutsrqp');
    await owner.click('#gallery-save');
    await owner.waitForTimeout(300);
    const data = db.gallery.g1.data;
    assert(data.videos.join() === 'abcdefghijk,ABCDEFGHIJK,zyxwvutsrqp' && data.photos.join() === 'https://img.test/d1.png', JSON.stringify(data));
    await owner.close();
  });
  await check('Ready to Ship: entering the tracking number ships the order and works out the shipping deposit refund', async () => {
    const db = fixtures();
    Object.assign(db.jobs['1'], { phase: 'ready_to_ship', paymentStatus: 'payment_received', paidAt: new Date().toISOString() });
    const owner = await open(db);
    await owner.evaluate(asOwner('dashboard'));
    await owner.waitForSelector('#dtrack-1');
    await owner.click('text=Save tracking and mark Shipped', { timeout: 3000 }).catch(() => {});
    assert(db.jobs['1'].phase === 'ready_to_ship', 'needs a tracking number first');
    await owner.fill('#dtrack-1', 'USPS 9400 1111');
    await owner.fill('#dpost-1', '9.50');
    await owner.click('text=Save tracking and mark Shipped');
    await owner.waitForTimeout(400);
    assert(db.jobs['1'].phase === 'delivered' && db.jobs['1'].deliveryTracking === 'USPS 9400 1111' && db.jobs['1'].postageCost === 9.5, JSON.stringify(db.jobs['1']));
    await owner.close();
  });
  await check('FAQ search: shows every question whose question or answer has the words', async () => {
    const db = fixtures();
    db.settings = { ...db.settings, faq: [{ id: 'a', q: 'How long?', a: 'About a week.', live: true }, { id: 'b', q: 'Do you ship?', a: 'Yes, by USPS.', live: true }, { id: 'c', q: 'Colors?', a: 'Many.', live: true }] };
    const page = await open(db);
    await page.waitForSelector('#faq-search');
    await page.fill('#faq-search', 'usps');
    const vis = await page.$$eval('.faq-card', els => els.filter(e => !e.hidden).map(e => e.dataset.q));
    assert(vis.join() === 'Do you ship?', vis.join());
    await page.evaluate(() => { document.body.style.minHeight = '3000px'; window.scrollTo(0, 400); });
    await page.click('.faq-card:not([hidden])');
    const y0 = await page.evaluate(() => window.scrollY);
    assert(/Yes, by USPS/.test(await page.textContent('#faq-modal .faq-answer')), 'answer pops up');
    await page.click('#faq-close');
    assert(!(await page.$('#faq-modal')), 'X closes it');
    assert(y0 > 0 && Math.abs(await page.evaluate(() => window.scrollY) - y0) < 5, `stays where it was (${y0})`);
    await page.click('.faq-card:not([hidden])');
    await page.mouse.click(5, 5);
    assert(!(await page.$('#faq-modal')), 'tapping outside closes it');
    await page.fill('#faq-search', 'zzz');
    assert(await page.isVisible('#faq-none'), 'says nothing matches');
    await page.close();
  });
  await check('site text, FAQ and step names: drafts stay hidden until Live; the owner can preview them', async () => {
    const db = fixtures();
    const owner = await open(db);
    await owner.evaluate(asOwner('settings/text'));
    await owner.fill('#st-requestTitle', 'Ask for a print');
    assert((await owner.textContent('#st-status-requestTitle')).trim() === 'Draft', 'should say Draft');
    await owner.fill('#st-step_estimate', 'Got your request');
    await owner.check('#st-live-step_estimate');
    await owner.click('.sub-tab:has-text("FAQ")');
    await owner.click('#faq-add');
    await owner.fill('#faq-q-0', 'Do you ship?');
    await owner.fill('#faq-a-0', 'Local pickup only for now.');
    await owner.click('#faq-add');
    await owner.fill('#faq-q-1', 'Secret draft question');
    await owner.check('#faq-live-0');
    await owner.click('#settings-save');
    await owner.waitForTimeout(300);
    assert(db.settings.siteText.requestTitle.text === 'Ask for a print' && !db.settings.siteText.requestTitle.live && db.settings.siteText.step_estimate.live, JSON.stringify(db.settings.siteText));
    assert(db.settings.faq.length === 2 && db.settings.faq[0].live && !db.settings.faq[1].live, JSON.stringify(db.settings.faq));
    // Preview: the owner sees drafts on the customer pages.
    await owner.evaluate(async () => { setPreviewDrafts(true); await showClientView(); });
    let home = await owner.textContent('main');
    assert(/Ask for a print/.test(home) && /Secret draft question/.test(home) && /only you can see them/.test(home), 'preview should show drafts');
    await owner.evaluate(() => setPreviewDrafts(false));
    await owner.close();
    const page = await open(db);
    home = await page.textContent('main');
    assert(!/Ask for a print/.test(home) && /New Quote Request/.test(home), 'draft heading shown to customers');
    assert(/Do you ship\?/.test(home) && !/Secret draft question/.test(home), 'FAQ: only live questions');
    await page.evaluate(STATES['my requests']);
    await page.evaluate(() => { state.batches.find(b => b.id === '1').phase = 'estimate'; render(); });
    assert(/Got your request/.test(await page.textContent('#order-1')), 'live step name not used');
    await page.close();
  });
  await check('Settings tabs show a "where this shows" picture, and every picture exists', async () => {
    const page = await open(fixtures());
    await page.evaluate(asOwner('settings/prices'));
    assert(await page.$('.area-preview img[src="previews/prices.jpg"]'), 'no picture on Prices & rules');
    const names = await page.evaluate(() => Object.keys(AREA_PREVIEWS));
    const missing = names.filter(n => !require('fs').existsSync(require('path').join(__dirname, '..', 'previews', n + '.jpg')));
    assert(!missing.length, `missing pictures: ${missing}`);
    await page.close();
  });
  await check('colors can have a real-life photo that customers see when choosing', async () => {
    const db = fixtures();
    const owner = await open(db);
    await owner.evaluate(asOwner('settings/colors'));
    const names = await owner.$$eval('input[aria-label="Color name"]', is => is.map(i => i.value));
    const red = names.indexOf('Red');
    await owner.setInputFiles(`#color-photo-${red}`, { name: 'red.png', mimeType: 'image/png', buffer: PNG });
    await owner.waitForSelector('text=Photo added');
    await owner.click('#settings-save');
    await owner.waitForTimeout(300);
    const photo = db.settings.colors.find(c => c.id === 'red').photo;
    assert(/\/storage\/v1\/object\/public\/gallery\/site\/color-red-/.test(photo) && db.uploads.some(u => /color-red-.*-thumb\.jpg/.test(u)), photo);
    await owner.close();
    const page = await open(db);
    await page.click('text=I have an idea');
    assert(await page.$('.swatch-pill:has-text("Red") .swatch-photo'), 'the Red choice should show its photo');
    await page.click('.swatch-pill:has-text("Red")');
    assert(await page.$('.color-info .color-photo img'), 'picking Red should show its photo');
    await page.close();
  });
  await check('FAQ is at the bottom of the home page; phones get a back-to-top arrow', async () => {
    const db = fixtures();
    db.settings.faq = [{ id: 'f1', q: 'Do you ship?', a: 'Pickup only.', live: true }];
    const page = await open(db);
    assert(await page.evaluate(() => { const faq = document.querySelector('.faq'); const form = document.getElementById('submit-btn');
      return !!faq && !!(form.compareDocumentPosition(faq) & Node.DOCUMENT_POSITION_FOLLOWING); }), 'FAQ should come after the request form');
    await page.setViewportSize({ width: 390, height: 800 });
    assert(!(await page.isVisible('#back-to-top')), 'arrow should be hidden at the top');
    await page.evaluate(() => window.scrollTo(0, 2000));
    await page.waitForTimeout(200);
    assert(await page.isVisible('#back-to-top'), 'arrow should show after scrolling down');
    await page.click('#back-to-top');
    await page.waitForTimeout(800);
    assert(await page.evaluate(() => window.scrollY) < 50, 'arrow should go back to the top');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => window.scrollTo(0, 2000));
    assert(!(await page.isVisible('#back-to-top')), 'no arrow on wide screens');
    await page.close();
  });
  await check('show / hide: switched-off parts of the site disappear', async () => {
    const db = fixtures();
    const owner = await open(db);
    await owner.evaluate(asOwner('settings/features'));
    await owner.uncheck('#feature-howItWorks');
    await owner.uncheck('#feature-reviews');
    await owner.uncheck('#feature-videos');
    await owner.click('#settings-save');
    await owner.waitForTimeout(300);
    assert(db.settings.features.howItWorks === false && db.settings.features.reviews === false && db.settings.features.faq === undefined, JSON.stringify(db.settings.features));
    await owner.close();
    const page = await open(db);
    const home = await page.textContent('main');
    assert(!/How it works/.test(home) && !/Came out perfect/.test(home) && /New Quote Request/.test(home), 'hidden parts still on the home page');
    await page.evaluate(async () => { await loadGallery(); openWork('g1'); });
    assert(!(await page.$('iframe')), 'videos still shown');
    await page.close();
  });
  await check('each design has its own link, with the gallery still visible above it', async () => {
    const page = await open(fixtures(), { suffix: '?design=g2' });
    await page.waitForSelector('#work-detail');
    assert(/Name Sign/.test(await page.textContent('#work-detail')), 'direct link did not open the design');
    const tiles = await page.$$eval('.gallery-strip .work-card-name', els => els.map(e => e.textContent.trim()));
    assert(tiles.join() === 'Dragon Organizer,Name Sign' && await page.$('.gallery-strip .work-card.current:has-text("Name Sign")'), `gallery above the design: ${tiles}`);
    await page.click('.gallery-strip .work-card:has-text("Dragon Organizer")');
    assert(await page.evaluate(() => new URLSearchParams(location.search).get('design')) === 'dragon-organizer' && /Dragon Organizer/.test(await page.textContent('#work-detail')), 'switching designs did not put the name in the address');
    await page.goBack();
    await page.waitForTimeout(200);
    assert(/Name Sign/.test(await page.textContent('#work-detail')), 'back button did not return to the previous design');
    const link = await page.evaluate(() => designLink('g2'));
    assert(/\?design=name-sign$/.test(link), link);
    await page.click('#work-detail >> text=Close');
    assert(!(await page.evaluate(() => location.search.includes('design'))) && await page.$('.gallery-grid'), 'closing did not go back to the full gallery');
    await page.close();
  });
  await check('order queue: customers see how many orders are ahead and about how many days', async () => {
    const db = fixtures();   // order 2 is printing
    db.jobs['q1'] = { id: 'q1', clientName: 'Bo', clientEmail: 'bo@example.com', createdAt: ago(300), phase: 'order_received', phaseHistory: { order_received: ago(200) }, depositAt: ago(150), paymentStatus: 'deposit_received',
      items: [{ name: 'Vase', mode: 'idea', notes: 'tall', qty: 1, minutes: 60, grams: 20 }], designTerms: 'terms' };
    const page = await open(db);
    let note = await page.textContent('#queue-note');
    // printing order: 0-2 days; custom order: 8-9 days; this request: 1-2 days
    assert(/2 orders ahead of yours/.test(note) && /about 9-13 days/.test(note) && /add at least 7 days for design/.test(note), note);
    await page.click('text=I have an idea');
    await page.fill('#notes-0', 'A tiny dragon');
    note = await page.textContent('#queue-note');
    assert(/about 16-20 days/.test(note) && /at least 7 days to design, and that's included/.test(note), note);
    await page.evaluate(STATES['my requests']);
    assert(/If you go ahead now, expect it to be printed in about 9-13 days/.test(await page.textContent('#order-1')), 'quote has no wait estimate');
    await page.close();
    // Confirmed long before Bo, but no deposit yet: no place in line, and a deposit button.
    db.jobs['1'].phase = 'order_received'; db.jobs['1'].phaseHistory = { order_received: ago(400) };
    const later = await open(db);
    await later.evaluate(STATES['my requests']);
    let card = await later.textContent('#order-1');
    assert(/Your place in line is set when your deposit comes in/.test(card) && /Pay the 75% deposit, \$6.96, with Venmo/.test(card) && /Pay in full, \$9\.28/.test(card), card);
    await later.close();
    const owner = await open(db);
    await owner.evaluate(asOwner('dashboard'));
    assert(/Queue:\s+3 confirmed orders \(1 custom\)/.test(await owner.textContent('main')) && /2 waiting for a deposit/.test(await owner.textContent('main')), `owner queue summary: ${(await owner.textContent('main')).match(/Queue:[^.]*\./)}`);
    assert(/#1 in line/.test(await owner.textContent('#order-q1')) && /Waiting for deposit/.test(await owner.textContent('#order-1')), 'owner positions');
    await owner.selectOption('#order-1 .owner-batch-controls select >> nth=1', 'deposit_received');
    await owner.waitForTimeout(300);
    assert(db.jobs['1'].depositAt && db.jobs['1'].depositAmount === 6.96, JSON.stringify(db.jobs['1']));
    assert(/#2 in line/.test(await owner.textContent('#order-1')), 'deposit just now: behind Bo, whose deposit came first');
    await owner.close();
    const paid = await open(db);
    await paid.evaluate(STATES['my requests']);
    card = await paid.textContent('#order-1');
    assert(/You're #3 in line/.test(card) && /Deposit received \(\$6.96\)/.test(card) && /Pay the rest, \$2.32/.test(card), card);
    await paid.close();
  });
  await check('design links use the name, and match the link-preview function', async () => {
    const page = await open(fixtures(), { suffix: '?design=name-sign' });
    await page.waitForSelector('#work-detail');
    assert(/Name Sign/.test(await page.textContent('#work-detail')), 'name link did not open the design');
    const samples = [
      { id: 'a1', title: 'Café Sign — Large!', createdAt: '2026-01-01' }, { id: 'a2', title: 'Cafe sign large', createdAt: '2026-02-01' },
      { id: 'a3', title: '', createdAt: '2026-03-01' }, { id: 'a4', title: '   ***   ', createdAt: '2026-03-02' }
    ];
    const site = await page.evaluate(all => all.map(d => designSlug(d, all)), samples);
    const api = require('../api/design.js');
    const fn = samples.map(d => api.designSlug(d, samples));
    assert(JSON.stringify(site) === JSON.stringify(fn) && site.join() === 'cafe-sign-large,cafe-sign-large-2,a3,a4', `site ${site} vs function ${fn}`);
    assert(api.findDesign('cafe-sign-large-2', samples).id === 'a2' && api.findDesign('a1', samples).id === 'a1', 'function lookup');
    await page.close();
  });
  await check('color ideas: owner matches photo areas to parts; customers see the photo repainted and request those colors', async () => {
    const db = fixtures();
    const owner = await open(db);
    await owner.evaluate(asOwner('gallery'));
    await owner.evaluate(() => editGalleryItem('g1'));
    await owner.click('#add-design-part');
    await owner.fill('#part-name-0', 'Body');
    await owner.click('#add-design-part');
    await owner.fill('#part-name-1', 'Eyes');
    // A render: gray background, a gold part with a lit and a shaded face, a small blue part.
    const png = await owner.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 200; c.height = 150;
      const x = c.getContext('2d');
      x.fillStyle = '#56565a'; x.fillRect(0, 0, 200, 150);
      x.fillStyle = '#c89c00'; x.fillRect(20, 20, 100, 60);
      x.fillStyle = '#785c03'; x.fillRect(20, 80, 100, 30);
      x.fillStyle = '#0a3c80'; x.fillRect(150, 40, 20, 20);
      return c.toDataURL('image/png').split(',')[1];
    });
    await owner.setInputFiles('#cm-upload', { name: 'render.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await owner.waitForSelector('text=colored areas. Pick a part');
    const regions = await owner.evaluate(() => state.galleryForm.colorMap.regions.map(r => r.hexes[0]));
    const near = (hex, want) => { const a = parseInt(hex.slice(1), 16), b = parseInt(want.slice(1), 16); return Math.abs((a >> 16) - (b >> 16)) + Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) + Math.abs((a & 255) - (b & 255)); };
    let gold = regions.findIndex(h => near(h, '#c89c00') < 60 || near(h, '#a07c02') < 60), blue = regions.findIndex(h => near(h, '#0a3c80') < 30);
    assert(regions.length >= 3 && gold >= 0 && blue >= 0, `areas found: ${regions}`);
    assert(regions.filter(h => near(h, '#c89c00') < 140 && h !== regions[blue] && near(h, '#56565a') > 60).length === 1, `the gold part's two shades should be one area: ${regions}`);
    assert(db.uploads.some(u => /^gallery\/g1\/colors-\d+\.png$/.test(u)), db.uploads.join());
    // Joining areas by hand: two become one (and split back apart).
    const others = [0, 1, 2, 3].filter(k => k !== gold && k !== blue && k < regions.length);
    await owner.check(`#cm-join-${gold}`);
    await owner.check(`#cm-join-${others[0]}`);
    await owner.click('#cm-join');
    let now = await owner.evaluate(() => state.galleryForm.colorMap.regions.map(r => r.hexes.length));
    assert(now.length === regions.length - 1 && now[Math.min(gold, others[0])] === 2, `after joining: ${now}`);
    await owner.click(`#cm-split-${Math.min(gold, others[0])}`);
    now = await owner.evaluate(() => state.galleryForm.colorMap.regions.map(r => r.hexes.join()));
    assert(now.length === regions.length && now.every(h => regions.includes(h)), `after splitting: ${now}`);
    gold = now.indexOf(regions[gold]); blue = now.indexOf(regions[blue]);
    const partIds = await owner.evaluate(() => state.galleryForm.parts.map(p => p.id));
    await owner.selectOption(`#cm-region-${gold}`, partIds[0]);
    await owner.selectOption(`#cm-region-${blue}`, partIds[1]);
    await owner.waitForSelector('#cm-add-combo');
    await owner.click('#cm-add-combo');
    await owner.fill('#cm-combo-name-0', 'Red and black');
    await owner.selectOption('#cm-combo-0-0', 'red');
    await owner.selectOption('#cm-combo-0-1', 'black');
    await owner.click('#cm-add-combo');
    await owner.fill('#cm-combo-name-1', 'Shiny');
    await owner.selectOption('#cm-combo-1-0', 'silk');
    await owner.waitForFunction(() => document.querySelectorAll('#color-map-form canvas.cm-ready').length >= 5);
    // A second set of the body: copied part, and a new picture with that set in orange.
    await owner.click('#part-copy-0');
    assert(await owner.inputValue('#part-name-1') === 'Body (set 2)', await owner.inputValue('#part-name-1'));
    const setId = await owner.evaluate(() => state.galleryForm.parts[1].id);
    assert(/"Body \(set 2\)"/.test(await owner.textContent('#cm-missing')), 'warns that the copied set has no area in the picture');
    const png2 = await owner.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 200; c.height = 150;
      const x = c.getContext('2d');
      x.fillStyle = '#56565a'; x.fillRect(0, 0, 200, 150);
      x.fillStyle = '#c89c00'; x.fillRect(20, 20, 50, 60);
      x.fillStyle = '#785c03'; x.fillRect(20, 80, 50, 30);
      x.fillStyle = '#e0600a'; x.fillRect(70, 20, 50, 90);
      x.fillStyle = '#0a3c80'; x.fillRect(150, 40, 20, 20);
      return c.toDataURL('image/png').split(',')[1];
    });
    await owner.setInputFiles('#cm-upload', { name: 'render2.png', mimeType: 'image/png', buffer: Buffer.from(png2, 'base64') });
    await owner.waitForSelector('text=colored areas. Pick a part');
    const areas = await owner.evaluate(() => state.galleryForm.colorMap.regions.map(r => ({ hex: r.hexes[0], part: r.part })));
    const orange = areas.findIndex(r => near(r.hex, '#e0600a') < 40);
    assert(orange >= 0 && !areas[orange].part && areas.some(r => r.part === partIds[0]) && areas.some(r => r.part === partIds[1]), `kept matches, new area for set 2: ${JSON.stringify(areas)}`);
    await owner.selectOption(`#cm-region-${orange}`, setId);
    assert(!(await owner.$('#cm-missing')), 'no warning once every part has an area');
    assert(await owner.evaluate(id => state.galleryForm.colorMap.combos[0].colors[id], setId) === 'red', 'the copy starts with the same color in each idea');
    await owner.selectOption('#cm-combo-0-1', 'black');
    await owner.click('#gallery-save');
    await owner.waitForTimeout(300);
    const map = db.gallery.g1.data.colorMap;
    assert(map && /colors-\d+\.png$/.test(map.photo) && map.regions.some(r => r.part === partIds[0]) && map.regions.some(r => r.part === partIds[1]) && map.regions[orange].part === setId
      && map.combos[0].name === 'Red and black' && map.combos[0].colors[partIds[0]] === 'red', JSON.stringify(map));
    await owner.close();

    db.settings.colors.find(c => c.id === 'silk').outOfStock = true;
    db.settings.colors.find(c => c.id === 'red').rate = 0.5;
    db.gallery.g1.data.parts.forEach(p => { p.grams = 40; });
    const page = await open(db, { suffix: '?design=dragon-organizer' });
    await page.waitForSelector('#color-ideas canvas.cm-ready');
    const picks = await page.$$eval('.cm-picks button', b => b.map(x => x.textContent.trim()));
    assert(picks.join() === 'Red and black,Pick your own', `out-of-stock ideas are hidden: ${picks}`);
    const pixel = (x, y) => page.evaluate(([x, y]) => [...document.querySelector('#color-ideas canvas').getContext('2d').getImageData(x, y, 1, 1).data].slice(0, 3), [x, y]);
    const lit = await pixel(60, 40), shade = await pixel(60, 95), bg = await pixel(5, 5);
    assert(lit[0] > 150 && lit[1] < 90 && lit[2] < 90, `the body should be red: ${lit}`);
    assert(shade[0] < lit[0] && shade[0] > 60 && shade[1] < 60, `the shaded face should stay a darker red: ${shade}`);
    assert(bg.join() === '86,86,90', `the background is left as it is: ${bg}`);
    const set2 = await pixel(95, 40);
    assert(set2[0] < 60 && set2[1] < 60, `the second set is painted in its own color (black): ${set2}`);
    assert(/Body: Red/.test(await page.textContent('.cm-legend')), await page.textContent('.cm-legend'));
    assert(/color:#[0-9a-f]{6};background-color:#1c1c21/.test(await page.getAttribute('.cm-legend .color-name', 'style')), 'color names are written in their color');
    // The estimate follows the colors picked: Red costs more per gram here.
    const prices = async () => [await page.textContent('#cm-price .gallery-price'), await page.textContent('#work-price .gallery-price')].map(x => x.match(/\$[\d.]+/)[0]);
    const before = await prices();
    assert(before[0] === before[1] && /Red/.test(await page.textContent('#cm-price')), `card and page price match: ${before}`);
    await page.click('#cm-pick-own');
    await page.selectOption('#cm-own-2', 'red');
    assert(await page.evaluate(() => document.activeElement.id) === 'cm-own-2', 'focus stays on the color picked');
    const after = await prices();
    assert(after[0] === after[1] && parseFloat(after[0].slice(1)) > parseFloat(before[0].slice(1)), `more red should cost more: ${before} -> ${after}`);
    assert(/In the colors picked above/.test(await page.textContent('#work-price')), await page.textContent('#work-price'));
    await page.click('#work-price button:has-text("Request this")');
    await page.waitForSelector('.cm-request canvas.cm-ready');
    const it = await page.evaluate(() => state.draftItems[0]);
    assert(it.designParts[0].colorId === 'red' && it.designParts[1].colorId === 'black' && it.designParts[2].colorId === 'red' && it.colorId === 'red' && it.extraColors.length === 1 && it.extraColors[0].parts === 'Body (set 2)', JSON.stringify(it.designParts));
    assert((await page.textContent('#customer-price-preview-0')).includes(after[0]), `request estimate matches: ${await page.textContent('#customer-price-preview-0')} vs ${after[0]}`);
    await page.selectOption('#part-color-0-2', 'black');
    assert(/background:\s*#1e1e24/.test(await page.getAttribute('#part-color-0-2 >> xpath=preceding-sibling::span[contains(@class,"color-dot")]', 'style')), 'a dot in the true color sits beside the picker');
    await page.waitForFunction(() => { const c = document.querySelector('.cm-request canvas.cm-ready'); if (!c) return false; const d = c.getContext('2d').getImageData(160, 50, 1, 1).data; return d[0] < 60 && d[1] < 60; });
    await page.close();
  });
  await check('header shows how many minutes ago the site was updated, and hides after an hour', async () => {
    const db = fixtures();
    db.deployedMinsAgo = 7;
    const page = await open(db, { width: 390 });
    await page.waitForSelector('.build-badge-phone:not([hidden])');
    assert(await page.textContent('.build-badge-phone') === 'Updated 7 min ago' && await page.isVisible('.build-badge-phone') && !(await page.isVisible('#build-badge')), await page.textContent('.build-badge-phone'));
    db.deployedMinsAgo = 0;
    await page.evaluate(() => loadLastUpdate());
    assert(await page.textContent('.build-badge-phone') === 'Updated just now', await page.textContent('.build-badge-phone'));
    await page.setViewportSize({ width: 1100, height: 900 });
    assert(await page.isVisible('#build-badge') && !(await page.isVisible('.build-badge-phone')), 'wide screens show it in the header');
    db.deployedMinsAgo = 61;
    await page.evaluate(() => loadLastUpdate());
    assert(await page.evaluate(() => [...document.querySelectorAll('.build-badge')].every(e => e.hidden)), 'over an hour: hidden');
    await page.close();
  });
  await check('company logo add-on: note on every design, tick box adds the logo price, saved with the request', async () => {
    const db = fixtures();
    db.settings.rules = { ...(db.settings.rules || {}), logoPrice: 1.5 };
    const page = await open(db, { suffix: '?design=dragon-organizer' });
    await page.waitForSelector('#logo-offer');
    assert(/company logo/i.test(await page.textContent('#logo-offer')) && /\$1\.50/.test(await page.textContent('#logo-offer')), await page.textContent('#logo-offer'));
    await page.click('#work-price button:has-text("Request this")');
    await page.waitForSelector('#logo-0');
    const price = async () => parseFloat((await page.textContent('#customer-price-preview-0')).match(/\$([\d.]+)/)[1]);
    const before = await price();
    await page.check('#logo-0');
    const after = await price();
    assert(Math.abs(after - before - 1.5) < 0.001, `logo adds $1.50: ${before} -> ${after}`);
    await page.fill('#client-name', 'Lee');
    await page.fill('#client-email', 'lee@example.com');
    await page.click('#submit-btn');
    await requestSent(page);
    const job = Object.values(db.jobs).find(j => j.clientName === 'Lee');
    assert(job.items[0].logo === true, JSON.stringify(job.items[0]));
    await page.close();
  });
  await check('orders marked paid with the old spelling show as paid, and marking paid records the date', async () => {
    const db = fixtures();
    db.jobs['2'].paymentStatus = 'payment_recieved';
    const page = await open(db);
    await page.evaluate(asOwner('dashboard'));
    await page.waitForTimeout(300);
    assert(await page.evaluate(() => state.batches.find(b => b.id === '2').paymentStatus) === 'payment_received', 'old spelling should read as paid');
    db.jobs['1'].paymentStatus = 'deposit_received';
    await page.evaluate(() => { state.batches.find(b => b.id === '1').paymentStatus = 'deposit_received'; return updatePaymentStatus('1', 'payment_received'); });
    assert(db.jobs['1'].paidAt, 'paid date recorded');
    await page.close();
  });
  await check('confirm details: owner writes questions, sees and edits the exact email, sends it; quoting still works after', async () => {
    const db = fixtures();
    db.jobs['9'] = { id: '9', clientName: 'Ana', clientEmail: 'ana@example.com', createdAt: new Date().toISOString(), phase: 'estimate', paymentStatus: 'unpaid',
      items: [{ name: 'Phone stand', qty: 2, filType: 'black', notes: 'Fits an iPad?' }] };
    const page = await open(db);
    await page.evaluate(asOwner('dashboard'));
    await page.click('#details-open-9');
    await page.fill('#details-q-9', 'Which iPad model?');
    const body = await page.inputValue('#details-body-9');
    assert(/Hi Ana/.test(body) && /Which iPad model\?/.test(body) && /Phone stand x 2/.test(body) && /Notes: Fits an iPad\?/.test(body) && /(Estimated )?[Pp]rice: (\$|I'll)/.test(body) && /Jeff Solomon/.test(body), body);
    await page.fill('#details-body-9', body + '\nP.S. Edited by hand.');
    await page.fill('#details-q-9', 'Changed question');
    assert(/Edited by hand/.test(await page.inputValue('#details-body-9')), 'edits to the email are kept');
    await page.click('#details-send-9');
    await page.waitForTimeout(300);
    const job = db.jobs['9'];
    assert(job.phase === 'details_check' && /Edited by hand/.test(job.detailsEmail.body) && job.detailsEmail.subject && job.detailsQuestions === 'Changed question' && job.phaseHistory.details_check, JSON.stringify(job));
    assert(await page.$('#approve-btn-9'), 'the quote can still be sent from Confirming Details');
    await page.close();
    const customer = await open(db, { suffix: '?requests=ana%40example.com' });
    await customer.waitForSelector('.details-questions');
    assert(/Changed question/.test(await customer.textContent('.details-questions')), 'customer sees the questions');
    await customer.close();
  });
  await check('messages: the conversation on each order, who it is waiting on, and sending from both sides', async () => {
    const db = fixtures();
    const t = n => new Date(Date.now() - n * 60000).toISOString();
    db.messages = [
      { id: 1, job_id: '1', sender: 'owner', via: 'auto', subject: 'Your SoloPrint quote: $9.28', body: 'Hi Jane, your quote...', created_at: t(60) },
      { id: 2, job_id: '1', sender: 'customer', via: 'email', subject: 'Re: Your SoloPrint quote', body: 'Can it be blue? Like https://example.com/blue.', created_at: t(30) }];
    const owner = await open(db);
    await owner.evaluate(asOwner('settings/updates'));
    await owner.waitForSelector('.update-item');
    assert((await owner.$$('.update-item')).length === 1, 'CLAUDE.md notes are left out of Updates');
    await owner.click('.update-item summary');
    const upd = await owner.textContent('.update-body');
    assert(/Links:/.test(upd) && !/Generated with|claude\.ai/.test(upd), upd);
    await owner.evaluate(asOwner('dashboard'));
    const chip = await owner.evaluate(() => finalPaymentChip({ ...state.batches[0], phase: 'final_payment_needed', paymentStatus: 'deposit_received', depositAmount: 1, ownerPrice: null }));
    assert(/Waiting for \$\d+\.\d\d \(includes \$15\.00 shipping deposit\)/.test(chip), chip);
    await owner.waitForSelector('.waiting-banner');
    assert(/1 conversation is waiting on you/.test(await owner.textContent('.waiting-banner')), await owner.textContent('.waiting-banner'));
    assert(/Waiting on you/.test(await owner.textContent('#order-1 .job-title')), 'order card says waiting on you');
    const thread = await owner.textContent('#conv-1');
    assert(/Can it be blue\?/.test(thread) && /by email/.test(thread) && /Your SoloPrint quote/.test(thread), thread);
    assert(await owner.getAttribute('#conv-1 .msg-body a[href="https://example.com/blue"]', 'target') === '_blank', 'links in messages open');
    await owner.evaluate(() => { const d = document.createElement('div'); d.id = 'link-check'; d.textContent = 'See https://example.com/x, thanks'; document.querySelector('#order-1').append(d); });
    await owner.waitForSelector('#link-check a.auto-link[href="https://example.com/x"]');
    assert(/^Hi Jane, thanks for your request/.test(await owner.inputValue('#msg-text-1')), 'first reply starts from the default text');
    const grow = await owner.$eval('#msg-text-1', el => { el.value = 'line\n'.repeat(30); el.dispatchEvent(new Event('input')); return el.clientHeight >= el.scrollHeight - 2; });
    assert(grow, 'the message box grows to fit');
    await owner.fill('#msg-text-1', 'Yes, blue works.');
    await owner.click('#msg-send-1');
    await owner.waitForTimeout(300);
    const sent = db.messages[db.messages.length - 1];
    assert(sent.sender === 'owner' && sent.via === 'site' && sent.job_id === '1' && sent.body === 'Yes, blue works.', JSON.stringify(sent));
    assert(/Waiting on customer/.test(await owner.textContent('#order-1 .job-title')) && !(await owner.$('.waiting-banner')), 'now waiting on the customer');
    assert(await owner.inputValue('#msg-text-1') === '', 'no default text once you have written');
    const editable = Object.keys(db.jobs).find(id => ['estimate', 'details_check', undefined].includes(db.jobs[id].phase));
    if (await owner.$(`#chat-edit-${editable}`)) {
      await owner.click(`#conv-${editable} > summary`);
      await owner.click(`#chat-edit-${editable}`);
      await owner.waitForSelector(`.chat-edit #conv-${editable} + #owner-edit-${editable}`);
      assert(await owner.$eval(`#conv-${editable}`, el => el.open), 'the conversation stays open beside the edit form');
      await owner.click('#owner-edit-save');
      await owner.waitForTimeout(300);
      assert(!(await owner.$('.chat-edit')), 'saving closes the edit form');
    } else throw new Error('no order with an "Edit their request" button');
    await owner.evaluate(asOwner('clients'));
    await owner.waitForSelector('#client-notes');
    await owner.fill('#client-notes', 'Prefers pickup.');
    await owner.fill('#client-issues', 'Paid late once.');
    await owner.waitForTimeout(1000);
    const notes = db.private.clients && db.private.clients['jane@example.com'];
    assert(notes && notes.notes === 'Prefers pickup.' && notes.issues === 'Paid late once.', JSON.stringify(db.private));
    assert(!JSON.stringify(db.jobs).includes('Paid late once'), 'client notes must never be saved in an order');
    await owner.close();
    const page = await open(db, { suffix: '?requests=jane%40example.com' });
    await page.waitForSelector('#conv-1 .thread');
    assert(/Yes, blue works\./.test(await page.textContent('#conv-1')), 'customer sees your message');
    await page.fill('#cmsg-text-1', 'Great, thanks!');
    await page.click('#cmsg-send-1');
    await page.waitForFunction(() => /Great, thanks!/.test(document.querySelector('#conv-1').textContent));
    assert(db.messages.some(m => m.sender === 'customer' && m.via === 'site' && m.body === 'Great, thanks!'), 'customer message saved');
    await page.close();
  });
  await check('practice order: both sides on one page, emails only in the chat, nothing saved or sent', async () => {
    const db = fixtures();
    const jobsBefore = JSON.stringify(db.jobs), messagesBefore = db.messages.length;
    const page = await open(db, { width: 1200 });
    await page.evaluate(asOwner('practice'));
    await page.waitForSelector('#practice-start');
    db.log.length = 0;
    await page.click('#practice-start');
    const cust = () => page.textContent('#practice-cust-h + * ~ .conversation, .practice-side:first-child .conversation');
    const own = () => page.textContent('.practice-side:last-child .conversation');
    assert(/We received your SoloPrint request/.test(await cust()) && /Email to you: New SoloPrint request/.test(await own()) && !/Email to you/.test(await cust()), 'request emails in the chat, the owner note only on your side');
    await page.fill('#practice-questions', 'Which tablet is it for?');
    await page.click('#practice-ask');
    assert(/Which tablet is it for\?/.test(await cust()) && /My questions for you/.test(await page.textContent('.practice-side:first-child')), 'details questions reach the customer');
    await page.fill('#practice-customer-msg', 'An iPad Air.');
    await page.click('#practice-customer-send');
    assert(/Waiting on you/.test(await page.textContent('.practice-side:last-child .job-title')), 'waiting on you after the customer writes');
    assert(await page.$eval('.practice-side:first-child .thread li:last-child', e => e.classList.contains('msg-mine')) && await page.$eval('.practice-side:last-child .thread li:last-child', e => e.classList.contains('msg-theirs')),
      "the customer's message is on their right, and on your left");
    await page.click('#practice-quote');
    assert(/Your SoloPrint quote: \$/.test(await cust()), 'quote email');
    await page.click('#practice-approve');
    assert(/approved their quote/.test(await own()), 'approval note to you');
    await page.selectOption('#practice-phase', 'order_received');
    assert(/order is confirmed/.test(await cust()), 'confirmed email');
    await page.click('#practice-pay-deposit');
    await page.selectOption('#practice-payment', 'deposit_received');
    assert(/Deposit received/.test(await cust()), 'deposit email');
    await page.selectOption('#practice-phase', 'final_payment_needed');
    await page.selectOption('#practice-payment', 'payment_received');
    await page.selectOption('#practice-phase', 'ready_to_ship');
    await page.fill('#practice-tracking', 'USPS 9400 1111');
    await page.click('text=Save tracking and mark Shipped');
    await page.click('#practice-skip');
    const all = await cust();
    ['final payment', 'Payment received', 'is on its way', 'Tracking number: USPS 9400 1111', 'How did your SoloPrint order turn out'].forEach(w => assert(all.includes(w), `missing email: ${w}`));
    assert(db.log.every(l => l.startsWith('GET')), `practice must not write anything: ${db.log.filter(l => !l.startsWith('GET'))}`);
    assert(JSON.stringify(db.jobs) === jobsBefore && db.messages.length === messagesBefore, 'real orders and messages untouched');
    await page.close();
  });
  await check('installable as an app: manifest and icons', async () => {
    const root = path.resolve(__dirname, '..');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
    assert(manifest.display === 'standalone' && manifest.icons.length === 2 && manifest.icons.every(i => fs.existsSync(path.join(root, i.src))), 'manifest or icons missing');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert(html.includes('rel="manifest"') && html.includes('apple-touch-icon') && fs.existsSync(path.join(root, 'icons/apple-touch-icon.png')), 'index.html is missing the app tags');
  });

  await browser.close();
  finish();
})();
