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
// Each order's private key, like the 64-character ones the database makes (the site only needs 32 to 128 letters, digits, - or _).
const keyOf = id => 'KEY' + String(id).replace(/[^A-Za-z0-9_-]/g, '_').padEnd(40, 'x');
const keysFor = (db, email) => Object.values(db.jobs).filter(j => j.clientEmail === email).map(j => keyOf(j.id));
// Opens an order the way a link in your email does: its customer, with the order in view.
const showOrder = id => `focusOwnerOrder(${JSON.stringify(id)})`;
const asCustomer = keys => `state.tokens = ${JSON.stringify(keys)}; await loadBatches(true);`;

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
      reviews: [{ id: 'r1', name: 'Mike T.', text: 'Came out perfect.', designId: 'g1', rating: 4.5, source: 'etsy' }] },
    private: {}, reviews: {}, colorIdeas: [], uploads: [], drafts: {}, messages: [], linkRequests: [],
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
      const mins = db.deployedMinsAgo ?? 59;   // the same deploy keeps the same time, like the real list
      if (db.deployMins !== mins) { db.deployMins = mins; db.deployAt = new Date(Date.now() - mins * 60000 - 5000).toISOString(); }
      return route.fulfill({ json: [{ created_at: db.deployAt }], headers: { 'Access-Control-Allow-Origin': '*' } });
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
    // Like supabase/order-links.sql: customers get in with an order's private key, never with an email.
    const jobByKey = key => Object.values(db.jobs).find(j => keyOf(j.id) === key);
    if (rest.startsWith('/rpc/customer_messages') || rest.startsWith('/rpc/customer_send_message')) {
      const a = JSON.parse(req.postData());
      const job = jobByKey(a.p_token);
      if (rest.startsWith('/rpc/customer_send_message')) {
        if (!job || !String(a.p_body || '').trim()) return route.fulfill({ status: 400, json: {} });
        db.messages.push({ id: db.messages.length + 1, job_id: job.id, sender: 'customer', via: 'site', subject: '', body: a.p_body.trim(), created_at: new Date().toISOString() });
        return route.fulfill({ status: 204, body: '' });
      }
      return route.fulfill({ json: job ? db.messages.filter(m => m.job_id === job.id).map(m => ({ id: m.id, sender: m.sender, via: m.via, subject: m.subject, body: m.body, at: m.created_at })) : [] });
    }
    if (rest.startsWith('/rpc/customer_orders')) {
      const { p_tokens } = JSON.parse(req.postData());
      return route.fulfill({ json: p_tokens.slice(0, 25).map(jobByKey).filter(Boolean).map(j => ({ ...j, accessToken: keyOf(j.id) })) });
    }
    if (rest.startsWith('/rpc/request_order_links')) { db.linkRequests.push(JSON.parse(req.postData()).p_email); return route.fulfill({ status: 204, body: '' }); }
    if (rest.startsWith('/rpc/submit_job')) {
      // Like supabase/security.sql: prices, charges and order records are the owner's to set.
      const { job } = JSON.parse(req.postData());
      ['extraCharges', 'rates', 'specialOrderCost', 'designTerms', 'stockTaken', 'paidAt', 'finishedPhotos', 'ownerEditedAt', 'depositAt', 'depositAmount', 'customerApprovedAt', 'status'].forEach(k => delete job[k]);
      job.phase = 'estimate'; job.paymentStatus = 'unpaid';
      job.items = job.items.map(it => { const { ownerPrice, ...rest } = it; return rest; });
      db.jobs[job.id] = job; return route.fulfill({ json: keyOf(job.id) });
    }
    if (rest.startsWith('/rpc/customer_approve_quote')) { const job = jobByKey(JSON.parse(req.postData()).p_token); if (job && job.phase === 'quote_sent' && !job.customerApprovedAt) { job.customerApprovedAt = new Date().toISOString(); if ((db.settings.features || {}).autoDeposit !== false) { job.phase = 'order_received'; job.phaseHistory = { ...(job.phaseHistory || {}), order_received: new Date().toISOString() }; } } return route.fulfill({ status: 204, body: '' }); }
    if (rest.startsWith('/jobs')) {
      if (!owner) return route.fulfill({ status: 401, json: {} });
      if (method === 'GET') return route.fulfill({ json: Object.values(db.jobs).map(data => ({ data: { ...data, accessToken: keyOf(data.id) } })) });
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
      const job = jobByKey(r.p_token);
      if (!job || job.phase !== 'delivered') return route.fulfill({ status: 400, json: { message: 'order not found' } });
      db.reviews[job.id] = { job_id: job.id, name: r.p_name, text: r.p_text, rating: r.p_rating, photos: r.p_photos || [], status: 'new' };
      return route.fulfill({ status: 204, body: '' });
    }
    if (rest.startsWith('/rpc/submit_color_idea')) {
      const r = JSON.parse(req.postData());
      if (!db.gallery[r.p_design] || !r.p_name) return route.fulfill({ status: 400, json: { message: 'invalid color idea' } });
      db.colorIdeas.push({ id: 'ci' + (db.colorIdeas.length + 1), design_id: r.p_design, name: r.p_name, colors: r.p_colors, created_at: new Date().toISOString() });
      return route.fulfill({ status: 204, body: '' });
    }
    if (rest.startsWith('/color_ideas')) {
      if (!owner) return route.fulfill({ status: 401, json: {} });
      if (method === 'GET') return route.fulfill({ json: db.colorIdeas });
      if (method === 'DELETE') { const id = decodeURIComponent(url.split('id=eq.')[1]); db.colorIdeas = db.colorIdeas.filter(c => c.id !== id); return route.fulfill({ status: 204, body: '' }); }
    }
    if (rest.startsWith('/rpc/order_queue')) {
      const q = Object.values(db.jobs).filter(j => ['order_received', 'production'].includes(j.phase))
        // Like supabase/queue.sql: place in line = deposit (or full payment) time; none yet = last.
        .map(j => ({ at: j.depositAt || j.paidAt || null, printing: j.phase === 'production', custom: !!j.designTerms || (j.items || []).some(it => it.mode === 'idea') }))
        .sort((a, b) => (a.at ? 0 : 1) - (b.at ? 0 : 1) || String(a.at).localeCompare(String(b.at)));
      return route.fulfill({ json: q });
    }
    if (rest.startsWith('/request_drafts') && method === 'GET') return owner ? route.fulfill({ json: Object.values(db.drafts).map(d => ({ email: d.email, name: d.name, data: d.data, updated_at: new Date().toISOString() })) }) : route.fulfill({ status: 401, json: {} });
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
      if (method === 'POST') {
        const row = JSON.parse(req.postData());
        if (!/^[a-z_]{1,40}$/.test(row.key)) return route.fulfill({ status: 400, json: { message: 'owner_private_key_check' } });   // same check as owner-tools.sql
        db.private[row.key] = row.data; return route.fulfill({ status: 201, body: '' });
      }
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
    if (url.includes('/auth/v1/logout')) { db.log.push('AUTH logout ' + url.split('scope=')[1]); return route.fulfill({ status: 204, body: '' }); }
    if (url.includes('/auth/v1/token')) {
      const body = JSON.parse(req.postData());
      db.log.push(url.includes('refresh_token') ? 'AUTH refresh' : 'AUTH password');
      if (url.includes('grant_type=refresh_token')) {
        return body.refresh_token === 'REFRESH-1' ? route.fulfill({ json: { access_token: 'OWNER-TOKEN', refresh_token: 'REFRESH-2', expires_in: 3600 } }) : route.fulfill({ status: 400, json: { error: 'invalid_grant' } });
      }
      return body.password === 'right-password'
        ? route.fulfill({ json: { access_token: 'OWNER-TOKEN', refresh_token: 'REFRESH-1', expires_in: 3600 } })
        : route.fulfill({ status: 400, json: { error: 'invalid_grant' } });
    }
    if (url.startsWith('https://script.google.com/')) return route.fulfill({ json: { ok: true, source: 'MakerWorld', name: 'Articulated Dragon', image: 'https://img.test/d1.png', profile: '0.2mm', plates: 1, minutes: 150, grams: 85.4 } });
    if (url.startsWith('https://api.microlink.io/')) return route.fulfill({ json: { status: 'success', data: { title: 'Model', image: { url: 'https://img.test/m.png' } } } });
    return route.abort(); // fonts, CDNs and anything else stay offline
  });
}

// The pop-up before a step that emails the customer: send (default) or continue without the email.
const mailChoice = (page, send = true) => page.click(`.mail-modal button[data-send="${send ? 1 : 0}"]`, { timeout: 4000 });

// Waits for the "we received your request" message instead of a fixed time (CI machines can be slow).
const requestSent = page => page.waitForFunction(() => /received your request/.test((document.getElementById('submit-ok') || {}).textContent || ''), null, { timeout: 15000 });

let browser;
async function open(db, { width = 1100, height = 900, suffix = '', init, colorScheme = 'light' } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, colorScheme });
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => (d.type() === 'prompt' ? d.accept(d.defaultValue()) : d.accept()));
  await mockBackend(page, db);
  await page.addInitScript(() => { try { localStorage.setItem('soloprint_shipnote_off', '1'); } catch (e) { /* ignore */ } });   // the shipping pop-up has its own check
  if (init) await page.addInitScript(init);
  await page.goto(SITE + suffix);
  await page.waitForFunction(() => !state.loading);
  await page.waitForTimeout(250);
  return page;
}

// 'settings/colors' opens a Settings section.
const asOwner = tab => `(async () => { state.ownerUnlocked = true; ownerSession = { token: 'OWNER-TOKEN', expiresAt: Date.now() + 3e6 }; state.view = 'owner'; state.ownerTab = '${tab.split('/')[0]}'; state.moneyOpenAll = ${tab.split('/')[0] === 'money'}; state.galleryFolds = ${tab.split('/')[0] === 'gallery'} ? { 'Pre-orders and people interested': true, 'Set-ups': true } : {}; state.settingsTab = '${tab.split('/')[1] || ''}'; await loadBatches(); await loadGallery(); render(); })()`;
const leadIn = "(() => { state.clientName = 'Test Person'; state.clientEmail = 't@example.com'; localStorage.setItem('soloprint_preorder_lead', JSON.stringify({ email: 't@example.com', designs: [] })); })()";
const STATES = {
  'home': '0',
  'home with many reviews': "(() => { state.settings.reviews = Array.from({ length: 7 }, (x, k) => ({ id: 'r' + k, name: 'Customer ' + k, text: 'Review number ' + k + ', the print came out great and it arrived fast.' })); render(); })()",
  'home with an item': "(() => { state.draftItems[0].mode = 'idea'; updateDraft(0, 'notes', 'A desk hook'); updateDraftPrintTime(0, 'hours', '1'); updateDraft(0, 'grams', 20); render(); })()",
  'home with a multi-color print': "(() => { state.draftItems[0].mode = 'idea'; updateDraft(0, 'notes', 'A sign'); state.draftItems[0].showExtras = true; render(); toggleExtraColor(0, 0); })()",
  'home with color info': "(() => { state.settings.colors[2].description = 'Shimmery gold'; state.settings.colors[2].link = 'https://example.com/silk'; state.draftItems[0].mode = 'idea'; pickColor(0, 'silk'); render(); })()",
  'quote with design terms': "(async () => { " + asCustomer(keysFor(fixtures(), 'jane@example.com')) + " state.batches.find(b => b.id === '1').designTerms = DEFAULT_DESIGN_TERMS; state.clientTab = 'jobs'; render(); })()",
  'home picking past work': "(async () => { await loadGallery(); setItemMode(0, 'gallery'); })()",
  'home with a special order color': "(() => { state.draftItems[0].mode = 'idea'; updateDraft(0, 'notes', 'A vase'); pickColor(0, ''); render(); })()",
  'design work': "(async () => { await loadGallery(); setTab('gallery'); })()",
  'design page': "(async () => { await loadGallery(); openWork('g1'); })()",
  'my requests': "(async () => { " + asCustomer(keysFor(fixtures(), 'jane@example.com')) + " state.clientTab = 'jobs'; render(); })()",
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
  'owner help': asOwner('help'),
  'owner preview': asOwner('preview'),
  'owner etsy spreadsheet': "(async () => { await (" + asOwner('money') + "); localStorage.setItem('soloprint_etsyView', 'sheet'); state.etsyView = 'sheet'; state.ownerPrivate.etsy = { orders: [{ id: 'e1', etsyId: '3100000001', date: new Date().getFullYear() + '-02-03', buyer: 'Sam Lee', items: 'Dragon x2', sale: 30, shipping: 6, tax: 2, fees: 3.1, label: 5.2, grams: 100, refund: 1 }, { id: 'e2', date: new Date().getFullYear() + '-03-03', items: 'Market sale', sale: 12 }], seen: ['2026-02-03|fee|Transaction fee: Shipping|Order #3100000001|0.39'] }; render(); })()",
  'owner etsy to make': "(async () => { await (" + asOwner('etsytodo') + "); state.ownerPrivate.etsy_todo = { orders: [{ id: 't1', etsyId: '4233804505', buyer: 'Jen', due: '2026-01-01', note: 'Gift', createdAt: '2026-01-01T00:00:00Z', done: false, lines: [{ id: 'l1', what: 'Base', color: 'Black', qty: 2, printed: 1 }, { id: 'l2', what: 'Spine', color: 'Red', qty: 1, printed: 0 }] }, { id: 't2', etsyId: '1', buyer: 'Bo', done: true, doneAt: '2026-01-02T00:00:00Z', lines: [{ id: 'l3', what: 'Hook', color: 'White', qty: 1, printed: 1 }] }] }; state.todoOpen = 't1'; state.todoDraft = { etsyId: '', buyer: '', due: '', note: '', lines: [{ id: 'd1', what: 'Base', color: 'Blue', qty: 1, printed: 0 }] }; render(); })()",
  'owner money with etsy': "(async () => { await (" + asOwner('money') + "); state.ownerPrivate.etsy = { orders: [{ id: 'e1', etsyId: '3100000001', date: new Date().getFullYear() + '-02-03', buyer: 'Sam Lee', items: 'Dragon x2', sale: 30, shipping: 6, tax: 2, fees: 3.1, label: 5.2, grams: 100, refund: 0 }], costs: [{ id: 'c1', date: new Date().getFullYear() + '-02-01', what: 'Listing fees', amount: 0.4 }] }; state.etsyEdit = ''; state.etsyImport = { plans: [{ kind: 'orders', fileName: 'EtsySoldOrders.csv', add: [], update: [], keep: 1, costs: [], fees: [], items: [], skipped: 0 }, { kind: 'statement', fileName: 'etsy_statement.csv', add: [], update: [], keep: 0, covered: 0, costs: [], fees: [], items: [], skipped: 2 }], bad: ['notes.csv'], result: state.ownerPrivate.etsy }; render(); })()",
  'design page pre-order': "(async () => { await loadGallery(); state.gallery[0].preorder = true; state.gallery[0].preorderReady = 'early January'; openWork('g1'); })()",
  'owner gallery pre-order': "(async () => { await " + asOwner('gallery') + "; state.gallery[0].preorder = true; state.batches[0].items[0].preorder = true; state.batches[0].items[0].galleryId = 'g1'; state.galleryForm.preorder = true; render(); })()",
  'design page with parts': "(async () => { await loadGallery(); openWork('g2'); })()",
  'request with a color per part': "(async () => { await loadGallery(); requestGalleryItem('g2'); })()",
  'owner gallery parts': "(async () => { await " + asOwner('gallery') + "; editGalleryItem('g2'); })()",
  'owner editing a request': "(async () => { await " + asOwner('dashboard') + "; startOwnerEdit('3'); })()",
  'leftover rolls and a review form': "(async () => { " + asCustomer(keysFor(fixtures(), 'jane@example.com')) + " state.batches[1].phase = 'delivered'; state.clientTab = 'jobs'; state.reviewFor = { id: '2' }; render(); })()",
  'my requests: no links on this device yet': "(() => { state.clientTab = 'jobs'; render(); })()",
  'home in vacation mode': "(() => { state.settings.vacation = { on: true, until: 'Nov 3' }; render(); })()"
};

(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const pages = { 'home': '0', 'design page': STATES['design page'], 'design parts': STATES['design page with parts'], 'request parts': STATES['request with a color per part'],
    'owner dashboard': STATES['owner dashboard'], 'owner gallery': STATES['owner gallery parts'], 'owner prices': STATES['owner settings prices'],
    'owner colors': STATES['owner settings colors'], 'owner money': STATES['owner money'], 'owner emails': STATES['owner emails'], 'owner help': STATES['owner help'], 'my requests': STATES['my requests'] };
  const out = {};
  for (const [name, code] of Object.entries(pages)) {
    const page = await open(fixtures(), { width: 1280, height: 800 });
    await page.evaluate(code); await page.waitForTimeout(400);
    out[name] = await page.evaluate(() => document.documentElement.scrollHeight);
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '/' + name.replace(/ /g, '_') + '.png' });
    await page.close();
  }
  const page = await open(fixtures(), { width: 1280, height: 800 });
  await page.evaluate(STATES['owner gallery parts']); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelectorAll('details.part-allowed').forEach(d => { d.open = true; }));
  out['limit colors open'] = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log(JSON.stringify(out));
  await browser.close();
})();
