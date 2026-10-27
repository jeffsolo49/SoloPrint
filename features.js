// More SoloPrint features, loaded after app.js and using its helpers:
//   customers: vacation notice, "Order again", leftover-roll balances, finished-print photos, reviews
//   owner:     private order notes, finished-print photos, review approvals, filament stock (Filament tab),
//              profit and tax report (Money tab)
//   phone:     install the site as an app
// Private owner data (notes, stock, expenses) lives in owner_private (supabase/owner-tools.sql), which
// customers can't read. Customer reviews arrive through the submit_review RPC.

// ── VACATION MODE ─────────────────────────────────────────────────────────
function renderVacationBanner() {
  const text = vacationText(state.settings.vacation);
  return text ? `<div class="vacation-banner" role="status"><strong>Away for now.</strong> ${esc(text)}</div>` : '';
}

function renderVacationSettings(d) {
  const v = d.vacation || {};
  return `<div class="card">
    <h3 class="card-title">Vacation mode</h3>
    <label class="special-order-check" style="font-size:14px;"><input type="checkbox" id="vacation-on" ${v.on ? 'checked' : ''} onchange="state.settingsDraft.vacation = { ...(state.settingsDraft.vacation || {}), on: this.checked }; render();" /> I'm away: tell customers I'll review requests when I'm back</label>
    <div class="row2">
      <div class="field">
        <label for="vacation-until">Back on</label>
        <input type="text" id="vacation-until" value="${esc(v.until || '')}" placeholder="e.g. Monday, Nov 3" maxlength="60" oninput="state.settingsDraft.vacation = { ...(state.settingsDraft.vacation || {}), until: this.value }" />
      </div>
      <div class="field">
        <label for="vacation-message">Message (optional)</label>
        <input type="text" id="vacation-message" value="${esc(v.message || '')}" placeholder="Leave blank to use the default" maxlength="300" oninput="state.settingsDraft.vacation = { ...(state.settingsDraft.vacation || {}), message: this.value }" />
      </div>
    </div>
    <div class="field-help">Customers can still send requests. While this is on, the home page shows: "${esc(vacationText({ ...v, on: true }))}", and the request-received email says the same.</div>
  </div>`;
}

// ── PRICES, RULES AND WORDING (Site Settings) ─────────────────────────────
// Everything here is saved in site settings, so changing a price or wording never needs a code change.
const RULE_FIELDS = [
  ['Prices', [
    ['baseFee', 'Base fee per print ($)', 0.5],
    ['minuteRate', 'Print time ($ per minute)', 0.001, m => `$${(m * 60).toFixed(2)} per hour`],
    ['gramRate', 'Filament, regular colors ($ per gram)', 0.001, g => `$${(g * 1000).toFixed(2)} per kg`],
    ['specialGramRate', 'Filament, special colors ($ per gram)', 0.001, g => `$${(g * 1000).toFixed(2)} per kg`],
    ['depositPercent', 'Deposit customers can pay first (% of the total, 0 = none)', 5]
  ]],
  ['Special order rolls', [
    ['rollCost', 'Usual roll price ($)', 1],
    ['rollGrams', 'Roll size (g)', 50],
    ['rollMonths', 'Leftover stays theirs for (months)', 1]
  ]],
  ['Reminders and stock', [
    ['quoteReminderDays', 'Quote reminder after (days with no answer)', 1],
    ['reviewRequestDays', 'Ask for a review (days after delivery)', 1],
    ['rollReminderDays', 'Leftover roll reminder (days before it expires)', 1],
    ['draftReminderDays', 'Unfinished request reminder (days after they stop)', 1],
    ['lowStockGrams', 'Warn when a color is down to (g)', 50]
  ]],
  ['Order queue (the wait customers are told)', [
    ['printDaysMin', 'Days to print an existing design, at least', 1],
    ['printDaysMax', 'Days to print an existing design, at most', 1],
    ['customDesignDays', 'Extra days to design a custom order', 1]
  ]]
];

function renderRulesSettings(d) {
  const draft = d.rules || {};
  const rules = shopRules(d);
  return `<div class="card">
    <h3 class="card-title">Prices and rules</h3>
    <p class="field-help" style="margin-top:0;">Leave a box blank to use the default shown. Quotes already sent keep the prices they were sent with.</p>
    ${RULE_FIELDS.map(([group, fields]) => `
      <div class="owner-order-summary-label" style="margin-top:12px;">${esc(group)}</div>
      <div class="rules-grid">
        ${fields.map(([key, label, step, hint]) => `<div class="field">
          <label for="rule-${key}">${esc(label)}</label>
          <input type="number" id="rule-${key}" min="0" step="${step}" value="${esc(draft[key] ?? '')}" placeholder="${RULE_DEFAULTS[key]}" oninput="updateRuleDraft('${key}', this.value)" />
          ${hint ? `<div class="field-help" id="rule-hint-${key}">${esc(hint(rules[key]))}</div>` : ''}
        </div>`).join('')}
      </div>`).join('')}
    <div class="field" style="max-width:320px;">
      <label for="rule-venmo">Venmo username</label>
      <input type="text" id="rule-venmo" value="${esc(draft.venmo || '')}" placeholder="${esc(RULE_DEFAULTS.venmo)}" maxlength="31" oninput="updateRuleDraft('venmo', this.value)" />
    </div>
    <div class="price-preview-box" id="rules-example" aria-live="polite">${esc(rulesExample(rules))}</div>
  </div>`;
}

function rulesExample(rules) {
  const regular = printPrice(90, 20, 'color', rules), special = printPrice(90, 20, 'special', rules);
  return `Example: a 1h 30m print using 20 g costs $${regular.toFixed(2)} in a regular color, or $${special.toFixed(2)} in a special color.`;
}

function updateRuleDraft(key, value) {
  state.settingsDraft.rules = { ...(state.settingsDraft.rules || {}), [key]: value };
  const rules = shopRules(state.settingsDraft);
  const example = document.getElementById('rules-example');
  if (example) example.textContent = rulesExample(rules);
  RULE_FIELDS.forEach(([, fields]) => fields.forEach(([k, , , hint]) => {
    const el = document.getElementById(`rule-hint-${k}`);
    if (el && hint) el.textContent = hint(rules[k]);
  }));
}

function renderWordingSettings(d) {
  const steps = d.howItWorks && d.howItWorks.length ? d.howItWorks : DEFAULT_HOW_IT_WORKS.map(s => ({ ...s }));
  if (!d.howItWorks || !d.howItWorks.length) d.howItWorks = steps;
  return `<div class="card">
    <h3 class="card-title">Wording</h3>
    <div class="field">
      <label for="material-note">Material note (on the request form, design pages and quotes)</label>
      <input type="text" id="material-note" value="${esc(d.materialNote || '')}" placeholder="${esc(DEFAULT_MATERIAL_NOTE)}" maxlength="200" oninput="state.settingsDraft.materialNote = this.value" />
    </div>
    <div class="field">
      <label for="gallery-note">Past work note (on the Past Work page and each design)</label>
      <input type="text" id="gallery-note" value="${esc(d.galleryNote || '')}" placeholder="${esc(DEFAULT_GALLERY_NOTE)}" maxlength="200" oninput="state.settingsDraft.galleryNote = this.value" />
    </div>
    <div class="owner-order-summary-label">"How it works" on the home page</div>
    ${steps.map((step, n) => `<div class="row2 how-edit">
      <div class="field"><label for="how-title-${n}">Step ${n + 1}</label><input type="text" id="how-title-${n}" maxlength="80" value="${esc(step.title)}" oninput="state.settingsDraft.howItWorks[${n}].title = this.value" /></div>
      <div class="field"><label for="how-text-${n}">Details</label><input type="text" id="how-text-${n}" maxlength="300" value="${esc(step.text)}" oninput="state.settingsDraft.howItWorks[${n}].text = this.value" /></div>
    </div>`).join('')}
    <button type="button" class="btn-sm" onclick="state.settingsDraft.howItWorks = DEFAULT_HOW_IT_WORKS.map(s => ({ ...s })); render();">Reset steps to default</button>
    <div class="field" style="margin-top:14px;">
      <label for="design-terms">Custom design terms</label>
      <div class="field-help">Shown when a customer approves a quote that includes a custom design; they must tick "I agree" first. Each quote keeps the wording it was sent with.</div>
      <textarea id="design-terms" rows="10" maxlength="4000" oninput="state.settingsDraft.designTerms = this.value">${esc(savedDesignTerms(d.designTerms) || DEFAULT_DESIGN_TERMS)}</textarea>
      <button type="button" class="btn-sm" onclick="state.settingsDraft.designTerms = ''; render();">Reset terms to default</button>
    </div>
  </div>`;
}

// ── ORDER AGAIN ───────────────────────────────────────────────────────────
// Copies a past order into the request form: same items, quantities, colors and notes.
function orderAgain(id) {
  const b = state.batches.find(x => x.id === id);
  if (!b) return;
  const stocked = new Set(customerColors().map(c => c.id));
  state.clientName = b.clientName || state.clientName;
  state.clientEmail = b.clientEmail || state.clientEmail;
  state.draftItems = b.items.map(old => {
    const it = cleanItem(old);
    const item = {
      ...blankItem(), name: it.name, link: it.link, notes: it.notes, qty: it.qty, grams: it.grams,
      imageLinks: it.imageLinks, previewImage: it.previewImage, mode: it.mode || inferMode(it),
      filType: it.filType, color: it.color, colorId: it.colorId, specialColor: it.specialColor, mainParts: it.mainParts,
      extraColors: it.extraColors.filter(p => p.filType !== 'leftover' && (!p.colorId || stocked.has(p.colorId)))
    };
    if (item.colorId && !stocked.has(item.colorId)) { item.colorId = ''; item.color = ''; item.filType = 'black'; }
    if (it.minutes) { item.printHours = hoursFromMinutes(it.minutes); item.printMinutes = minuteRemainder(it.minutes); }
    return item;
  });
  state.clientTab = 'submit';
  render();
  queueDraftSave();
  document.querySelector('.section-title')?.closest('.section-header')?.nextElementSibling?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  showAlert('submit-ok', 'Your past order is filled in below. Check it over, change anything you like, then send it.', 'success');
}

function renderCustomerOrderExtras(b) {
  const delivered = (b.phase || 'estimate') === 'delivered';
  return `<div class="order-extras">
    ${featureOn('orderAgain') ? `<button type="button" class="btn-sm" onclick="orderAgain('${esc(b.id)}')">Order again</button>` : ''}
    ${delivered ? `<button type="button" class="btn-sm" onclick="openReviewForm('${esc(b.id)}')">Leave a review</button>` : ''}
  </div>`;
}

// ── SAVED DRAFTS ──────────────────────────────────────────────────────────
// Once a customer has typed an email, their unsent request is saved (request_drafts, see
// supabase/drafts.sql). If they don't send a request, the daily email job sends one reminder with a
// link back (?resume=<id>) after the number of days set in Prices and rules.
let serverDraftTimer = null;
function draftHasContent(items) {
  return (items || []).some(it => hasModeContent(it) || Object.keys(it.modeDrafts || {}).length);
}
function queueServerDraft(items) {
  const email = String(state.clientEmail || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !draftHasContent(items)) return;
  clearTimeout(serverDraftTimer);
  serverDraftTimer = setTimeout(() => {
    const data = { items: items.map(it => ({ ...cleanItem(it), mode: it.mode, printHours: cleanText(it.printHours, 6), printMinutes: cleanText(it.printMinutes, 6) })) };
    supaFetch('/rpc/save_request_draft', { method: 'POST', body: JSON.stringify({ p_email: email, p_name: String(state.clientName || '').trim().slice(0, 120), p_data: data }) })
      .catch(() => {});   // the browser copy is still saved; this one is only for the reminder email
  }, 3000);
}
function clearServerDraft(email) {
  clearTimeout(serverDraftTimer);
  supaFetch('/rpc/clear_request_draft', { method: 'POST', body: JSON.stringify({ p_email: email }) }).catch(() => {});
}
function handleResumeLink() {
  const params = new URLSearchParams(location.search);
  const id = String(params.get('resume') || '');
  if (!id) return '';
  params.delete('resume');
  history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash);
  state.view = 'client';
  state.clientTab = 'submit';
  return /^[0-9a-f-]{36}$/i.test(id) ? id : '';
}
async function loadServerDraft(id) {
  try {
    const d = await supaFetch('/rpc/get_request_draft', { method: 'POST', body: JSON.stringify({ p_id: id }) });
    const items = (d && d.data && Array.isArray(d.data.items) ? d.data.items : []).slice(0, MAX_ITEMS)
      .map(it => ({ ...cleanItem(it), mode: ['link', 'idea', 'gallery'].includes(it.mode) ? it.mode : '', printHours: cleanText(it.printHours, 6), printMinutes: cleanText(it.printMinutes, 6) }));
    if (!items.length) return;
    state.draftItems = items;
    state.clientName = cleanText(d.name, 120);
    state.clientEmail = cleanText(d.email, 200);
    state.resumedDraft = true;
    saveDraft();
  } catch (e) { /* link expired or drafts not set up: start fresh */ }
}

// ── BEST SELLERS FOR THE HOME PAGE ────────────────────────────────────────
// Customers can't see orders, so when the owner's dashboard loads, the site counts how many of each past
// design were sold (confirmed orders) and saves the top 5 design ids in site settings (topWork).
function galleryBestSellers(batches, gallery) {
  const sold = {};
  batches.filter(b => isSoldPhase(b.phase)).forEach(b => b.items.forEach(it => {
    const g = gallery.find(x => x.id === it.galleryId) || (it.mode === 'gallery' && gallery.find(x => x.title && x.title === it.name));
    if (g) sold[g.id] = (sold[g.id] || 0) + (Number(it.qty) || 1);
  }));
  return Object.keys(sold).sort((a, b) => sold[b] - sold[a]).slice(0, 5);
}

async function syncTopWork() {
  try {
    if (!state.ownerUnlocked || !getOwnerToken()) return;
    if (!state.settingsLoaded) await loadSettings();
    if (!state.settingsLoaded) return;
    if (!state.galleryLoaded) await loadGallery();
    const ids = galleryBestSellers(state.batches, state.gallery.filter(g => g.published));
    if (JSON.stringify(ids) === JSON.stringify(state.settings.topWork || [])) return;
    await saveSettings({ ...state.settings, topWork: ids });
  } catch (e) { /* the home page falls back to the newest designs */ }
}

// ── ORDER QUEUE ───────────────────────────────────────────────────────────
// How far back in line an order is and about how many days until it's printed. Customers get the line
// from supabase order_queue() (no details of other orders); the owner builds it from their own orders.
async function loadQueue() {
  try {
    const q = await supaFetch('/rpc/order_queue', { method: 'POST', body: '{}' });
    state.queue = Array.isArray(q) ? q : null;
  } catch (e) {
    state.queue = null;   // queue.sql not run yet: the queue just isn't shown
  }
}
// Same as order_queue() in supabase/queue.sql: place in line = when the deposit (or full payment) came in.
function queueFromOrders(batches) {
  return batches.filter(b => ['order_received', 'production'].includes(b.phase))
    .map(b => ({ at: queueTime(b) || null, printing: b.phase === 'production', custom: orderIsCustom(b) }))
    .sort((a, b) => (a.at ? 0 : 1) - (b.at ? 0 : 1) || String(a.at).localeCompare(String(b.at)));
}
function draftIsCustom() { return state.draftItems.some(it => inferMode(it) === 'idea' && hasModeContent(it)); }

function renderQueueNotice() {
  if (!featureOn('queue')) return '';
  if (!Array.isArray(state.queue)) return '';
  const rules = currentRules(), custom = draftIsCustom();
  const q = queueEstimate(state.queue, rules, '', custom);
  return `<div class="queue-note" id="queue-note" role="status">
    <strong>Current wait:</strong> ${aheadText(q.ahead)}. Once your quote is approved, expect your order to be printed in ${daysText(q.minDays, q.maxDays)}.
    ${custom ? `Custom designs take at least ${rules.customDesignDays} days to design, and that's included.` : `Custom designs add at least ${rules.customDesignDays} days for design.`}
  </div>`;
}

function renderOrderQueue(b) {
  if (!featureOn('queue')) return '';
  if (!Array.isArray(state.queue)) return '';
  const rules = currentRules(), custom = orderIsCustom(b);
  if (b.phase === 'order_received') {
    if (!queueTime(b)) {
      const q = queueEstimate(state.queue.filter(e => e.at || e.printing), rules, '', custom);
      return `<div class="queue-note"><strong>Your place in line is set when your deposit comes in.</strong> Right now there ${q.ahead === 1 ? 'is' : 'are'} ${aheadText(q.ahead).replace(' of yours', '')}; after that, expect about ${daysText(q.minDays, q.maxDays).replace(/^about /, '')} to print.</div>`;
    }
    const q = queueEstimate(state.queue, rules, queueTime(b), custom);
    return `<div class="queue-note"><strong>You're #${q.ahead + 1} in line.</strong> Expect it to be printed in ${daysText(q.minDays, q.maxDays)}.</div>`;
  }
  if (b.phase === 'estimate' || (b.phase === 'quote_sent' && !b.customerApprovedAt)) {
    const q = queueEstimate(state.queue, rules, '', custom);
    return `<div class="queue-note"><strong>Current wait:</strong> ${aheadText(q.ahead)}. If you go ahead now, expect it to be printed in ${daysText(q.minDays, q.maxDays)}.</div>`;
  }
  return '';
}

// Null while the order is waiting for its deposit.
function ownerQueuePosition(b) {
  const at = queueTime(b);
  return at ? queueFromOrders(state.batches).filter(e => e.printing || (e.at && String(e.at) < String(at))).length + 1 : null;
}
function renderOwnerQueue() {
  const queue = queueFromOrders(state.batches);
  if (!queue.length) return '';
  const rules = currentRules();
  let min = 0, max = 0;
  queue.forEach(e => { const d = e.printing ? [0, rules.printDaysMax] : orderDays(e.custom, rules); min += d[0]; max += d[1]; });
  const waiting = queue.filter(e => !e.at && !e.printing).length;
  return `<div class="queue-note" style="margin-bottom:1rem;"><strong>Queue:</strong> ${queue.length} confirmed order${queue.length === 1 ? '' : 's'} (${queue.filter(e => e.custom).length} custom), ${daysText(min, max)} of work${waiting ? `; ${waiting} waiting for a deposit` : ''}. Places in line go by when the deposit (or full payment) came in. New customers are told they're behind these.</div>`;
}

// ── LEFTOVER ROLL BALANCES (customer) ─────────────────────────────────────
function customerRolls() {
  const email = colorKey(state.historyEmail);
  const now = new Date();
  return leftoverRolls(state.batches, '', currentRules()).filter(r => r.email === email && r.left > 0 && new Date(r.expiresAt) > now)
    .sort((a, b) => byName({ name: a.color }, { name: b.color }));
}

function renderRollsCard() {
  if (!featureOn('leftoverRolls')) return '';
  const rolls = customerRolls();
  if (!rolls.length) return '';
  return `<div class="card rolls-card">
    <h3 class="card-title">Your leftover rolls</h3>
    <p class="field-help" style="margin-top:0;">Rolls I ordered for your special orders. Use them in another order and you won't pay for material.</p>
    ${rolls.map((r, n) => `<div class="roll-row">
      <div><strong>${esc(r.color)}</strong>: about ${r.left.toFixed(0)} g left, until ${esc(fmtShortDate(r.expiresAt))}</div>
      <button type="button" class="btn-sm" onclick="useRollInNewRequest(${n})">Use it in a new request</button>
    </div>`).join('')}
  </div>`;
}

function useRollInNewRequest(n) {
  const roll = customerRolls()[n];
  if (!roll) return;
  const batch = state.batches.find(b => b.id === roll.orderId);
  state.clientName = (batch && batch.clientName) || state.clientName;
  state.clientEmail = state.historyEmail;
  state.leftoverRolls = customerRolls();
  state.leftoverRollsFor = colorKey(state.historyEmail);
  const empty = state.draftItems.length === 1 && !String(state.draftItems[0].name || state.draftItems[0].link || state.draftItems[0].notes || '').trim();
  const item = { ...blankItem(), mode: 'idea', filType: 'special_order', specialColor: roll.color, useLeftover: true, leftoverFrom: roll.orderId };
  state.draftItems = empty ? [item] : state.draftItems.concat(item);
  state.clientTab = 'submit';
  render();
  queueDraftSave();
  document.getElementById(`notes-${state.draftItems.length - 1}`)?.focus();
}

// ── FINISHED-PRINT PHOTOS ─────────────────────────────────────────────────
function renderFinishedPhotos(b) {
  const photos = b.finishedPhotos || [];
  if (!photos.length) return '';
  return `<div class="finished-photos">
    <div class="owner-order-summary-label">Your finished print</div>
    <div class="finished-photo-row">${photos.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer"><img src="${esc(u)}" alt="Photo of the finished print" loading="lazy" /></a>`).join('')}</div>
  </div>`;
}

async function uploadFinishedPhoto(batchId, files) {
  const b = state.batches.find(x => x.id === batchId);
  const token = getOwnerToken();
  const status = document.getElementById(`finished-status-${batchId}`);
  if (!b || !token || !files || !files.length) return;
  if (status) status.textContent = 'Uploading...';
  try {
    for (const file of Array.from(files).slice(0, 6)) {
      const blob = await resizePhoto(file, 1600);
      const path = `orders/${batchId}-${Date.now()}.jpg`;
      await uploadStoredPhoto(path, blob, token);
      b.finishedPhotos = (b.finishedPhotos || []).concat(GALLERY_PUBLIC_PREFIX + path).slice(-6);
    }
    await upsertBatch(b);
    render();
  } catch (e) {
    if (status) status.textContent = "Couldn't upload. Try a JPG or PNG, and check you're logged in.";
  }
}

async function removeFinishedPhoto(batchId, n) {
  const b = state.batches.find(x => x.id === batchId);
  if (!b || !confirm('Remove this photo from the order?')) return;
  b.finishedPhotos = (b.finishedPhotos || []).filter((_, i) => i !== n);
  await upsertBatch(b);
  render();
}

// Starts a hidden gallery item from the order, then opens it in the Gallery tab to finish and publish.
async function addOrderToGallery(batchId) {
  const b = state.batches.find(x => x.id === batchId);
  if (!b || !(b.finishedPhotos || []).length) return;
  const first = b.items[0] || {};
  const g = {
    id: 'g' + Date.now().toString(36), published: false, sortOrder: 0,
    title: b.items.map(it => it.name).filter(Boolean).join(', ').slice(0, 120) || 'New design',
    description: '', photos: b.finishedPhotos.slice(0, 10),
    filType: first.filType === 'special_order' ? 'special' : (first.filType || 'black'), minutes: first.minutes || null, grams: first.grams || null
  };
  try {
    await writeGalleryItem(g);
    await loadGallery();
    state.ownerTab = 'gallery';
    render();
    editGalleryItem(g.id);
    showAlert('gallery-ok', 'Added as a hidden design. Write a description, then show it on the site.', 'success');
  } catch (e) {
    showAlert(`batch-err-${batchId}`, "Couldn't add it to the gallery. Check you're logged in.", 'error');
  }
}

// ── OWNER EXTRAS ON EACH ORDER CARD ───────────────────────────────────────
function renderOwnerExtras(b) {
  const photos = b.finishedPhotos || [];
  const notesReady = state.ownerPrivate && !state.ownerPrivateError;
  return `<div class="owner-extras">
    <div class="field">
      <label for="owner-note-${b.id}">Private notes (only you see these)</label>
      ${notesReady
        ? `<textarea id="owner-note-${b.id}" rows="2" maxlength="2000" placeholder="e.g. 0.4 nozzle, pickup Saturday" oninput="queueOwnerNote('${esc(b.id)}', this.value)">${esc(ownerNotes()[b.id] || '')}</textarea>
           <div class="field-help" id="owner-note-status-${b.id}" role="status"></div>`
        : `<div class="field-help">${state.ownerPrivateError ? 'Notes need a one-time setup: run supabase/owner-tools.sql in the Supabase SQL Editor.' : 'Loading...'}</div>`}
    </div>
    <div class="field" style="margin-bottom:0;">
      <label for="finished-${b.id}">Finished-print photos</label>
      ${photos.length ? `<div class="finished-photo-row">${photos.map((u, n) => `<span class="finished-thumb"><img src="${esc(u)}" alt="Finished print photo ${n + 1}" loading="lazy" /><button type="button" class="btn-sm danger" onclick="removeFinishedPhoto('${esc(b.id)}', ${n})" aria-label="Remove photo ${n + 1}">✕</button></span>`).join('')}</div>` : ''}
      <input type="file" id="finished-${b.id}" accept="image/*" multiple onchange="uploadFinishedPhoto('${esc(b.id)}', this.files)" />
      <div class="field-help" id="finished-status-${b.id}" role="status">The customer sees these on their order${photos.length ? '' : ', and the first one goes in the "order complete" email'}.</div>
      ${photos.length ? `<button type="button" class="btn-sm" onclick="addOrderToGallery('${esc(b.id)}')">Add to gallery</button>` : ''}
    </div>
  </div>`;
}

// ── PRIVATE OWNER DATA (notes, stock, money) ──────────────────────────────
async function loadOwnerPrivate() {
  try {
    const rows = await supaFetch('/owner_private?select=key,data') || [];
    state.ownerPrivate = {};
    rows.forEach(r => { state.ownerPrivate[r.key] = r.data && typeof r.data === 'object' ? r.data : {}; });
    state.ownerPrivateError = false;
  } catch (e) {
    state.ownerPrivate = state.ownerPrivate || {};
    state.ownerPrivateError = true;
  }
}

async function saveOwnerPrivate(key) {
  await supaFetch('/owner_private', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, data: state.ownerPrivate[key] || {}, updated_at: new Date().toISOString() })
  });
}

function ownerNotes() { return (state.ownerPrivate && state.ownerPrivate.notes) || {}; }

let ownerNoteTimer = null;
function queueOwnerNote(id, value) {
  state.ownerPrivate.notes = { ...ownerNotes(), [id]: String(value).slice(0, 2000) };
  if (!value.trim()) delete state.ownerPrivate.notes[id];
  const status = document.getElementById(`owner-note-status-${id}`);
  if (status) status.textContent = 'Saving...';
  clearTimeout(ownerNoteTimer);
  ownerNoteTimer = setTimeout(async () => {
    try { await saveOwnerPrivate('notes'); if (status) status.textContent = 'Saved'; }
    catch (e) { if (status) status.textContent = "Couldn't save. Check you're logged in."; }
  }, 700);
}

// ── REVIEWS FROM CUSTOMERS ────────────────────────────────────────────────
function openReviewForm(id) {
  state.reviewFor = { id, email: state.historyEmail, sent: false };
  render();
  document.getElementById('review-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderReviewForm() {
  const r = state.reviewFor;
  if (!r) return '';
  const b = state.batches.find(x => x.id === r.id);
  if (!b) return '';
  if (r.sent) return `<div class="card" id="review-card"><div class="alert success" style="display:block;">Thank you for the review! It will show on the site once I've had a look.</div></div>`;
  if ((b.phase || 'estimate') !== 'delivered') return '';
  return `<div class="card" id="review-card">
    <h3 class="card-title">Review: ${esc(orderTitle(b))}</h3>
    <div class="field">
      <span class="field-label" id="review-stars-label">Rating</span>
      <div class="review-stars" role="radiogroup" aria-labelledby="review-stars-label">
        ${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" aria-checked="${r.rating === n}" aria-label="${n} star${n > 1 ? 's' : ''}" class="${(r.rating || 0) >= n ? 'on' : ''}" onclick="state.reviewFor.rating = ${n}; render();">★</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label for="review-name">Your name, as shown on the site</label>
      <input type="text" id="review-name" maxlength="60" value="${esc(r.name ?? firstNameAndInitial(b.clientName))}" oninput="state.reviewFor.name = this.value" />
    </div>
    <div class="field">
      <label for="review-text">Your review</label>
      <textarea id="review-text" rows="4" maxlength="600" placeholder="How did it turn out?" oninput="state.reviewFor.text = this.value">${esc(r.text || '')}</textarea>
    </div>
    <div class="alert error" id="review-err"></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <button type="button" class="btn-primary" id="review-send" style="width:auto;" onclick="sendReview()">Send review</button>
      <button type="button" class="btn-sm" onclick="state.reviewFor = null; render();">Not now</button>
    </div>
  </div>`;
}

function firstNameAndInitial(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : (parts[0] || '');
}

async function sendReview() {
  const r = state.reviewFor;
  const b = state.batches.find(x => x.id === r.id) || {};
  const text = String(r.text || '').trim();
  if (text.length < 3) { showAlert('review-err', 'Please write a few words.', 'error'); return; }
  const btn = document.getElementById('review-send');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
  try {
    await supaFetch('/rpc/submit_review', { method: 'POST', body: JSON.stringify({
      p_job_id: r.id, p_email: r.email || state.historyEmail, p_name: String(r.name ?? firstNameAndInitial(b.clientName)).trim(), p_text: text, p_rating: r.rating || null
    }) });
    state.reviewFor.sent = true;
    render();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Send review'; }
    showAlert('review-err', "Couldn't send your review. Please try again, or just reply to any of my emails.", 'error');
  }
}

// Owner: reviews waiting for approval, shown in Site Settings.
async function loadCustomerReviews() {
  try {
    state.customerReviews = await supaFetch('/customer_reviews?status=eq.new&order=created_at.asc') || [];
    state.customerReviewsError = false;
  } catch (e) {
    state.customerReviews = [];
    state.customerReviewsError = true;
  }
}

function renderReviewApprovals() {
  if (state.customerReviewsError) return `<div class="field-help">Customer reviews need a one-time setup: run supabase/owner-tools.sql in the Supabase SQL Editor.</div>`;
  const list = state.customerReviews || [];
  if (!list.length) return `<div class="field-help">New reviews from customers show up here for you to approve. Customers get a review link by email a week after delivery.</div>`;
  return `<div class="review-approvals">
    <div class="owner-order-summary-label">New from customers (${list.length})</div>
    ${list.map(r => `<div class="review-approval">
      <div>${r.rating ? `<span aria-label="${r.rating} stars">${'★'.repeat(r.rating)}</span> ` : ''}"${esc(r.text)}"${r.name ? ` <span class="field-help">- ${esc(r.name)}</span>` : ''}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="btn-sm" onclick="decideReview('${esc(r.job_id)}', true)">Approve and show</button>
        <button type="button" class="btn-sm danger" onclick="decideReview('${esc(r.job_id)}', false)">Don't show</button>
      </div>
    </div>`).join('')}
  </div>`;
}

async function decideReview(jobId, approve) {
  const r = (state.customerReviews || []).find(x => x.job_id === jobId);
  if (!r) return;
  try {
    if (approve) {
      const reviews = [{ id: settingsId(), name: r.name || '', text: r.text, designId: '' }].concat(state.settings.reviews || []);
      await saveSettings({ ...state.settings, reviews });
      state.settingsDraft = null;
    }
    await supaFetch(`/customer_reviews?job_id=eq.${encodeURIComponent(jobId)}`, {
      method: 'PATCH', headers: { 'Prefer': 'return=minimal' }, body: JSON.stringify({ status: approve ? 'approved' : 'dismissed' })
    });
    state.customerReviews = state.customerReviews.filter(x => x.job_id !== jobId);
    render();
    if (approve) showAlert('settings-ok', 'Review added. It shows on the home page now.', 'success');
  } catch (e) {
    showAlert('settings-err', "Couldn't update that review. Check you're logged in.", 'error');
  }
}

// ── FILAMENT STOCK ────────────────────────────────────────────────────────
// owner_private 'inventory': { [colorId]: { grams, low } }. Grams come off when an order moves to Printing.

function inventory() { return (state.ownerPrivate && state.ownerPrivate.inventory) || {}; }
function stockFor(colorId) { const s = inventory()[colorId]; return s && Number.isFinite(s.grams) ? s : null; }
function lowStockColors() {
  return state.settings.colors.filter(c => { const s = stockFor(c.id); return s && s.grams <= (Number.isFinite(s.low) ? s.low : currentRules().lowStockGrams); });
}
// Colors customers can pick: stocked ones that haven't run out.
function customerColors() { return state.settings.colors.filter(c => !c.outOfStock); }

// Grams each stocked color in an order uses (special order and leftover-roll colors are the customer's own roll).
function orderColorGrams(b) {
  const used = {};
  b.items.forEach(it => itemParts(it).forEach(p => {
    if (p.colorId && !['special_order', 'leftover'].includes(p.filType)) used[p.colorId] = (used[p.colorId] || 0) + partGrams(it, p);
  }));
  return used;
}

// Called when an order moves to Printing (take its grams off) or back to the start (put them back).
async function adjustStockForOrder(b, take) {
  if (!state.ownerPrivate || state.ownerPrivateError) return;
  if (take === !!b.stockTaken) return;
  const inv = { ...inventory() };
  let changed = false;
  Object.entries(orderColorGrams(b)).forEach(([id, grams]) => {
    if (!inv[id] || !Number.isFinite(inv[id].grams)) return;
    inv[id] = { ...inv[id], grams: Math.round((inv[id].grams + (take ? -grams : grams)) * 10) / 10 };
    changed = true;
  });
  b.stockTaken = take;
  if (!changed) return;
  state.ownerPrivate.inventory = inv;
  try { await saveOwnerPrivate('inventory'); await syncOutOfStock(); } catch (e) { /* shown on the Filament tab */ }
}

// Hides colors at 0 g from customers (and shows them again once restocked).
async function syncOutOfStock() {
  let changed = false;
  const colors = state.settings.colors.map(c => {
    const s = stockFor(c.id);
    const out = !!(s && s.grams <= 0);
    if (out !== !!c.outOfStock) changed = true;
    return { ...c, outOfStock: out };
  });
  if (changed) { await saveSettings({ ...state.settings, colors }); state.settingsDraft = null; }
}

function renderStockAlerts() {
  const low = lowStockColors();
  if (!low.length) return '';
  return `<div class="alert error stock-alert" style="display:block;" role="status">
    <strong>Running low:</strong> ${low.map(c => `${esc(c.name)} (${Math.max(0, stockFor(c.id).grams).toFixed(0)} g${stockFor(c.id).grams <= 0 ? ', hidden from customers' : ''})`).join(', ')}.
    <button type="button" class="btn-sm" onclick="setOwnerTab('filament')">Update stock</button>
  </div>`;
}

// Settings -> Filament & colors: how much of each color is on hand (saved as soon as it's changed).
function renderStockCard() {
  const colors = state.settings.colors;
  return `
    <h3 class="card-title" style="margin-top:1.5rem;">Stock on hand</h3>
    <div class="field-help" style="margin-bottom:8px;">Saved as soon as you change it. Grams come off when an order moves to Printing.</div>
    ${state.ownerPrivateError ? `<div class="alert error" style="display:block;">Filament stock needs a one-time setup: run supabase/owner-tools.sql in the Supabase SQL Editor.</div>` : ''}
    <div class="card">
      ${colors.length ? `<div class="stock-table">
        ${colors.map(c => {
          const s = stockFor(c.id);
          const low = s && Number.isFinite(s.low) ? s.low : currentRules().lowStockGrams;
          const status = !s ? 'Not tracked' : s.grams <= 0 ? 'Out: hidden from customers' : s.grams <= low ? 'Running low' : 'OK';
          return `<div class="stock-row">
            <div class="stock-name"><span class="swatch" style="background:${esc(c.hex)}" aria-hidden="true"></span> ${esc(c.name)}
              <span class="stock-status ${!s ? '' : s.grams <= low ? 'bad' : 'ok'}">${status}</span></div>
            <div class="stock-field">
              <label for="stock-${esc(c.id)}">On hand (g)</label>
              <div class="stock-amount">
                <input type="number" id="stock-${esc(c.id)}" min="0" step="1" value="${s ? Math.max(0, s.grams) : ''}" placeholder="Not tracked" onchange="setStock('${esc(c.id)}', this.value)" />
                <button type="button" class="btn-sm" onclick="addRoll('${esc(c.id)}')" aria-label="Add a 1 kg roll of ${esc(c.name)}">+ 1 kg roll</button>
              </div>
            </div>
            <div class="stock-field">
              <label for="stock-low-${esc(c.id)}">Warn me at (g)</label>
              <input type="number" id="stock-low-${esc(c.id)}" min="0" step="10" value="${low}" onchange="setLowStock('${esc(c.id)}', this.value)" />
            </div>
          </div>`;
        }).join('')}
      </div>` : `<div class="field-help">Add your colors above (and save) first.</div>`}
      <div class="alert error" id="stock-err"></div>
      <p class="field-help">Leave a color blank to not track it. Special order and leftover-roll colors aren't counted (those rolls are the customer's). Moving an order back to the start puts its grams back.</p>
    </div>`;
}

async function writeStock(id, patch) {
  const inv = { ...inventory() };
  inv[id] = { ...(inv[id] || {}), ...patch };
  if (inv[id].grams === null) delete inv[id];
  state.ownerPrivate = { ...(state.ownerPrivate || {}), inventory: inv };
  try {
    await saveOwnerPrivate('inventory');
    await syncOutOfStock();
    render();
  } catch (e) {
    showAlert('stock-err', "Couldn't save. Check you're logged in, and that supabase/owner-tools.sql has been run.", 'error');
  }
}
function setStock(id, value) { const g = parseFloat(value); writeStock(id, { grams: Number.isFinite(g) && g >= 0 ? g : null }); }
function addRoll(id) { const s = stockFor(id); writeStock(id, { grams: (s ? Math.max(0, s.grams) : 0) + 1000 }); }
function setLowStock(id, value) { const g = parseFloat(value); if (stockFor(id)) writeStock(id, { low: Number.isFinite(g) && g >= 0 ? g : currentRules().lowStockGrams }); }

// ── MONEY: PROFIT AND TAX REPORT ──────────────────────────────────────────
// owner_private 'money': { costPerKg, expenses: [{ id, date: 'YYYY-MM-DD', what, amount }] }.
// Sales count when payment is received; material cost is an estimate from grams and your cost per kg
// (special order rolls count at what you charged for them).
const DEFAULT_COST_PER_KG = 20;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function moneyData() { return (state.ownerPrivate && state.ownerPrivate.money) || {}; }
function costPerKg() { const c = Number(moneyData().costPerKg); return Number.isFinite(c) && c >= 0 ? c : DEFAULT_COST_PER_KG; }
function expenses() { return Array.isArray(moneyData().expenses) ? moneyData().expenses : []; }

function paidDate(b) {
  return b.paidAt || (b.phaseHistory || {}).delivered || (b.phaseHistory || {}).order_received || b.createdAt;
}
function orderMaterialCost(b) {
  const perGram = costPerKg() / 1000;
  let cost = specialOrderCost(b);
  b.items.forEach(it => itemParts(it).forEach(p => {
    if (!['special_order', 'leftover'].includes(p.filType)) cost += partGrams(it, p) * perGram;
  }));
  return cost;
}

function moneyReport(year) {
  const months = MONTH_NAMES.map(name => ({ name, sales: 0, material: 0, expenses: 0, orders: 0 }));
  const orders = [];
  state.batches.forEach(b => {
    if (b.paymentStatus !== 'payment_received') return;
    const d = new Date(paidDate(b));
    if (d.getFullYear() !== year) return;
    const sales = orderSum(b), material = orderMaterialCost(b);
    const m = months[d.getMonth()];
    m.sales += sales; m.material += material; m.orders += 1;
    orders.push({ b, date: d, sales, material });
  });
  const exp = expenses().filter(e => String(e.date).startsWith(String(year)));
  exp.forEach(e => { const mm = Number(String(e.date).slice(5, 7)) - 1; if (months[mm]) months[mm].expenses += Number(e.amount) || 0; });
  const total = months.reduce((t, m) => ({ sales: t.sales + m.sales, material: t.material + m.material, expenses: t.expenses + m.expenses, orders: t.orders + m.orders }), { sales: 0, material: 0, expenses: 0, orders: 0 });
  const unpaid = state.batches.filter(b => ['order_received', 'production', 'delivered'].includes(b.phase) && b.paymentStatus !== 'payment_received');
  return { months, orders: orders.sort((a, b) => a.date - b.date), expenses: exp, total, unpaid };
}

function money2(n) { const v = Number(n) || 0; return `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`; }

function renderOwnerMoneyPage() {
  const years = [...new Set(state.batches.map(b => new Date(paidDate(b)).getFullYear()).concat(expenses().map(e => Number(String(e.date).slice(0, 4))), [new Date().getFullYear()]))]
    .filter(Number.isFinite).sort((a, b) => b - a);
  const year = state.moneyYear || new Date().getFullYear();
  const r = moneyReport(year);
  const today = new Date().toISOString().slice(0, 10);
  return `
    <div class="owner-page-header">
      <div class="section-header">
        <div class="section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
        <div><h2 class="section-title">Money</h2><div class="section-sub">Sales, material cost and expenses by month, with a yearly export for taxes</div></div>
      </div>
    </div>
    ${state.ownerPrivateError ? `<div class="alert error" style="display:block;">Expenses need a one-time setup: run supabase/owner-tools.sql in the Supabase SQL Editor.</div>` : ''}
    <div class="card">
      <div class="money-controls">
        <div class="field" style="margin-bottom:0;">
          <label for="money-year">Year</label>
          <select id="money-year" onchange="state.moneyYear = Number(this.value); render();">${years.map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select>
        </div>
        <div class="field" style="margin-bottom:0;">
          <label for="money-cost">Your filament cost per 1 kg roll ($)</label>
          <input type="number" id="money-cost" min="0" step="0.01" value="${costPerKg()}" onchange="setCostPerKg(this.value)" />
        </div>
        <button type="button" class="btn-sm" onclick="exportMoneyReport(${year})">Download ${year} for taxes (Excel)</button>
      </div>
      <div class="stats-row money-stats">
        <div class="stat-card"><div class="stat-val">${money2(r.total.sales)}</div><div class="stat-label">Sales (paid)</div></div>
        <div class="stat-card"><div class="stat-val">${money2(r.total.material)}</div><div class="stat-label">Material used (est.)</div></div>
        <div class="stat-card"><div class="stat-val">${money2(r.total.sales - r.total.material)}</div><div class="stat-label">Profit after material</div></div>
        <div class="stat-card"><div class="stat-val">${money2(r.total.expenses)}</div><div class="stat-label">Expenses</div></div>
        <div class="stat-card"><div class="stat-val">${money2(r.total.sales - r.total.expenses)}</div><div class="stat-label">Sales minus expenses</div></div>
      </div>
      ${r.unpaid.length ? `<p class="field-help">Not paid yet: ${r.unpaid.length} order${r.unpaid.length === 1 ? '' : 's'}, ${money2(r.unpaid.reduce((s, b) => s + orderSum(b), 0))}. These count once you mark them paid.</p>` : ''}
      <div class="table-scroll">
        <table class="money-table">
          <thead><tr><th scope="col">Month</th><th scope="col">Orders</th><th scope="col">Sales</th><th scope="col">Material (est.)</th><th scope="col">Profit after material</th><th scope="col">Expenses</th></tr></thead>
          <tbody>${r.months.map(m => `<tr><th scope="row">${m.name}</th><td>${m.orders || ''}</td><td>${m.sales ? money2(m.sales) : ''}</td><td>${m.material ? money2(m.material) : ''}</td><td>${m.sales ? money2(m.sales - m.material) : ''}</td><td>${m.expenses ? money2(m.expenses) : ''}</td></tr>`).join('')}</tbody>
          <tfoot><tr><th scope="row">Total</th><td>${r.total.orders}</td><td>${money2(r.total.sales)}</td><td>${money2(r.total.material)}</td><td>${money2(r.total.sales - r.total.material)}</td><td>${money2(r.total.expenses)}</td></tr></tfoot>
        </table>
      </div>
    </div>
    <div class="card">
      <h3 class="card-title">Paid orders in ${year}</h3>
      ${r.orders.length ? `<div class="table-scroll"><table class="money-table">
        <thead><tr><th scope="col">Paid</th><th scope="col">Customer</th><th scope="col">Order</th><th scope="col">Sale</th><th scope="col">Material (est.)</th><th scope="col">Profit</th></tr></thead>
        <tbody>${r.orders.map(o => `<tr><td>${o.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td><td>${esc(o.b.clientName)}</td><td>${esc(orderTitle(o.b))}</td><td>${money2(o.sales)}</td><td>${money2(o.material)}</td><td>${money2(o.sales - o.material)}</td></tr>`).join('')}</tbody>
      </table></div>` : `<div class="field-help">No paid orders in ${year} yet.</div>`}
    </div>
    <div class="card">
      <h3 class="card-title">Expenses in ${year}</h3>
      <p class="field-help" style="margin-top:0;">Filament, parts, tools, shipping supplies: anything you bought for the shop.</p>
      <div class="expense-form">
        <div class="field"><label for="exp-date">Date</label><input type="date" id="exp-date" value="${today}" /></div>
        <div class="field" style="flex:2;"><label for="exp-what">What</label><input type="text" id="exp-what" maxlength="120" placeholder="e.g. 3 rolls of Black PLA" /></div>
        <div class="field"><label for="exp-amount">Amount ($)</label><input type="number" id="exp-amount" min="0" step="0.01" /></div>
        <button type="button" class="btn-sm" onclick="addExpense()">Add expense</button>
      </div>
      <div class="alert error" id="money-err"></div>
      ${r.expenses.length ? `<div class="table-scroll"><table class="money-table">
        <thead><tr><th scope="col">Date</th><th scope="col">What</th><th scope="col">Amount</th><th scope="col"><span class="sr-only">Remove</span></th></tr></thead>
        <tbody>${r.expenses.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).map(e => `<tr><td>${esc(e.date)}</td><td>${esc(e.what)}</td><td>${money2(e.amount)}</td><td><button type="button" class="btn-sm danger" onclick="removeExpense('${esc(e.id)}')" aria-label="Remove ${esc(e.what)}">✕</button></td></tr>`).join('')}</tbody>
      </table></div>` : ''}
    </div>`;
}

async function writeMoney(patch) {
  state.ownerPrivate = { ...(state.ownerPrivate || {}), money: { ...moneyData(), ...patch } };
  try { await saveOwnerPrivate('money'); render(); }
  catch (e) { showAlert('money-err', "Couldn't save. Check you're logged in, and that supabase/owner-tools.sql has been run.", 'error'); }
}
function setCostPerKg(value) { const c = parseFloat(value); writeMoney({ costPerKg: Number.isFinite(c) && c >= 0 ? c : DEFAULT_COST_PER_KG }); }
function addExpense() {
  const date = (document.getElementById('exp-date') || {}).value || '';
  const what = String((document.getElementById('exp-what') || {}).value || '').trim();
  const amount = parseFloat((document.getElementById('exp-amount') || {}).value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !what || !Number.isFinite(amount) || amount < 0) {
    showAlert('money-err', 'Fill in the date, what it was, and the amount.', 'error');
    return;
  }
  state.moneyYear = Number(date.slice(0, 4));
  writeMoney({ expenses: expenses().concat({ id: settingsId(), date, what: what.slice(0, 120), amount: Math.round(amount * 100) / 100 }) });
}
function removeExpense(id) {
  if (!confirm('Remove this expense?')) return;
  writeMoney({ expenses: expenses().filter(e => e.id !== id) });
}

function exportMoneyReport(year) {
  const r = moneyReport(year);
  const round = n => Math.round((Number(n) || 0) * 100) / 100;
  const summary = [['Month', 'Orders', 'Sales', 'Material (est.)', 'Profit after material', 'Expenses']]
    .concat(r.months.map(m => [m.name, m.orders, round(m.sales), round(m.material), round(m.sales - m.material), round(m.expenses)]),
      [['Total', r.total.orders, round(r.total.sales), round(r.total.material), round(r.total.sales - r.total.material), round(r.total.expenses)]],
      [[], ['Sales minus expenses', '', round(r.total.sales - r.total.expenses)], ['Filament cost per kg used for estimates', '', costPerKg()]]);
  const orders = [['Paid', 'Order #', 'Customer', 'Email', 'Items', 'Sale', 'Material (est.)', 'Profit']]
    .concat(r.orders.map(o => [o.date.toISOString().slice(0, 10), o.b.id, o.b.clientName, o.b.clientEmail, orderTitle(o.b), round(o.sales), round(o.material), round(o.sales - o.material)]));
  const exp = [['Date', 'What', 'Amount']].concat(r.expenses.map(e => [e.date, e.what, round(e.amount)]));
  if (typeof XLSX === 'undefined') { showAlert('money-err', "The spreadsheet tool didn't load. Check your connection and try again.", 'error'); return; }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(orders), 'Paid orders');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(exp), 'Expenses');
  XLSX.writeFile(wb, `soloprint-${year}-taxes.xlsx`);
}

// ── INSTALL AS AN APP ─────────────────────────────────────────────────────
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}

// ── OWNER: EDIT A REQUEST ─────────────────────────────────────────────────
// While reviewing a request the owner can change anything the customer sent (name, email, items, colors,
// special orders, notes), set their own price per item, and add charges with their own labels. Customers
// see only the label and amount of a charge. Works on a copy until Save, so Cancel throws it away.
function startOwnerEdit(id) {
  const b = state.batches.find(x => x.id === id);
  if (!b) return;
  state.ownerEdit = { id, draft: JSON.parse(JSON.stringify(b)) };
  if (!state.galleryLoaded) loadGallery().then(render);
  render();
  document.getElementById(`order-${id}`)?.scrollIntoView({ block: 'start' });
}
function cancelOwnerEdit() { state.ownerEdit = null; render(); }
function oeDraft() { return state.ownerEdit && state.ownerEdit.draft; }
function oeItem(i) { const d = oeDraft(); return d && d.items[i]; }

// Text boxes save as you type without redrawing (so the keyboard stays open); choices redraw.
function oeSet(field, value) { const d = oeDraft(); if (d) d[field] = value; }
function oeItemSet(i, field, value, redraw) {
  const it = oeItem(i);
  if (!it) return;
  it[field] = value;
  if (redraw) render(); else updateOeEstimate(i);
}
function oeMode(i, mode) {
  const it = oeItem(i);
  if (!it) return;
  it.mode = mode;
  if (mode !== 'gallery') { it.galleryId = ''; it.setPrice = null; }
  render();
}
function oeDesign(i, galleryId) {
  const it = oeItem(i);
  const g = state.gallery.find(x => x.id === galleryId);
  if (!it) return;
  it.galleryId = g ? g.id : '';
  if (g) { it.name = g.title || it.name; it.previewImage = (g.photos || [])[0] || it.previewImage; }
  render();
}
// Value: a color id, 'black'/'white' (no colors set up), or 'special_order'.
function oeColor(i, value) {
  const it = oeItem(i);
  if (!it) return;
  const c = state.settings.colors.find(x => x.id === value);
  if (c) { it.colorId = c.id; it.color = c.name; it.filType = c.special ? 'special' : 'color'; }
  else { it.colorId = ''; it.color = ''; it.filType = ['black', 'white'].includes(value) ? value : 'special_order'; }
  if (it.filType !== 'special_order') { it.useLeftover = false; it.leftoverFrom = ''; }
  render();
}
function oeRolls() {
  const d = oeDraft();
  return d ? leftoverRolls(state.batches, d.id, currentRules()).filter(r => r.email === colorKey(d.clientEmail)) : [];
}
function oeLeftover(i, value) {
  const it = oeItem(i);
  if (!it) return;
  const roll = oeRolls().find(r => r.orderId + '|' + r.key === value);
  it.useLeftover = !!roll;
  it.leftoverFrom = roll ? roll.orderId : '';
  if (roll) it.specialColor = roll.color;
  render();
}
function oeColorChoices() {
  const colors = [...state.settings.colors].sort(byName);
  return colors.length
    ? colors.map(c => ({ value: c.id, name: c.name + (c.special ? ' (special)' : '') + (c.outOfStock ? ' (out of stock)' : ''), part: { name: c.name, filType: c.special ? 'special' : 'color', colorId: c.id } }))
    : ['black', 'white'].map(f => ({ value: f, name: FIL_LABEL[f], part: { name: FIL_LABEL[f], filType: f, colorId: '' } }));
}
function oeAddExtra(i, value) {
  const it = oeItem(i);
  if (!it || !value) return;
  const roll = oeRolls().find(r => 'roll|' + r.orderId + '|' + r.key === value);
  const choice = oeColorChoices().find(c => c.value === value);
  const part = roll ? { name: roll.color, filType: 'leftover', colorId: '', leftoverFrom: roll.orderId } : choice && { ...choice.part, leftoverFrom: '' };
  if (part && !(it.extraColors || []).some(p => sameColorPart(p, part))) it.extraColors = [...(it.extraColors || []), part];
  render();
}
function oeRemoveExtra(i, j) { const it = oeItem(i); if (it) { it.extraColors.splice(j, 1); render(); } }
function oeAddItem() { const d = oeDraft(); if (d) { d.items.push({ ...blankItem(), mode: 'idea' }); render(); } }
function oeRemoveItem(i) {
  const d = oeDraft();
  if (!d || d.items.length < 2) return;
  if (!confirm(`Remove item ${i + 1} (${d.items[i].name || 'Unnamed'}) from this request?`)) return;
  d.items.splice(i, 1);
  render();
}
function oeCharge(j, field, value) { const d = oeDraft(); if (d && d.extraCharges[j]) d.extraCharges[j][field] = value; }
function oeAddCharge() { const d = oeDraft(); if (d) { d.extraCharges = [...(d.extraCharges || []), { label: 'Special costs', amount: '' }]; render(); } }
function oeRemoveCharge(j) { const d = oeDraft(); if (d) { d.extraCharges.splice(j, 1); render(); } }

function renderOwnerEditItem(it, i, count) {
  const mode = inferMode(it);
  const choices = oeColorChoices();
  const current = it.filType === 'special_order' ? 'special_order' : (it.colorId || (choices.find(c => c.value === it.filType) || {}).value || '');
  const rolls = oeRolls();
  const extras = it.extraColors || [];
  const main = itemParts(it)[0];
  const extraChoices = [...choices.filter(c => !sameColorPart(c.part, main)),
    ...rolls.map(r => ({ value: 'roll|' + r.orderId + '|' + r.key, name: `${r.color} (their leftover roll, ${r.left.toFixed(0)} g left)`, part: { name: r.color, filType: 'leftover', leftoverFrom: r.orderId } }))]
    .filter(c => !extras.some(p => sameColorPart(p, c.part)));
  const designs = [...state.gallery].sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  const own = it.ownerPrice === null || it.ownerPrice === undefined ? '' : it.ownerPrice;
  return `<fieldset class="owner-edit-item">
    <legend>Item ${i + 1}</legend>
    <div class="field">
      <label for="oe-mode-${i}">Type</label>
      <select id="oe-mode-${i}" onchange="oeMode(${i}, this.value)">
        <option value="gallery" ${mode === 'gallery' ? 'selected' : ''}>Something from my past work</option>
        <option value="link" ${mode === 'link' ? 'selected' : ''}>Model link</option>
        <option value="idea" ${mode === 'idea' ? 'selected' : ''}>Custom design / idea</option>
      </select>
    </div>
    ${mode === 'gallery' ? `<div class="field">
      <label for="oe-design-${i}">Design</label>
      <select id="oe-design-${i}" onchange="oeDesign(${i}, this.value)">
        <option value="">${state.galleryLoaded ? 'Pick a design' : 'Loading designs...'}</option>
        ${designs.map(g => `<option value="${esc(g.id)}" ${g.id === it.galleryId ? 'selected' : ''}>${esc(g.title || 'Untitled')}${g.price > 0 ? ` ($${Number(g.price).toFixed(2)} set price)` : ''}</option>`).join('')}
      </select>
    </div>` : ''}
    <div class="field">
      <label for="oe-name-${i}">Name</label>
      <input type="text" id="oe-name-${i}" value="${esc(it.name || '')}" maxlength="200" oninput="oeItemSet(${i}, 'name', this.value)" />
    </div>
    <div class="field">
      <label for="oe-link-${i}">Link</label>
      <input type="text" id="oe-link-${i}" value="${esc(it.link || '')}" maxlength="500" placeholder="Optional" oninput="oeItemSet(${i}, 'link', this.value)" />
    </div>
    <div class="field">
      <label for="oe-notes-${i}">Notes</label>
      <textarea id="oe-notes-${i}" oninput="oeItemSet(${i}, 'notes', this.value)">${esc(it.notes || '')}</textarea>
    </div>
    <div class="row2">
      <div class="field">
        <label for="oe-qty-${i}">Quantity</label>
        <input type="number" id="oe-qty-${i}" value="${esc(it.qty || 1)}" min="1" max="999" step="1" oninput="oeItemSet(${i}, 'qty', this.value)" />
      </div>
      <div class="field">
        <label for="oe-grams-${i}">${extras.length ? `Grams: ${esc(main.name || 'first color')}` : 'Grams'} (optional)</label>
        <input type="number" id="oe-grams-${i}" value="${esc(it.grams || '')}" min="0" step="0.1" oninput="oeItemSet(${i}, 'grams', this.value)" />
      </div>
    </div>
    <div class="field" style="max-width:220px;">
      <label for="oe-minutes-${i}">Print time, minutes (optional)</label>
      <input type="number" id="oe-minutes-${i}" value="${esc(it.minutes || it.knownMinutes || '')}" min="0" step="1" oninput="oeItemSet(${i}, 'minutes', this.value)" />
    </div>
    ${(it.designParts || []).length ? renderOePartColors(it, i) : `<div class="field">
      <label for="oe-color-${i}">Color</label>
      <select id="oe-color-${i}" onchange="oeColor(${i}, this.value)">
        ${choices.map(c => `<option value="${esc(c.value)}" ${c.value === current ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        <option value="special_order" ${current === 'special_order' ? 'selected' : ''}>Special order (color or material I don't carry)</option>
      </select>
    </div>
    ${it.filType === 'special_order' ? `<div class="special-order">
      <div class="field">
        <label for="oe-special-${i}">Special order color and material</label>
        <input type="text" id="oe-special-${i}" value="${esc(it.specialColor || '')}" maxlength="60" placeholder="e.g. Red TPU" oninput="oeItemSet(${i}, 'specialColor', this.value)" ${it.useLeftover ? 'readonly' : ''} />
      </div>
      <div class="field" style="margin-bottom:0;">
        <label for="oe-roll-${i}">Roll</label>
        <select id="oe-roll-${i}" onchange="oeLeftover(${i}, this.value)">
          <option value="">Buy a new roll</option>
          ${rolls.map(r => `<option value="${esc(r.orderId + '|' + r.key)}" ${it.useLeftover && it.leftoverFrom === r.orderId && colorKey(it.specialColor) === r.key ? 'selected' : ''}>Their leftover ${esc(r.color)} roll (${r.left.toFixed(0)} g left, until ${esc(fmtShortDate(r.expiresAt))})</option>`).join('')}
          ${it.useLeftover && !rolls.some(r => r.orderId === it.leftoverFrom && r.key === colorKey(it.specialColor)) ? `<option value="keep" selected>Their leftover ${esc(it.specialColor)} roll (not found)</option>` : ''}
        </select>
      </div>
    </div>` : ''}
    <div class="field">
      <div class="owner-order-summary-label">Extra colors (multi-color print)</div>
      ${extras.length ? `<ul class="owner-edit-extras">${extras.map((p, j) => `<li>${esc(p.name)}${p.filType === 'leftover' ? ' (leftover roll)' : p.filType === 'special' ? ' (special)' : ''}
        <button type="button" class="btn-sm" onclick="oeRemoveExtra(${i}, ${j})" aria-label="Remove ${esc(p.name)} from item ${i + 1}">Remove</button></li>`).join('')}</ul>` : '<div class="field-help">None</div>'}
      ${extraChoices.length ? `<label for="oe-extra-${i}" class="sr-only">Add a color to item ${i + 1}</label>
      <select id="oe-extra-${i}" onchange="oeAddExtra(${i}, this.value)">
        <option value="">+ Add a color</option>
        ${extraChoices.map(c => `<option value="${esc(c.value)}">${esc(c.name)}</option>`).join('')}
      </select>` : ''}
    </div>`}
    ${extras.length ? `<div class="field">
      <div class="owner-order-summary-label">Grams for each color (one print)</div>
      <div class="row2">
        ${extras.map((p, j) => `<div class="field" style="margin-bottom:0;"><label for="oe-extra-grams-${i}-${j}">${esc(p.name)} (g)</label>
          <input type="number" id="oe-extra-grams-${i}-${j}" value="${esc(p.grams || '')}" min="0" step="0.1" placeholder="Blank = split evenly" oninput="oeExtraGrams(${i}, ${j}, this.value)" /></div>`).join('')}
      </div>
      <div class="field-help">The Grams box above is then the first color's (${esc(main.name || 'main color')}). Leave these blank to split the Grams box evenly.</div>
    </div>` : ''}
    <div class="field">
      <label for="oe-price-${i}">Your price per print ($)</label>
      <input type="number" id="oe-price-${i}" value="${esc(own)}" min="0" step="0.01" placeholder="Blank = calculate from time and grams" oninput="oeItemSet(${i}, 'ownerPrice', this.value)" />
      <div class="field-help">Optional. Replaces the calculated price for this item. The customer sees only the price.</div>
    </div>
    <div class="price-preview-box" id="oe-est-${i}" aria-live="polite">${renderOeEstimate(it)}</div>
    ${count > 1 ? `<button type="button" class="btn-sm danger" onclick="oeRemoveItem(${i})">Remove item ${i + 1}</button>` : ''}
  </fieldset>`;
}

function renderOwnerEditForm(b) {
  const d = state.ownerEdit.draft;
  const charges = d.extraCharges || [];
  return `<div class="owner-edit" id="owner-edit-${b.id}">
    <div class="card-title">Edit request</div>
    <div class="field-help" style="margin-bottom:10px;">Change anything, then Save. The customer isn't emailed until you send the quote.</div>
    <div class="row2">
      <div class="field">
        <label for="oe-client-name">Customer name</label>
        <input type="text" id="oe-client-name" value="${esc(d.clientName || '')}" maxlength="120" oninput="oeSet('clientName', this.value)" />
      </div>
      <div class="field">
        <label for="oe-client-email">Customer email</label>
        <input type="email" id="oe-client-email" value="${esc(d.clientEmail || '')}" maxlength="200" oninput="oeSet('clientEmail', this.value)" />
      </div>
    </div>
    ${d.items.map((it, i) => renderOwnerEditItem(it, i, d.items.length)).join('')}
    <button type="button" class="btn-sm" onclick="oeAddItem()">+ Add an item</button>
    <fieldset class="owner-edit-item">
      <legend>Added charges</legend>
      <div class="field-help" style="margin-bottom:8px;">Any amount you decide, with your own label (e.g. "Special costs"). The customer sees only the label and amount.</div>
      ${charges.map((c, j) => `<div class="row2 owner-edit-charge">
        <div class="field">
          <label for="oe-charge-label-${j}">Label</label>
          <input type="text" id="oe-charge-label-${j}" value="${esc(c.label || '')}" maxlength="60" oninput="oeCharge(${j}, 'label', this.value)" />
        </div>
        <div class="field">
          <label for="oe-charge-amount-${j}">Amount ($)</label>
          <input type="number" id="oe-charge-amount-${j}" value="${esc(c.amount ?? '')}" min="0" step="0.01" oninput="oeCharge(${j}, 'amount', this.value)" />
        </div>
        <button type="button" class="btn-sm" onclick="oeRemoveCharge(${j})" aria-label="Remove charge ${j + 1}">Remove</button>
      </div>`).join('')}
      ${charges.length < 10 ? `<button type="button" class="btn-sm" onclick="oeAddCharge()">+ Add a charge</button>` : ''}
    </fieldset>
    <div class="alert error" id="owner-edit-err"></div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;">
      <button class="btn-primary" id="owner-edit-save" onclick="saveOwnerEdit()">Save changes</button>
      <button class="btn-secondary" onclick="cancelOwnerEdit()">Cancel</button>
    </div>
  </div>`;
}

// Read-only list of an order's added charges and per-item prices, under its items on the owner card.
function renderOwnerCharges(b) {
  const charges = extraCharges(b);
  if (!charges.length) return '';
  return `<div class="owner-charges">${charges.map(c => `<div class="sub-item"><div style="display:flex;justify-content:space-between;gap:8px;">
    <div class="sub-item-name">${esc(c.label)} <span class="field-help">(added by you)</span></div><div class="sub-item-price">$${c.amount.toFixed(2)}</div></div></div>`).join('')}</div>`;
}

async function saveOwnerEdit() {
  const d = oeDraft();
  if (!d) return;
  const err = msg => showAlert('owner-edit-err', msg, 'error');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(d.clientEmail || '').trim())) return err('Enter a valid customer email.');
  for (let i = 0; i < d.items.length; i++) {
    const it = d.items[i];
    if (inferMode(it) === 'gallery' && !it.galleryId) return err(`Item ${i + 1}: pick a design, or change its type.`);
    if (it.filType === 'special_order' && !String(it.specialColor || '').trim()) return err(`Item ${i + 1}: say which special order color and material.`);
    const own = it.ownerPrice;
    if (own !== '' && own !== null && own !== undefined && !(Number(own) >= 0)) return err(`Item ${i + 1}: your price must be 0 or more, or blank.`);
    it.ownerPrice = own === '' || own === undefined ? null : own === null ? null : Math.round(Number(own) * 100) / 100;
    it.qty = Math.max(1, parseInt(it.qty, 10) || 1);
    it.grams = Number(it.grams) > 0 ? Number(it.grams) : null;
    it.minutes = Number(it.minutes) > 0 ? Math.round(Number(it.minutes)) : null;
  }
  for (const c of d.extraCharges || []) {
    if (c.amount !== '' && !(Number(c.amount) >= 0)) return err('Each charge amount must be 0 or more.');
  }
  d.clientEmail = String(d.clientEmail).trim();
  d.clientName = String(d.clientName || '').trim();
  d.extraCharges = (d.extraCharges || []).filter(c => Number(c.amount) > 0)
    .map(c => ({ label: String(c.label || '').trim() || 'Special costs', amount: Math.round(Number(c.amount) * 100) / 100 }));
  if (d.items.some(it => it.galleryId) && !state.galleryLoaded) await loadGallery();
  d.items.forEach(it => { it.setPrice = ownerSetPrice(it); });
  d.ownerEditedAt = new Date().toISOString();
  const btn = document.getElementById('owner-edit-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  const clean = normalizeBatch(d);
  if (!(await upsertBatch(clean))) { if (btn) { btn.disabled = false; btn.textContent = 'Save changes'; } return; }
  state.batches = state.batches.map(x => x.id === clean.id ? clean : x);
  state.ownerEdit = null;
  render();
}

// ── OWNER CALCULATOR: MORE THAN ONE COLOR ─────────────────────────────────
// The calculator can price a print in several colors, each with its own grams and its own rate.
// Choices: the colors in Site Settings (by id), plus the plain filament types.
function calcChoices() {
  return [...state.settings.colors].sort(byName).map(c => ({ value: c.id, name: c.name + (c.special ? ' (special)' : ''), part: { name: c.name, filType: c.special ? 'special' : 'color', colorId: c.id } }))
    .concat(['black', 'white', 'color', 'special'].map(f => ({ value: f, name: FIL_LABEL[f] + (state.settings.colors.length ? ' (no specific color)' : ''), part: { name: FIL_LABEL[f], filType: f, colorId: '' } })));
}
function calcPart(value) {
  const c = calcChoices().find(x => x.value === value);
  return c ? c.part : { name: 'White', filType: 'white', colorId: '' };
}
function calcColorOptions(selected) {
  return calcChoices().map(c => `<option value="${esc(c.value)}" ${c.value === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}
// The calculator as an item, so it's priced exactly like an order.
function calcItem(calc) {
  const main = calcPart(calc.color || calc.filType);
  return { filType: main.filType, colorId: main.colorId, color: main.colorId ? main.name : '',
    extraColors: (calc.extras || []).map(x => ({ ...calcPart(x.color), grams: Number(x.grams) > 0 ? Number(x.grams) : null })) };
}
function setCalcColor(value) {
  const calc = state.ownerCalculator;
  calc.color = state.settings.colors.some(c => c.id === value) ? value : '';
  updateOwnerCalculatorField('filType', calcPart(value).filType);
}
function renderCalcExtras(calc) {
  calc.extras = calc.extras || [];
  return `<div class="calc-extras">
    ${calc.extras.map((x, j) => `<div class="row2 calc-extra-row">
      <div class="field"><label for="calc-extra-color-${j}">Color ${j + 2}</label>
        <select id="calc-extra-color-${j}" onchange="state.ownerCalculator.extras[${j}].color = this.value; updateOwnerCalculatorField('extras', state.ownerCalculator.extras)">${calcColorOptions(x.color)}</select></div>
      <div class="field"><label for="calc-extra-grams-${j}">Filament (g), color ${j + 2}</label>
        <input type="number" id="calc-extra-grams-${j}" value="${esc(x.grams || '')}" min="0" step="0.1" oninput="state.ownerCalculator.extras[${j}].grams = this.value; updateOwnerCalculatorField('extras', state.ownerCalculator.extras)" /></div>
      <button type="button" class="btn-sm" onclick="state.ownerCalculator.extras.splice(${j}, 1); render();" aria-label="Remove color ${j + 2}">Remove</button>
    </div>`).join('')}
    ${calc.extras.length < 8 ? `<button type="button" class="btn-sm" id="calc-add-color" onclick="state.ownerCalculator.extras.push({ color: calcChoices()[0].value, grams: '' }); render();">+ Add another color</button>` : ''}
  </div>`;
}

// ── DESIGN PARTS: A COLOR FOR EACH PART ───────────────────────────────────
// A past-work design can list its parts (name, grams per print, photo). Customers pick a color for each
// part; parts in the same color are grouped into the item's colors (main color + extraColors with grams),
// so pricing, stock, rolls and emails work as for any multi-color print.
function cleanDesignParts(list, withChoice) {
  return (Array.isArray(list) ? list : []).slice(0, 20).map((p, n) => {
    const part = {
      id: /^[A-Za-z0-9_-]{1,40}$/.test(String(p && p.id)) ? p.id : `p${n + 1}`,
      name: cleanText(p && p.name, 80).trim(),
      grams: Number(p && p.grams) > 0 && Number(p.grams) <= 100000 ? Math.round(Number(p.grams) * 10) / 10 : null,
      photo: safeImageUrl(p && p.photo),
      optional: !!(p && p.optional),   // an add-on the customer can choose; otherwise always included
      price: p && p.optional && Number(p.price) > 0 && Number(p.price) <= 100000 ? Math.round(Number(p.price) * 100) / 100 : null,
      defaultColor: /^[a-z0-9-]{1,40}$/.test(String(p && p.defaultColor)) ? p.defaultColor : '',   // owner's starting color (id or black/white)
      minutes: p && p.optional && Number(p.minutes) > 0 && Number(p.minutes) <= 100000 ? Math.round(Number(p.minutes)) : null   // add-on's extra print time
    };
    if (withChoice) {
      part.colorId = /^[a-z0-9-]{1,40}$/.test(String(p && p.colorId)) ? p.colorId : '';
      part.include = !part.optional || !!(p && p.include);
    }
    return part;
  }).filter(p => p.name);
}

// Choices for a part: in-stock colors (or Black and White with no colors set up), keyed by color id or type.
function partColorChoices() { return stockedColors().map(c => ({ ...c, key: c.colorId || c.filType })); }

// `choices` defaults to the customer's in-stock colors; the owner's edit form passes all colors.
function applyPartColors(item, choicesIn) {
  if (!(item.designParts || []).length) return;
  // Add-on parts count only when the customer chose them; a design with a set price adds their prices.
  const addOns = item.designParts.filter(p => p.optional && p.include);
  if (item.basePrice > 0) item.setPrice = item.basePrice + addOns.reduce((s, p) => s + (p.price || 0), 0);
  if (item.baseMinutes > 0) item.knownMinutes = item.baseMinutes + addOns.reduce((s, p) => s + (p.minutes || 0), 0);
  const parts = item.designParts.filter(p => p.include !== false);
  if (!parts.length) { item.extraColors = []; item.mainParts = ''; return; }
  const choices = choicesIn || partColorChoices();
  // A part with no color (or one that's out of stock now) gets White, else the first regular color.
  const fallback = defaultColor(choices.map(c => ({ ...c, special: c.filType === 'special' })));
  const groups = [];
  parts.forEach(p => {
    let c = choices.find(x => x.key === p.colorId);
    if (!c) { c = fallback; p.colorId = c.key; }
    let g = groups.find(x => x.c.key === c.key);
    if (!g) groups.push(g = { c, names: [], grams: 0 });
    g.names.push(p.optional ? `${p.name} (add-on)` : p.name);
    g.grams += Number(p.grams) || 0;
  });
  const hasGrams = parts.some(p => Number(p.grams) > 0);
  const main = groups[0];
  item.colorId = main.c.colorId || '';
  item.color = main.c.colorId ? main.c.name : '';
  item.filType = main.c.filType;
  item.mainParts = main.names.join(', ');
  if (hasGrams) item.grams = Math.round((groups.length > 1 ? main.grams : groups.reduce((s, g) => s + g.grams, 0)) * 10) / 10;
  item.extraColors = groups.slice(1).map(g => ({ name: g.c.name, filType: g.c.filType, colorId: g.c.colorId || '', leftoverFrom: '',
    grams: hasGrams ? Math.round(g.grams * 10) / 10 : null, parts: g.names.join(', ') }));
}

// A request keeps a copy of its design's parts (it's saved in the customer's draft). Bring that copy up to date
// with the design as it is now (parts added, removed, made optional, new grams, add-on prices), keeping the
// customer's choices. Returns true when something changed.
let partsGalleryRequested = false;
function syncDesignParts(item) {
  if (!item.galleryId || !featureOn('designParts')) return false;
  if (!state.galleryLoaded) {
    if (!partsGalleryRequested) { partsGalleryRequested = true; loadGallery().then(render); }
    return false;
  }
  const g = state.gallery.find(x => x.id === item.galleryId);
  if (!g) return false;
  const old = item.designParts || [];
  const fresh = (g.parts || []).map(p => {
    const was = old.find(o => o.id === p.id);
    return { ...p, colorId: was ? was.colorId : (p.defaultColor || ''), include: !p.optional || !!(was && was.optional && was.include) };
  });
  const base = g.price > 0 ? g.price : null, minutes = g.minutes || null;
  if (JSON.stringify(fresh) === JSON.stringify(old) && item.basePrice === base && item.baseMinutes === minutes) return false;
  if (!fresh.length && old.length) { item.extraColors = []; item.mainParts = ''; }
  item.designParts = fresh;
  item.basePrice = base;
  item.baseMinutes = minutes;
  applyPartColors(item);
  return true;
}

function setPartIncluded(i, k, on) {
  const item = state.draftItems[i];
  if (!item || !item.designParts[k]) return;
  item.designParts[k].include = !!on;
  applyPartColors(item);
  render();
  queueDraftSave();
  document.getElementById(`part-add-${i}-${k}`)?.focus();
}

function setPartColor(i, k, key) {
  const item = state.draftItems[i];
  if (!item || !item.designParts[k]) return;
  item.designParts[k].colorId = key;
  applyPartColors(item);
  render();
  queueDraftSave();
  document.getElementById(`part-color-${i}-${k}`)?.focus();
}

function renderPartColors(item, i) {
  const choices = partColorChoices();
  return `<fieldset class="part-colors">
    <legend>Choose a color for each part</legend>
    <div class="field-help">${esc(materialNote())}</div>
    ${cmRequestPreview(item)}
    ${item.designParts.map((p, k) => `<div class="part-color-row ${p.optional && !p.include ? 'part-off' : ''}">
      ${p.photo ? thumbImg(p.photo, '', 'thumb', 'class="part-thumb"') : '<span class="part-thumb part-thumb-blank" aria-hidden="true"></span>'}
      <div class="field">
        ${p.optional ? `<label class="special-order-check part-add"><input type="checkbox" id="part-add-${i}-${k}" ${p.include ? 'checked' : ''} onchange="setPartIncluded(${i}, ${k}, this.checked)" />
          Add ${esc(p.name)} <span class="field-help">(optional${p.price && item.basePrice > 0 ? `, +$${p.price.toFixed(2)}` : ''}${p.grams ? `, about ${p.grams} g` : ''}${p.minutes ? `, +${fmtTime(p.minutes)}` : ''})</span></label>` : ''}
        ${p.optional && !p.include ? '' : `<label for="part-color-${i}-${k}">${p.optional ? `Color for ${esc(p.name)}` : esc(p.name)}${p.grams && !p.optional ? ` <span class="field-help">(about ${p.grams} g)</span>` : ''}</label>
        <div class="color-pick">${colorDot(p.colorId)}<select id="part-color-${i}-${k}" class="color-select" style="${colorTextStyle(p.colorId)}" onchange="setPartColor(${i}, ${k}, this.value)">
          ${choices.map(c => `<option value="${esc(c.key)}" style="${colorTextStyle(c.key)}" ${c.key === p.colorId ? 'selected' : ''}>${esc(c.name)}${c.filType === 'special' ? ' (special)' : ''}</option>`).join('')}
        </select></div>`}
      </div>
    </div>`).join('')}
    ${renderColorInfo(item)}
    <div class="field-help">Want a color I don't carry for a part? Say so under "Anything you'd like changed?"</div>
  </fieldset>`;
}

// Design page: the parts and their weights.
function renderDesignParts(g) {
  if (!featureOn('designParts')) return '';
  if (!g.parts || !g.parts.length) return '';
  return `<div class="card design-parts">
    <h3 class="card-title">Parts</h3>
    <div class="field-help" style="margin-bottom:10px;">You can pick a color for each part when you request this${g.parts.some(p => p.optional) ? ', and add any optional add-ons' : ''}.</div>
    <div class="design-parts-grid">${g.parts.map(p => `<div class="design-part">
      ${p.photo ? thumbImg(p.photo, p.name, 'thumb') : '<span class="part-thumb-blank" aria-hidden="true"></span>'}
      <div class="design-part-name">${esc(p.name)}</div>
      ${p.optional ? `<div class="gallery-meta"><strong>Optional add-on</strong>${p.price && g.price > 0 ? ` · +$${p.price.toFixed(2)}` : ''}${p.minutes ? ` · +${fmtTime(p.minutes)} print time` : ''}</div>` : ''}
      ${p.grams ? `<div class="gallery-meta">${p.grams} g</div>` : ''}
    </div>`).join('')}</div>
  </div>`;
}

// Owner gallery form: list the parts.
function renderDesignPartsForm(f) {
  f.parts = f.parts || [];
  return `<fieldset class="owner-edit-item">
    <legend>Parts (optional)</legend>
    <div class="field-help" style="margin-bottom:8px;">Break the design into parts so customers can pick a color for each one. Give each part its grams per print and a photo; the estimate prices each color by its parts' grams. Parts are required unless you tick "Optional add-on".</div>
    ${f.parts.map((p, n) => `<div class="part-form-row">
      ${p.photo ? thumbImg(p.photo, '', 'thumb', 'class="part-thumb"') : '<span class="part-thumb part-thumb-blank" aria-hidden="true"></span>'}
      <div class="row2" style="flex:1;min-width:0;">
        <div class="field"><label for="part-name-${n}">Part ${n + 1} name</label>
          <input type="text" id="part-name-${n}" value="${esc(p.name || '')}" maxlength="80" placeholder="e.g. Body" oninput="state.galleryForm.parts[${n}].name = this.value" /></div>
        <div class="field"><label for="part-grams-${n}">Grams</label>
          <input type="number" id="part-grams-${n}" value="${esc(p.grams || '')}" min="0" step="0.1" placeholder="e.g. 40" oninput="state.galleryForm.parts[${n}].grams = this.value" /></div>
        <div class="field"><label for="part-default-${n}">Starting color</label>
          <select id="part-default-${n}" onchange="state.galleryForm.parts[${n}].defaultColor = this.value">
            <option value="">White (default)</option>
            ${(state.settings.colors.length ? [...state.settings.colors].sort(byName).map(c => ({ key: c.id, name: c.name + (c.special ? ' (special)' : '') + (c.outOfStock ? ' (out of stock)' : '') })) : [{ key: 'black', name: 'Black' }])
              .filter(c => c.key !== 'white' && !/^white$/i.test(c.name)).map(c => `<option value="${esc(c.key)}" ${c.key === p.defaultColor ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select></div>
        <label class="special-order-check part-optional"><input type="checkbox" id="part-optional-${n}" ${p.optional ? 'checked' : ''} onchange="state.galleryForm.parts[${n}].optional = this.checked; render();" /> Optional add-on (customers choose whether to add it)</label>
        ${p.optional ? `<div class="field"><label for="part-price-${n}">Add-on price, $ (designs with a set price)</label>
          <input type="number" id="part-price-${n}" value="${esc(p.price || '')}" min="0" step="0.01" placeholder="e.g. 3" oninput="state.galleryForm.parts[${n}].price = this.value" /></div>
        <div class="field"><label for="part-minutes-${n}">Extra print time, minutes</label>
          <input type="number" id="part-minutes-${n}" value="${esc(p.minutes || '')}" min="0" step="1" placeholder="e.g. 25" oninput="state.galleryForm.parts[${n}].minutes = this.value" /></div>` : ''}
      </div>
      <div class="part-form-actions">
        <label class="btn-sm">${p.photo ? 'Change photo' : 'Add photo'}
          <input type="file" accept="image/*" onchange="uploadPartPhoto(${n}, this.files[0]); this.value='';" style="display:none;" /></label>
        ${f.parts.length < 20 ? `<button type="button" class="btn-sm" id="part-copy-${n}" onclick="copyDesignPart(${n})" aria-label="Copy part ${n + 1} as another set">Copy</button>` : ''}
        <button type="button" class="btn-sm danger" onclick="state.galleryForm.parts.splice(${n}, 1); render();" aria-label="Remove part ${n + 1}">Remove</button>
      </div>
    </div>`).join('')}
    <span class="field-help" id="part-upload-status" role="status"></span>
    ${f.parts.length < 20 ? `<button type="button" class="btn-sm" id="add-design-part" onclick="state.galleryForm.parts.push({ id: 'p' + Date.now().toString(36), name: '', grams: '', photo: '' }); render();">+ Add a part</button>` : ''}
    ${f.parts.length ? `<div class="field-help" style="margin-top:6px;">Required parts add up to ${f.parts.filter(p => !p.optional).reduce((s, p) => s + (Number(p.grams) || 0), 0).toFixed(1)} g${f.parts.some(p => p.optional) ? `; add-ons ${f.parts.filter(p => p.optional).reduce((s, p) => s + (Number(p.grams) || 0), 0).toFixed(1)} g more` : ''}.</div>` : ''}
  </fieldset>`;
}

// Another set of a part (e.g. half the racks) that customers color separately: same photo, add-on settings
// and starting color, placed right after it, and in each color idea with the same color as the original.
function copyDesignPart(n) {
  const f = state.galleryForm;
  const p = f && f.parts[n];
  if (!p || f.parts.length >= 20) return;
  const base = String(p.name || 'Part').replace(/\s*\(set \d+\)$/i, '');
  let k = 2;
  while (f.parts.some(x => String(x.name).toLowerCase() === `${base} (set ${k})`.toLowerCase())) k++;
  const copy = { ...p, id: 'p' + Date.now().toString(36), name: `${base} (set ${k})` };
  f.parts.splice(n + 1, 0, copy);
  ((f.colorMap && f.colorMap.combos) || []).forEach(c => { if (c.colors[p.id]) c.colors[copy.id] = c.colors[p.id]; });
  render();
  const s = document.getElementById('part-upload-status');
  if (s) s.textContent = `Added "${copy.name}". Set each set's grams (for example, half each)${f.colorMap ? ', and upload a color ideas picture with this set in its own color' : ''}.`;
  document.getElementById(`part-name-${n + 1}`)?.focus();
}

async function uploadPartPhoto(n, file) {
  const f = state.galleryForm;
  const status = document.getElementById('part-upload-status');
  const token = getOwnerToken();
  if (!f || !f.parts[n] || !file) return;
  if (!token) { if (status) status.textContent = 'Please log in again to upload.'; return; }
  if (status) status.textContent = 'Uploading...';
  try {
    const blob = await resizePhoto(file);
    const thumb = await resizePhoto(file, THUMB_SIDE);
    if (!blob || !thumb) throw new Error('resize failed');
    const path = `${f.id}/part-${Date.now()}.jpg`;
    await uploadStoredPhoto(path, blob, token);
    await uploadStoredPhoto(path.replace(/\.jpg$/, '-thumb.jpg'), thumb, token);
    f.parts[n].photo = GALLERY_PUBLIC_PREFIX + path;
    render();
    const done = document.getElementById('part-upload-status');
    if (done) done.textContent = 'Photo added. Remember to save.';
  } catch (e) {
    console.error('Part photo upload error:', e);
    if (status) status.textContent = /unsupported/.test(e.message) ? "That photo isn't a format this browser can read. Try a JPG or PNG." : "Couldn't upload. Check that you're logged in.";
  }
}

// ── SITE TEXT, FAQ AND FEATURE SWITCHES (Settings) ────────────────────────
// The owner can change the main headings, labels, form questions and the order step names customers see.
// Each change is a draft until it's marked Live; the owner can preview drafts while logged in.
// settings.siteText: { key: { text, live } }. Blank text or not live = the default below.
const SITE_TEXT = [
  ['Home and menu', [
    ['navRequest', 'Menu: request button', 'Request a Quote'],
    ['navRequestSub', 'Menu: request button, small text', 'Start a print or custom design'],
    ['navGallery', 'Menu: past work button (also the past work page title)', 'Previous Design Work'],
    ['navGallerySub', 'Menu: past work button, small text', "See what I've made"],
    ['navJobs', 'Menu: my requests button (also that page title)', 'My Requests'],
    ['navJobsSub', 'Menu: my requests button, small text', 'Track your orders'],
    ['aboutTitle', 'About card heading', 'Hi, welcome to SoloPrint'],
    ['howTitle', '"How it works" heading', 'How it works'],
    ['reviewsTitle', 'Reviews heading', 'What customers say'],
    ['faqTitle', 'FAQ heading', 'Questions'],
  ]],
  ['Request form', [
    ['requestTitle', 'Form heading', 'New Quote Request'],
    ['requestSub', 'Form heading, small text', "Tell me what you'd like printed. Nothing is charged until you approve a quote."],
    ['nameLabel', 'Name and email question', 'Your name and email'],
    ['nameHelp', 'Under name and email', 'Saved as you go, so you can finish later.'],
    ['itemsTitle', 'Items heading', 'Items to print'],
    ['modeQuestion', 'First question', 'What would you like printed?'],
    ['modeGallery', 'Choice 1', 'Something from my past work'],
    ['modeGallerySub', 'Choice 1, small text', 'Pick a design I have made before'],
    ['modeLink', 'Choice 2', 'I have a link'],
    ['modeLinkSub', 'Choice 2, small text', 'A model on MakerWorld, Printables or Thingiverse'],
    ['modeIdea', 'Choice 3', 'I have an idea'],
    ['modeIdeaSub', 'Choice 3, small text', 'Something custom: describe it and I can design it'],
    ['ideaLabel', 'Idea question', 'Describe your idea'],
    ['changesLabel', 'Changes question (link and past work)', "Anything you'd like changed? (optional)"],
    ['addItem', 'Add item button', 'Add another item'],
    ['submitButton', 'Send button', 'Send My Request'],
    ['submitNote', 'Under the send button', "Free to ask. I'll review it and email you a quote"],
  ]],
  ['Past work', [
    ['gallerySub', 'Past work page, small text', 'Designs we\'ve made before, with the story behind each one. Want one? Tap "Request this".'],
    ['requestThis', '"Request this" button', 'Request this'],
    ['colorIdeasTitle', 'Design page: color ideas heading', 'Color ideas'],
    ['colorIdeasNote', 'Design page: under the color ideas heading', 'This design repainted in other colors, to help you choose. Colors on a screen are close, not exact.'],
    ['colorIdeasOwn', 'Design page: button to pick your own colors', 'Pick your own'],
    ['colorIdeasRequest', 'Design page: request button under color ideas', 'Request in these colors'],
    ['colorIdeasYours', 'Request form: under the picture of their colors', 'Your colors on this design. Colors on a screen are close, not exact.'],
  ]],
  ['Order steps customers see', [
    ['step_estimate', 'Step 1 name', 'Request Received'],
    ['stepInfo_estimate', 'Step 1 description', "We've received your request and will respond promptly after reviewing it. Any prices shown are automated estimates, not final costs."],
    ['step_quote_sent', 'Step 2 name', 'Quote Ready'],
    ['stepInfo_quote_sent', 'Step 2 description', "Your quote is ready. Review the price below and tap \"Looks good\" if you'd like to go ahead."],
    ['step_order_received', 'Step 3 name', 'Order Confirmed'],
    ['stepInfo_order_received', 'Step 3 description', 'Your order is confirmed and queued for the printer.'],
    ['step_production', 'Step 4 name', 'Printing'],
    ['stepInfo_production', 'Step 4 description', 'Your parts are on the printer right now.'],
    ['step_final_payment_needed', 'Step 5 name', 'Printing Complete'],
    ['stepInfo_final_payment_needed', 'Step 5 description', 'Your print is done. We need your final payment and shipping address before we send it out.'],
    ['step_delivered', 'Step 6 name', 'Delivered'],
    ['stepInfo_delivered', 'Step 6 description', 'Your order is complete. Enjoy!'],
    ['pay_unpaid', 'Payment: not asked yet', 'Unpaid'],
    ['pay_payment_requested', 'Payment: asked', 'Payment Requested'],
    ['pay_deposit_received', 'Payment: deposit paid', 'Deposit Received'],
    ['pay_payment_received', 'Payment: paid', 'Payment Received'],
  ]]
];
const SITE_TEXT_DEFAULTS = Object.fromEntries(SITE_TEXT.flatMap(([, rows]) => rows.map(([k, , d]) => [k, d])));

// What the owner can switch off. All on unless switched off.
const FEATURE_SWITCHES = [
  ['about', 'About card on the home page'],
  ['recentWork', '"My Work" photos on the home page'],
  ['howItWorks', '"How it works" on the home page'],
  ['reviews', 'Reviews (home page, design pages, and the review form)'],
  ['faq', 'FAQ at the bottom of the home page'],
  ['queue', 'Order queue and wait estimates'],
  ['orderAgain', '"Order again" button'],
  ['leftoverRolls', '"Your leftover rolls" card on My Requests'],
  ['videos', 'Videos on design pages'],
  ['designParts', 'Parts and a color per part on designs'],
  ['colorIdeas', 'Color ideas: design photos repainted in other colors']
];
function featureOn(key) { const f = state.settings.features; return !(f && f[key] === false); }

function previewingDrafts() { return !!(state.previewDrafts && state.ownerUnlocked); }
function t(key) {
  const own = (state.settings.siteText || {})[key];
  if (own && own.text && (own.live || previewingDrafts())) return own.text;
  return SITE_TEXT_DEFAULTS[key] || '';
}
function setPreviewDrafts(on) {
  state.previewDrafts = !!on;
  try { localStorage.setItem('soloprint-preview-drafts', on ? '1' : ''); } catch (e) { /* not kept */ }
  render();
}
function loadPreviewDrafts() { try { state.previewDrafts = localStorage.getItem('soloprint-preview-drafts') === '1'; } catch (e) { state.previewDrafts = false; } }

function cleanSiteText(raw) {
  const out = {};
  Object.keys(SITE_TEXT_DEFAULTS).forEach(k => {
    const v = raw && typeof raw === 'object' && raw[k];
    const text = cleanText(v && v.text, 400).trim();
    if (text) out[k] = { text, live: !!(v && v.live) };
  });
  return out;
}
function cleanFaq(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, 30).map(f => ({
    id: /^[a-z0-9-]{1,40}$/.test(String(f && f.id)) ? f.id : settingsId(),
    q: cleanText(f && f.q, 200).trim(), a: cleanText(f && f.a, 2000).trim(), live: !!(f && f.live)
  })).filter(f => f.q);
}
function cleanFeatures(raw) {
  const out = {};
  FEATURE_SWITCHES.forEach(([k]) => { if (raw && raw[k] === false) out[k] = false; });
  return out;
}

function previewNote() {
  return previewingDrafts() ? `<div class="alert success preview-note" style="display:block;" role="status">You're seeing your drafts (only you can see them). <button class="btn-link" type="button" onclick="setPreviewDrafts(false)">Stop previewing</button></div>` : '';
}
function renderPreviewSwitch() {
  return `<label class="special-order-check" style="font-size:14px;"><input type="checkbox" ${state.previewDrafts ? 'checked' : ''} onchange="setPreviewDrafts(this.checked)" />
    Preview my drafts on the site (only you see them, while you're logged in). Save first.</label>`;
}

// Customer FAQ on the home page (live questions only, or drafts while previewing).
function renderFaq() {
  const list = (state.settings.faq || []).filter(f => f.live || previewingDrafts());
  if (!featureOn('faq') || !list.length) return '';
  return `<div class="card faq">
    <h3 class="card-title">${esc(t('faqTitle'))}</h3>
    ${list.map(f => `<details class="faq-item"><summary>${esc(f.q)}${f.live ? '' : ' <span class="draft-tag">Draft</span>'}</summary><div class="faq-answer">${renderWriteup(f.a)}</div></details>`).join('')}
  </div>`;
}

// A small picture of the customer-facing area a Settings tab or section changes (previews/*.jpg, made by
// tests/make-previews.js with sample content). Tap to see it bigger.
const AREA_PREVIEWS = {
  about: 'the About card on the home page', colors: 'the color choices on the request form', prices: 'the price estimate on the request form',
  wording: '"How it works" on the home page', vacation: 'the notice at the top of the home page', reviews: 'reviews on the home page',
  faq: 'the FAQ at the bottom of the home page', 'text-menu': 'the menu buttons', 'text-form': 'the request form', 'text-gallery': 'the past work page',
  'text-steps': 'an order on My Requests'
};
function areaPreview(name) {
  const where = AREA_PREVIEWS[name];
  if (!where) return '';
  return `<figure class="area-preview">
    <a href="previews/${name}.jpg" target="_blank" rel="noopener"><img src="previews/${name}.jpg" alt="Example of ${esc(where)}" loading="lazy" /></a>
    <figcaption>Where this shows: ${esc(where)} (example)</figcaption>
  </figure>`;
}

// Settings -> Site text.
function renderSiteTextSettings(d) {
  const own = d.siteText = d.siteText || {};
  return `<div class="card">
    <h3 class="card-title">Site text</h3>
    <div class="field-help" style="margin-bottom:10px;">Change any of these. A change is a <strong>draft</strong> (customers still see the original) until you tick <strong>Live</strong> and save. Leave a box blank for the original wording.</div>
    ${renderPreviewSwitch()}
    ${SITE_TEXT.map(([group, rows]) => `<fieldset class="owner-edit-item">
      <legend>${esc(group)}</legend>
      ${areaPreview({ 'Home and menu': 'text-menu', 'Request form': 'text-form', 'Past work': 'text-gallery', 'Order steps customers see': 'text-steps' }[group])}
      ${rows.map(([k, label, def]) => {
        const v = own[k] || {};
        const status = !String(v.text || '').trim() ? 'Original' : v.live ? 'Live' : 'Draft';
        const long = def.length > 60;
        return `<div class="field site-text-row">
          <label for="st-${k}">${esc(label)} <span class="draft-tag ${status === 'Live' ? 'live' : ''}" id="st-status-${k}">${status}</span></label>
          ${long ? `<textarea id="st-${k}" rows="2" maxlength="400" placeholder="${esc(def)}" oninput="siteTextSet('${k}', 'text', this.value)">${esc(v.text || '')}</textarea>`
            : `<input type="text" id="st-${k}" maxlength="400" value="${esc(v.text || '')}" placeholder="${esc(def)}" oninput="siteTextSet('${k}', 'text', this.value)" />`}
          <label class="special-order-check"><input type="checkbox" id="st-live-${k}" ${v.live ? 'checked' : ''} onchange="siteTextSet('${k}', 'live', this.checked)" /> Live</label>
        </div>`;
      }).join('')}
    </fieldset>`).join('')}
  </div>`;
}
function siteTextSet(k, field, value) {
  const own = state.settingsDraft.siteText = state.settingsDraft.siteText || {};
  own[k] = { ...(own[k] || { text: '', live: false }), [field]: value };
  const el = document.getElementById(`st-status-${k}`);
  if (el) {
    const status = !String(own[k].text || '').trim() ? 'Original' : own[k].live ? 'Live' : 'Draft';
    el.textContent = status;
    el.classList.toggle('live', status === 'Live');
  }
}

// Settings -> FAQ.
function renderFaqSettings(d) {
  d.faq = d.faq || [];
  return `<div class="card">
    <h3 class="card-title">FAQ</h3>
    <div class="field-help" style="margin-bottom:10px;">Questions and answers for the home page. Each one stays a <strong>draft</strong> (hidden) until you tick <strong>Live</strong> and save. Leave a blank line between paragraphs.</div>
    ${renderPreviewSwitch()}
    ${d.faq.map((f, n) => `<div class="item-block" style="margin-bottom:10px;">
      <div class="field"><label for="faq-q-${n}">Question ${n + 1}</label>
        <input type="text" id="faq-q-${n}" maxlength="200" value="${esc(f.q || '')}" placeholder="e.g. How long does an order take?" oninput="state.settingsDraft.faq[${n}].q = this.value" /></div>
      <div class="field"><label for="faq-a-${n}">Answer</label>
        <textarea id="faq-a-${n}" maxlength="2000" oninput="state.settingsDraft.faq[${n}].a = this.value">${esc(f.a || '')}</textarea></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <label class="special-order-check" style="margin:0;"><input type="checkbox" id="faq-live-${n}" ${f.live ? 'checked' : ''} onchange="state.settingsDraft.faq[${n}].live = this.checked" /> Live (customers can see it)</label>
        ${n > 0 ? `<button type="button" class="btn-sm" onclick="moveFaq(${n}, -1)" aria-label="Move question ${n + 1} up">Move up</button>` : ''}
        <button type="button" class="btn-sm danger" onclick="state.settingsDraft.faq.splice(${n}, 1); render();" aria-label="Remove question ${n + 1}">Remove</button>
      </div>
    </div>`).join('')}
    ${d.faq.length < 30 ? `<button type="button" class="btn-sm" id="faq-add" onclick="state.settingsDraft.faq.push({ id: settingsId(), q: '', a: '', live: false }); render();">+ Add a question</button>` : ''}
  </div>`;
}
function moveFaq(n, by) {
  const list = state.settingsDraft.faq;
  const [f] = list.splice(n, 1);
  list.splice(n + by, 0, f);
  render();
}

// Settings -> Features.
function renderFeatureSettings(d) {
  d.features = d.features || {};
  return `<div class="card">
    <h3 class="card-title">Show or hide parts of the site</h3>
    <div class="field-help" style="margin-bottom:10px;">Untick anything you don't want customers to see, then save. Nothing is deleted; tick it again to bring it back.</div>
    ${FEATURE_SWITCHES.map(([k, label]) => `<label class="special-order-check feature-switch"><input type="checkbox" id="feature-${k}" ${d.features[k] === false ? '' : 'checked'}
      onchange="state.settingsDraft.features['${k}'] = this.checked ? true : false" /> ${esc(label)}</label>`).join('')}
  </div>`;
}


// ── ESTIMATES EVERYWHERE: per-color lines and designs priced like a request ──
// "White 60 g × $0.024 = $1.44" for each color of an item (one print), using that color's own rate.
function colorLines(item, grams, rules) {
  const each = colorGrams(item, grams);
  return itemParts(item).map((p, n) => {
    const rate = partRate(p, rules);
    const label = p.filType === 'special_order' ? `${p.name || 'Special order'} (special order roll)` : p.filType === 'leftover' ? `${p.name} (their leftover roll)` : (p.name || FIL_LABEL[p.filType] || 'Color');
    return `${label}: ${each[n].toFixed(1)} g × $${rate.toFixed(3)} = $${(each[n] * rate).toFixed(2)}`;
  });
}
function renderColorLines(item, grams, rules) {
  return itemParts(item).length > 1 || (item.colorId && rules.colorRates && typeof rules.colorRates[item.colorId] === 'number')
    ? `<div class="price-breakdown color-lines">${colorLines(item, grams, rules).map(esc).join('\n')}</div>` : '';
}

// A past-work design as a customer would first request it: its own color (else White), each part in its
// starting color, add-ons left off. Used for the price shown on the gallery and in the owner's design form.
// `colors` ({ partId: colorKey }, optional): the colors a customer picked under Color ideas.
function designEstimateItem(g, colors) {
  const item = { ...blankItem(), ...galleryItemFields(g), mode: 'gallery' };
  if (colors) item.designParts.forEach(p => { if (colors[p.id]) p.colorId = colors[p.id]; });
  if ((item.designParts || []).length) applyPartColors(item); else ensureItemColor(item);
  return item;
}
function designEstimate(g, colors) {
  if (g.price > 0) return g.price;
  const item = designEstimateItem(g, colors);
  return g.minutes && Number(item.grams) > 0 ? calcPerPrint(g.minutes, item.grams, item) : null;
}

// Owner's edit form: the price for one item with today's prices (an order being reviewed has no saved prices yet).
function renderOeEstimate(it) {
  const d = oeDraft();
  const rules = rulesFor(d || {});
  const fixed = fixedPrice({ ...it, setPrice: ownerSetPrice(it) });
  const qty = Math.max(1, parseInt(it.qty, 10) || 1);
  if (fixed !== null) return `<div class="price-big">$${(fixed * qty).toFixed(2)}</div><div class="field-help">Fixed price: $${fixed.toFixed(2)} each${qty > 1 ? ` × ${qty}` : ''}.</div>`;
  const minutes = Number(it.minutes) || Number(it.knownMinutes) || 0;
  const grams = Number(it.grams) || 0;
  if (!minutes || !grams) return `<div class="field-help">Add print time and grams to see the price.</div>`;
  const per = printPrice(minutes, grams, it, rules);
  return `<div class="price-big">$${(per * qty).toFixed(2)}</div>
    <div class="field-help">$${per.toFixed(2)} each${qty > 1 ? ` × ${qty}` : ''} · ${fmtTime(minutes)} · today's prices, including each color's own price per gram${usesSpecialSpool(it) ? ' (plus the special order roll)' : ''}.</div>
    ${renderColorLines(it, grams, rules)}`;
}
function updateOeEstimate(i) {
  const it = oeItem(i);
  const el = document.getElementById(`oe-est-${i}`);
  if (it && el) el.innerHTML = renderOeEstimate(it);
}
// Owner's colors for parts (all colors, in stock or not), in the same shape as partColorChoices.
function ownerPartChoices() {
  return oeColorChoices().map(c => ({ key: c.value, name: c.part.name, colorId: c.part.colorId, filType: c.part.filType, hex: '' }));
}
function oePartColor(i, k, key) {
  const it = oeItem(i);
  if (!it || !it.designParts[k]) return;
  it.designParts[k].colorId = key;
  applyPartColors(it, ownerPartChoices());
  render();
}
function oePartInclude(i, k, on) {
  const it = oeItem(i);
  if (!it || !it.designParts[k]) return;
  it.designParts[k].include = !!on;
  applyPartColors(it, ownerPartChoices());
  render();
}
function oeExtraGrams(i, j, value) {
  const it = oeItem(i);
  if (!it || !it.extraColors[j]) return;
  it.extraColors[j].grams = Number(value) > 0 ? Number(value) : null;
  updateOeEstimate(i);
}
function renderOePartColors(it, i) {
  const choices = ownerPartChoices();
  return `<div class="field">
    <div class="owner-order-summary-label">Parts (this design's colors come from its parts)</div>
    ${it.designParts.map((p, k) => `<div class="part-color-row">
      ${p.photo ? thumbImg(p.photo, '', 'thumb', 'class="part-thumb"') : ''}
      <div class="field">
        ${p.optional ? `<label class="special-order-check part-add"><input type="checkbox" id="oe-part-add-${i}-${k}" ${p.include ? 'checked' : ''} onchange="oePartInclude(${i}, ${k}, this.checked)" /> Include add-on: ${esc(p.name)}</label>` : ''}
        ${p.optional && !p.include ? '' : `<label for="oe-part-color-${i}-${k}">${esc(p.name)}${p.grams ? ` (${p.grams} g)` : ''}</label>
        <div class="color-pick">${colorDot(p.colorId)}<select id="oe-part-color-${i}-${k}" class="color-select" style="${colorTextStyle(p.colorId)}" onchange="oePartColor(${i}, ${k}, this.value)">
          ${choices.map(c => `<option value="${esc(c.key)}" style="${colorTextStyle(c.key)}" ${c.key === p.colorId ? 'selected' : ''}>${esc(c.name)}${c.filType === 'special' ? ' (special)' : ''}</option>`).join('')}
        </select></div>`}
      </div>
    </div>`).join('')}
  </div>`;
}

// ── BACK TO TOP (phones) ──────────────────────────────────────────────────
// A small arrow in the corner once you've scrolled down a long page. It sits outside the redrawn page,
// so it's made once; only shown on narrow screens (styles.css).
function setupBackToTop() {
  if (document.getElementById('back-to-top')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'back-to-top';
  btn.className = 'back-to-top';
  btn.setAttribute('aria-label', 'Back to top');
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  btn.onclick = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.getElementById('main')?.focus({ preventScroll: true });
  };
  document.body.appendChild(btn);
  const update = () => btn.classList.toggle('show', window.scrollY > 600);
  window.addEventListener('scroll', update, { passive: true });
  update();
}

// ── COLOR PREVIEW PHOTOS ─────────────────────────────────────────────────
// A design can have a photo where every part is a different flat color (a slicer or CAD render works well).
// The owner's browser finds those color regions once; each region is linked to a part. Customers then see
// the photo repainted in any colors, keeping each face's light and dark so it still looks like the photo.

function cmLab(r, g, b) {
  const lin = v => { v /= 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; };
  const R = lin(r), G = lin(g), B = lin(b);
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047), y = f(R * 0.2126 + G * 0.7152 + B * 0.0722), z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
// How different two colors look, forgiving shading: a colored part's lit and shaded faces share a hue,
// so for two colored pixels the hue counts most; grays are told apart by lightness.
function cmDistance(p, q) {
  const cp = Math.hypot(p[1], p[2]), cq = Math.hypot(q[1], q[2]);
  if (cp > 14 && cq > 14) {
    let dh = Math.abs(Math.atan2(p[2], p[1]) - Math.atan2(q[2], q[1])) * 180 / Math.PI;
    if (dh > 180) dh = 360 - dh;
    return dh * 0.7 + Math.abs(p[0] - q[0]) * 0.12 + Math.abs(cp - cq) * 0.08;
  }
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
function cmHex(rgb) { return '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join(''); }
function cmRgb(hex) { const n = parseInt(String(hex).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

// Finds the photo's color regions: [{ hex, share }], biggest first. `img` is { data, width, height } (RGBA).
function findColorRegions(img, detail) {
  const limit = detail === 'more' ? 6 : 10;
  const bins = new Map();
  const step = Math.max(1, Math.floor(Math.sqrt(img.width * img.height / 120000)));
  let total = 0;
  for (let y = 0; y < img.height; y += step) for (let x = 0; x < img.width; x += step) {
    const i = (y * img.width + x) * 4;
    if (img.data[i + 3] < 128) continue;
    const key = (img.data[i] >> 2) << 12 | (img.data[i + 1] >> 2) << 6 | (img.data[i + 2] >> 2);
    bins.set(key, (bins.get(key) || 0) + 1);
    total++;
  }
  const list = [...bins].map(([key, n]) => {
    const rgb = [((key >> 12) & 63) * 4 + 2, ((key >> 6) & 63) * 4 + 2, (key & 63) * 4 + 2];
    return { rgb, lab: cmLab(...rgb), n };
  }).sort((a, b) => b.n - a.n);
  let centers = [];
  list.forEach(b => {
    let best = null, bd = Infinity;
    centers.forEach(c => { const d = cmDistance(b.lab, c.lab); if (d < bd) { bd = d; best = c; } });
    if (best && bd < limit) {
      best.sum = best.sum.map((v, k) => v + b.rgb[k] * b.n);
      best.n += b.n;
    } else centers.push({ sum: b.rgb.map(v => v * b.n), n: b.n, lab: b.lab, seed: b.rgb });
  });
  centers.forEach(c => { c.rgb = c.sum.map(v => v / c.n); });
  // Small groups are usually the blended pixels along an edge between two parts; a small part (a clip,
  // a logo) is kept when its color isn't a mix of two bigger regions.
  const big = centers.filter(c => c.n / total >= 0.004);
  const isBlend = c => big.some(a => big.some(b => {
    if (a === b) return false;
    const ab = a.rgb.map((v, k) => b.rgb[k] - v), ac = c.rgb.map((v, k) => v - a.rgb[k]);
    const len = ab.reduce((s, v) => s + v * v, 0);
    const t = ab.reduce((s, v, k) => s + v * ac[k], 0) / (len || 1);
    if (t < 0.05 || t > 0.95) return false;
    return Math.hypot(...ac.map((v, k) => v - t * ab[k])) < 18;
  }));
  const kept = centers.filter(c => c.n / total >= 0.004 || (c.n / total >= 0.0004 && !isBlend(c)))
    .sort((a, b) => b.n - a.n).slice(0, 12);
  return kept.map(c => ({ hex: cmHex(c.rgb), share: Math.round(c.n / total * 1000) / 1000 }));
}

// Which region each pixel belongs to (by its nearest region color), with stray single pixels smoothed.
function labelPixels(img, hexes) {
  const labs = hexes.map(h => cmLab(...cmRgb(h)));
  const w = img.width, h = img.height, raw = new Uint8Array(w * h), cache = new Map();
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    const key = img.data[i] << 16 | img.data[i + 1] << 8 | img.data[i + 2];
    let best = cache.get(key);
    if (best === undefined) {
      const lab = cmLab(img.data[i], img.data[i + 1], img.data[i + 2]);
      let bd = Infinity;
      labs.forEach((c, k) => { const d = cmDistance(lab, c); if (d < bd) { bd = d; best = k; } });
      cache.set(key, best);
    }
    raw[p] = best;
  }
  const out = new Uint8Array(raw);
  const counts = new Uint8Array(hexes.length);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    counts.fill(0);
    let top = raw[p], topN = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const l = raw[p + dy * w + dx];
      if (++counts[l] > topN) { topN = counts[l]; top = l; }
    }
    if (topN >= 5) out[p] = top;
  }
  return out;
}

function cmHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hh = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh / 6, s, l];
}
function cmFromHsl(hh, s, l) {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(hh + 1 / 3) * 255, f(hh) * 255, f(hh - 1 / 3) * 255];
}
// Repaints the photo: each region whose part has a color (targets[k] = '#rrggbb') gets that color, with each
// pixel as much lighter or darker than the new color as it was than the region's own color.
// `bases` (optional) is each color's reference lightness; areas of one part share theirs so its faces keep their shading.
function recolorPixels(img, labels, hexes, targets, bases) {
  const out = new Uint8ClampedArray(img.data);
  const base = bases || hexes.map(h => cmHsl(...cmRgb(h))[2]);
  const want = targets.map(t => (t ? cmHsl(...cmRgb(t)) : null));
  for (let p = 0; p < labels.length; p++) {
    const k = labels[p], t = want[k];
    if (!t) continue;
    const i = p * 4, lp = cmHsl(img.data[i], img.data[i + 1], img.data[i + 2])[2], lc = base[k];
    const l = lp >= lc ? t[2] + (1 - t[2]) * (lp - lc) / ((1 - lc) || 1) : t[2] * lp / (lc || 1);
    const rgb = cmFromHsl(t[0], t[1], Math.max(0, Math.min(1, l)));
    out[i] = rgb[0]; out[i + 1] = rgb[1]; out[i + 2] = rgb[2];
  }
  return out;
}


// Saved on a design as colorMap: { photo, regions: [{ hexes, part }], combos: [{ id, name, colors: { partId: colorKey } }] }.
// A region (an area) is one or more found colors the owner joined; its part is a part id, or '' to leave it as
// it is (the background, shadows). Several areas can be one part. Combos are the owner's suggested colors.
function cleanColorMap(m, parts) {
  if (!m || typeof m !== 'object') return null;
  const photo = safeImageUrl(m.photo);
  if (!photo) return null;
  const ids = (parts || []).map(p => p.id);
  const regions = (Array.isArray(m.regions) ? m.regions : []).slice(0, 16).map(r => ({
    hexes: (r && Array.isArray(r.hexes) ? r.hexes : [r && r.hex]).filter(h => /^#[0-9a-f]{6}$/i.test(String(h))).slice(0, 16).map(h => h.toLowerCase()),
    part: r && ids.includes(r.part) ? r.part : ''
  })).filter(r => r.hexes.length);
  const combos = (Array.isArray(m.combos) ? m.combos : []).slice(0, 8).map((c, n) => {
    const colors = {};
    ids.forEach(id => { const k = c && c.colors && c.colors[id]; if (/^[a-z0-9-]{1,40}$/.test(String(k))) colors[id] = k; });
    return { id: /^[A-Za-z0-9_-]{1,40}$/.test(String(c && c.id)) ? c.id : `c${n + 1}`, name: cleanText(c && c.name, 40).trim(), colors };
  });
  return { photo, regions, combos };
}

// A color key (a color's id, or black / white when no colors are set up; blank = White) as { name, hex }.
function cmColor(key) {
  const colors = state.settings.colors || [];
  const c = colors.find(x => x.id === key)
    || (key === 'black' ? colors.find(x => /^black$/i.test(String(x.name).trim())) || { name: 'Black', hex: '#1e1e24' } : null)
    || colors.find(x => /^white$/i.test(String(x.name).trim())) || { name: 'White', hex: '#f4f4f4' };
  return { name: c.name, hex: c.hex };
}
// Each part's color: the chosen one when it's one of `choices`, else the part's starting color, else White.
function cmPartColors(parts, chosen, choices) {
  const keys = choices.map(c => c.key);
  const white = (choices.find(c => /^white$/i.test(String(c.name).trim())) || choices[0] || { key: '' }).key;
  const out = {};
  parts.forEach(p => {
    const want = chosen && chosen[p.id];
    out[p.id] = keys.includes(want) ? want : keys.includes(p.defaultColor) ? p.defaultColor : white;
  });
  return out;
}
function cmUsable(m) { return !!(m && m.regions.some(r => r.part)); }
function cmHexes(m) { return m.regions.flatMap(r => r.hexes); }
function cmCanvas(m, parts, colors, label, cls = '') {
  const on = r => r.part && parts.some(p => p.id === r.part);
  const targets = m.regions.flatMap(r => r.hexes.map(() => (on(r) ? cmColor(colors[r.part]).hex : null)));
  const groups = m.regions.flatMap(r => r.hexes.map(() => (on(r) ? parts.findIndex(p => p.id === r.part) : -1)));
  return `<canvas class="cm-canvas ${cls}" data-cm="${esc(JSON.stringify({ photo: m.photo, hexes: cmHexes(m), targets, groups }))}" role="img" aria-label="${esc(label)}"></canvas>`;
}
// Each part's reference lightness: the average of its colors, weighted by how much of the picture each covers.
function cmBases(labels, hexes, groups) {
  const own = hexes.map(h => cmHsl(...cmRgb(h))[2]), count = new Array(hexes.length).fill(0);
  for (let p = 0; p < labels.length; p++) count[labels[p]]++;
  return own.map((l, k) => {
    if (groups[k] < 0) return l;
    let sum = 0, n = 0;
    groups.forEach((g, j) => { if (g === groups[k]) { sum += own[j] * count[j]; n += count[j]; } });
    return n ? sum / n : l;
  });
}
function cmDescribe(parts, colors) { return parts.map(p => `${p.name} in ${cmColor(colors[p.id]).name}`).join(', '); }
// A color's name written in that color on one dark gray (bold, so 3:1 contrast is enough). Colors too dark
// to read there (black, navy) are lightened just enough; the dot beside the picker shows the true color.
const COLOR_TEXT_BG = '#1c1c21';
function cmLuminance(rgb) {
  const lum = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
}
function colorTextStyle(key) {
  const bg = cmLuminance(cmRgb(COLOR_TEXT_BG));
  let rgb = cmRgb(cmColor(key).hex);
  for (let n = 0; n < 40 && (cmLuminance(rgb) + 0.05) / (bg + 0.05) < 3; n++) rgb = rgb.map(v => v + (255 - v) * 0.06);
  return `color:${cmHex(rgb)};background-color:${COLOR_TEXT_BG}`;
}
// A big dot in the true color (real black included) beside each color picker.
function colorDot(key) { return `<span class="color-dot" style="background:${esc(cmColor(key).hex)}" aria-hidden="true"></span>`; }
// Parts with no area in the picture (like a copied set before a picture shows it): their color can't be shown.
function cmMissing(m, parts) { return parts.filter(p => !m.regions.some(r => r.part === p.id)); }
function cmLegend(parts, colors, m) {
  const missing = cmMissing(m, parts).map(p => p.id);
  return `<ul class="cm-legend">${parts.map(p => { const c = cmColor(colors[p.id]); return `<li><span class="swatch" style="background:${esc(c.hex)}" aria-hidden="true"></span>${esc(p.name)}: <span class="color-name" style="${colorTextStyle(colors[p.id])}">${esc(c.name)}</span>${missing.includes(p.id) ? ' <span class="gallery-meta">(not shown in the picture)</span>' : ''}</li>`; }).join('')}</ul>`;
}

// Painting: photos are read once, each pixel's area is worked out once per photo, and finished pictures are kept.
const cmImages = new Map(), cmLabelCache = new Map(), cmPainted = new Map();
function cmPixels(photo) {
  if (!cmImages.has(photo)) cmImages.set(photo, new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, c.width, c.height));
      } catch (e) { resolve(null); }   // a photo from a site that doesn't allow reading it
    };
    img.onerror = () => resolve(null);
    img.src = photo;
  }));
  return cmImages.get(photo);
}
async function paintColorPreviews() {
  for (const cv of document.querySelectorAll('canvas[data-cm]')) {
    const spec = cv.dataset.cm;
    if (cv.dataset.painted === spec) continue;
    cv.dataset.painted = spec;
    let s;
    try { s = JSON.parse(spec); } catch (e) { continue; }
    const img = await cmPixels(s.photo);
    if (!cv.isConnected) continue;
    if (!img) {
      const el = document.createElement('img');
      el.src = s.photo; el.alt = cv.getAttribute('aria-label') || ''; el.className = cv.className;
      cv.replaceWith(el);
      continue;
    }
    let data = cmPainted.get(spec);
    if (!data) {
      const lk = s.photo + '|' + s.hexes.join(',');
      if (!cmLabelCache.has(lk)) cmLabelCache.set(lk, labelPixels(img, s.hexes));
      const labels = cmLabelCache.get(lk);
      if (s.mask) {
        // One area in its own color, everything else faded, so the owner can see which area it is.
        data = new Uint8ClampedArray(img.data);
        for (let p = 0; p < labels.length; p++) if (!s.mask.includes(labels[p])) for (let k = 0; k < 3; k++) data[p * 4 + k] = 235 + data[p * 4 + k] * 0.08;
      } else data = recolorPixels(img, labels, s.hexes, s.targets, s.groups ? cmBases(labels, s.hexes, s.groups) : null);
      if (cmPainted.size > 60) cmPainted.clear();
      cmPainted.set(spec, data);
    }
    cv.width = img.width; cv.height = img.height;
    cv.getContext('2d').putImageData(new ImageData(data, img.width, img.height), 0, 0);
    cv.classList.add('cm-ready');
  }
}

// ── Customers: the design page card ──
function cmView(g, combos) {
  state.cmView = state.cmView || {};
  const v = state.cmView[g.id] || (state.cmView[g.id] = { pick: '', own: {} });
  if (v.pick !== 'own' && !combos.some(c => c.id === v.pick)) v.pick = combos[0] ? combos[0].id : 'own';
  return v;
}
function cmCombosFor(g, choices) {
  const keys = choices.map(c => c.key);
  // Customers see ideas whose colors are all in stock; the owner sees every idea.
  return g.colorMap.combos.filter(c => c.name && (state.ownerUnlocked || Object.values(c.colors).every(k => keys.includes(k))));
}
function cmShown(g) { return featureOn('colorIdeas') && featureOn('designParts') && (g.parts || []).length > 0 && cmUsable(g.colorMap); }
function cmViewColors(id) {
  const g = state.gallery.find(x => x.id === id);
  if (!g || !cmShown(g)) return null;
  const choices = partColorChoices(), combos = cmCombosFor(g, choices), v = cmView(g, combos);
  const combo = combos.find(c => c.id === v.pick);
  return cmPartColors(g.parts, combo ? combo.colors : v.own, choices);
}
function renderColorIdeas(g) {
  if (!cmShown(g)) return '';
  const choices = partColorChoices(), combos = cmCombosFor(g, choices), v = cmView(g, combos);
  const colors = cmViewColors(g.id);
  const price = designEstimate(g, colors), item = designEstimateItem(g, colors);
  return `<div class="card color-ideas" id="color-ideas">
    <h3 class="card-title">${esc(t('colorIdeasTitle'))}</h3>
    <div class="field-help" style="margin-bottom:10px;">${esc(t('colorIdeasNote'))}</div>
    <div class="cm-picks" role="group" aria-label="${esc(t('colorIdeasTitle'))}">
      ${combos.map(c => `<button type="button" class="btn-sm" id="cm-pick-${esc(c.id)}" aria-pressed="${v.pick === c.id}" onclick="setCmPick('${esc(g.id)}', '${esc(c.id)}')">${esc(c.name)}</button>`).join('')}
      <button type="button" class="btn-sm" id="cm-pick-own" aria-pressed="${v.pick === 'own'}" onclick="setCmPick('${esc(g.id)}', 'own')">${esc(t('colorIdeasOwn'))}</button>
    </div>
    ${cmCanvas(g.colorMap, g.parts, colors, `${g.title}: ${cmDescribe(g.parts, colors)}`)}
    ${v.pick === 'own' ? `<div class="cm-own">${g.parts.map((p, k) => `<div class="field"><label for="cm-own-${k}">${esc(p.name)}${cmMissing(g.colorMap, [p]).length ? ' (not shown in the picture)' : ''}</label>
      <div class="color-pick">${colorDot(colors[p.id])}<select id="cm-own-${k}" class="color-select" style="${colorTextStyle(colors[p.id])}" onchange="setCmOwn('${esc(g.id)}', '${esc(p.id)}', this.value, ${k})">
        ${choices.map(c => `<option value="${esc(c.key)}" style="${colorTextStyle(c.key)}" ${c.key === colors[p.id] ? 'selected' : ''}>${esc(c.name)}${c.filType === 'special' ? ' (special)' : ''}</option>`).join('')}
      </select></div></div>`).join('')}</div>` : cmLegend(g.parts, colors, g.colorMap)}
    ${price !== null ? `<div class="cm-price" id="cm-price" aria-live="polite"><span class="gallery-price">$${price.toFixed(2)}</span> <span class="gallery-meta">${galleryPriceLabel(g)}, in these colors</span>
      ${g.price > 0 ? '' : renderColorLines(item, item.grams, currentRules())}</div>` : ''}
    <button class="btn-sm" type="button" id="cm-request" onclick="requestGalleryItem('${esc(g.id)}', cmViewColors('${esc(g.id)}'))">${esc(t('colorIdeasRequest'))}</button>
  </div>`;
}
function refreshColorIdeas(id, focusId) {
  const g = state.gallery.find(x => x.id === id);
  const el = document.getElementById('color-ideas');
  if (!g || !el) { render(); return; }
  el.outerHTML = renderColorIdeas(g);
  const price = document.getElementById('work-price');
  if (price) price.innerHTML = renderWorkPrice(g);
  paintColorPreviews();
  if (focusId) document.getElementById(focusId)?.focus();
}
function setCmPick(id, pick) {
  const g = state.gallery.find(x => x.id === id);
  if (!g) return;
  const v = cmView(g, cmCombosFor(g, partColorChoices()));
  // "Pick your own" starts from the colors on screen.
  if (pick === 'own' && v.pick !== 'own') v.own = cmViewColors(id);
  v.pick = pick;
  refreshColorIdeas(id, `cm-pick-${pick}`);
}
function setCmOwn(id, partId, key, k) {
  const g = state.gallery.find(x => x.id === id);
  if (!g) return;
  cmView(g, []).own[partId] = key;
  refreshColorIdeas(id, `cm-own-${k}`);
}

// ── Request form: their chosen part colors on the photo ──
function cmRequestPreview(item) {
  if (!featureOn('colorIdeas')) return '';
  const g = state.gallery.find(x => x.id === item.galleryId);
  if (!g || !cmUsable(g.colorMap)) return '';
  const parts = item.designParts || [];
  const colors = Object.fromEntries(parts.map(p => [p.id, p.colorId]));
  return `<div class="cm-request">${cmCanvas(g.colorMap, parts, colors, `${g.title}: ${cmDescribe(parts, colors)}`, 'cm-small')}
    <div class="field-help">${esc(t('colorIdeasYours'))}</div></div>`;
}

// ── Owner: set up the photo, match areas to parts, and make color ideas ──
function renderColorMapForm(f) {
  const parts = cleanDesignParts(f.parts);
  const m = f.colorMap;
  const choices = ownerPartChoices();
  const comboColors = c => cmPartColors(parts, c.colors, choices);
  return `<fieldset class="owner-edit-item" id="color-map-form">
    <legend>Color ideas photo (optional)</legend>
    <div class="field-help" style="margin-bottom:8px;">Upload a picture where every part is a different solid color (a slicer or CAD screenshot works best). The site finds each colored area; you say which part each one is, then add color ideas. Customers see the picture repainted in those colors, with the same light and shadow.</div>
    <label class="btn-sm">${m ? 'Change picture' : 'Upload picture'}
      <input type="file" accept="image/*" id="cm-upload" onchange="uploadColorMapPhoto(this.files[0]); this.value='';" style="display:none;" /></label>
    ${m ? '<button type="button" class="btn-sm danger" onclick="state.galleryForm.colorMap = null; state.cmJoin = []; render();">Remove picture</button>' : ''}
    <span class="field-help" id="cm-status" role="status"></span>
    ${!m ? '' : `
      <h4 class="cm-heading">Which part is each colored area?</h4>
      ${parts.length ? '' : '<div class="alert error" style="display:block;">Add the parts above first (with names), then match each area to a part.</div>'}
      <div class="field-help">Several areas can be the same part (like a part's top and its shaded edge). Leave the background and shadows as "Not a part". Found one part split into several areas, or a stray edge? Tick "Join" on them and tap "Join areas". Copied a part as a second set? Change the picture to one with that set in its own color; parts you already matched stay matched.</div>
      <div class="cm-regions">${m.regions.map((r, k) => { const start = m.regions.slice(0, k).reduce((n, x) => n + x.hexes.length, 0); return `<div class="cm-region">
        <canvas class="cm-canvas cm-mask" data-cm="${esc(JSON.stringify({ photo: m.photo, hexes: cmHexes(m), mask: r.hexes.map((h, j) => start + j) }))}" aria-hidden="true"></canvas>
        <div class="field"><label for="cm-region-${k}">${r.hexes.map(h => `<span class="swatch" style="background:${esc(h)}" aria-hidden="true"></span>`).join('')}Area ${k + 1}${r.hexes.length > 1 ? ` (${r.hexes.length} joined)` : ''}${r.share ? ` (${r.share >= 0.01 ? Math.round(r.share * 100) + '%' : 'under 1%'} of the picture)` : ''}</label>
          <select id="cm-region-${k}" onchange="setCmRegion(${k}, this.value)">
            <option value="">Not a part (leave as is)</option>
            ${parts.map(p => `<option value="${esc(p.id)}" ${p.id === r.part ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
          <div class="cm-region-actions">
            <label class="special-order-check"><input type="checkbox" id="cm-join-${k}" ${(state.cmJoin || []).includes(k) ? 'checked' : ''} onchange="toggleCmJoin(${k}, this.checked)" /> Join</label>
            ${r.hexes.length > 1 ? `<button type="button" class="btn-sm" id="cm-split-${k}" onclick="splitCmRegion(${k})">Split apart</button>` : ''}
          </div></div>
      </div>`; }).join('')}</div>
      <div id="cm-join-bar">${renderCmJoinBar()}</div>
      <div class="field" style="max-width:340px;"><label for="cm-detail">Areas not split right?</label>
        <select id="cm-detail" onchange="redoColorAreas(this.value)">
          <option value="">Choose...</option>
          <option value="fewer">Find fewer areas (join shades)</option>
          <option value="more">Find more areas (split shades)</option>
        </select></div>
      ${cmUsable(cleanColorMap(m, parts)) ? `
        ${cmMissing(m, parts).length ? `<div class="alert error" style="display:block;" id="cm-missing">No area in the picture is set to ${cmMissing(m, parts).map(p => `"${esc(p.name)}"`).join(', ')}, so the picture can't show ${cmMissing(m, parts).length > 1 ? 'their colors' : 'its color'}. If it's a copied set, make a screenshot with that set's pieces in a color of their own, tap "Change picture" and set the new area to it (your other areas stay matched).</div>` : ''}
        <h4 class="cm-heading">Starting colors</h4>
        ${cmCanvas(m, parts, cmPartColors(parts, {}, choices), `${f.title}: starting colors`, 'cm-small')}
        <h4 class="cm-heading">Color ideas customers can tap</h4>
        <div class="field-help">Give each idea a name and a color per part. Ideas using an out-of-stock color are hidden from customers until it's back.</div>
        ${m.combos.map((c, n) => { const cc = comboColors(c); return `<div class="cm-combo">
          ${cmCanvas(m, parts, cc, `${c.name || 'Color idea'}: ${cmDescribe(parts, cc)}`, 'cm-small')}
          <div class="cm-combo-fields">
            <div class="field"><label for="cm-combo-name-${n}">Idea ${n + 1} name</label>
              <input type="text" id="cm-combo-name-${n}" maxlength="40" value="${esc(c.name)}" placeholder="e.g. Gold and black" oninput="state.galleryForm.colorMap.combos[${n}].name = this.value" /></div>
            ${parts.map((p, k) => `<div class="field"><label for="cm-combo-${n}-${k}">${esc(p.name)}</label>
              <div class="color-pick">${colorDot(cc[p.id])}<select id="cm-combo-${n}-${k}" class="color-select" style="${colorTextStyle(cc[p.id])}" onchange="setCmComboColor(${n}, '${esc(p.id)}', this.value, 'cm-combo-${n}-${k}')">
                ${choices.map(o => `<option value="${esc(o.key)}" style="${colorTextStyle(o.key)}" ${o.key === cc[p.id] ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
              </select></div></div>`).join('')}
            <button type="button" class="btn-sm danger" onclick="state.galleryForm.colorMap.combos.splice(${n}, 1); render();" aria-label="Remove color idea ${n + 1}">Remove idea</button>
          </div>
        </div>`; }).join('')}
        ${m.combos.length < 8 ? '<button type="button" class="btn-sm" id="cm-add-combo" onclick="addCmCombo()">+ Add a color idea</button>' : ''}` : ''}
    `}
  </fieldset>`;
}
function renderCmJoinBar() {
  const n = (state.cmJoin || []).length;
  return n >= 2 ? `<button type="button" class="btn-sm" id="cm-join" onclick="joinCmRegions()">Join ${n} areas into one</button>`
    : n === 1 ? '<span class="field-help">Tick "Join" on at least one more area.</span>' : '';
}
function toggleCmJoin(k, on) {
  const list = (state.cmJoin || []).filter(x => x !== k);
  if (on) list.push(k);
  state.cmJoin = list.sort((a, b) => a - b);
  const bar = document.getElementById('cm-join-bar');
  if (bar) bar.innerHTML = renderCmJoinBar();
}
// The joined area keeps the first area's place and part (or the first part any of them had).
function joinCmRegions() {
  const m = state.galleryForm && state.galleryForm.colorMap;
  const picked = (state.cmJoin || []).filter(k => m && m.regions[k]);
  state.cmJoin = [];
  if (!m || picked.length < 2) { render(); return; }
  const into = m.regions[picked[0]];
  picked.slice(1).forEach(k => {
    const r = m.regions[k];
    into.hexes = into.hexes.concat(r.hexes);
    into.part = into.part || r.part;
    if (r.share || into.share) into.share = (into.share || 0) + (r.share || 0);
  });
  m.regions = m.regions.filter((r, k) => !picked.slice(1).includes(k));
  render();
  const s = document.getElementById('cm-status');
  if (s) s.textContent = `Joined ${picked.length} areas into Area ${picked[0] + 1}.`;
  document.getElementById(`cm-region-${picked[0]}`)?.focus();
}
function splitCmRegion(k) {
  const m = state.galleryForm && state.galleryForm.colorMap;
  const r = m && m.regions[k];
  if (!r || r.hexes.length < 2) return;
  state.cmJoin = [];
  m.regions.splice(k, 1, ...r.hexes.map(h => ({ hexes: [h], part: r.part })));
  render();
  const s = document.getElementById('cm-status');
  if (s) s.textContent = `Split Area ${k + 1} into ${r.hexes.length} areas.`;
  document.getElementById(`cm-region-${k}`)?.focus();
}
function setCmRegion(k, partId) {
  const m = state.galleryForm && state.galleryForm.colorMap;
  if (!m || !m.regions[k]) return;
  m.regions[k].part = partId;
  render();
  document.getElementById(`cm-region-${k}`)?.focus();
}
function setCmComboColor(n, partId, key, focusId) {
  const m = state.galleryForm && state.galleryForm.colorMap;
  if (!m || !m.combos[n]) return;
  m.combos[n].colors[partId] = key;
  render();
  document.getElementById(focusId)?.focus();
}
function addCmCombo() {
  const m = state.galleryForm && state.galleryForm.colorMap;
  if (!m) return;
  const parts = cleanDesignParts(state.galleryForm.parts);
  m.combos.push({ id: 'c' + Date.now().toString(36), name: '', colors: cmPartColors(parts, {}, ownerPartChoices()) });
  render();
  document.getElementById(`cm-combo-name-${m.combos.length - 1}`)?.focus();
}
// Resized to at most 900 px and kept as PNG, so the solid colors stay solid.
async function cmPrepare(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('unsupported image'));
      el.src = url;
    });
    const scale = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const pixels = ctx.getImageData(0, 0, c.width, c.height);
    const blob = await new Promise(resolve => c.toBlob(resolve, 'image/png'));
    return { blob, pixels };
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function uploadColorMapPhoto(file) {
  const f = state.galleryForm;
  const status = () => document.getElementById('cm-status');
  const token = getOwnerToken();
  if (!f || !file) return;
  if (!token) { if (status()) status().textContent = 'Please log in again to upload.'; return; }
  if (status()) status().textContent = 'Finding the colored areas...';
  try {
    const { blob, pixels } = await cmPrepare(file);
    if (!blob) throw new Error('resize failed');
    const path = `${f.id}/colors-${Date.now()}.png`;
    await uploadStoredPhoto(path, blob, token, false, 'image/png');
    const photo = GALLERY_PUBLIC_PREFIX + path;
    cmImages.set(photo, Promise.resolve(pixels));
    state.cmJoin = [];
    // A new picture of the same design keeps the parts already matched to colors that are still there.
    const old = (f.colorMap && f.colorMap.regions) || [];
    const partFor = hex => { const lab = cmLab(...cmRgb(hex)); const o = old.find(r => r.part && r.hexes.some(h => cmDistance(lab, cmLab(...cmRgb(h))) < 6)); return o ? o.part : ''; };
    f.colorMap = { photo, regions: findColorRegions(pixels).map(r => ({ hexes: [r.hex], share: r.share, part: partFor(r.hex) })), combos: (f.colorMap && f.colorMap.combos) || [] };
    render();
    if (status()) status().textContent = `Found ${f.colorMap.regions.length} colored areas. Pick a part for each, then save.`;
  } catch (e) {
    console.error('Color photo error:', e);
    if (status()) status().textContent = /unsupported/.test(e.message) ? "That picture isn't a format this browser can read. Try a PNG or JPG." : "Couldn't upload. Check that you're logged in and try again.";
  }
}
async function redoColorAreas(detail) {
  const m = state.galleryForm && state.galleryForm.colorMap;
  if (!m || !detail) return;
  const pixels = await cmPixels(m.photo);
  if (!pixels) { const s = document.getElementById('cm-status'); if (s) s.textContent = "Couldn't read the picture. Try uploading it again."; return; }
  const old = m.regions;
  state.cmJoin = [];
  m.regions = findColorRegions(pixels, detail).map(r => ({ hexes: [r.hex], share: r.share, part: (old.find(o => o.hexes.includes(r.hex)) || {}).part || '' }));
  render();
  const s = document.getElementById('cm-status');
  if (s) s.textContent = `Found ${m.regions.length} colored areas.`;
}
