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
const asOwner = tab => `(async () => { state.ownerUnlocked = true; ownerSession = { token: 'OWNER-TOKEN', expiresAt: Date.now() + 3e6 }; state.view = 'owner'; state.ownerTab = '${tab.split('/')[0]}'; state.moneyOpenAll = ${tab.split('/')[0] === 'money'}; state.galleryFolds = ${tab.split('/')[0] === 'gallery'} ? { 'Pre-orders': true, 'Set-ups': true } : {}; state.settingsTab = '${tab.split('/')[1] || ''}'; await loadBatches(); await loadGallery(); render(); })()`;
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
  'owner add a design wizard': asOwner('newdesign'),
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
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  console.log('Pages load cleanly and meet WCAG 2.2 AA (axe-core):');
  for (const [name, code] of Object.entries(STATES).flatMap(([n, c]) => [[n, c, 'light'], [`${n} (dark mode)`, c, 'dark']]).map(([n, c, scheme]) => [n, c, scheme])) {
    await check(name, async () => {
      const page = await open(fixtures(), { colorScheme: name.endsWith('(dark mode)') ? 'dark' : 'light' });
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
    await page.waitForSelector('.desk-layout');
    assert(db.log.includes('GET /jobs owner'), 'dashboard did not load orders with the owner token');
    await page.close();
  });

  await check('owner login: "keep me logged in" survives an expired hour; unticked does not; logout forgets it', async () => {
    const db = fixtures();
    let page = await open(db);
    await page.evaluate(STATES['owner login']);
    await page.fill('#owner-pw', 'right-password');
    await page.check('#owner-remember');
    await page.click('#owner-login-btn');
    await page.waitForSelector('.desk-layout');
    assert(await page.evaluate(() => !!localStorage.getItem('soloprint_owner_remember_v1')), 'refresh token not kept');
    // the hour is up: only the remembered refresh token is left
    await page.evaluate(() => localStorage.setItem('soloprint_owner_session_v1', JSON.stringify({ token: 'OLD', expiresAt: Date.now() - 1000 })));
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && state.loading === false, null, { timeout: 15000 });
    await page.evaluate(STATES['owner login']);
    await page.evaluate(async () => { await loadBatches(); render(); });
    await page.waitForSelector('.desk-layout');
    assert(db.log.includes('AUTH refresh'), 'did not refresh the login');
    assert(JSON.parse(await page.evaluate(() => localStorage.getItem('soloprint_owner_remember_v1'))).refresh === 'REFRESH-2', 'newest refresh token not saved');
    await page.evaluate(() => logoutOwner());
    await page.waitForTimeout(150);
    assert(await page.evaluate(() => !localStorage.getItem('soloprint_owner_remember_v1')), 'logout kept the 30-day login');
    assert(db.log.includes('AUTH logout local'), 'logout did not end the login on Supabase');
    await page.close();
    // not ticked: nothing kept
    const db2 = fixtures();
    page = await open(db2);
    await page.evaluate(STATES['owner login']);
    await page.fill('#owner-pw', 'right-password');
    await page.click('#owner-login-btn');
    await page.waitForSelector('.desk-layout');
    assert(await page.evaluate(() => !localStorage.getItem('soloprint_owner_remember_v1')), 'kept a login without being asked');
    await page.close();
  });
  await check('change password: weak passwords refused with a reason', async () => {
    const out = await (async () => { const page = await open(fixtures()); const r = await page.evaluate(() => ['short1', 'password12345', 'aaaaaaaaaaaaaa', 'copper-lantern-seven-pickle'].map(weakPasswordReason)); await page.close(); return r; })();
    assert(out[0] && out[1] && out[2] && !out[3], JSON.stringify(out));
  });

  await check('color ideas: reverse two colors, save a combination, send it, and the owner renames and publishes it', async () => {
    const db = fixtures();
    db.gallery.g1.data.parts = [{ id: 'pa', name: 'Body', grams: 40 }, { id: 'pb', name: 'Eyes', grams: 10 }];
    db.gallery.g1.data.colorMap = { photo: 'https://img.test/cm.png', regions: [{ hexes: ['#c89c00'], part: 'pa' }, { hexes: ['#0a3c80'], part: 'pb' }],
      combos: [{ id: 'c1', name: 'Red and black', colors: { pa: 'red', pb: 'black' } }] };
    const page = await open(db, { suffix: '?design=dragon-organizer' });
    await page.waitForSelector('#color-ideas');
    await page.click('#cm-reverse');
    assert(await page.inputValue('#cm-own-0') === 'black' && await page.inputValue('#cm-own-1') === 'red', 'reverse swaps the two colors');
    await page.click('#cm-reverse');
    assert(await page.inputValue('#cm-own-0') === 'red' && await page.inputValue('#cm-own-1') === 'black', 'reversing again goes back');
    await page.click('#cm-reverse');
    await page.fill('#cm-save-name', 'Sunset');
    await page.click('#cm-save');
    assert(/Sunset \(mine\)/.test(await page.textContent('.cm-picks')), 'saved combination shows with the ideas');
    await page.click('#cm-send');
    await page.waitForSelector('#cm-send-msg:has-text("Sent")');
    assert(db.colorIdeas.length === 1 && db.colorIdeas[0].name === 'Sunset' && db.colorIdeas[0].colors.pa === 'black' && db.colorIdeas[0].colors.pb === 'red', JSON.stringify(db.colorIdeas));
    await page.close();
    const owner = await open(db);
    await owner.evaluate(asOwner('gallery'));
    await owner.waitForSelector('#color-inbox');
    await owner.fill('#cmi-name-ci1', 'Black and red');
    await owner.click('#color-inbox button:has-text("Publish for everyone")');
    await owner.waitForFunction(() => !document.getElementById('color-inbox'));
    const combos = db.gallery.g1.data.colorMap.combos;
    assert(combos.length === 2 && combos[1].name === 'Black and red' && combos[1].colors.pa === 'black' && db.colorIdeas.length === 0, JSON.stringify(combos));
    await owner.close();
    const cust = await open(db, { suffix: '?design=dragon-organizer' });
    await cust.waitForSelector('#color-ideas');
    assert(/Black and red/.test(await cust.textContent('.cm-picks')), 'published idea shows for everyone');
    await cust.close();
  });

  await check('color ideas: the owner pastes several named ideas at once, and a bad line adds nothing', async () => {
    const db = fixtures();
    db.gallery.g1.data.parts = [{ id: 'pa', name: 'Base', grams: 40 }, { id: 'pb', name: 'Spine', grams: 10 }];
    db.gallery.g1.data.colorMap = { photo: 'https://img.test/cm.png', regions: [{ hexes: ['#c89c00'], part: 'pa' }, { hexes: ['#0a3c80'], part: 'pb' }], combos: [] };
    const owner = await open(db);
    await owner.evaluate(asOwner('gallery'));
    await owner.evaluate(() => editGalleryItem('g1'));
    await owner.waitForSelector('#cm-paste', { state: 'attached' });
    await owner.evaluate(() => { document.querySelector('.cm-paste').open = true; });
    await owner.fill('#cm-paste', 'Santa Dragon, Red, Black\nLets Go Mets, black, silk gold\nBad, Red, Purple');
    await owner.click('#cm-paste-go');
    assert(/Purple/.test(await owner.textContent('#cm-paste-err')) && await owner.evaluate(() => state.galleryForm.colorMap.combos.length) === 0, 'a line with an unknown color adds nothing');
    await owner.fill('#cm-paste', 'Only Name, Red');
    await owner.click('#cm-paste-go');
    assert(/Line 1/.test(await owner.textContent('#cm-paste-err')), 'a line with too few colors is refused');
    await owner.fill('#cm-paste', 'Santa Dragon, Red, Black\nLets Go Mets, black, silk gold');
    await owner.click('#cm-paste-go');
    const combos = await owner.evaluate(() => state.galleryForm.colorMap.combos);
    assert(combos.length === 2 && combos[0].name === 'Santa Dragon' && combos[0].colors.pa === 'red' && combos[0].colors.pb === 'black' && combos[1].name === 'Lets Go Mets' && combos[1].colors.pb === 'silk', JSON.stringify(combos));
    await owner.click('#gallery-save');
    await owner.waitForTimeout(300);
    assert(db.gallery.g1.data.colorMap.combos.length === 2 && db.gallery.g1.data.colorMap.combos[1].name === 'Lets Go Mets', 'saved with the design');
    await owner.close();
  });

  await check('request form: switching between a past design and "I have an idea" keeps each one\'s own colors', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.evaluate(async () => { await loadGallery(); render(); });
    const snap = () => page.evaluate(() => { const it = state.draftItems[0]; return JSON.stringify({ g: it.galleryId, f: it.filType, c: it.colorId, p: (it.designParts || []).map(p => p.colorId), x: (it.extraColors || []).length }); });
    await page.evaluate(() => { pickGalleryForItem(0, 'g2'); setPartColor(0, 0, 'red'); });
    const design = await snap();
    assert(JSON.parse(design).p[0] === 'red' && JSON.parse(design).g === 'g2', design);
    await page.evaluate(() => { setItemMode(0, 'idea'); const it = state.draftItems[0]; it.notes = 'my own thing'; it.filType = 'special'; it.colorId = 'silk'; it.color = 'Silk Gold'; });
    assert(await page.evaluate(() => state.draftItems[0].designParts.length) === 0, 'the past design\'s parts do not leak into "I have an idea"');
    await page.evaluate(() => setItemMode(0, 'gallery'));
    assert(await snap() === design, `the past design comes back with its own colors: ${await snap()} vs ${design}`);
    await page.evaluate(() => setItemMode(0, 'idea'));
    assert(await page.evaluate(() => state.draftItems[0].colorId) === 'silk' && await page.evaluate(() => state.draftItems[0].notes) === 'my own thing', 'the idea keeps its own color and text');
    await page.close();
  });

  await check('send an email now: preview the review request, cancel changes nothing, send saves it once and stamps the daily job', async () => {
    const db = fixtures();
    Object.assign(db.jobs['1'], { phase: 'delivered', paymentStatus: 'payment_received', deliveryTracking: 'USPS 1', phaseHistory: { delivered: ago(2) } });
    const owner = await open(db);
    await owner.evaluate(asOwner('dashboard'));
    await owner.evaluate(showOrder('1'));
    await owner.evaluate(() => { document.getElementById('send-email-fold-1').open = true; });
    assert(await owner.locator('#send-email-review_request-1').isEnabled() && await owner.locator('#send-email-reminder-1').isDisabled(), 'review request is available on a shipped order, a quote reminder is not');
    await owner.click('#send-email-review_request-1');
    assert(/How did your SoloPrint order turn out/.test(await owner.inputValue('#mp-subject')) && /jane@example\.com/.test(await owner.textContent('.mail-modal .send-to')) && /review=1/.test(await owner.inputValue('#mp-body')), 'shows the exact email, ready to edit');
    await owner.click('.mail-modal button[data-go="0"]');
    assert(!db.jobs['1'].manualEmail, 'cancel saves nothing');
    await owner.click('#send-email-review_request-1');
    await owner.click('.mail-modal button[data-go="1"]');
    await owner.waitForSelector('#send-email-fold-1 .alert.success');
    const j = db.jobs['1'];
    assert(j.manualEmail && j.manualEmail.key === 'review_request' && j.manualEmail.at && j.reviewRequestedAt && j.manualEmails.length === 1, JSON.stringify(j));
    assert(/on its way to jane@example\.com/.test(await owner.textContent('#send-email-fold-1 .alert.success')), 'says it is on its way');
    assert(!j.manualEmail.body, 'unchanged: the email script fills in the template itself');
    // Edited: exactly this subject and text are saved for the email script to send.
    await owner.evaluate(() => { document.getElementById('send-email-fold-1').open = true; });
    await owner.click('#send-email-review_request-1');
    await owner.fill('#mp-subject', 'A review for 10% off?');
    const body = (await owner.inputValue('#mp-body')).replace('I\'d love a short review', 'leave a review for 10% off your next order');
    await owner.fill('#mp-body', body);
    await owner.click('.mail-modal button[data-go="1"]');
    await owner.waitForFunction(() => (state.batches.find(b => b.id === '1').manualEmails || []).length === 2);
    await owner.waitForTimeout(200);
    const j2 = db.jobs['1'];
    assert(j2.manualEmail.subject === 'A review for 10% off?' && /10% off your next order/.test(j2.manualEmail.body) && /review=1/.test(j2.manualEmail.body), JSON.stringify(j2.manualEmail));
    await owner.close();
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
    await page.waitForFunction(() => state.batches.find(b => b.id === '1').phase === 'order_received');
    assert(db.jobs['1'].customerApprovedAt && db.jobs['1'].phase === 'order_received', 'approval not saved, or it did not confirm the order: ' + JSON.stringify(db.jobs['1']));
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
  await check('private order links open just that order, and never load other customers on the owner\'s device', async () => {
    const db = fixtures();
    const page = await open(db, { suffix: '?o=' + keyOf('2'), init: () => localStorage.setItem('soloprint_owner_session_v1', JSON.stringify({ token: 'OWNER-TOKEN', expiresAt: Date.now() + 3e6 })) });
    assert(await page.evaluate(k => state.clientTab === 'jobs' && state.tokens[0] === k && state.historyEmail === 'jane@example.com', keyOf('2')), 'did not open My Requests for the linked order');
    assert(!db.log.includes('GET /jobs owner'), 'customer view loaded every order');
    assert(await page.locator('#order-2').count() === 1, 'linked order not shown');
    assert(await page.locator('#order-1').count() === 0 && await page.locator('#order-3').count() === 0, 'a link to one order also showed the same email\'s other orders');
    assert(!(await page.evaluate(() => location.search + location.href)).includes(keyOf('2')), 'the private key was left in the address bar');
    await page.close();
  });
  await check('order links: the key is remembered on the device, a guessed or old-style link opens nothing, and "email me my links" works', async () => {
    const db = fixtures();
    // The key is remembered: a later visit with no link still shows the order.
    const page = await open(db, { suffix: '?o=' + keyOf('1') });
    assert(await page.locator('#order-1').count() === 1, 'order not shown after the link');
    await page.reload(); await page.waitForFunction(() => !state.loading); await page.waitForTimeout(250);
    await page.evaluate(() => { state.clientTab = 'jobs'; render(); });
    assert(await page.locator('#order-1').count() === 1 && await page.locator('#order-2').count() === 0, 'the order was not remembered on this device (or others appeared)');
    await page.close();
    // Guessing: a made-up key, an order number and an email open nothing.
    const bad = await open(db, { suffix: '?o=' + keyOf('nope') });
    await bad.evaluate(() => { state.clientTab = 'jobs'; render(); });
    assert(await bad.locator('.job-card').count() === 0 && /Email me my links/.test(await bad.textContent('body')), 'a made-up key showed orders');
    await bad.evaluate(async () => { state.tokens = ['1', 'jane@example.com', '%']; await loadBatches(true); });
    assert(await bad.evaluate(() => state.batches.length) === 0, 'an order number or email was accepted as a key');
    await bad.close();
    // The old kind of link (just an email) opens nothing and says so.
    const db2 = fixtures();
    const old = await open(db2, { suffix: '?requests=jane%40example.com#order-2' });
    assert(await old.locator('.job-card').count() === 0 && !db2.log.some(l => /customer_orders/.test(l)), 'an email-only link opened orders');
    assert(/before I made order links private/.test(await old.textContent('body')) && await old.inputValue('#history-email') === 'jane@example.com', 'old link did not offer a fresh one');
    await old.click('#links-send');
    await old.waitForFunction(() => /I've sent your links/.test(document.body.textContent));
    assert(db2.linkRequests.join() === 'jane@example.com', 'links were not requested: ' + db2.linkRequests);
    assert(/If there are requests under that email/.test(await old.textContent('body')), 'the answer should not say whether the email has orders');
    await old.close();
  });
  await check('older links still open: ?order=<key>#order-<id>', async () => {
    const db = fixtures();
    const page = await open(db, { suffix: '?order=' + keyOf('2') + '#order-2' });
    assert(await page.locator('#order-2').count() === 1 && await page.locator('#order-1').count() === 0, 'the older link style did not open its order');
    await page.close();
  });
  await check('links in emails to you open the order in owner mode, but never skip the password', async () => {
    const db = fixtures();
    const page = await open(db, { suffix: '?admin=2' });
    assert(await page.evaluate(() => state.view === 'owner' && !state.ownerUnlocked && state.pendingOwnerOrder === '2'), 'the link should open owner mode');
    assert(await page.locator('#owner-pw').count() === 1 && await page.locator('#order-2').count() === 0, 'owner mode must ask for the password first');
    assert(!db.log.includes('GET /jobs owner') && !db.log.includes('GET /jobs anon'), 'orders were loaded without logging in');
    assert(!(await page.evaluate(() => location.search)).includes('admin'), 'the link should be tidied out of the address bar');
    await page.fill('#owner-pw', 'right-password');
    await page.click('#owner-login-btn');
    await page.waitForSelector('#order-2');
    assert(await page.evaluate(() => state.pendingOwnerOrder === '' && document.getElementById('order-2').classList.contains('flash')), 'after logging in the linked order should be shown and highlighted');
    await page.close();
    // already logged in: straight to the order
    const again = await open(db, { suffix: '?admin=1', init: () => localStorage.setItem('soloprint_owner_session_v1', JSON.stringify({ token: 'OWNER-TOKEN', expiresAt: Date.now() + 3e6 })) });
    await again.waitForSelector('#order-1');
    assert(await again.evaluate(() => state.ownerUnlocked && state.view === 'owner'), 'a logged-in owner should land on the order');
    await again.close();
    // a wrong password still gets nowhere
    const bad = await open(fixtures(), { suffix: '?admin=1' });
    await bad.fill('#owner-pw', 'wrong');
    await bad.click('#owner-login-btn');
    await bad.waitForSelector('#pw-err', { state: 'visible' });
    assert(await bad.locator('#order-1').count() === 0, 'the link got in without the right password');
    await bad.close();
  });
  await check('Looks good confirms the order and the customer sees the deposit request; the owner can switch that off', async () => {
    const db = fixtures();
    const page = await open(db, { suffix: '?o=' + keyOf('1') });
    await page.click('#customer-approve-1');
    await page.waitForSelector('text=Venmo');
    assert(db.jobs['1'].customerApprovedAt && db.jobs['1'].phase === 'order_received', 'approving should confirm the order: ' + db.jobs['1'].phase);
    assert(/deposit/i.test(await page.textContent('#order-1')), 'the customer should be asked for the deposit right away');
    assert(/deposit instructions have been emailed/i.test(await page.textContent('#approved-note-1')), 'on-screen confirmation that the deposit instructions were emailed');
    await page.close();
    const off = fixtures();
    off.settings.features = { autoDeposit: false };
    const page2 = await open(off, { suffix: '?o=' + keyOf('1') });
    assert(/We'll confirm we can make your order before asking for payment/.test(await page2.textContent('#order-1')), 'with the switch off the old wording stays');
    await page2.click('#customer-approve-1');
    await page2.waitForSelector('text=We got your go-ahead');
    assert(/email your deposit instructions/i.test(await page2.textContent('#approved-note-1')), 'with the switch off they are told the instructions are coming');
    assert(off.jobs['1'].phase === 'quote_sent' && off.jobs['1'].customerApprovedAt, 'with the switch off the order waits for the owner');
    await page2.close();
  });
  await check('payments: the step takes the amount typed in its box; no amount means no change; unticking Email sends nothing', async () => {
    const db = fixtures();
    db.jobs['2'].phase = 'order_received'; db.jobs['2'].paymentStatus = 'payment_requested';
    db.jobs['2'].phaseHistory = { estimate: ago(900), quote_sent: ago(800), order_received: ago(700) };
    const owner = await open(db);
    await owner.evaluate(asOwner('dashboard'));
    await owner.evaluate(showOrder('2'));
    // not an amount: nothing changes
    await owner.fill('#step-amount-2', '');
    await owner.click('#order-2 button:has-text("Deposit received")');
    await owner.waitForSelector('#step-err-2', { state: 'visible' });
    assert(!(await owner.$('.mail-modal')), 'no amount: no email to show');
    assert(db.jobs['2'].paymentStatus === 'payment_requested' && !db.jobs['2'].depositAmount, 'a non-amount should change nothing: ' + JSON.stringify(db.jobs['2']));
    // a real amount is saved with the status, so the email can say it
    await owner.fill('#step-amount-2', '12.34');
    await owner.click('#order-2 button:has-text("Deposit received")');
    await mailChoice(owner);
    await owner.waitForSelector('#order-2 button:has-text("Printing done")');
    assert(db.jobs['2'].paymentStatus === 'deposit_received' && db.jobs['2'].depositAmount === 12.34 && db.jobs['2'].depositAt, JSON.stringify(db.jobs['2']));
    assert(db.jobs['2'].quietEmails && db.jobs['2'].quietEmails.keys.length === 0, 'emailing is the default');
    // now it's the printing step; printing done moves to the final payment (stock is taken then)
    await owner.click('#order-2 button:has-text("Printing done")');
    await mailChoice(owner);
    await owner.waitForSelector('#order-2 button:has-text("Payment received")');
    // final payment with Email unticked: paid, ready to ship, and the receipt is quiet
    await owner.fill('#step-amount-2', '30');
    await owner.click('#order-2 button:has-text("Payment received")');
    await mailChoice(owner, false);
    await owner.waitForFunction(() => /Paid in full/.test((document.getElementById('conv-2') || {}).textContent || ''));
    const j = db.jobs['2'];
    assert(j.paymentStatus === 'payment_received' && j.balancePaid === 30 && j.balancePaidAt && j.paidAt && j.quietEmails.keys.join() === 'payment', JSON.stringify(j));
    // the feed lists the steps between the messages
    assert(/Deposit received \$12\.34/.test(await owner.textContent('#conv-2')) && /Paid in full \$30\.00/.test(await owner.textContent('#conv-2')), await owner.textContent('#conv-2'));
    await owner.close();
  });
  await check('every step email is shown first and can be edited: the change is saved for the email script', async () => {
    const db = fixtures();
    db.settings.features = { autoDeposit: false };
    Object.assign(db.jobs['1'], { phase: 'quote_sent', customerApprovedAt: ago(30) });
    const owner = await open(db);
    await owner.evaluate(asOwner('dashboard'));
    await owner.evaluate(showOrder('1'));
    await owner.click('#step-go-1');
    await owner.waitForSelector('.mail-modal #mp-body');
    const body = await owner.inputValue('#mp-body');
    assert(/confirmed/i.test(body) && /Venmo/.test(body) && /jane@example\.com/.test(await owner.textContent('.mail-modal .send-to')), body);
    await owner.fill('#mp-body', 'Hi Jane, confirmed! My own words.');
    await mailChoice(owner);
    await owner.waitForFunction(() => document.querySelector('#order-1 .desk-stepname') && !document.querySelector('.mail-modal'));
    await owner.waitForTimeout(200);
    const j = db.jobs['1'];
    assert(j.phase === 'order_received' && j.emailEdits && j.emailEdits.list.confirmed.body === 'Hi Jane, confirmed! My own words.' && j.quietEmails.keys.length === 0, JSON.stringify({ e: j.emailEdits, q: j.quietEmails }));
    // Deposit: the receipt shows the typed amount; unchanged text saves no edit
    await owner.fill('#step-amount-1', '12.34');
    await owner.click('#step-go-1');
    await owner.waitForSelector('.mail-modal #mp-body');
    assert(/12\.34/.test(await owner.inputValue('#mp-body')), await owner.inputValue('#mp-body'));
    await mailChoice(owner);
    await owner.waitForFunction(() => !document.querySelector('.mail-modal'));
    await owner.waitForTimeout(200);
    assert(db.jobs['1'].paymentStatus === 'deposit_received' && !db.jobs['1'].emailEdits, JSON.stringify(db.jobs['1'].emailEdits));
    await owner.close();
  });
  await check('confirm order: an approved quote waits for you; Confirm order sends the confirmed email unless unticked', async () => {
    const db = fixtures();
    db.settings.features = { autoDeposit: false };
    Object.assign(db.jobs['1'], { phase: 'quote_sent', customerApprovedAt: ago(30) });
    const owner = await open(db);
    await owner.evaluate(asOwner('dashboard'));
    assert(/jane@example\.com/.test(await owner.textContent('.desk-row.tone-need:has-text("Confirm order")')), 'an approved quote is in Needs me');
    await owner.evaluate(showOrder('1'));
    assert(/Step 2 of 6/.test(await owner.textContent('#order-1 .desk-stepname')), 'step bar');
    // the pop-up: cancel changes nothing, then "don't send" continues without the email
    await owner.click('#step-go-1');
    assert(/order confirmed/.test(await owner.textContent('.mail-modal p')) && await owner.locator('.mail-modal button:has-text("Send email and continue")').isVisible() && await owner.locator('.mail-modal button:has-text("Don\'t send email, continue")').isVisible(), 'pop-up asks');
    await owner.click('.mail-modal button[data-send="x"]');
    assert(db.jobs['1'].phase === 'quote_sent' && !(await owner.locator('.mail-modal').count()), 'cancel changes nothing');
    await owner.click('#step-go-1');
    await mailChoice(owner, false);
    await owner.waitForSelector('#order-1 .order-menu-list button:has-text("Print without a deposit")', { state: 'attached' });
    assert(db.jobs['1'].quietEmails.keys.join() === 'confirmed', JSON.stringify(db.jobs['1'].quietEmails));
    // More menu: printing without a deposit asks first and sends nothing
    owner.removeAllListeners('dialog');
    owner.on('dialog', d => d.accept());
    await owner.click('#order-1 .order-menu > summary');
    await owner.click('#order-1 .order-menu-list button:has-text("Print without a deposit")');
    await owner.waitForSelector('#order-1 .next-step .warn-note');
    assert(/No deposit has come in/.test(await owner.textContent('#order-1 .next-step')), 'printing unpaid shows a warning');
    await owner.close();
  });
  await check('orders confirm themselves until the owner switches it off from the waiting step', async () => {
    const db = fixtures();
    const owner = await open(db);
    await owner.evaluate(asOwner('dashboard'));
    await owner.evaluate(showOrder('1'));
    await owner.click('#order-1 button:has-text("Let me confirm each order myself")');
    await owner.waitForFunction(() => state.settings.features && state.settings.features.autoDeposit === false);
    assert(db.settings.features.autoDeposit === false, JSON.stringify(db.settings.features));
    await owner.close();
  });
  await check('Orders: tabs for what needs me, what waits on them and what is done; search looks everywhere', async () => {
    const db = fixtures();   // Jane: new request + a quote + an order in production
    db.jobs['lee1'] = { id: 'lee1', clientName: 'Lee', clientEmail: 'lee@example.com', createdAt: ago(500), phase: 'ready_to_ship', paymentStatus: 'payment_received', items: [{ name: 'Armor', qty: 1, filType: 'black' }] };
    db.jobs['lee2'] = { id: 'lee2', clientName: 'Lee', clientEmail: 'lee@example.com', createdAt: ago(900), phase: 'delivered', paymentStatus: 'payment_received', items: [{ name: 'Old mount', qty: 1, filType: 'black' }] };
    db.jobs['pri'] = { id: 'pri', clientName: 'Priya', clientEmail: 'priya@example.com', createdAt: ago(300), phase: 'quote_sent', paymentStatus: 'unpaid', items: [{ name: 'Plant pot', qty: 1, filType: 'black', minutes: 30, grams: 10 }] };
    db.jobs['pay'] = { id: 'pay', clientName: 'Pat', clientEmail: 'pat@example.com', createdAt: ago(200), phase: 'order_received', paymentStatus: 'deposit_received', depositAt: ago(100), items: [{ name: 'Bracket', qty: 1, filType: 'black' }] };
    db.jobs['wait'] = { id: 'wait', clientName: 'Wes', clientEmail: 'wes@example.com', createdAt: ago(200), phase: 'order_received', paymentStatus: 'payment_requested', items: [{ name: 'Hook', qty: 1, filType: 'black' }] };
    const owner = await open(db);
    await owner.evaluate(asOwner('dashboard'));
    const listed = () => owner.$$eval('.desk-row', rows => rows.map(r => r.textContent));
    // "Needs me" is the starting view: Priya (quote sent) and Wes (waiting for a deposit) only wait on their customers
    let rows = await listed();
    assert(rows.length && !rows.some(t => /priya|wes@|Old mount/.test(t)), 'only orders that need me at first: ' + rows.join(' | '));
    assert(rows.some(t => /lee@/.test(t) && /Ship it/.test(t)) && rows.some(t => /pat@/.test(t) && /Print it/.test(t)) && rows.some(t => /jane@/.test(t) && /New request/.test(t)), rows.join(' | '));
    assert(Number(await owner.textContent('nav.nav .nav-badge')) === rows.length, 'the Orders tab number counts the orders that need me');
    await owner.click('.desk-tabs button:has-text("Waiting on them")');
    rows = await listed();
    assert(rows.some(t => /priya@/.test(t) && /Quote sent/.test(t)) && rows.some(t => /wes@/.test(t) && /Waiting for deposit/.test(t)), rows.join(' | '));
    await owner.click('.desk-tabs button:has-text("Done")');
    assert((await listed()).some(t => /Old mount/.test(t) && /Finished/.test(t)), 'finished orders are in Done');
    // search looks through every tab
    await owner.fill('#cust-q', 'plant');
    await owner.waitForFunction(() => document.querySelectorAll('.desk-row').length === 1 && /priya/.test(document.querySelector('.desk-row').textContent));
    await owner.fill('#cust-q', '');
    // opening an order shows one next step, the feed, and the customer's other orders
    await owner.click('.desk-tabs button:has-text("Needs me")');
    await owner.click('.desk-row:has-text("lee@example.com")');
    assert(await owner.locator('#order-lee1').isVisible() && /ship it or hand it over/i.test(await owner.textContent('#order-lee1 .next-step')), 'Lee: ship step');
    assert(await owner.locator('#order-lee1 .owner-batch-controls select').count() === 0, 'no phase or payment dropdowns');
    await owner.click('#order-lee1 .client-notes > summary').catch(() => {});
    await owner.click('#order-lee1 .desk-others button');
    await owner.waitForSelector('#order-lee2');
    await owner.close();
  });
  await check('Orders on a phone: the list first, an order on tap, a way back; a link to an order opens it', async () => {
    const db = fixtures();
    db.jobs['lee2'] = { id: 'lee2', clientName: 'Lee', clientEmail: 'lee@example.com', createdAt: ago(900), phase: 'delivered', paymentStatus: 'payment_received', items: [{ name: 'Old mount', qty: 1, filType: 'black' }] };
    const owner = await open(db, { width: 390, height: 800 });
    await owner.evaluate(asOwner('dashboard'));
    assert(await owner.locator('.desk-list').isVisible() && !(await owner.locator('.desk-detail').isVisible()), 'a phone starts on the list');
    await owner.click('.desk-row >> nth=0');
    assert(!(await owner.locator('.desk-list').isVisible()) && await owner.locator('.desk-detail').isVisible(), 'tapping an order shows it');
    await owner.click('.desk-back');
    assert(await owner.locator('.desk-list').isVisible(), 'the back button returns to the list');
    await owner.evaluate(showOrder('lee2'));
    assert(await owner.locator('#order-lee2').isVisible() && !(await owner.locator('.desk-list').isVisible()), 'an order link opens the order');
    assert(await owner.evaluate(() => !document.documentElement.scrollWidth || document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'no sideways scrolling on a phone');
    assert(await owner.evaluate(() => document.documentElement.classList.contains('owner-mode')), 'owner mode has its own colors');
    await owner.close();
  });
  await check('Money & Sales lists every order by date, newest first, and Open jumps to the customer', async () => {
    const db = fixtures();
    db.jobs['old'] = { id: 'old', clientName: 'Olive', clientEmail: 'olive@example.com', createdAt: ago(60 * 24 * 40), phase: 'delivered', paymentStatus: 'payment_received', items: [{ name: 'Old coaster', qty: 1, filType: 'black', minutes: 20, grams: 8 }] };
    const owner = await open(db);
    await owner.evaluate(asOwner('money'));
    await owner.waitForSelector('#all-orders');
    const dates = await owner.$$eval('#all-orders tbody tr td:first-child', tds => tds.map(t => Date.parse(t.textContent)));
    assert(dates.length >= 4 && dates.every((d, i) => i === 0 || d <= dates[i - 1] + 864e5), 'newest first: ' + dates.join());
    await owner.fill('#all-orders-q', 'coaster');
    await owner.waitForFunction(() => document.querySelectorAll('#all-orders tbody tr').length === 1);
    await owner.click('#all-orders tbody button');
    await owner.waitForSelector('#order-old');
    assert(await owner.evaluate(() => state.ownerTab === 'dashboard' && state.deskOrder === 'old') && await owner.locator('#order-old').isVisible(), 'Open should show the order');
    await owner.close();
  });
  await check('a new request gets its own private key and shows in My Requests straight away', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.fill('#client-name', 'Sam');
    await page.fill('#client-email', 'sam@example.com');
    await page.click('text=I have an idea');
    await page.fill('#notes-0', 'A stand for my phone on the desk');
    await page.click('#submit-btn');
    await requestSent(page);
    const sam = Object.values(db.jobs).find(j => j.clientName === 'Sam');
    assert(await page.evaluate(k => state.tokens[0] === k && ORDER_KEY.test(k), keyOf(sam.id)), 'the new order\'s key was not remembered');
    assert(await page.evaluate(() => JSON.parse(localStorage.getItem('soloprint_order_keys_v1')).length === 1), 'the key was not saved on the device');
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

  await check('more than 2 colors adds the extra colors charge per print (not on old quotes or an owner price); the form explains it', async () => {
    const page = await open(fixtures());
    const r = await page.evaluate(() => {
      const two = { filType: 'black', extraColors: [{ name: 'Red', filType: 'color', colorId: 'red' }] };
      const three = { filType: 'black', extraColors: [{ name: 'Red', filType: 'color', colorId: 'red' }, { name: 'White', filType: 'white' }] };
      const same = { filType: 'color', colorId: 'red', color: 'Red', extraColors: [{ name: 'Red', filType: 'color', colorId: 'red' }, { name: 'Black', filType: 'black' }] };
      const rules = currentRules();
      return { two: printPrice(60, 30, two, rules), three: printPrice(60, 30, three, rules), same: colorCharge(same, rules),
        own: colorCharge({ ...three, ownerPrice: 10 }, rules), oldQuote: colorCharge(three, orderRules({ phase: 'quote_sent', rates: { baseFee: 2 } }, state.settings)),
        newQuote: colorCharge(three, orderRules({ phase: 'quote_sent', rates: quoteRates(rules) }, state.settings)) };
    });
    assert(Math.abs(r.three - r.two - 2) < 0.001 && r.same === 0 && r.own === 0 && r.oldQuote === 0 && r.newQuote === 2, JSON.stringify(r));
    await page.evaluate(() => { state.draftItems[0].mode = 'idea'; updateDraft(0, 'notes', 'A sign'); state.draftItems[0].showExtras = true; render(); toggleExtraColor(0, 0); });
    assert(!(await page.$('.color-fee-note.over')) && /Up to 2 colors are included/.test(await page.textContent('.color-fee-note')), 'note before 3 colors');
    await page.evaluate(() => toggleExtraColor(0, 1));
    assert(/This print has 3 colors/.test(await page.textContent('.color-fee-note.over')), 'stands out at 3 colors');
    assert(!/privilege/i.test(await page.textContent('.color-fee-note')), 'no privilege wording');
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
    await page.evaluate(keys => { state.tokens = keys; }, keysFor(db, 'lee@example.com'));   // as if they had opened a link from an email
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
    await mailChoice(owner);
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
    await owner.evaluate(showOrder('pe'));
    const card = await owner.textContent('#order-pe');
    assert(/Red: 5\.0 g × \$0\.044/.test(card) && /Black: 30\.0 g × \$0\.024/.test(card), 'order card should show each color and its price');
    await owner.click('#edit-request-pe');
    assert(/\$4\.38/.test(await owner.textContent('#oe-est-0')), 'edit form estimate');
    await owner.selectOption('#oe-part-color-0-1', 'silk');   // special rate 0.034
    assert(/\$4\.33/.test(await owner.textContent('#oe-est-0')) && /Silk Gold: 5\.0 g/.test(await owner.textContent('#oe-est-0')), await owner.textContent('#oe-est-0'));
    await owner.fill('#oe-hours-0', '1');
    await owner.fill('#oe-minutes-0', '30');   // print time is hours and minutes, like everywhere else
    assert(/\$5\.05/.test(await owner.textContent('#oe-est-0')), 'print time should update the estimate');
    assert(/1h 30m/.test(await owner.textContent('#oe-est-0')) && /flat × /.test(await owner.textContent('#oe-est-0')) && /90 min \(1h 30m\) × /.test(await owner.textContent('#oe-est-0')), 'the edit form should show the price breakdown: ' + await owner.textContent('#oe-est-0'));
    await owner.click('#owner-edit-save');
    await owner.waitForTimeout(300);
    await owner.click('button[onclick="cancelOwnerEdit()"]');
    await owner.waitForSelector('#edit-request-pe');
    assert(db.jobs.pe.items[0].extraColors[0].colorId === 'silk' && db.jobs.pe.items[0].minutes === 90, JSON.stringify(db.jobs.pe.items[0]));
    await owner.close();
  });
  await check('the owner can limit the colors offered for a part or group', async () => {
    const db = fixtures();
    db.settings.colors.push({ id: 'white', name: 'White', hex: '#f4f4f4' });
    db.gallery.g1.data.parts = [{ id: 'p1', name: 'Body', grams: 60, group: 'Shell' }, { id: 'p2', name: 'Lid', grams: 5, group: 'Shell' }, { id: 'p3', name: 'Trim', grams: 5 }];
    const owner = await open(db);
    await owner.evaluate(asOwner('gallery'));
    await owner.evaluate(() => editGalleryItem('g1'));
    await owner.click('#part-allow-2-red >> xpath=ancestor::details/summary');
    await owner.check('#part-allow-2-red');
    await owner.click('#gallery-save');
    await owner.waitForTimeout(300);
    assert(JSON.stringify(db.gallery.g1.data.parts[2].allowed) === '["red"]' && !(db.gallery.g1.data.parts[0].allowed || []).length, JSON.stringify(db.gallery.g1.data.parts));
    await owner.close();
    const page = await open(db);
    await page.click('text=I have an idea');
    await page.evaluate(async () => { await loadGallery(); requestGalleryItem('g1'); });
    const opts = await page.evaluate(() => { const it = state.draftItems[0]; const sel = k => [...document.querySelectorAll(`#part-color-0-${k} option`)].map(o => o.value); return { trim: sel(2), body: sel(0) }; });
    assert(opts.trim.length === 1 && opts.trim[0] === 'red', 'limited part offers only red: ' + JSON.stringify(opts));
    assert(opts.body.length > 1, 'other parts keep every color');
    await page.close();
  });
  await check('the page Save button is repeated in the owner side bar', async () => {
    const db = fixtures();
    const owner = await open(db);
    await owner.evaluate(asOwner('settings'));
    await owner.waitForSelector('#jump-save');
    assert(/Save/.test(await owner.textContent('#jump-save')), 'a Save button sits in the side bar');
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
    assert(!(await page.isChecked('#design-add-1')) && !(await page.$('#design-add-0')), 'only the add-on gets a tick box, unticked');
    await page.check('#design-add-1');
    await page.click('button:has-text("Request this")');
    await page.waitForSelector('#part-add-0-1');
    assert(await page.isChecked('#part-add-0-1'), 'the add-on ticked on the design page carries into the request');
    await page.uncheck('#part-add-0-1');
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
    // A saved estimate is only a guess: what the customer types wins.
    const typed = await open(db);
    await typed.evaluate(() => {
      state.draftItems[0] = { ...blankItem(), mode: 'link', link: 'https://makerworld.com/en/models/1', name: 'X', grams: 50, knownMinutes: 150, knownFromLibrary: true, showTime: true };
      render();
    });
    await typed.fill('#hours-0', '5');
    assert(await typed.evaluate(() => { const it = state.draftItems[0]; return !it.knownFromLibrary && totalPrintMinutes(it.printHours, it.printMinutes) === 330; }), 'typed hours should replace the saved time (5 h + the 30 min that was filled in)');
    await typed.close();
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
    await mailChoice(quoting);
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
  await check('leftover rolls need the customer\'s order link: an email alone finds nothing', async () => {
    const db = withRolls(fixtures());
    const page = await open(db);
    await page.fill('#client-name', 'Lee');
    await page.fill('#client-email', 'lee@example.com');
    await page.click('text=I have an idea');
    await page.fill('#notes-0', 'Another case');
    await page.click('button:has-text("Special order")');
    await page.click('#special-leftover-0');
    await page.waitForFunction(() => /Open the link in one of my emails/.test(document.querySelector('#leftover-msg-0').textContent));
    assert(!db.log.some(l => /customer_orders/.test(l)), 'looked up rolls without a key');
    await page.close();
  });
  await check('multi-color print can mix stocked colors with a leftover roll', async () => {
    const db = withRolls(fixtures());
    const page = await open(db);
    await page.fill('#client-name', 'Lee');
    await page.fill('#client-email', 'lee@example.com');
    await page.evaluate(keys => { state.tokens = keys; }, keysFor(db, 'lee@example.com'));
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
    await page.evaluate(showOrder('e2'));
    assert(/\$0\.034\/g/.test(await page.textContent('#order-e2')), 'owner card should show the color rate');
    await page.click('#approve-btn-e2');
    await mailChoice(page);
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
    const text = async id => { await page.evaluate(i => focusOwnerOrder(i), id); return page.textContent(`#order-${id} .roll-check`); };
    // ok1 and bad1 both draw on r1 (500 g left after r2); each is checked against the other's use too.
    assert(/Needs 600 g but their Red TPU roll has 50 g left/.test(await text('bad1')), await text('bad1'));
    assert(/No Blue PLA roll|expired/.test(await text('bad2')), await text('bad2'));
    assert(/No Red TPU roll found/.test(await text('bad3')), await text('bad3'));
    await page.evaluate(showOrder('bad1'));
    assert(await page.inputValue('#special-cost-bad1') === '20.00', 'a roll problem should pre-fill a new roll charge');
    await page.close();
  });
  await check('owner sets the special order color cost and it is added to the quote', async () => {
    const db = fixtures();
    db.jobs['s1'] = { id: 's1', clientName: 'Pat', clientEmail: 'pat@example.com', createdAt: ago(60), phase: 'estimate',
      items: [{ name: 'Vase', qty: 1, filType: 'special_order', specialColor: 'Red TPU', grams: 10 }] };
    const page = await open(db);
    await page.evaluate(asOwner('dashboard'));
    await page.evaluate(showOrder('s1'));
    assert(await page.inputValue('#special-cost-s1') === '20.00', 'cost should default to $20');
    await page.fill('#hours-s1-0', '1');
    await page.fill('#special-cost-s1', '18');
    await page.click('#approve-btn-s1');
    await mailChoice(page);
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
    await page.evaluate(() => document.querySelectorAll('details.email-card').forEach(d => { d.open = true; }));
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
    assert(groups.join(',') === 'email-footer,Emails to customers,email-draft_reminder,email-preorder_nudge,email-customer_received,email-details_check,email-quote,email-reminder,email-confirmed,email-deposit,email-final_payment_needed,email-payment,email-delivered,email-delivery_update,email-review_request,email-roll_reminder,Emails to you,email-owner_new,email-owner_approved,email-weekly_summary', groups.join(','));
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
    await page.click('#order-1 >> text=/Order again|Make this again/');
    await page.waitForTimeout(200);
    const draft = await page.evaluate(() => ({ tab: state.clientTab, items: state.draftItems.map(it => [it.name, it.qty, it.printHours, it.printMinutes]) }));
    assert(draft.tab === 'submit' && JSON.stringify(draft.items) === JSON.stringify([['Benchy', 2, '1', '30']]), JSON.stringify(draft));
    assert(/past order is filled in/.test(await page.textContent('#submit-ok')), 'no message');
    await page.close();
  });
  await check('customers see their leftover rolls and can start a request with one', async () => {
    const db = withRolls(fixtures());
    const page = await open(db);
    await page.evaluate(async (keys) => { state.tokens = keys; await loadBatches(true); state.clientTab = 'jobs'; render(); }, keysFor(db, 'lee@example.com'));
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
    await page.evaluate(showOrder('1'));
    await page.click('#order-1 .desk-fold:has(#owner-note-1) > summary');
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
    await page.evaluate(showOrder('2'));
    await page.setInputFiles('#finished-2', { name: 'done.png', mimeType: 'image/png', buffer: PNG });
    for (let t = 0; t < 40 && !(db.jobs['2'].finishedPhotos || []).length; t++) await page.waitForTimeout(100);
    assert(db.uploads.some(u => u.startsWith('gallery/orders/2-')) && db.jobs['2'].finishedPhotos[0].includes('/storage/v1/object/public/gallery/orders/2-'), JSON.stringify(db.jobs['2'].finishedPhotos));
    await page.waitForSelector('#order-2 >> text=Add to gallery');   // the fold opens once there's a photo
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
    const page = await open(db, { suffix: '?o=' + keyOf('2') + '&review=1' });
    await page.waitForSelector('#review-card');
    await page.waitForTimeout(400);
    const top = await page.evaluate(() => document.getElementById('review-card').getBoundingClientRect().top);
    assert(top >= -5 && top < 200, `the review link scrolls to the review form (it is ${Math.round(top)}px from the top)`);
    assert(await page.evaluate(() => document.getElementById('review-card').classList.contains('review-gold') && document.getElementById('review-send').classList.contains('btn-gold') && !!document.querySelector('.order-extras .btn-gold')), 'the review form, its Send review button and the Leave a review button are gold');
    assert(await page.inputValue('#review-name') === 'Jane D.', 'name should default to first name and initial');
    await page.click('.review-stars button[aria-label="3.5 stars"]');
    assert(/3\.5 out of 5/.test(await page.textContent('.review-rating-note')) && await page.evaluate(() => state.reviewFor.rating) === 3.5 && await page.evaluate(() => [...document.querySelectorAll('.star-fill')].map(e => e.style.width).join()) === '100%,100%,100%,50%,0%', 'a half star fills half of the 4th star');
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
  await check('FAQ: no menu button, the FAQ sits at the bottom of every page', async () => {
    const db = fixtures();
    db.settings.faq = [{ id: 'q1', q: 'How long?', a: 'About a week.', live: true }];
    const page = await open(db);
    assert(await page.locator('.bubble-nav .bubble').count() === 3, 'the menu has 3 buttons: the FAQ is at the bottom of every page');
    for (const tab of ['submit', 'gallery', 'jobs']) {
      await page.evaluate(t => setTab(t), tab);
      assert(await page.locator('#faq-list').count() === 1, `FAQ missing at the bottom of ${tab}`);
    }
    await page.evaluate(() => setTab('faq'));
    assert(await page.locator('#faq-list').count() === 1 && await page.locator('.faq').count() === 1, 'an old FAQ link still shows the FAQ once');
    await page.close();
  });
  await check('owner menu: Customers and Fix numbers sit inside Orders, Calculator & Models inside Designs', async () => {
    const owner = await open(fixtures());
    await owner.evaluate(asOwner('dashboard'));
    const tabs = (await owner.locator('nav.nav .nav-tab').allTextContents()).map(x => x.replace(/\d+$/, '').trim());
    assert(tabs.join('|') === 'Orders|Designs|Money & Sales|Settings|Help', tabs.join('|'));
    assert((await owner.locator('nav.sub-nav .sub-tab').allTextContents()).map(x => x.replace(/\d+$/, '').trim()).join('|') === 'Orders|Inbox|More', 'Orders sub-menu');
    await owner.click('#sub-more');
    assert(await owner.isVisible('#more-etsytodo') && await owner.isVisible('#more-numbers'), 'More holds To make and Fix numbers');
    await owner.click('#sub-more');
    await owner.waitForSelector('#client-notes', { state: 'attached' });
    await owner.click('.order-menu > summary');
    await owner.click('.order-menu-list button:has-text("Fix numbers")');
    await owner.waitForSelector('.card[id^="numbers-"]');
    assert(await owner.locator('.card[id^="numbers-"]').count() === 1, 'the order card button should open just that order');
    await owner.click('text=Show all orders');
    assert(await owner.locator('.card[id^="numbers-"]').count() > 1, 'Show all orders');
    await owner.click('nav.nav .nav-tab:has-text("Designs")');
    assert((await owner.locator('nav.sub-nav .sub-tab').allTextContents()).map(x => x.replace(/\d+$/, '')).join('|') === 'Designs|Add a design (wizard)|Calculator & Models', 'Designs sub-menu');
    await owner.click('.sub-tab:has-text("Calculator")');
    await owner.waitForSelector('#owner-calc-print-time');
    await owner.close();
  });
  await check('emails: a guide on Orders, and every button that emails the customer asks first', async () => {
    const db = fixtures();
    const owner = await open(db);
    await owner.evaluate(asOwner('dashboard'));
    assert(/Never sends an email/.test(await owner.textContent('#email-guide')) && /Send quote/.test(await owner.textContent('#email-guide')), 'guide missing');
    const asked = [];
    owner.removeAllListeners('dialog');
    owner.on('dialog', d => { asked.push(d.message()); d.dismiss(); });
    const id = await owner.evaluate(() => { const b = state.batches.find(x => x.phase === 'quote_sent' || x.phase === 'order_received'); return b && b.id; });
    assert(id, 'need an order to move');
    const before = db.jobs[id].phase;
    await owner.evaluate(([id]) => { const b = state.batches.find(x => x.id === id); return updateBatchPhase(id, b.phase === 'quote_sent' ? 'order_received' : 'final_payment_needed'); }, [id]);
    assert(asked.length === 1 && /This emails .*Send it\?/s.test(asked[0]), asked.join('|'));
    assert(db.jobs[id].phase === before, 'cancelling must change nothing');
    // Steps that send no email still ask first: Handed over in person.
    db.jobs[id].phase = 'ready_to_ship';
    db.jobs[id].paymentStatus = 'payment_received';
    await owner.evaluate(async ([id]) => { await loadBatches(); render(); }, [id]);
    asked.length = 0;
    await owner.evaluate(([id]) => deskHandOver(id), [id]);
    assert(asked.length === 1 && /handed over in person/.test(asked[0]) && db.jobs[id].phase === 'ready_to_ship', `cancel keeps it: ${asked.join('|')}`);
    owner.removeAllListeners('dialog');
    owner.on('dialog', d => d.accept());
    await owner.evaluate(([id]) => deskHandOver(id), [id]);
    await owner.waitForFunction(([id]) => state.batches.find(x => x.id === id).phase === 'delivered', [id]);
    assert(db.jobs[id].phase === 'delivered', 'yes moves it to Done');
    await owner.close();
  });
  await check('calculator: paste several links and compare the costs', async () => {
    const db = fixtures();
    const owner = await open(db);
    await owner.evaluate(asOwner('calculator'));
    await owner.fill('#cmp-text', 'https://makerworld.com/en/models/111-dragon\nhttps://makerworld.com/en/models/222-vase https://www.printables.com/model/333-hook');
    await owner.click('#cmp-go');
    await owner.waitForSelector('#cmp-row-2');
    await owner.waitForFunction(() => !/Looking up/.test(document.getElementById('cmp-results').textContent));
    assert(await owner.locator('.compare-row').count() === 3, 'three rows');
    const priced = await owner.textContent('#cmp-price-0');
    const expected = await owner.evaluate(() => '$' + calcPerPrint(150, 85.4, calcItem({ color: 'white' })).toFixed(2));
    assert(priced === expected, `${priced} vs ${expected}`);
    assert(/Enter time and grams/.test(await owner.textContent('#cmp-price-2')) && /Printables/.test(await owner.textContent('#cmp-row-2')), 'Printables needs typed numbers');
    await owner.fill('#cmp-min-2', '30');
    await owner.fill('#cmp-g-2', '10');
    assert(/^\$/.test(await owner.textContent('#cmp-price-2')) && await owner.locator('.compare-row.cheapest').count() === 1, 'typed numbers are priced and the cheapest is marked');
    await owner.fill('#cmp-qty', '3');
    const three = await owner.textContent('#cmp-price-0');
    assert(Math.abs(parseFloat(three.slice(1)) - 3 * parseFloat(priced.slice(1))) < 0.02, `quantity: ${three}`);
    await owner.click('#cmp-row-2 button:has-text("Use in the calculator")');
    assert(await owner.inputValue('#owner-calc-grams') === '10' && await owner.inputValue('#owner-calc-qty') === '3', 'row moves into the calculator');
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
    assert(db.jobs['1'].balancePaid > 0 && db.jobs['1'].shippingDepositPaid === 15 && db.jobs['1'].refundSent === 4.5 && db.jobs['1'].refundSentAt && db.jobs['1'].paymentStatus === 'deposit_received', 'Numbers must not change the payment step (that would email the customer): ' + JSON.stringify(db.jobs['1']));
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
    const stats = await page.$$eval('.money-stats:not(.etsy-stats) .stat-val', els => els.map(e => e.textContent));
    // Hook: 2 + 40 x 0.024 + 12 x 0.024 = 3.25 sale; 12 g x $0.02 = 0.24 material
    assert(JSON.stringify(stats) === JSON.stringify(['$3.25', '$0.24', '$3.01', '$60.00', '$0.00', '-$56.75']), `stats ${stats}`);
    await page.fill('#ad-where', 'Facebook');
    await page.fill('#ad-amount', '20');
    await page.fill('#ad-date', `${year}-01-05`);
    await page.click('#ad-add');
    await page.waitForSelector('#ad-summary');
    assert(db.private.money.ads.length === 1 && db.private.money.ads[0].amount === 20 && db.private.money.ads[0].where === 'Facebook', JSON.stringify(db.private.money));
    assert(/\$20\.00 per paid site order/.test(await page.textContent('#ad-summary')), await page.textContent('#ad-summary'));
    const after = await page.$$eval('.money-stats:not(.etsy-stats) .stat-val', els => els.map(e => e.textContent));
    assert(after[4] === '$20.00' && after[5] === '-$76.75', `with ads ${after}`);
    await page.fill('#exp-what', 'Nozzles');
    await page.fill('#exp-amount', '12.5');
    await page.fill('#exp-date', `${year}-02-01`);
    await page.click('text=Add expense');
    await page.waitForTimeout(300);
    assert(db.private.money.expenses.length === 2 && db.private.money.expenses[1].amount === 12.5, JSON.stringify(db.private.money));
    await page.click(`text=Download ${year} for taxes (Excel)`);
    const out = await page.evaluate(() => ({ file: window.__file, sheets: window.__sheets.map(s => s[0]), jan: window.__sheets[0][1][1] }));
    assert(out.file === `soloprint-${year}-taxes.xlsx` && out.sheets.join() === 'Summary,Paid orders,Expenses,Ads,Etsy' && out.jan.join() === 'January,1,3.25,0.24,3.01,60,20', JSON.stringify(out));
    await page.close();
  });
  await check('etsy: import the Orders file, item names and a statement (no double counting), edit by hand, export', async () => {
    const db = fixtures();
    const year = new Date().getFullYear(), yy = String(year).slice(2);
    db.private.money = { costPerKg: 20, expenses: [] };
    const page = await open(db, { init: () => { window.__sheets = []; window.XLSX = { utils: { book_new: () => ({}), aoa_to_sheet: rows => rows, book_append_sheet: (wb, rows, name) => window.__sheets.push([name, rows]) }, writeFile: () => {} }; } });
    await page.evaluate(asOwner('money'));
    await page.waitForSelector('#etsy-card');
    const orders = 'Sale Date,Order ID,Buyer User ID,Full Name,Number of Items,Ship City,Currency,Order Value,Coupon Code,Discount Amount,Shipping Discount,Shipping,Sales Tax,Order Total,Status,Card Processing Fees,Order Net,Adjusted Order Total,Adjusted Card Processing Fees,Adjusted Net Order Amount,Buyer,Order Type\n'
      + `02/03/${yy},3100000001,u1,Sam Lee,2,"Springfield, IL",USD,30.00,,0,0,6.00,2.00,38.00,Completed,1.44,36.56,--,--,--,samlee,online\n`
      + `03/10/${yy},3100000002,u2,"Kim, Jo",1,Town,USD,"1,020.00",SAVE,20.00,0,0,0,1000.00,Completed,30.25,969.75,900.00,27.25,872.75,kimjo,online\n`;
    const pick = (name, body) => page.setInputFiles('#etsy-file', { name, mimeType: 'text/csv', buffer: Buffer.from(body) });
    await pick('EtsySoldOrders.csv', orders);
    await page.waitForSelector('#etsy-preview');
    assert(/2 new sales/.test(await page.textContent('#etsy-preview')) && !db.private.etsy, 'shows what will be added, saves nothing yet');
    await page.click('#etsy-apply');
    await page.waitForFunction(() => document.querySelector('#etsy-card .alert.success'));
    let e = db.private.etsy;
    const kim = e.orders.find(o => o.etsyId === '3100000002'), sam = e.orders.find(o => o.etsyId === '3100000001');
    assert(sam.date === `${year}-02-03` && sam.sale === 30 && sam.shipping === 6 && sam.tax === 2 && sam.fees === 1.44 && sam.buyer === 'Sam Lee' && !sam.refund, JSON.stringify(sam));
    assert(kim.sale === 1000 && kim.refund === 100 && kim.fees === 27.25 && kim.buyer === 'Kim, Jo', JSON.stringify(kim));
    assert(!JSON.stringify(e).includes('Springfield'), 'addresses are never kept');
    await pick('EtsySoldOrderItems.csv', 'Sale Date,Item Name,Buyer,Quantity,Price,Order ID\n' + `02/03/${yy},Dragon,samlee,2,15.00,3100000001\n`);
    await page.click('#etsy-apply');
    await page.evaluate(() => setEtsyPref('etsyTab', 'orders'));
    await page.waitForFunction(() => /Dragon x2/.test(document.getElementById('etsy-card').textContent));
    const statement = 'Date,Type,Title,Info,Currency,Amount,Fees & Taxes,Net,Tax Details\n'
      + `"February 3, ${year}",Sale,Payment for Order #3100000001,,USD,$38.00,--,$38.00,--\n`
      + `"February 3, ${year}",Fee,Transaction fee: Dragon,Order #3100000001,USD,--,-$1.95,-$1.95,--\n`
      + `"February 3, ${year}",Fee,Processing fee,Order #3100000001,USD,--,-$1.44,-$1.44,--\n`
      + `"February 3, ${year}",Fee,Transaction fee: Shipping,Order #3100000001,USD,--,-$0.39,-$0.39,--\n`
      + `"February 4, ${year}",Shipping,USPS shipping label,Order #3100000001,USD,--,-$5.20,-$5.20,--\n`
      + `"February 1, ${year}",Fee,Listing fee,Listing #99,USD,--,-$0.20,-$0.20,--\n`;
    await pick(`etsy_statement_${year}_2.csv`, statement);
    await page.waitForSelector('#etsy-preview');
    assert(/1 fee on your sales \(\$1\.95\)/.test(await page.textContent('#etsy-preview')) && /2 shipping costs: labels and shipping transaction fees \(\$5\.59\)/.test(await page.textContent('#etsy-preview')), await page.textContent('#etsy-preview'));
    await page.click('#etsy-apply');
    await page.waitForFunction(() => !document.getElementById('etsy-preview'));
    await pick(`etsy_statement_${year}_2.csv`, statement);
    await page.waitForSelector('#etsy-preview');
    await page.click('#etsy-apply');
    await page.waitForFunction(() => !document.getElementById('etsy-preview'));
    e = db.private.etsy;
    const s2 = e.orders.find(o => o.etsyId === '3100000001');
    assert(s2.fees === 3.39 && s2.label === 5.59 && e.costs.length === 1 && e.costs[0].amount === 0.2, `statement twice counts once: ${JSON.stringify(e)}`);
    // Re-importing the Orders file updates, but keeps the statement fees and labels.
    await pick('EtsySoldOrders.csv', orders);
    await page.click('#etsy-apply');
    await page.waitForFunction(() => !document.getElementById('etsy-preview'));
    assert(db.private.etsy.orders.length === 2 && db.private.etsy.orders.find(o => o.etsyId === '3100000001').fees === 3.39, JSON.stringify(db.private.etsy.orders));
    // Edit by hand: 100 g at $20/kg = $2 material; profit 30 + 6 - 3.39 - 5.59 - 2 = 25.02.
    // Profit & loss: the year folds open to its months, each with its own profit; tapping a month opens its orders.
    await page.evaluate(() => setEtsyPref('etsyTab', 'overview'));
    const pl = await page.textContent('#etsy-panel');
    assert(new RegExp(`${year}`).test(pl) && /March/.test(pl) && /February/.test(pl) && /Margin/.test(pl), pl);
    assert(!(await page.$('#etsy-all')), 'all years always show: no checkbox');
    await page.click('button[aria-label^="February"]');
    await page.waitForSelector('#etsy-tab-orders[aria-selected="true"]');
    assert(await page.evaluate(y => document.getElementById('etsy-g-' + y + '-02').open, year), 'February opens');
    await page.evaluate(() => document.querySelectorAll('#etsy-card details').forEach(d => { d.open = true; }));
    await page.click('button[aria-label^="Edit Etsy sale ' + year + '-02-03"]');
    await page.fill('#etsy-f-grams', '100');
    await page.click('#etsy-save');
    await page.waitForFunction(() => !document.getElementById('etsy-form'));
    assert(db.private.etsy.orders.find(o => o.etsyId === '3100000001').edited === true, 'edited by hand');
    assert(/\$25\.02/.test(await page.textContent('#etsy-panel')), await page.textContent('#etsy-panel'));
    // Grouped by month, newest month open; search by order number.
    await page.evaluate(() => { state.etsyOpenGroup = ''; render(); });
    const opens = await page.$$eval('.etsy-group', els => els.map(d => d.open));
    assert(opens[0] && opens.filter(Boolean).length === 2, `the year, then its newest month with sales open, the rest folded: ${opens}`);
    // Months without sales still show, with their costs.
    const groupNames = await page.$$eval('.etsy-group > summary .etsy-group-name', els => els.map(x => x.textContent));
    const now = new Date();
    if (now.getFullYear() === year && now.getMonth() >= 3) assert(groupNames.some(n => /April/.test(n)) && /No sales this month/.test(await page.textContent('#etsy-panel')), groupNames.join('|'));
    await page.fill('#etsy-q', '3100000001');
    await page.waitForFunction(() => document.querySelectorAll('.etsy-order').length === 1);
    await page.fill('#etsy-q', '');
    await page.waitForFunction(() => document.querySelectorAll('.etsy-order').length === 2);
    // Spreadsheet view, sorted by a column; the choice is remembered.
    await page.click('#etsy-view-sheet');
    await page.waitForSelector('.etsy-sheet');
    await page.click('#etsy-sort-profit');
    let names = await page.$$eval('.etsy-sheet tbody td.etsy-what', els => els.map(x => x.textContent));
    assert(/Kim/.test(names[0]) && /Dragon/.test(names[1]), `most profit first: ${names}`);
    await page.click('#etsy-sort-profit');
    names = await page.$$eval('.etsy-sheet tbody td.etsy-what', els => els.map(x => x.textContent));
    assert(/Dragon/.test(names[0]), `least profit first: ${names}`);
    assert(/\$897\.77/.test(await page.textContent('.etsy-sheet tfoot')), await page.textContent('.etsy-sheet tfoot'));   // profit 25.02 + 872.75
    assert(await page.evaluate(() => localStorage.getItem('soloprint_etsyView')) === 'sheet', 'view remembered');
    await page.click('#etsy-view-orders');
    await page.waitForSelector('.etsy-order');
    await page.click('#etsy-add');
    await page.fill('#etsy-f-items', 'Market sale');
    await page.fill('#etsy-f-sale', '12');
    await page.click('#etsy-save');
    await page.waitForFunction(() => /Market sale/.test(document.getElementById('etsy-card').textContent));
    assert(db.private.etsy.orders.length === 3, 'a sale typed by hand');
    // Sales 36 + 900 + 12; costs: fees 3.39 + 27.25, labels 5.2, material 2, other 0.2
    const stats = await page.$$eval('.etsy-stats .stat-val', els => els.map(x => x.textContent));
    assert(JSON.stringify(stats) === JSON.stringify(['$948.00', '$30.84', '$0.00', '$5.59', '$2.00', '$909.57']), `stats ${stats}`);
    await page.click(`text=Download ${year} for taxes (Excel)`);
    const sheets = await page.evaluate(() => window.__sheets.map(s => [s[0], s[1].length]));
    assert(sheets.map(s => s[0]).join() === 'Summary,Paid orders,Expenses,Ads,Etsy' && sheets[4][1] >= 5, JSON.stringify(sheets));
    await page.close();
  });
  await check('a page left open offers to reload when the site is updated', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.waitForFunction(() => pageDeployAt > 0);
    await page.evaluate(() => loadLastUpdate());
    assert(!(await page.$('#new-version')), 'same version: no notice');
    db.deployedMinsAgo = 0;
    await page.evaluate(() => loadLastUpdate());
    assert(/Reload/.test(await page.textContent('#new-version')), 'newer version: asks to reload');
    await page.close();
  });
  await check('an expired owner login asks for the password again instead of showing an empty shop', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.evaluate(asOwner('dashboard'));
    assert(await page.evaluate(() => state.batches.length) > 0, 'orders loaded');
    await page.evaluate(async () => { ownerSession.expiresAt = Date.now() - 1000; try { localStorage.removeItem(OWNER_REMEMBER_KEY); } catch (e) {} await loadBatches(); render(); });
    const after = await page.evaluate(() => ({ unlocked: state.ownerUnlocked, n: state.batches.length, failed: state.loadFailed }));
    assert(after.unlocked === false && after.n > 0, `login asked again, orders not wiped: ${JSON.stringify(after)}`);
    // A load that fails while logged in says so, instead of looking empty.
    await page.evaluate(asOwner('money'));
    await page.evaluate(async () => { const f = window.fetch; window.fetch = (u, o) => (/\/jobs/.test(String(u)) ? Promise.resolve(new Response('', { status: 500 })) : f(u, o)); await loadBatches(); window.fetch = f; render(); });
    assert(/didn't load/.test(await page.textContent('#load-failed')), 'load problem shown');
    await page.click('#load-failed button');
    await page.waitForFunction(() => !document.getElementById('load-failed'));
    await page.close();
  });
  await check("etsy: last year's summary keeps counting when only this year's statements are uploaded", async () => {
    const db = fixtures(), y = new Date().getFullYear();
    db.private.money = { costPerKg: 20, expenses: [] };
    db.private.etsy = { orders: [{ id: 's25', date: `${y - 1}-12-31`, items: 'Etsy yearly summary', sale: 191.69, fees: 24.23, label: 40.86, ads: 9.01, summary: true, edited: true }],
      costs: [], seen: [], statementMonths: [`${y}-01`] };
    const page = await open(db);
    await page.evaluate(asOwner('money'));
    await page.evaluate(y => { state.moneyYear = y; render(); }, y - 1);
    await page.waitForSelector('#etsy-profit');
    assert(/\$117\.59/.test(await page.textContent('#etsy-profit')), await page.textContent('#etsy-profit'));
    const st = 'Date,Type,Title,Info,Currency,Amount,Fees & Taxes,Net,Tax Details\n' + `"February 5, ${y}",Fee,Listing fee,Listing #1,USD,--,-$0.20,-$0.20,--\n`;
    await page.setInputFiles('#etsy-file', { name: `etsy_statement_${y}_2.csv`, mimeType: 'text/csv', buffer: Buffer.from(st) });
    await page.waitForSelector('#etsy-preview');
    await page.click('#etsy-apply');
    await page.waitForFunction(() => !document.getElementById('etsy-preview'));
    assert(db.private.etsy.orders.some(o => o.id === 's25'), `the ${y - 1} summary is kept: ${JSON.stringify(db.private.etsy.orders)}`);
    await page.close();
  });
  await check('etsy: marketing is tracked; a yearly summary counts until every month it covers is uploaded, then uploads replace it', async () => {
    const db = fixtures(), y = new Date().getFullYear(), yy = String(y).slice(2);
    db.private.money = { costPerKg: 20, expenses: [] };
    const page = await open(db);
    await page.evaluate(asOwner('money'));
    await page.waitForSelector('#etsy-card');
    const pick = (name, body) => page.setInputFiles('#etsy-file', { name, mimeType: 'text/csv', buffer: Buffer.from(body) });
    const head = 'Sale Date,Order ID,Full Name,Order Value,Discount Amount,Shipping Discount,Shipping,Sales Tax,Order Total,Card Processing Fees,Adjusted Order Total,Adjusted Card Processing Fees\n';
    // A yearly summary typed by hand, up to March 31.
    await page.click('#etsy-add');
    await page.fill('#etsy-f-date', `${y}-03-31`);
    await page.fill('#etsy-f-items', 'Etsy summary');
    await page.fill('#etsy-f-sale', '100');
    await page.check('#etsy-f-summary');
    await page.click('#etsy-save');
    await page.waitForFunction(() => !document.getElementById('etsy-form'));
    // The shop's first statement (January): months before it don't need one.
    const month = (m, name) => 'Date,Type,Title,Info,Currency,Amount,Fees & Taxes,Net,Tax Details\n' + `"${name} 5, ${y}",Fee,Listing fee,Listing #9${m},USD,--,-$0.20,-$0.20,--\n`;
    await pick(`etsy_statement_${y}_1.csv`, month(1, 'January'));
    await page.waitForSelector('#etsy-preview');
    await page.click('#etsy-apply');
    await page.waitForFunction(() => !document.getElementById('etsy-preview'));
    await pick('EtsySoldOrders.csv', head + `03/10/${yy},3200000001,Ann,20,0,0,0,0,20,1,--,--\n04/02/${yy},3200000002,Bo,40,0,0,5,0,45,2,--,--\n`);
    await page.waitForSelector('#etsy-preview');
    assert(/2 new sales/.test(await page.textContent('#etsy-preview')) && /1 fall inside your yearly summary/.test(await page.textContent('#etsy-preview')), await page.textContent('#etsy-preview'));
    await page.click('#etsy-apply');
    await page.waitForFunction(() => !document.getElementById('etsy-preview'));
    // Uploading the same month again adds nothing (matched by order number).
    await pick('EtsySoldOrders.csv', head + `04/02/${yy},3200000002,Bo,40,0,0,5,0,45,2,--,--\n`);
    await page.waitForSelector('#etsy-preview');
    assert(/0 new sales/.test(await page.textContent('#etsy-preview')), await page.textContent('#etsy-preview'));
    await page.click('#etsy-apply');
    await page.waitForFunction(() => !document.getElementById('etsy-preview'));
    const statement = 'Date,Type,Title,Info,Currency,Amount,Fees & Taxes,Net,Tax Details\n'
      + `"March 20, ${y}",Marketing,Etsy Ads,Ads,USD,--,-$9.00,-$9.00,--\n`
      + `"April 3, ${y}",Marketing,Offsite Ads fee,Order #3200000002,USD,--,-$6.00,-$6.00,--\n`
      + `"April 5, ${y}",Marketing,Etsy Ads,Ads,USD,--,-$3.00,-$3.00,--\n`;
    await pick(`etsy_statement_${y}_4.csv`, statement);
    await page.waitForSelector('#etsy-preview');
    const pv = await page.textContent('#etsy-preview');
    assert(/3 marketing charges: Etsy Ads and Offsite Ads \(\$18\.00\)/.test(pv) && /1 fall inside your yearly summary/.test(pv), pv);
    await page.click('#etsy-apply');
    await page.waitForFunction(() => !document.getElementById('etsy-preview'));
    let e = db.private.etsy;
    const bo = e.orders.find(o => o.etsyId === '3200000002');
    assert(e.orders.length === 3 && bo.ads === 6 && bo.fees === 2 && e.costs.length === 3, JSON.stringify(e));
    // Counted: the summary (100) and April: Bo 45 - 2 - 6, Etsy Ads 3. Ann (March) and March's ads wait inside the summary.
    let stats = await page.$$eval('.etsy-stats .stat-val', els => els.map(x => x.textContent));
    assert(stats[2] === '$9.00' && stats[5] === '$134.00', `stats ${stats}`);
    // The summary's own ad total, typed as a charge on its date, counts with it.
    await page.evaluate(() => setEtsyPref('etsyTab', 'ads'));
    await page.click('.etsy-add-charge summary');
    await page.fill('#etsy-c-date', `${y}-03-31`);
    await page.fill('#etsy-c-what', 'Etsy Ads summary');
    await page.fill('#etsy-c-amount', '4');
    await page.click('.etsy-add-charge button');
    await page.waitForFunction(() => /\$130\.00/.test(document.getElementById('etsy-profit').textContent));
    await page.evaluate(() => setEtsyPref('etsyTab', 'orders'));
    assert(/Monthly statements still needed: Feb \d+\./.test(await page.textContent('.etsy-summary-note')), await page.textContent('.etsy-summary-note'));
    // Marketing tab: every charge, with its order number where Etsy gives one.
    await page.click('#etsy-tab-ads');
    await page.waitForSelector('.etsy-cost-table');
    const ads = await page.textContent('#etsy-panel');
    assert(/#3200000002/.test(ads) && /Etsy Ads/.test(ads) && /Not counted yet/.test(ads), ads);
    await page.selectOption('#etsy-group', 'year');
    await page.waitForFunction(() => document.querySelectorAll('.etsy-group').length === 1);
    // February's statement completes the summary's months: it's replaced and everything counts.
    await pick(`etsy_statement_${y}_2.csv`, month(2, 'February'));
    await page.waitForSelector('#etsy-preview');
    assert(/This completes/.test(await page.textContent('#etsy-preview')), await page.textContent('#etsy-preview'));
    await page.click('#etsy-apply');
    await page.waitForFunction(() => !document.getElementById('etsy-preview'));
    e = db.private.etsy;
    assert(e.orders.length === 2 && !e.orders.some(o => o.summary) && !e.costs.some(c => /summary/.test(c.what)), JSON.stringify(e));
    // 20 - 1 + 45 - 2 - 6 - 9 - 3 - 0.4 = 43.60
    stats = await page.$$eval('.etsy-stats .stat-val', els => els.map(x => x.textContent));
    assert(stats[5] === '$43.60' && /\$43\.60/.test(await page.textContent('#etsy-profit')), `stats ${stats}`);
    await page.close();
  });
  await check("etsy: a real statement's layout (fees and the buyer's sales tax listed before the sale) lands on the right orders", async () => {
    const db = fixtures(), y = new Date().getFullYear();
    db.private.money = { costPerKg: 20, expenses: [] };
    const page = await open(db);
    await page.evaluate(asOwner('money'));
    await page.waitForSelector('#etsy-card');
    const st = 'Date,Type,Title,Info,Currency,Amount,"Fees & Taxes",Net,"Tax Details"\n'
      + `"November 16, ${y}",Deposit,"$124.45 sent to your bank account",,USD,--,--,--,--\n`
      + `"November 16, ${y}",Marketing,"Etsy Ads","Bill for click-throughs to your shop on Nov 15, ${y}",USD,--,-$0.48,-$0.48,--\n`
      + `"November 15, ${y}",Tax,"Tax on transaction fee","Order #4233804505",USD,--,-$0.06,-$0.06,--\n`
      + `"November 15, ${y}",Fee,"Shipping transaction fee","Order #4233804505",USD,--,-$0.39,-$0.39,--\n`
      + `"November 15, ${y}",Fee,"Transaction fee: Drying Rack, 5 Adj...","Order #4233804505",USD,--,-$1.23,-$1.23,--\n`
      + `"November 15, ${y}",Tax,"Sales tax paid by buyer","Order #4233804505",USD,--,-$1.65,-$1.65,--\n`
      + `"November 15, ${y}",Fee,"Payment processing fee","Order #4233804505",USD,--,-$1.05,-$1.05,--\n`
      + `"November 15, ${y}",Sale,"Payment for Order #4233804505",,USD,$26.61,--,$26.61,--\n`
      + `"November 15, ${y}",Fee,"Listing fee","Listing #4606049264",USD,--,-$0.20,-$0.20,--\n`
      + `"November 12, ${y}",Shipping,"USPS shipping label","Label #320166474850",USD,--,-$5.95,-$5.95,--\n`
      + `"November 12, ${y}",Tax,"Tax on transaction fee","Order #4230650856",USD,--,-$0.04,-$0.04,--\n`
      + `"November 12, ${y}",Marketing,"Offsite Ads fee","Order #4230650856",USD,--,-$2.58,-$2.58,--\n`
      + `"November 12, ${y}",Fee,"Shipping transaction fee","Order #4230650856",USD,--,-$0.39,-$0.39,--\n`
      + `"November 12, ${y}",Fee,"Transaction fee: Bottle Anti Tipping F...","Order #4230650856",USD,--,-$0.73,-$0.73,--\n`
      + `"November 12, ${y}",Tax,"Sales tax paid by buyer","Order #4230650856",USD,--,-$1.38,-$1.38,--\n`
      + `"November 12, ${y}",Fee,"Payment processing fee","Order #4230650856",USD,--,-$0.81,-$0.81,--\n`
      + `"November 12, ${y}",Sale,"Payment for Order #4230650856",,USD,$18.58,--,$18.58,--\n`;
    await page.setInputFiles('#etsy-file', { name: `etsy_statement_${y}_11.csv`, mimeType: 'text/csv', buffer: Buffer.from(st) });
    await page.waitForSelector('#etsy-preview');
    await page.click('#etsy-apply');
    await page.waitForFunction(() => !document.getElementById('etsy-preview'));
    const e = db.private.etsy, a = e.orders.find(o => o.etsyId === '4233804505'), b = e.orders.find(o => o.etsyId === '4230650856');
    assert(a.sale === 24.96 && a.tax === 1.65 && a.fees === 2.34 && a.label === 0.39, JSON.stringify(a));
    assert(b.sale === 17.2 && b.fees === 1.58 && b.label === 0.39 && b.ads === 2.58, JSON.stringify(b));
    assert(e.costs.length === 3 && !(await page.$('#etsy-orphans')), JSON.stringify(e.costs));
    // 42.16 sales - fees 4.12 - shipping 6.73 - marketing 3.06 = 28.25
    assert(/\$28\.25/.test(await page.textContent('#etsy-profit')), await page.textContent('#etsy-profit'));
    await page.close();
  });
  await check("reviews: import Etsy's reviews.json, pick which to show, stars and 'on Etsy' on the site", async () => {
    const db = fixtures();
    const page = await open(db);
    await page.evaluate(asOwner('settings/reviews'));
    await page.waitForSelector('#review-file', { state: 'attached' });
    const json = JSON.stringify([{ reviewer: 'Andrea', date_reviewed: '10/23/2026', star_rating: 5, message: 'So happy with these, they are just as advertised! Thank you!', order_id: 4197256027 },
      { reviewer: 'Sign in with Apple user', date_reviewed: '06/07/2025', star_rating: 4, message: 'These really work!', order_id: 3689566968 },
      { reviewer: 'Mike', date_reviewed: '01/01/2026', star_rating: 5, message: 'Came out perfect.', order_id: 1 }]);
    await page.setInputFiles('#review-file', { name: 'reviews.json', mimeType: 'application/json', buffer: Buffer.from(json) });
    await page.waitForSelector('#review-import');
    assert(/already on your site/.test(await page.textContent('#review-import')), 'a review already shown is left out');
    await page.click('#review-import-add');
    await page.waitForFunction(() => !document.getElementById('review-import'));
    await page.click('#settings-save');
    await page.waitForTimeout(300);
    const rv = db.settings.reviews;
    const andrea = rv.find(r => r.name === 'Andrea'), apple = rv.find(r => /really work/.test(r.text));
    assert(rv.length === 3 && andrea.rating === 5 && andrea.source === 'etsy' && andrea.date === '2026-10-23' && apple.name === '' && apple.rating === 4, JSON.stringify(rv));
    await page.close();
    const home = await open(db);
    await home.waitForSelector('.review');
    const txt = await home.textContent('.reviews');
    assert(/on Etsy/.test(txt) && /★★★★★/.test(txt), txt);
    await home.close();
  });
  await check('etsy to make: add an order with parts and colors, print list by color, mark printed, finish; import unshipped orders', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.evaluate(asOwner('etsytodo'));
    await page.evaluate(() => { state.batches = []; render(); });   // only Etsy orders here: the site-order part has its own check
    await page.waitForSelector('#todo-add');
    await page.fill('#todo-id', '4233804505');
    await page.fill('#todo-buyer', 'Jen');
    await page.fill('#todo-what', 'Base');
    await page.fill('#todo-color', 'Black');
    await page.fill('#todo-qty', '2');
    await page.click('text=Add part');
    await page.fill('#todo-what', 'Spine');
    await page.fill('#todo-color', 'Red');
    await page.click('text=Add part');
    await page.click('#todo-save');
    // One list: color buttons on top (how many left in each color) filter it.
    await page.waitForFunction(() => document.querySelectorAll('.todo-colorbar .todo-chip').length === 3);
    assert(!(await page.$('#todo-print')), 'no second, separate print list');
    let o = db.private.etsy_todo.orders[0];
    assert(o.etsyId === '4233804505' && o.lines.length === 2 && o.lines[0].qty === 2, JSON.stringify(o));
    assert(/Black · 2 to print/.test(await page.textContent('.todo-colorbar')), await page.textContent('.todo-colorbar'));
    await page.click('.todo-chip:has-text("Red")');
    await page.waitForFunction(() => document.querySelectorAll('#todo-orders .todo-parts li').length === 1 && /Spine/.test(document.querySelector('#todo-orders .todo-parts').textContent));
    await page.click('.todo-chip:has-text("All colors")');
    await page.check(`#todo-pc-${o.lines[0].id}-1`);
    await page.waitForFunction(() => /Black · 1 to print/.test(document.querySelector('.todo-colorbar').textContent));
    assert(db.private.etsy_todo.orders[0].lines[0].printed === 1, 'printed one');
    // Fix a mistake in place: change a part's color and count, and remove a part.
    await page.click('button[aria-label="Change Spine"]');
    await page.fill(`#tl-color-${o.lines[1].id}`, 'Blue');
    await page.fill(`#tl-qty-${o.lines[1].id}`, '3');
    await page.click('.todo-line-edit button:has-text("Save")');
    await page.waitForFunction(() => /Blue · 3 to print/.test(document.querySelector('.todo-colorbar').textContent));
    assert(db.private.etsy_todo.orders[0].lines[1].color === 'Blue' && db.private.etsy_todo.orders[0].lines[1].qty === 3, JSON.stringify(db.private.etsy_todo.orders[0]));
    await page.click('button[aria-label="Remove Spine"]');
    await page.waitForFunction(() => !/Spine/.test(document.getElementById('todo-orders').textContent));
    assert(db.private.etsy_todo.orders[0].lines.length === 1, 'part removed');
    await page.click('text=Shipped: done');
    await page.waitForFunction(() => /Finished \(1\)/.test(document.body.textContent));
    assert(db.private.etsy_todo.orders[0].done === true, 'finished');
    // Etsy's Order Items file: only unshipped orders are added, with their options as the color.
    const items = 'Sale Date,Item Name,Buyer,Quantity,Price,Order ID,Variations,Date Shipped,Ship Name\n'
      + '11/15/26,Drying Rack,jen1,1,26.61,4240000001,"Color:Black,Size:5",,Ann Lee\n'
      + '11/10/26,Vase,bo2,2,10.00,4240000002,,11/12/26,Bo Smith\n';
    await page.setInputFiles('#todo-file', { name: 'EtsySoldOrderItems.csv', mimeType: 'text/csv', buffer: Buffer.from(items) });
    await page.waitForFunction(() => /Added 1 unshipped order/.test(document.body.textContent));
    o = db.private.etsy_todo.orders.find(x => x.etsyId === '4240000001');
    assert(o && o.buyer === 'Ann Lee' && o.lines[0].what === 'Drying Rack' && /Color:Black/.test(o.lines[0].color) && !db.private.etsy_todo.orders.some(x => x.etsyId === '4240000002'), JSON.stringify(db.private.etsy_todo));
    // The order shows open, with Etsy's title (only orders from the file have one) and a tick box per piece
    assert(o.title === 'Drying Rack' && /Drying Rack/.test(await page.textContent(`#todo-${o.id} .todo-o-title`)), JSON.stringify(o));
    await page.check(`#todo-pc-${o.lines[0].id}-1`);
    await page.waitForFunction(id => /1 of 1 printed/.test(document.querySelector(`#todo-${id} .todo-progress`).textContent), o.id);
    assert(db.private.etsy_todo.orders.find(x => x.id === o.id).lines[0].printed === 1, 'ticked = printed');
    await page.uncheck(`#todo-pc-${o.lines[0].id}-1`);
    await page.waitForFunction(id => /0 of 1 printed/.test(document.querySelector(`#todo-${id} .todo-progress`).textContent), o.id);
    // Imported orders can be deleted, and so can finished ones.
    await page.click(`#todo-${o.id} button:has-text("Delete order")`);
    await page.waitForFunction(id => !document.getElementById('todo-' + id), o.id);
    assert(!db.private.etsy_todo.orders.some(x => x.id === o.id), 'imported order deleted');
    await page.click('.todo-done summary');
    await page.click('.todo-done button:has-text("Delete")');
    await page.waitForFunction(() => !document.querySelector('.todo-done'));
    assert(!db.private.etsy_todo.orders.length, JSON.stringify(db.private.etsy_todo));
    await page.close();
  });
  await check('etsy to make: parts added from a design show a picture of that part in its color; a hand-typed order has no title', async () => {
    const db = fixtures();
    db.gallery.g1.data.parts = [{ id: 'pa', name: 'Base', grams: 40 }, { id: 'pb', name: 'Spine', grams: 10 }];
    db.gallery.g1.data.colorMap = { photo: 'https://img.test/cm.png', regions: [{ hexes: ['#c89c00'], part: 'pa' }, { hexes: ['#0a3c80'], part: 'pb' }], combos: [{ id: 'c1', name: 'Red and black', colors: { pa: 'red', pb: 'black' } }] };
    const page = await open(db);
    await page.evaluate(asOwner('etsytodo'));
    await page.evaluate(() => { state.batches = []; render(); });   // only Etsy orders here
    await page.waitForSelector('#todo-add');
    await page.waitForFunction(() => state.galleryLoaded);
    await page.selectOption('#todo-design', 'g1');
    await page.selectOption('#todo-combo', 'c1');
    await page.fill('#todo-dqty', '2');
    await page.click('text=Add its parts');
    await page.click('#todo-save');
    await page.waitForSelector('#todo-orders .todo-order');
    const o = db.private.etsy_todo.orders[0];
    assert(!o.title && o.lines.length === 2 && o.lines[0].galleryId === 'g1' && o.lines[0].partId === 'pa' && o.lines[0].color === 'Red' && o.lines[1].color === 'Black', JSON.stringify(o));
    assert(!(await page.$(`#todo-${o.id} .todo-o-title`)), 'no title when typed by hand');
    const pics = await page.$$eval(`#todo-${o.id} .todo-pic canvas`, els => els.map(e => [e.getAttribute('aria-label'), JSON.parse(e.dataset.cm).focus]));
    assert(JSON.stringify(pics) === JSON.stringify([['Base in Red', 0], ['Spine in Black', 1]]), JSON.stringify(pics));
    assert(await page.$$eval(`#todo-${o.id} .todo-piece`, els => els.length) === 4, 'two tick boxes for each part (2 of each)');
    await page.close();
  });
  await check('etsy: statements count every sale, refund and credit (not deposits); charges for orders not uploaded yet are flagged, then move onto them', async () => {
    const db = fixtures(), y = new Date().getFullYear(), yy = String(y).slice(2);
    db.private.money = { costPerKg: 20, expenses: [] };
    db.private.etsy = { orders: [], costs: [{ id: 'x1', date: `${y}-05-02`, what: 'Transaction fee: Vase (Order #3400000001)', amount: 2, kind: 'fee' }] };
    const page = await open(db);
    await page.evaluate(asOwner('money'));
    await page.waitForSelector('#etsy-orphans');
    assert(/1 charge \(\$2\.00\)/.test(await page.textContent('#etsy-orphans')), await page.textContent('#etsy-orphans'));
    const st = 'Date,Type,Title,Info,Currency,Amount,Fees & Taxes,Net,Tax Details\n'
      + `"May 3, ${y}",Sale,Payment for Order #3300000001,,USD,$25.00,-$1.50,$23.50,--\n`
      + `"May 4, ${y}",Sale,Payment for Order #3300000002,,USD,$10.80,--,$10.80,--\n`
      + `"May 4, ${y}",Tax,Sales tax paid by buyer,Order #3300000002,USD,--,-$0.80,-$0.80,--\n`
      + `"May 3, ${y}",Fee,Transaction fee: Mug,Order #3300000001,USD,--,-$1.00,-$1.00,--\n`
      + `"May 6, ${y}",Refund,Refund to buyer for Order #3300000001,,USD,-$5.00,--,-$5.00,--\n`
      + `"May 7, ${y}",Fee,Credit for listing fee,Listing #5,USD,--,$0.50,$0.50,--\n`
      + `"May 9, ${y}",Deposit,"$100.00 sent to your bank account",,USD,--,--,-$100.00,--\n`
      + `"May 10, ${y}",Payment,"Card Payment","Visa ending in 1517",USD,--,$1.74,$1.74,--\n`;
    await page.setInputFiles('#etsy-file', { name: `etsy_statement_${y}_5.csv`, mimeType: 'text/csv', buffer: Buffer.from(st) });
    await page.waitForSelector('#etsy-preview');
    await page.click('#etsy-apply');
    await page.waitForFunction(() => !document.getElementById('etsy-preview'));
    let e = db.private.etsy;
    const mug = e.orders.find(o => o.etsyId === '3300000001');
    assert(mug && mug.sale === 23.5 && mug.tax === 1.5 && mug.fees === 1 && mug.refund === 5, JSON.stringify(e));
    const cup = e.orders.find(o => o.etsyId === "3300000002");
    assert(cup && cup.sale === 10 && cup.tax === 0.8, `buyer sales tax taken out of the sale: ${JSON.stringify(cup)}`);
    assert(e.costs.some(c => c.amount === -0.5) && !e.costs.some(c => /bank|Card Payment/.test(c.what)), JSON.stringify(e.costs));
    // The Orders file for the orphan's order: its charge moves onto it.
    await page.setInputFiles('#etsy-file', { name: 'EtsySoldOrders.csv', mimeType: 'text/csv', buffer: Buffer.from('Sale Date,Order ID,Full Name,Order Value,Discount Amount,Shipping Discount,Shipping,Sales Tax,Order Total,Card Processing Fees,Adjusted Order Total,Adjusted Card Processing Fees\n' + `05/02/${yy},3400000001,Lu,30,0,0,0,0,30,1,--,--\n`) });
    await page.waitForSelector('#etsy-preview');
    await page.click('#etsy-apply');
    await page.waitForFunction(() => !document.getElementById('etsy-preview'));
    e = db.private.etsy;
    const lu = e.orders.find(o => o.etsyId === '3400000001');
    assert(lu.fees === 3 && !e.costs.some(c => c.id === 'x1') && !(await page.$('#etsy-orphans')), JSON.stringify(e));
    await page.close();
  });
  await check('etsy: shipping transaction fees imported before the fix move to shipping costs once', async () => {
    const db = fixtures(), y = new Date().getFullYear();
    db.private.etsy = { orders: [{ id: 'a', etsyId: '3100000001', date: `${y}-02-03`, sale: 30, fees: 3.39, label: 5.2 }, { id: 'b', etsyId: '3100000002', date: `${y}-02-04`, sale: 10, fees: 1, label: 0, edited: true }],
      seen: [`${y}-02-03|fee|Transaction fee: Shipping|Order #3100000001|0.39`, `${y}-02-03|fee|Transaction fee: Dragon|Order #3100000001|1.95`, `${y}-02-04|fee|Transaction fee: Shipping|Order #3100000002|0.2`] };
    const page = await open(db);
    await page.evaluate(asOwner('money'));
    await page.waitForSelector('#etsy-shipfee-fix');
    assert(/counted 1 shipping transaction fee \(/.test(await page.textContent('#etsy-shipfee-fix')), 'hand-edited sales are left alone');
    await page.click('#etsy-shipfee-fix button');
    await page.waitForFunction(() => !document.getElementById('etsy-shipfee-fix'));
    const [a, b] = db.private.etsy.orders;
    assert(a.fees === 3 && a.label === 5.59 && b.fees === 1 && db.private.etsy.shipFeesMoved === true, JSON.stringify(db.private.etsy));
    await page.close();
  });
  await check('etsy: a whole year at once: many files in one pick, put in order, one preview, saved once', async () => {
    const db = fixtures();
    const year = new Date().getFullYear(), yy = String(year).slice(2);
    db.private.money = { costPerKg: 20, expenses: [] };
    const page = await open(db);
    await page.evaluate(asOwner('money'));
    await page.waitForSelector('#etsy-card');
    const orders = 'Sale Date,Order ID,Full Name,Order Value,Discount Amount,Shipping Discount,Shipping,Sales Tax,Order Total,Card Processing Fees,Adjusted Order Total,Adjusted Card Processing Fees\n'
      + `01/05/${yy},3200000001,Ann B,20.00,0,0,5.00,0,25.00,1.00,--,--\n` + `02/07/${yy},3200000002,Cy D,40.00,0,0,5.00,0,45.00,1.60,--,--\n`;
    const st = (m, id, amt) => 'Date,Type,Title,Info,Currency,Amount,Fees & Taxes,Net,Tax Details\n' + `"${m} 9, ${year}",Shipping,USPS shipping label,Order #${id},USD,--,-$${amt},-$${amt},--\n`;
    // statements picked first, and an unrelated file: the site still reads the Orders file first
    await page.setInputFiles('#etsy-file', [
      { name: `etsy_statement_${year}_2.csv`, mimeType: 'text/csv', buffer: Buffer.from(st('February', '3200000002', '6.10')) },
      { name: `etsy_statement_${year}_1.csv`, mimeType: 'text/csv', buffer: Buffer.from(st('January', '3200000001', '4.50')) },
      { name: 'notes.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') },
      { name: 'EtsySoldOrders.csv', mimeType: 'text/csv', buffer: Buffer.from(orders) }]);
    await page.waitForSelector('#etsy-preview');
    const pv = await page.textContent('#etsy-preview');
    assert(/3 Etsy files, 2 new sales/.test(pv) && /notes\.csv/.test(pv) && !db.private.etsy, pv);
    const order = await page.$$eval('#etsy-preview .etsy-file summary', els => els.map(e => e.textContent));
    assert(/Orders file/.test(order[0]) && /_1\.csv/.test(order[1]) && /_2\.csv/.test(order[2]), `in order: ${order}`);
    await page.click('#etsy-apply');
    await page.waitForFunction(() => document.querySelector('#etsy-card .alert.success'));
    const e = db.private.etsy;
    const a = e.orders.find(o => o.etsyId === '3200000001'), c = e.orders.find(o => o.etsyId === '3200000002');
    assert(e.orders.length === 2 && a.label === 4.5 && c.label === 6.1 && e.seen.length === 2, JSON.stringify(e));
    // the same year again adds nothing
    await page.setInputFiles('#etsy-file', [{ name: 'EtsySoldOrders.csv', mimeType: 'text/csv', buffer: Buffer.from(orders) }, { name: `etsy_statement_${year}_1.csv`, mimeType: 'text/csv', buffer: Buffer.from(st('January', '3200000001', '4.50')) }]);
    await page.waitForSelector('#etsy-preview');
    await page.click('#etsy-apply');
    await page.waitForFunction(() => !document.getElementById('etsy-preview'));
    await page.waitForTimeout(200);
    assert(db.private.etsy.orders.length === 2 && db.private.etsy.orders.find(o => o.etsyId === '3200000001').label === 4.5, JSON.stringify(db.private.etsy.orders));
    await page.close();
  });
  await check('amazon invoice: a photo is read into purchases, roll grams on stock and a new color, after checking', async () => {
    const db = fixtures();
    const year = new Date().getFullYear();
    db.private.money = { costPerKg: 20, expenses: [] };
    db.private.inventory = { black: { grams: 300 } };
    const invoice = [`Final Details for Order #113-1234567-1234567`, `Order Placed: November 3, ${year}`, 'Amazon.com order number: 113-1234567-1234567',
      'Items Ordered Price', '1 of: SUNLU PLA Filament 1.75mm 1KG Spool, Black $19.99', 'Sold by: SUNLU', 'Condition: New',
      '2 of: ELEGOO PLA Filament Bundle 2 Pack 1kg each,', 'Red and Blue $17.99', 'Sold by: ELEGOO', '1 of: 0.4mm Brass Nozzles 10 pcs $8.99',
      'Item(s) Subtotal: $64.96', 'Shipping & Handling: $0.00', 'Total before tax: $64.96', 'Estimated tax to be collected: $5.36', 'Grand Total: $70.32'].join('\n');
    const page = await open(db);
    await page.evaluate(text => { window.Tesseract = { recognize: async () => ({ data: { text } }) }; }, invoice);
    await page.evaluate(asOwner('money'));
    await page.waitForSelector('#invoice-read-money');
    await page.setInputFiles('#invoice-file-money', { name: 'invoice.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([255, 216, 255]) });
    await page.waitForSelector('#invoice-review-money');
    const lines = await page.evaluate(() => state.invoice.lines.map(l => [l.colorId || l.newColor || '-', l.grams, l.amount]));
    // the nozzles aren't filament: shown, not added; tax is only the filament's share (5.36 x 55.97 / 64.96)
    assert(JSON.stringify(lines) === JSON.stringify([['black', 1000, 19.99], ['red', 2000, 17.99], ['Blue', 2000, 17.99], ['-', 0, 8.99], ['-', 0, 4.62]]), JSON.stringify(lines));
    const tot = await page.textContent('#invoice-total-money');
    assert(/Adding \$60\.59 of filament/.test(tot) && /whole invoice was \$70\.32/.test(tot) && /1 other item not added/.test(tot), tot);
    assert(await page.inputValue('#inv-date-money') === `${year}-11-03` && !db.private.money.expenses.length, 'nothing saved before checking');
    await page.fill('#inv-new-money-2', 'Royal Blue');
    await page.click('#invoice-add-money');
    await page.waitForFunction(() => /Added 4 purchases/.test((document.getElementById('invoice-status-money') || {}).textContent || ''));
    const m = db.private.money, inv = db.private.inventory, blue = db.settings.colors.find(c => c.name === 'Royal Blue');
    assert(m.expenses.length === 4 && !m.expenses.some(e => /Nozzle/.test(e.what)) && Math.abs(m.expenses.reduce((t, e) => t + e.amount, 0) - 60.59) < 0.001 && m.expenses.every(e => e.date === `${year}-11-03` && /^Amazon: /.test(e.what)) && m.invoices.join() === '113-1234567-1234567', JSON.stringify(m));
    assert(blue && inv.black.grams === 1300 && inv.red.grams === 2000 && inv[blue.id].grams === 2000, JSON.stringify({ inv, colors: db.settings.colors }));
    // the same invoice again: warned it was already added
    await page.setInputFiles('#invoice-file-money', { name: 'invoice.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([255, 216, 255]) });
    await page.waitForSelector('#invoice-review-money');
    assert(/already added this Amazon order/.test(await page.textContent('#invoice-review-money')), 'warns about a repeat');
    await page.close();
  });
  await check('amazon invoice: a real PDF is read; only filament (PLA, TPU) is added, not the glue', async () => {
    const db = fixtures();
    db.private.money = { costPerKg: 20, expenses: [] };
    const page = await open(db);
    const lib = require('path').join(__dirname, 'node_modules/pdfjs-dist/build/');
    await page.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/**', route => route.fulfill({ path: lib + (/worker/.test(route.request().url()) ? 'pdf.worker.min.js' : 'pdf.min.js'), contentType: 'text/javascript' }));
    await page.evaluate(asOwner('money'));
    await page.waitForSelector('#invoice-read-money');
    await page.setInputFiles('#invoice-file-money', require('path').join(__dirname, 'fixtures/amazon-invoice.pdf'));
    await page.waitForSelector('#invoice-review-money', { timeout: 15000 });
    const lines = await page.evaluate(() => state.invoice.lines.map(l => [l.colorId || l.newColor || '-', l.grams, l.amount, !!(l.filament || l.tax)]));
    // TPU (clear = a new Transparent color) and PLA red are filament; the glue is not; tax 1.95 x 44.98 / 49.97
    assert(JSON.stringify(lines) === JSON.stringify([['Transparent', 1000, 24.99, true], ['red', 1000, 19.99, true], ['-', 0, 4.99, false], ['-', 0, 1.76, true]]), JSON.stringify(lines));
    assert(await page.inputValue('#inv-date-money') === '2026-10-12' && /113-7654321-7654321/.test(await page.textContent('#invoice-review-money')), 'date and order number from the PDF');
    await page.click('#invoice-add-money');
    await page.waitForFunction(() => /Added 3 purchases/.test((document.getElementById('invoice-status-money') || {}).textContent || ''));
    const m = db.private.money;
    assert(m.expenses.length === 3 && !m.expenses.some(e => /Glue/i.test(e.what)) && Math.abs(m.expenses.reduce((t, e) => t + e.amount, 0) - 46.74) < 0.001, JSON.stringify(m.expenses));
    assert(db.settings.colors.some(c => c.name === 'Transparent') && db.private.inventory.red.grams === 1000, JSON.stringify(db.private.inventory));
    await page.close();
  });
  await check('amazon order details page saved as a PDF: the item under the summary, not the ads; the discount counts', async () => {
    const db = fixtures();
    db.settings.colors.push({ id: 'white', name: 'White', hex: '#f4f4f4' });
    db.private.money = { costPerKg: 20, expenses: [] };
    const page = await open(db);
    const lib = require('path').join(__dirname, 'node_modules/pdfjs-dist/build/');
    await page.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/**', route => route.fulfill({ path: lib + (/worker/.test(route.request().url()) ? 'pdf.worker.min.js' : 'pdf.min.js'), contentType: 'text/javascript' }));
    await page.evaluate(asOwner('money'));
    await page.waitForSelector('#invoice-read-money');
    await page.setInputFiles('#invoice-file-money', require('path').join(__dirname, 'fixtures/amazon-order-details.pdf'));
    await page.waitForSelector('#invoice-review-money', { timeout: 15000 });
    const lines = await page.evaluate(() => state.invoice.lines.map(l => [l.colorId || l.newColor || '-', l.grams, l.amount, !!(l.filament || l.tax)]));
    // 2 pack of 1 kg white for $16.99; tax $1.33 less the $0.85 promotion = $0.48
    assert(JSON.stringify(lines) === JSON.stringify([['white', 2000, 16.99, true], ['-', 0, 0.48, true]]), JSON.stringify(lines));
    assert(await page.inputValue('#inv-date-money') === '2026-07-30' && /Adding \$17\.47 of filament/.test(await page.textContent('#invoice-total-money')), await page.textContent('#invoice-total-money'));
    await page.close();
  });
  await check('a color idea a customer sends shows on the owner bell and opens the Designs inbox', async () => {
    const db = fixtures();
    db.colorIdeas.push({ id: 'ci9', design_id: 'g1', name: 'Sunset', colors: { pa: 'red', pb: 'black' }, created_at: new Date().toISOString() });
    const page = await open(db);
    await page.evaluate(asOwner('dashboard'));
    await page.waitForSelector('.notif-bell');
    await page.waitForFunction(() => /unread/.test(document.querySelector('.notif-bell').getAttribute('aria-label')));
    await page.click('.notif-bell');
    const item = page.locator('.notif-item:has-text("New color idea")');
    assert(/"Sunset"/.test(await item.textContent()) && /Red and Black/.test(await item.textContent()), await item.textContent());
    await item.click();
    await page.waitForSelector('#inbox-todo');
    assert(await page.evaluate(() => state.ownerTab) === 'inbox' && /Sunset/.test(await page.textContent('#inbox-todo')), 'opens the Inbox page with the idea');
    await page.click('#inbox-todo button:has-text("Publish or dismiss")');
    await page.waitForSelector('#color-inbox');
    assert(await page.$$eval('#color-inbox input', els => els.some(e => e.value === 'Sunset')), 'and the idea opens from there');
    await page.close();
  });
  await check('owner help: search finds entries by any word; Take me there opens the place; own notes are saved and searchable', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.evaluate(asOwner('dashboard'));
    await page.click('.nav-tab:has-text("Help")');
    await page.waitForSelector('#wiki-q');
    const all = await page.$$eval('.wiki-entry', els => els.length);
    await page.fill('#wiki-q', 'refund postage');
    const titles = await page.$$eval('.wiki-entry summary', els => els.map(e => e.textContent));
    assert(all > 30 && titles.length >= 1 && titles.length < all && titles.some(x => /Ship it/.test(x)), JSON.stringify(titles));
    await page.fill('#wiki-q', 'zzqx');
    assert(/Nothing matches/.test(await page.textContent('#wiki-results')), 'no match message');
    await page.fill('#wiki-q', 'stock');
    await page.click('#wiki-stock button:has-text("Take me there")');
    await page.waitForFunction(() => state.ownerTab === 'settings' && state.settingsTab === 'colors');
    await page.click('.nav-tab:has-text("Help")');
    await page.click('#wiki-note-add');
    await page.fill('#wiki-note-title', 'Bambu settings for PETG');
    await page.fill('#wiki-note-text', 'Nozzle 245\nBed 70');
    await page.click('#wiki-note-save');
    await page.waitForFunction(() => !document.getElementById('wiki-note-title'));
    assert(db.private.wiki.entries[0].title === 'Bambu settings for PETG', JSON.stringify(db.private.wiki));
    await page.fill('#wiki-q', 'nozzle 245');
    assert(/Bambu settings/.test(await page.textContent('#wiki-results')) && /My notes/.test(await page.textContent('#wiki-results')), await page.textContent('#wiki-results'));
    await page.close();
  });
  await check('owner pages with several sections get side buttons that jump to each section (a Sections button on a phone)', async () => {
    const page = await open(fixtures(), { width: 1280, height: 700 });
    await page.evaluate(asOwner('money'));
    await page.waitForFunction(() => [...document.querySelectorAll('#jump-nav .jump-btn')].some(b => b.textContent === 'Etsy sales'));
    const names = await page.$$eval('#jump-nav .jump-btn', els => els.map(e => e.textContent));
    assert(names.includes('Etsy sales') && names.includes('Expenses in 2026'), JSON.stringify(names));
    assert(await page.isVisible('#jump-nav .jump-btn') && !(await page.isVisible('.jump-toggle')), 'buttons show on the side');
    await page.click('.jump-btn:has-text("Etsy sales")');
    await page.waitForFunction(() => document.querySelector('.jump-btn.active').textContent === 'Etsy sales');
    const top = await page.evaluate(() => [...document.querySelectorAll('#main .card-title')].find(h => h.textContent === 'Etsy sales').getBoundingClientRect().top);
    assert(top > 0 && top < 200, 'scrolled to Etsy sales: ' + top);
    await page.evaluate(() => setOwnerTab('settings'));
    await page.waitForFunction(() => [...document.querySelectorAll('#jump-nav .jump-btn')].some(b => b.textContent === 'Contact links'));
    await page.evaluate(() => { state.ownerTab = 'dashboard'; render(); });
    await page.waitForFunction(() => !document.getElementById('jump-nav') || [...document.querySelectorAll('#jump-nav .jump-btn')].some(b => /Today|Overview/.test(b.textContent)));   // the Orders page now has its own sections
    await page.setViewportSize({ width: 390, height: 760 });
    await page.evaluate(() => setOwnerTab('help'));
    await page.waitForSelector('.jump-toggle');
    assert(!(await page.isVisible('.jump-btn')), 'list closed on a phone');
    await page.click('.jump-toggle');
    await page.click('.jump-btn:has-text("Money")');
    await page.waitForFunction(() => !document.querySelector('#jump-nav').classList.contains('open'));
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('pre-orders: a design marked Pre-order says first come, first served everywhere; the owner sees the pre-orders by deposit time', async () => {
    const db = fixtures();
    Object.assign(db.gallery.g1.data, { preorder: true, preorderReady: 'early January' });
    db.jobs.p1 = { id: 'p1', clientName: 'Second', clientEmail: 's@example.com', createdAt: ago(900), phase: 'order_received', paymentStatus: 'deposit_received', depositAt: ago(100), items: [{ name: 'Dragon Organizer', qty: 1, galleryId: 'g1', preorder: true, filType: 'black', minutes: 150, grams: 85 }] };
    db.jobs.p2 = { id: 'p2', clientName: 'First', clientEmail: 'f@example.com', createdAt: ago(50), phase: 'order_received', paymentStatus: 'deposit_received', depositAt: ago(300), items: [{ name: 'Dragon Organizer', qty: 2, galleryId: 'g1', preorder: true, filType: 'black', minutes: 150, grams: 85 }] };
    const page = await open(db);
    await page.evaluate(leadIn);
    await page.evaluate(async () => { await loadGallery(); setTab('gallery'); });
    await page.waitForSelector('.gallery-card .preorder-badge');
    assert(await page.isVisible('.gallery-card button:has-text("Pre-order this")'), 'pre-order button');
    await page.evaluate(() => openWork('g1'));
    const note = await page.textContent('.preorder-note');
    assert(/first come, first served/.test(note) && /early January/.test(note), note);
    await page.evaluate(() => requestGalleryItem('g1'));
    assert(await page.evaluate(() => state.draftItems[0].preorder === true), 'item keeps preorder');
    assert(/first come, first served/.test(await page.textContent('#main .preorder-note')), 'note on the request form');
    const q = await page.evaluate(() => [preorderQueueNote({ phase: 'quote_sent', items: [{ preorder: true }] }, state.settings), preorderQueueNote({ phase: 'quote_sent', items: [{}] }, state.settings)]);
    assert(/first come, first served/.test(q[0]) && q[1] === '', JSON.stringify(q));
    await page.evaluate(asOwner('gallery'));
    await page.waitForSelector('#preorders');
    const names = await page.$$eval('#preorders .preorder-list li > button.btn-link', els => els.map(e => e.textContent));
    assert(JSON.stringify(names) === '["First","Second"]', JSON.stringify(names));
    await page.click('#preorders button:has-text("Second")');
    await page.waitForFunction(() => /Number 2 of 2/.test(document.querySelector('.desk-order') && document.querySelector('.desk-order').textContent));
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('pre-orders: customers see their place in line and the expected time you typed; the line is kept in step', async () => {
    const db = fixtures();
    Object.assign(db.gallery.g1.data, { preorder: true });
    const item = { name: 'Dragon Organizer', qty: 1, galleryId: 'g1', preorder: true, filType: 'black', minutes: 150, grams: 85 };
    db.jobs.p1 = { id: 'p1', clientName: 'Second', clientEmail: 's@example.com', createdAt: ago(900), phase: 'order_received', paymentStatus: 'deposit_received', depositAt: ago(100), items: [{ ...item }] };
    db.jobs.p2 = { id: 'p2', clientName: 'First', clientEmail: 'f@example.com', createdAt: ago(50), phase: 'order_received', paymentStatus: 'deposit_received', depositAt: ago(300), items: [{ ...item }] };
    db.jobs.p3 = { id: 'p3', clientName: 'Unpaid', clientEmail: 'u@example.com', createdAt: ago(40), phase: 'quote_sent', items: [{ ...item }] };
    const page = await open(db);
    await page.evaluate(asOwner('gallery'));
    await page.waitForSelector('#preorders');
    await page.waitForFunction(() => (state.settings.preorderLine || {}).g1 && state.settings.preorderLine.g1.length === 2);
    const text = await page.evaluate(() => ['p1', 'p2', 'p3'].map(id => preorderQueueNote(state.batches.find(b => b.id === id), state.settings)));
    assert(/number 2 in line/.test(text[0]) && /first in line/.test(text[1]) && /2 pre-orders are ahead/.test(text[2]) && /first come, first served/.test(text[0]), JSON.stringify(text));
    await page.fill('#eta-card-p2', 'Jan 12-15');
    await page.click('#preorders li:has-text("First") .preorder-eta-row button');
    await page.waitForFunction(() => state.batches.find(b => b.id === 'p2').preorderEta === 'Jan 12-15');
    assert(db.jobs.p2.preorderEta === 'Jan 12-15', 'saved on the order');
    assert(/First in line/.test(await page.textContent('#preorders li:has-text("First")')), 'first in line is labelled');
    const mail = await page.evaluate(() => preorderQueueNote(state.batches.find(b => b.id === 'p2'), state.settings));
    assert(/Expected to print and ship: Jan 12-15\./.test(mail), mail);
    const shown = await page.evaluate(() => renderPreorderNote(null, state.batches.find(b => b.id === 'p2')).replace(/<[^>]+>/g, ' '));
    assert(/first in line/.test(shown) && /Jan 12-15/.test(shown), shown);
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('owner can add and remove photos on a review in Settings > Reviews', async () => {
    const db = fixtures();
    db.settings = db.settings || {};
    const page = await open(db);
    await page.evaluate(asOwner('settings/reviews'));
    await page.waitForSelector('text=Add a review');
    await page.click('text=Add a review');
    await page.setInputFiles('.review-photo-edit input[type=file]', { name: 'cust.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForSelector('.review-photo-item img');
    assert(db.uploads.some(u => u.startsWith('gallery/reviews/')), JSON.stringify(db.uploads));
    assert(await page.evaluate(() => state.settingsDraft.reviews.reduce((t, r) => t + (r.photos || []).length, 0)) === 1, 'photo on the draft review');
    await page.click('.review-photo-item button');
    await page.waitForFunction(() => !document.querySelector('.review-photo-item'));
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('color groups share one color; versions scale the price and add the joining pack; singles ordered twice are nudged to the double', async () => {
    const db = fixtures();
    db.gallery.m1 = { id: 'm1', published: true, sort_order: 5, data: { title: 'Stand', photos: ['https://img.test/m.png'], minutes: 60, grams: 40, preorder: true, packId: 'k1',
      versions: [{ id: 'v1', name: 'Single', count: 1 }, { id: 'v2', name: 'Double', count: 2, needsPack: true }],
      parts: [{ id: 'a', name: 'Left', grams: 10, group: 'Body' }, { id: 'b', name: 'Right', grams: 10, group: 'Body' }, { id: 'c', name: 'Trim', grams: 20 }] } };
    db.gallery.k1 = { id: 'k1', published: true, sort_order: 6, data: { title: 'Joining pack', photos: [], minutes: 10, grams: 5 } };
    db.jobs.h1 = { id: 'h1', clientName: 'Ann', clientEmail: 'ann@example.com', createdAt: ago(900), phase: 'delivered', items: [{ name: 'Stand', qty: 2, galleryId: 'm1', filType: 'black', versionId: 'v1', versionName: 'Single', versionCount: 1 }] };
    const page = await open(db);
    await page.evaluate(leadIn);
    await page.evaluate(async () => { await loadGallery(); });
    const r = await page.evaluate(() => {
      const g = state.gallery.find(x => x.id === 'm1');
      const one = designEstimateItem(g, null, { include: {}, logo: false, version: 'v1' });
      const two = designEstimateItem(g, null, { include: {}, logo: false, version: 'v2' });
      const grp = designEstimateItem(g, { a: 'red', b: 'black', c: 'white' }, { include: {}, logo: false, version: 'v1' });
      return { g1: one.grams, g2: two.grams, m1: one.knownMinutes, m2: two.knownMinutes, needs: two.needsPack, left: grp.designParts[0].colorId, right: grp.designParts[1].colorId, price: designEstimate(g, null, { include: {}, logo: false, version: 'v1' }) };
    });
    assert(r.g2 === r.g1 * 2 && r.m2 === r.m1 * 2 && r.needs === true && r.left === r.right && r.price > 0, JSON.stringify(r));
    await page.evaluate(() => { setTab('gallery'); openWork('m1'); });
    await page.waitForSelector('.version-picker');
    await page.check('input[name="version-m1"][value="v2"]');
    await page.evaluate(() => requestGalleryItem('m1'));
    const items = await page.evaluate(() => state.draftItems.map(it => [it.name, it.versionName || '', it.packFor || '']));
    assert(JSON.stringify(items) === JSON.stringify([['Stand', 'Double', ''], ['Joining pack', '', 'm1']]), JSON.stringify(items));
    // one color row for the Body group, one for Trim
    const rows = await page.$$eval('.part-color-row', els => els.length);
    assert(rows === 2, 'rows: ' + rows);
    await page.evaluate(() => setItemVersion(0, 'v1'));
    assert(await page.evaluate(() => state.draftItems.length) === 1, 'pack removed with the single');
    // history: two singles before, none with a pack
    const hint = await page.evaluate(async () => { state.batches = [{ id: 'h1', clientEmail: 'ann@example.com', items: [{ galleryId: 'm1', qty: 2, versionCount: 1 }] }]; return joinHint(state.draftItems[0], 0); });
    assert(/already have 2 of these/.test(hint) && /Switch to Double/.test(hint), hint);
    const sug = await page.evaluate(() => { state.batches = [{ id: 'h1', clientEmail: 'ann@example.com', items: [{ galleryId: 'm1', qty: 1, versionCount: 1 }] }, { id: 'h2', clientEmail: 'ANN@example.com', items: [{ galleryId: 'm1', qty: 1, versionCount: 1 }] }]; return joinSuggestion(state.batches[1]); });
    assert(/suggest the Double/.test(sug), sug);
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('accessories are not listed on their own: they are ordered with the main design (quantity each) or alone', async () => {
    const db = fixtures();
    db.gallery.m2 = { id: 'm2', published: true, sort_order: 1, data: { title: 'Organizer', photos: ['https://img.test/c.png'], price: 50, accessories: ['x1', 'x2', 'x3'] } };
    db.gallery.x1 = { id: 'x1', published: true, sort_order: 2, data: { title: 'Glove Holder', description: 'Holds gloves.\n\nMore detail.', price: 12 } };
    db.gallery.x2 = { id: 'x2', published: true, sort_order: 3, data: { title: 'Label Holder' } };
    db.gallery.x3 = { id: 'x3', published: false, sort_order: 4, data: { title: 'Hidden extra', price: 5 } };
    const page = await open(db);
    await page.evaluate(leadIn);
    await page.evaluate(async () => { await loadGallery(); setTab('gallery'); render(); });
    await page.waitForSelector('.gallery-card');
    const titles = await page.$$eval('.gallery-title', els => els.map(e => e.textContent.trim()));
    assert(!titles.some(t => /Glove Holder|Label Holder|Hidden extra/.test(t)) && titles.includes('Organizer'), JSON.stringify(titles));
    await page.evaluate(() => openWork('m2'));
    await page.waitForSelector('#accessory-picker');
    const rows = await page.$$eval('.accessory-row strong', els => els.map(e => e.textContent));
    assert(JSON.stringify(rows) === JSON.stringify(['Glove Holder', 'Label Holder']), JSON.stringify(rows));
    // organizer plus two gloves
    await page.fill('#acc-qty-0', '2'); await page.press('#acc-qty-0', 'Tab');
    await page.evaluate(() => requestGalleryItem('m2'));
    let items = await page.evaluate(() => state.draftItems.map(it => [it.name, it.qty, it.accessoryFor || '']));
    assert(JSON.stringify(items) === JSON.stringify([['Organizer', 1, ''], ['Glove Holder', 2, 'm2']]), JSON.stringify(items));
    // accessories only
    await page.evaluate(() => { state.draftItems = [blankItem()]; state.designOpts = {}; setTab('gallery'); openWork('m2'); });
    await page.waitForSelector('#acc-only');
    await page.check('#acc-only');
    await page.evaluate(() => requestGalleryItem('m2'));
    assert(await page.evaluate(() => state.galleryOpen) === 'm2', 'nothing picked: stays on the design page');
    assert(/Pick at least one accessory/.test(await page.textContent('#acc-err')), 'asks for one');
    await page.fill('#acc-qty-1', '3'); await page.press('#acc-qty-1', 'Tab');
    await page.evaluate(() => requestGalleryItem('m2'));
    items = await page.evaluate(() => state.draftItems.map(it => [it.name, it.qty, it.accessoryFor || '']));
    assert(JSON.stringify(items) === JSON.stringify([['Label Holder', 3, 'm2']]), JSON.stringify(items));
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('owner simplification: Money sections fold, and a design becomes a pre-order with one button', async () => {
    const page = await open(fixtures());
    await page.evaluate(asOwner('money'));
    await page.evaluate(() => { state.moneyOpenAll = false; state.moneyFold = {}; render(); });
    await page.waitForSelector('#money-fold-all');
    assert(await page.$$eval('details.fold-card[open]', els => els.length) === 0, 'sections start folded');
    assert(await page.isVisible('.money-stats'), 'the totals stay open');
    await page.click('#money-fold-all');
    assert(await page.$$eval('details.fold-card:not([open])', els => els.length) === 0, 'open all');
    await page.click('#money-fold-all');
    await page.click('summary:has-text("Expenses")');
    assert(await page.isVisible('#exp-what'), 'one fold opens on its own');
    // design form: Make this a pre-order, then its settings
    await page.evaluate(asOwner('gallery'));
    await page.waitForSelector('#gallery-preorder-on');
    assert(!(await page.$('#gallery-preorder-ready')) && !(await page.$('#add-version')), 'nothing about pre-orders until asked');
    await page.click('#gallery-preorder-on');
    await page.waitForSelector('#gallery-preorder-ready');
    assert(await page.evaluate(() => state.galleryForm.preorder === true), 'pre-order on, its settings open');
    await page.click('#gallery-opt-accessories');
    assert(await page.isVisible('#acc-pick-0') || await page.isVisible('text=Add the accessories as their own designs first'), 'accessories open from their own button');
    await page.click('#gallery-opt-versions');
    assert(await page.isVisible('#add-version') && !(await page.$('#gallery-preorder-ready')), 'versions open on their own');
    await page.click('#gallery-opt-versions');
    assert(!(await page.$('#add-version')), 'a section folds away when its button is tapped again');
    await page.click('#gallery-preorder-off');
    assert(await page.evaluate(() => state.galleryForm.preorder === false), 'back to a normal design');
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('to make: confirmed site orders join the Etsy ones in one print list, tick boxes are kept, and the list can be printed', async () => {
    const db = fixtures();
    db.jobs.mk1 = { id: 'mk1', clientName: 'Kim', clientEmail: 'kim@example.com', createdAt: ago(60), phase: 'order_received', paymentStatus: 'deposit_received',
      items: [{ name: 'Wall Rack', qty: 2, galleryId: 'g1', filType: 'color', color: 'Red', designParts: [{ id: 'p1', name: 'Base', colorId: 'red', include: true }, { id: 'p2', name: 'Arm', colorId: 'black', include: true }] }, { name: 'Coin Tray', qty: 1, filType: 'black' }] };
    const page = await open(db);
    await page.evaluate(asOwner('etsytodo'));
    await page.waitForSelector('#todo-orders');
    const rows = await page.$$eval('#todo-orders .todo-parts li', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
    assert(rows.some(r => /2 × Base \(Wall Rack\)/.test(r)) && rows.some(r => /2 × Arm \(Wall Rack\)/.test(r)) && rows.some(r => /1 × Coin Tray/.test(r)), JSON.stringify(rows));
    assert(await page.isVisible('#todo-print-btn') && await page.isVisible('button:has-text("Open order")'), 'print and open-order buttons');
    await page.check('#todo-pc-mk1\\:0\\:p1-1');
    await page.waitForFunction(() => [...document.querySelectorAll('.todo-progress')].some(e => /^1 of /.test(e.textContent.trim())));
    assert(db.private.site_todo && db.private.site_todo.ticks['mk1:0:p1'] === 1, JSON.stringify(db.private.site_todo));
    assert(db.jobs.mk1.phase === 'order_received', 'ticking never changes the order');
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('a design with no photos uses its color picker photo, without saving it as an uploaded photo', async () => {
    const db = fixtures();
    const page = await open(db);
    const r = await page.evaluate(() => {
      const row = { id: 'z1', published: true, data: { title: 'Rack', parts: [{ id: 'a', name: 'A' }], colorMap: { photo: 'https://img.test/colors.png', regions: [{ hexes: ['#808080'], part: 'a' }], combos: [] } } };
      const g = cleanGalleryItem(row), withPhoto = cleanGalleryItem({ ...row, data: { ...row.data, photos: ['https://img.test/real.png'] } });
      return [g.photos.join(), g.ownPhotos.length, galleryRowOf(g).data.photos.length, withPhoto.photos.join()];
    });
    assert(JSON.stringify(r) === JSON.stringify(['https://img.test/colors.png', 0, 0, 'https://img.test/real.png']), JSON.stringify(r));
    await page.close();
  });
  await check('a pop-up reminds customers shipping can be combined when they add their first item, once, and can be switched off', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.evaluate(async () => { localStorage.removeItem('soloprint_shipnote_off'); await loadGallery(); setTab('gallery'); requestGalleryItem('g1'); });
    await page.waitForSelector('.ship-modal [role="dialog"]');
    assert(/combine shipping/.test(await page.textContent('.ship-modal')) && await page.evaluate(() => document.activeElement.id) === 'ship-modal-ok', 'message and focus');
    await page.keyboard.press('Escape');
    assert(!(await page.$('.ship-modal')), 'Escape closes it');
    await page.evaluate(() => { state.draftItems = [blankItem()]; requestGalleryItem('g1'); });
    assert(!(await page.$('.ship-modal')), 'only once per visit');
    await page.evaluate(() => { state.shipNoteSeen = false; state.draftItems = [blankItem()]; state.settings.features = { shipCombine: false }; requestGalleryItem('g1'); });
    assert(!(await page.$('.ship-modal')), 'owner can switch it off');
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('color pickers in owner tools do not list the built-in "(no specific color)" duplicates when your own colors exist', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.evaluate(asOwner('calculator'));
    await page.waitForSelector('#owner-calc-fil');
    const opts = await page.$$eval('#owner-calc-fil option', els => els.map(e => e.textContent));
    assert(opts.length > 0 && !opts.some(o => /Black \(no specific|Special Request|Color \(no specific/.test(o)), JSON.stringify(opts));
    // a saved item that used the built-in one still shows it, so nothing silently changes
    const kept = await page.evaluate(() => calcColorOptions('special'));
    assert(/Special Request \(no specific color\)/.test(kept), kept);
    await page.close();
  });
  await check('preview mode: changes save to the preview only, customers keep the live site, and Push preview live copies just what changed', async () => {
    const db = fixtures();
    const liveNote = (db.settings || {}).materialNote || '';
    const page = await open(db);
    await page.evaluate(asOwner('preview'));
    await page.click('#preview-start');
    await page.waitForFunction(() => previewActive());
    assert(db.private.preview && db.private.preview.settings && db.private.preview.gallery.length >= 2, 'preview copy saved');
    await page.evaluate(async () => {
      await saveSettings({ ...state.settings, materialNote: 'Preview material note' }, state.settings);
      const g = state.gallery.find(x => x.id === 'g1'); await writeGalleryItem({ ...g, title: 'Dragon (preview)' });
      await writeGalleryItem({ ...g, id: 'gnew', title: 'Brand new thing', published: true });
      await loadGallery(); render();
    });
    assert(((db.settings || {}).materialNote || '') === liveNote && db.gallery.g1.data.title === 'Dragon Organizer' && !db.gallery.gnew, 'live site untouched');
    assert(db.private.preview.settings.materialNote === 'Preview material note', 'saved in the preview');
    assert(await page.evaluate(() => state.settings.materialNote === 'Preview material note' && state.gallery.some(x => x.title === 'Dragon (preview)')), 'owner sees the preview');
    assert(/PREVIEW/.test(await page.textContent('.preview-bar')) && /Push preview live/.test(await page.textContent('.preview-bar')), 'bar shows');
    const ch = await page.evaluate(() => previewChanges());
    assert(ch.settings.includes('Material note') && ch.designs.some(d => d.kind === 'new') && ch.designs.some(d => d.kind === 'changed'), JSON.stringify(ch));
    await page.click('.preview-bar button:has-text("Push preview live")');
    await page.waitForFunction(() => state.previewJustPushed === true);
    assert(db.settings.materialNote === 'Preview material note' && db.gallery.g1.data.title === 'Dragon (preview)' && db.gallery.gnew && db.gallery.gnew.data.title === 'Brand new thing', JSON.stringify([db.settings.materialNote, db.gallery.g1.data.title]));
    assert(!db.private.preview.settings, 'preview cleared after pushing');
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('pre-orders: paid in full (no deposit), wording says so, and the ready date follows the timing settings', async () => {
    const db = fixtures();
    const page = await open(db);
    const r = await page.evaluate(() => { const o = { items: [{ preorder: true }], phase: 'quote_sent' }; const rules = orderRules(o, state.settings);
      return [rules.depositPercent, payWording(o, rules).howPaying, fmtShortDate(preorderReadyDate(1, { preorderTiming: { launch: '2030-01-10', days: 5, extraDays: 1, breaks: [] } }, new Date('2029-12-01')).toISOString())]; });
    assert(r[0] === 0 && /pay in full/.test(r[1]) && /Jan 1[5-7]/.test(r[2]), JSON.stringify(r));
    await page.close();
  });
  await check('pre-orders step 1: name and email first, saved at once, then the options; the owner sees who is interested', async () => {
    const db = fixtures();
    Object.assign(db.gallery.g1.data, { preorder: true });
    const page = await open(db);
    await page.evaluate(async () => { await loadGallery(); setTab('gallery'); openWork('g1'); });
    await page.waitForSelector('#preorder-gate');
    assert(!(await page.$('.version-picker')) && !(await page.$('#work-price button:has-text("Pre-order this")')), 'no options before step 1');
    await page.evaluate(() => requestGalleryItem('g1'));
    assert(await page.evaluate(() => state.draftItems.every(it => !it.galleryId)), 'request blocked without step 1');
    await page.click('#preorder-continue');
    assert(/name/.test(await page.textContent('#preorder-gate-err')), 'asks for the name');
    await page.fill('#preorder-name', 'Pat Lee');
    await page.fill('#preorder-email', 'not-an-email');
    await page.click('#preorder-continue');
    assert(/valid email/.test(await page.textContent('#preorder-gate-err')), 'asks for a real email');
    await page.fill('#preorder-email', 'pat@example.com');
    await page.click('#preorder-continue');
    for (let t = 0; t < 10 && !db.drafts['pat@example.com']; t++) await page.waitForTimeout(100);   // well under the 3 second draft delay
    assert(db.drafts['pat@example.com'] && db.drafts['pat@example.com'].name === 'Pat Lee' && db.drafts['pat@example.com'].data.lead.designs[0].id === 'g1', JSON.stringify(db.drafts));
    assert(/^\?design=/.test(db.drafts['pat@example.com'].data.lead.designs[0].link), 'the lead keeps a link back to their choices (for the nudge email): ' + JSON.stringify(db.drafts['pat@example.com'].data.lead.designs[0]));
    await page.waitForFunction(() => !document.getElementById('preorder-gate'));
    assert(await page.isVisible('#work-price button:has-text("Pre-order this")'), 'options show after step 1');
    // owner
    await page.evaluate(asOwner('gallery'));
    await page.waitForSelector('#preorder-leads');
    const t = await page.textContent('#preorder-leads');
    assert(/Pat Lee/.test(t) && /pat@example.com/.test(t) && /Dragon Organizer/.test(t), t);
    assert(await page.isVisible('#preorder-sheet'), 'spreadsheet button');
    const rows = await page.evaluate(() => preorderInterestRows());
    assert(rows[0][0] === 'Date' && rows.some(r => r[1] === 'Pat Lee' && r[2] === 'pat@example.com' && /Dragon Organizer/.test(r[3]) && /Interested/.test(r[5])), JSON.stringify(rows));
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('custom color delay note: on the request form, design pages, order cards and the quote email; the wording is editable', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.evaluate(async () => { await loadGallery(); setTab('gallery'); openWork('g1'); });
    await page.waitForSelector('#work-price');
    assert(/order more material first/.test(await page.textContent('#work-price .color-delay-note')), 'design page');
    await page.evaluate(() => { state.draftItems[0].mode = 'idea'; setTab('submit'); render(); });
    assert(/order more material first/.test(await page.textContent('.color-delay-note')), 'request form');
    const mail = await page.evaluate(() => colorDelayText({}) + '|' + colorDelayText({ siteText: { colorDelayNote: { text: 'My own words', live: true } } }));
    assert(/order more material first/.test(mail) && /\|My own words$/.test(mail), mail);
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('grouped parts: the design form lists the groups, and a color idea sets the whole group', async () => {
    const db = fixtures();
    db.gallery.g2.data.parts = [{ id: 'p1', name: 'Left', grams: 10, group: 'Body' }, { id: 'p2', name: 'Right', grams: 10, group: 'Body' }, { id: 'p3', name: 'Trim', grams: 5 }];
    const page = await open(db);
    await page.evaluate(asOwner('gallery'));
    await page.evaluate(() => editGalleryItem('g2'));
    await page.waitForSelector('#part-groups-summary');
    assert(/Body \(Left, Right\)/.test(await page.textContent('#part-groups-summary')) && (await page.$('#part-group-list option[value="Body"]')), 'groups listed');
    const r = await page.evaluate(() => {
      const f = state.galleryForm; f.colorMap = { photo: 'https://img.test/x.png', regions: [], combos: [{ id: 'c1', name: 'Idea', colors: {} }] };
      setCmComboColor(0, 'p1', 'red', 'x');
      const out = cmPartColors(f.parts.map(p => ({ id: p.id, group: p.group })), { p1: 'red', p2: 'black', p3: 'black' }, [{ key: 'red', name: 'Red' }, { key: 'black', name: 'Black' }, { key: 'white', name: 'White' }]);
      return [f.colorMap.combos[0].colors, out];
    });
    assert(r[0].p1 === 'red' && r[0].p2 === 'red' && !r[0].p3 && r[1].p2 === 'red' && r[1].p3 === 'black', JSON.stringify(r));
    await page.close();
  });
  await check('design form: Choose from review photos adds a customer\'s review photo to the design', async () => {
    const db = fixtures();
    db.settings = { ...(db.settings || {}), reviews: [{ id: 'r1', name: 'Jo K.', text: 'Great print', designId: '', photos: ['https://img.test/rev1.png'] }] };
    const page = await open(db);
    await page.evaluate(asOwner('gallery'));
    await page.waitForSelector('#review-photo-open');
    await page.click('#review-photo-open');
    await page.waitForSelector('.review-photo-choice');
    await page.click('.review-photo-choice');
    await page.waitForFunction(() => /rev1\.png/.test(state.galleryForm.photos));
    assert(/\(added\)/.test(await page.textContent('.review-photo-choice')), 'marked as added');
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('set-ups: save any design (with its accessories) as a set-up and start a new hidden design from it', async () => {
    const db = fixtures();
    db.gallery.g2.data.accessories = ['g1'];
    db.gallery.g2.data.preorder = true;
    const page = await open(db);
    await page.evaluate(asOwner('gallery'));
    await page.waitForSelector('#setup-design');
    await page.selectOption('#setup-design', 'g2');
    await page.fill('#setup-name', 'Sign with extras');
    await page.click('#setup-save');
    await page.waitForFunction(() => savedSetups().length === 1);
    const saved = await page.evaluate(() => savedSetups()[0]);
    assert(saved.designs.length === 2 && saved.designs[0].data.preorder === true && saved.designs[0].data.photos.length === 0 && saved.designs[0].data.accessories[0] === 1, JSON.stringify(saved).slice(0, 300));
    assert(JSON.stringify(db.private.setups.items[0].name) === '"Sign with extras"', 'saved for later in owner_private');
    await page.fill(`#setup-new-${saved.id}`, 'Brand new sign');
    await page.click(`#setup-${saved.id} button:has-text("Use this set-up")`);
    await page.waitForFunction(() => state.gallery.some(g => g.title === 'Brand new sign'));
    const made = Object.values(db.gallery).filter(g => !['g1', 'g2', 'g3'].includes(g.id));
    const main = made.find(g => g.data.title === 'Brand new sign');
    assert(made.length === 2 && main.published === false && main.data.preorder === true && main.data.parts.length === 2 && main.data.accessories.length === 1 && made.some(g => g.id === main.data.accessories[0]), JSON.stringify(made).slice(0, 400));
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('color areas: a live preview beside the areas repaints each time a part is chosen', async () => {
    const db = fixtures();
    db.gallery.g2.data.parts = [{ id: 'p1', name: 'Plate', grams: 30 }, { id: 'p2', name: 'Letters', grams: 5 }];
    const page = await open(db);
    await page.evaluate(asOwner('gallery'));
    await page.evaluate(() => { editGalleryItem('g2'); state.galleryForm.colorMap = { photo: 'https://img.test/cm.png', regions: [{ hexes: ['#c89c00'], part: '' }, { hexes: ['#0a3c80'], part: '' }], combos: [] }; render(); });
    await page.waitForSelector('#cm-live');
    assert(/Plate/.test(await page.textContent('#cm-live')) && /no area yet/.test(await page.textContent('#cm-live')), 'legend shows parts without areas');
    const before = await page.getAttribute('#cm-live canvas', 'data-cm');
    await page.selectOption('#cm-region-0', 'p1');
    await page.waitForFunction(() => /1 area/.test(document.querySelector('#cm-live').textContent));
    const after = await page.getAttribute('#cm-live canvas', 'data-cm');
    assert(before !== after && JSON.parse(after).targets[0] === '#e6194b', after);
    await page.click('#cm-live button:has-text("Starting colors")');
    assert(JSON.parse(await page.getAttribute('#cm-live canvas', 'data-cm')).targets[0] !== '#e6194b', 'starting colors mode');
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('make 10 color ideas: works on any design, one color per group, never repeats', async () => {
    const db = fixtures();
    db.settings.colors = ['Red', 'Green', 'Blue', 'Black', 'White', 'Orange', 'Gold', 'Purple', 'Brown', 'Beige', 'Teal', 'Silver'].map(n => ({ id: n.toLowerCase(), name: n, hex: '#808080' }));
    const page = await open(db);
    await page.evaluate(asOwner('gallery'));
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      state.galleryForm = { ...blankGalleryForm(), title: 'T', parts: [{ id: 'a', name: 'Left', group: 'Body' }, { id: 'b', name: 'Right', group: 'Body' }, { id: 'c', name: 'Trim', allowed: ['gold', 'black'] }],
        colorMap: { photo: 'data:image/png;base64,AAAA', regions: [{ hexes: ['#ffffff'], part: 'a' }], combos: [] } };
      render(); makeCmIdeas(); makeCmIdeas();
      const cs = state.galleryForm.colorMap.combos;
      return { n: cs.length, grouped: cs.every(c => c.colors.a === c.colors.b), allowed: cs.every(c => ['gold', 'black'].includes(c.colors.c)), names: new Set(cs.map(c => c.name)).size };
    });
    assert(r.n === 16 && r.grouped && r.allowed && r.names === 16, JSON.stringify(r));
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('re-use color ideas from another design: matched by part name, groups kept together', async () => {
    const db = fixtures();
    db.settings.colors = ['Red', 'Green', 'Blue', 'Black'].map(n => ({ id: n.toLowerCase(), name: n, hex: '#808080' }));
    db.gallery.g1.data.parts = [{ id: 'x', name: 'Body' }, { id: 'y', name: 'Lid' }];
    db.gallery.g1.data.colorMap = { photo: 'https://img.test/c.png', regions: [{ hexes: ['#ffffff'], part: 'x' }], combos: [{ id: 'k1', name: 'Holiday', colors: { x: 'red', y: 'green' } }, { id: 'k2', name: 'Night', colors: { x: 'black', y: 'blue' } }] };
    const page = await open(db);
    await page.evaluate(asOwner('gallery'));
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      state.galleryForm = { ...blankGalleryForm(), id: 'zz', title: 'T', parts: [{ id: 'a', name: 'Lid' }, { id: 'b', name: 'Shell', group: 'G' }, { id: 'c', name: 'Shell 2', group: 'G' }],
        colorMap: { photo: 'https://img.test/c2.png', regions: [{ hexes: ['#ffffff'], part: 'a' }, { hexes: ['#111111'], part: 'b' }, { hexes: ['#222222'], part: 'c' }], combos: [] } };
      render();
      document.getElementById('cm-reuse-from').value = 'g1'; reuseCmIdeas();
      return state.galleryForm.colorMap.combos.map(c => ({ n: c.name, a: c.colors.a, b: c.colors.b, c: c.colors.c }));
    });
    assert(r.length === 2 && r[0].n === 'Holiday' && r[0].a === 'green' && r[0].b === r[0].c && r[0].b !== r[0].a, JSON.stringify(r));
    await page.close();
  });
  await check('color pictures: front and back views, and a different picture for each version, with Front / Back buttons for customers', async () => {
    const db = fixtures();
    db.gallery.g1.data.parts = [{ id: 'x', name: 'Body' }, { id: 'y', name: 'Lid' }];
    db.gallery.g1.data.colorMap = { photo: 'https://img.test/single.png', photoAlt: 'https://img.test/single-back.png', regions: [{ hexes: ['#ffffff'], part: 'x' }, { hexes: ['#111111'], part: 'y' }], combos: [{ id: 'k1', name: 'Holiday', colors: { x: 'red', y: 'green' } }] };
    db.gallery.g1.data.versions = [{ id: 's', name: 'Single', count: 1 }, { id: 'd', name: 'Joined pair', count: 2, photo: 'https://img.test/pair.png', photoAlt: 'https://img.test/pair-back.png' }];
    const page = await open(db, { suffix: '?design=dragon-organizer' });
    await page.waitForSelector('#color-ideas');
    const r = await page.evaluate(() => {
      const g = state.gallery.find(x => x.id === 'g1');
      const urls = [cmMapFor(g, 's', '').photo, cmMapFor(g, 's', 'back').photo, cmMapFor(g, 'd', '').photo, cmMapFor(g, 'd', 'back').photo];
      return { urls, oldSetupsGone: true };
    });
    assert(JSON.stringify(r.urls) === JSON.stringify(['https://img.test/single.png', 'https://img.test/single-back.png', 'https://img.test/pair.png', 'https://img.test/pair-back.png']) && r.oldSetupsGone, JSON.stringify(r));
    assert(await page.isVisible('#cm-side-back'), 'Front / Back buttons show');
    await page.click('#cm-side-back');
    assert(/single-back\.png/.test(await page.getAttribute('#color-ideas canvas', 'data-cm')), 'back picture is painted');
    await page.evaluate(() => { setDesignVersion('g1', 'd'); });
    await page.waitForFunction(() => /pair-back/.test(document.querySelector('#color-ideas canvas')?.dataset.cm || ''));
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('versions: type a name to add one; own parts and accessories; others untouched; part print time adds to the total and stays hidden; photos open in a pop-up', async () => {
    const db = fixtures();
    db.gallery.a1 = { id: 'a1', published: true, sort_order: 5, data: { title: 'Hook', photos: ['https://img.test/h.png'], price: 4, filType: 'white' } };
    db.gallery.a2 = { id: 'a2', published: true, sort_order: 6, data: { title: 'Tray', photos: ['https://img.test/t.png'], price: 6, filType: 'white' } };
    db.gallery.g1.data.minutes = 60;
    db.gallery.g1.data.accessories = ['a1'];
    db.gallery.g1.data.parts = [{ id: 'x', name: 'Body', grams: 10, minutes: 30, photo: 'https://img.test/b.png' }, { id: 'y', name: 'Lid', grams: 5, minutes: 15 }];
    const page = await open(db);
    await page.evaluate(asOwner('gallery'));
    await page.waitForTimeout(300);
    await page.evaluate(() => editGalleryItem('g1'));
    await page.fill('#new-version-name', 'Joined pair');
    await page.click('#add-version-quick');
    await page.waitForSelector('#ver-tab-1.on');
    assert(!(await page.$('#ver-tab-0')) && await page.isVisible('#ver-tab-main') && !(await page.$('#gallery-title')), 'the new version opens in its own tab, without the main form');
    const r = await page.evaluate(() => {
      const f = state.galleryForm;
      const offered = [...document.querySelectorAll('.ver-acc-list input')].map(i => i.dataset.id).join();
      f._main.parts; f.accessories.push('a2');   // the original gets another accessory: the version (still following the original) offers it too
      render();
      const offered2 = [...document.querySelectorAll('.ver-acc-list input')].map(i => i.dataset.id).join();
      toggleVersionAccessory(1, 'a1', false); f.accessories = ['a1'];
      return { offered, offered2, names: f.versions.map(v => v.name), parts: f.parts.length, v0acc: f.versions[0].accessories, v1acc: f.versions[1].accessories, mainAcc: f.accessories };
    });
    assert(r.offered === 'a1' && r.offered2 === 'a1,a2' && JSON.stringify(r.names) === '["Original","Joined pair"]' && r.parts === 2 && r.v0acc === null && JSON.stringify(r.v1acc) === '["a2"]' && JSON.stringify(r.mainAcc) === '["a1"]', JSON.stringify(r));
    assert(await page.isVisible('#part-minutes-0') && await page.isVisible('#color-map-form') && await page.isVisible('#ver-copy-cm') === false, 'the version page has parts with print time and its own color picker');
    // its own color picture: start from the original's and change it
    await page.evaluate(() => { state.galleryForm._main.colorMap = { photo: 'https://img.test/main.png', regions: [{ hexes: ['#ffffff'], part: 'x' }, { hexes: ['#111111'], part: 'y' }], combos: [{ id: 'k1', name: 'Night', colors: { x: 'black', y: 'white' } }] }; render(); });
    await page.click('#ver-copy-cm');
    await page.evaluate(() => { state.galleryForm.colorMap.photo = 'https://img.test/pair.png'; state.galleryForm.parts[0].name = 'Big body'; state.galleryForm.versions[1].count = 2; render(); });
    await page.waitForTimeout(400);
    assert(await page.evaluate(() => [...document.querySelectorAll('#jump-nav button')].some(b => /Parts \(optional\)/.test(b.textContent))), 'the version page has side buttons');
    await page.click('#jump-nav .jump-btn:has-text("Color ideas photo")');
    await page.waitForTimeout(900);
    const top = await page.evaluate(() => document.getElementById('color-map-form').getBoundingClientRect().top);
    assert(top > 0 && top < 200, 'side button scrolls to that section, not the top of the form: ' + top);
    await page.click('#ver-tab-main');
    assert(await page.isVisible('#gallery-title') && await page.isVisible('#part-minutes-1') && await page.evaluate(() => state.galleryForm.parts[0].name === 'Body' && state.galleryForm.colorMap.photo === 'https://img.test/main.png'), 'the original tab keeps its own parts and picture');
    await page.click('#ver-tab-1');
    await page.evaluate(() => saveGalleryItem());
    await page.waitForFunction(() => (state.gallery.find(x => x.id === 'g1').versions || []).length === 2);
    const saved = db.gallery.g1.data;
    assert(await page.isVisible('#ver-tab-1.on'), 'saving stays on the version tab');
    assert(saved.versions[1].colorMap.photo === 'https://img.test/pair.png' && saved.colorMap.photo === 'https://img.test/main.png' && saved.versions[1].parts[0].name === 'Big body' && saved.parts[0].name === 'Body' && JSON.stringify(saved.versions[1].accessories) === '["a2"]' && saved.versions[0].accessories === null && JSON.stringify(saved.accessories) === '["a1"]', JSON.stringify(saved));
    await page.close();
    const p2 = await open(db, { suffix: '?design=dragon-organizer' });
    await p2.waitForSelector('#work-price');
    const c = await p2.evaluate(() => {
      const g = state.gallery.find(x => x.id === 'g1');
      const first = { acc: accessoryIds(g), parts: curParts(g).map(p => p.name), mins: designEstimateItem(g, null, designOpts('g1')).knownMinutes, pic: curColorMap(g).photo };
      setDesignVersion('g1', g.versions[1].id);
      return { first, second: { acc: accessoryIds(g), parts: curParts(g).map(p => p.name), pic: curColorMap(g).photo }, text: document.querySelector('.design-parts-grid') ? document.querySelector('.design-parts-grid').textContent : '' };
    });
    assert(JSON.stringify(c.first.acc) === '["a1"]' && c.first.parts.join() === 'Body,Lid' && c.first.mins === 105 && JSON.stringify(c.second.acc) === '["a2"]' && c.second.parts.join() === 'Big body,Lid' && c.first.pic === 'https://img.test/main.png' && c.second.pic === 'https://img.test/pair.png' && !/min/i.test(c.text), JSON.stringify(c));
    await p2.evaluate(() => setDesignVersion('g1', state.gallery[0].versions[0].id));
    await p2.waitForSelector('.design-part-photo');
    const before = p2.context().pages().length;
    await p2.click('.design-part-photo');
    await p2.waitForSelector('#photo-viewer');
    assert(p2.context().pages().length === before, 'no new tab');
    assert(!p2.errors.length, p2.errors.join('; '));
    await p2.close();
  });
  await check('owner extras: today list, version price check, low-stock notes, undo for saves, email to everyone interested', async () => {
    const db = fixtures();
    db.gallery.g1.data.minutes = 60; db.gallery.g1.data.grams = 20; db.gallery.g1.data.colorId = 'black';
    db.gallery.g1.data.parts = [{ id: 'x', name: 'Body', grams: 10 }, { id: 'y', name: 'Lid', grams: 10 }];
    const page = await open(db);
    await page.evaluate(asOwner('dashboard'));
    await page.waitForTimeout(300);
    assert(await page.isVisible('#today-list'), 'today list');
    await page.evaluate(asOwner('gallery'));
    await page.waitForTimeout(300);
    const low = await page.evaluate(() => {
      state.settings.colors = [{ id: 'black', name: 'Black', hex: '#111111' }]; state.ownerPrivate = { ...(state.ownerPrivate || {}), inventory: { black: { grams: 20, low: 100 } } };
      const g = state.gallery.find(x => x.id === 'g1');
      return { n: lowStockNotifications().length, note: /Low on Black/.test(lowStockDesignNote(g)), inBell: buildNotifications().some(n => /^low-black/.test(n.id)) };
    });
    assert(low.n === 1 && low.note && low.inBell, JSON.stringify(low));
    await page.evaluate(() => editGalleryItem('g1'));
    await page.fill('#new-version-name', 'Pair');
    await page.click('#add-version-quick');
    await page.waitForSelector('#ver-price-check');
    const pc = await page.textContent('#ver-price-check');
    assert(/Price check for Pair/.test(pc) && /\$\d/.test(pc), pc);
    await page.evaluate(() => saveGalleryItem());
    await page.waitForFunction(() => (state.gallery.find(x => x.id === 'g1').versions || []).length === 2);
    assert(await page.evaluate(() => (designHistory().g1 || []).length >= 1), 'the earlier save is kept');
    await page.click('#design-history summary');
    await page.click('#history-put-0');
    await page.waitForFunction(() => (state.gallery.find(x => x.id === 'g1').versions || []).length === 0);
    assert((db.gallery.g1.data.versions || []).length === 0, 'put back');
    await page.evaluate(() => { state.leads = [{ email: 'a@example.com', name: 'Ann', data: { lead: { designs: [{ id: 'g1', title: 'Dragon Organizer' }], at: '2026-01-01' }, items: [] } }]; state.leadsLoaded = true; });
    await page.evaluate(() => { openInterestEmail(); });
    assert(await page.isVisible('#interest-email #ie-subject') && /Dragon Organizer/.test(await page.inputValue('#ie-subject')), 'email box');
    await page.evaluate(() => closeInterestEmail());
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('customer extras: share colors link, compare versions, remembered pre-order choices, tell me when a color is back', async () => {
    const db = fixtures();
    db.gallery.g1.data.preorder = true;
    db.gallery.g1.data.parts = [{ id: 'x', name: 'Body', grams: 10 }, { id: 'y', name: 'Lid', grams: 5 }];
    db.gallery.g1.data.colorMap = { photo: 'https://img.test/c.png', regions: [{ hexes: ['#ffffff'], part: 'x' }, { hexes: ['#111111'], part: 'y' }], combos: [] };
    db.gallery.g1.data.versions = [{ id: 's', name: 'Single', count: 1 }, { id: 'd', name: 'Pair', count: 2 }];
    db.settings.colors = [{ id: 'black', name: 'Black', hex: '#111111' }, { id: 'red', name: 'Red', hex: '#cc0000' }, { id: 'gold', name: 'Gold', hex: '#d4af37', outOfStock: true }];
    const page = await open(db);
    await page.evaluate(leadIn);
    await page.evaluate(async () => { await loadGallery(); setTab('gallery'); openWork('g1'); });
    await page.waitForSelector('#color-ideas');
    assert(await page.isVisible('#color-ideas .version-picker'), 'the version choice sits just above the color picker, inside the color card');
    assert(!(await page.$('#work-price .version-picker')), 'and is not repeated lower down');
    assert(await page.isVisible('#version-compare summary'), 'compare versions');
    await page.click('#version-compare summary');
    assert((await page.$$('#version-compare tbody tr')).length === 2, 'a row per version');
    assert(await page.isVisible('#notify-gold'), 'tell me when gold is back');
    await page.evaluate(() => { setCmOwn('g1', 'x', 'red', 0); });
    const link = await page.evaluate(() => shareColorsLink('g1'));
    assert(/c=x%3Ared/.test(link), link);
    // remembered on this device: forget the page's own state, then come back to the design
    await page.evaluate(() => { state.designOpts = {}; state.cmView = {}; state.picksRestored = {}; render(); });
    assert(await page.evaluate(() => cmViewColors('g1').x === 'red'), 'the choice is still there when they come back');
    // a shared link
    await page.evaluate(() => { history.replaceState(null, '', location.pathname + '?design=dragon-organizer&v=d&c=' + encodeURIComponent('x:black,y:red')); state.designOpts = {}; state.cmView = {}; state.picksRestored = {}; state.sharedApplied = {}; render(); });
    const shared = await page.evaluate(() => ({ c: cmViewColors('g1'), v: designOpts('g1').version }));
    assert(shared.c.x === 'black' && shared.c.y === 'red' && shared.v === 'd', JSON.stringify(shared));
    await page.evaluate(() => { state.clientName = ''; state.clientEmail = ''; askNotifyColor('g1', 'gold'); });
    await page.fill('#notify-name', 'Pat Lee'); await page.fill('#notify-email', 'pat@example.com');
    await page.click('#notify-send');
    for (let k = 0; k < 20 && !db.drafts['pat@example.com']; k++) await page.waitForTimeout(100);
    assert(db.drafts['pat@example.com'] && /Gold is back/.test(JSON.stringify(db.drafts['pat@example.com'].data.lead.designs)), JSON.stringify(db.drafts));
    // live price: beside the color picker on the design page, and at the top of the part colors on the request form
    assert(await page.evaluate(() => !!document.querySelector('.cm-controls #cm-price .gallery-price')), 'the price sits with the color picker');
    await page.evaluate(() => { state.clientName = 'Pat Lee'; state.clientEmail = 'pat@example.com'; requestGalleryItem('g1'); });
    await page.waitForSelector('#part-live-price-0');
    assert(/\$\d/.test(await page.textContent('#part-live-price-0')), 'the request form shows the price by the part colors');
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('pre-order extras: check-your-pre-order box with the shipping tip, gift option saved with the order, owner dashboard and deposit reminders', async () => {
    const db = fixtures();
    Object.assign(db.gallery.g1.data, { preorder: true, minutes: 150, grams: 85, price: 40 });
    db.jobs.p1 = { id: 'p1', clientName: 'Second', clientEmail: 's@example.com', createdAt: ago(900), phase: 'order_received', paymentStatus: 'deposit_received', depositAt: ago(100), items: [{ name: 'Dragon Organizer', qty: 1, galleryId: 'g1', preorder: true, filType: 'black', minutes: 150, grams: 85 }] };
    db.jobs.p3 = { id: 'p3', clientName: 'Late Payer', clientEmail: 'late@example.com', createdAt: ago(40), phase: 'order_received', paymentStatus: 'payment_requested', items: [{ name: 'Dragon Organizer', qty: 2, galleryId: 'g1', preorder: true, filType: 'black', minutes: 150, grams: 85 }] };
    const page = await open(db);
    await page.evaluate(leadIn);
    await page.evaluate(async () => { await loadGallery(); setTab('gallery'); openWork('g1'); });
    await page.waitForSelector('.preorder-ship-tip');
    await page.evaluate(() => requestGalleryItem('g1'));
    await page.waitForSelector('#preorder-summary');
    const box = await page.textContent('#preorder-summary');
    assert(/Check your pre-order/.test(box) && /Dragon Organizer/.test(box) && /\$40\.00/.test(box) && /deposit about/.test(box) && /shipping can be combined/.test(box), box);
    assert(await page.isVisible('#gift-card'), 'gift card');
    await page.check('#gift-on');
    await page.fill('#gift-name', 'Grandma');
    await page.fill('#gift-note', 'Happy birthday!');
    await page.click('#submit-btn');
    await requestSent(page);
    const job = Object.values(db.jobs).find(j => j.clientName === 'Test Person');
    assert(job && job.gift && job.gift.on && job.gift.name === 'Grandma' && /birthday/.test(job.gift.note), JSON.stringify(job && job.gift));
    // owner
    await page.evaluate(asOwner('gallery'));
    await page.waitForTimeout(300);
    await page.evaluate(() => { state.galleryFolds = { 'Pre-orders': true }; render(); });
    await page.waitForSelector('#preorder-dashboard');
    const dash = await page.textContent('#preorder-dashboard');
    assert(/Dragon Organizer/.test(dash) && /deposits paid/.test(dash) && /waiting on a deposit/.test(dash) && /Late Payer/.test(dash) && /nothing here limits/i.test(dash), dash);
    assert(await page.isVisible('#remind-p3'), 'deposit reminder button');
    await page.click('#remind-p3');
    await page.waitForSelector('.mail-modal-backdrop');
    const mailText = await page.textContent('.mail-modal-backdrop'); assert(/Late Payer|Venmo|deposit/i.test(mailText) && /Send/i.test(mailText), 'the reminder shows the email first: ' + mailText.slice(0, 300));
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('real photos come first, the design page puts photos then colors and price then the description, customer photos show', async () => {
    const db = fixtures();
    db.gallery.g1.data.photos = ['https://img.test/a.png']; db.gallery.g1.data.realPhotos = ['https://img.test/real.png'];
    db.gallery.g1.data.description = 'The story of this print.';
    db.settings.customerPhotos = [{ id: 'cp1', name: 'Ann', designId: 'g1', photos: ['https://img.test/c.png'], date: '2026-01-01' }];
    const page = await open(db);
    await page.evaluate(async () => { await loadGallery(); setTab('gallery'); openWork('g1'); });
    await page.waitForSelector('#work-main-photo');
    assert(await page.evaluate(() => state.gallery.find(x => x.id === 'g1').photos[0]) === 'https://img.test/real.png', 'the real photo is the main one');
    assert(/real/.test(await page.getAttribute('#work-main-photo img', 'src')), 'and it is the first one shown');
    const tops = await page.evaluate(() => ['#work-main-photo', '#work-price', '.work-desc'].map(s => document.querySelector(s).getBoundingClientRect().top));
    assert(tops[0] < tops[1] && tops[1] < tops[2], 'photos, then the price and request, then the description: ' + tops);
    assert(await page.isVisible('#customer-photos'), 'customer photos');
    await page.evaluate(asOwner('gallery'));
    await page.waitForTimeout(300);
    await page.evaluate(() => editGalleryItem('g1'));
    assert(await page.isVisible('#real-photos-field') && /real\.png/.test(await page.inputValue('#gallery-realPhotos')), 'a separate upload spot for real photos');
    await page.evaluate(() => saveGalleryItem());
    await page.waitForFunction(() => (state.gallery.find(x => x.id === 'g1').realPhotos || []).length === 1);
    assert(JSON.stringify(db.gallery.g1.data.realPhotos) === '["https://img.test/real.png"]' && JSON.stringify(db.gallery.g1.data.photos) === '["https://img.test/a.png"]', 'both kinds saved separately');
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('inbox: one checklist for what waits on you, notifications open it, photos wait for approval', async () => {
    const db = fixtures();
    db.colorIdeas.push({ id: 'ci7', design_id: 'g1', name: 'Dusk', colors: {}, created_at: new Date().toISOString() });
    db.reviews['1'] = { job_id: '1', status: 'new', name: 'Jane D.', text: 'Photo shared by a customer.', rating: null, photos: ['https://img.test/p.png'], created_at: new Date().toISOString() };
    db.jobs['1'].items[0].galleryId = 'g1';
    db.drafts['zed@example.com'] = { id: '11111111-2222-3333-4444-555555555555', email: 'zed@example.com', name: 'Zed', data: { items: [], lead: { designs: [{ id: 'n-g1-gold', title: 'Dragon Organizer', pick: 'Tell me when Gold is back' }], at: new Date().toISOString() } } };
    const page = await open(db);
    await page.evaluate(asOwner('dashboard'));
    await page.waitForSelector('.sub-tab:has-text("Inbox") .nav-badge');
    await page.click('.sub-tab:has-text("Inbox")');
    await page.waitForSelector('#inbox-todo');
    await page.waitForFunction(() => /Zed/.test(document.getElementById('inbox-todo').textContent) && /Photo from Jane D\./.test(document.getElementById('inbox-todo').textContent));
    const text = await page.textContent('#inbox-todo');
    assert(/Dusk/.test(text) && /Gold is back/.test(text), text);
    await page.click('#inbox-tick-idea-ci7');
    await page.waitForSelector('#inbox-done');
    assert(db.private.inbox && db.private.inbox.done['idea-ci7'], 'the tick is saved');
    assert(!/Dusk/.test(await page.textContent('#inbox-todo')), 'a ticked item leaves the to-do list');
    await page.click('#inbox-approve-1');
    await page.waitForFunction(() => !/Photo from Jane/.test(document.getElementById('inbox-todo').textContent));
    assert(db.reviews['1'].status === 'approved' && db.settings.customerPhotos[0].designId === 'g1' && db.settings.customerPhotos[0].photos[0] === 'https://img.test/p.png', JSON.stringify(db.settings.customerPhotos));
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('start here: three ways in; ideas coming soon: customers say "I would buy this", the owner sees who and adds ideas', async () => {
    const db = fixtures();
    db.settings.soonIdeas = [{ id: 's1', title: 'Cable Hook', text: 'For the desk', photo: '', live: true }];
    const page = await open(db);
    assert(await page.isVisible('#start-here') && await page.isVisible('#start-designs') && await page.isVisible('#start-idea') && await page.isVisible('#start-part'), 'start here');
    await page.click('#start-part');
    await page.waitForSelector('#notes-0');
    assert(/The part you need/.test(await page.getAttribute('#notes-0', 'placeholder')) && !(await page.$('#start-here')), 'the custom part path asks for the part, and the buttons go away');
    await page.evaluate(() => { state.soonFor = ''; render(); });
    assert(await page.isVisible('#soon-ideas'), 'ideas coming soon');
    await page.click('#soon-want-s1');
    await page.fill('#soon-name', 'Pat Lee'); await page.fill('#soon-email', 'pat@example.com');
    await page.click('#soon-send');
    for (let k = 0; k < 20 && !db.drafts['pat@example.com']; k++) await page.waitForTimeout(100);
    assert(db.drafts['pat@example.com'] && /soon-s1/.test(JSON.stringify(db.drafts['pat@example.com'].data.lead.designs)), JSON.stringify(db.drafts));
    await page.evaluate(asOwner('gallery'));
    await page.waitForTimeout(300);
    await page.evaluate(async () => { await fetchLeads(); state.galleryFolds = { 'Ideas coming soon': true }; render(); });
    await page.waitForSelector('#soon-owner');
    assert(/Cable Hook/.test(await page.textContent('#soon-owner')) && /1\s*want/.test(await page.textContent('#soon-owner')), await page.textContent('#soon-owner'));
    await page.fill('#soon-title', 'Desk Tray');
    await page.click('#soon-add');
    await page.waitForFunction(() => (state.settings.soonIdeas || []).length === 2);
    assert(db.settings.soonIdeas.length === 2 && db.settings.soonIdeas[1].title === 'Desk Tray', JSON.stringify(db.settings.soonIdeas));
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('phone design page: price and order button stay at the bottom, description and parts fold, terms fold, no empty part pictures', async () => {
    const db = fixtures();
    Object.assign(db.gallery.g1.data, { preorder: true, description: 'The story.', minutes: 150, grams: 85 });
    db.gallery.g1.data.parts = [{ id: 'x', name: 'Body', grams: 10 }, { id: 'y', name: 'Lid', grams: 5, photo: 'https://img.test/lid.png' }];
    const page = await open(db, { width: 390, height: 800 });
    await page.evaluate(leadIn);
    await page.evaluate(async () => { await loadGallery(); setTab('gallery'); openWork('g1'); });
    await page.waitForSelector('#buy-bar');
    assert(/Create Order and Send Deposit/.test(await page.textContent('#buy-bar-btn')) && /\$\d/.test(await page.textContent('#buy-bar')), 'bottom bar with price and the main button');
    assert(await page.evaluate(() => !document.querySelector('.work-desc').open && !document.querySelector('.design-parts').open), 'description and parts start folded on a phone');
    assert(await page.evaluate(() => !document.querySelector('.preorder-terms-fold').open && /first come, first served/i.test(document.querySelector('.preorder-note').textContent)), 'terms fold, the key line stays');
    await page.evaluate(() => { document.querySelector('.design-parts').open = true; });
    assert((await page.$$('.design-part-photo')).length === 1 && (await page.$$('.part-thumb-blank')).length === 0, 'only parts with a photo show a picture box');
    const big = await page.evaluate(() => { const c = document.querySelector('.special-order-check input'); return c ? c.getBoundingClientRect().width : 99; });
    assert(big >= 22, 'tick boxes are bigger on a phone: ' + big);
    await page.close();
    const wide = await open(db, { width: 1100, height: 800 });
    await wide.evaluate(async () => { await loadGallery(); setTab('gallery'); openWork('g1'); });
    await wide.waitForSelector('.work-desc');
    assert(await wide.evaluate(() => document.querySelector('.work-desc').open) && !(await wide.isVisible('#buy-bar')), 'on a wide screen they stay open and there is no bottom bar');
    await wide.close();
  });
  await check('request form: one "Before you send" card; Start here replaces the big Request button; ideas show a count only when enough want them', async () => {
    const db = fixtures();
    Object.assign(db.gallery.g1.data, { preorder: true, minutes: 150, grams: 85, price: 40 });
    db.settings.soonIdeas = [{ id: 's1', title: 'Cable Hook', text: '', photo: '', live: true, wanted: 6 }, { id: 's2', title: 'Tray', text: '', photo: '', live: true, wanted: 2 }];
    db.settings.soonShowAt = 5;
    const page = await open(db);
    assert(await page.isVisible('#start-here') && !(await page.$('#start-request')), 'the big Request button is replaced by Start here');
    const soon = await page.textContent('#soon-ideas');
    assert(/6\s*people want this/.test(soon) && !/2\s*people want this/.test(soon), soon);
    await page.evaluate(leadIn);
    await page.evaluate(async () => { await loadGallery(); setTab('gallery'); openWork('g1'); requestGalleryItem('g1'); });
    await page.waitForSelector('#before-send');
    assert(await page.evaluate(() => !!document.querySelector('#before-send #preorder-summary') && !!document.querySelector('#before-send #gift-card') && document.querySelectorAll('#preorder-summary, #gift-card').length === 2), 'the summary and the gift option sit in one card');
    await page.close();
  });
  await check('inbox: under Orders, filters, mark all done; Settings tabs merged (reviews with about, password with updates)', async () => {
    const db = fixtures();
    db.colorIdeas.push({ id: 'ci8', design_id: 'g1', name: 'Dawn', colors: {}, created_at: new Date().toISOString() });
    const page = await open(db);
    await page.evaluate(asOwner('dashboard'));
    assert((await page.$$eval('nav.nav .nav-tab', els => els.map(e => e.textContent.replace(/\d+$/, '').trim()))).join('|') === 'Orders|Designs|Money & Sales|Settings|Help', 'six tabs are back to five');
    await page.click('.sub-tab:has-text("Inbox")');
    await page.waitForSelector('#inbox-todo');
    await page.click('#inbox-filter-ideas');
    assert(/Dawn/.test(await page.textContent('#inbox-todo')) && !(await page.$('.inbox-item .inbox-kind:has-text("Filament")')), 'the filter shows only that group');
    await page.click('#inbox-filter-all');
    await page.click('#inbox-mark-all');
    await page.waitForFunction(() => /0\)/.test(document.querySelector('#inbox-todo .card-title').textContent) || document.querySelectorAll('#inbox-todo .inbox-item').length === 0);
    assert(db.private.inbox && db.private.inbox.done['idea-ci8'], 'mark all done is saved');
    await page.evaluate(asOwner('settings/reviews'));
    await page.waitForSelector('.sub-tab.active:has-text("About, links")');
    const about = await page.textContent('#main');
    assert(/About you/.test(about) && /Customer reviews/.test(about), 'about and reviews are one tab');
    await page.evaluate(asOwner('settings/password'));
    await page.waitForSelector('.sub-tab.active:has-text("Password & updates")');
    const acct = await page.textContent('#main');
    assert(/password/i.test(acct) && /Updates|updated/i.test(acct), 'password and updates are one tab');
    assert(!page.errors.length, page.errors.join('; '));
    await page.close();
  });
  await check('footer: where is my order, policy pages and contact on every customer page; the owner edits or hides the pages', async () => {
    const db = fixtures();
    db.settings.links = { messenger: 'https://m.me/shop', etsy: '', email: 'hello@example.com' };
    db.settings.about = { ...(db.settings.about || {}), replyTime: 'I usually reply within a day.' };
    const page = await open(db);
    for (const tab of ['submit', 'gallery', 'jobs']) {
      await page.evaluate(x => setTab(x), tab);
      assert(await page.isVisible('#site-footer #footer-track') && await page.isVisible('#footer-privacy') && await page.isVisible('#footer-returns') && await page.isVisible('#footer-shipping'), 'footer links on ' + tab);
    }
    assert(/hello@example\.com/.test(await page.textContent('#footer-contact')) && /Messenger/.test(await page.textContent('#footer-contact')) && /within a day/.test(await page.textContent('#footer-contact')), 'contact details');
    await page.evaluate(() => setTab('submit'));
    await page.click('#footer-privacy');
    await page.waitForSelector('#policy-page');
    assert(/Venmo/.test(await page.textContent('#policy-page')) && /Privacy/.test(await page.textContent('#policy-page h2')), 'privacy page');
    await page.click('#policy-back');
    assert(await page.evaluate(() => state.clientTab) === 'submit', 'Back returns');
    await page.click('#footer-track');
    assert(await page.evaluate(() => state.clientTab) === 'jobs', "Where's my order? opens My Requests");
    await page.click('#footer-shipping');
    assert(/shipping deposit/i.test(await page.textContent('#policy-page')), 'shipping page');
    // the owner changes one page and hides another
    await page.evaluate(asOwner('settings/about'));
    await page.waitForSelector('#policy-settings');
    await page.fill('#policy-text-returns', 'My own returns words.');
    await page.uncheck('#policy-live-privacy');
    await page.click('#settings-save');
    await page.waitForFunction(() => state.settings.policies && state.settings.policies.returns && state.settings.policies.returns.text === 'My own returns words.');
    assert(db.settings.policies.returns.text === 'My own returns words.' && db.settings.policies.privacy.live === false && db.settings.policies.shipping.text === '', JSON.stringify(db.settings.policies));
    const p2 = await open(db);
    assert(!(await p2.$('#footer-privacy')) && await p2.isVisible('#footer-returns'), 'a hidden page leaves the footer');
    await p2.click('#footer-returns');
    assert(/My own returns words/.test(await p2.textContent('#policy-page')), 'the owner\'s own text shows');
    assert(!page.errors.length && !p2.errors.length, page.errors.concat(p2.errors).join('; '));
    await p2.close();
    await page.close();
  });
  await check('size and material: height, width and depth on every design, shown on a chosen photo; PLA unless noted', async () => {
    const db = fixtures();
    db.gallery.g1.data.realPhotos = ['https://img.test/real.png'];
    db.gallery.g1.data.photos = ['https://img.test/a.png'];
    const page = await open(db);
    await page.evaluate(async () => { await loadGallery(); setTab('gallery'); openWork('g1'); });
    await page.waitForSelector('#design-material');
    assert(/PLA/.test(await page.textContent('#design-material')) && !(await page.$('#design-size')), 'no size yet: just the material line');
    await page.evaluate(asOwner('gallery'));
    await page.waitForTimeout(300);
    await page.evaluate(() => editGalleryItem('g1'));
    await page.fill('#gallery-dim-h', '6'); await page.fill('#gallery-dim-w', '8.5'); await page.fill('#gallery-dim-d', '4');
    await page.selectOption('#gallery-dim-unit', 'in');
    await page.click('#size-photo-0');
    assert(/H 6 in/.test(await page.textContent('#size-preview')) && /W 8\.5 in/.test(await page.textContent('#size-preview')), 'the owner sees the preview');
    await page.fill('#gallery-material', 'PETG');
    await page.evaluate(() => saveGalleryItem());
    await page.waitForFunction(() => (state.gallery.find(x => x.id === 'g1').dims || {}).h === 6);
    const saved = db.gallery.g1.data;
    assert(saved.dims.h === 6 && saved.dims.w === 8.5 && saved.dims.d === 4 && saved.dims.unit === 'in' && saved.sizePhoto === 'https://img.test/real.png' && saved.material === 'PETG', JSON.stringify([saved.dims, saved.sizePhoto, saved.material]));
    const cust = await open(db);
    await cust.evaluate(async () => { await loadGallery(); setTab('gallery'); openWork('g1'); });
    await cust.waitForSelector('#design-size .size-photo');
    const txt = await cust.textContent('#design-size');
    assert(/H 6 in/.test(txt) && /W 8\.5 in/.test(txt) && /D 4 in/.test(txt) && /Height\s*6 in/.test(txt) && /Material:\s*PETG/.test(txt), txt);
    assert(!page.errors.length && !cust.errors.length, page.errors.concat(cust.errors).join('; '));
    await cust.close();
    await page.close();
  });
  await check('customer walk-through fixes: gallery photo and name open the design, no sideways scroll with per-color prices, request received stays on screen', async () => {
    const db = fixtures();
    db.settings.colors = [['black', 'Black', '#1e1e24'], ['white', 'White', '#f4f4f4'], ['red', 'Red', '#d22b2b'], ['green', 'Green', '#2f9e44']].map(([id, name, hex]) => ({ id, name, hex }));
    db.gallery.g1.data.parts = [{ id: 'b', name: 'Base and walls', grams: 600, group: 'Shell' }, { id: 'dv', name: 'Dividers', grams: 120 }, { id: 'h', name: 'Handle', grams: 60 }];
    db.gallery.g1.data.colorMap = { photo: 'https://img.test/c.png', regions: [{ hexes: ['#ffffff'], part: 'b' }], combos: [{ id: 'k1', name: 'Candy Cane', colors: { b: 'white', dv: 'red', h: 'green' } }] };
    db.gallery.g1.data.minutes = 600; db.gallery.g1.data.grams = 780;
    const page = await open(db, { width: 390, height: 844 });
    await page.evaluate(() => setTab('gallery'));
    await page.waitForSelector('.gallery-card');
    await page.click('.gallery-card:has-text("Dragon Organizer") .gallery-photo');
    await page.waitForSelector('#work-price');
    await page.evaluate(() => setCmOwn('g1', 'b', 'black', 0));
    await page.waitForTimeout(500);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(over <= 1, 'the per-color price lines push the page sideways by ' + over + 'px');
    await page.evaluate(() => closeWork());
    await page.click('.gallery-card:has-text("Dragon Organizer") .gallery-title-link');
    await page.waitForSelector('#work-price');
    await page.click('#buy-bar-btn');
    await page.waitForSelector('#client-name');
    await page.fill('#client-name', 'Casey'); await page.fill('#client-email', 'casey@example.com');
    await page.click('#submit-btn');
    await requestSent(page);
    await page.waitForSelector('#sent-note');
    assert(/received your request/.test(await page.textContent('#sent-note')) && /casey@example\.com/.test(await page.textContent('#sent-note')), 'a lasting confirmation on My Requests');
    assert(await page.evaluate(() => scrollY) < 50, 'they land at the top of My Requests');
    await page.close();
  });
  await check('part photos: uploading in the edit form adds the photo and saving keeps it', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.evaluate(asOwner('gallery'));
    await page.waitForTimeout(300);
    await page.evaluate(() => editGalleryItem('g2'));
    await page.waitForSelector('.part-form-actions input[type=file]', { state: 'attached' });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await page.setInputFiles('.part-form-actions input[type=file]', { name: 'p.png', mimeType: 'image/png', buffer: png });
    await page.waitForFunction(() => /Photo added|Couldn/.test(document.getElementById('part-status-0')?.textContent || ''));
    const msg = await page.textContent('#part-status-0');
    assert(/Photo added/.test(msg), msg);
    assert(await page.evaluate(() => /part-/.test(state.galleryForm.parts[0].photo)), 'photo is on the form');
    assert(await page.evaluate(() => document.querySelector('.part-form-row img.part-thumb')?.getAttribute('src').includes('part-')), 'the part photo shows in the form');
    const order = await page.evaluate(() => { movePart(0, 1); const a = state.galleryForm.parts.map(p => p.name).join(); partsOptionalLast(); return [a, state.galleryForm.parts.map(p => p.name).join()]; });
    assert(order[0] === 'Letters,Plate' && order[1] === 'Plate,Letters', JSON.stringify(order));
    await page.evaluate(() => { movePart(0, 1); movePart(0, 1); });
    await page.click('#gallery-save');
    await page.waitForTimeout(600);
    assert(/part-/.test(db.gallery.g2.data.parts[0].photo || ''), 'saved: ' + JSON.stringify(db.gallery.g2.data.parts[0]));
    await page.close();
  });
  await check('add a design wizard: step by step, blocked without a name, creates a hidden design', async () => {
    const db = fixtures();
    const page = await open(db);
    await page.evaluate(asOwner('newdesign'));
    await page.waitForSelector('#wizard');
    await page.click('#wiz-next');
    assert(/name first/.test(await page.textContent('#wizard')), 'asks for a name');
    await page.fill('#gallery-title', 'Wizard Hook');
    const stepNames = async () => (await page.locator('.wiz-step').allTextContents()).join('|');
    assert(!(await stepNames()).includes('Pre-order settings'), 'no pre-order step yet');
    await page.click('#wiz-preorder-yes');
    assert((await stepNames()).includes('Pre-order settings'), 'pre-order step appears');
    await page.click('#wiz-next');
    await page.waitForSelector('#gallery-photos');
    await page.fill('#gallery-videos', 'https://youtu.be/dQw4w9WgXcQ');
    await page.click('#wiz-next');
    await page.fill('#gallery-hours', '1');
    await page.fill('#gallery-mins', '30');
    await page.fill('#gallery-grams', '40');
    await page.click('#wiz-next');   // parts
    assert(!(await stepNames()).includes('Color ideas'), 'no color ideas step without parts');
    await page.click('#wiz-parts-yes');
    assert((await stepNames()).includes('Color ideas'), 'color ideas step appears with parts');
    await page.click('#wiz-next');   // color ideas
    await page.click('#wiz-next');   // accessories
    await page.click('#wiz-accessories-yes');
    await page.click('#wiz-next');   // versions
    await page.click('#wiz-versions-yes');
    assert(await page.locator('.versions-fields').count() === 1, 'versions form opens');
    await page.click('#wiz-next');   // editions
    await page.click('#wiz-next');   // pre-order settings
    assert(await page.locator('.preorder-fields, #wizard fieldset').count() >= 1, 'pre-order settings form shows');
    await page.click('#wiz-next');   // finish
    assert(/Wizard Hook/.test(await page.textContent('.wiz-summary')) && /1h 30m|1 h 30/.test(await page.textContent('.wiz-summary')), await page.textContent('.wiz-summary'));
    await page.click('#gallery-save');
    await page.waitForFunction(() => state.wiz && state.wiz.step === 'done');
    const made = Object.values(db.gallery).find(g => g.data.title === 'Wizard Hook');
    assert(made && made.published === false && made.data.grams === 40 && made.data.minutes === 90 && made.data.preorder === true, JSON.stringify(made));
    assert(/hidden for now/.test(await page.textContent('#main')), 'done screen');
    assert(!page.errors.length, page.errors.join('; '));
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
    await page.evaluate(showOrder('s1'));
    await page.fill('#hours-s1-0', '1');
    await page.click('#approve-btn-s1');
    await mailChoice(page);
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
    const order = await page.$$eval('.request-card .mode-title', ts => ts.map(t => t.textContent));
    assert(order.join() === 'Something from my past work,I have a link,I have an idea', `choice order ${order}`);
    assert(await page.$('.mode-option.selected:has-text("Something from my past work")') && await page.$('.gallery-pick-tile'), 'past work should be picked to start with, showing the designs');
    await page.click('text=I have an idea');
    assert(await page.$('.mode-option.selected[aria-pressed="true"]:has-text("I have an idea")') && await page.$('#mode-form-0 #notes-0'), 'idea form not shown below the choices');
    assert(!(await page.$('text=Change')), 'the old Change link is still there');
    assert(await page.$eval('.time-toggle', el => el.tagName) === 'BUTTON', 'print time is not a button');
    await page.fill('#notes-0', 'A hook for my bike helmet');
    await page.click('text=I have a link');
    assert(await page.inputValue('#link-0') === '' && (await page.$$('.request-card .mode-option')).length === 3, 'link form should start empty with the choices still shown');
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
    await owner.evaluate(showOrder('c1'));
    assert(await owner.isChecked('#terms-c1'), 'terms should be on by default for a custom design');
    await owner.fill('#hours-c1-0', '1');
    await owner.click('#approve-btn-c1');
    await mailChoice(owner);
    await owner.waitForTimeout(300);
    assert(/Custom design terms/.test(db.jobs['c1'].designTerms) && /I own the design/.test(db.jobs['c1'].designTerms), 'terms not saved on the quote');
    await owner.close();
    const page = await open(db);
    await page.evaluate("(async () => { " + asCustomer(keysFor(db, 'jane@example.com')) + " state.clientTab = 'jobs'; render(); })()");
    assert(/I may make, sell and share prints of the design/.test(await page.textContent('#order-c1 .design-terms-text')), 'terms not shown to the customer');
    await page.click('#customer-approve-c1');
    await page.waitForTimeout(300);
    assert(!db.jobs['c1'].customerApprovedAt && /tick the box/.test(await page.textContent('#terms-err-c1')), 'approved without agreeing');
    await page.check('#terms-agree-c1');
    await page.click('#customer-approve-c1');
    await page.waitForFunction(() => state.batches.find(b => b.id === 'c1').phase === 'order_received');
    assert(db.jobs['c1'].customerApprovedAt && db.jobs['c1'].phase === 'order_received', 'approval not saved after agreeing');
    await page.close();
    const after = await open(db);
    await after.evaluate(asOwner('dashboard'));
    await after.evaluate(showOrder('c1'));
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
    await mailChoice(quoting);
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
    await owner.evaluate(showOrder('e1'));
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
    await owner.waitForTimeout(300);
    await owner.click('button[onclick="cancelOwnerEdit()"]');
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
    await owner.click('#order-e1 >> text=Close');
    assert(db.jobs.e1.clientName === 'Pat' && /Pat/.test(await owner.textContent('#order-e1')), 'cancel kept the changes');
    // Remove the spare item, then quote it: your price x 3 + roll + your charge.
    await owner.click('#edit-request-e1');
    await owner.click('text=Remove item 2');
    await owner.click('#owner-edit-save');
    await owner.waitForTimeout(300);
    await owner.click('button[onclick="cancelOwnerEdit()"]');
    await owner.waitForSelector('#edit-request-e1');
    await owner.fill('#special-cost-e1', '20');
    await owner.click('#approve-btn-e1');
    await mailChoice(owner);
    await owner.waitForTimeout(300);
    assert(db.jobs.e1.phase === 'quote_sent' && db.jobs.e1.items.length === 1, JSON.stringify(db.jobs.e1));
    assert(await owner.evaluate(() => batchTotal(state.batches.find(b => b.id === 'e1'))) === 57.5, 'total should be 3 x 7.50 + 20 roll + 15 charge');
    await owner.close();
    const page = await open(db);
    await page.evaluate(async (keys) => { state.tokens = keys; await loadBatches(true); state.clientTab = 'jobs'; render(); }, keysFor(db, 'pat@example.com'));
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
    await owner.evaluate(showOrder('1'));
    await owner.waitForSelector('#dtrack-1');
    await owner.click('button:has-text("Save tracking and mark Shipped")', { timeout: 3000 }).catch(() => {});
    await mailChoice(owner).catch(() => {});
    assert(db.jobs['1'].phase === 'ready_to_ship', 'needs a tracking number first');
    await owner.fill('#dtrack-1', 'USPS 9400 1111');
    await owner.fill('#dpost-1', '9.50');
    await owner.click('button:has-text("Save tracking and mark Shipped")');
    await mailChoice(owner);
    await owner.waitForTimeout(400);
    assert(db.jobs['1'].phase === 'delivered' && db.jobs['1'].deliveryTracking === 'USPS 9400 1111' && db.jobs['1'].postageCost === 9.5, JSON.stringify(db.jobs['1']));
    await owner.close();
  });
  await check('FAQ search: shows every question whose question or answer has the words', async () => {
    const db = fixtures();
    db.settings = { ...db.settings, faq: [{ id: 'a', q: 'How long?', a: 'About a week.', live: true }, { id: 'b', q: 'Do you ship?', a: 'Yes, by USPS.', live: true }, { id: 'c', q: 'Colors?', a: 'Many.', live: true }] };
    const page = await open(db);
    await page.waitForSelector('#faq-search');
    assert(!(await page.isVisible('#faq-list')) && await page.isVisible('#faq-all'), 'at the bottom of a page the questions start folded');
    await page.fill('#faq-search', 'usps');
    assert(await page.isVisible('#faq-list'), 'searching opens them');
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
    assert(!(await page.$('.swatch-pill:has-text("Red") .swatch-photo')), 'the Red choice should be colored, not a busy photo');
    assert(await page.evaluate(() => { const p = [...document.querySelectorAll('.color-pill')].find(b => /Red/.test(b.textContent)); return p && p.style.background.includes('rgb') && getComputedStyle(p).backgroundColor !== getComputedStyle(document.body).backgroundColor; }), 'the whole Red pill should be filled with its color');
    await page.click('.swatch-pill:has-text("Red")');
    assert(await page.$('.color-info .color-photo img'), 'picking Red should show its photo');
    await page.click('.color-info .color-photo');
    assert(await page.$('#photo-viewer img') && /example of Red filament, printed before/i.test(await page.textContent('#photo-viewer')), 'tapping the photo should enlarge it on the same page with a note');
    assert(page.context().pages().length === 1, 'it must not open a new tab');
    await page.keyboard.press('Escape');
    assert(!(await page.$('#photo-viewer')), 'Escape should close the enlarged photo');
    await page.click('.color-info .color-photo');
    await page.click('#photo-viewer .photo-viewer-close');
    assert(!(await page.$('#photo-viewer')), 'the Close button should close it');
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
    await owner.evaluate(showOrder('q1'));
    const q1card = await owner.textContent('#order-q1');
    await owner.evaluate(showOrder('1'));
    assert(/#1 in line/.test(q1card) && /Waiting for deposit/.test(await owner.textContent('#order-1')), 'owner positions');
    await owner.click('#order-1 button:has-text("Deposit received")');
    await mailChoice(owner);
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
    await owner.waitForTimeout(300);
    assert(!(await owner.textContent('#cm-bg-warn')).trim(), 'no warning while only the print is matched');
    const bgArea = now.findIndex(h => near(h, '#56565a') < 30);
    await owner.selectOption(`#cm-region-${bgArea}`, partIds[0]);
    await owner.waitForSelector(`#cm-bg-warn:has-text("Area ${bgArea + 1}")`);
    assert(/background/.test(await owner.textContent('#cm-bg-warn')), 'warns that the background is set to a part');
    await owner.selectOption(`#cm-region-${bgArea}`, '');
    await owner.waitForFunction(() => !document.getElementById('cm-bg-warn').textContent.trim());
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
    assert(picks.join() === 'Red and black', `out-of-stock ideas are hidden: ${picks}`);
    const pixel = (x, y) => page.evaluate(([x, y]) => [...document.querySelector('#color-ideas canvas').getContext('2d').getImageData(x, y, 1, 1).data].slice(0, 3), [x, y]);
    const lit = await pixel(60, 40), shade = await pixel(60, 95), bg = await pixel(5, 5);
    assert(lit[0] > 150 && lit[1] < 90 && lit[2] < 90, `the body should be red: ${lit}`);
    assert(shade[0] < lit[0] && shade[0] > 60 && shade[1] < 60, `the shaded face should stay a darker red: ${shade}`);
    assert(bg.join() === '86,86,90', `the background is left as it is: ${bg}`);
    const set2 = await pixel(95, 40);
    assert(set2[0] < 60 && set2[1] < 60, `the second set is painted in its own color (black): ${set2}`);
    assert(await page.inputValue('#cm-own-0') === 'red' && /Body/.test(await page.textContent('.cm-own')), 'the color buttons show each part in its color');
    // The estimate follows the colors picked: Red costs more per gram here.
    const prices = async () => [await page.textContent('#cm-price .gallery-price'), await page.textContent('#work-price .gallery-price')].map(x => x.match(/\$[\d.]+/)[0]);
    const before = await prices();
    assert(before[0] === before[1] && /Red/.test(await page.textContent('#cm-price')), `card and page price match: ${before}`);
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
  await check('header shows how long ago the site was updated (minutes, hours, days) and never hides', async () => {
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
    for (const [mins, text] of [[61, 'Updated 1 hr ago'], [540, 'Updated 9 hr ago'], [4320, 'Updated 3 days ago']]) {
      db.deployedMinsAgo = mins;
      await page.evaluate(() => loadLastUpdate());
      assert(await page.textContent('#build-badge') === text && await page.isVisible('#build-badge'), `${mins} min: ${await page.textContent('#build-badge')}`);
    }
    await page.close();
  });
  await check('reviews: bubbles narrow as more are added (4 across); more than 4 shuffle, scroll and drift', async () => {
    const page = await open(fixtures());
    const many = n => page.evaluate(n => { state.settings.reviews = Array.from({ length: n }, (x, k) => ({ id: 'r' + k, name: 'C' + k, text: 'Review ' + k })); render(); }, n);
    await many(3);
    let boxes = await page.$$eval('.reviews .review', els => els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.width)]; }));
    assert(boxes.length === 3 && boxes.every(b => b[0] === boxes[0][0] && Math.abs(b[1] - boxes[0][1]) < 2) && !(await page.$('.reviews-wrap.many')), `3 in one row, same size: ${JSON.stringify(boxes)}`);
    const w3 = boxes[0][1];
    await many(4);
    boxes = await page.$$eval('.reviews .review', els => els.map(e => Math.round(e.getBoundingClientRect().width)));
    assert(boxes[0] < w3, `4 are narrower than 3: ${boxes[0]} vs ${w3}`);
    await many(7);
    await page.waitForSelector('.reviews-wrap.many .review-nav');
    const order = () => page.$$eval('.reviews .review blockquote', els => els.map(e => e.textContent).join('|'));
    const first = await order();
    await page.evaluate(() => render());
    assert(await order() === first, 'the random order stays the same while the visitor is here');
    const start = await page.$eval('.reviews', e => e.scrollLeft);
    await page.mouse.move(0, 0);
    await page.waitForFunction(s => document.querySelector('.reviews').scrollLeft > s + 5, start, { timeout: 4000 });
    await page.click('.review-nav[aria-label="More reviews"]');
    await page.waitForTimeout(600);
    assert(await page.$eval('.reviews', e => e.scrollLeft) > start + 50, 'the arrow scrolls to more');
    await page.close();
  });
  await check('company logo add-on: note on every design, tick box adds the logo price, saved with the request', async () => {
    const db = fixtures();
    db.settings.rules = { ...(db.settings.rules || {}), logoPrice: 1.5 };
    const page = await open(db, { suffix: '?design=dragon-organizer' });
    await page.waitForSelector('#logo-offer');
    assert(/company logo/i.test(await page.textContent('#logo-offer')) && /\$1\.50/.test(await page.textContent('#logo-offer')), await page.textContent('#logo-offer'));
    const shown = async () => parseFloat((await page.textContent('#work-price .gallery-price')).match(/\$([\d.]+)/)[1]);
    const plain = await shown();
    await page.check('#design-logo');
    assert(Math.abs(await shown() - plain - 1.5) < 0.001, 'ticking the logo on the design page adds its price there');
    await page.click('#work-price button:has-text("Request this")');
    await page.waitForSelector('#logo-0');
    assert(await page.isChecked('#logo-0'), 'the logo ticked on the design page carries into the request');
    await page.uncheck('#logo-0');
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
    await page.evaluate(showOrder('9'));
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
    const customer = await open(db, { suffix: '?o=' + keyOf('9') });
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
    await owner.waitForSelector('.desk-row.tone-need:has-text("Customer wrote")');
    const janeRow = await owner.textContent('.desk-row.tone-need:has-text("Customer wrote")');
    assert(/jane@example\.com/.test(janeRow), 'the order whose customer wrote is in Needs me with a Customer wrote chip: ' + janeRow);
    assert(/needs? you/.test(await owner.textContent('.owner-page-header')) && await owner.locator('nav.nav button:has-text("Orders") .nav-badge').count() === 1, 'the Orders tab and header should say what needs you');
    await owner.evaluate(showOrder('1'));
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
    assert(/Waiting on customer/.test(await owner.textContent('#order-1 .job-title')) && !/Customer wrote/.test(await owner.textContent('.desk-list')), 'now waiting on the customer');
    assert(await owner.inputValue('#msg-text-1') === '', 'no default text once you have written');
    const editable = Object.keys(db.jobs).find(id => ['estimate', 'details_check', undefined].includes(db.jobs[id].phase));
    await owner.evaluate(showOrder(editable));
    if (await owner.$(`#edit-request-${editable}`)) {
      await owner.click(`#edit-request-${editable}`);
      await owner.waitForSelector(`.chat-edit #conv-${editable} + #owner-edit-${editable}`);
      assert(await owner.$eval(`#conv-${editable}`, el => el.open), 'the conversation stays open beside the edit form');
      await owner.click('#owner-edit-save');
      await owner.waitForTimeout(300);
      assert(await owner.$('.chat-edit'), 'saving keeps the edit form open so work can continue');
      await owner.click('button[onclick="cancelOwnerEdit()"]');
      await owner.waitForTimeout(300);
      assert(!(await owner.$('.chat-edit')), 'closing the edit form');
    } else throw new Error('no order with an "Edit their request" button');
    await owner.evaluate(asOwner('clients'));   // the old tab name still opens Customers
    await owner.evaluate(showOrder('1'));
    await owner.click('.client-notes > summary');
    await owner.waitForSelector('#client-notes');
    await owner.fill('#client-notes', 'Prefers pickup.');
    await owner.fill('#client-issues', 'Paid late once.');
    await owner.waitForTimeout(1000);
    const notes = db.private.clients && db.private.clients['jane@example.com'];
    assert(notes && notes.notes === 'Prefers pickup.' && notes.issues === 'Paid late once.', JSON.stringify(db.private));
    assert(!JSON.stringify(db.jobs).includes('Paid late once'), 'client notes must never be saved in an order');
    await owner.close();
    const page = await open(db, { suffix: '?o=' + keyOf('1') });
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
    assert(/Deposit received/.test(await cust()) && /We received your deposit of \$/.test(await cust()), 'deposit email says how much was paid');
    await page.selectOption('#practice-phase', 'final_payment_needed');
    const payBtn = await page.textContent('#practice-pay-all');
    assert(/Pay the rest and shipping deposit/.test(payBtn), payBtn);
    const sums = await page.evaluate(() => { const o = state.practice.order; return finalPayment(o, orderSum(o), rulesFor(o)).remainder; });
    assert(payBtn.includes(`$${sums.toFixed(2)}`) && sums > 15, `practice balance should include the $15 shipping deposit: ${payBtn}`);
    assert(/\$1\.00 for packaging and \$14\.00 toward postage/.test(await page.textContent('.practice-side .order-action')), 'shipping deposit breakdown');
    await page.selectOption('#practice-payment', 'payment_received');
    await page.selectOption('#practice-phase', 'ready_to_ship');
    await page.fill('#practice-tracking', 'USPS 9400 1111');
    await page.click('text=Save tracking and mark Shipped');
    await page.click('#practice-skip');
    const all = await cust();
    ['final payment', 'received, thank you', 'We received your payment of $', 'is on its way', 'Tracking number: USPS 9400 1111', 'How did your SoloPrint order turn out'].forEach(w => assert(all.includes(w), `missing email: ${w}`));
    assert(db.log.every(l => l.startsWith('GET')), `practice must not write anything: ${db.log.filter(l => !l.startsWith('GET'))}`);
    assert(JSON.stringify(db.jobs) === jobsBefore && db.messages.length === messagesBefore, 'real orders and messages untouched');
    await page.close();
  });
  await check('customer balance after printing includes the shipping deposit, with or without a deposit', async () => {
    const db = fixtures();
    Object.assign(db.jobs['1'], { phase: 'final_payment_needed', paymentStatus: 'unpaid' });
    const page = await open(db);
    await page.evaluate(async (keys) => { state.tokens = keys; await loadBatches(true); state.clientTab = 'jobs'; render(); }, keysFor(db, 'jane@example.com'));
    const total = await page.evaluate(() => orderSum(state.batches.find(b => b.id === '1')));
    const card = await page.textContent('#order-1');
    assert(card.includes(`Pay the rest and shipping deposit, $${(total + 15).toFixed(2)}`) && /\$1\.00 for packaging and \$14\.00 toward postage/.test(card), card);
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
