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
    ['depositPercent', 'Deposit customers can pay first (% of the total, 0 = none)', 5],
    ['logoPrice', 'Company logo add-on ($ per print)', 0.5],
    ['freeColors', 'Colors included in a print (more costs extra)', 1],
    ['colorFee', 'Extra colors charge ($ per print with more colors than that; 0 = none)', 0.5],
    ['shippingFee', 'Shipping deposit added to the final payment ($; the unused part is refunded)', 1],
    ['packagingFee', 'Packaging kept from the shipping deposit ($)', 0.5]
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
  return `${orderIsPreorder(b) && !delivered ? renderPreorderNote(null, b) : ''}<div class="order-extras">
    ${featureOn('orderAgain') ? `<button type="button" class="btn-sm" onclick="orderAgain('${esc(b.id)}')">Order again</button>` : ''}
    ${delivered ? `<button type="button" class="btn-sm btn-gold" onclick="openReviewForm('${esc(b.id)}')">Leave a review</button>` : ''}
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
    const line = preorderLineFromOrders(state.batches);
    if (JSON.stringify(ids) === JSON.stringify(state.settings.topWork || []) && JSON.stringify(line) === JSON.stringify(state.settings.preorderLine || {})) return;
    await saveSettings({ ...state.settings, topWork: ids, preorderLine: line });
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
  if (beforeQuote(b.phase) || (b.phase === 'quote_sent' && !b.customerApprovedAt)) {
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

// Clients page notes and payment issues, by email (owner_private key "clients"); customers never see them.
function clientNotes() { return (state.ownerPrivate && state.ownerPrivate.clients) || {}; }
let clientNoteTimer = null;
function queueClientNote(email, field, value) {
  const key = String(email || '').trim().toLowerCase();
  if (!key || !state.ownerPrivate) return;
  const all = { ...clientNotes() };
  all[key] = { ...(all[key] || {}), [field]: String(value).slice(0, 4000) };
  if (!String(all[key].notes || '').trim() && !String(all[key].issues || '').trim()) delete all[key];
  state.ownerPrivate.clients = all;
  const status = document.getElementById('client-note-status');
  if (status) status.textContent = 'Saving...';
  clearTimeout(clientNoteTimer);
  clientNoteTimer = setTimeout(async () => {
    try { await saveOwnerPrivate('clients'); if (status) status.textContent = 'Saved'; }
    catch (e) { if (status) status.textContent = "Couldn't save. Check you're logged in."; }
  }, 700);
}

// ── COMPARE SEVERAL LINKS (owner calculator) ─────────────────────────────
// Paste several model links; each is looked up (saved models first, then MakerWorld / Thingiverse) and priced
// exactly like a single calculator quote, side by side. Print time and grams can be typed in for any row.
function cmpState() {
  if (!state.compare) state.compare = { text: '', color: 'white', qty: 1, rows: [], busy: false };
  return state.compare;
}
function cmpPerPrint(r) {
  const c = cmpState();
  const mins = Number(r.minutes), grams = Number(r.grams);
  if (!(mins > 0) || !(grams > 0)) return null;
  return calcPerPrint(mins, grams, calcItem({ color: c.color }));
}
function renderLinkCompare() {
  const c = cmpState();
  return `<div class="card" id="link-compare">
    <h3 class="card-title">Compare several links</h3>
    <div class="field-help">Paste model links, one per line (up to 12). I look up the print time and filament for each and price them the same way as the calculator above, so you can compare the costs. Printables links can't be looked up, so type their numbers in. Nothing here is saved.</div>
    <div class="field"><label for="cmp-text">Model links</label>
      <textarea id="cmp-text" rows="4" spellcheck="false" placeholder="https://makerworld.com/en/models/...&#10;https://www.thingiverse.com/thing:..." oninput="cmpState().text = this.value">${esc(c.text)}</textarea></div>
    <div class="row2">
      <div class="field"><label for="cmp-color">Color</label><select id="cmp-color" onchange="cmpState().color = this.value; cmpRefresh()">${calcColorOptions(c.color)}</select></div>
      <div class="field"><label for="cmp-qty">Quantity</label><input type="number" id="cmp-qty" min="1" step="1" value="${esc(c.qty)}" oninput="cmpState().qty = this.value; cmpRefresh()" /></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button type="button" class="btn-sm" id="cmp-go" onclick="compareLinks()" ${c.busy ? 'disabled' : ''}>${c.busy ? 'Looking up...' : 'Look up and compare'}</button>
      <button type="button" class="btn-sm" onclick="state.compare = null; render();">Clear</button>
    </div>
    <div class="alert error" id="cmp-err"></div>
    <div id="cmp-results">${renderCompareResults()}</div>
  </div>`;
}
function renderCompareResults() {
  const c = cmpState();
  if (!c.rows.length) return '';
  const qty = Math.max(1, parseInt(c.qty, 10) || 1);
  const prices = c.rows.map(cmpPerPrint).filter(v => v !== null);
  const low = prices.length ? Math.min(...prices) : null, high = prices.length ? Math.max(...prices) : null;
  return `${prices.length > 1 ? `<div class="calc-match" id="cmp-summary"><strong>Cheapest $${(low * qty).toFixed(2)}</strong>, most expensive $${(high * qty).toFixed(2)} (${qty} print${qty === 1 ? '' : 's'} each, ${esc(calcPart(c.color).name)}).</div>` : ''}
    <div class="compare-list">${c.rows.map((r, i) => {
      const per = cmpPerPrint(r);
      return `<div class="compare-row ${per !== null && per === low && prices.length > 1 ? 'cheapest' : ''}" id="cmp-row-${i}">
        <div class="compare-head">
          ${safeImageUrl(r.image) ? `<img class="model-thumb" src="${esc(r.image)}" alt="" loading="lazy" onerror="this.remove()" />` : ''}
          <div class="compare-name"><strong>${esc(r.name || 'Model')}</strong>
            <div class="field-help"><a href="${esc(r.link)}" target="_blank" rel="noopener noreferrer">${esc(r.link.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60))}</a></div>
            <div class="field-help">${r.status === 'loading' ? 'Looking up...' : esc(r.note || '')}</div></div>
        </div>
        <div class="row2">
          <div class="field"><label for="cmp-min-${i}">Print time (minutes)</label><input type="number" id="cmp-min-${i}" min="0" step="1" value="${r.minutes || ''}" oninput="cmpEdit(${i}, 'minutes', this.value)" /></div>
          <div class="field"><label for="cmp-g-${i}">Filament (g)</label><input type="number" id="cmp-g-${i}" min="0" step="0.1" value="${r.grams || ''}" oninput="cmpEdit(${i}, 'grams', this.value)" /></div>
        </div>
        <div class="compare-price"><span id="cmp-price-${i}">${per !== null ? `$${(per * qty).toFixed(2)}` : 'Enter time and grams'}</span>
          ${per !== null ? `<span class="field-help" id="cmp-per-${i}">$${per.toFixed(2)} per print</span>` : ''}
          ${per !== null && per === low && prices.length > 1 ? '<span class="status delivered">Cheapest</span>' : ''}</div>
        <button type="button" class="btn-sm" onclick="cmpUse(${i})">Use in the calculator</button>
      </div>`;
    }).join('')}</div>`;
}
// Re-draws just the results (keeps what's typed in the link box).
function cmpRefresh() {
  const el = document.getElementById('cmp-results');
  if (el) el.innerHTML = renderCompareResults();
}
function cmpEdit(i, field, value) {
  const r = cmpState().rows[i];
  if (!r) return;
  r[field] = Number(value) > 0 ? Number(value) : 0;
  // Only the prices change while typing, so the boxes keep focus.
  const c = cmpState(), qty = Math.max(1, parseInt(c.qty, 10) || 1);
  const prices = c.rows.map(cmpPerPrint);
  const real = prices.filter(v => v !== null), low = real.length ? Math.min(...real) : null;
  c.rows.forEach((row, n) => {
    const pe = document.getElementById(`cmp-price-${n}`), card = document.getElementById(`cmp-row-${n}`);
    if (pe) pe.textContent = prices[n] !== null ? `$${(prices[n] * qty).toFixed(2)}` : 'Enter time and grams';
    if (card) card.classList.toggle('cheapest', prices[n] !== null && prices[n] === low && real.length > 1);
  });
}
async function compareLinks() {
  const c = cmpState();
  const links = [...new Set(String(c.text || '').match(/https?:\/\/[^\s,<>"']+/g) || [])].slice(0, 12);
  if (!links.length) { showAlert('cmp-err', 'Paste at least one model link that starts with https://', 'error'); return; }
  c.rows = links.map(link => ({ link, name: nameFromUrl(link) || '', minutes: 0, grams: 0, image: '', note: '', status: 'loading' }));
  c.busy = true;
  render();
  await Promise.all(c.rows.map(async r => {
    try {
      const known = getKnownEstimate({ link: r.link, name: r.name });
      if (known && known.minutes && known.grams) {
        Object.assign(r, { minutes: known.minutes, grams: known.grams, status: 'ok', note: 'From your Saved Models.' });
      } else if (/(makerworld\.com|thingiverse\.com)/i.test(r.link)) {
        const found = await lookupModelEstimate(r.link).catch(() => null);
        if (found) {
          r.image = safeImageUrl(found.image);
          if (found.name && !r.name) r.name = cleanText(found.name, 200);
        }
        const mins = cleanNumber(found && found.minutes), grams = cleanNumber(found && found.grams);
        if (found && found.ok && mins && grams) Object.assign(r, { minutes: Math.round(mins), grams, status: 'ok', note: `From ${found.source || 'the model page'}${found.profile ? ` profile "${cleanText(found.profile, 80)}"` : ''}. An automated estimate; change it if you know better.` });
        else Object.assign(r, { status: 'manual', note: "Couldn't find a print time for this link. Type the minutes and grams in." });
      } else {
        const files = printablesFilesUrl(r.link);
        Object.assign(r, { status: 'manual', note: files ? "Printables can't be looked up. Open its Files tab, copy the print time and grams in." : "Can't look this site up. Type the minutes and grams in." });
      }
    } catch (e) {
      Object.assign(r, { status: 'manual', note: "Couldn't look this up. Type the minutes and grams in." });
    }
    cmpRefresh();
  }));
  c.busy = false;
  const btn = document.getElementById('cmp-go');
  if (btn) { btn.disabled = false; btn.textContent = 'Look up and compare'; }
  cmpRefresh();
}
function cmpUse(i) {
  const r = cmpState().rows[i], c = cmpState();
  if (!r) return;
  const calc = state.ownerCalculator = blankOwnerCalculator();
  Object.assign(calc, { link: r.link, name: r.name, hours: String(Math.floor((r.minutes || 0) / 60) || ''), minutes: String((r.minutes || 0) % 60 || ''),
    grams: r.grams ? String(r.grams) : '', qty: Math.max(1, parseInt(c.qty, 10) || 1), filType: calcPart(c.color).filType, color: state.settings.colors.some(x => x.id === c.color) ? c.color : '' });
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── WHEN EMAILS GO OUT (owner guidance) ───────────────────────────────────
// What a phase or payment change emails the customer (matches Code.gs emailsFor); '' = no email.
function emailForPhase(b, phase) {
  if ((b.phase || '') === 'production' && phase === 'order_received') return '';
  return { quote_sent: 'your quote', order_received: 'the "order confirmed" email, which asks for the deposit',
    final_payment_needed: 'the "printing is done" email, which asks for the rest and the shipping deposit',
    delivered: 'the "order shipped" email with tracking, invoice and refund note' }[phase] || '';
}
// What a payment is expected to be: the starting amount offered when you mark it received (you can change it).
function expectedPayment(b, status) {
  const total = orderSum(b), rules = rulesFor(b);
  if (status === 'deposit_received') return depositAmount(b, total, rules);
  if (Number(b.balancePaid) > 0) return Number(b.balancePaid);
  const done = phaseIndex(b.phase || 'estimate') >= phaseIndex('final_payment_needed');
  if (b.paymentStatus === 'deposit_received') return done ? finalPayment(b, total, rules).remainder : amountLeft(b, total, rules);
  return done ? balanceDue(b, total, rules) : total;
}
// Asks how much they paid. The customer's receipt email says this amount, so it has to be right. null = cancelled, NaN = not an amount.
function askPaymentAmount(b, status) {
  const what = status === 'deposit_received' ? 'deposit' : 'payment';
  const start = Math.max(0, Math.round(expectedPayment(b, status) * 100) / 100);
  const answer = prompt(`How much did ${b.clientName || 'the customer'} pay? Copy the amount from your Venmo app. Their ${what} receipt email says this amount.`, start.toFixed(2));
  if (answer === null) return null;
  const n = Math.round(parseFloat(String(answer).replace(/[$,\s]/g, '')) * 100) / 100;
  return n > 0 ? n : NaN;
}
function emailForPayment(b, status) {
  if (isPaidInFull(b)) return '';
  return { deposit_received: 'a "deposit received" receipt', payment_received: 'a "payment received" receipt' }[status] || '';
}
// Asks before anything that emails the customer goes out. True = go ahead.
function confirmEmail(b, what) {
  if (!what || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.clientEmail || ''))) return true;
  return confirm(`This emails ${b.clientName || b.clientEmail} (${b.clientEmail}) ${what}.\n\nSend it?`);
}

function renderEmailGuide() {
  const row = (when, button, gets) => `<tr><th scope="row">${button}</th><td>${when}</td><td>${gets}</td></tr>`;
  return `<details class="card email-guide" id="email-guide">
    <summary><strong>When do emails go out? When should I press each button?</strong></summary>
    <p class="field-help">Each order shows one next step with one button. The note above the button says which email it sends. When you tap the button, a pop-up shows the exact email, and you can change the subject or any of the text first. Then choose "Send email and continue" or "Don\'t send email, continue", so you can move an order along without emailing anyone. To send one of the automatic emails yourself, like the review request, open an order and use <strong>Send an email now</strong> under the steps.</p>
    <div class="table-scroll"><table class="email-guide-table">
      <thead><tr><th scope="col">Button</th><th scope="col">Press it when</th><th scope="col">The customer gets</th></tr></thead>
      <tbody>
      ${row('You have read the request and the quote is right.', 'Send quote', 'The quote email, with a link to approve.')}
      ${row('You need answers before you can quote (optional).', 'Confirm details with the customer, then Send email', 'The email you wrote and checked, exactly as shown.')}
      ${row('They tapped Looks good and you are happy to go ahead.', 'Confirm order', 'The order-confirmed email, asking for the deposit (if ticked).')}
      ${row('Their Venmo deposit shows in your Venmo app.', 'Deposit received (type the amount they paid)', 'A deposit receipt that says how much they paid. Their place in line starts now.')}
      ${row('The print is finished and photographed.', 'Printing done', 'The printing-done email: the rest plus the shipping deposit, and a request for their address. Nothing if they already paid in full.')}
      ${row('Their Venmo for the rest and the shipping deposit shows in your Venmo app.', 'Payment received (type the amount they paid)', 'A payment receipt that says how much they paid. The order moves to Ready to ship.')}
      ${row('You have mailed the package and have the tracking number.', 'Save tracking and mark Shipped', 'The order-shipped email with tracking, invoice and refund note. Then send the refund by Venmo yourself.')}
      ${row('They picked it up or you handed it over.', 'Handed over in person', 'Nothing.')}
      ${row('Tracking or the ship date changed after shipping.', 'Change shipping details on a finished order', 'A short shipping update email.')}
      ${row('You just want to say something, ask a question or answer one.', 'Send message', 'Your own words by email (with your footer) and on their order page. It never changes the order or sends a form email.')}
      </tbody></table></div>
    <p class="field-help"><strong>Never sends an email:</strong> everything in an order's More menu (change the quote, go back a step, print without a deposit, fix numbers, delete), Edit their request, notes, filament stock, the Practice tab, and approving or hiding a review.</p>
    <p class="field-help"><strong>Not sure?</strong> Use Send message for anything that isn't one of the steps above. Try a step first in the Practice tab; nothing there is ever sent.</p>
  </details>`;
}

// ── NUMBERS PAGE (owner) ──────────────────────────────────────────────────
// One place to fix the amounts typed on an order: the deposit received, what postage cost, the special
// order roll and the added charges. Saving changes only those numbers.
function renderNumbersPage() {
  const q = String(state.numbersQuery || '').trim().toLowerCase();
  const all = state.batches.slice().sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
  const only = state.numbersOnly && all.find(b => b.id === state.numbersOnly);
  const list = only ? [only] : (q ? all.filter(b => `${b.clientName} ${b.clientEmail} ${orderTitle(b)} ${b.id}`.toLowerCase().includes(q)) : all).slice(0, q ? 40 : 15);
  return `<div class="card">
    <h2 class="card-title">Numbers</h2>
    <div class="field-help">Fix an amount typed on an order, like a deposit that was entered wrong. Search for the order, change the number and tap Save numbers. This never sends an email or changes the order's steps.</div>
    ${only ? '<button type="button" class="btn-sm" onclick="state.numbersOnly = \'\'; render();">Show all orders</button>' : ''}
    <div class="field" ${only ? 'hidden' : ''}><label for="numbers-q">Search by name, email or order</label>
      <input type="search" id="numbers-q" value="${esc(state.numbersQuery || '')}" oninput="state.numbersQuery = this.value; clearTimeout(window.numbersT); window.numbersT = setTimeout(() => { render(); const el = document.getElementById('numbers-q'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 300)" /></div>
  </div>
  ${list.length ? list.map(renderNumbersCard).join('') : '<div class="card"><div class="field-help">No orders match.</div></div>'}
  ${!only && !q && all.length > list.length ? '<div class="field-help" style="padding:0 1rem;">Showing the newest 15. Search to find an older order.</div>' : ''}`;
}

const money0 = v => (Number(v) || 0).toFixed(2);
function renderNumbersCard(b) {
  const total = orderSum(b), rules = rulesFor(b);
  const money = v => (Number(v) || 0).toFixed(2);
  const input = (id, label, val, help, ph) => `<div class="field"><label for="${id}-${b.id}">${label}</label>
    <input type="number" inputmode="decimal" min="0" step="0.01" id="${id}-${b.id}" value="${val}" ${ph ? `placeholder="${ph}"` : ''} />${help ? `<div class="field-help">${help}</div>` : ''}</div>`;
  const fee = Number(rules.shippingFee) || 0, pack = Number(rules.packagingFee) || 0;
  const dep = Number(b.depositAmount) || 0;
  const bal = Number(b.balancePaid) || 0, shipDep = Number(b.shippingDepositPaid) || 0;
  const owed = Math.round((total + fee) * 100) / 100, paid = Math.round((dep + bal + shipDep) * 100) / 100;
  const r = postageRefund(b, rules), refundSent = Number(b.refundSent) || 0;
  const left = Math.round((owed - paid) * 100) / 100;
  const summary = [
    `Owed: $${money(total)} order + $${money(fee)} shipping deposit = $${money(owed)}`,
    `Paid: $${money(paid)}${left > 0.004 ? ` (still owed $${money(left)})` : left < -0.004 ? ` ($${money(-left)} over)` : ' (paid in full)'}`,
    r ? `Shipping deposit refund: $${money(r.refund)}${refundSent ? ` (sent $${money(refundSent)}${r.refund - refundSent > 0.004 ? `, still to send $${money(r.refund - refundSent)}` : ''})` : ', not sent yet'}` : 'Shipping deposit refund: enter what postage cost to work it out'
  ];
  return `<div class="card" id="numbers-${esc(b.id)}">
    <h3 class="card-title">${esc(orderTitle(b))}</h3>
    <div class="field-help">${esc(b.clientName || '')} · ${esc(b.clientEmail || '')} · ${esc(phaseLabel(b.phase || 'estimate'))}</div>
    <ul class="numbers-summary">${summary.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    <fieldset class="owner-edit-item"><legend>Payments received</legend>
    ${input('num-dep', 'Deposit received ($)', money(b.depositAmount), b.depositAt ? `Paid on ${esc(formatAustinTime(b.depositAt))}.` : 'No deposit is marked paid on this order yet, so it is not counted in the final payment.')}
    ${input('num-bal', 'Balance paid ($)', b.balancePaid ? money(b.balancePaid) : '', b.balancePaidAt ? `Paid on ${esc(formatAustinTime(b.balancePaidAt))}. ` : `Order total minus the deposit: $${money(Math.max(0, total - dep))}.`, money(Math.max(0, total - dep)))}
    ${input('num-ship', 'Shipping deposit paid ($)', b.shippingDepositPaid ? money(b.shippingDepositPaid) : '', `Normally $${money(fee)}: $${money(pack)} packaging plus postage, and the unused part is refunded.`, money(fee))}
    </fieldset>
    <fieldset class="owner-edit-item"><legend>Shipping and refund</legend>
    ${input('num-post', 'What postage cost ($)', b.postageCost === '' || b.postageCost == null ? '' : money(b.postageCost), 'Refund = shipping deposit - packaging - postage.')}
    ${input('num-refund', 'Refund sent to the customer ($)', b.refundSent ? money(b.refundSent) : '', r ? `Refund owed: $${money(r.refund)}.${b.refundSentAt ? ` Sent ${esc(formatAustinTime(b.refundSentAt))}.` : ''}` : '', r ? money(r.refund) : '')}
    </fieldset>
    <fieldset class="owner-edit-item"><legend>Order charges</legend>
    ${input('num-roll', 'Special order roll ($)', money(b.specialOrderCost))}
    ${(b.extraCharges || []).map((c, n) => input('num-x' + n, `Added charge: ${esc(c.label)} ($)`, money(c.amount))).join('')}
    </fieldset>
    <div class="alert error" id="numbers-err-${esc(b.id)}"></div><div class="alert success" id="numbers-ok-${esc(b.id)}"></div>
    <button type="button" class="btn-primary" style="width:auto;" onclick="saveNumbers('${esc(b.id)}')">Save numbers</button>
  </div>`;
}

async function saveNumbers(batchId) {
  const b = state.batches.find(x => x.id === batchId);
  if (!b) return;
  const read = id => { const el = document.getElementById(`${id}-${batchId}`); return el ? el.value.trim() : null; };
  const num = v => Math.round(parseFloat(v) * 100) / 100;
  const dep = read('num-dep'), post = read('num-post'), roll = read('num-roll');
  const bal = read('num-bal'), ship = read('num-ship'), refund = read('num-refund');
  const extras = (b.extraCharges || []).map((c, n) => read('num-x' + n));
  const bad = [dep, roll, bal, ship, refund, ...extras].some(v => v !== null && v !== '' && !(num(v) >= 0)) || [dep, roll, ...extras].some(v => v !== null && !(num(v) >= 0)) || (post !== '' && post !== null && !(num(post) >= 0));
  if (bad) { showAlert(`numbers-err-${batchId}`, 'Every amount must be a number, 0 or more.', 'error'); return; }
  b.depositAmount = num(dep);
  const now = new Date().toISOString(), had = x => x !== '' && x !== null && num(x) > 0;
  b.balancePaid = had(bal) ? num(bal) : null;
  b.balancePaidAt = had(bal) ? (b.balancePaidAt || now) : '';
  b.shippingDepositPaid = had(ship) ? num(ship) : null;
  b.refundSent = had(refund) ? num(refund) : null;
  b.refundSentAt = had(refund) ? (b.refundSentAt || now) : '';
  b.postageCost = post === '' ? '' : num(post);
  if (roll !== money0(b.specialOrderCost)) b.specialOrderCost = num(roll);
  b.extraCharges = (b.extraCharges || []).map((c, n) => ({ ...c, amount: num(extras[n]) }));
  try { await upsertBatch(b); render(); showAlert(`numbers-ok-${batchId}`, 'Saved.', 'success'); }
  catch (e) { showAlert(`numbers-err-${batchId}`, "Couldn't save. Check you're logged in.", 'error'); }
}

// ── REVIEWS FROM CUSTOMERS ────────────────────────────────────────────────
function openReviewForm(id) {
  state.reviewFor = { id, sent: false, focus: true };
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
  return `<div class="card ${r.focus ? 'review-gold' : ''}" id="review-card">
    <h3 class="card-title">Review: ${esc(orderTitle(b))}</h3>
    <div class="field">
      <span class="field-label" id="review-stars-label">Rating</span>
      <div class="review-stars" role="radiogroup" aria-labelledby="review-stars-label">
        ${[1, 2, 3, 4, 5].map(n => { const v = r.rating || 0, fill = v >= n ? 100 : v >= n - 0.5 ? 50 : 0;
          return `<span class="star"><span class="star-bg" aria-hidden="true">★</span><span class="star-fill" aria-hidden="true" style="width:${fill}%"><span class="star-in">★</span></span>
            <button type="button" role="radio" class="half-l" aria-checked="${v === n - 0.5}" aria-label="${n - 0.5} stars" onclick="state.reviewFor.rating = ${n - 0.5}; render(); document.querySelector('.review-stars .half-l[aria-label=&quot;${n - 0.5} stars&quot;]')?.focus();"></button>
            <button type="button" role="radio" class="half-r" aria-checked="${v === n}" aria-label="${n} star${n > 1 ? 's' : ''}" onclick="state.reviewFor.rating = ${n}; render(); document.querySelector('.review-stars .half-r[aria-label=&quot;${n} star${n > 1 ? 's' : ''}&quot;]')?.focus();"></button></span>`; }).join('')}
        <span class="field-help review-rating-note" aria-live="polite">${r.rating ? `${r.rating} out of 5` : 'Tap the left half of a star for a half star.'}</span>
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
    <div class="field">
      <label for="review-photos">Photos of your print (optional, up to 2)</label>
      <input type="file" id="review-photos" accept="image/*" multiple onchange="pickReviewPhotos(this.files)" />
      <div class="field-help" id="review-photo-status">${(r.photos || []).length ? `${r.photos.length} photo${r.photos.length > 1 ? 's' : ''} chosen.` : ''}</div>
    </div>
    <div class="alert error" id="review-err"></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <button type="button" class="btn-primary ${r.focus ? 'btn-gold' : ''}" id="review-send" style="width:auto;" onclick="sendReview()">Send review</button>
      <button type="button" class="btn-sm" onclick="state.reviewFor = null; render();">Not now</button>
    </div>
  </div>`;
}

function firstNameAndInitial(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : (parts[0] || '');
}

// Keeps the (at most 2) chosen files; they are shrunk and uploaded when the review is sent.
function pickReviewPhotos(files) {
  const list = Array.from(files || []);
  state.reviewFor.photos = list.slice(0, 2);
  const el = document.getElementById('review-photo-status');
  if (el) el.textContent = list.length > 2 ? 'Only the first 2 photos will be sent.' : list.length ? `${list.length} photo${list.length > 1 ? 's' : ''} chosen.` : '';
}

async function sendReview() {
  const r = state.reviewFor;
  const b = state.batches.find(x => x.id === r.id) || {};
  const text = String(r.text || '').trim();
  if (text.length < 3) { showAlert('review-err', 'Please write a few words.', 'error'); return; }
  const btn = document.getElementById('review-send');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
  try {
    const urls = [];
    for (const file of (r.photos || []).slice(0, 2)) {
      try {
        const blob = await resizePhoto(file, 1200);
        const path = `reviews/${String(r.id).replace(/[^A-Za-z0-9_-]/g, '')}-${Date.now()}-${urls.length}.jpg`;
        await uploadStoredPhoto(path, blob, SUPA_KEY);
        urls.push(GALLERY_PUBLIC_PREFIX + path);
      } catch (e) { console.error('Review photo error:', e); }
    }
    if ((r.photos || []).length && urls.length < Math.min(2, r.photos.length) && !urls.length) {
      if (btn) { btn.disabled = false; btn.textContent = 'Send review'; }
      showAlert('review-err', "Couldn't upload your photos. Try JPG or PNG pictures, or send the review without them.", 'error');
      return;
    }
    const send = rating => supaFetch('/rpc/submit_review', { method: 'POST', body: JSON.stringify({
      p_token: b.accessToken, p_name: String(r.name ?? firstNameAndInitial(b.clientName)).trim(), p_text: text, p_rating: rating || null, p_photos: urls
    }) });
    // Half stars need supabase/owner-tools.sql and order-links.sql to have been run again. Until then the database only
    // takes whole stars, so a half star is sent rounded down rather than losing the review.
    try { await send(r.rating); }
    catch (e) { if (r.rating && r.rating % 1) await send(Math.floor(r.rating)); else throw e; }
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
      <div>${r.rating ? `<span aria-label="${r.rating} stars">${'★'.repeat(Math.floor(r.rating))}${r.rating % 1 ? '½' : ''}</span> ` : ''}"${esc(r.text)}"${r.name ? ` <span class="field-help">- ${esc(r.name)}</span>` : ''}</div>
      ${(r.photos || []).length ? `<div class="finished-photo-row">${r.photos.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer"><img src="${esc(u)}" alt="Photo from the customer" loading="lazy" /></a>`).join('')}</div>` : ''}
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
      const reviews = [{ id: settingsId(), name: r.name || '', text: r.text, designId: '', photos: r.photos || [], rating: Number(r.rating) || null, date: String(r.created_at || '').slice(0, 10) }].concat(state.settings.reviews || []);
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
    <div class="field-help" style="margin-bottom:8px;">Saved as soon as you change it. Grams come off when an order moves to Printing. Bought rolls on Amazon? Read the invoice: it adds the grams here, the cost to your expenses, and any new colors.</div>
    ${renderInvoiceReader('stock')}
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
// owner_private 'money'.ads: [{ id, date, where, amount }]: what SoloPrint spends on ads (Facebook, flyers...), kept apart from other expenses.
function adCosts() { return Array.isArray(moneyData().ads) ? moneyData().ads : []; }
const AD_PLACES = ['Facebook', 'Instagram', 'Google', 'TikTok', 'Nextdoor', 'Craigslist', 'Flyers', 'Craft fair', 'Business cards'];

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
  const months = MONTH_NAMES.map(name => ({ name, sales: 0, material: 0, expenses: 0, ads: 0, orders: 0 }));
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
  const ads = adCosts().filter(e => String(e.date).startsWith(String(year)));
  ads.forEach(e => { const mm = Number(String(e.date).slice(5, 7)) - 1; if (months[mm]) months[mm].ads += Number(e.amount) || 0; });
  const total = months.reduce((t, m) => ({ sales: t.sales + m.sales, material: t.material + m.material, expenses: t.expenses + m.expenses, ads: t.ads + m.ads, orders: t.orders + m.orders }), { sales: 0, material: 0, expenses: 0, ads: 0, orders: 0 });
  const unpaid = state.batches.filter(b => ['order_received', 'production', 'delivered'].includes(b.phase) && b.paymentStatus !== 'payment_received');
  return { months, orders: orders.sort((a, b) => a.date - b.date), expenses: exp, ads, total, unpaid };
}

function money2(n) { const v = Number(n) || 0; return `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`; }

// Money & Sales: every order by date, newest first (the Orders tab is organised by customer instead).
function renderOwnerOrdersList() {
  const q = String(state.ordersListQuery || '').trim().toLowerCase();
  const all = [...state.batches].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .filter(b => !q || `${b.clientName} ${b.clientEmail} ${orderTitle(b)} ${b.id}`.toLowerCase().includes(q));
  const max = state.ordersListMax || 25, rows = all.slice(0, max);
  const day = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `<div class="card" id="all-orders">
    <h3 class="card-title">All orders by date</h3>
    <div class="field-help">Newest first. ${state.ownerHistoryAll ? '' : `Only open orders and the last ${RECENT_ORDER_DAYS} days are loaded here.`}</div>
    <div class="field"><label for="all-orders-q">Search name, email, item or order number</label>
      <input type="search" id="all-orders-q" value="${esc(state.ordersListQuery || '')}" oninput="state.ordersListQuery = this.value; state.ordersListMax = 25; clearTimeout(window.aolT); window.aolT = setTimeout(() => { render(); const el = document.getElementById('all-orders-q'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 250)" /></div>
    <div class="table-scroll"><table class="all-orders-table">
      <thead><tr><th scope="col">Date</th><th scope="col">Customer</th><th scope="col">Order</th><th scope="col">Step</th><th scope="col">Total</th><th scope="col">Payment</th><th scope="col"><span class="sr-only">Open</span></th></tr></thead>
      <tbody>${rows.map(b => { const total = batchTotal(b); return `<tr>
        <td data-label="Date">${esc(day(b.createdAt))}</td><td data-label="Customer">${esc(b.clientName || b.clientEmail || '')}</td><td data-label="Order">${esc(orderTitle(b))}</td>
        <td data-label="Step">${esc(phaseLabel(b.phase || 'estimate'))}</td><td data-label="Total">${total === null ? '–' : '$' + total.toFixed(2)}</td><td data-label="Payment">${esc(paymentLabel(b.paymentStatus || 'unpaid'))}</td>
        <td><button type="button" class="btn-sm" onclick="focusOwnerOrder('${esc(b.id)}')" aria-label="Open order ${esc(b.id)} in Customers">Open</button></td></tr>`; }).join('')
        || '<tr><td colspan="7">No orders match.</td></tr>'}</tbody>
    </table></div>
    ${all.length > rows.length ? `<button type="button" class="btn-sm" onclick="state.ordersListMax = ${max + 25}; render();">Show more (${all.length - rows.length} more)</button>` : ''}
  </div>`;
}
function renderOwnerMoneyPage() {
  const years = [...new Set(state.batches.map(b => new Date(paidDate(b)).getFullYear()).concat(expenses().concat(adCosts()).map(e => Number(String(e.date).slice(0, 4))), etsyOrders().concat(etsyCosts()).map(o => Number(String(o.date).slice(0, 4))), [new Date().getFullYear()]))]
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
        <div class="stat-card"><div class="stat-val">${money2(r.total.ads)}</div><div class="stat-label">Ad costs</div></div>
        <div class="stat-card"><div class="stat-val">${money2(r.total.sales - r.total.expenses - r.total.ads)}</div><div class="stat-label">Sales minus expenses and ads</div></div>
      </div>
      ${r.unpaid.length ? `<p class="field-help">Not paid yet: ${r.unpaid.length} order${r.unpaid.length === 1 ? '' : 's'}, ${money2(r.unpaid.reduce((s, b) => s + orderSum(b), 0))}. These count once you mark them paid.</p>` : ''}
      <div class="table-scroll">
        <table class="money-table">
          <thead><tr><th scope="col">Month</th><th scope="col">Orders</th><th scope="col">Sales</th><th scope="col">Material (est.)</th><th scope="col">Profit after material</th><th scope="col">Expenses</th><th scope="col">Ads</th></tr></thead>
          <tbody>${r.months.map(m => `<tr><th scope="row">${m.name}</th><td>${m.orders || ''}</td><td>${m.sales ? money2(m.sales) : ''}</td><td>${m.material ? money2(m.material) : ''}</td><td>${m.sales ? money2(m.sales - m.material) : ''}</td><td>${m.expenses ? money2(m.expenses) : ''}</td><td>${m.ads ? money2(m.ads) : ''}</td></tr>`).join('')}</tbody>
          <tfoot><tr><th scope="row">Total</th><td>${r.total.orders}</td><td>${money2(r.total.sales)}</td><td>${money2(r.total.material)}</td><td>${money2(r.total.sales - r.total.material)}</td><td>${money2(r.total.expenses)}</td><td>${money2(r.total.ads)}</td></tr></tfoot>
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
      <p class="field-help" style="margin-top:0;">Filament, parts, tools, shipping supplies: anything you bought for the shop. Bought on Amazon? Read the invoice instead of typing it: filament rolls also go into your stock, and new colors into your colors.</p>
      ${renderInvoiceReader('money')}
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
    </div>
    ${renderAdsCard(year, r)}
    ${renderEtsyCard(year, r.total)}`;
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
function renderAdsCard(year, r) {
  const today = new Date().toISOString().slice(0, 10);
  const byPlace = {};
  r.ads.forEach(a => { byPlace[a.where] = (byPlace[a.where] || 0) + (Number(a.amount) || 0); });
  const places = Object.entries(byPlace).sort((a, b) => b[1] - a[1]);
  return `<div class="card" id="ads-card">
    <h3 class="card-title">Ad costs in ${year}</h3>
    <p class="field-help" style="margin-top:0;">What you spend advertising SoloPrint: Facebook or Instagram ads, Google, flyers, business cards, a craft fair table. Etsy Ads go in the Etsy card below.</p>
    <div class="expense-form">
      <div class="field"><label for="ad-date">Date</label><input type="date" id="ad-date" value="${today}" /></div>
      <div class="field" style="flex:2;"><label for="ad-where">Where</label><input type="text" id="ad-where" maxlength="60" list="ad-places" placeholder="e.g. Facebook" />
        <datalist id="ad-places">${[...new Set(AD_PLACES.concat(adCosts().map(a => a.where)))].map(p => `<option value="${esc(p)}"></option>`).join('')}</datalist></div>
      <div class="field"><label for="ad-amount">Amount ($)</label><input type="number" id="ad-amount" min="0" step="0.01" /></div>
      <button type="button" class="btn-sm" id="ad-add" onclick="addAdCost()">Add ad cost</button>
    </div>
    <div class="alert error" id="ad-err"></div>
    ${r.ads.length ? `<p class="field-help" id="ad-summary">${money2(r.total.ads)} on ads in ${year}${places.length > 1 ? ` (${places.map(([p, n]) => `${esc(p)} ${money2(n)}`).join(', ')})` : ''}.${r.total.orders ? ` That's ${money2(r.total.ads / r.total.orders)} per paid site order.` : ''}</p>
      <div class="table-scroll"><table class="money-table">
        <thead><tr><th scope="col">Date</th><th scope="col">Where</th><th scope="col">Amount</th><th scope="col"><span class="sr-only">Remove</span></th></tr></thead>
        <tbody>${r.ads.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).map(a => `<tr><td>${esc(a.date)}</td><td>${esc(a.where)}</td><td>${money2(a.amount)}</td><td><button type="button" class="btn-sm danger" onclick="removeAdCost('${esc(a.id)}')" aria-label="Remove ${esc(a.where)} ad ${esc(a.date)}">✕</button></td></tr>`).join('')}</tbody>
      </table></div>` : `<div class="field-help">No ad costs in ${year} yet.</div>`}
  </div>`;
}
function addAdCost() {
  const v = k => String((document.getElementById(`ad-${k}`) || {}).value || '').trim();
  const amount = parseFloat(v('amount'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v('date')) || !v('where') || !Number.isFinite(amount) || amount < 0) { showAlert('ad-err', 'Fill in the date, where the ad ran, and the amount.', 'error'); return; }
  state.moneyYear = Number(v('date').slice(0, 4));
  writeMoney({ ads: adCosts().concat({ id: settingsId(), date: v('date'), where: v('where').slice(0, 60), amount: Math.round(amount * 100) / 100 }) });
}
function removeAdCost(id) {
  if (!confirm('Remove this ad cost?')) return;
  writeMoney({ ads: adCosts().filter(a => a.id !== id) });
}
function removeExpense(id) {
  if (!confirm('Remove this expense?')) return;
  writeMoney({ expenses: expenses().filter(e => e.id !== id) });
}

function exportMoneyReport(year) {
  const r = moneyReport(year);
  const round = n => Math.round((Number(n) || 0) * 100) / 100;
  const summary = [['Month', 'Orders', 'Sales', 'Material (est.)', 'Profit after material', 'Expenses', 'Ads']]
    .concat(r.months.map(m => [m.name, m.orders, round(m.sales), round(m.material), round(m.sales - m.material), round(m.expenses), round(m.ads)]),
      [['Total', r.total.orders, round(r.total.sales), round(r.total.material), round(r.total.sales - r.total.material), round(r.total.expenses), round(r.total.ads)]],
      [[], ['Sales minus expenses and ads', '', round(r.total.sales - r.total.expenses - r.total.ads)], ['Filament cost per kg used for estimates', '', costPerKg()]]);
  const orders = [['Paid', 'Order #', 'Customer', 'Email', 'Items', 'Sale', 'Material (est.)', 'Profit']]
    .concat(r.orders.map(o => [o.date.toISOString().slice(0, 10), o.b.id, o.b.clientName, o.b.clientEmail, orderTitle(o.b), round(o.sales), round(o.material), round(o.sales - o.material)]));
  const exp = [['Date', 'What', 'Amount']].concat(r.expenses.map(e => [e.date, e.what, round(e.amount)]));
  const ey = etsyYear(year);
  const etsy = [['Date', 'Etsy order', 'Buyer', 'Items', 'Item sales', 'Shipping paid', 'Sales tax (not counted)', 'Fees', 'Shipping costs', 'Marketing', 'Material (est.)', 'Refund', 'Profit', 'Note']]
    .concat(ey.orders.slice().reverse().map(o => [o.date, o.etsyId || '', o.buyer || '', o.items || '', round(o.sale), round(o.shipping), round(o.tax), round(o.fees), round(o.label), round(o.ads), round(etsyMaterial(o)), round(o.refund), round(etsyProfit(o)), o.note || '']),
      [[], ['Etsy marketing and other charges'], ...ey.costs.map(c => { const k = etsyCostKind(c); return [c.date, '', '', c.what, '', '', '', k === 'fees' ? round(c.amount) : '', k === 'shipping' ? round(c.amount) : '', k === 'ads' ? round(c.amount) : '']; })]);
  summary.push([], ['Etsy sales (with shipping paid)', '', round(ey.t.sales)], ['Etsy fees and charges', '', round(ey.t.fees + ey.t.other)], ['Etsy shipping costs', '', round(ey.t.labels)], ['Etsy marketing', '', round(ey.t.ads)],
    ['Etsy material (est.)', '', round(ey.t.material)], ['Etsy profit', '', round(ey.t.profit)], ['Both shops: profit after material, fees, shipping, marketing, expenses and ads', '', round(r.total.sales - r.total.material - r.total.expenses - r.total.ads + ey.t.profit)]);
  if (typeof XLSX === 'undefined') { showAlert('money-err', "The spreadsheet tool didn't load. Check your connection and try again.", 'error'); return; }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(orders), 'Paid orders');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(exp), 'Expenses');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Date', 'Where', 'Amount']].concat(r.ads.map(a => [a.date, a.where, round(a.amount)]))), 'Ads');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(etsy), 'Etsy');
  XLSX.writeFile(wb, `soloprint-${year}-taxes.xlsx`);
}

// ── ETSY SALES: import Etsy's download files, or type sales in by hand ────
// owner_private 'etsy' (never in an order: buyers' names stay owner-only; addresses are never kept):
// { orders: [{ id, etsyId, date 'YYYY-MM-DD', buyer, items, sale, shipping, tax, fees, cardFee, label, grams, material, refund, note, edited }],
//   costs: [{ id, date, what, amount }] (Etsy charges not tied to one order: listing fees, ads, labels without an order),
//   seen: [statement line fingerprints already counted] }.
// Etsy profit for an order = sale + shipping paid - refund - fees - shipping label - material. Sales tax is shown but Etsy pays it.
// Material: typed $ amount, else grams x your cost per kg (the same rule as site orders).
function etsyData() { return (state.ownerPrivate && state.ownerPrivate.etsy) || {}; }
function etsyOrders() { return Array.isArray(etsyData().orders) ? etsyData().orders : []; }
function etsyCosts() { return Array.isArray(etsyData().costs) ? etsyData().costs : []; }
function etsyNum(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }
function etsyMaterial(o) { return o.material !== null && o.material !== undefined && o.material !== '' ? etsyNum(o.material) : etsyNum((Number(o.grams) || 0) * costPerKg() / 1000); }
function etsyProfit(o) { return etsyNum(etsyNum(o.sale) + etsyNum(o.shipping) - etsyNum(o.refund) - etsyNum(o.fees) - etsyNum(o.label) - etsyNum(o.ads) - etsyMaterial(o)); }
// Marketing: Etsy Ads, Offsite Ads and other promotion. A charge typed or imported without a kind counts as marketing when its name says so.
function etsyIsAdsName(text) { return /\bads?\b|marketing|advertis|promot/i.test(String(text || '')); }
function etsyCostIsAds(c) { return c.kind ? c.kind === 'ads' : etsyIsAdsName(c.what); }
function etsyYear(year) { return etsyTotals(String(year)); }
function etsyAllTime() { return etsyTotals(''); }
function etsyTotals(y) {
  const orders = etsyOrders().filter(o => String(o.date).startsWith(y)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const costs = etsyCosts().filter(c => String(c.date).startsWith(y)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const active = etsyActiveSummaries();
  return { orders, costs, t: etsyCalc(orders, costs, active), summaries: active.filter(s => String(s.date).startsWith(y)), activeAll: active };
}
// Money for any period (a 'YYYY' or 'YYYY-MM' prefix, '' = all time): the same rule everywhere, so months add up to years.
function etsyPeriod(prefix, active) {
  const p = String(prefix || '');
  return etsyCalc(etsyOrders().filter(o => String(o.date).startsWith(p)), etsyCosts().filter(c => String(c.date).startsWith(p)), active || etsyActiveSummaries());
}
// Older imports saved a payment of the Etsy bill ("Card Payment") as a credit: it's neither profit nor cost.
function etsyIsBillPayment(c) { return /^credit: (card payment|payment)\b/i.test(String((c && c.what) || '')); }
function etsyCalc(orders, costs, active) {
  costs = costs.filter(c => !etsyIsBillPayment(c));
  // Counted: an active yearly summary, plus everything it doesn't cover (uploads inside it wait until it's replaced).
  const counted = orders.filter(o => (o.summary ? active.includes(o) : !etsyCoveredBySummary(o.date, active)));
  const countedCosts = costs.filter(c => etsyCostCounted(c, active));
  const sum = f => etsyNum(counted.reduce((s, o) => s + f(o), 0));
  const costSum = kind => etsyNum(countedCosts.filter(c => etsyCostKind(c) === kind).reduce((s, c) => s + etsyNum(c.amount), 0));
  const t = { orders: counted.length, sales: sum(o => etsyNum(o.sale) + etsyNum(o.shipping) - etsyNum(o.refund)), fees: sum(o => etsyNum(o.fees)),
    labels: etsyNum(sum(o => etsyNum(o.label)) + costSum('shipping')), material: sum(etsyMaterial), tax: sum(o => etsyNum(o.tax)),
    other: costSum('fees'), ads: etsyNum(sum(o => etsyNum(o.ads)) + costSum('ads')) };
  t.profit = etsyNum(t.sales - t.fees - t.labels - t.material - t.other - t.ads);
  return t;
}

// Reading Etsy's files: columns are found by name, so their order (and extra columns) don't matter.
function etsyCsvRows(text) {
  let s = String(text || '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim()));
}
function etsyMoney(v) {
  let s = String(v === undefined || v === null ? '' : v).trim();
  if (!s || /^-+$/.test(s)) return 0;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /^[A-Z]{0,3}\s*\$?\s*-/.test(s);
  s = s.replace(/[^0-9.]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? etsyNum(neg ? -n : n) : 0;
}
function etsyDate(v) {
  const s = String(v || '').trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  const d = new Date(s.replace(/(\d)(st|nd|rd|th)\b/, '$1'));
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function etsyTable(rows) {
  const head = (rows[0] || []).map(h => String(h).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  const col = (...names) => { for (const n of names) { const k = head.indexOf(n); if (k >= 0) return k; } return -1; };
  return { head, col, body: rows.slice(1) };
}
// Etsy's fee on the shipping the buyer paid ("Transaction fee: Shipping") is a shipping cost, not a fee on the sale.
function etsyShipFee(title) { return /^\s*(transaction fee:?\s*shipping|shipping transaction fee)\s*$/i.test(String(title || '')); }
// Statements imported before that rule put those fees under Etsy fees: move them once (done with the next import, or the button on the card).
function etsyShipFeeMoves(orders) {
  const d = etsyData(), moves = [];
  if (d.shipFeesMoved && d.adsMoved) return [];
  (d.seen || []).forEach(print => {
    const p = String(print).split('|');
    if (p.length < 5) return;
    const title = p.slice(2, -2).join('|'), info = p[p.length - 2], amount = etsyNum(p[p.length - 1]);
    const to = !d.shipFeesMoved && /^fees?$/.test(p[1]) && etsyShipFee(title) ? 'label'
      : !d.adsMoved && (p[1] === 'marketing' || (/^fees?$/.test(p[1]) && etsyIsAdsName(title))) ? 'ads' : '';
    if (!to || !amount) return;
    const o = orders.find(x => String(x.etsyId) === (etsyOrderNumber(info) || etsyOrderNumber(title)));
    if (o && !o.edited) moves.push({ o, amount, to });
  });
  return moves;
}
function etsyMoveShipFees(orders) {
  etsyShipFeeMoves(orders).forEach(({ o, amount, to }) => { o.fees = etsyNum(Math.max(0, etsyNum(o.fees) - amount)); o[to] = etsyNum(etsyNum(o[to]) + amount); });
}
function fixEtsyShipFees() {
  const orders = etsyOrders().map(o => ({ ...o }));
  etsyMoveShipFees(orders);
  writeEtsy({ orders, shipFeesMoved: true, adsMoved: true }, 'Moved. Shipping transaction fees now count as shipping costs, and Offsite Ads fees as marketing.');
}
// A yearly summary typed by hand (`summary: true`, from Etsy's activity summary) stands in for that year's sales and charges up to its date,
// until each of those months has its monthly statement uploaded (and its Orders file, for months the statement shows sales in).
// Then it drops out and the uploads count. Uploads inside an active summary are saved but not counted yet.
function etsyMonthList(key) { const v = etsyData()[key]; return Array.isArray(v) ? v : []; }
function etsySummaryMissing(s, got) {
  got = got || { statement: etsyMonthList('statementMonths'), sales: etsyMonthList('saleMonths'), orders: etsyMonthList('ordersMonths') };
  const y = String(s.date).slice(0, 4), last = Number(String(s.date).slice(5, 7)) || 12, miss = [];
  // Months before the first statement ever uploaded are before the shop opened: Etsy has no statement for them.
  const first = got.statement.slice().sort()[0] || '9999-99';
  for (let m = 1; m <= last; m++) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    // Only within the year statements start: a year with no statements at all still needs every month.
    if (k < first.slice(0, 7) && first.slice(0, 4) === y) continue;
    if (!got.statement.includes(k)) miss.push({ month: k, need: 'statement' });
    else if (got.sales.includes(k) && !got.orders.includes(k)) miss.push({ month: k, need: 'orders' });
  }
  return miss;
}
function etsyActiveSummaries(orders) { return (orders || etsyOrders()).filter(o => o.summary && etsySummaryMissing(o).length); }
function etsyCoveredBySummary(date, summaries) {
  const d = String(date || '');
  return !!d && (summaries || etsyActiveSummaries()).some(s => String(s.date).slice(0, 4) === d.slice(0, 4) && d <= String(s.date));
}
function etsyPending(o, summaries) { return !o.summary && etsyCoveredBySummary(o.date, summaries); }
// A charge typed by hand on a summary's own date (like its yearly ad total) is part of that summary: counted with it, removed with it.
function etsyHandTyped(c) { return !!c.manual || !/\)\s*$/.test(String(c.what || '')); }
function etsySummaryPart(c, summaries) { return etsyHandTyped(c) && (summaries || etsyActiveSummaries()).some(s => String(s.date) === String(c.date)); }
function etsyCostCounted(c, summaries) { return !etsyCoveredBySummary(c.date, summaries) || etsySummaryPart(c, summaries); }
function etsyMonthName(k) { return new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); }
function etsyOrderNumber(text) { const m = String(text || '').match(/order\s*#?\s*(\d{5,})/i); return m ? m[1] : ''; }
function etsyKind(tb) {
  const has = n => tb.head.includes(n);
  if (has('type') && has('title') && (has('net') || has('amount'))) return 'statement';
  if (has('order id') && has('item name')) return 'items';
  if (has('order id') && (has('order value') || has('order total'))) return 'orders';
  return '';
}

// Works out what a file would change, without saving: the owner sees this first and taps "Add to my sales".
function etsyPlan(rows, fileName) {
  const tb = etsyTable(rows), kind = etsyKind(tb);
  const plan = { kind, fileName, add: [], update: [], keep: 0, covered: 0, costs: [], fees: [], items: [], skipped: 0, seen: [], months: [], saleMonths: [] };
  if (!kind) return plan;
  const have = new Map(etsyOrders().map(o => [String(o.etsyId), o]));
  const get = (r, ...names) => { const k = tb.col(...names); return k >= 0 ? r[k] : ''; };
  if (kind === 'orders') {
    tb.body.forEach(r => {
      const etsyId = String(get(r, 'order id')).trim();
      const date = etsyDate(get(r, 'sale date', 'date'));
      if (!/^\d+$/.test(etsyId) || !date) { plan.skipped++; return; }
      plan.months.push(date.slice(0, 7));
      if (etsyCoveredBySummary(date)) plan.covered++;
      const total = etsyMoney(get(r, 'order total')), adj = String(get(r, 'adjusted order total')).trim();
      const adjCard = String(get(r, 'adjusted card processing fees')).trim();
      const o = { etsyId, date, buyer: String(get(r, 'full name', 'buyer') || '').trim().slice(0, 80),
        sale: etsyNum(etsyMoney(get(r, 'order value')) - Math.abs(etsyMoney(get(r, 'discount amount')))),
        shipping: etsyNum(etsyMoney(get(r, 'shipping')) - Math.abs(etsyMoney(get(r, 'shipping discount')))),
        tax: etsyMoney(get(r, 'sales tax')),
        cardFee: Math.abs(adjCard && !/^-+$/.test(adjCard) ? etsyMoney(adjCard) : etsyMoney(get(r, 'card processing fees'))),
        refund: adj && !/^-+$/.test(adj) && etsyMoney(adj) < total ? etsyNum(total - etsyMoney(adj)) : 0 };
      const was = have.get(etsyId);
      if (!was) plan.add.push(o);
      else if (was.edited) plan.keep++;
      else plan.update.push(o);
    });
  } else if (kind === 'items') {
    const byOrder = new Map();
    tb.body.forEach(r => {
      const id = String(get(r, 'order id')).trim(), name = String(get(r, 'item name')).trim();
      if (!id || !name) { plan.skipped++; return; }
      const qty = parseInt(get(r, 'quantity'), 10) || 1;
      byOrder.set(id, (byOrder.get(id) || []).concat(qty > 1 ? `${name} x${qty}` : name));
    });
    byOrder.forEach((names, etsyId) => { if (have.has(etsyId)) plan.items.push({ etsyId, items: names.join('; ').slice(0, 300) }); else plan.skipped++; });
  } else {
    // Every money line counts except deposits (payouts to the bank) and reserve holds. Sales already in the Orders file are skipped
    // (counted there); a sale only in the statement becomes a sale here. Credits (positive lines) take money off that kind of cost.
    const seen = new Set(etsyData().seen || []), fresh = new Map();
    // Etsy lists an order's fees and the buyer's sales tax before its "Payment for Order" line: read the sales first,
    // so every fee and tax line finds its order.
    const isSale = r => String(get(r, 'type')).trim().toLowerCase() === 'sale';
    tb.body.filter(isSale).concat(tb.body.filter(r => !isSale(r))).forEach(r => {
      const type = String(get(r, 'type')).trim().toLowerCase(), title = String(get(r, 'title')).trim(), info = String(get(r, 'info')).trim();
      const date = etsyDate(get(r, 'date'));
      const netText = String(get(r, 'net')).trim(), feeText = String(get(r, 'fees taxes')).trim(), amtText = String(get(r, 'amount')).trim();
      const val = t => (t && !/^-+$/.test(t) ? etsyMoney(t) : 0);
      const net = val(netText) || val(amtText) || val(feeText);
      if (date) { plan.months.push(date.slice(0, 7)); if (type === 'sale') plan.saleMonths.push(date.slice(0, 7)); }
      // Not profit or cost: deposits to the bank, reserve holds, and payments of your Etsy bill (by card or bank).
      if (/deposit|reserve|payment/.test(type) || /^deposit|reserve|card payment/i.test(title) || !date || !net) { plan.skipped++; return; }
      const etsyId = etsyOrderNumber(info) || etsyOrderNumber(title), o = etsyId && (have.get(etsyId) || fresh.get(etsyId));
      if (type === 'sale' && etsyId && have.has(etsyId)) { plan.skipped++; return; }   // counted from the Orders file
      // Buyer's sales tax: Etsy pays it, so it's never profit. A sale read from the statement includes it, so it's taken back out of that sale.
      const buyerTax = /^(tax|vat|sales tax)/.test(type) && /sales tax|paid by buyer|remitted/i.test(title);
      if (buyerTax && !(o && o.fromStatement)) { plan.skipped++; return; }
      const amount = Math.abs(net), credit = net > 0 && type !== 'sale' && !buyerTax;
      const print = [date, type, title, info, amount].join('|') + (credit ? '|credit' : '');
      if (seen.has(print)) { plan.keep++; return; }
      if (etsyCoveredBySummary(date)) plan.covered++;
      plan.seen.push(print);
      if (buyerTax) { plan.fees.push({ etsyId, amount, tax: true, cat: 'tax', what: title }); return; }
      if (type === 'sale') {
        const gross = val(amtText) || net, sale = { etsyId: etsyId || '', date, buyer: '', sale: etsyNum(net), shipping: 0, tax: etsyNum(Math.max(0, gross - net)), cardFee: 0, refund: 0, fromStatement: true };
        if (etsyId) { plan.add.push(sale); fresh.set(etsyId, sale); } else plan.costs.push({ date, what: `${title}${info ? ` (${info})` : ''}`.slice(0, 120), amount: -amount, kind: 'fee' });
        return;
      }
      const isRefund = type === 'refund' || /^refund/i.test(title);
      const isLabel = !isRefund && (type === 'shipping' || /shipping label|postage/i.test(title) || etsyShipFee(title));
      const isAds = !isRefund && !isLabel && (type === 'marketing' || etsyIsAdsName(title));
      const isCard = /processing fee/i.test(title);
      if (o && isCard && o.cardFee && !credit) return;   // already counted from the Orders file
      const signed = credit ? -amount : amount;
      const cat = isRefund ? 'refund' : isLabel ? 'label' : isAds ? 'ads' : 'fees';
      if (o) plan.fees.push({ etsyId, amount: signed, label: isLabel, ads: isAds, refund: isRefund, card: isCard, cat, what: title });
      else plan.costs.push({ date, what: `${credit ? 'Credit: ' : ''}${title}${info ? ` (${info})` : ''}`.slice(0, 120), amount: signed, kind: isAds ? 'ads' : 'fee' });
    });
  }
  return plan;
}
// One file or many at once (a whole year: the Orders file, Order Items and 12 statements). Files are read, put in a
// safe order (Orders, then Order Items, then statements, oldest first), planned one after another on a copy, and
// shown as one preview; nothing is saved until "Add to my sales".
const ETSY_KIND_ORDER = { orders: 0, items: 1, statement: 2 };
function etsyReadFile(file) {
  return new Promise(resolve => {
    const r = new FileReader();
    r.onerror = () => resolve({ file, rows: null });
    r.onload = () => {
      try {
        if (/\.xlsx?$/i.test(file.name)) {
          if (typeof XLSX === 'undefined') { resolve({ file, rows: null }); return; }
          const wb = XLSX.read(new Uint8Array(r.result), { type: 'array' });
          resolve({ file, rows: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false }) });
        } else resolve({ file, rows: etsyCsvRows(new TextDecoder().decode(r.result)) });
      } catch (e) { resolve({ file, rows: null }); }
    };
    r.readAsArrayBuffer(file);
  });
}
async function etsyFileChosen(input) {
  const files = [...(input.files || [])].slice(0, 60);
  input.value = '';
  if (!files.length) return;
  const read = await Promise.all(files.map(etsyReadFile));
  const firstDate = rows => { const tb = etsyTable(rows); const k = tb.col('sale date', 'date'); return (tb.body.map(r => etsyDate(k >= 0 ? r[k] : '')).filter(Boolean).sort()[0]) || ''; };
  const good = [], bad = [];
  read.forEach(x => { const kind = x.rows ? etsyKind(etsyTable(x.rows)) : ''; if (kind) good.push({ ...x, kind, first: firstDate(x.rows) }); else bad.push(x.file.name); });
  if (!good.length) { showAlert('etsy-err', `${bad.length > 1 ? "Those don't" : "That doesn't"} look like Etsy's files. Use the Orders or Order Items file from Download Data, or monthly statements (see the steps above).`, 'error'); return; }
  good.sort((a, b) => ETSY_KIND_ORDER[a.kind] - ETSY_KIND_ORDER[b.kind] || a.first.localeCompare(b.first) || a.file.name.localeCompare(b.file.name));
  const was = state.ownerPrivate && state.ownerPrivate.etsy;
  const plans = [];
  try {
    good.forEach(x => {
      const plan = etsyPlan(x.rows, x.file.name);
      plans.push(plan);
      state.ownerPrivate = { ...(state.ownerPrivate || {}), etsy: etsyApplyPlan(etsyData(), plan) };
    });
    state.etsyImport = { plans, bad, result: etsyData() };
  } finally {
    state.ownerPrivate = { ...(state.ownerPrivate || {}), etsy: was };
    if (was === undefined) delete state.ownerPrivate.etsy;
  }
  render();
  document.getElementById('etsy-preview')?.focus();
}
function etsyPreviewLines(p) {
  const lines = [];
  if (p.kind === 'orders') {
    lines.push(`${p.add.length} new sale${p.add.length === 1 ? '' : 's'} (${money2(p.add.reduce((s, o) => s + o.sale + o.shipping - o.refund, 0))})`);
    if (p.update.length) lines.push(`${p.update.length} already here, updated from the file`);
    if (p.keep) lines.push(`${p.keep} you edited by hand, left as they are`);
  } else if (p.kind === 'items') lines.push(`Item names for ${p.items.length} sale${p.items.length === 1 ? '' : 's'}`);
  else {
    const labels = p.fees.filter(f => f.label), fees = p.fees.filter(f => !f.label && !f.ads && !f.refund && !f.tax), refunds = p.fees.filter(f => f.refund), taxes = p.fees.filter(f => f.tax);
    if (taxes.length) lines.push(`Sales tax buyers paid, taken out of ${taxes.length} sale${taxes.length === 1 ? '' : 's'} (${money2(taxes.reduce((s, f) => s + f.amount, 0))}): Etsy pays it, so it isn't profit`);
    if (p.add.length) lines.push(`${p.add.length} sale${p.add.length === 1 ? '' : 's'} not in your Orders file yet (${money2(p.add.reduce((s, o) => s + o.sale, 0))}). Upload that month's Orders file for names and the full breakdown`);
    if (refunds.length) lines.push(`${refunds.length} refund${refunds.length === 1 ? '' : 's'} to buyers (${money2(refunds.reduce((s, f) => s + f.amount, 0))})`);
    const ads = p.fees.filter(f => f.ads).map(f => f.amount).concat(p.costs.filter(c => c.kind === 'ads').map(c => c.amount));
    lines.push(`${fees.length} fee${fees.length === 1 ? '' : 's'} on your sales (${money2(fees.reduce((s, f) => s + f.amount, 0))})`);
    lines.push(`${labels.length} shipping cost${labels.length === 1 ? '' : 's'}: labels and shipping transaction fees (${money2(labels.reduce((s, f) => s + f.amount, 0))})`);
    lines.push(`${ads.length} marketing charge${ads.length === 1 ? '' : 's'}: Etsy Ads and Offsite Ads (${money2(ads.reduce((s, a) => s + a, 0))})`);
    const other = p.costs.filter(c => c.kind !== 'ads');
    lines.push(`${other.length} other Etsy charge${other.length === 1 ? '' : 's'} and credit${other.length === 1 ? '' : 's'}, like listing fees (${money2(other.reduce((s, c) => s + c.amount, 0))})`);
    if (p.keep) lines.push(`${p.keep} already counted from an earlier import, skipped`);
  }
  if (p.covered) lines.push(`${p.covered} fall inside your yearly summary: saved and shown, but not counted until every month it covers is uploaded (then they replace it)`);
  if (p.skipped) lines.push(`${p.skipped} line${p.skipped === 1 ? '' : 's'} not used${p.kind === 'items' ? ' (import the Orders file for those months first)' : p.kind === 'statement' ? " (deposits, reserves, buyers' sales tax, and sales already in your Orders file)" : ''}`);
  return lines;
}
function renderEtsyPreview(imp) {
  const names = { orders: 'Orders file', items: 'Order Items file', statement: 'Monthly statement' };
  const one = imp.plans.length === 1;
  const sales = imp.plans.reduce((s, p) => s + (p.kind === 'orders' || p.kind === 'statement' ? p.add.length : 0), 0);
  const replaced = etsyOrders().filter(o => o.summary && !(imp.result.orders || []).some(x => x.id === o.id));
  return `<div class="etsy-preview" id="etsy-preview" tabindex="-1">
    <strong>${one ? `Etsy ${esc(names[imp.plans[0].kind])}: ${esc(imp.plans[0].fileName)}` : `${imp.plans.length} Etsy files${sales ? `, ${sales} new sale${sales === 1 ? '' : 's'}` : ''}`}</strong>
    ${one ? `<ul>${etsyPreviewLines(imp.plans[0]).map(l => `<li>${esc(l)}</li>`).join('')}</ul>`
      : imp.plans.map((p, n) => `<details class="etsy-file"${n === 0 ? ' open' : ''}><summary>${esc(names[p.kind])}: ${esc(p.fileName)}</summary>
        <ul>${etsyPreviewLines(p).map(l => `<li>${esc(l)}</li>`).join('')}</ul></details>`).join('')}
    ${replaced.length ? `<div><strong>This completes ${esc(replaced.map(o => String(o.date).slice(0, 4)).join(' and '))}: your yearly summary is replaced by these monthly uploads.</strong></div>` : ''}
    ${imp.bad.length ? `<div class="field-help">Not Etsy files, left out: ${esc(imp.bad.join(', '))}</div>` : ''}
    <div class="money-controls"><button type="button" class="btn-sm" id="etsy-apply" onclick="applyEtsyImport()">Add to my sales</button>
    <button type="button" class="btn-sm" onclick="state.etsyImport = null; render();">Cancel</button></div>
  </div>`;
}
async function writeEtsy(patch, okMsg) {
  state.ownerPrivate = { ...(state.ownerPrivate || {}), etsy: { ...etsyData(), ...patch } };
  try { await saveOwnerPrivate('etsy'); state.etsyMsg = okMsg || ''; render(); }
  catch (e) { render(); showAlert('etsy-err', "Couldn't save. Check you're logged in, and that supabase/owner-tools.sql has been run.", 'error'); }
}
// One file's plan applied to Etsy data (a copy is returned; nothing is saved here).
function etsyApplyPlan(data, p) {
  const orders = (Array.isArray(data.orders) ? data.orders : []).map(o => ({ ...o }));
  etsyMoveShipFees(orders);
  const find = id => orders.find(o => String(o.etsyId) === String(id));
  if (p.kind === 'orders') {
    p.update.forEach(u => { const o = find(u.etsyId); if (o) Object.assign(o, u, { fees: etsyNum(etsyNum(o.fees) - etsyNum(o.cardFee) - etsyNum(o.stmtCardFee) + u.cardFee), stmtCardFee: 0,
      refund: etsyNum(Math.max(u.refund, etsyNum(o.stmtRefund))), fromStatement: false }); });
    p.add.forEach(u => orders.push({ id: settingsId(), items: '', label: 0, grams: null, material: null, note: '', ...u, fees: u.cardFee }));
  } else if (p.kind === 'items') p.items.forEach(u => { const o = find(u.etsyId); if (o && !o.edited) o.items = u.items; });
  else {
    p.add.forEach(u => orders.push({ id: settingsId(), items: '', label: 0, grams: null, material: null, note: '', ...u, fees: 0 }));
    p.fees.forEach(f => {
      const o = find(f.etsyId); if (!o) return;
      if (f.tax) { if (o.fromStatement) { o.sale = etsyNum(etsyNum(o.sale) - f.amount); o.tax = etsyNum(etsyNum(o.tax) + f.amount); } return; }
      if (f.refund) { o.stmtRefund = etsyNum(etsyNum(o.stmtRefund) + f.amount); o.refund = etsyNum(Math.max(etsyNum(o.refund), o.stmtRefund)); return; }
      const k = f.label ? 'label' : f.ads ? 'ads' : 'fees';
      o[k] = etsyNum(etsyNum(o[k]) + f.amount);
      if (f.card && k === 'fees') o.stmtCardFee = etsyNum(etsyNum(o.stmtCardFee) + f.amount);
    });
  }
  let costs = (Array.isArray(data.costs) ? data.costs : []).concat(p.kind === 'statement' ? p.costs.map(c => ({ id: settingsId(), ...c })) : []);
  costs = etsyRelinkCosts(orders, costs).filter(c => !etsyIsBillPayment(c));
  const seen = (data.seen || []).concat(p.seen || []).slice(-5000);
  // Months uploaded so far; a yearly summary whose months are all uploaded is replaced by them.
  const list = key => (Array.isArray(data[key]) ? data[key] : []);
  const add = (key, more) => [...new Set(list(key).concat(more || []))].sort();
  const months = { statementMonths: add('statementMonths', p.kind === 'statement' ? p.months : []), saleMonths: add('saleMonths', p.saleMonths),
    ordersMonths: add('ordersMonths', p.kind === 'orders' ? p.months : []) };
  const got = { statement: months.statementMonths, sales: months.saleMonths, orders: months.ordersMonths };
  const replaced = orders.filter(o => o.summary && !etsySummaryMissing(o, got).length);
  const kept = orders.filter(o => !replaced.includes(o));
  costs = costs.filter(c => !(etsyHandTyped(c) && replaced.some(r => String(r.date) === String(c.date))));
  return { ...data, orders: kept, costs, seen, shipFeesMoved: true, adsMoved: true, ...months };
}
// Charges saved before their sale was known ("... (Order #123)") move onto that sale once it's here.
function etsyRelinkCosts(orders, costs) {
  return costs.filter(c => {
    const id = etsyOrderNumber(c.what), o = id && orders.find(x => String(x.etsyId) === id);
    if (!o) return true;
    const k = { ads: 'ads', shipping: 'label', fees: 'fees' }[etsyCostKind(c)];
    o[k] = etsyNum(etsyNum(o[k]) + etsyNum(c.amount));
    return false;
  });
}
function applyEtsyImport() {
  const imp = state.etsyImport;
  if (!imp) return;
  const result = imp.result, before = new Set(etsyOrders().map(o => o.id));
  const replaced = etsyOrders().filter(o => o.summary && !(result.orders || []).some(x => x.id === o.id));
  const added = (result.orders || []).filter(o => !before.has(o.id)).map(o => Number(String(o.date).slice(0, 4))).filter(Boolean);
  const years = (result.orders || []).map(o => Number(String(o.date).slice(0, 4))).filter(Boolean);
  if (added.length) state.moneyYear = Math.max(...added);
  else if (!state.moneyYear && years.length) state.moneyYear = Math.max(...years);
  state.etsyImport = null;
  writeEtsy(result, `Imported ${imp.plans.length} file${imp.plans.length === 1 ? '' : 's'}. Everything stays editable below.`
    + (replaced.length ? ` Your ${replaced.map(o => String(o.date).slice(0, 4)).join(' and ')} yearly summary was replaced by your monthly uploads.` : ''));
}

// Typing a sale in, or fixing one: the same form. Saving marks it edited, so a later import won't overwrite it.
const ETSY_FIELDS = [['date', 'Date', 'date'], ['etsyId', 'Etsy order number (optional)', 'text'], ['buyer', 'Buyer', 'text'], ['items', 'What they bought', 'text'],
  ['sale', 'Item sales after discounts ($)', 'money'], ['shipping', 'Shipping they paid ($)', 'money'], ['tax', 'Sales tax (Etsy pays it; not counted)', 'money'],
  ['fees', 'Etsy fees on the sale ($)', 'money'], ['label', 'Shipping costs: labels and shipping transaction fees ($)', 'money'], ['ads', 'Marketing: Offsite Ads fee for this sale, or all ads in a yearly summary ($)', 'money'], ['grams', 'Filament used (grams, optional)', 'number'],
  ['material', 'Or material cost ($, optional)', 'money'], ['refund', 'Refunded ($)', 'money'], ['note', 'Note', 'text']];
function renderEtsyForm() {
  const id = state.etsyEdit;
  if (id === undefined || id === null) return `<button type="button" class="btn-sm" id="etsy-add" onclick="state.etsyEdit = ''; render(); document.getElementById('etsy-f-date')?.focus();">+ Add an Etsy sale by hand</button>`;
  const o = etsyOrders().find(x => x.id === id) || { date: new Date().toISOString().slice(0, 10) };
  const val = (k, type) => { const v = o[k]; return v === null || v === undefined ? '' : type === 'money' && v === 0 && k !== 'sale' ? '' : v; };
  return `<fieldset class="etsy-form" id="etsy-form"><legend>${id ? 'Edit this Etsy sale' : 'Add an Etsy sale'}</legend>
    <div class="expense-form">${ETSY_FIELDS.map(([k, label, type]) => `<div class="field"><label for="etsy-f-${k}">${esc(label)}</label>
      <input id="etsy-f-${k}" type="${type === 'date' ? 'date' : type === 'text' ? 'text' : 'number'}" ${type === 'money' ? 'min="0" step="0.01"' : type === 'number' ? 'min="0" step="1"' : 'maxlength="300"'} value="${esc(String(val(k, type)))}" /></div>`).join('')}</div>
    <label class="special-order-check"><input type="checkbox" id="etsy-f-summary" ${o.summary ? 'checked' : ''} /> This is a yearly summary of all sales up to this date (uploads skip anything on or before it, that year)</label>
    <div class="money-controls"><button type="button" class="btn-sm" id="etsy-save" onclick="saveEtsyForm()">Save</button>
      <button type="button" class="btn-sm" onclick="state.etsyEdit = null; render();">Cancel</button>
      ${id ? `<button type="button" class="btn-sm danger" onclick="removeEtsyOrder('${esc(id)}')">Remove this sale</button>` : ''}</div>
  </fieldset>`;
}
function saveEtsyForm() {
  const v = k => String((document.getElementById(`etsy-f-${k}`) || {}).value || '').trim();
  const date = v('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { showAlert('etsy-err', 'Pick the date of the sale.', 'error'); return; }
  const num = k => { const n = parseFloat(v(k)); return Number.isFinite(n) && n >= 0 ? etsyNum(n) : 0; };
  const id = state.etsyEdit || settingsId();
  const o = { id, date, etsyId: v('etsyId').replace(/\D/g, '').slice(0, 20), buyer: v('buyer').slice(0, 80), items: v('items').slice(0, 300), note: v('note').slice(0, 300),
    sale: num('sale'), shipping: num('shipping'), tax: num('tax'), fees: num('fees'), label: num('label'), ads: num('ads'), refund: num('refund'),
    grams: v('grams') ? num('grams') : null, material: v('material') ? num('material') : null, edited: true,
    summary: !!(document.getElementById('etsy-f-summary') || {}).checked };
  const was = etsyOrders().find(x => x.id === id);
  o.cardFee = was ? was.cardFee || 0 : 0;
  state.etsyEdit = null;
  state.moneyYear = Number(date.slice(0, 4));
  writeEtsy({ orders: was ? etsyOrders().map(x => (x.id === id ? o : x)) : etsyOrders().concat(o) }, 'Saved.');
}
function removeEtsyOrder(id) {
  if (!confirm('Remove this Etsy sale?')) return;
  state.etsyEdit = null;
  writeEtsy({ orders: etsyOrders().filter(o => o.id !== id) }, 'Removed.');
}
function addEtsyCost() {
  const v = k => String((document.getElementById(`etsy-c-${k}`) || {}).value || '').trim();
  const amount = parseFloat(v('amount'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v('date')) || !v('what') || !Number.isFinite(amount) || amount < 0) { showAlert('etsy-err', 'Fill in the date, what it was, and the amount.', 'error'); return; }
  state.moneyYear = Number(v('date').slice(0, 4));
  writeEtsy({ costs: etsyCosts().concat({ id: settingsId(), date: v('date'), what: v('what').slice(0, 120), amount: etsyNum(amount), kind: ['ads', 'label'].includes(v('kind')) ? v('kind') : 'fee', manual: true }) }, 'Added.');
}
function removeEtsyCost(id) {
  if (!confirm('Remove this Etsy charge?')) return;
  writeEtsy({ costs: etsyCosts().filter(c => c.id !== id) }, 'Removed.');
}
// ── Etsy card: tabs (Orders, Marketing, Fees, Shipping), grouped by week, month or year, searchable and sortable.
// Orders: each sale folds open to its costs and profit (or a spreadsheet). The other tabs list every charge of that kind,
// tied to its order number when Etsy gives one, with a total per period.
const ETSY_COLUMNS = [['date', 'Date', o => o.date], ['order', 'Order #', o => String(o.etsyId || '')], ['what', 'Sale', o => etsySaleName(o).toLowerCase()], ['sale', 'Item sales', o => etsyNum(o.sale)],
  ['shipping', 'Shipping paid', o => etsyNum(o.shipping)], ['refund', 'Refund', o => etsyNum(o.refund)], ['fees', 'Etsy fees', o => etsyNum(o.fees)],
  ['label', 'Shipping costs', o => etsyNum(o.label)], ['ads', 'Marketing', o => etsyNum(o.ads)], ['material', 'Material', etsyMaterial], ['costs', 'All costs', etsyCostTotal], ['profit', 'Profit', etsyProfit]];
const ETSY_SORTS = [['date', 'desc', 'Newest first'], ['date', 'asc', 'Oldest first'], ['profit', 'desc', 'Most profit'], ['profit', 'asc', 'Least profit'],
  ['costs', 'desc', 'Highest costs'], ['sale', 'desc', 'Biggest sales'], ['order', 'asc', 'Order number']];
const ETSY_TABS = [['overview', 'Profit & loss'], ['orders', 'Orders'], ['ads', 'Marketing'], ['fees', 'Fees'], ['shipping', 'Shipping']];
const ETSY_GROUPS = [['yearmonth', 'Year, then month'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year'], ['all', 'All time']];
function etsyCostTotal(o) { return etsyNum(etsyNum(o.fees) + etsyNum(o.label) + etsyNum(o.ads) + etsyMaterial(o)); }
function etsySaleName(o) { return [o.buyer, o.items].filter(Boolean).join(': ') || (o.summary ? 'Yearly summary' : 'Etsy sale'); }
function etsyPref(key, def) {
  if (state[key] === undefined) { try { state[key] = localStorage.getItem('soloprint_' + key) || def; } catch (e) { state[key] = def; } }
  return state[key];
}
function setEtsyPref(key, v, focusId) { state[key] = v; state.etsyMax = 0; try { localStorage.setItem('soloprint_' + key, v); } catch (e) {} render(); if (focusId) document.getElementById(focusId)?.focus(); }
function etsyView() { return etsyPref('etsyView', 'orders'); }
function setEtsyView(v) { setEtsyPref('etsyView', v, 'etsy-view-' + v); }
function etsySort() { return state.etsySort || { key: 'date', dir: 'desc' }; }
function sortEtsyBy(key) {
  const s = etsySort();
  state.etsySort = { key, dir: s.key === key ? (s.dir === 'desc' ? 'asc' : 'desc') : (key === 'what' || key === 'order' ? 'asc' : 'desc') };
  render(); document.getElementById('etsy-sort-' + key)?.focus();
}
function etsySorted(orders) {
  const { key, dir } = etsySort(), col = ETSY_COLUMNS.find(c => c[0] === key) || ETSY_COLUMNS[0], f = col[2];
  return orders.slice().sort((a, b) => { const x = f(a), y = f(b); const c = typeof x === 'string' ? String(x).localeCompare(String(y), undefined, { numeric: true }) : x - y; return (dir === 'asc' ? c : -c) || String(b.date).localeCompare(String(a.date)); });
}
function etsyEditButton(o) {
  return `<button type="button" class="btn-sm" onclick="state.etsyEdit = '${esc(o.id)}'; render(); document.getElementById('etsy-form')?.scrollIntoView({ block: 'center' }); document.getElementById('etsy-f-date')?.focus();" aria-label="Edit Etsy sale ${esc(o.date)} ${esc(o.buyer || '')}">Edit</button>`;
}
// Which period a date falls in, and its name: weeks start on Monday.
function etsyGroupKey(date, by) {
  const d = String(date || '');
  if (by === 'all') return 'all';
  if (by === 'year') return d.slice(0, 4);
  if (by === 'month') return d.slice(0, 7);
  const day = new Date(d + 'T12:00:00'), back = (day.getDay() + 6) % 7;
  day.setDate(day.getDate() - back);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}
function etsyGroupLabel(key, by) {
  if (by === 'all') return 'All time';
  if (by === 'year') return key;
  if (by === 'month') return new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return 'Week of ' + new Date(key + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
// Groups rows (each with a date) by period, newest period first; the newest one starts open (or the one asked for,
// state.etsyOpenGroup). "Year, then month": each year folds open to its months.
function etsyGrouped(rows, by, body, head, months, empty) {
  const groups = new Map(), want = String(state.etsyOpenGroup || '');
  const level = by === 'yearmonth' ? 'year' : by;
  // Months with nothing in this list (no sales) still get a heading when `months` is given (Orders, grouped by month).
  if (months && (level === 'month' || level === 'year')) months.forEach(m => { const k = level === 'year' ? m.slice(0, 4) : m; if (!groups.has(k)) groups.set(k, []); });
  rows.forEach(r => { const k = etsyGroupKey(r.date, level); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
  const keys = [...groups.keys()].sort().reverse();
  const first = Math.max(0, keys.findIndex(k => groups.get(k).length));   // the newest period that has something in it opens
  return keys.map((k, n) => {
    const open = want ? want.startsWith(k) || k.startsWith(want) : n === first || by === 'all';
    const list = groups.get(k);
    const inner = by === 'yearmonth' ? etsyGrouped(list, 'month', body, head, months && months.filter(m => m.startsWith(k)), empty) : list.length || !empty ? body(list) : empty(k);
    return `<details class="etsy-group${by === 'yearmonth' ? ' etsy-year' : ''}" id="etsy-g-${esc(k)}"${open ? ' open' : ''}><summary><span class="etsy-group-name">${esc(etsyGroupLabel(k, level))}</span><span class="etsy-group-sum">${head(groups.get(k), k, level)}</span></summary>
    ${inner}</details>`;
  }).join('');
}
// Every month from the first Etsy activity to this month (or the latest date), so months without sales still show.
function etsyAllMonths() {
  const dates = etsyOrders().map(o => o.date).concat(etsyCosts().map(c => c.date)).filter(d => /^\d{4}-\d{2}/.test(String(d))).map(d => String(d).slice(0, 7)).sort();
  if (!dates.length) return [];
  const now = etsyMonthKey(new Date()), last = dates[dates.length - 1] > now ? dates[dates.length - 1] : now, out = [];
  for (let y = Number(dates[0].slice(0, 4)), m = Number(dates[0].slice(5, 7)); `${y}-${String(m).padStart(2, '0')}` <= last; m === 12 ? (y++, m = 1) : m++) out.push(`${y}-${String(m).padStart(2, '0')}`);
  return out;
}
// Charges of one kind: per order (from the order's totals) plus charges not tied to one order.
function etsyCostKind(c) {
  if (c.kind === 'ads' || (!c.kind && etsyIsAdsName(c.what))) return 'ads';
  if (c.kind === 'label' || /shipping label|postage|label/i.test(String(c.what || '')) || etsyShipFee(String(c.what || '').replace(/\s*\(.*$/, ''))) return 'shipping';
  return 'fees';
}
function etsyTabRows(tab, orders, costs) {
  const field = { ads: 'ads', fees: 'fees', shipping: 'label' }[tab];
  const what = { ads: 'Offsite Ads fee', fees: 'Transaction and processing fees', shipping: 'Shipping label and shipping transaction fee' }[tab];
  const fromOrders = orders.filter(o => etsyNum(o[field])).map(o => ({ date: o.date, what: o.summary ? `${what} (yearly summary)` : what, order: o.etsyId || '', buyer: o.buyer || '', amount: etsyNum(o[field]), o }));
  const loose = costs.filter(c => !etsyIsBillPayment(c) && etsyCostKind(c) === tab).map(c => ({ date: c.date, what: c.what, order: etsyOrderNumber(c.what), amount: etsyNum(c.amount), c }));
  return fromOrders.concat(loose).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
function etsyMatches(q, ...parts) { return !q || parts.join(' ').toLowerCase().includes(q); }
function renderEtsyTabs(year, orders, costs) {
  const tab = etsyPref('etsyTab', 'overview'), by = etsyPref('etsyGroup', 'yearmonth'), q = String(state.etsyQuery || '').trim().toLowerCase();
  const act = etsyActiveSummaries(), pending = r => etsyPending(r, act);
  const tag = o => pending(o) ? '<div class="etsy-pending">Not counted yet: inside your yearly summary</div>' : o.summary ? '<div class="gallery-meta">Yearly summary (counted until your monthly uploads replace it)</div>' : '';
  const tabs = `<div class="etsy-tabs" role="tablist" aria-label="Etsy money by type">${ETSY_TABS.map(([k, label]) => `<button type="button" role="tab" id="etsy-tab-${k}" aria-selected="${tab === k}" aria-controls="etsy-panel" class="etsy-tab sec-${k}${tab === k ? ' on' : ''}" onclick="setEtsyPref('etsyTab', '${k}', 'etsy-tab-${k}')">${label}</button>`).join('')}</div>`;
  const s = etsySort(), sortNow = ETSY_SORTS.findIndex(x => x[0] === s.key && x[1] === s.dir), view = etsyView();
  const controls = tab === 'overview' ? '' : `<div class="money-controls etsy-view-controls">
      <div class="field" style="margin-bottom:0;flex:2;"><label for="etsy-q">Search order number, buyer or item</label>
        <input type="search" id="etsy-q" value="${esc(state.etsyQuery || '')}" oninput="state.etsyQuery = this.value; state.etsyMax = 0; clearTimeout(window.etsyQT); window.etsyQT = setTimeout(() => { render(); const el = document.getElementById('etsy-q'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 250)" /></div>
      <div class="field" style="margin-bottom:0;"><label for="etsy-group">Group by</label>
        <select id="etsy-group" onchange="setEtsyPref('etsyGroup', this.value, 'etsy-group')">${ETSY_GROUPS.map(([k, l]) => `<option value="${k}" ${k === by ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${tab === 'orders' ? `<div class="field" style="margin-bottom:0;"><label for="etsy-sort">Sort by</label>
        <select id="etsy-sort" onchange="const v = ETSY_SORTS[this.value]; state.etsySort = { key: v[0], dir: v[1] }; render(); document.getElementById('etsy-sort')?.focus();">
          ${sortNow < 0 ? `<option value="" selected>${esc((ETSY_COLUMNS.find(c => c[0] === s.key) || ETSY_COLUMNS[0])[1])}, ${s.dir === 'asc' ? 'low to high' : 'high to low'}</option>` : ''}
          ${ETSY_SORTS.map((x, n) => `<option value="${n}" ${n === sortNow ? 'selected' : ''}>${esc(x[2])}</option>`).join('')}</select></div>
      <div class="seg" role="group" aria-label="How to show orders">
        <button type="button" class="btn-sm" id="etsy-view-orders" aria-pressed="${view !== 'sheet'}" onclick="setEtsyView('orders')">List</button>
        <button type="button" class="btn-sm" id="etsy-view-sheet" aria-pressed="${view === 'sheet'}" onclick="setEtsyView('sheet')">Spreadsheet</button>
      </div>` : ''}
    </div>`;
  let body = '';
  if (tab === 'overview') body = renderEtsyOverview(act);
  else if (tab === 'orders') {
    const list = etsySorted(orders.filter(o => etsyMatches(q, o.etsyId, o.buyer, o.items, o.note, o.date)));
    const months = q ? null : etsyAllMonths();   // with no search, months without sales still show
    if (!list.length && !(months && months.length)) body = `<p class="field-help">${q ? 'No sales match that search.' : `No Etsy sales yet. Upload Etsy's files, or add one by hand.`}</p>`;
    else if (view === 'sheet') {
      // Sorted by date with no search: a total row for every month (months without sales too), then that month's sales.
      const byMonth = months && s.key === 'date';
      const max = byMonth ? list.length : state.etsyMax || 50, shown = list.slice(0, max);
      const monthRow = m => { const t = etsyPeriod(m, act); return `<tr class="etsy-sheet-month"><th scope="rowgroup" colspan="3">${esc(etsyGroupLabel(m, 'month'))} · ${t.orders} sale${t.orders === 1 ? '' : 's'}</th>
          <td colspan="3">${money2(t.sales)} sales</td><td>${money2(t.fees + t.other)}</td><td>${money2(t.labels)}</td><td>${money2(t.ads)}</td><td>${money2(t.material)}</td>
          <td>${money2(t.fees + t.other + t.labels + t.ads + t.material)}</td><td><strong>${money2(t.profit)}</strong></td><td></td></tr>`; };
      const orderRow = o => `<tr><td>${esc(o.date)}</td><td>${esc(o.etsyId || '')}</td><td class="etsy-what">${esc(etsySaleName(o))}${tag(o)}${o.note ? `<div class="gallery-meta">${esc(o.note)}</div>` : ''}</td>
          <td>${money2(o.sale)}</td><td>${money2(o.shipping)}</td><td>${o.refund ? money2(o.refund) : ''}</td><td>${money2(o.fees)}</td><td>${money2(o.label)}</td><td>${o.ads ? money2(o.ads) : ''}</td><td>${money2(etsyMaterial(o))}</td><td>${money2(etsyCostTotal(o))}</td><td><strong>${money2(etsyProfit(o))}</strong></td>
          <td>${etsyEditButton(o)}</td></tr>`;
      const rowsHtml = byMonth ? (s.dir === 'asc' ? months : months.slice().reverse()).map(m => monthRow(m) + shown.filter(o => String(o.date).startsWith(m)).map(orderRow).join('')).join('')
        : shown.map(orderRow).join('');
      const sum = f => etsyNum(list.filter(o => !pending(o)).reduce((n, o) => n + f(o), 0));
      const th = ([key, label]) => `<th scope="col" aria-sort="${s.key === key ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button type="button" class="sort-head" id="etsy-sort-${key}" onclick="sortEtsyBy('${key}')">${esc(label)}${s.key === key ? (s.dir === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>`;
      body = `<div class="table-scroll"><table class="money-table etsy-table etsy-sheet">
        <thead><tr>${ETSY_COLUMNS.map(th).join('')}<th scope="col"><span class="sr-only">Edit</span></th></tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr><th scope="row">Total</th><td></td><td>${list.length} sale${list.length === 1 ? '' : 's'}</td>${['sale', 'shipping', 'refund', 'fees', 'label', 'ads', 'material', 'costs', 'profit'].map(k => `<td>${money2(sum(ETSY_COLUMNS.find(c => c[0] === k)[2]))}</td>`).join('')}<td></td></tr></tfoot>
      </table></div>${list.length > max ? `<button type="button" class="btn-sm" onclick="state.etsyMax = ${max + 50}; render();">Show more (${list.length - max} more)</button>` : ''}`;
    } else {
      const line = (label, amount, minus) => `<dt>${esc(label)}</dt><dd>${minus ? '−' : ''}${money2(amount)}</dd>`;
      const one = o => `<li><details class="etsy-order" id="etsy-o-${esc(o.id)}"><summary>
          <span class="etsy-o-num">${o.etsyId ? '#' + esc(o.etsyId) : o.summary ? 'Summary' : 'By hand'}</span>
          <span class="etsy-o-name">${esc(etsySaleName(o))}<span class="gallery-meta"> · ${esc(o.date)}</span></span>
          <span class="etsy-o-profit">${money2(etsyProfit(o))}</span></summary>
        ${tag(o)}${o.note ? `<div class="gallery-meta">${esc(o.note)}</div>` : ''}
        <dl class="etsy-lines">
          ${line('Item sales', o.sale)}${line('Shipping they paid', o.shipping)}${o.refund ? line('Refunded', o.refund, true) : ''}
          ${line('Etsy fees', o.fees, true)}${line('Shipping costs', o.label, true)}${o.ads ? line('Marketing (Offsite Ads)', o.ads, true) : ''}${line('Material', etsyMaterial(o), true)}
          <dt class="etsy-total">Profit</dt><dd class="etsy-total">${money2(etsyProfit(o))}</dd>
        </dl>${o.tax ? `<div class="field-help">Sales tax Etsy collected and paid for you: ${money2(o.tax)} (not counted)</div>` : ''}
        <div class="money-controls">${etsyEditButton(o)}</div></details></li>`;
      const emptyMonth = m => { const t = etsyPeriod(m, act); return `<p class="field-help etsy-empty-month">No sales this month.${t.fees + t.other + t.labels + t.ads ? ` Costs: fees ${money2(t.fees + t.other)}, shipping ${money2(t.labels)}, marketing ${money2(t.ads)}.` : ' Nothing was charged.'}</p>`; };
      body = etsyGrouped(list, by, rows => `<ul class="etsy-orders etsy-table">${rows.map(one).join('')}</ul>`,
        (rows, key, level) => { if (!q && (level === 'year' || level === 'month')) { const t = etsyPeriod(key, act); return `${t.orders} sale${t.orders === 1 ? '' : 's'} · sales ${money2(t.sales)} · profit ${money2(t.profit)}`; }
          const c = rows.filter(o => !pending(o)); return `${rows.length} sale${rows.length === 1 ? '' : 's'} · profit ${money2(c.reduce((n, o) => n + etsyProfit(o), 0))}`; }, months, emptyMonth);
    }
  } else {
    const rows = etsyTabRows(tab, orders, costs).filter(r => etsyMatches(q, r.order, r.buyer, r.what, r.date));
    const name = { ads: 'marketing', fees: 'fees', shipping: 'shipping costs' }[tab];
    const counted = r => (r.o ? !pending(r.o) : etsyCostCounted(r.c, act));
    body = rows.length ? etsyGrouped(rows, by, list => `<div class="table-scroll"><table class="money-table etsy-cost-table">
        <thead><tr><th scope="col">Date</th><th scope="col">What</th><th scope="col">Order #</th><th scope="col">Amount</th><th scope="col"><span class="sr-only">Change</span></th></tr></thead>
        <tbody>${list.map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.what)}${r.buyer ? `<div class="gallery-meta">${esc(r.buyer)}</div>` : ''}${counted(r) ? '' : '<div class="etsy-pending">Not counted yet: inside your yearly summary</div>'}</td>
          <td>${r.order ? (r.o ? `<button type="button" class="btn-link" onclick="etsyOpenOrder('${esc(r.o.id)}')">#${esc(r.order)}</button>` : `#${esc(r.order)}`) : ''}</td>
          <td>${r.amount < 0 ? `${money2(-r.amount)} credit` : money2(r.amount)}</td>
          <td>${r.c ? `<button type="button" class="btn-sm danger" onclick="removeEtsyCost('${esc(r.c.id)}')" aria-label="Remove ${esc(r.what)}">✕</button>` : etsyEditButton(r.o)}</td></tr>`).join('')}</tbody></table></div>`,
      list => `${list.length} charge${list.length === 1 ? '' : 's'} · ${money2(list.filter(counted).reduce((n, r) => n + r.amount, 0))}`)
      : `<p class="field-help">${q ? 'Nothing matches that search.' : `No ${name} yet.`}</p>`;
    const today = new Date().toISOString().slice(0, 10), kind = { ads: 'ads', fees: 'fee', shipping: 'label' }[tab];
    body += `<details class="etsy-add-charge"><summary>Add a ${tab === 'ads' ? 'marketing charge' : tab === 'fees' ? 'fee or credit' : 'shipping cost'} by hand</summary>
      <div class="expense-form">
        <input type="hidden" id="etsy-c-kind" value="${kind}" />
        <div class="field"><label for="etsy-c-date">Date</label><input type="date" id="etsy-c-date" value="${today}" /></div>
        <div class="field" style="flex:2;"><label for="etsy-c-what">What</label><input type="text" id="etsy-c-what" maxlength="120" placeholder="${tab === 'ads' ? 'e.g. Etsy Ads' : tab === 'fees' ? 'e.g. Listing fees' : 'e.g. USPS label (Order #123)'}" /></div>
        <div class="field"><label for="etsy-c-amount">Amount ($)</label><input type="number" id="etsy-c-amount" min="0" step="0.01" /></div>
        <button type="button" class="btn-sm" onclick="addEtsyCost()">Add</button>
      </div></details>`;
  }
  return `${tabs}<div id="etsy-panel" class="etsy-panel sec-${tab}" role="tabpanel" aria-labelledby="etsy-tab-${tab}">${controls}${body}</div>`;
}
// Profit & loss: tiles for this month, last month, this year, last year and all time (with the change on the period before),
// then every year as a row that folds open to its months, with sales, each kind of cost, profit and margin.
function etsyMonthKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function etsyOpenMonth(key) { state.etsyOpenGroup = key; state.etsyQuery = ''; setEtsyPref('etsyTab', 'orders'); document.getElementById('etsy-g-' + key)?.scrollIntoView({ block: 'start' }); }
function renderEtsyOverview(act) {
  const now = new Date(), y = now.getFullYear();
  const thisM = etsyMonthKey(now), lastM = etsyMonthKey(new Date(y, now.getMonth() - 1, 1));
  const pct = (a, b) => (b ? Math.round((a - b) / Math.abs(b) * 100) : null);
  const change = (cur, prev, what) => { const d = etsyNum(cur.profit - prev.profit), p = pct(cur.profit, prev.profit);
    return `<div class="etsy-kpi-change ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${money2(Math.abs(d))}${p !== null ? ` (${Math.abs(p)}%)` : ''} vs ${what}</div>`; };
  const tile = (label, t, extra, cls) => `<div class="etsy-kpi ${cls || ''}"><div class="etsy-kpi-label">${esc(label)}</div><div class="etsy-kpi-val ${t.profit < 0 ? 'neg' : ''}">${money2(t.profit)}</div>
    <div class="etsy-kpi-sub">${t.orders} sale${t.orders === 1 ? '' : 's'} · sales ${money2(t.sales)}</div>${extra || ''}</div>`;
  const tm = etsyPeriod(thisM, act), lm = etsyPeriod(lastM, act), ty = etsyPeriod(String(y), act), ly = etsyPeriod(String(y - 1), act), all = etsyPeriod('', act);
  const monthName = k => new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'long' });
  const tiles = `<div class="etsy-kpis">
    ${tile(`This month (${monthName(thisM)})`, tm, change(tm, lm, 'last month'))}${tile(`Last month (${monthName(lastM)})`, lm)}
    ${tile(`This year (${y})`, ty, change(ty, ly, String(y - 1)))}${tile(`Last year (${y - 1})`, ly)}${tile('All time', all, '', 'all')}</div>`;
  const dates = etsyOrders().map(o => o.date).concat(etsyCosts().map(c => c.date)).filter(Boolean);
  const years = [...new Set(etsyAllMonths().map(m => m.slice(0, 4)))].sort().reverse();
  if (!years.length) return tiles + '<p class="field-help">No Etsy sales yet. Upload Etsy\'s files, or add a sale by hand.</p>';
  const cells = t => `<td>${t.orders}</td><td>${money2(t.sales)}</td><td>${money2(t.fees + t.other)}</td><td>${money2(t.labels)}</td><td>${money2(t.ads)}</td><td>${money2(t.material)}</td>
    <td class="etsy-pl-profit ${t.profit < 0 ? 'neg' : ''}"><strong>${money2(t.profit)}</strong></td><td>${t.sales ? Math.round(t.profit / t.sales * 100) + '%' : '–'}</td>`;
  const head = `<thead><tr><th scope="col">Month</th><th scope="col">Sales #</th><th scope="col" class="sec-orders">Sales</th><th scope="col" class="sec-fees">Fees</th><th scope="col" class="sec-shipping">Shipping</th><th scope="col" class="sec-ads">Marketing</th><th scope="col" class="sec-material">Material</th><th scope="col" class="sec-profit">Profit</th><th scope="col">Margin</th></tr></thead>`;
  const table = years.map((yr, n) => {
    const t = etsyPeriod(yr, act);
    const months = etsyAllMonths().filter(m => m.startsWith(yr)).reverse();
    return `<details class="etsy-group etsy-year etsy-pl-year" id="etsy-pl-${yr}"${n === 0 ? ' open' : ''}><summary><span class="etsy-group-name">${yr}</span>
        <span class="etsy-group-sum">${t.orders} sale${t.orders === 1 ? '' : 's'} · sales ${money2(t.sales)} · profit ${money2(t.profit)}</span></summary>
      <div class="table-scroll"><table class="money-table etsy-pl">${head}
        <tbody>${months.map(m => `<tr><th scope="row"><button type="button" class="btn-link" onclick="etsyOpenMonth('${m}')" aria-label="${esc(etsyGroupLabel(m, 'month'))}: open its orders">${esc(monthName(m))}</button></th>${cells(etsyPeriod(m, act))}</tr>`).join('')}</tbody>
        <tfoot><tr><th scope="row">${yr} total</th>${cells(t)}</tr></tfoot></table></div></details>`;
  }).join('');
  return `${tiles}<h4 class="cm-heading">Profit and loss by year and month</h4>
    <p class="field-help">Tap a year to open its months, and a month to see its orders. Sales are after refunds, without the sales tax Etsy pays for you. Your shipping transaction fees are under Shipping.</p>
    ${table}`;
}
// From a charge to its order: switch to Orders, find it and open it.
function etsyOpenOrder(id) {
  const o = etsyOrders().find(x => x.id === id);
  state.etsyTab = 'orders'; state.etsyView = 'orders'; state.etsyQuery = o && o.etsyId ? String(o.etsyId) : ''; state.etsyOpenGroup = o ? String(o.date).slice(0, 7) : '';
  render();
  const el = document.getElementById('etsy-o-' + id);
  if (el) { el.open = true; el.scrollIntoView({ block: 'center' }); el.querySelector('summary')?.focus(); }
}
// Charges that name an Etsy order whose sale isn't uploaded: they make profit look too low until it is.
function etsyOrphanCharges(costs) {
  const known = new Set(etsyOrders().map(o => String(o.etsyId)));
  return costs.filter(c => { const id = etsyOrderNumber(c.what); return id && !known.has(id) && etsyNum(c.amount) > 0; });
}
function renderEtsyCard(year, site) {
  const { orders, costs, t, summaries } = etsyAllTime(), ty = etsyYear(year).t;
  const editing = state.etsyEdit !== undefined && state.etsyEdit !== null;
  const orphans = etsyOrphanCharges(costs), orphanMonths = [...new Set(orphans.map(c => String(c.date).slice(0, 7)))].sort();
  const line = (label, amount, minus, tabKey) => `<dt class="${tabKey ? 'sec-' + tabKey : 'sec-material'}">${tabKey ? `<button type="button" class="btn-link" onclick="setEtsyPref('etsyTab', '${tabKey}', 'etsy-tab-${tabKey}')">${esc(label)}</button>` : esc(label)}</dt><dd>${minus ? '−' : ''}${money2(amount)}</dd>`;
  return `<div class="card" id="etsy-card">
    <h3 class="card-title">Etsy sales</h3>
    <details class="etsy-how"><summary>How to get your files from Etsy</summary>
      <ol class="field-help">
        <li><strong>Sales:</strong> on Etsy, open Shop Manager, then Settings, then Options, then the Download Data tab. Under Orders pick <em>Orders</em>, the month and year, and tap Download CSV. Do the same with <em>Order Items</em> if you want item names.</li>
        <li><strong>Fees and shipping labels:</strong> Shop Manager, then Finances, then Monthly statements. Pick the month and tap Download CSV.</li>
        <li>Upload them here. You can pick many files at once, like a whole year: the Orders file, the Order Items file and all 12 statements together. The site puts them in the right order by itself. You'll see what will be added before anything is saved, and uploading the same file twice doesn't count anything twice.</li>
      </ol>
      <div class="field-help">Etsy sometimes moves these menus; if they're not there, search Etsy's help for "download data" or "monthly statement".</div>
    </details>
    <div class="money-controls">
      <button type="button" class="btn-sm" id="etsy-upload" onclick="document.getElementById('etsy-file').click()">Upload Etsy files (.csv, one or many)</button>
      <input type="file" id="etsy-file" accept=".csv,.xlsx,.xls,text/csv" multiple hidden onchange="etsyFileChosen(this)" />
      ${editing ? '' : renderEtsyForm()}
    </div>
    <div class="alert error" id="etsy-err"></div>
    ${state.etsyMsg ? `<div class="alert success" style="display:block;" role="status">${esc(state.etsyMsg)}</div>` : ''}
    ${state.etsyImport ? renderEtsyPreview(state.etsyImport) : ''}
    ${editing ? renderEtsyForm() : ''}
    <div class="etsy-profit-box">
      <div class="etsy-profit-head"><span>Etsy profit, all years</span><strong id="etsy-profit" class="${t.profit < 0 ? 'neg' : ''}">${money2(t.profit)}</strong></div>
      <details class="etsy-how-total"><summary>How this is worked out</summary>
        <dl class="etsy-lines">
          ${line(`Sales with shipping paid (${t.orders} sale${t.orders === 1 ? '' : 's'}, after refunds)`, t.sales, false, 'orders')}
          ${line('Etsy fees and other charges', t.fees + t.other, true, 'fees')}${line('Shipping costs', t.labels, true, 'shipping')}${line('Marketing', t.ads, true, 'ads')}${line('Material (est.)', t.material, true)}
          <dt class="etsy-total">Profit</dt><dd class="etsy-total">${money2(t.profit)}</dd>
        </dl>${t.tax ? `<div class="field-help">Sales tax Etsy collected and paid for you: ${money2(t.tax)} (not counted).</div>` : ''}
      </details>
    </div>
    <div class="stats-row money-stats etsy-stats">
      <div class="stat-card sec-orders"><div class="stat-val">${money2(t.sales)}</div><div class="stat-label">Etsy sales (with shipping paid)</div></div>
      <div class="stat-card sec-fees"><div class="stat-val">${money2(t.fees + t.other)}</div><div class="stat-label">Etsy fees and charges</div></div>
      <div class="stat-card sec-ads"><div class="stat-val">${money2(t.ads)}</div><div class="stat-label">Etsy marketing</div></div>
      <div class="stat-card sec-shipping"><div class="stat-val">${money2(t.labels)}</div><div class="stat-label">Shipping costs</div></div>
      <div class="stat-card sec-material"><div class="stat-val">${money2(t.material)}</div><div class="stat-label">Material (est.)</div></div>
      <div class="stat-card sec-profit"><div class="stat-val">${money2(t.profit)}</div><div class="stat-label">Etsy profit</div></div>
    </div>
    <p class="field-help both-shops" id="both-shops"><strong>Both shops in ${year}:</strong> sales ${money2(site.sales + ty.sales)}, marketing ${money2((site.ads || 0) + ty.ads)}, profit after material, Etsy fees, shipping, marketing, your expenses and ads ${money2(site.sales - site.material - site.expenses - (site.ads || 0) + ty.profit)}.</p>
    ${orphans.length ? `<div class="warn-note" id="etsy-orphans">${orphans.length} charge${orphans.length === 1 ? '' : 's'} (${money2(orphans.reduce((n, c) => n + etsyNum(c.amount), 0))}) ${orphans.length === 1 ? 'is' : 'are'} for Etsy orders whose sale isn't uploaded yet, so profit looks lower than it really is. Upload the Orders file${orphanMonths.length === 1 ? '' : 's'} (or monthly statement${orphanMonths.length === 1 ? '' : 's'}) for ${esc(orphanMonths.map(etsyMonthName).join(', '))}: the charges then move onto their orders.</div>` : ''}
    ${(() => { const m = etsyShipFeeMoves(etsyOrders()), ship = m.filter(x => x.to === 'label').length, ads = m.length - ship;
      const parts = [ship && `${ship} shipping transaction fee${ship === 1 ? '' : 's'} (shipping costs)`, ads && `${ads} Offsite Ads fee${ads === 1 ? '' : 's'} (marketing)`].filter(Boolean);
      return m.length ? `<div class="etsy-preview" id="etsy-shipfee-fix">Earlier imports counted ${parts.join(' and ')} as Etsy fees. <button type="button" class="btn-sm" onclick="fixEtsyShipFees()">Move ${m.length === 1 ? 'it' : 'them'} where ${m.length === 1 ? 'it belongs' : 'they belong'}</button></div>` : ''; })()}
    ${summaries.map(s => { const miss = etsySummaryMissing(s), st = miss.filter(m => m.need === 'statement'), od = miss.filter(m => m.need === 'orders');
      return `<div class="etsy-preview etsy-summary-note"><strong>${esc(String(s.date).slice(0, 4))} totals use your yearly summary (through ${esc(s.date)}).</strong> Upload the rest of your monthly files and it's replaced by month-by-month detail, with Offsite Ads shown on the orders they came from.
        ${st.length ? `<div>Monthly statements still needed: ${esc(st.map(m => etsyMonthName(m.month)).join(', '))}.</div>` : ''}${od.length ? `<div>Orders files still needed: ${esc(od.map(m => etsyMonthName(m.month)).join(', '))}.</div>` : ''}
        <div class="field-help">Anything you upload for those months is saved and shown, marked "not counted yet", so nothing counts twice.</div></div>`; }).join('')}
    ${renderEtsyTabs('', orders, costs)}
  </div>`;
}

// ── AMAZON INVOICES: read a photo, screenshot or PDF, then add purchases, roll grams and new colors ──
// Read in the browser (photos with Tesseract OCR, PDFs with pdf.js, both loaded on first use); nothing is saved
// until the owner checks the filled-in lines (`renderInvoiceReview`) and taps "Add". Saves: an expense per line
// (money.expenses, with `invoice` = the Amazon order number; money.invoices remembers read orders), grams added to
// owner_private inventory per color, and any new colors to Settings > Colors.
const INVOICE_LIBS = {
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
};
function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('load'));
    document.head.appendChild(s);
  });
}
async function invoiceTextFromFile(file, progress) {
  if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
    if (!window.pdfjsLib) await loadScriptOnce(INVOICE_LIBS.pdf);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = INVOICE_LIBS.pdfWorker;
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const out = [];
    for (let n = 1; n <= Math.min(pdf.numPages, 10); n++) {
      const content = await (await pdf.getPage(n)).getTextContent();
      // Put the pieces back into lines by their height on the page.
      const rows = new Map();
      content.items.forEach(it => { const y = Math.round(it.transform[5]); rows.set(y, (rows.get(y) || []).concat({ x: it.transform[4], s: it.str })); });
      [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, parts]) => out.push(parts.sort((a, b) => a.x - b.x).map(p => p.s).join(' ')));
    }
    return out.join('\n');
  }
  if (!window.Tesseract) await loadScriptOnce(INVOICE_LIBS.tesseract);
  const res = await window.Tesseract.recognize(file, 'eng', { logger: m => { if (m && m.status === 'recognizing text' && progress) progress(m.progress); } });
  return (res && res.data && res.data.text) || '';
}

// Words that name a filament color, for colors the shop doesn't have yet (longest first so "light blue" beats "blue").
const INVOICE_COLOR_WORDS = ['light blue', 'dark blue', 'navy blue', 'sky blue', 'light green', 'dark green', 'olive green', 'forest green', 'light gray', 'dark gray', 'light grey', 'dark grey',
  'rose gold', 'black', 'white', 'gray', 'grey', 'silver', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'violet', 'pink', 'magenta', 'brown', 'beige', 'tan', 'gold', 'bronze', 'copper',
  'transparent', 'clear', 'navy', 'teal', 'turquoise', 'cyan', 'lime', 'mint', 'ivory', 'cream', 'khaki', 'burgundy', 'maroon', 'peach', 'coral', 'lavender', 'wood', 'marble', 'rainbow']
  .sort((a, b) => b.length - a.length);
const INVOICE_STYLE_WORDS = ['silk', 'matte', 'glow in the dark', 'glow', 'galaxy', 'metallic', 'sparkle', 'glitter', 'translucent', 'dual color', 'tri color'];
const INVOICE_TOTAL_WORDS = /sub\s*-?total|grand total|total before|order total|^total|estimated tax|sales tax|\btax\b|shipping|handling|promotion|discount|coupon|gift card|refund|payment|visa|mastercard|amex|discover|item\(s\)/i;
function invoiceMoney(s) { const m = String(s).match(/\$\s?(\d{1,5}(?:,\d{3})*(?:\.\d{2}))/); return m ? Number(m[1].replace(/,/g, '')) : null; }
function titleCase(s) { return String(s).replace(/\b\w/g, c => c.toUpperCase()); }

// Colors named in an item's description: the shop's own colors first (by name), then common color words (new colors).
function invoiceColors(text) {
  const low = ' ' + String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
  const found = [];
  const taken = [];
  const hit = (word) => { const i = low.indexOf(' ' + word + ' '); return i >= 0 && !taken.some(([a, b]) => i < b && i + word.length + 2 > a) ? i : -1; };
  state.settings.colors.slice().sort((a, b) => b.name.length - a.name.length).forEach(c => {
    const w = c.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const i = w ? hit(w) : -1;
    if (i >= 0) { taken.push([i, i + w.length + 2]); found.push({ at: i, colorId: c.id, name: c.name }); }
  });
  INVOICE_COLOR_WORDS.forEach(w => {
    const i = hit(w);
    if (i < 0) return;
    taken.push([i, i + w.length + 2]);
    const before = INVOICE_STYLE_WORDS.find(s => low.slice(Math.max(0, i - s.length - 1), i + 1) === ' ' + s + ' ');
    const name = titleCase((before ? before + ' ' : '') + (w === 'grey' ? 'gray' : w === 'clear' ? 'transparent' : w));
    const same = state.settings.colors.find(c => c.name.toLowerCase() === name.toLowerCase());
    found.push(same ? { at: i, colorId: same.id, name: same.name } : { at: i, colorId: '', name });
  });
  const seen = new Set();
  return found.sort((a, b) => a.at - b.at).filter(f => { const k = (f.colorId || f.name).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

// The invoice's text -> { date, orderNo, items: [{ text, qty, amount }], total, extra } (extra = tax + shipping).
function parseInvoiceText(text) {
  let lines = String(text || '').split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // A saved "Order Details" page goes on with suggestions and ads: stop reading there.
  const stop = lines.findIndex(l => /^(pick up where you left off|customers who (bought|viewed)|recommended for you|inspired by your|related to items you|back to top|sponsored products)/i.test(l));
  if (stop > 0) lines = lines.slice(0, stop);
  const all = lines.join('\n');
  const orderNo = (all.match(/\b(\d{3}-\d{7}-\d{7})\b/) || [])[1] || '';
  const dm = all.match(/(?:order placed|ordered on|order date|date)[:\s]*([A-Z][a-z]+\.? \d{1,2},? \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i) || all.match(/\b([A-Z][a-z]+ \d{1,2}, \d{4})\b/);
  const date = dm ? etsyDate(dm[1].replace('.', '')) : '';
  const find = re => { const l = lines.find(x => re.test(x)); return l ? invoiceMoney(l.slice(l.search(re))) : null; };
  const total = [/grand total/i, /order total/i, /^total(?! before)[:\s]/i].reduce((v, re) => (v !== null ? v : find(re)), null);
  const subtotal = [/item\(s\) subtotal/i, /items? subtotal/i, /subtotal[:\s]*\$/i].reduce((v, re) => (v !== null ? v : find(re)), null);
  const items = [];
  let cur = null;
  // Amazon lists the price of one; "2 of:" means twice that.
  const close = () => { if (cur) { const each = invoiceMoney(cur.text); cur.amount = each === null ? null : Math.round(each * cur.qty * 100) / 100; items.push(cur); cur = null; } };
  lines.forEach(l => {
    const start = l.match(/^(\d{1,3})\s*of\s*:?\s*(.*)$/i);
    if (start) { close(); cur = { qty: Number(start[1]) || 1, text: start[2] }; if (invoiceMoney(l) !== null) close(); return; }
    if (!cur) return;
    if (/^(sold by|supplied by|condition|return|shipping address|shipping speed|payment|item\(s\) subtotal)/i.test(l) || INVOICE_TOTAL_WORDS.test(l)) { close(); return; }
    cur.text += ' ' + l;
    if (invoiceMoney(l) !== null) close();
  });
  close();
  // The "Order Details" page (or its screenshot): each item's name is the line above "Sold by", its price just after.
  if (!items.length) {
    lines.forEach((l, n) => {
      if (!/^sold by\b/i.test(l) || n === 0) return;
      const desc = lines[n - 1];
      if (invoiceMoney(desc) !== null || desc.replace(/[^a-z]/gi, '').length < 6) return;
      const after = lines.slice(n + 1, n + 6);
      const priceLine = after.find(x => invoiceMoney(x) !== null && !INVOICE_TOTAL_WORDS.test(x) && !/list price|was:/i.test(x));
      if (!priceLine) return;
      const q = (lines.slice(Math.max(0, n - 3), n + 6).join(' ').match(/(?:qty|quantity)[:\s]*(\d{1,3})/i) || [])[1];
      const qty = Number(q) || 1;
      items.push({ text: desc, qty, amount: Math.round(invoiceMoney(priceLine) * qty * 100) / 100 });
    });
  }
  // Anything else: any line with a price that isn't a total is an item.
  if (!items.length) {
    lines.forEach((l, n) => {
      const amount = invoiceMoney(l);
      if (amount === null || INVOICE_TOTAL_WORDS.test(l)) return;
      let desc = l.replace(/\$\s?[\d,]+\.\d{2}/g, '').trim();
      if (desc.replace(/[^a-z]/gi, '').length < 6 && n > 0) desc = (lines[n - 1] + ' ' + desc).trim();
      if (desc.replace(/[^a-z]/gi, '').length < 6 || INVOICE_TOTAL_WORDS.test(desc)) return;
      const q = (lines.slice(n, n + 3).join(' ').match(/qty[:\s]*(\d{1,3})/i) || [])[1];
      items.push({ text: desc, qty: Number(q) || 1, amount: Math.round(amount * (Number(q) || 1) * 100) / 100 });
    });
  }
  items.forEach(it => { it.text = it.text.replace(/\$\s?[\d,]+\.\d{2}/g, '').replace(/\s+/g, ' ').trim(); });
  const sum = items.reduce((s, it) => s + (it.amount || 0), 0);
  const base = subtotal !== null ? subtotal : sum;
  const extra = total !== null && Math.abs(total - base) >= 0.01 ? Math.round((total - base) * 100) / 100 : 0;
  return { date, orderNo, items, total, extra };
}

// Filament (PLA, PETG, TPU, ABS, ASA... rolls), not accessories that mention it.
function invoiceIsFilament(t) {
  return /filament|\bpla\+?\b|petg|\babs\b|\btpu\b|\basa\b|\bnylon\b|spool/i.test(t)
    && !/nozzle|glue|dryer|dry box|storage|holder|rack|scraper|clean|hot ?end|extruder|ptfe|tube|build plate|bed|sheet|tape|spray|tool|kit|printer\b(?!.*filament)|resin|vacuum|bag|desiccant/i.test(t.replace(/3d printer filament/ig, 'filament'));
}
// One review line per color (a multi-color pack is split evenly), or one line for anything that isn't filament
// (shown, but never added). Tax and shipping: only the filament's share of them is added.
function invoiceLines(parsed) {
  const out = [];
  parsed.items.forEach(it => {
    const t = it.text, amount = it.amount || 0;
    const isFil = invoiceIsFilament(t);
    if (!isFil) { out.push({ what: t.slice(0, 120), amount, filament: false, other: true, colorId: '', newColor: '', grams: 0 }); return; }
    const kg = t.match(/(\d+(?:\.\d+)?)\s*kg/i), g = t.match(/(\d{3,4})\s*g\b/i);
    const spool = kg ? Math.round(Number(kg[1]) * 1000) : g ? Number(g[1]) : 1000;
    const packs = Number((t.match(/(\d{1,2})\s*(?:-|\s)?(?:pack|pcs|rolls|spools|colors)\b/i) || t.match(/\bx\s?(\d{1,2})\b/i) || [])[1]) || 1;
    const colors = invoiceColors(t);
    const total = spool * packs * (it.qty || 1);
    const list = colors.length ? colors : [{ colorId: '', name: '' }];
    const each = Math.round(amount / list.length * 100) / 100;
    list.forEach((c, n) => out.push({
      what: `${t.slice(0, 90)}${list.length > 1 ? ` (${c.name})` : ''}`, filament: true,
      amount: n === list.length - 1 ? Math.round((amount - each * (list.length - 1)) * 100) / 100 : each,
      colorId: c.colorId || '', newColor: c.colorId ? '' : c.name, grams: Math.round(total / list.length)
    }));
  });
  const all = parsed.items.reduce((s, it) => s + (it.amount || 0), 0), fil = out.filter(l => l.filament).reduce((s, l) => s + l.amount, 0);
  const share = parsed.extra && all > 0 && fil > 0 ? Math.round(parsed.extra * fil / all * 100) / 100 : 0;
  if (share) out.push({ what: 'Tax, shipping and discounts on the filament', amount: share, filament: false, tax: true, colorId: '', newColor: '', grams: 0 });
  return out;
}

function renderInvoiceReader(where) {
  const inv = state.invoice && state.invoice.where === where ? state.invoice : null;
  return `<div class="invoice-reader" id="invoice-${where}">
    <button type="button" class="btn-sm" id="invoice-read-${where}" onclick="document.getElementById('invoice-file-${where}').click()">Read an Amazon invoice (photo, screenshot or PDF)</button>
    <input type="file" id="invoice-file-${where}" accept="image/*,application/pdf,.pdf" multiple hidden onchange="readInvoiceFiles(this, '${where}')" />
    <span class="field-help" id="invoice-status-${where}" role="status">${inv && inv.busy ? esc(inv.busy) : state.invoiceMsg && state.invoiceMsg.where === where ? esc(state.invoiceMsg.text) : ''}</span>
    <div class="alert error" id="invoice-err-${where}"></div>
    ${inv && inv.lines ? renderInvoiceReview(inv) : ''}
  </div>`;
}
async function readInvoiceFiles(input, where) {
  const files = [...(input.files || [])].slice(0, 6);
  input.value = '';
  if (!files.length) return;
  state.invoiceMsg = null;
  state.invoice = { where, busy: 'Reading the invoice... (a photo can take up to a minute)' };
  render();
  const status = () => document.getElementById(`invoice-status-${where}`);
  try {
    let text = '';
    for (let n = 0; n < files.length; n++) {
      text += '\n' + await invoiceTextFromFile(files[n], p => { const s = status(); if (s) s.textContent = `Reading ${files.length > 1 ? `picture ${n + 1} of ${files.length}` : 'the invoice'}... ${Math.round(p * 100)}%`; });
    }
    const parsed = parseInvoiceText(text);
    const lines = invoiceLines(parsed);
    if (!lines.length) throw new Error('none');
    const already = parsed.orderNo && (moneyData().invoices || []).includes(parsed.orderNo);
    state.invoice = { where, lines, date: parsed.date || new Date().toISOString().slice(0, 10), orderNo: parsed.orderNo, total: parsed.total, already, text };
    render();
    document.getElementById(`invoice-review-${where}`)?.focus();
  } catch (e) {
    state.invoice = null;
    render();
    showAlert(`invoice-err-${where}`, e && e.message === 'none'
      ? "I couldn't find any items on that invoice. Try a clearer photo (flat, in good light, the whole page), a screenshot, or the PDF from Amazon's \"View invoice\"."
      : "Couldn't read that file. Check your connection and try again, or try a screenshot or the PDF.", 'error');
  }
}
function renderInvoiceReview(inv) {
  const colors = state.settings.colors.slice().sort(byName);
  const sum = inv.lines.filter(invoiceAdds).reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const fil = inv.lines.filter(l => l.filament && (l.colorId || l.newColor) && Number(l.grams) > 0);
  const kg = fil.reduce((s, l) => s + Number(l.grams), 0) / 1000;
  const perKg = kg ? fil.reduce((s, l) => s + (Number(l.amount) || 0), 0) / kg : 0;
  const w = inv.where;
  return `<div class="invoice-review" id="invoice-review-${w}" tabindex="-1">
    <strong>Check what I read${inv.orderNo ? ` (Amazon order ${esc(inv.orderNo)})` : ''}</strong>
    ${inv.already ? `<div class="alert error" style="display:block;">You already added this Amazon order. Adding it again would count it twice.</div>` : ''}
    <div class="field-help">Fix anything I misread. Only filament is added: each roll's cost goes into your purchases and its grams onto that color's stock, plus the filament's share of the tax and shipping. Anything else on the invoice is shown but not added.</div>
    <div class="field" style="max-width:200px;"><label for="inv-date-${w}">Date</label><input type="date" id="inv-date-${w}" value="${esc(inv.date)}" onchange="state.invoice.date = this.value" /></div>
    ${inv.lines.map((l, n) => `<div class="invoice-line${invoiceAdds(l) ? '' : ' not-added'}">
      <div class="field" style="flex:3;"><label for="inv-what-${w}-${n}">Item ${n + 1}</label><input type="text" id="inv-what-${w}-${n}" maxlength="120" value="${esc(l.what)}" oninput="state.invoice.lines[${n}].what = this.value" /></div>
      <div class="field"><label for="inv-amt-${w}-${n}">Cost ($)</label><input type="number" id="inv-amt-${w}-${n}" ${l.tax ? '' : 'min="0"'} step="0.01" value="${esc(String(l.amount))}" oninput="state.invoice.lines[${n}].amount = parseFloat(this.value) || 0; updateInvoiceTotal()" /></div>
      <div class="field"><label for="inv-color-${w}-${n}">Filament color</label>
        <select id="inv-color-${w}-${n}" onchange="setInvoiceColor(${n}, this.value)">
          <option value="" ${!l.filament ? 'selected' : ''}>${l.tax ? 'Tax and shipping (added)' : 'Not filament (not added)'}</option>
          ${colors.map(c => `<option value="${esc(c.id)}" ${l.filament && l.colorId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          <option value="new" ${l.filament && !l.colorId ? 'selected' : ''}>New color…</option>
        </select></div>
      ${l.filament && !l.colorId ? `<div class="field"><label for="inv-new-${w}-${n}">New color name</label><input type="text" id="inv-new-${w}-${n}" maxlength="40" value="${esc(l.newColor)}" placeholder="e.g. Silk Gold" oninput="state.invoice.lines[${n}].newColor = this.value" /></div>` : ''}
      ${l.filament ? `<div class="field"><label for="inv-grams-${w}-${n}">Grams</label><input type="number" id="inv-grams-${w}-${n}" min="0" step="50" value="${esc(String(l.grams))}" oninput="state.invoice.lines[${n}].grams = parseFloat(this.value) || 0" /></div>` : ''}
      <button type="button" class="btn-sm danger" onclick="state.invoice.lines.splice(${n}, 1); render();" aria-label="Leave out item ${n + 1}">✕</button>
    </div>`).join('')}
    <button type="button" class="btn-sm" onclick="state.invoice.lines.push({ what: '', amount: 0, filament: false, colorId: '', newColor: '', grams: 0 }); render();">+ Add a line</button>
    <p class="field-help" id="invoice-total-${w}">${invoiceTotalText(inv, sum)}</p>
    ${perKg ? `<label class="special-order-check"><input type="checkbox" id="inv-cost-${w}" /> Also set my filament cost per kg to ${money2(perKg)} (this invoice's average; used for material estimates)</label>` : ''}
    <div class="money-controls"><button type="button" class="btn-primary" id="invoice-add-${w}" onclick="applyInvoice()">Add to purchases and stock</button>
      <button type="button" class="btn-sm" onclick="state.invoice = null; render();">Cancel</button></div>
  </div>`;
}
function invoiceAdds(l) { return !!(l.filament || l.tax); }
function invoiceTotalText(inv, sum) {
  const left = inv.lines.filter(l => !invoiceAdds(l)).length;
  return `Adding ${money2(sum)} of filament${inv.total !== null && inv.total !== undefined ? ` (the whole invoice was ${money2(inv.total)})` : ''}.${left ? ` ${left} other item${left === 1 ? '' : 's'} not added.` : ''}`;
}
function updateInvoiceTotal() {
  const inv = state.invoice, el = inv && document.getElementById(`invoice-total-${inv.where}`);
  if (el) el.textContent = invoiceTotalText(inv, inv.lines.filter(invoiceAdds).reduce((s, l) => s + (Number(l.amount) || 0), 0));
}
function setInvoiceColor(n, value) {
  const l = state.invoice && state.invoice.lines[n];
  if (!l) return;
  l.filament = value !== '';
  l.colorId = value === 'new' || value === '' ? '' : value;
  if (value !== '') l.tax = false;
  if (l.filament && !l.grams) l.grams = 1000;
  render();
  document.getElementById(`inv-color-${state.invoice.where}-${n}`)?.focus();
}
async function applyInvoice() {
  const inv = state.invoice;
  if (!inv) return;
  const w = inv.where, date = inv.date;
  const err = msg => showAlert(`invoice-err-${w}`, msg, 'error');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { err('Pick the date of the order.'); return; }
  const lines = inv.lines.filter(l => invoiceAdds(l) && (String(l.what).trim() || Number(l.amount) > 0));
  if (!lines.some(l => l.filament)) { err("There's no filament on this invoice to add. Pick a color on a line if I missed one."); return; }
  const unnamed = lines.find(l => l.filament && !l.colorId && !String(l.newColor).trim());
  if (unnamed) { err('Give each new color a name, or pick one of your colors.'); return; }
  const setCost = document.getElementById(`inv-cost-${w}`)?.checked;
  const btn = document.getElementById(`invoice-add-${w}`);
  if (btn) btn.disabled = true;
  try {
    // 1. New colors (one per name), added to Settings > Colors.
    const newNames = [...new Map(lines.filter(l => l.filament && !l.colorId).map(l => [String(l.newColor).trim().toLowerCase(), String(l.newColor).trim()])).values()];
    const added = [];
    if (newNames.length) {
      const colors = state.settings.colors.slice();
      newNames.forEach(name => {
        const same = colors.find(c => c.name.toLowerCase() === name.toLowerCase());
        if (same) { added.push(same); return; }
        const c = { id: settingsId(), name: titleCase(name).slice(0, 40), hex: guessColorHex(name) || '#888888', special: false };
        colors.push(c); added.push(c);
      });
      await saveSettings({ ...state.settings, colors });
      state.settingsDraft = null;
    }
    const colorOf = l => l.colorId || (added.find(c => c.name.toLowerCase() === String(l.newColor).trim().toLowerCase()) || {}).id;
    // 2. Grams onto each color's stock.
    const inventoryNow = { ...inventory() };
    const stockNotes = [];
    lines.filter(l => l.filament && Number(l.grams) > 0).forEach(l => {
      const id = colorOf(l);
      if (!id) return;
      const s = inventoryNow[id];
      inventoryNow[id] = { ...(s || {}), grams: Math.round(((s && Number.isFinite(s.grams) ? Math.max(0, s.grams) : 0) + Number(l.grams)) * 10) / 10 };
      if (!s) stockNotes.push((state.settings.colors.find(c => c.id === id) || {}).name || 'a color');
    });
    state.ownerPrivate = { ...(state.ownerPrivate || {}), inventory: inventoryNow };
    await saveOwnerPrivate('inventory');
    await syncOutOfStock();
    // 3. The purchases (one expense per line), and the order number so it isn't added twice.
    const exp = lines.map(l => ({ id: settingsId(), date, what: `Amazon: ${String(l.what).trim() || 'purchase'}`.slice(0, 120), amount: Math.round((Number(l.amount) || 0) * 100) / 100, ...(inv.orderNo ? { invoice: inv.orderNo } : {}) }));
    const patch = { expenses: expenses().concat(exp), invoices: (moneyData().invoices || []).concat(inv.orderNo ? [inv.orderNo] : []).slice(-500) };
    if (setCost) {
      const fil = lines.filter(l => l.filament && Number(l.grams) > 0), kg = fil.reduce((s, l) => s + Number(l.grams), 0) / 1000;
      if (kg) patch.costPerKg = Math.round(fil.reduce((s, l) => s + (Number(l.amount) || 0), 0) / kg * 100) / 100;
    }
    state.moneyYear = Number(date.slice(0, 4));
    const msg = `Added ${exp.length} purchase${exp.length === 1 ? '' : 's'} (${money2(exp.reduce((s, e) => s + e.amount, 0))})${added.length ? `, new color${added.length === 1 ? '' : 's'}: ${added.map(c => c.name).join(', ')}` : ''}.${stockNotes.length ? ` Started tracking stock for ${stockNotes.join(', ')} at what you just bought; change it in Settings > Colors if you had some already.` : ''}`;
    state.invoice = null;
    state.invoiceMsg = { where: w, text: msg };
    await writeMoney(patch);
  } catch (e) {
    if (btn) btn.disabled = false;
    err("Couldn't save. Check you're logged in, and that supabase/owner-tools.sql has been run.");
  }
}

// ── OWNER HELP: a searchable how-to for everything in owner mode ─────────────
// Built-in entries are OWNER_WIKI (keep them in step when owner screens change). The owner's own notes are saved in
// owner_private key `wiki` ({ entries: [{ id, title, text }] }) and searched the same way.
// go: [ownerTab, settingsTab?] for "Take me there".
const OWNER_WIKI = [
  // Getting started
  { id: 'login', area: 'Getting started', title: 'Log in, stay logged in, log out', keys: 'password sign in remember 30 days logout session',
    steps: ['Tap Owner at the top of the site and type your password.', 'Tick "Keep me logged in on this device for 30 days" on your own phone or computer only.', 'To log out, tap Logout at the top. To log out on every device (lost phone), open Change Password and tap "Log out everywhere".'] },
  { id: 'password', area: 'Getting started', title: 'Change your password', keys: 'security credentials strong password',
    steps: ['Tap Change Password in the owner menu.', 'Type a new password of 12 or more characters that isn\'t made of common words, then save.', 'The card lists extra safety tips, like 2-step sign-in on the Gmail you log in with.'], go: ['password'] },
  { id: 'updated', area: 'Getting started', title: 'Is the site up to date? (Updated N min ago, Reload now)', keys: 'update new version reload refresh deploy live',
    steps: ['The small "Updated N min ago" note shows when the site last changed.', 'If the site is updated while you have it open, a bar offers "Reload now". Tap it to get the newest version.', 'Settings > Updates lists every change made to the site.'], go: ['settings', 'updates'] },
  { id: 'sections', area: 'Getting started', title: 'Jump between sections of a page', keys: 'side buttons sections scroll navigate long page jump menu',
    steps: ['On any owner page with more than one section, a button for each section sits on the right side and stays there while you scroll.', 'Tap a button to jump to that section. The section you are reading is highlighted.', 'On a phone, tap the round "Sections" button at the bottom right to open the list, then tap a section.'] },
  { id: 'app', area: 'Getting started', title: 'Put the site on your home screen like an app', keys: 'install app icon home screen iphone android',
    steps: ['iPhone: open the site in Safari, tap Share, then "Add to Home Screen".', 'Android or Chrome: open the menu (three dots), then "Install app" or "Add to Home screen".'] },
  { id: 'bell', area: 'Getting started', title: 'The bell: notifications and phone alerts', keys: 'notifications alerts bell new request approved color idea unread',
    steps: ['The bell at the top shows new requests, approved quotes and new color ideas from customers. The number is how many you haven\'t looked at.', 'Tap an item to open that order (or, for a color idea, the Designs inbox). "Mark all read" clears the number.', 'To get a pop-up on your device, open the bell and tap "Turn on alerts", then allow notifications.'] },

  // Orders
  { id: 'desk', area: 'Orders', title: 'The order desk: Needs me, Waiting on them, Done', keys: 'orders list tabs search dashboard',
    steps: ['Orders opens the order desk. "Needs me" holds orders waiting on you; "Waiting on them" holds orders waiting on the customer; "Done" holds finished ones.', 'The search box looks in every tab: name, email, item or order number.', 'Tap an order to open it. On a phone it opens on its own screen; use Back to return to the list.', 'Each order shows a 6-step bar and one card with the next thing to do and one main button.'], go: ['dashboard'] },
  { id: 'emails-popup', area: 'Orders', title: 'Every email is shown first, and you can change it', keys: 'email preview edit send dont send skip pop-up popup',
    steps: ['Any button that emails a customer opens a pop-up with the exact email first.', 'Change the subject or any of the text if you like ("Undo my changes" puts it back). Your change is for that one email only.', 'Choose "Send email and continue", "Don\'t send email, continue" (the step happens, no email), or "Cancel, go back" (nothing happens).', 'To change an email for every order, edit it in Settings > Emails.'] },
  { id: 'quote', area: 'Orders', title: 'Price a request and send the quote', keys: 'quote price grams print time minutes send quote estimate',
    steps: ['Open the new request. Read "Their request" and the conversation.', 'For each item, fill in the print time and grams (a set price from your designs fills itself in).', 'If you need answers first, use "Confirm details with the customer" to send them questions instead.', 'Tap "Send quote", check the email in the pop-up, and send it. The customer gets a link to approve.'], go: ['dashboard'] },
  { id: 'edit-request', area: 'Orders', title: 'Change what the customer asked for, set your own price, add charges', keys: 'edit request own price owner price charge extra charge custom design terms special order roll',
    steps: ['Before the quote is sent, tap "Edit their request" on the order.', 'You can change names, items, colors and notes, set your own price per item (it beats the calculation), and "Add a charge" with your own label (the customer sees the label and amount).', 'Save. Then send the quote as usual.'] },
  { id: 'confirm', area: 'Orders', title: 'Confirm an order (and ask for the deposit)', keys: 'confirm approved looks good deposit request auto',
    steps: ['When a customer taps "Looks good", the order normally confirms itself and asks for the deposit.', 'To confirm each order yourself instead, tap "Let me confirm each order myself" on an order waiting for approval (or switch it in Settings > Show / hide).', 'Then the order waits in Needs me: tap "Confirm order" and check the email.'] },
  { id: 'payments', area: 'Orders', title: 'Record a deposit or payment', keys: 'deposit received paid it all payment received venmo amount receipt',
    steps: ['When the money shows in your Venmo, open the order.', 'Type the amount you received in "Amount in your Venmo".', 'Tap "Deposit received", "They paid it all", or (at the end) "Payment received". The receipt email says that amount.', 'A deposit (or full payment) sets their place in the print line.'] },
  { id: 'printing', area: 'Orders', title: 'Printing done (and the final payment request)', keys: 'printing done finished photo final payment remainder shipping deposit',
    steps: ['Add a photo of the finished print first under "Notes and photos": the customer sees it and it goes in the email.', 'Tap "Printing done". If they still owe money, they are emailed the rest plus the shipping deposit and asked for their address.', 'If they already paid in full, no payment email goes out and the order moves to Ready to ship.', 'Filament for the order comes off your stock now.'] },
  { id: 'print-anyway', area: 'Orders', title: 'Print before the deposit comes in', keys: 'print without deposit unpaid more menu',
    steps: ['On a confirmed order with no deposit, open More, then "Print without a deposit…".', 'Nothing is emailed. The order shows a warning that no deposit has come in.'] },
  { id: 'ship', area: 'Orders', title: 'Ship it, or hand it over in person', keys: 'ship shipped tracking carrier postage refund handed over in person invoice',
    steps: ['Type the ship date, carrier and tracking number, what the postage actually cost, and any note.', 'Tap "Save tracking and mark Shipped". The shipped email includes tracking, an invoice and the shipping deposit refund.', 'Send the refund amount by Venmo, then record it on the Fix numbers page.', 'Picked up in person? Tap "Handed over in person" instead (no email).'] },
  { id: 'more-menu', area: 'Orders', title: 'More menu: change the quote, go back a step, delete', keys: 'change quote go back undo delete order mistake',
    steps: ['Open the order, then More.', '"Change the quote" takes it back to a new request so you can re-price it (nothing is emailed until you send the new quote).', '"Go back a step" undoes the last step without emailing anyone (filament goes back to stock if you go back from Printing done).', '"Delete order…" removes it for good.'] },
  { id: 'fix-numbers', area: 'Orders', title: 'Fix numbers: amounts typed wrong, refunds, postage', keys: 'fix numbers deposit amount balance shipping deposit refund sent postage special order roll',
    steps: ['Orders > Fix numbers (or More > Fix numbers on an order).', 'Change any typed amount: deposit, balance, shipping deposit paid, postage, refund sent, special order roll cost, added charges.', 'It never changes an order\'s step and never emails anyone.'], go: ['numbers'] },
  { id: 'send-now', area: 'Orders', title: 'Send an email now (review request, reminder, resend)', keys: 'send email now review request reminder resend quote again shipping details',
    steps: ['Open the order and the "Send an email now" fold.', 'Pick the email (ask for a review, quote reminder, send the quote again, and so on). Only the ones that fit the order\'s step can be sent.', 'Check or change it in the pop-up and send.'] },
  { id: 'messages', area: 'Orders', title: 'Messages with a customer', keys: 'message chat conversation reply email replies',
    steps: ['Each order has one conversation: your messages, theirs, and every email sent.', 'Type in the box and send; they get it by email. Their email replies show up here within a few minutes.'] },
  { id: 'notes', area: 'Orders', title: 'Private notes and notes about a customer', keys: 'private notes client notes customer notes about payment issues',
    steps: ['"Notes and photos" on an order holds your private notes: customers never see them.', 'The "About" fold shows your notes about that customer and their other orders.'] },
  { id: 'practice', area: 'Orders', title: 'Practice with a pretend order', keys: 'practice test pretend try training',
    steps: ['Open Practice in the owner menu.', 'Walk a pretend order through every step and see each email it would send. Nothing is saved or emailed.'], go: ['practice'] },

  // Etsy to make
  { id: 'etsy-todo', area: 'Etsy orders to make', title: 'Keep track of Etsy orders to print', keys: 'etsy to make todo print list printed tick shipped',
    steps: ['Orders > Etsy to make.', 'Add orders with "Add unshipped orders from Etsy\'s Order Items file" (Etsy: Shop Manager, Settings, Options, Download Data, Order Items), or by hand.', 'Each waiting order shows its Etsy title, every part with a picture in its color, and a tick box for each piece. Tick a box when that piece is printed.', '"Print list by color" groups everything still to print by color.', 'When it ships, tap "Shipped: done".'], go: ['etsytodo'] },
  { id: 'etsy-todo-parts', area: 'Etsy orders to make', title: 'Split an Etsy order into parts and colors', keys: 'parts colors design add its parts edit order color idea',
    steps: ['On the order, tap Edit.', 'Under "From one of your designs", pick the design, a color idea (or each part\'s usual color) and how many, then "Add its parts". Each part gets a picture.', 'Remove the plain Etsy line with ✕ if you like, then "Save changes".'], go: ['etsytodo'] },

  // Designs
  { id: 'design-add', area: 'Designs', title: 'Add or change a design', keys: 'design gallery past work new design photos price set price publish',
    steps: ['Designs > "New design" (or Edit on an existing one).', 'Add the title, write-up, photos, print time and grams. A set price replaces the calculated price.', 'Save. Published designs show in the customer gallery.'], go: ['gallery'] },
  { id: 'preorders', area: 'Designs', title: 'Take pre-orders for a new product', keys: 'pre-order preorder launch new product not ready deposit first come first served waiting list',
    steps: ['Designs > Edit the design (or add it), then under "Pre-order" tick "Take pre-orders for this design". Optionally type when it should be ready, like "early January". Save.', 'Customers see a "Pre-order" label, a "Pre-order this" button and your note that pre-orders are made first come, first served, in the order deposits come in. The note is also on their order and in the quote, confirmed and deposit emails.', 'Each pre-order goes through the usual steps: send the quote, they confirm and pay the deposit.', 'The Pre-orders card at the top of Designs lists them in the order to make them: paid deposits first, by when they came in. Each order also says "Number N of M".', 'Type an expected print and ship time (like "Jan 12-15") next to an order in that card, or on the order itself, and tap Save. Do this when someone is first in line. Customers see their place in line and that time on their order and in the quote, confirmed and deposit emails.', 'When it launches, untick the Pre-order box. Orders already placed stay pre-orders until they ship.', 'To change the note: Settings > Wording, site text "preorderNote" (tick Live).'], go: ['gallery', ''] },
  { id: 'design-parts', area: 'Designs', title: 'Parts, add-ons and each part\'s color', keys: 'parts optional add-on stand price minutes default color',
    steps: ['In a design, add each part with its grams and starting color.', 'Tick "Optional add-on" for extras customers can choose (like a stand). Give it a price (for set-price designs) and extra print time.', 'Customers tick add-ons on the design page and pick a color per part.'], go: ['gallery'] },
  { id: 'color-map', area: 'Designs', title: 'Color ideas photo: show the design in any colors', keys: 'color ideas photo picture areas recolor background not a part join',
    steps: ['In a design, under "Color ideas photo", tap "Upload picture" (a picture where each part is a different solid color works best).', 'For each found area, pick which part it is. Leave the background and shadows as "Not a part". A red warning means an area looks like the background.', 'Use Join to put areas of one part together, or "Areas not split right?" to find fewer or more areas.', 'Add color ideas with "+ Add a color idea" or "Paste several color ideas at once" (Name, color, color per line).'], go: ['gallery'] },
  { id: 'color-inbox', area: 'Designs', title: 'Color ideas customers send in', keys: 'color idea submitted inbox publish dismiss rename suggestion',
    steps: ['New ideas show on the bell. Tap one, or open Designs.', 'In "Color ideas people sent in", change the name if you like, then "Publish for everyone" or "Dismiss".'], go: ['gallery'] },
  { id: 'calculator', area: 'Designs', title: 'Price calculator, saved models and comparing links', keys: 'calculator models saved library compare several links makerworld price check',
    steps: ['Designs > Calculator & Models.', 'Type print time and grams to see the price. Saved models remember a model\'s time and grams for next time.', '"Compare several links" prices several model links side by side (nothing is saved).'], go: ['calculator'] },

  // Money
  { id: 'money', area: 'Money', title: 'Sales, profit and the tax download', keys: 'money sales profit tax excel export year material cost per kg',
    steps: ['Open Money & Sales and pick the year.', 'Set "Your filament cost per 1 kg roll" so material estimates are right.', 'The tiles and the month table show sales, material, expenses and ads.', 'Tap "Download YEAR for taxes (Excel)" for a spreadsheet with every sheet (site orders, expenses, ads, Etsy).'], go: ['money'] },
  { id: 'expenses', area: 'Money', title: 'Add an expense', keys: 'expense purchase bought supplies receipt',
    steps: ['Money & Sales > Expenses: type the date, what it was and the amount, then "Add expense".', 'Remove one with ✕.'], go: ['money'] },
  { id: 'amazon', area: 'Money', title: 'Read an Amazon invoice (filament rolls into purchases and stock)', keys: 'amazon invoice receipt photo pdf screenshot filament rolls stock new color',
    steps: ['Tap "Read an Amazon invoice" (Money & Sales > Expenses, or Settings > Filament & colors > Stock on hand).', 'Pick the invoice PDF, the saved Order Details page, a screenshot or a photo.', 'Check what it read: only filament is added (glue, nozzles and so on are crossed out). Fix any color, grams or cost.', 'Tap "Add to purchases and stock": the cost goes into expenses, the grams onto that color\'s stock, and new colors into your colors.'], go: ['money'] },
  { id: 'ads', area: 'Money', title: 'Track what you spend on ads', keys: 'ads advertising facebook instagram flyers marketing',
    steps: ['Money & Sales > Ad costs: date, where the ad ran, amount, then "Add ad cost".', 'You see the total, a split by place, and ad cost per paid order. Etsy Ads go in the Etsy card instead.'], go: ['money'] },
  { id: 'etsy-upload', area: 'Money', title: 'Bring in Etsy sales (CSV files, a whole year at once)', keys: 'etsy csv orders order items statement upload import download data fees shipping labels',
    steps: ['On Etsy: Shop Manager, Settings, Options, Download Data. Download the Orders file (and Order Items for item names). For fees and labels: Finances, Monthly statements, Download CSV.', 'Money & Sales > Etsy sales > "Upload Etsy files". Pick all of them at once (up to 60, like two years).', 'Check the preview, then "Add to my sales". Uploading the same files again never counts anything twice; newer files add only what\'s new.'], go: ['money'] },
  { id: 'etsy-edit', area: 'Money', title: 'Fix or type an Etsy sale by hand; yearly summaries', keys: 'etsy edit sale by hand summary yearly activity material grams refund',
    steps: ['Tap Edit on a sale to change any number (sale, shipping, fees, label, grams or material, refund, note). Sales you edit are never overwritten by uploads.', '"Add an Etsy sale by hand" adds one. Tick "This is a yearly summary…" to enter a whole year at once until you upload that year\'s statements.'], go: ['money'] },

  // Settings
  { id: 'colors', area: 'Settings', title: 'Filament colors (add, rename, price per gram, photos)', keys: 'colors filament add color special rate price per gram photo out of stock',
    steps: ['Settings > Filament & colors.', '"Add a color", type its name (the swatch color is guessed from the name), and optionally a price per gram, a real-life photo, a link and a description.', 'Tap Save at the bottom.'], go: ['settings', 'colors'] },
  { id: 'stock', area: 'Settings', title: 'Filament stock on hand', keys: 'stock inventory grams roll low running out hidden',
    steps: ['Settings > Filament & colors > Stock on hand.', 'Type how many grams you have, or tap "+ 1 kg roll". Set "Warn me at" for each color.', 'Grams come off when printing is done. A color at 0 g is hidden from customers until you add more.'], go: ['settings', 'colors'] },
  { id: 'prices', area: 'Settings', title: 'Prices and rules', keys: 'prices rules base fee per minute per gram deposit percent shipping deposit logo price venmo username extra colors multi-color surcharge',
    steps: ['Settings > Prices & rules.', 'Change the base fee, print time and material rates, deposit %, shipping deposit, logo price, the extra colors charge (how many colors are included and the $ per print for more), Venmo username and reminder timing.', 'Sent quotes keep the prices they were sent with.'], go: ['settings', 'prices'] },
  { id: 'emails', area: 'Settings', title: 'Change the wording of any email', keys: 'emails wording templates text placeholders',
    steps: ['Settings > Emails.', 'Pick an email and change its subject or text. Words in {curly brackets} are filled in for each order.', 'Save. To change one email just once, edit it in the pop-up when you send it instead.'], go: ['settings', 'emails'] },
  { id: 'wording', area: 'Settings', title: 'Site wording, FAQ and what customers see', keys: 'wording site text faq show hide features about links how it works material note',
    steps: ['Settings > About & links: your about text, photo, Messenger and Etsy links.', 'Settings > Wording and Site text: the words on the site. Site text can be saved as a draft until you make it live.', 'Settings > FAQ: questions and answers. Settings > Show / hide: switch parts of the site on or off.'], go: ['settings', 'text'] },
  { id: 'vacation', area: 'Settings', title: 'Vacation mode', keys: 'vacation away closed holiday pause',
    steps: ['Settings > Vacation: turn it on, set the date you\'re back and an optional message.', 'Customers see a notice and the emails mention it.'], go: ['settings', 'vacation'] },
  { id: 'reviews', area: 'Settings', title: 'Approve customer reviews', keys: 'reviews approve stars half star photos testimonials',
    steps: ['Customers get a review link about a week after shipping (or send it yourself with "Send an email now").', 'Settings > Reviews: "Approve and show" puts a review on the site.', 'On any review, tap "Add photos" to upload pictures (up to 4) that a customer sent you, or "Remove" under a photo to take it off. Tap Save to keep the changes.'], go: ['settings', 'reviews'] },

  // Behind the scenes
  { id: 'sql', area: 'Behind the scenes', title: 'When asked to "run the SQL" in Supabase', keys: 'sql supabase database setup run owner-tools',
    steps: ['Some new features need a one-time database update. Claude will tell you which file.', 'Open the Supabase SQL editor: https://supabase.com/dashboard/project/xpssamjjyarajtwtrwqx/sql/new', 'Paste the file\'s contents and tap Run. It\'s safe to run again.'] },
  { id: 'backup', area: 'Behind the scenes', title: 'Backups and the email robot', keys: 'backup drive google apps script email robot emails not sent',
    steps: ['A backup of your orders and settings goes to your Google Drive every week.', 'Emails are sent by a Google Apps Script that picks up site changes about every 15 to 20 minutes. If something goes wrong it emails you.'] }
];

function ownerWikiNotes() { const d = (state.ownerPrivate && state.ownerPrivate.wiki) || {}; return Array.isArray(d.entries) ? d.entries : []; }
function wikiEntries() {
  return ownerWikiNotes().map(n => ({ id: 'mine-' + n.id, mine: n.id, area: 'My notes', title: n.title, keys: '', steps: String(n.text || '').split(/\n+/).filter(Boolean) })).concat(OWNER_WIKI);
}
function wikiMatches(e, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${e.title} ${e.area} ${e.keys} ${e.steps.join(' ')}`.toLowerCase();
  return words.every(w => hay.includes(w));
}
function wikiGo(tab, sub) {
  if (tab === 'password') { state.showPasswordForm = true; render(); document.getElementById('new-pw')?.focus(); return; }
  if (sub) state.settingsTab = sub;
  setOwnerTab(tab);
  window.scrollTo(0, 0);
}
function renderWikiResults() {
  const q = state.wikiQuery || '';
  const list = wikiEntries().filter(e => wikiMatches(e, q));
  if (!list.length) return `<p class="field-help">Nothing matches "${esc(q)}". Try fewer or different words, like "deposit", "etsy" or "stock".</p>`;
  const areas = [...new Set(list.map(e => e.area))];
  return `${q ? `<p class="field-help" role="status">${list.length} match${list.length === 1 ? '' : 'es'}</p>` : ''}
    ${areas.map(a => `<h3 class="wiki-area">${esc(a)}</h3>${list.filter(e => e.area === a).map(e => `<details class="wiki-entry" id="wiki-${esc(e.id)}"${q || state.wikiOpen === e.id ? ' open' : ''}>
      <summary>${esc(e.title)}</summary>
      <ol class="wiki-steps">${e.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      <div class="money-controls">
        ${e.go ? `<button type="button" class="btn-sm" onclick="wikiGo('${esc(e.go[0])}', '${esc(e.go[1] || '')}')">Take me there</button>` : ''}
        ${e.mine ? `<button type="button" class="btn-sm" onclick="state.wikiEdit = '${esc(e.mine)}'; render(); document.getElementById('wiki-note-title')?.focus();">Edit</button>
          <button type="button" class="btn-sm danger" onclick="removeWikiNote('${esc(e.mine)}')">Delete</button>` : ''}
      </div></details>`).join('')}`).join('')}`;
}
function renderWikiPage() {
  const editing = state.wikiEdit !== undefined && state.wikiEdit !== null;
  const note = editing ? ownerWikiNotes().find(n => n.id === state.wikiEdit) || { title: '', text: '' } : null;
  return `
    <div class="owner-page-header">
      <div class="section-header">
        <div class="section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg></div>
        <div><h2 class="section-title">Help</h2><div class="section-sub">How to do everything in owner mode. Search by any word.</div></div>
      </div>
    </div>
    <div class="card wiki-card">
      <div class="field"><label for="wiki-q">Search help</label>
        <input type="search" id="wiki-q" value="${esc(state.wikiQuery || '')}" placeholder="e.g. deposit, refund, etsy, stock, email" autocomplete="off"
          oninput="state.wikiQuery = this.value; const r = document.getElementById('wiki-results'); if (r) r.innerHTML = renderWikiResults();" /></div>
      <div id="wiki-results">${renderWikiResults()}</div>
    </div>
    <div class="card" id="wiki-mine">
      <h3 class="card-title">${editing && state.wikiEdit ? 'Edit your note' : 'Your own notes'}</h3>
      <p class="field-help" style="margin-top:0;">Write down your own how-tos (supplier details, printer settings, packing steps). They show under "My notes" and come up in the search.</p>
      ${editing ? `<div class="field"><label for="wiki-note-title">Title</label><input type="text" id="wiki-note-title" maxlength="120" value="${esc(note.title)}" /></div>
        <div class="field"><label for="wiki-note-text">Steps or notes (one per line)</label><textarea id="wiki-note-text" rows="6" maxlength="4000">${esc(note.text)}</textarea></div>
        <div class="money-controls"><button type="button" class="btn-sm" id="wiki-note-save" onclick="saveWikiNote()">Save note</button>
          <button type="button" class="btn-sm" onclick="state.wikiEdit = null; render();">Cancel</button></div>`
      : `<button type="button" class="btn-sm" id="wiki-note-add" onclick="state.wikiEdit = ''; render(); document.getElementById('wiki-note-title')?.focus();">+ Add a note</button>`}
      <div class="alert error" id="wiki-err"></div>
    </div>`;
}
async function writeWikiNotes(entries) {
  state.ownerPrivate = { ...(state.ownerPrivate || {}), wiki: { entries } };
  try { await saveOwnerPrivate('wiki'); return true; }
  catch (e) { showAlert('wiki-err', "Couldn't save. Check you're logged in, and that supabase/owner-tools.sql has been run.", 'error'); return false; }
}
async function saveWikiNote() {
  const title = String((document.getElementById('wiki-note-title') || {}).value || '').trim().slice(0, 120);
  const text = String((document.getElementById('wiki-note-text') || {}).value || '').trim().slice(0, 4000);
  if (!title || !text) { showAlert('wiki-err', 'Give the note a title and some text.', 'error'); return; }
  const id = state.wikiEdit || settingsId();
  const list = ownerWikiNotes();
  const next = list.some(n => n.id === id) ? list.map(n => (n.id === id ? { id, title, text } : n)) : [{ id, title, text }].concat(list);
  if (await writeWikiNotes(next.slice(0, 200))) { state.wikiEdit = null; state.wikiOpen = 'mine-' + id; render(); }
}
async function removeWikiNote(id) {
  if (!confirm('Delete this note?')) return;
  if (await writeWikiNotes(ownerWikiNotes().filter(n => n.id !== id))) render();
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
  state.openConversation = id;
  if (!state.galleryLoaded) loadGallery().then(render);
  render();
  (document.getElementById(`conv-${id}`) || document.getElementById(`order-${id}`))?.scrollIntoView({ block: 'start' });
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
// Print time is typed as hours and minutes, like everywhere else on the site; the item keeps the total minutes.
function oeTime(i) {
  const it = oeItem(i);
  if (!it) return;
  const h = (document.getElementById(`oe-hours-${i}`) || { value: '' }).value;
  const m = (document.getElementById(`oe-minutes-${i}`) || { value: '' }).value;
  it.minutes = totalPrintMinutes(h, m);
  updateOeEstimate(i);
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
    ? colors.map(c => ({ value: c.id, name: c.name + (c.outOfStock ? ' (out of stock)' : ''), part: { name: c.name, filType: c.special ? 'special' : 'color', colorId: c.id } }))
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
    <div class="row2" style="max-width:340px;">
      <div class="field">
        <label for="oe-hours-${i}">Print time: hours (optional)</label>
        <input type="number" id="oe-hours-${i}" value="${esc(hoursFromMinutes(it.minutes || it.knownMinutes))}" min="0" step="1" oninput="oeTime(${i})" />
      </div>
      <div class="field">
        <label for="oe-minutes-${i}">Minutes</label>
        <input type="number" id="oe-minutes-${i}" value="${esc(minuteRemainder(it.minutes || it.knownMinutes))}" min="0" max="59" step="1" oninput="oeTime(${i})" />
      </div>
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
      ${extras.length ? `<ul class="owner-edit-extras">${extras.map((p, j) => `<li>${esc(p.name)}${p.filType === 'leftover' ? ' (leftover roll)' : ''}
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
  return [...state.settings.colors].sort(byName).map(c => ({ value: c.id, name: c.name, part: { name: c.name, filType: c.special ? 'special' : 'color', colorId: c.id } }))
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

function reversePartColors(i) {
  const item = state.draftItems[i];
  if (!item || !item.designParts) return;
  const on = item.designParts.filter(p => !p.optional || p.include);
  const rev = reverseColors(Object.fromEntries(on.map(p => [p.id, p.colorId])));
  if (!rev) return;
  on.forEach(p => { p.colorId = rev[p.id]; });
  applyPartColors(item);
  render();
  queueDraftSave();
  document.getElementById(`part-reverse-${i}`)?.focus();
}

function renderPartColors(item, i) {
  const choices = partColorChoices();
  return `<fieldset class="part-colors">
    <legend>Choose a color for each part</legend>
    <div class="field-help">${esc(materialNote())}</div>
    ${cmRequestPreview(item)}
    ${reverseColors(Object.fromEntries(item.designParts.filter(p => !p.optional || p.include).map(p => [p.id, p.colorId]))) ? `<button type="button" class="btn-sm" id="part-reverse-${i}" onclick="reversePartColors(${i})">Reverse colors</button>` : ''}
    ${item.designParts.map((p, k) => `<div class="part-color-row ${p.optional && !p.include ? 'part-off' : ''}">
      ${p.photo ? thumbImg(p.photo, '', 'thumb', 'class="part-thumb"') : '<span class="part-thumb part-thumb-blank" aria-hidden="true"></span>'}
      <div class="field">
        ${p.optional ? `<label class="special-order-check part-add"><input type="checkbox" id="part-add-${i}-${k}" ${p.include ? 'checked' : ''} onchange="setPartIncluded(${i}, ${k}, this.checked)" />
          Add ${esc(p.name)} <span class="field-help">(optional${p.price && item.basePrice > 0 ? `, +$${p.price.toFixed(2)}` : ''}${p.grams ? `, about ${p.grams} g` : ''}${p.minutes ? `, +${fmtTime(p.minutes)}` : ''})</span></label>` : ''}
        ${p.optional && !p.include ? '' : `<label for="part-color-${i}-${k}">${p.optional ? `Color for ${esc(p.name)}` : esc(p.name)}${p.grams && !p.optional ? ` <span class="field-help">(about ${p.grams} g)</span>` : ''}</label>
        <div class="color-pick">${colorDot(p.colorId)}<select id="part-color-${i}-${k}" class="color-select" style="${colorTextStyle(p.colorId)}" onchange="setPartColor(${i}, ${k}, this.value)">
          ${choices.map(c => `<option value="${esc(c.key)}" style="${colorTextStyle(c.key)}" ${c.key === p.colorId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select></div>`}
      </div>
    </div>`).join('')}
    ${renderColorInfo(item)}
    ${item.designParts.filter(p => !p.optional || p.include).length > Number(currentRules().freeColors) ? colorFeeNote(item) : ''}
    <div class="field-help">Want a color I don't carry for a part? Say so under "Anything you'd like changed?"</div>
  </fieldset>`;
}

// The note about the extra colors charge, where customers pick colors. Stands out once they've picked more.
function colorFeeNote(item) {
  const rules = currentRules();
  if (!(Number(rules.colorFee) > 0)) return '';
  const over = colorCount(item) > Number(rules.freeColors);
  const text = t('colorFeeNote').replace(/\{free\}/g, rules.freeColors).replace(/\{price\}/g, `$${Number(rules.colorFee).toFixed(2)}`);
  return `<div class="field-help color-fee-note ${over ? 'over' : ''}">${over ? `<strong>This print has ${colorCount(item)} colors (+$${Number(rules.colorFee).toFixed(2)} each print).</strong> ` : ''}${esc(text)}</div>`;
}
// Design page: the parts and their weights.
function renderDesignParts(g) {
  if (!featureOn('designParts')) return '';
  if (!g.parts || !g.parts.length) return '';
  return `<div class="card design-parts">
    <h3 class="card-title">Parts</h3>
    <div class="field-help" style="margin-bottom:10px;">${g.parts.some(p => p.optional) ? 'Tick any add-ons you want; the price updates. ' : ''}You can pick a color for each part when you request this.</div>
    <div class="design-parts-grid">${g.parts.map((p, k) => `<div class="design-part">
      ${p.photo ? thumbImg(p.photo, p.name, 'thumb') : '<span class="part-thumb-blank" aria-hidden="true"></span>'}
      <div class="design-part-name">${esc(p.name)}</div>
      ${p.optional ? `<div class="gallery-meta"><strong>Optional add-on</strong>${p.price && g.price > 0 ? ` · +$${p.price.toFixed(2)}` : ''}${p.minutes ? ` · +${fmtTime(p.minutes)} print time` : ''}</div>` : ''}
      ${p.grams ? `<div class="gallery-meta">${p.grams} g</div>` : ''}
      ${p.optional ? `<label class="special-order-check part-add"><input type="checkbox" id="design-add-${k}" ${designOpts(g.id).include[p.id] ? 'checked' : ''} onchange="setDesignAddOn('${esc(g.id)}', '${esc(p.id)}', this.checked, ${k})" /> Add ${esc(p.name)}</label>` : ''}
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
            ${(state.settings.colors.length ? [...state.settings.colors].sort(byName).map(c => ({ key: c.id, name: c.name + (c.outOfStock ? ' (out of stock)' : '') })) : [{ key: 'black', name: 'Black' }])
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
    ['navFaq', 'Menu: questions button (also that page title)', 'FAQ'],
    ['navFaqSub', 'Menu: questions button, small text', 'Quick answers'],
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
    ['colorPhotoNote', 'Under a color\'s photo ({color} = the color name)', 'Photo: an example of {color} filament, printed before.'],
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
    ['preorderThis', 'Pre-order designs: the request button', 'Pre-order this'],
    ['preorderBadge', 'Pre-order designs: the label on the design', 'Pre-order'],
    ['preorderNote', 'Pre-orders: the first come, first served note (design page, request form, their order and the quote, confirmed and deposit emails)', DEFAULT_PREORDER_NOTE],
    ['logoOffer', 'Design page: company logo add-on note ({price} = the logo price from Prices)', 'Want your company logo on it? I can add it for {price} more per item. Tick "Add my company logo" when you request it, and I\'ll ask you for the logo file.'],
    ['logoCheckbox', 'Request form: company logo tick box ({price} = the logo price)', 'Add my company logo (+{price} each)'],
    ['colorFeeNote', 'Request form: note about the extra colors charge ({free} = colors included, {price} = the charge from Prices)', 'Up to {free} colors are included. Using more than {free} colors adds {price} per print, because each extra color means more color changes and more work on every print.'],
    ['colorIdeasTitle', 'Design page: color ideas heading', 'Color ideas'],
    ['colorIdeasNote', 'Design page: under the color ideas heading', 'This design repainted in other colors, to help you choose. Colors on a screen are close, not exact.'],
    ['colorIdeasOwn', 'Design page: button to pick your own colors', 'Pick your own'],
    ['colorIdeasRequest', 'Design page: request button under color ideas', 'Request in these colors'],
    ['colorIdeasYours', 'Request form: under the picture of their colors', 'Your colors on this design. Colors on a screen are close, not exact.'],
  ]],
  ['Order steps customers see', [
    ['step_estimate', 'Step 1 name', 'Request Received'],
    ['stepInfo_estimate', 'Step 1 description', "We've received your request and will respond promptly after reviewing it. Any prices shown are automated estimates, not final costs."],
    ['step_details_check', 'Step 2 name (shown while you wait for the customer to confirm details)', 'Reviewing'],
    ['stepInfo_details_check', 'Step 2 description', "I've sent you a few questions to make sure I get your order right. Please check your email and reply."],
    ['step_quote_sent', 'Step 3 name', 'Quote Ready'],
    ['stepInfo_quote_sent', 'Step 3 description', "Your quote is ready. Review the price below and tap \"Looks good\" if you'd like to go ahead."],
    ['step_order_received', 'Step 4 name', 'Confirmed & Printing'],
    ['stepInfo_order_received', 'Step 4 description', 'Your order is confirmed. Once your deposit is in, you have a place in line and it will be printed.'],
    ['step_final_payment_needed', 'Step 5 name', 'Printing Complete'],
    ['stepInfo_final_payment_needed', 'Step 5 description', 'Your print is done. We need your final payment, shipping deposit (partly refunded based on the actual postage cost) and shipping address before we send it out.'],
    ['step_ready_to_ship', 'Step 6 name', 'Ready to Ship'],
    ['stepInfo_ready_to_ship', 'Step 6 description', "Your payment and address are in. I'm packing your order and will send the tracking number."],
    ['step_delivered', 'Step 7 name', 'Shipped'],
    ['stepInfo_delivered', 'Step 7 description', 'Your order is on its way. The tracking details are below and in your email.'],
    ['pay_unpaid', 'Payment: not asked yet', 'Unpaid'],
    ['pay_payment_requested', 'Payment: asked', 'Payment Requested'],
    ['pay_deposit_received', 'Payment: deposit paid', 'Deposit Received'],
    ['pay_payment_received', 'Payment: paid', 'Payment Received'],
  ]],
  ['Your messages (only you see these)', [
    ['firstReply', 'Starting text of your first message on an order ({name} = their first name, {item} = what they asked for)', "Hi {name}, thanks for your request for {item}! I'm looking it over now and will have a quote for you soon. "],
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
  ['autoDeposit', 'Send the deposit request as soon as a customer taps "Looks good" (off: you confirm each order yourself first)'],
  ['orderAgain', '"Order again" button'],
  ['leftoverRolls', '"Your leftover rolls" card on My Requests'],
  ['videos', 'Videos on design pages'],
  ['designParts', 'Parts and a color per part on designs'],
  ['colorIdeas', 'Color ideas: design photos repainted in other colors'],
  ['logoAddOn', 'Company logo add-on (note on designs and the tick box)']
];
// Site text with the logo add-on price filled in.
function logoText(key) { return t(key).replace(/\{price\}/g, `$${(Number(currentRules().logoPrice) || 0).toFixed(2)}`); }
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
function faqMatches(f, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const text = (String(f.q || '') + ' ' + String(f.a || '')).toLowerCase();
  return words.every(w => text.includes(w));
}
// Typing in the search box keeps only the question boxes whose question or answer has every word typed.
function faqSearch(value) {
  state.faqQuery = value;
  const box = document.getElementById('faq-list');
  if (!box) return;
  let shown = 0;
  box.querySelectorAll('.faq-card').forEach(el => {
    const hit = faqMatches({ q: el.dataset.q, a: el.dataset.a }, value);
    el.hidden = !hit;
    if (hit) shown++;
  });
  const none = document.getElementById('faq-none');
  if (none) none.hidden = shown > 0;
  // Folded at the bottom of a page: searching opens the list, clearing the box folds it again.
  const all = document.getElementById('faq-all');
  if (all && !state.faqOpen) { const typing = !!String(value).trim(); box.hidden = !typing; all.hidden = typing; if (none && !typing) none.hidden = true; }
}
// An answer opens in a pop-up over the page (outside #app-root so a redraw can't remove it). X, tap outside or Escape closes it.
let faqReturnFocus = null, faqScrollY = 0;
function openFaq(id) {
  const f = (state.settings.faq || []).find(x => x.id === id);
  if (!f) return;
  closeFaq();
  faqReturnFocus = document.activeElement;
  faqScrollY = window.scrollY;
  const m = document.createElement('div');
  m.id = 'faq-modal'; m.className = 'faq-modal';
  m.innerHTML = `<div class="faq-dialog" role="dialog" aria-modal="true" aria-labelledby="faq-modal-title">
    <button type="button" class="faq-close" id="faq-close" aria-label="Close">&times;</button>
    <h3 id="faq-modal-title">${esc(f.q)}</h3>
    <div class="faq-answer">${renderWriteup(f.a)}</div>
  </div>`;
  m.addEventListener('click', e => { if (e.target === m) closeFaq(); });
  document.body.appendChild(m);
  document.getElementById('faq-close').addEventListener('click', closeFaq);
  document.getElementById('faq-close').focus({ preventScroll: true });
}
function closeFaq() {
  const m = document.getElementById('faq-modal');
  if (!m) return;
  m.remove();
  if (faqReturnFocus && faqReturnFocus.focus) faqReturnFocus.focus({ preventScroll: true });
  window.scrollTo(0, faqScrollY);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFaq(); });
function faqList() { return (state.settings.faq || []).filter(f => f.live || previewingDrafts()); }
function renderFaq() {
  const list = faqList();
  if (!featureOn('faq') || !list.length) return '';
  const q = state.faqQuery || '';
  const hits = list.filter(f => faqMatches(f, q)).length;
  const searchable = list.length > 2;
  // At the bottom of other pages the questions stay folded to the title and search box until you search or tap Show all.
  const folded = searchable && state.clientTab !== 'faq' && !q.trim() && !state.faqOpen;
  return `<div class="card faq">
    <${state.clientTab === 'faq' ? 'h2' : 'h3'} class="card-title">${esc(t('faqTitle'))}</${state.clientTab === 'faq' ? 'h2' : 'h3'}>
    ${searchable ? `<input type="search" id="faq-search" class="faq-search" placeholder="Search for your question here" aria-label="Search the questions and answers" value="${esc(q)}" oninput="faqSearch(this.value)" />` : ''}
    ${searchable && state.clientTab !== 'faq' ? `<button type="button" class="btn-link faq-all" id="faq-all" ${folded ? '' : 'hidden'} onclick="state.faqOpen = true; document.getElementById('faq-list').hidden = false; this.hidden = true;">Show all ${list.length} questions</button>` : ''}
    <div id="faq-list" class="faq-grid" ${folded ? 'hidden' : ''}>
    ${list.map(f => `<button type="button" class="faq-card" data-q="${esc(f.q)}" data-a="${esc(f.a)}" ${faqMatches(f, q) ? '' : 'hidden'} onclick="openFaq('${esc(f.id)}')">${esc(f.q)}${f.live ? '' : ' <span class="draft-tag">Draft</span>'}</button>`).join('')}
    </div>
    <p class="field-help" id="faq-none" ${hits ? 'hidden' : ''}>Nothing matches that. Try another word, or send a request and ask me.</p>
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
function designEstimateItem(g, colors, opts) {
  const item = { ...blankItem(), ...galleryItemFields(g), mode: 'gallery' };
  if (colors) item.designParts.forEach(p => { if (colors[p.id]) p.colorId = colors[p.id]; });
  applyDesignOpts(item, opts);
  if ((item.designParts || []).length) applyPartColors(item); else ensureItemColor(item);
  return item;
}
// `opts` (design page only): the add-ons and logo the customer ticked there (`designOpts`).
function designEstimate(g, colors, opts) {
  if (g.price > 0 && !opts) return g.price;
  const item = designEstimateItem(g, colors, opts);
  if (fixedPrice(item) !== null) return calcPerPrint(0, 0, item);
  const mins = Number(item.knownMinutes) || g.minutes;
  return mins && Number(item.grams) > 0 ? calcPerPrint(mins, item.grams, item) : null;
}
// The design page's own choices before "Request this": optional add-on parts and the company logo.
function designOpts(id) {
  state.designOpts = state.designOpts || {};
  return state.designOpts[id] || (state.designOpts[id] = { include: {}, logo: false });
}
function applyDesignOpts(item, opts) {
  if (!opts) return item;
  (item.designParts || []).forEach(p => { if (p.optional) p.include = !!opts.include[p.id]; });
  item.logo = featureOn('logoAddOn') && !!opts.logo;
  return item;
}
function refreshDesignPrice(id, focusId) {
  const g = state.gallery.find(x => x.id === id);
  if (!g) return;
  if (document.getElementById('color-ideas')) { refreshColorIdeas(id, focusId); return; }
  const el = document.getElementById('work-price');
  if (el) el.innerHTML = renderWorkPrice(g);
  if (focusId) document.getElementById(focusId)?.focus();
}
function setDesignAddOn(id, partId, on, k) {
  designOpts(id).include[partId] = !!on;
  refreshDesignPrice(id, `design-add-${k}`);
}
function setDesignLogo(id, on) {
  designOpts(id).logo = !!on;
  refreshDesignPrice(id, 'design-logo');
}

// Owner's edit form: the price for one item with today's prices (an order being reviewed has no saved prices yet).
function renderOeEstimate(it) {
  const d = oeDraft();
  const rules = rulesFor(d || {});
  const set = fixedPrice({ ...it, setPrice: ownerSetPrice(it) });
  const fixed = set === null ? null : set + addOnCharge(it, rules);
  const qty = Math.max(1, parseInt(it.qty, 10) || 1);
  if (fixed !== null) return `<div class="price-big">$${(fixed * qty).toFixed(2)}</div><div class="field-help">Fixed price: $${fixed.toFixed(2)} each${qty > 1 ? ` × ${qty}` : ''}.</div>`;
  const minutes = Number(it.minutes) || Number(it.knownMinutes) || 0;
  const grams = Number(it.grams) || 0;
  if (!minutes || !grams) return `<div class="field-help">Add print time and grams to see the price.</div>`;
  const per = printPrice(minutes, grams, it, rules);
  return `<div class="price-big">$${(per * qty).toFixed(2)}</div>
    <div class="field-help">$${per.toFixed(2)} each${qty > 1 ? ` × ${qty}` : ''} · ${fmtTime(minutes)} · today's prices, including each color's own price per gram${usesSpecialSpool(it) ? ' (plus the special order roll)' : ''}.</div>
    <div class="price-breakdown">${priceBreakdown(minutes, grams, colorsRate(it, rules, grams), qty, rules)}</div>
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
          ${choices.map(c => `<option value="${esc(c.key)}" style="${colorTextStyle(c.key)}" ${c.key === p.colorId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
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
  const combos = (Array.isArray(m.combos) ? m.combos : []).slice(0, 16).map((c, n) => {
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
function cmCanvas(m, parts, colors, label, cls = '', focus = -1) {
  const on = r => r.part && parts.some(p => p.id === r.part);
  const targets = m.regions.flatMap(r => r.hexes.map(() => (on(r) ? cmColor(colors[r.part]).hex : null)));
  const groups = m.regions.flatMap(r => r.hexes.map(() => (on(r) ? parts.findIndex(p => p.id === r.part) : -1)));
  return `<canvas class="cm-canvas ${cls}" data-cm="${esc(JSON.stringify({ photo: m.photo, hexes: cmHexes(m), targets, groups, ...(focus >= 0 ? { focus } : {}) }))}" role="img" aria-label="${esc(label)}"></canvas>`;
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
      } else {
        data = recolorPixels(img, labels, s.hexes, s.targets, s.groups ? cmBases(labels, s.hexes, s.groups) : null);
        // One part on its own: everything else faded, so it's clear which piece to print.
        if (s.groups && typeof s.focus === 'number') for (let p = 0; p < labels.length; p++) if (s.groups[labels[p]] !== s.focus) for (let k = 0; k < 3; k++) data[p * 4 + k] = 235 + data[p * 4 + k] * 0.08;
      }
      if (cmPainted.size > 60) cmPainted.clear();
      cmPainted.set(spec, data);
    }
    cv.width = img.width; cv.height = img.height;
    cv.getContext('2d').putImageData(new ImageData(data, img.width, img.height), 0, 0);
    cv.classList.add('cm-ready');
  }
  checkCmBackground();
}
// Owner's color-map form: an area that runs along most of the picture's edge is almost surely the background.
// Set to a part, every color change (and "Reverse colors") would repaint the background instead of the print.
async function checkCmBackground() {
  const el = document.getElementById('cm-bg-warn');
  const m = state.galleryForm && state.galleryForm.colorMap;
  if (!el || !m || !m.regions.length) return;
  const img = await cmPixels(m.photo);
  if (!img || !el.isConnected) return;
  const hexes = cmHexes(m), lk = m.photo + '|' + hexes.join(',');
  if (!cmLabelCache.has(lk)) cmLabelCache.set(lk, labelPixels(img, hexes));
  const labels = cmLabelCache.get(lk), w = img.width, h = img.height, edge = new Array(hexes.length).fill(0);
  let n = 0;
  const add = p => { edge[labels[p]]++; n++; };
  for (let x = 0; x < w; x++) { add(x); add((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { add(y * w); add(y * w + w - 1); }
  let start = 0;
  const bad = [];
  m.regions.forEach((r, k) => {
    const s = r.hexes.reduce((t, x, j) => t + edge[start + j], 0);
    start += r.hexes.length;
    if (r.part && n && s / n > 0.4) bad.push(k);
  });
  el.innerHTML = bad.length ? `<div class="alert error" style="display:block;">${bad.map(k => `Area ${k + 1}`).join(' and ')} ${bad.length > 1 ? 'run' : 'runs'} along the edges of the picture, so ${bad.length > 1 ? 'they look' : 'it looks'} like the background, but ${bad.length > 1 ? 'they are' : 'it is'} set to a part. Then changing that part's color (or "Reverse colors") repaints the background instead of the print. If it is the background, set it to "Not a part (leave as is)".</div>` : '';
}

// ── Customers: the design page card ──
function cmView(g, combos) {
  state.cmView = state.cmView || {};
  const v = state.cmView[g.id] || (state.cmView[g.id] = { pick: '', own: {} });
  if (v.pick !== 'own' && !combos.some(c => c.id === v.pick) && !cmSavedFor(g.id).some(s => `s-${s.id}` === v.pick)) v.pick = combos[0] ? combos[0].id : 'own';
  return v;
}

// ── Reverse colors, and color combinations customers save on their own device ──
// With exactly 2 different colors on show, "reverse" swaps them (every part in one swaps to the other).
function reverseColors(colors) {
  const keys = [...new Set(Object.values(colors || {}))];
  if (keys.length !== 2) return null;
  const out = {};
  Object.keys(colors).forEach(id => { out[id] = colors[id] === keys[0] ? keys[1] : keys[0]; });
  return out;
}
const CM_SAVED_KEY = 'soloprint_saved_colors_v1';
function cmSavedAll() { try { return JSON.parse(localStorage.getItem(CM_SAVED_KEY)) || {}; } catch (e) { return {}; } }
function cmSavedWrite(all) { try { localStorage.setItem(CM_SAVED_KEY, JSON.stringify(all)); } catch (e) { /* not kept */ } }
// Saved combinations for a design, only those whose colors are all still available.
function cmSavedFor(gid) {
  const keys = partColorChoices().map(c => c.key);
  return (cmSavedAll()[gid] || []).filter(s => s && s.colors && Object.values(s.colors).every(k => keys.includes(k)));
}
// The colors of the parts the customer gets: an add-on they haven't ticked doesn't count for "Reverse colors".
function cmOnShow(g, colors) {
  const opts = designOpts(g.id);
  return Object.fromEntries(Object.entries(colors || {}).filter(([id]) => { const p = (g.parts || []).find(x => x.id === id); return !p || !p.optional || opts.include[id]; }));
}
function cmSavedPick(g, v) { return cmSavedFor(g.id).find(s => `s-${s.id}` === v.pick); }
function reverseCmColors(id) {
  const g = state.gallery.find(x => x.id === id);
  if (!g) return;
  const colors = cmViewColors(id);
  const rev = reverseColors(cmOnShow(g, colors));
  if (!rev) return;
  const v = cmView(g, cmCombosFor(g, partColorChoices()));
  v.own = { ...colors, ...rev };
  v.pick = 'own';
  refreshColorIdeas(id, 'cm-reverse');
}
function saveCmColors(id) {
  const g = state.gallery.find(x => x.id === id);
  if (!g) return;
  const colors = cmViewColors(id);
  if (!colors) return;
  const name = (document.getElementById('cm-save-name')?.value || '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'My colors';
  const all = cmSavedAll();
  const list = (all[id] || []).slice(0, 9);
  const s = { id: 'u' + Date.now().toString(36), name, colors, sent: false };
  all[id] = [s].concat(list);
  cmSavedWrite(all);
  cmView(g, []).pick = `s-${s.id}`;
  refreshColorIdeas(id, `cm-pick-s-${s.id}`);
}
function removeCmSaved(id, sid) {
  const all = cmSavedAll();
  all[id] = (all[id] || []).filter(s => s.id !== sid);
  cmSavedWrite(all);
  const g = state.gallery.find(x => x.id === id);
  if (g) cmView(g, []).pick = '';
  refreshColorIdeas(id, 'cm-pick-own');
}
async function sendCmColors(id, sid) {
  const all = cmSavedAll();
  const s = (all[id] || []).find(x => x.id === sid);
  const msg = document.getElementById('cm-send-msg');
  if (!s) return;
  const btn = document.getElementById('cm-send');
  if (btn) btn.disabled = true;
  try {
    await supaFetch('/rpc/submit_color_idea', { method: 'POST', body: JSON.stringify({ p_design: id, p_name: s.name, p_colors: s.colors }) });
    s.sent = true;
    cmSavedWrite(all);
    refreshColorIdeas(id, 'cm-send-msg');
  } catch (e) {
    if (btn) btn.disabled = false;
    showAlert('cm-send-msg', "Couldn't send it just now. Please try again in a bit.", 'error');
  }
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
  const combo = combos.find(c => c.id === v.pick) || cmSavedPick(g, v);
  return cmPartColors(g.parts, combo ? combo.colors : v.own, choices);
}
function renderColorIdeas(g) {
  if (!cmShown(g)) return '';
  const choices = partColorChoices(), combos = cmCombosFor(g, choices), v = cmView(g, combos);
  const colors = cmViewColors(g.id), opts = designOpts(g.id);
  const price = designEstimate(g, colors, opts), item = designEstimateItem(g, colors, opts);
  return `<div class="card color-ideas" id="color-ideas">
    <h3 class="card-title">${esc(t('colorIdeasTitle'))}</h3>
    <div class="field-help" style="margin-bottom:10px;">${esc(t('colorIdeasNote'))}</div>
    <div class="cm-picks" role="group" aria-label="${esc(t('colorIdeasTitle'))}">
      ${combos.map(c => `<button type="button" class="btn-sm" id="cm-pick-${esc(c.id)}" aria-pressed="${v.pick === c.id}" onclick="setCmPick('${esc(g.id)}', '${esc(c.id)}')">${esc(c.name)}</button>`).join('')}
      ${cmSavedFor(g.id).map(s => `<button type="button" class="btn-sm" id="cm-pick-s-${esc(s.id)}" aria-pressed="${v.pick === `s-${s.id}`}" onclick="setCmPick('${esc(g.id)}', 's-${esc(s.id)}')">${esc(s.name)} (mine)</button>`).join('')}
      <button type="button" class="btn-sm" id="cm-pick-own" aria-pressed="${v.pick === 'own'}" onclick="setCmPick('${esc(g.id)}', 'own')">${esc(t('colorIdeasOwn'))}</button>
    </div>
    ${cmCanvas(g.colorMap, g.parts, colors, `${g.title}: ${cmDescribe(g.parts, colors)}`)}
    ${v.pick === 'own' ? `<div class="cm-own">${g.parts.map((p, k) => `<div class="field"><label for="cm-own-${k}">${esc(p.name)}${cmMissing(g.colorMap, [p]).length ? ' (not shown in the picture)' : ''}</label>
      <div class="color-pick">${colorDot(colors[p.id])}<select id="cm-own-${k}" class="color-select" style="${colorTextStyle(colors[p.id])}" onchange="setCmOwn('${esc(g.id)}', '${esc(p.id)}', this.value, ${k})">
        ${choices.map(c => `<option value="${esc(c.key)}" style="${colorTextStyle(c.key)}" ${c.key === colors[p.id] ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select></div></div>`).join('')}</div>` : cmLegend(g.parts, colors, g.colorMap)}
    ${renderCmSaveTools(g, v, colors)}
    ${price !== null ? `<div class="cm-price" id="cm-price" aria-live="polite"><span class="gallery-price">$${price.toFixed(2)}</span> <span class="gallery-meta">${galleryPriceLabel(g)}, in these colors</span>
      ${g.price > 0 ? '' : renderColorLines(item, item.grams, currentRules())}</div>` : ''}
    <button class="btn-sm" type="button" id="cm-request" onclick="requestGalleryItem('${esc(g.id)}', cmViewColors('${esc(g.id)}'))">${esc(t('colorIdeasRequest'))}</button>
  </div>`;
}
function renderCmSaveTools(g, v, colors) {
  const mine = cmSavedPick(g, v);
  const gid = esc(g.id);
  return `<div class="cm-tools">
    ${reverseColors(cmOnShow(g, colors)) ? `<button type="button" class="btn-sm" id="cm-reverse" onclick="reverseCmColors('${gid}')">Reverse colors</button>` : ''}
    ${mine ? `<div class="cm-saved-note">${mine.sent ? `<span id="cm-send-msg" tabindex="-1">Sent. Thank you! If I like it, I may add "${esc(mine.name)}" for everyone (I might change the name).</span>`
        : `<button type="button" class="btn-sm" id="cm-send" onclick="sendCmColors('${gid}', '${esc(mine.id)}')">Send to SoloPrint to share with everyone</button>
           <div class="alert error" id="cm-send-msg" tabindex="-1"></div>`}
      <button type="button" class="btn-sm danger" onclick="removeCmSaved('${gid}', '${esc(mine.id)}')">Remove my saved colors</button></div>`
      : `<div class="cm-save"><label for="cm-save-name">Save these colors</label>
        <div class="cm-save-row"><input type="text" id="cm-save-name" maxlength="40" placeholder="Name them, e.g. Sunset" />
        <button type="button" class="btn-sm" id="cm-save" onclick="saveCmColors('${gid}')">Save</button></div>
        <div class="field-help">Saved on this device. You can send ones you love to me to share with everyone.</div></div>`}
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

// ── Owner: color ideas customers sent in (Designs page). Publishing adds one to the design's color ideas. ──
async function fetchColorIdeas() {
  if (state.colorIdeasLoading) return;
  state.colorIdeasLoading = true;
  try { state.colorIdeas = await supaFetch('/color_ideas?select=*&order=created_at.asc') || []; state.colorIdeasError = false; }
  catch (e) { state.colorIdeas = state.colorIdeas || []; state.colorIdeasError = true; }
  state.colorIdeasLoaded = true;
  state.colorIdeasLoading = false;
}
async function loadColorIdeas() { await fetchColorIdeas(); render(); }
// The bell (owner): each color idea a customer sent in, until it's published or dismissed.
function colorIdeaNotifications() {
  return (state.colorIdeas || []).map(c => {
    const g = state.gallery.find(x => x.id === c.design_id);
    const names = Object.values(c.colors || {}).map(k => cmColor(k).name);
    return { id: `idea-${c.id}`, batchId: '', at: c.created_at, title: `New color idea: "${c.name || 'Untitled'}"`,
      body: `${g ? g.title + ': ' : ''}${[...new Set(names)].join(' and ')}. Tap to publish or dismiss it.` };
  });
}
function openColorIdeaInbox() {
  setOwnerTab('gallery');
  const go = () => { const el = document.getElementById('color-inbox'); if (el) { el.scrollIntoView({ block: 'start' }); el.querySelector('button, input')?.focus(); } return !!el; };
  if (!go()) setTimeout(go, 600);
}
function renderColorIdeasInbox() {
  if (!state.colorIdeasLoaded) { if (!state.colorIdeasLoading) loadColorIdeas(); return ''; }
  const list = (state.colorIdeas || []).filter(c => state.gallery.some(g => g.id === c.design_id));
  if (state.colorIdeasError) return `<div class="alert error" style="display:block;">Couldn't load the color ideas people sent. If you haven't yet, run supabase/owner-tools.sql in the Supabase SQL Editor.</div>`;
  if (!list.length) return '';
  return `<div class="card" id="color-inbox"><h3 class="card-title">Color ideas people sent in (${list.length})</h3>
    <div class="field-help">Change the name if you like, then publish it to add it to that design's color ideas for everyone, or dismiss it.</div>
    ${list.map(c => {
      const g = state.gallery.find(x => x.id === c.design_id);
      const parts = g.parts || [];
      const colors = parts.length ? Object.fromEntries(parts.map(p => [p.id, (c.colors || {})[p.id] || p.defaultColor || 'white'])) : {};
      const full = g.colorMap && g.colorMap.combos.length >= 16;
      return `<div class="cm-combo" id="cmi-${esc(c.id)}">
        <div><strong>${esc(g.title)}</strong>: ${esc(parts.map(p => `${p.name} in ${cmColor((c.colors || {})[p.id]).name}`).join(', ') || 'no parts')}</div>
        <div class="field"><label for="cmi-name-${esc(c.id)}">Name to show</label><input type="text" id="cmi-name-${esc(c.id)}" maxlength="40" value="${esc(c.name)}" /></div>
        ${g.colorMap && cmUsable(g.colorMap) ? '' : '<div class="field-help">This design has no color ideas picture yet, so it can be published but won\'t show until you add one.</div>'}
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn-sm" ${full || !g.colorMap ? 'disabled' : ''} onclick="publishColorIdea('${esc(c.id)}')">Publish for everyone</button>
          <button type="button" class="btn-sm danger" onclick="dismissColorIdea('${esc(c.id)}')">Dismiss</button>
        </div>${full ? '<div class="field-help">That design already has 16 color ideas.</div>' : ''}${g.colorMap ? '' : '<div class="field-help">Add the color ideas picture to this design first (edit it below).</div>'}
        <div class="alert error" id="cmi-err-${esc(c.id)}"></div></div>`;
    }).join('')}</div>`;
}
async function publishColorIdea(id) {
  const c = (state.colorIdeas || []).find(x => x.id === id);
  const g = c && state.gallery.find(x => x.id === c.design_id);
  if (!c || !g || !g.colorMap) return;
  const name = (document.getElementById(`cmi-name-${id}`)?.value || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!name) { showAlert(`cmi-err-${id}`, 'Give it a name first.', 'error'); return; }
  const ids = (g.parts || []).map(p => p.id);
  const colors = {};
  ids.forEach(pid => { if (c.colors && c.colors[pid]) colors[pid] = c.colors[pid]; });
  g.colorMap.combos.push({ id: 'c' + Date.now().toString(36), name, colors });
  try {
    await writeGalleryItem(g);
    await supaFetch(`/color_ideas?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
  } catch (e) {
    g.colorMap.combos.pop();
    showAlert(`cmi-err-${id}`, "Couldn't publish it. If you were logged out, log in again and retry.", 'error');
    return;
  }
  state.colorIdeas = state.colorIdeas.filter(x => x.id !== id);
  render();
}
async function dismissColorIdea(id) {
  try { await supaFetch(`/color_ideas?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } }); }
  catch (e) { showAlert(`cmi-err-${id}`, "Couldn't dismiss it. Try again.", 'error'); return; }
  state.colorIdeas = (state.colorIdeas || []).filter(x => x.id !== id);
  render();
}


// ── Owner: the drying rack's named color ideas, added in one tap (Designs page) ──
// The picture is the rack's render (presets/drying-rack.png). Its white parts are the Base and the black
// panel is the Spine, found by the same area finder the owner's form uses.
const DRYING_RACK_PRESET = {
  photo: 'https://soloprint.vercel.app/presets/drying-rack.png',
  regions: [{ hexes: ['#56565a'], part: '' }, { hexes: ['#f2f2f2', '#c1c1c1', '#9a9a9a'], part: 'base' }, { hexes: ['#1e1e25'], part: 'spine' }],
  ideas: [['Santa Dragon', 'Red', 'Green'], ['Omni', 'Red', 'Silver'], ['Bumblebee', 'Gold', 'Black'], ['Shamrock', 'Green', 'White'],
    ['Lets Go Mets', 'Blue', 'Orange'], ['Gold Coast', 'Blue', 'Gold'], ['Vader', 'Black', 'Red'], ['Halloween', 'Black', 'Orange'],
    ['Dog Pound', 'Orange', 'Brown'], ['Sandcastle', 'Beige', 'Blue']]
};
function rackDesign() { return state.gallery.find(g => /drying\s*rack/i.test(g.title)) || null; }
function rackIdeasAdded(g) {
  const names = ((g && g.colorMap && g.colorMap.combos) || []).map(c => c.name.toLowerCase());
  return DRYING_RACK_PRESET.ideas.every(i => names.includes(i[0].toLowerCase()));
}
function renderDryingRackSetup() {
  if (!state.galleryLoaded || !state.gallery.length) return '';
  const g = rackDesign();
  if (g && rackIdeasAdded(g)) return '';
  return `<div class="card" id="rack-setup"><h3 class="card-title">Drying rack color ideas</h3>
    <div class="field-help">Your 10 named color ideas (${esc(DRYING_RACK_PRESET.ideas.map(i => i[0]).join(', '))}) are ready. Tap the button and I'll add them to the design, including the picture and its Base and Spine parts if it doesn't have them yet. New parts have no weights of their own, so the site splits the design's total weight evenly between the two colors, the way it does for any part without a weight.</div>
    <div class="field"><label for="rack-design">Design</label><select id="rack-design">
      ${state.gallery.map(x => `<option value="${esc(x.id)}" ${g && g.id === x.id ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}
    </select></div>
    <div class="alert error" id="rack-err"></div>
    <button type="button" class="btn-sm" id="rack-go" onclick="addDryingRackIdeas()">Add the 10 color ideas</button>
  </div>`;
}
async function addDryingRackIdeas() {
  const g = state.gallery.find(x => x.id === document.getElementById('rack-design')?.value);
  const fail = msg => showAlert('rack-err', msg, 'error');
  if (!g) { fail('Pick the drying rack design first.'); return; }
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const colorKey = n => { const c = (state.settings.colors || []).find(x => norm(x.name) === norm(n)); return c ? c.id : ''; };
  const wanted = [...new Set(DRYING_RACK_PRESET.ideas.flatMap(i => i.slice(1)))];
  const missing = wanted.filter(n => !colorKey(n));
  if (missing.length) { fail(`These colors aren't in Settings > Colors yet: ${missing.join(', ')}. Add them (or fix their spelling) and tap again.`); return; }
  // The two parts: the design's own if it has them, otherwise a Base and a Spine sharing the design's weight.
  let parts = (g.parts || []).map(p => ({ ...p }));
  let base, spine;
  if (parts.length >= 2) {
    base = parts.find(p => /base|plate|bottom|floor/i.test(p.name)) || parts[0];
    spine = parts.find(p => p !== base && /spine|back|panel|wall|tower/i.test(p.name)) || parts.find(p => p !== base);
  } else {
    // No weights typed on the parts: the site then splits the design's own total weight evenly between the colors
    // (applyPartColors / colorGrams), exactly as it does for any part without grams. Nothing is guessed here.
    base = { id: 'base', name: 'Base', grams: null, photo: '', optional: false, price: null, defaultColor: '', minutes: null };
    spine = { id: 'spine', name: 'Spine', grams: null, photo: '', optional: false, price: null, defaultColor: '', minutes: null };
    parts = [base, spine];
  }
  let map = g.colorMap && cmUsable(g.colorMap) ? JSON.parse(JSON.stringify(g.colorMap)) : null;
  if (!map) {
    const regions = DRYING_RACK_PRESET.regions.map(r => ({ hexes: r.hexes, part: r.part === 'base' ? base.id : r.part === 'spine' ? spine.id : '' }));
    map = { photo: DRYING_RACK_PRESET.photo, regions, combos: (g.colorMap && g.colorMap.combos) || [] };
  }
  const have = map.combos.map(c => norm(c.name));
  const add = DRYING_RACK_PRESET.ideas.filter(i => !have.includes(norm(i[0])));
  if (map.combos.length + add.length > 16) { fail(`A design can hold 16 color ideas; this one has ${map.combos.length}. Remove some first.`); return; }
  add.forEach((i, n) => map.combos.push({ id: 'c' + (Date.now() + n).toString(36), name: i[0], colors: { [base.id]: colorKey(i[1]), [spine.id]: colorKey(i[2]) } }));
  const cleaned = cleanColorMap(map, cleanDesignParts(parts));
  if (!cleaned) { fail("Couldn't prepare the picture. Nothing was changed."); return; }
  const next = { ...g, parts: cleanDesignParts(parts), colorMap: cleaned };
  const btn = document.getElementById('rack-go');
  if (btn) { btn.disabled = true; btn.textContent = 'Adding...'; }
  try { await writeGalleryItem(next); }
  catch (e) { if (btn) { btn.disabled = false; btn.textContent = 'Add the 10 color ideas'; } fail("Couldn't save. If you were logged out, log in again and tap once more."); return; }
  await loadGallery();
  state.rackDone = `${add.length} color ideas added to "${g.title}". Customers see them on its page now.`;
  render();
}


// ── Send an automated email now (order screen > "Send an email now") ──
// Saving the order with manualEmail { key, at } makes the email script send that email (Code.gs emailsFor), through the
// same pipeline as the automatic ones. A manual review request or quote reminder also stamps the daily job's own marker
// (reviewRequestedAt / reminderSentAt) so the daily job doesn't send it a second time.
const MANUAL_EMAILS = [
  { key: 'review_request', label: 'Ask for a review', normally: 'Normally sent by itself about a week after an order ships.',
    ok: b => b.phase === 'delivered', need: 'Available once the order is Shipped.' },
  { key: 'reminder', label: 'Send a quote reminder', normally: 'Normally sent by itself 3 days after a quote with no answer.',
    ok: b => b.phase === 'quote_sent' && !b.customerApprovedAt, need: 'Available while a quote is waiting for their answer.' },
  { key: 'quote', label: 'Send the quote again', normally: 'Sent when you send the quote.',
    ok: b => b.phase === 'quote_sent', need: 'Available while the quote is sent.' },
  { key: 'confirmed', label: 'Send the deposit request again', normally: 'Sent when you confirm the order.',
    ok: b => b.phase === 'order_received', need: 'Available while the order is confirmed and printing.' },
  { key: 'final_payment_needed', label: 'Send the final payment request again', normally: 'Sent when printing is done.',
    ok: b => b.phase === 'final_payment_needed', need: 'Available at Printing Complete.' },
  { key: 'delivered', label: 'Send the shipped email again', normally: 'Sent when you mark the order Shipped.',
    ok: b => b.phase === 'delivered', need: 'Available once the order is Shipped.' },
  { key: 'delivery_update', label: 'Send the shipping details', normally: 'Sent when you change shipping details on a shipped order.',
    ok: b => b.phase === 'delivered' && !!String(b.deliveryTracking || '').trim(), need: 'Available once a shipped order has tracking.' }
];
function hasEmailAddress(b) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.clientEmail || '')); }
function manualEmailLast(b, key) {
  const hit = (b.manualEmails || []).filter(m => m.key === key).pop();
  return hit ? hit.at : '';
}
function renderSendEmailFold(b) {
  const note = (state.emailSentNote || {})[b.id];
  const items = MANUAL_EMAILS.map(m => {
    const ok = hasEmailAddress(b) && m.ok(b);
    const last = manualEmailLast(b, m.key);
    return `<li class="send-email-row ${ok ? '' : 'off'}">
      <div><strong>${esc(m.label)}</strong><div class="field-help">${esc(ok ? m.normally : (hasEmailAddress(b) ? m.need : 'This order has no email address.'))}${last ? ` Last sent by you ${esc(formatAustinTime(last))}.` : ''}</div></div>
      <button type="button" class="btn-sm" id="send-email-${esc(m.key)}-${esc(b.id)}" ${ok ? '' : 'disabled'} onclick="askSendEmail('${esc(b.id)}', '${m.key}')">Preview and send</button>
    </li>`;
  }).join('');
  return `<details class="desk-fold" id="send-email-fold-${esc(b.id)}" ${note ? 'open' : ''}><summary>Send an email now</summary>
    ${note ? `<div class="alert success" style="display:block;" role="status">${esc(note)}</div>` : ''}
    <div class="field-help">The automatic emails, sent when you choose. You see the exact email first and confirm. It goes out within a minute or two.</div>
    <ul class="send-email-list">${items}</ul></details>`;
}
function manualEmailPreview(b, key) { return stepEmailPreview(b, key); }
// The email a customer would get, filled in the way Code.gs `emailVars` fills it. `o` is the order as it will be
// saved (a copy with the step applied), `extra` adds values like amountPaid.
function stepEmailPreview(o, key, extra) {
  const custom = state.settings.emails || {}, tpl = emailTemplate(key, custom), rules = rulesFor(o);
  const vars = Object.assign(practiceVars(o), extra || {});
  vars.name = String(o.clientName || '').trim() || 'there';
  vars.orderLink = orderLinkFor(o);
  vars.reviewLink = vars.orderLink + '&review=1';
  const roll = rollCharge(o, rules);
  vars.specialRoll = roll ? roll.toFixed(2) : '';
  vars.extraCharges = extraCharges(o).map(c => `${c.label}: $${c.amount.toFixed(2)}`).join('\n');
  vars.designTermsNote = o.designTerms ? 'This order includes a custom design. When you approve your quote, you will be asked to read and agree to my custom design terms.' : '';
  vars.photo = (Array.isArray(o.finishedPhotos) ? o.finishedPhotos : []).filter(u => /^https:\/\//.test(String(u)))[0] || '';
  vars.delivery = ['', o.deliveryDate && `Ship date: ${o.deliveryDate}`, o.deliveryTracking && `Tracking number: ${o.deliveryTracking}`, o.deliveryNotes && `Notes: ${o.deliveryNotes}`].filter(x => x !== '' && x).join('\n');
  vars.queueNote = preorderQueueNote(o, state.settings) || featureOn('queue') ? preorderQueueNote(o, state.settings) || queueNoteText(o, queueFromOrders(state.batches.map(x => (x.id === o.id ? o : x))), rules) : '';
  vars.detailsItems = [vars.itemsWithPrices, vars.specialRoll ? 'Special order roll: $' + vars.specialRoll : '', vars.extraCharges, vars.total ? 'Total: $' + vars.total : ''].filter(Boolean).join('\n\n');
  vars.invoiceSummary = invoiceSummary(vars, o, o.items.every(itemPriced) ? orderSum(o) : 0, rules);
  vars.footer = renderEmailText(emailTemplate('footer', custom).body, vars);
  return { subject: renderEmailText(tpl.subject, vars).replace(/\s*\n\s*/g, ' '), body: renderEmailText(tpl.body, vars) };
}
// Before a step that emails the customer: the exact email in boxes the owner can change, then
// "Send email and continue", "Don't send email, continue" or "Cancel, go back".
// Resolves { choice: 'send' | 'skip' | 'cancel', edited: { subject, body } | null } (edited only when they changed it).
function emailPopup(b, preview, ask) {
  return new Promise(resolve => {
    const opener = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'mail-modal-backdrop';
    wrap.innerHTML = `<div class="mail-modal wide" role="dialog" aria-modal="true" aria-labelledby="mail-modal-title">
      <h3 id="mail-modal-title">Send this email?</h3>
      <p class="mail-ask"></p>
      <p class="send-to"></p>
      <div class="field"><label for="mp-subject">Subject</label><input type="text" id="mp-subject" class="mp-subject" maxlength="200" /></div>
      <div class="field"><label for="mp-body">Email</label><textarea id="mp-body" class="mp-body" rows="12" maxlength="10000" spellcheck="true"></textarea></div>
      <div class="field-help">Change anything you like: this email is sent exactly as shown. To change it for every order, edit it in Settings > Emails.</div>
      <button type="button" class="btn-link" id="mp-reset">Undo my changes</button>
      <div class="mail-modal-buttons">
        <button type="button" class="btn-primary" data-send="1">Send email and continue</button>
        <button type="button" class="btn-secondary" data-send="0">Don't send email, continue</button>
        <button type="button" class="btn-link" data-send="x">Cancel, go back</button>
      </div></div>`;
    wrap.querySelector('.mail-ask').textContent = ask || 'Email the customer about this step?';
    wrap.querySelector('.send-to').textContent = `To: ${b.clientName ? b.clientName + ' ' : ''}<${b.clientEmail}>`;
    const subj = wrap.querySelector('#mp-subject'), body = wrap.querySelector('#mp-body');
    subj.value = preview.subject;
    body.value = preview.body;
    wrap.querySelector('#mp-reset').addEventListener('click', () => { subj.value = preview.subject; body.value = preview.body; body.focus(); });
    const done = choice => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      if (choice === 'cancel' && opener && opener.focus) opener.focus();
      const changed = subj.value !== preview.subject || body.value !== preview.body;
      resolve({ choice, edited: choice === 'send' && changed && body.value.trim() ? { subject: subj.value.replace(/\s+/g, ' ').trim().slice(0, 200), body: body.value.slice(0, 10000) } : null });
    };
    const onKey = e => { if (e.key === 'Escape') done('cancel'); };
    wrap.addEventListener('click', e => {
      const v = e.target.closest && e.target.closest('button[data-send]');
      if (!v && e.target !== wrap) return;
      done(!v ? 'cancel' : v.dataset.send === '1' ? 'send' : v.dataset.send === '0' ? 'skip' : 'cancel');
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    wrap.querySelector('button[data-send="1"]').focus();
  });
}
function askSendEmail(id, key) {
  const b = state.batches.find(x => x.id === id), m = MANUAL_EMAILS.find(x => x.key === key);
  if (!b || !m || !m.ok(b) || !hasEmailAddress(b)) return;
  const p = manualEmailPreview(b, key);
  const opener = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'mail-modal-backdrop';
  wrap.innerHTML = `<div class="mail-modal wide" role="dialog" aria-modal="true" aria-labelledby="send-modal-title">
    <h3 id="send-modal-title">Send this email?</h3>
    <p class="send-to"></p>
    <div class="field"><label for="mp-subject">Subject</label><input type="text" id="mp-subject" class="mp-subject" maxlength="200" /></div>
    <div class="field"><label for="mp-body">Email</label><textarea id="mp-body" class="mp-body" rows="12" maxlength="10000" spellcheck="true"></textarea></div>
    <div class="field-help">Change anything you like: this one email is sent exactly as shown. To change it for every order, edit it in Settings > Emails. If you leave it as is, lines that depend on the moment (like their place in line) are filled in when it sends.</div>
    <button type="button" class="btn-link" id="mp-reset">Undo my changes</button>
    <div class="mail-modal-buttons"><button type="button" class="btn-primary" data-go="1">Send email</button><button type="button" class="btn-secondary" data-go="0">Cancel</button></div></div>`;
  wrap.querySelector('.send-to').textContent = `To: ${b.clientName ? b.clientName + ' ' : ''}<${b.clientEmail}>`;
  const subj = wrap.querySelector('#mp-subject'), body = wrap.querySelector('#mp-body');
  subj.value = p.subject;
  body.value = p.body;
  wrap.querySelector('#mp-reset').addEventListener('click', () => { subj.value = p.subject; body.value = p.body; body.focus(); });
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); if (opener && opener.focus) opener.focus(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  wrap.addEventListener('click', e => {
    const v = e.target.closest && e.target.closest('button[data-go]');
    if (!v && e.target !== wrap) return;
    const go = v && v.dataset.go === '1';
    const edited = subj.value !== p.subject || body.value !== p.body ? { subject: subj.value.trim(), body: body.value } : null;
    if (go && edited && (!edited.subject || !edited.body.trim())) { alert('The subject and the email both need some text.'); return; }
    close();
    if (go) sendManualEmail(id, key, edited);
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  wrap.querySelector('button').focus();
}
async function sendManualEmail(id, key, edited) {
  const b = state.batches.find(x => x.id === id), m = MANUAL_EMAILS.find(x => x.key === key);
  if (!b || !m || !m.ok(b) || !hasEmailAddress(b)) return;
  const now = new Date().toISOString();
  // Edited in the pop-up: the email script sends exactly this subject and text. Otherwise it fills in the template itself.
  b.manualEmail = edited ? { key, at: now, subject: edited.subject.slice(0, 200), body: edited.body.slice(0, 10000) } : { key, at: now };
  b.manualEmails = [...(b.manualEmails || []), { key, at: now }].slice(-30);
  if (key === 'review_request') b.reviewRequestedAt = now;
  if (key === 'reminder') b.reminderSentAt = now;
  state.emailSentNote = { ...(state.emailSentNote || {}), [id]: `"${m.label}" is on its way to ${b.clientEmail}. It goes out within a minute or two.` };
  try { await upsertBatch(b); }
  catch (e) { delete state.emailSentNote[id]; alert("Couldn't save, so nothing was sent. If you were logged out, log in again and retry."); }
  render();
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
      <div id="cm-bg-warn" role="status"></div>
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
        ${m.combos.length < 16 ? '<button type="button" class="btn-sm" id="cm-add-combo" onclick="addCmCombo()">+ Add a color idea</button>' : ''}
        <details class="cm-paste"><summary>Paste several color ideas at once</summary>
          <div class="field-help">One idea per line: its name, then a color for each part in this order: <strong>${esc(parts.map(p => p.name).join(', '))}</strong>. Use your color names, separated by commas. Example: <em>Santa Dragon, Red, Green</em></div>
          <textarea id="cm-paste" rows="6" spellcheck="false" placeholder="Santa Dragon, Red, Green"></textarea>
          <div class="alert error" id="cm-paste-err"></div>
          <button type="button" class="btn-sm" id="cm-paste-go" onclick="importCmCombos()">Add these ideas</button>
        </details>` : ''}
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
// Several color ideas from pasted text: "Name, color, color" per line (a color for each part, in the part order shown).
// Nothing is added unless every line is understood.
function importCmCombos() {
  const m = state.galleryForm && state.galleryForm.colorMap;
  if (!m) return;
  const parts = cleanDesignParts(state.galleryForm.parts);
  const choices = ownerPartChoices();
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const lines = String(document.getElementById('cm-paste')?.value || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const fail = msg => showAlert('cm-paste-err', msg, 'error');
  if (!lines.length) { fail('Type or paste at least one line first.'); return; }
  if (m.combos.length + lines.length > 16) { fail(`A design can hold 16 color ideas and this one has ${m.combos.length}. Remove some, or paste fewer.`); return; }
  const added = [];
  for (let i = 0; i < lines.length; i++) {
    const bits = lines[i].split(/\s*[,|\t]\s*/).map(x => x.trim());
    const name = bits[0].slice(0, 40);
    const want = bits.slice(1);
    if (!name || want.length !== parts.length) { fail(`Line ${i + 1} ("${lines[i].slice(0, 40)}"): give a name and ${parts.length} color${parts.length === 1 ? '' : 's'} (${parts.map(p => p.name).join(', ')}). Nothing was added.`); return; }
    const colors = {};
    for (let k = 0; k < parts.length; k++) {
      const hit = choices.find(c => norm(c.name) === norm(want[k])) || choices.find(c => norm(c.name).startsWith(norm(want[k])) && norm(want[k]).length >= 3);
      if (!hit) { fail(`Line ${i + 1}: "${want[k]}" isn't one of your colors. Nothing was added.`); return; }
      colors[parts[k].id] = hit.key;
    }
    added.push({ id: 'c' + (Date.now() + i).toString(36), name, colors });
  }
  m.combos.push(...added);
  render();
  document.getElementById('cm-add-combo')?.scrollIntoView({ block: 'center' });
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

// ── CONFIRM DETAILS (a step before the quote) ─────────────────────────────
// You write your questions, see the whole email (their request filled in), edit any of it, then send it or
// cancel. The email script sends exactly the subject and text you approved (detailsEmail on the order).
function detailsItemsText(b) {
  return (b.items || []).map((it, i) => {
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const lines = [`${i + 1}) ${it.name || 'Unnamed'}${qty > 1 ? ` x ${qty}` : ''}`, `   ${filamentLabel(it)}`];
    if (colorPartsText(it)) lines.push(`   Which parts: ${colorPartsText(it)}`);
    if (it.preorder === true) lines.push('   Pre-order: made first come, first served');
    if (it.logo) lines.push('   Add your company logo: yes');
    if (colorCharge(it, rulesFor(b))) lines.push(`   More than ${rulesFor(b).freeColors} colors: +$${colorCharge(it, rulesFor(b)).toFixed(2)} per print (extra color changes)`);
    if (it.link) lines.push(`   Link: ${it.link}`);
    if (it.notes) lines.push(`   Notes: ${it.notes}`);
    return lines.join('\n');
  }).join('\n\n');
}
// {detailsItems}: every item in full with its price (or estimate, before you've set time and grams), then any
// special order roll and charges, and the total.
function detailsBreakdown(b) {
  const rules = rulesFor(b);
  let sum = 0, allKnown = true, estimated = false;
  const items = (b.items || []).map((it, i) => {
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const exact = itemPriced(it);
    const price = calcTotal(exact ? it.minutes : it.minutes || it.knownMinutes, it.grams, it, qty, rules);
    if (price === null) allKnown = false; else sum += price;
    if (!exact) estimated = true;
    const each = price !== null && qty > 1 ? ` ($${(price / qty).toFixed(2)} each)` : '';
    const line = price === null ? '   Price: I\'ll work this out for your quote' : `   ${exact ? 'Price' : 'Estimated price'}: $${price.toFixed(2)}${each}`;
    return detailsItemsText({ items: [it] }).replace(/^1\)/, `${i + 1})`) + '\n' + line;
  });
  const lines = [items.join('\n\n')];
  const roll = specialOrderCost(b);
  if (roll > 0) { lines.push(`Special order roll: $${roll.toFixed(2)}`); sum += roll; }
  extraCharges(b).forEach(c => { lines.push(`${c.label}: $${c.amount.toFixed(2)}`); sum += c.amount; });
  if (allKnown && sum > 0) lines.push(`${estimated ? 'Estimated total' : 'Total'}: $${sum.toFixed(2)}`);
  return lines.join('\n\n');
}
function detailsEmailFor(b, questions) {
  const custom = state.settings.emails || {};
  const orderLink = orderLinkFor(b);
  const vars = { name: String(b.clientName || '').trim() || 'there', title: orderTitle(b), detailsQuestions: questions,
    items: detailsItemsText(b), detailsItems: detailsBreakdown(b), orderLink, siteLink: location.origin };
  vars.footer = renderEmailText(emailTemplate('footer', custom).body, vars);
  const tpl = emailTemplate('details_check', custom);
  return { subject: renderEmailText(tpl.subject, vars).replace(/\s*\n\s*/g, ' '), body: renderEmailText(tpl.body, vars) };
}
function openDetailsCheck(id) {
  const b = state.batches.find(x => x.id === id);
  if (!b) return;
  state.detailsDraft = { id, questions: '', edited: false, ...detailsEmailFor(b, '') };
  render();
  document.getElementById(`details-q-${id}`)?.focus();
}
function updateDetailsQuestions(id, text) {
  const d = state.detailsDraft, b = state.batches.find(x => x.id === id);
  if (!d || d.id !== id || !b) return;
  d.questions = text;
  if (d.edited) return;   // once you've changed the email itself, your questions no longer rewrite it
  Object.assign(d, detailsEmailFor(b, text));
  const subject = document.getElementById(`details-subject-${id}`), body = document.getElementById(`details-body-${id}`);
  if (subject) subject.value = d.subject;
  if (body) body.value = d.body;
}
function editDetailsEmail(id, field, value) {
  const d = state.detailsDraft;
  if (!d || d.id !== id) return;
  d[field] = value;
  d.edited = true;
}
async function sendDetailsCheck(id) {
  const d = state.detailsDraft, b = state.batches.find(x => x.id === id);
  if (!d || d.id !== id || !b) return;
  if (!String(d.body || '').trim() || !String(d.subject || '').trim()) { showAlert(`details-err-${id}`, 'The email needs a subject and some text.', 'error'); return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.clientEmail || ''))) { showAlert(`details-err-${id}`, "This request has no valid email address, so there's no one to send it to.", 'error'); return; }
  const btn = document.getElementById(`details-send-${id}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
  b.detailsQuestions = String(d.questions || '').trim();
  b.detailsEmail = { subject: d.subject.trim(), body: d.body, at: new Date().toISOString() };
  b.phase = 'details_check';
  stampPhase(b, 'details_check');
  try {
    await upsertBatch(b);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Send email'; }
    showAlert(`details-err-${id}`, "Couldn't send. If you were logged out, log in again and retry.", 'error');
    return;
  }
  state.detailsDraft = null;
  render();
  showAlert(`batch-ok-${id}`, `Sent to ${b.clientEmail}. The order is now "Confirming Details". Send the quote when you have their answers.`, 'success');
}
function renderDetailsCheck(b) {
  const d = state.detailsDraft && state.detailsDraft.id === b.id ? state.detailsDraft : null;
  if (!d) {
    const sent = b.phase === 'details_check' && b.detailsEmail;
    return `<div class="details-check">
      ${sent ? `<div class="field-help"><strong>Details check sent ${esc(formatAustinTime(b.detailsEmail.at || b.phaseHistory.details_check))}.</strong> Waiting for their answers; send the quote below when you're ready.</div>
        <details><summary>See the email you sent</summary><div class="email-preview" style="white-space:pre-wrap;"><strong>${esc(b.detailsEmail.subject)}</strong>\n\n${esc(b.detailsEmail.body)}</div></details>` : ''}
      <button class="btn-sm" type="button" id="details-open-${b.id}" onclick="openDetailsCheck('${b.id}')">${sent ? 'Ask more questions' : 'Confirm details with the customer'}</button>
      ${sent ? '' : '<span class="field-help"> Optional: email them a summary of their request and your questions before you quote.</span>'}
    </div>`;
  }
  return `<fieldset class="details-check owner-edit-item">
    <legend>Confirm details with ${esc(b.clientName || 'the customer')}</legend>
    <div class="field"><label for="details-q-${b.id}">Your questions</label>
      <textarea id="details-q-${b.id}" rows="4" spellcheck="true" placeholder="e.g. How tall should it be? Is matte black OK?" oninput="updateDetailsQuestions('${b.id}', this.value)">${esc(d.questions)}</textarea></div>
    <div class="field-help" style="margin-bottom:6px;">This is exactly what ${esc(b.clientEmail || 'they')} will get. You can change any of it.</div>
    <div class="field"><label for="details-subject-${b.id}">Subject</label>
      <input type="text" id="details-subject-${b.id}" maxlength="200" value="${esc(d.subject)}" oninput="editDetailsEmail('${b.id}', 'subject', this.value)" /></div>
    <div class="field"><label for="details-body-${b.id}">Email</label>
      <textarea id="details-body-${b.id}" rows="14" spellcheck="true" oninput="editDetailsEmail('${b.id}', 'body', this.value)">${esc(d.body)}</textarea></div>
    <div class="alert error" id="details-err-${b.id}"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn-sm" type="button" id="details-send-${b.id}" onclick="sendDetailsCheck('${b.id}')">Send email</button>
      <button class="btn-sm danger" type="button" onclick="state.detailsDraft = null; render();">Cancel (don't send)</button>
    </div>
  </fieldset>`;
}

// ── MESSAGES ON ORDERS (supabase/messages.sql) ────────────────────────────
// One conversation per order: your messages and the customer's (written on the site or by email), plus the
// shop's own emails. The email script sends site messages, logs its emails here and collects Gmail replies every 5 minutes.
function cleanMessage(m, jobId) {
  if (!m || typeof m !== 'object') return null;
  const body = cleanText(m.body, 10000);
  if (!body) return null;
  return { id: String(m.id || ''), jobId: String(m.job_id || jobId || ''), sender: m.sender === 'owner' ? 'owner' : 'customer',
    via: ['site', 'email', 'auto'].includes(m.via) ? m.via : 'site', subject: cleanText(m.subject, 300), body, at: cleanIso(m.created_at || m.at) };
}
async function loadOwnerMessages() {
  try {
    const rows = await supaFetch('/order_messages?select=id,job_id,sender,via,subject,body,created_at&order=created_at.asc,id.asc&limit=5000');
    state.messages = (rows || []).map(m => cleanMessage(m)).filter(Boolean);
    state.messagesReady = true;
  } catch (e) {
    state.messages = [];
    state.messagesReady = false;   // supabase/messages.sql not run yet
  }
}
async function loadCustomerMessages() {
  const lists = await Promise.all(state.batches.map(b => supaFetch('/rpc/customer_messages', { method: 'POST', body: JSON.stringify({ p_token: b.accessToken }) })
    .then(rows => (rows || []).map(m => cleanMessage(m, b.id)).filter(Boolean)).catch(() => null)));
  state.messages = lists.flatMap(l => l || []);
  state.messagesReady = lists.some(l => l !== null);
}
function messagesFor(jobId) { return (state.messages || []).filter(m => m.jobId === jobId); }
// Who the conversation is waiting on: the customer wrote last -> you; you (or the shop's email) -> them.
function conversationStatus(jobId) {
  const list = messagesFor(jobId);
  if (!list.length) return '';
  return list[list.length - 1].sender === 'customer' ? 'you' : 'customer';
}
function waitingOnYou() { return state.batches.filter(b => conversationStatus(b.id) === 'you'); }
function conversationChip(jobId) {
  const s = conversationStatus(jobId);
  return s === 'you' ? '<span class="status waiting-you">Waiting on you</span>' : s === 'customer' ? '<span class="status waiting-them">Waiting on customer</span>' : '';
}
// Message text with web links made tappable (the text is escaped first, so only real links become links).
function linkifyText(text) {
  return esc(text).replace(/\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g, url => `<a class="auto-link" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}
// Message boxes grow to show everything typed in them.
function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + 2}px`;
}
// Every web address shown as text anywhere on the site becomes a link that opens in a new tab
// (run after each redraw; text inside links, buttons and form boxes is left alone).
function linkifyPage(root) {
  if (!root || !document.createTreeWalker) return;
  const skip = 'a,button,textarea,input,select,option,script,style,summary,label,code';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => /https?:\/\//.test(n.nodeValue) && !n.parentElement.closest(skip) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(n => {
    const html = linkifyText(n.nodeValue);
    if (!html.includes('<a ')) return;
    const span = document.createElement('span');
    span.innerHTML = html;
    n.replaceWith(...span.childNodes);
  });
}
// Whatever gets drawn, whenever (whole-page redraws, pop-ups, live previews), its links are made tappable.
if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    linkifyPage(document.body);
    new MutationObserver(changes => changes.forEach(c => c.addedNodes.forEach(n => {
      if (n.nodeType === 1) linkifyPage(n);
      else if (n.nodeType === 3 && n.parentElement) linkifyPage(n.parentElement);
    }))).observe(document.body, { childList: true, subtree: true });
  });
}
function growMessageBoxes() { document.querySelectorAll('textarea.autogrow').forEach(autoGrow); }
// Your first message on an order starts from your "first message" wording (Settings > Wording).
function firstReplyText(b) {
  const first = String(b.clientName || '').trim().split(/\s+/)[0] || 'there';
  return t('firstReply').replace(/\{name\}/g, first).replace(/\{item\}/g, orderTitle(b));
}
function ownerMessageDraft(b) {
  state.msgDrafts = state.msgDrafts || {};
  if (state.msgDrafts[b.id] === undefined && !messagesFor(b.id).some(m => m.sender === 'owner' && m.via !== 'auto')) {
    state.msgDrafts[b.id] = firstReplyText(b);
  }
  return state.msgDrafts[b.id] || '';
}

// Text-message style: the viewer's side (and the shop's emails, when the owner is looking) on the right,
// the other person on the left. Emails show as a bubble with the subject; tap to read the whole email.
// Notes only the owner gets (demo emails to the owner) sit in the middle, owner view only.
function renderThread(list, viewer, customerName) {
  const shown = list.filter(m => viewer === 'owner' || !m.toOwner);
  if (!shown.length) return '<div class="field-help">No messages yet.</div>';
  return `<ol class="thread">${shown.map(m => {
    const when = m.at ? formatAustinTime(m.at) : '';
    if (m.event) return `<li class="msg msg-event">${esc(m.body)} <span class="msg-when">${esc(when)}</span></li>`;
    if (m.toOwner) {
      return `<li class="msg msg-note"><details><summary>Email to you: ${esc(m.subject)} <span class="msg-when">${esc(when)}</span></summary><div class="msg-body">${linkifyText(m.body)}</div></details></li>`;
    }
    const mine = m.sender === viewer;
    const side = mine ? 'msg-mine' : 'msg-theirs';
    const who = mine ? 'You' : m.sender === 'owner' ? 'SoloPrint' : (customerName || 'Customer');
    // The shop's emails (and the Confirm details email you wrote) fold down to their subject; replies show in full.
    if (m.via === 'auto' || (m.via === 'email' && m.sender === 'owner' && m.subject && !/^\s*re:/i.test(m.subject))) {
      return `<li class="msg ${side} msg-email"><div class="msg-who">${esc(who)} <span class="msg-when">${esc(when)} · email</span></div>
        <details><summary>${esc(m.subject || 'SoloPrint email')}</summary><div class="msg-body">${linkifyText(m.body)}</div></details></li>`;
    }
    return `<li class="msg ${side}"><div class="msg-who">${esc(who)} <span class="msg-when">${esc(when)}${m.via === 'email' ? ' · by email' : ''}</span></div><div class="msg-body">${linkifyText(m.body)}</div></li>`;
  }).join('')}</ol>`;
}
// Steps the order went through, as quiet lines in the owner's feed (between the messages, by time).
function orderEvents(b) {
  const h = b.phaseHistory || {}, out = [];
  const add = (at, body) => { if (at) out.push({ event: true, at, body }); };
  const amt = v => Number(v) > 0 ? ` $${Number(v).toFixed(2)}` : '';
  add(b.createdAt, 'Request received');
  add(h.details_check, 'Asked them to check the details');
  add(h.quote_sent, 'Quote sent');
  add(b.customerApprovedAt, 'They approved the quote');
  add(h.order_received, 'Order confirmed');
  add(b.depositAt, 'Deposit received' + amt(b.depositAmount));
  add(h.final_payment_needed, 'Printing done');
  add(b.balancePaidAt || b.paidAt, 'Paid in full' + amt(b.balancePaid));
  add(h.delivered, String(b.deliveryTracking || '') === 'Handed over in person' ? 'Handed over' : 'Shipped');
  return out;
}
// The order's one feed: messages, the shop's emails and the steps, oldest first, with the reply box under it.
function renderOwnerConversation(b) {
  if (!state.messagesReady) return '';
  const list = messagesFor(b.id);
  const draft = ownerMessageDraft(b);
  const feed = list.concat(orderEvents(b)).sort((x, y) => String(x.at || '').localeCompare(String(y.at || '')));
  const count = list.filter(m => m.via !== 'auto').length;
  return `<details class="conversation" id="conv-${b.id}" open>
    <summary><strong>Messages and updates</strong> ${count ? `(${count})` : ''} ${conversationChip(b.id)}</summary>
    ${renderThread(feed, 'owner', b.clientName)}
    <div class="field" style="margin-top:10px;"><label for="msg-text-${b.id}">Message to ${esc(b.clientName || 'the customer')}</label>
      <textarea id="msg-text-${b.id}" class="autogrow" rows="3" spellcheck="true" maxlength="5000" placeholder="They get this by email and on their order page." oninput="state.msgDrafts['${b.id}'] = this.value; autoGrow(this)">${esc(draft)}</textarea>
      <div class="field-help">Sends only your words, by email and on their order page. It never changes the order.</div></div>
    <div class="alert error" id="msg-err-${b.id}"></div>
    <button class="btn-sm" type="button" id="msg-send-${b.id}" onclick="sendOwnerMessage('${b.id}')">Send message</button>
  </details>`;
}
async function sendOwnerMessage(jobId) {
  const text = String((state.msgDrafts || {})[jobId] || '').trim();
  if (!text) { showAlert(`msg-err-${jobId}`, 'Write a message first.', 'error'); return; }
  const btn = document.getElementById(`msg-send-${jobId}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
  try {
    const rows = await supaFetch('/order_messages', { method: 'POST', body: JSON.stringify({ job_id: jobId, sender: 'owner', via: 'site', body: text }) });
    const saved = cleanMessage((rows || [])[0] || { job_id: jobId, sender: 'owner', via: 'site', body: text, created_at: new Date().toISOString() });
    if (saved) state.messages.push(saved);
    state.msgDrafts[jobId] = '';
    state.openConversation = jobId;
    render();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Send message'; }
    showAlert(`msg-err-${jobId}`, "Couldn't send. If you were logged out, log in again; if this is the first time, run supabase/messages.sql.", 'error');
  }
}
// Customers: the conversation on their order page.
function renderCustomerConversation(b) {
  if (!state.messagesReady) return '';
  state.msgDrafts = state.msgDrafts || {};
  return `<div class="conversation customer-conversation" id="conv-${b.id}">
    <div class="card-title" style="margin-bottom:6px;">Messages</div>
    ${renderThread(messagesFor(b.id), 'customer')}
    <div class="field" style="margin-top:10px;"><label for="cmsg-text-${b.id}">Send a message about this order</label>
      <textarea id="cmsg-text-${b.id}" class="autogrow" rows="3" spellcheck="true" maxlength="5000" placeholder="Questions, changes, answers..." oninput="state.msgDrafts['${b.id}'] = this.value; autoGrow(this)">${esc(state.msgDrafts[b.id] || '')}</textarea></div>
    <div class="alert error" id="cmsg-err-${b.id}"></div>
    <button class="btn-sm" type="button" id="cmsg-send-${b.id}" onclick="sendCustomerMessage('${b.id}')">Send</button>
    <div class="field-help" style="margin-top:6px;">You can also just reply to any of my emails.</div>
  </div>`;
}
async function sendCustomerMessage(jobId) {
  const text = String((state.msgDrafts || {})[jobId] || '').trim();
  const token = (state.batches.find(b => b.id === jobId) || {}).accessToken || '';
  if (!text) { showAlert(`cmsg-err-${jobId}`, 'Write a message first.', 'error'); return; }
  const btn = document.getElementById(`cmsg-send-${jobId}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
  try {
    await supaFetch('/rpc/customer_send_message', { method: 'POST', body: JSON.stringify({ p_token: token, p_body: text }) });
    const rows = await supaFetch('/rpc/customer_messages', { method: 'POST', body: JSON.stringify({ p_token: token }) });
    state.messages = (state.messages || []).filter(m => m.jobId !== jobId).concat((rows || []).map(m => cleanMessage(m, jobId)).filter(Boolean));
    state.msgDrafts[jobId] = '';
    render();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
    showAlert(`cmsg-err-${jobId}`, "Couldn't send your message. Please try again, or reply to one of my emails.", 'error');
  }
}
function openConversation(id) {
  state.openConversation = id;
  focusOwnerOrder(id);
  document.getElementById(`msg-text-${id}`)?.focus({ preventScroll: true });
}

// ── PRACTICE ORDER (owner tab "Practice") ─────────────────────────────────
// A pretend customer and order for trying the whole flow from both sides on one page. It lives only in
// this page's memory (state.practice): nothing is saved to the database and no email is sent. The emails a
// real order would send are written from your real email wording and put in the chat instead.
// Which email goes out when mirrors emailsFor in email/Code.gs; keep the two in step.
const PRACTICE_PHASE_EMAILS = { quote_sent: 'quote', order_received: 'confirmed', final_payment_needed: 'final_payment_needed', delivered: 'delivered' };
function practiceDesigns() { return state.gallery.filter(g => g.published && g.title); }
function startPractice(galleryId) {
  const g = state.gallery.find(x => x.id === galleryId);
  let item;
  if (g) {
    item = { ...blankItem(), ...galleryItemFields(g), mode: 'gallery' };
    if (item.designParts.length) applyPartColors(item); else ensureItemColor(item);
  } else {
    item = { ...blankItem(), name: 'Phone stand', qty: 2, filType: 'black', grams: 30, knownMinutes: 90, mode: 'link', notes: 'Can it fit a tablet too?' };
  }
  const now = new Date().toISOString();
  const order = normalizeBatch({ id: 'practice', clientName: 'Pat Practice', clientEmail: 'pat.practice@example.com', createdAt: now,
    phase: 'estimate', paymentStatus: 'unpaid', items: [item], phaseHistory: { estimate: now } });
  state.practice = { order, messages: [], questions: '', mins: String(item.knownMinutes || ''), grams: String(item.grams || ''), tracking: '', remindedAt: '', reviewAskedAt: '' };
  practiceEmail('owner_new', true);
  practiceEmail('customer_received');
  render();
}
function practiceSay(sender, via, body, subject = '', toOwner = false) {
  const p = state.practice;
  p.messages.push({ id: 'p' + (p.messages.length + 1), jobId: 'practice', sender, via, subject, body, toOwner, at: new Date().toISOString() });
}
function practiceVars(order) {
  const o = order || state.practice.order, rules = rulesFor(o), custom = state.settings.emails || {};
  const priced = o.items.length && o.items.every(itemPriced);
  const total = priced ? orderSum(o) : null;
  const est = o.items.reduce((s, it) => s + (calcTotal(it.minutes || it.knownMinutes, it.grams, it, it.qty, rules) || 0), 0);
  const left = total ? amountLeft(o, total, rules) : 0;
  const fp = finalPayment(o, total || 0, rules);
  const withPrices = o.items.map((it, i) => {
    const each = itemPriced(it) ? printPrice(it.minutes, it.grams, it, rules) : null;
    return detailsItemsText({ items: [it] }).replace(/^1\)/, `${i + 1})`) + (each !== null ? `\n   Price: $${(each * it.qty).toFixed(2)}${it.qty > 1 ? ` ($${each.toFixed(2)} each)` : ''}` : '');
  }).join('\n\n');
  const vars = { name: o.clientName, customerName: o.clientName, customerEmail: o.clientEmail, title: orderTitle(o), submitted: formatAustinTime(o.createdAt),
    items: detailsItemsText(o), itemsWithPrices: withPrices, estimate: est ? est.toFixed(2) : '', total: total ? total.toFixed(2) : '',
    specialRoll: '', extraCharges: '', amountDue: left > 0 ? left.toFixed(2) : '', venmoLink: left > 0 ? venmoPayUrl(o, left, o.paymentStatus === 'deposit_received' ? 'balance' : 'full') : '',
    depositDue: left > 0 && o.paymentStatus !== 'deposit_received' && depositAmount(o, total || 0, rules) > 0 && depositAmount(o, total || 0, rules) < total ? depositAmount(o, total, rules).toFixed(2) : '',
    depositPercent: String(Math.round(Number(rules.depositPercent) || 0)),
    depositLink: left > 0 && o.paymentStatus !== 'deposit_received' && depositAmount(o, total || 0, rules) > 0 && depositAmount(o, total || 0, rules) < total ? venmoPayUrl(o, depositAmount(o, total, rules), 'deposit') : '',
    postage: postageRefund(o, rules) ? postageRefund(o, rules).postage.toFixed(2) : '',
    refund: postageRefund(o, rules) ? postageRefund(o, rules).refund.toFixed(2) : '',
    refundNote: postageRefund(o, rules) ? (postageRefund(o, rules).refund > 0 ? `I'll send your $${postageRefund(o, rules).refund.toFixed(2)} shipping deposit refund by Venmo.` : 'Postage used up the whole shipping deposit, so there is no refund this time.') : '',
    deposit: fp.deposit.toFixed(2), remainder: fp.remainder.toFixed(2), shippingFee: fp.fee.toFixed(2), shippingDeposit: fp.fee.toFixed(2), remainderLink: total ? venmoPayUrl(o, fp.remainder, 'balance') : '',
    materialNote: materialNote(), queueNote: '', designTermsNote: '', orderLink: '(link to their order page)', siteLink: location.origin,
    delivery: [o.deliveryDate && `Ship date: ${o.deliveryDate}`, o.deliveryTracking && `Tracking number: ${o.deliveryTracking}`].filter(Boolean).join('\n'),
    photo: '', vacationNote: vacationText(state.settings.vacation), reviewLink: '(link to the review form)', detailsQuestions: o.detailsQuestions || '', detailsItems: detailsBreakdown(o) };
  vars.invoiceSummary = invoiceSummary(vars, o, total || 0, rules);
  vars.footer = renderEmailText(emailTemplate('footer', custom).body, vars);
  return vars;
}
function practiceEmail(key, toOwner = false) {
  const tpl = emailTemplate(key, state.settings.emails || {}), vars = practiceVars(), o = state.practice.order;
  vars.ownerLink = '(link that opens this order in owner mode)';
  vars.approvalNote = o.phase === 'order_received' ? 'I sent them the deposit request automatically, so there is nothing to confirm.' : 'Confirm the order on your dashboard when you know you can make it.';
  if (key === 'deposit') vars.amountPaid = (Number(o.depositAmount) || 0).toFixed(2);
  if (key === 'payment') vars.amountPaid = (Number(o.balancePaid) || 0).toFixed(2);
  practiceSay('owner', 'auto', renderEmailText(tpl.body, vars), renderEmailText(tpl.subject, vars).replace(/\s*\n\s*/g, ' '), toOwner);
}
// Every change goes through here, so the emails it would send appear in the chat.
function practiceChange(fn) {
  const p = state.practice;
  if (!p) return;
  const before = JSON.parse(JSON.stringify(p.order));
  fn(p.order);
  const o = p.order;
  if (o.phase !== before.phase) {
    if (o.phase === 'details_check') practiceSay('owner', 'email', o.detailsEmail.body, o.detailsEmail.subject);
    else if (PRACTICE_PHASE_EMAILS[o.phase]) practiceEmail(PRACTICE_PHASE_EMAILS[o.phase]);
  } else if (o.phase === 'delivered' && (o.deliveryTracking || '') !== (before.deliveryTracking || '') && o.deliveryTracking) {
    practiceEmail('delivery_update');
  }
  if (o.customerApprovedAt && !before.customerApprovedAt) practiceEmail('owner_approved', true);
  if (o.paymentStatus === 'deposit_received' && before.paymentStatus !== 'deposit_received' && !isPaidInFull(before)) practiceEmail('deposit');
  if (isPaidInFull(o) && !isPaidInFull(before)) practiceEmail('payment');
  render();
}

// Your side
function practiceSendQuote() {
  const p = state.practice, mins = parseFloat(p.mins), grams = parseFloat(p.grams);
  const it = p.order.items[0];
  if (fixedPrice(it) === null && (!(mins > 0) || !(grams > 0))) { showAlert('practice-err', 'Enter print time and grams to quote.', 'error'); return; }
  practiceChange(o => {
    o.items.forEach(x => { x.minutes = mins || x.knownMinutes || null; x.grams = grams || x.grams; });
    o.rates = quoteRates(currentRules());
    o.phase = 'quote_sent'; o.paymentStatus = 'payment_requested'; o.customerApprovedAt = '';
    stampPhase(o, 'quote_sent');
  });
}
function practiceAskDetails() {
  const p = state.practice;
  const questions = String(p.questions || '').trim();
  if (!questions) { showAlert('practice-err', 'Write your questions first.', 'error'); return; }
  practiceChange(o => {
    o.detailsQuestions = questions;
    o.detailsEmail = detailsEmailFor(o, questions);
    o.phase = 'details_check';
    stampPhase(o, 'details_check');
  });
  p.questions = '';
  render();
}
function practicePhase(phase) {
  const o = state.practice && state.practice.order;
  if (!o) return;
  if (phase === 'quote_sent' && beforeQuote(o.phase)) { practiceSendQuote(); return; }
  if (!canAdvanceToPhase(o.phase, phase)) { render(); return; }
  if (phase === 'details_check') { render(); document.getElementById('practice-questions')?.focus(); return; }
  practiceChange(x => { x.phase = phase; stampPhase(x, phase); });
}
function practicePayment(status) {
  const o = state.practice && state.practice.order;
  if (!o || !canAdvancePayment(o.paymentStatus, status)) { render(); return; }
  let amount = 0;
  if (status === 'deposit_received' || status === 'payment_received') {
    amount = askPaymentAmount(o, status);
    if (!(amount > 0)) { if (amount !== null) alert('Type the amount they paid, like 45.00. Nothing was changed and no email was sent.'); render(); return; }
  }
  practiceChange(x => {
    x.paymentStatus = status;
    if (status === 'deposit_received') { if (!x.depositAt) x.depositAt = new Date().toISOString(); x.depositAmount = amount; }
    if (status === 'payment_received') { x.balancePaid = amount; if (!x.paidAt) x.paidAt = new Date().toISOString(); }
  });
}
function practiceSaveTracking() {
  const p = state.practice;
  practiceChange(o => {
    o.deliveryTracking = String(p.tracking || '').trim();
    o.postageCost = String(p.postage || '').trim() === '' ? '' : Number(p.postage);
    // Like the real site: the tracking number on a Ready to Ship order ships it.
    if (o.phase === 'ready_to_ship' && o.deliveryTracking) { o.phase = 'delivered'; stampPhase(o, 'delivered'); }
  });
}
// The automatic follow-up emails (quote reminder, review request), without waiting days.
function practiceSkipAhead() {
  const p = state.practice, o = p.order;
  if (o.phase === 'quote_sent' && !o.customerApprovedAt && !p.remindedAt) { practiceEmail('reminder'); p.remindedAt = new Date().toISOString(); }
  else if (o.phase === 'delivered' && !p.reviewAskedAt) { practiceEmail('review_request'); p.reviewAskedAt = new Date().toISOString(); }
  else { showAlert('practice-err', 'Nothing to send yet. Use this once the quote is sent and not approved (a reminder), or once the order is Shipped (a review request).', 'error'); return; }
  render();
}
function practiceMessage(sender) {
  const p = state.practice, id = sender === 'owner' ? 'practice-owner-msg' : 'practice-customer-msg';
  const el = document.getElementById(id);
  const text = String(el ? el.value : '').trim();
  if (!text) return;
  practiceSay(sender, 'site', text);
  render();
  document.getElementById(id)?.focus();
}
// Customer side
function practiceApprove() {
  practiceChange(o => {
    o.customerApprovedAt = new Date().toISOString();
    if (featureOn('autoDeposit') && o.phase === 'quote_sent') { o.phase = 'order_received'; stampPhase(o, 'order_received'); }   // like the real site
  });
}
function practicePay(amount) { practiceSay('customer', 'site', `I just sent $${amount.toFixed(2)} on Venmo.`); render(); }

function renderPracticeCustomer() {
  const o = state.practice.order, rules = rulesFor(o);
  const total = o.items.every(itemPriced) ? orderSum(o) : null;
  let action = '';
  if (o.phase === 'quote_sent') {
    action = o.customerApprovedAt ? '<div class="order-action"><strong>Thanks!</strong> We got your go-ahead and will confirm your order soon.</div>'
      : `<div class="order-action"><button class="btn-primary" type="button" id="practice-approve" onclick="practiceApprove()">Looks good, I'd like to order</button>
        <div class="order-action-sub">Total $${total !== null ? total.toFixed(2) : '—'}. Nothing is charged yet.</div></div>`;
  } else if (phaseIndex(o.phase) >= phaseIndex('order_received') && total && !isPaidInFull(o)) {
    const left = balanceDue(o, total, rules), deposit = depositAmount(o, total, rules);
    const shipIn = phaseIndex(o.phase) >= phaseIndex('final_payment_needed');
    const offerDeposit = o.paymentStatus !== 'deposit_received' && o.phase === 'order_received' && deposit > 0 && deposit < total;
    action = `<div class="order-action">
      ${offerDeposit ? `<button class="btn-sm" type="button" id="practice-pay-deposit" onclick="practicePay(${deposit})">Pay the deposit, $${deposit.toFixed(2)} (pretend)</button>` : ''}
      <button class="btn-sm" type="button" id="practice-pay-all" onclick="practicePay(${left})">${shipIn ? 'Pay the rest and shipping deposit' : 'Pay'}, $${left.toFixed(2)} (pretend)</button>
      ${shipIn ? `<div class="order-action-sub">${esc(shippingDepositNote(rules))}</div>` : ''}
      <div class="order-action-sub">On the real site these open Venmo. Here they just tell you in the chat.</div></div>`;
  } else if (isPaidInFull(o)) action = '<div class="order-action"><strong>Payment received.</strong> Thank you!</div>';
  return `<section class="card practice-side" aria-labelledby="practice-cust-h">
    <h3 class="card-title" id="practice-cust-h">What ${esc(o.clientName)} sees</h3>
    <div class="job-title">${esc(o.clientName)}'s Request</div>
    ${renderTrackerSteps(o)}
    ${action}
    <div class="conversation customer-conversation"><div class="card-title" style="margin-bottom:6px;">Messages</div>
      ${renderThread(state.practice.messages, 'customer')}
      <div class="field" style="margin-top:10px;"><label for="practice-customer-msg">Message as ${esc(o.clientName)}</label>
        <textarea id="practice-customer-msg" class="autogrow" rows="2" spellcheck="true" oninput="autoGrow(this)" placeholder="Pretend to be the customer..."></textarea></div>
      <button class="btn-sm" type="button" id="practice-customer-send" onclick="practiceMessage('customer')">Send as customer</button>
    </div>
  </section>`;
}
function renderPracticeOwner() {
  const p = state.practice, o = p.order;
  const total = o.items.every(itemPriced) ? orderSum(o) : null;
  return `<section class="card practice-side" aria-labelledby="practice-owner-h">
    <h3 class="card-title" id="practice-owner-h">What you see</h3>
    <div class="job-title">${esc(o.clientName)} ${conversationChipFor(p.messages)}</div>
    <div class="job-meta">${esc(o.clientEmail)} · ${esc(o.items.map(it => `${it.name}${it.qty > 1 ? ` × ${it.qty}` : ''} (${filamentLabel(it)})`).join(', '))}${total !== null ? ` · total $${total.toFixed(2)}` : ''}</div>
    <div class="row2" style="margin-top:10px;">
      <div class="field"><label for="practice-phase">Order phase</label>
        <select id="practice-phase" class="phase-select" onchange="practicePhase(this.value)">
          ${ORDER_PHASES.filter(ph => ph.id !== 'details_check').map((ph, idx0) => { const idx = phaseIndex(ph.id); return `<option value="${ph.id}" ${o.phase === ph.id ? 'selected' : ''} ${idx === phaseIndex(o.phase) || idx === phaseIndex(o.phase) + 1 || (ph.id === 'quote_sent' && beforeQuote(o.phase)) ? '' : 'disabled'}>${ph.label}</option>`; }).join('')}
        </select></div>
      <div class="field"><label for="practice-payment">Payment status</label>
        <select id="practice-payment" class="phase-select" onchange="practicePayment(this.value)">
          ${PAYMENT_PHASES.map((ph, idx) => `<option value="${ph.id}" ${o.paymentStatus === ph.id ? 'selected' : ''} ${idx >= paymentIndex(o.paymentStatus) ? '' : 'disabled'}>${ph.label}</option>`).join('')}
        </select></div>
    </div>
    ${beforeQuote(o.phase) ? `<fieldset class="owner-edit-item"><legend>Before the quote</legend>
      <div class="field"><label for="practice-questions">Confirm details: your questions</label>
        <textarea id="practice-questions" class="autogrow" rows="2" spellcheck="true" oninput="state.practice.questions = this.value; autoGrow(this)">${esc(p.questions)}</textarea></div>
      <button class="btn-sm" type="button" id="practice-ask" onclick="practiceAskDetails()">Send questions</button>
      <div class="row2" style="margin-top:10px;">
        <div class="field"><label for="practice-mins">Print time (minutes)</label><input type="number" id="practice-mins" min="0" value="${esc(p.mins)}" oninput="state.practice.mins = this.value" /></div>
        <div class="field"><label for="practice-grams">Grams</label><input type="number" id="practice-grams" min="0" value="${esc(p.grams)}" oninput="state.practice.grams = this.value" /></div>
      </div>
      <button class="btn-sm" type="button" id="practice-quote" onclick="practiceSendQuote()">Save &amp; notify (send quote)</button>
    </fieldset>` : ''}
    ${o.phase === 'delivered' || o.phase === 'ready_to_ship' ? `<div class="field"><label for="practice-tracking">Carrier and tracking number</label>
      <input type="text" id="practice-tracking" value="${esc(p.tracking)}" oninput="state.practice.tracking = this.value" /></div>
      <div class="field"><label for="practice-postage">What postage cost ($)</label>
      <input type="number" step="0.01" min="0" id="practice-postage" value="${esc(p.postage || '')}" oninput="state.practice.postage = this.value" /></div>
      <button class="btn-sm" type="button" onclick="practiceSaveTracking()">${o.phase === 'ready_to_ship' ? 'Save tracking and mark Shipped' : 'Save shipping details'}</button>` : ''}
    <div style="margin-top:8px;"><button class="btn-sm" type="button" id="practice-skip" onclick="practiceSkipAhead()">Pretend a few days have passed</button>
      <div class="field-help">The real shop sends two emails on its own as days go by: a reminder if the customer hasn't approved their quote, and a review request about a week after shipping. This button shows you that email now instead of making you wait. It only does something when the quote is sent but not approved, or when the order is Shipped.</div></div>
    <div class="alert error" id="practice-err"></div>
    ${renderTrackerSteps(o, false)}
    <div class="conversation"><div class="card-title" style="margin-bottom:6px;">Conversation</div>
      ${renderThread(p.messages, 'owner', o.clientName)}
      <div class="field" style="margin-top:10px;"><label for="practice-owner-msg">Message to ${esc(o.clientName)}</label>
        <textarea id="practice-owner-msg" class="autogrow" rows="2" spellcheck="true" oninput="autoGrow(this)"></textarea></div>
      <button class="btn-sm" type="button" id="practice-owner-send" onclick="practiceMessage('owner')">Send message</button>
    </div>
  </section>`;
}
function conversationChipFor(list) {
  const real = list.filter(m => !m.toOwner);
  const last = real[real.length - 1];
  return !last ? '' : last.sender === 'customer' ? '<span class="status waiting-you">Waiting on you</span>' : '<span class="status waiting-them">Waiting on customer</span>';
}
function renderPracticePage() {
  if (!state.galleryLoaded) loadGallery().then(render);
  const designs = practiceDesigns();
  return `<div class="owner-page-header"><div class="section-header"><div>
      <h2 class="section-title">Practice order</h2>
      <div class="section-sub">A pretend customer for trying the whole order from both sides. Nothing here is saved or emailed, and real customers never see it. Emails show up in the chat instead.</div>
    </div></div></div>
    <div class="card practice-start">
      <div class="row2">
        <div class="field"><label for="practice-design">Practice request for</label>
          <select id="practice-design"><option value="">A phone stand (link request)</option>
            ${designs.map(g => `<option value="${esc(g.id)}">${esc(g.title)}</option>`).join('')}</select></div>
        <div class="field" style="align-self:end;"><button class="btn-sm" type="button" id="practice-start" onclick="startPractice(document.getElementById('practice-design').value)">${state.practice ? 'Start over' : 'Start a practice order'}</button></div>
      </div>
      ${state.practice ? '' : '<div class="field-help">Starting one sends the pretend "New request" and "Request received" emails into the chat, like a real request.</div>'}
    </div>
    ${state.practice ? `<div class="practice-grid">${renderPracticeCustomer()}${renderPracticeOwner()}</div>` : ''}`;
}

// ── Settings → Updates: merged changes from GitHub, newest first, grouped by day
async function loadSiteUpdates(force) {
  if (state.siteUpdatesLoading || (state.siteUpdates && !force)) return;
  state.siteUpdatesLoading = true; state.siteUpdatesError = false; render();
  try {
    const res = await fetch('https://api.github.com/repos/jeffsolo49/soloprint/pulls?state=closed&per_page=100&sort=updated&direction=desc', { cache: 'no-store' });
    if (!res.ok) throw new Error('bad');
    const list = await res.json();
    state.siteUpdates = list.filter(p => p.merged_at && !/^claude\.md/i.test(p.title || ''))
      .sort((a, b) => new Date(b.merged_at) - new Date(a.merged_at))
      .map(p => ({ id: p.number, title: p.title, at: p.merged_at, body: updateBodyText(p.body) }));
  } catch (e) { state.siteUpdatesError = true; }
  state.siteUpdatesLoading = false; render();
}
function updateBodyText(body) {
  return String(body || '').replace(/\r/g, '')
    .split('\n').filter(l => !/Generated with|claude\.ai\/code\/session/i.test(l)).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}
function showOlderUpdates() { state.siteUpdatesAll = true; render(); }
function renderUpdatesSettings() {
  if (!state.siteUpdates && !state.siteUpdatesLoading && !state.siteUpdatesError) setTimeout(loadSiteUpdates, 0);
  let inner;
  if (state.siteUpdatesError) inner = `<p class="field-help">Couldn't load the list. <button type="button" class="btn-link" onclick="loadSiteUpdates(true)">Try again</button></p>`;
  else if (!state.siteUpdates) inner = `<p class="field-help">Loading…</p>`;
  else {
    const cutoff = Date.now() - 30 * 86400000;
    const shown = state.siteUpdates.filter(u => state.siteUpdatesAll || new Date(u.at).getTime() >= cutoff);
    const day = iso => new Date(iso).toLocaleDateString('en-US', { timeZone: AUSTIN_TIMEZONE, month: 'short', day: 'numeric', year: 'numeric' });
    let last = '';
    inner = shown.map(u => {
      const d = day(u.at), head = d !== last ? `<h4 class="updates-day">${esc(d)}</h4>` : ''; last = d;
      return `${head}<details class="update-item"><summary>${esc(u.title)}</summary>${u.body ? `<div class="update-body" style="white-space:pre-wrap">${esc(u.body)}</div>` : ''}</details>`;
    }).join('') || '<p class="field-help">No changes in the last 30 days.</p>';
    if (!state.siteUpdatesAll && shown.length < state.siteUpdates.length) inner += `<p><button type="button" class="btn-secondary" onclick="showOlderUpdates()">Show older changes</button></p>`;
  }
  return `<div class="card"><h3 class="card-title">Updates</h3><div class="field-help">Every change made to the site, newest first. Tap one to read the details.</div>${inner}</div>`;
}


// A color's photo is an example print, shown bigger on the same page (not a new tab) and closed with the button, Esc or a tap outside.
function colorPhotoNote(c) {
  return t('colorPhotoNote').replace(/\{color\}/gi, c.name);
}
function openColorPhoto(id) {
  const c = customerColors().find(x => x.id === id);
  if (c && c.photo) openPhotoViewer(c.photo, `Example print in ${c.name} filament`, colorPhotoNote(c));
}
function openPhotoViewer(url, alt, caption) {
  closePhotoViewer();
  const opener = document.activeElement;
  const box = document.createElement('div');
  box.id = 'photo-viewer';
  box.className = 'photo-viewer';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', alt);
  box.innerHTML = `<div class="photo-viewer-card">
    <img src="${esc(url)}" alt="${esc(alt)}" referrerpolicy="no-referrer" />
    <p class="photo-viewer-caption">${esc(caption)}</p>
    <button type="button" class="btn-primary photo-viewer-close" onclick="closePhotoViewer()">Close</button>
  </div>`;
  box.addEventListener('click', e => { if (e.target === box) closePhotoViewer(); });
  box._opener = opener;
  document.body.appendChild(box);
  document.addEventListener('keydown', photoViewerKey);
  box.querySelector('.photo-viewer-close').focus();
}
function photoViewerKey(e) {
  if (e.key === 'Escape') closePhotoViewer();
}
function closePhotoViewer() {
  const box = document.getElementById('photo-viewer');
  document.removeEventListener('keydown', photoViewerKey);
  if (!box) return;
  const opener = box._opener;
  box.remove();
  if (opener && document.contains(opener) && opener.focus) opener.focus();
}

// ── ETSY ORDERS TO MAKE ───────────────────────────────────────────────────
// Owner only (Orders > Etsy to make). Etsy orders still to print, each with its parts and colors, and one print list
// across all of them grouped by color. Saved in owner_private key `etsy_todo`: { orders: [{ id, etsyId, buyer, due, note,
// createdAt, done, doneAt, lines: [{ id, what, color, qty, printed }] }] }. Nothing here touches Etsy or the sales numbers.
function etsyTodo() { const d = (state.ownerPrivate && state.ownerPrivate.etsy_todo) || {}; return Array.isArray(d.orders) ? d.orders : []; }
async function saveEtsyTodo(orders, msg) {
  state.ownerPrivate = { ...(state.ownerPrivate || {}), etsy_todo: { orders } };
  try { await saveOwnerPrivate('etsy_todo'); state.todoMsg = msg || ''; render(); }
  catch (e) { state.todoMsg = ''; render(); showAlert('todo-err', "Couldn't save. Check you're logged in, and that supabase/owner-tools.sql has been run.", 'error'); }
}
function todoColorName(key) {
  if (!key) return '';
  const c = (state.settings.colors || []).find(x => x.id === key);
  return c ? c.name : key === 'black' ? 'Black' : key === 'white' ? 'White' : key;
}
function todoColorHex(name) {
  const n = String(name || '').trim().toLowerCase();
  const c = (state.settings.colors || []).find(x => String(x.name).trim().toLowerCase() === n);
  return c ? c.hex : n === 'black' ? '#111111' : n === 'white' ? '#ffffff' : '';
}
function todoLeft(l) { return Math.max(0, (Number(l.qty) || 1) - (Number(l.printed) || 0)); }
function todoDraft() { if (!state.todoDraft) state.todoDraft = { etsyId: '', buyer: '', due: '', note: '', lines: [] }; return state.todoDraft; }
function todoDue(o) {
  if (!o.due) return '';
  const days = Math.round((new Date(o.due + 'T12:00:00') - new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00')) / 864e5);
  const when = new Date(o.due + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `<span class="todo-due${days < 0 ? ' late' : days <= 2 ? ' soon' : ''}">Ship by ${esc(when)}${days < 0 ? ` (${-days} day${days === -1 ? '' : 's'} late)` : days === 0 ? ' (today)' : days === 1 ? ' (tomorrow)' : ''}</span>`;
}
function renderEtsyTodoPage() {
  if (!state.galleryLoaded) loadGallery().then(render);
  const open = etsyTodo().filter(o => !o.done).sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')) || String(a.createdAt).localeCompare(String(b.createdAt)));
  const done = etsyTodo().filter(o => o.done).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt))).slice(0, 30);
  // Print list: every part still to print, grouped by color.
  const byColor = new Map();
  open.forEach(o => (o.lines || []).forEach(l => {
    if (!todoLeft(l)) return;
    const k = String(l.color || 'No color picked').trim(), key = k.toLowerCase();
    if (!byColor.has(key)) byColor.set(key, { name: k, rows: [] });
    byColor.get(key).rows.push({ o, l });
  }));
  const colors = [...byColor.values()].sort((a, b) => b.rows.reduce((n, r) => n + todoLeft(r.l), 0) - a.rows.reduce((n, r) => n + todoLeft(r.l), 0));
  // A color button shows only the orders with parts left to print in that color, and only those parts.
  const fc = byColor.has(state.todoColor) ? state.todoColor : '';
  const shown = fc ? open.filter(o => (o.lines || []).some(l => todoLeft(l) && String(l.color || 'No color picked').trim().toLowerCase() === fc)) : open;
  const swatch = name => { const hex = todoColorHex(name); return hex ? `<span class="swatch" style="background:${esc(hex)}" aria-hidden="true"></span>` : ''; };
  const who = o => `${o.etsyId ? '#' + esc(o.etsyId) : 'Etsy order'}${o.buyer ? ' · ' + esc(o.buyer) : ''}`;
  const colorList = (state.settings.colors || []).map(c => c.name).concat(['Black', 'White']).filter((v, i, a) => a.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i);
  const d = todoDraft();
  const designs = (state.gallery || []).filter(g => (g.parts || []).length || g.title).sort((a, b) => String(a.title).localeCompare(String(b.title)));
  const pick = designs.find(g => g.id === state.todoDesign);
  const combos = (pick && pick.colorMap && pick.colorMap.combos) || [];
  return `
    <div class="owner-page-header">
      <div class="section-header">
        <div class="section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>
        <div><h2 class="section-title">Etsy to make</h2><div class="section-sub">Etsy orders still to print: every part, in every color, in one list</div></div>
      </div>
    </div>
    <div class="alert error" id="todo-err"></div>
    ${state.todoMsg ? `<div class="alert success" style="display:block;" role="status">${esc(state.todoMsg)}</div>` : ''}
    <div class="card" id="todo-orders">
      <h3 class="card-title">Waiting to finish (${open.length})</h3>
      ${colors.length ? `<div class="todo-colorbar" role="group" aria-label="Show parts in one color">
        <button type="button" class="todo-chip${fc ? '' : ' on'}" aria-pressed="${!fc}" onclick="state.todoColor = ''; render();">All colors</button>
        ${colors.map(c => { const key = c.name.toLowerCase(), n = c.rows.reduce((x, r) => x + todoLeft(r.l), 0);
          return `<button type="button" class="todo-chip${fc === key ? ' on' : ''}" aria-pressed="${fc === key}" onclick="state.todoColor = state.todoColor === '${esc(key)}' ? '' : '${esc(key)}'; render();">${swatch(c.name)}${esc(c.name)} · ${n} to print</button>`; }).join('')}
      </div>` : open.length ? '<p class="field-help">Everything is printed. Mark the orders shipped.</p>' : ''}
      ${shown.length ? shown.map(o => { const lines = o.lines || [], tot = lines.reduce((n, l) => n + (Number(l.qty) || 1), 0), got = lines.reduce((n, l) => n + Math.min(Number(l.printed) || 0, Number(l.qty) || 1), 0);
        const vis = fc ? lines.filter(l => String(l.color || 'No color picked').trim().toLowerCase() === fc) : lines;
        return `<section class="todo-order" id="todo-${esc(o.id)}" aria-label="${o.etsyId ? 'Etsy order ' + esc(o.etsyId) : 'Etsy order'}">
          <div class="todo-o-head"><span class="todo-o-who">${who(o)}</span> ${todoDue(o)} <span class="todo-progress${got >= tot && tot ? ' all' : ''}">${got} of ${tot} printed</span></div>
          ${o.title ? `<div class="todo-o-title">${esc(o.title)}</div>` : ''}
          ${o.note ? `<p class="field-help">${esc(o.note)}</p>` : ''}
          <ul class="todo-parts">${vis.map(l => state.todoLineEdit === l.id ? todoLineForm(o, l, colorList) : `<li class="${todoLeft(l) ? '' : 'printed'}">
            ${todoPicture(o, l)}
            <span class="todo-part-text">${swatch(l.color)}${Number(l.qty) || 1} × <strong>${esc(l.what)}</strong>${l.color ? ` · ${esc(l.color)}` : ''}</span>
            ${todoPieces(o, l)}
            <span class="todo-fix"><button type="button" class="btn-sm" onclick="state.todoLineEdit = '${esc(l.id)}'; render(); document.getElementById('tl-what-${esc(l.id)}')?.focus();" aria-label="Change ${esc(l.what)}">Change</button>
              <button type="button" class="btn-sm danger" onclick="todoLineRemove('${esc(o.id)}', '${esc(l.id)}')" aria-label="Remove ${esc(l.what)}">Remove</button></span></li>`).join('')}</ul>
          ${fc && vis.length < lines.length ? `<div class="field-help">${lines.length - vis.length} more part${lines.length - vis.length === 1 ? '' : 's'} in other colors.</div>` : ''}
          <div class="money-controls"><button type="button" class="btn-sm" onclick="todoFinish('${esc(o.id)}')">Shipped: done</button>
            <button type="button" class="btn-sm" onclick="todoEdit('${esc(o.id)}')">Edit order</button>
            <button type="button" class="btn-sm danger" onclick="todoDelete('${esc(o.id)}')">Delete order</button></div>
        </section>`; }).join('') : `<p class="field-help">${open.length ? 'No parts in that color left to print.' : 'No Etsy orders waiting. Add one below.'}</p>`}
    </div>
    <div class="card" id="todo-add">
      <h3 class="card-title">${d.id ? 'Edit this Etsy order' : 'Add an Etsy order'}</h3>
      <div class="money-controls">
        <button type="button" class="btn-sm" onclick="document.getElementById('todo-file').click()">Add unshipped orders from Etsy's Order Items file</button>
        <input type="file" id="todo-file" accept=".csv,text/csv" hidden onchange="todoImport(this)" />
      </div>
      <div class="field-help">On Etsy: Shop Manager, Settings, Options, Download Data, Order Items, then Download CSV. Orders not shipped yet are added with their items and options (like color); ones already here are skipped.</div>
      <div class="expense-form">
        <div class="field"><label for="todo-id">Etsy order number</label><input type="text" inputmode="numeric" id="todo-id" maxlength="20" value="${esc(d.etsyId)}" oninput="todoDraft().etsyId = this.value" /></div>
        <div class="field"><label for="todo-buyer">Buyer</label><input type="text" id="todo-buyer" maxlength="80" value="${esc(d.buyer)}" oninput="todoDraft().buyer = this.value" /></div>
        <div class="field"><label for="todo-due">Ship by</label><input type="date" id="todo-due" value="${esc(d.due)}" oninput="todoDraft().due = this.value" /></div>
        <div class="field" style="flex:2;"><label for="todo-note">Note</label><input type="text" id="todo-note" maxlength="300" value="${esc(d.note)}" oninput="todoDraft().note = this.value" /></div>
      </div>
      ${d.title ? `<div class="field"><label for="todo-title">Etsy listing title</label><input type="text" id="todo-title" maxlength="200" value="${esc(d.title)}" oninput="todoDraft().title = this.value" /></div>` : ''}
      <h4 class="cm-heading">Parts to print</h4>
      ${d.lines.length ? `<ul class="todo-lines">${d.lines.map((l, n) => `<li><span>${swatch(l.color)}${Number(l.qty) || 1} × <strong>${esc(l.what)}</strong> · ${esc(l.color || 'no color')}</span>
        <button type="button" class="btn-sm danger" onclick="todoDraft().lines.splice(${n}, 1); render();" aria-label="Remove ${esc(l.what)}">✕</button></li>`).join('')}</ul>` : '<p class="field-help">No parts yet.</p>'}
      <fieldset class="todo-from"><legend>From one of your designs</legend>
        <div class="expense-form">
          <div class="field" style="flex:2;"><label for="todo-design">Design</label><select id="todo-design" onchange="state.todoDesign = this.value; render(); document.getElementById('todo-design')?.focus();">
            <option value="">Pick a design</option>${designs.map(g => `<option value="${esc(g.id)}" ${g.id === state.todoDesign ? 'selected' : ''}>${esc(g.title || 'Untitled')}</option>`).join('')}</select></div>
          ${combos.length ? `<div class="field" style="flex:2;"><label for="todo-combo">Color idea</label><select id="todo-combo"><option value="">Each part's usual color</option>${combos.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></div>` : ''}
          <div class="field"><label for="todo-dqty">How many</label><input type="number" id="todo-dqty" min="1" step="1" value="1" /></div>
          <button type="button" class="btn-sm" onclick="todoAddDesign()" ${pick ? '' : 'disabled'}>Add its parts</button>
        </div>
      </fieldset>
      <fieldset class="todo-from"><legend>Or type a part</legend>
        <div class="expense-form">
          <div class="field" style="flex:2;"><label for="todo-what">Part or item</label><input type="text" id="todo-what" maxlength="80" placeholder="e.g. Base" /></div>
          <div class="field"><label for="todo-color">Color</label><input type="text" id="todo-color" maxlength="60" list="todo-colors" /></div>
          <div class="field"><label for="todo-qty">How many</label><input type="number" id="todo-qty" min="1" step="1" value="1" /></div>
          <button type="button" class="btn-sm" onclick="todoAddLine()">Add part</button>
        </div>
        <datalist id="todo-colors">${colorList.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>
      </fieldset>
      <div class="money-controls"><button type="button" class="btn-primary" style="width:auto;" id="todo-save" onclick="todoSave()">${d.id ? 'Save changes' : 'Save order'}</button>
        ${d.id || d.lines.length || d.etsyId || d.buyer ? `<button type="button" class="btn-sm" onclick="state.todoDraft = null; render();">Cancel</button>` : ''}</div>
    </div>
    ${done.length ? `<details class="card todo-done"><summary><strong>Finished (${done.length})</strong></summary>
      <ul class="todo-lines">${done.map(o => `<li><span>${who(o)} · ${esc((o.lines || []).map(l => `${Number(l.qty) || 1} × ${l.what}`).join(', '))}</span>
        <span class="todo-fix"><button type="button" class="btn-sm" onclick="todoReopen('${esc(o.id)}')">Put back</button>
        <button type="button" class="btn-sm danger" onclick="todoDelete('${esc(o.id)}')" aria-label="Delete finished order ${o.etsyId ? esc(o.etsyId) : ''}">Delete</button></span></li>`).join('')}</ul></details>` : ''}`;
}
// Fixing one part in place: what it is, its color and how many.
function todoLineForm(o, l, colorList) {
  const id = esc(l.id);
  return `<li class="todo-line-edit"><div class="expense-form">
    <div class="field" style="flex:2;"><label for="tl-what-${id}">Part or item</label><input type="text" id="tl-what-${id}" maxlength="80" value="${esc(l.what)}" /></div>
    <div class="field"><label for="tl-color-${id}">Color</label><input type="text" id="tl-color-${id}" maxlength="60" list="tl-colors-${id}" value="${esc(l.color || '')}" />
      <datalist id="tl-colors-${id}">${colorList.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist></div>
    <div class="field"><label for="tl-qty-${id}">How many</label><input type="number" id="tl-qty-${id}" min="1" step="1" value="${Number(l.qty) || 1}" /></div>
  </div><div class="money-controls"><button type="button" class="btn-sm" onclick="todoLineSave('${esc(o.id)}', '${id}')">Save</button>
    <button type="button" class="btn-sm" onclick="state.todoLineEdit = ''; render();">Cancel</button></div></li>`;
}
function todoLineSave(oid, lid) {
  const v = k => String((document.getElementById(`tl-${k}-${lid}`) || {}).value || '').trim();
  if (!v('what')) { showAlert('todo-err', 'Type the part or item.', 'error'); return; }
  state.todoLineEdit = '';
  todoChange(oid, o => { (o.lines || []).forEach(l => { if (l.id === lid) { l.what = v('what').slice(0, 80); l.color = v('color').slice(0, 60); l.qty = Math.max(1, Math.min(999, parseInt(v('qty'), 10) || 1)); l.printed = Math.min(Number(l.printed) || 0, l.qty); } }); return o; }, 'Saved.');
}
function todoLineRemove(oid, lid) {
  const o = etsyTodo().find(x => x.id === oid), l = o && (o.lines || []).find(x => x.id === lid);
  if (!l || !confirm(`Remove "${l.what}" from ${o.etsyId ? 'order #' + o.etsyId : 'this order'}?`)) return;
  if ((o.lines || []).length === 1 && confirm('That was its only part. Delete the whole order from this list?')) { saveEtsyTodo(etsyTodo().filter(x => x.id !== oid), 'Deleted.'); return; }
  todoChange(oid, x => ({ ...x, lines: (x.lines || []).filter(y => y.id !== lid) }), 'Removed.');
}
// A tick box per piece printed (a counter past 12). Ticking box k marks k printed; unticking it marks k - 1.
function todoPieces(o, l) {
  const q = Number(l.qty) || 1, p = Math.min(q, Number(l.printed) || 0), oid = esc(o.id), lid = esc(l.id);
  if (q > 12) return `<span class="todo-step"><span class="todo-count">${p} of ${q} printed</span><button type="button" class="btn-sm" onclick="todoPrinted('${oid}', '${lid}', -1)" aria-label="One fewer printed: ${esc(l.what)}" ${p ? '' : 'disabled'}>−</button><button type="button" class="btn-sm" onclick="todoPrinted('${oid}', '${lid}', 1)" aria-label="One more printed: ${esc(l.what)}" ${p < q ? '' : 'disabled'}>+</button></span>`;
  return `<span class="todo-pieces" role="group" aria-label="Printed: ${esc(l.what)}">${Array.from({ length: q }, (x, k) => `<label class="todo-piece${k < p ? ' on' : ''}"><input type="checkbox" id="todo-pc-${lid}-${k + 1}" ${k < p ? 'checked' : ''} onchange="todoSetPrinted('${oid}', '${lid}', ${k + 1})" />
    <span>${q > 1 ? `Printed ${k + 1}` : 'Printed'}</span><span class="sr-only"> of ${q}: ${esc(l.what)}${l.color ? ', ' + esc(l.color) : ''}</span></label>`).join('')}</span>`;
}
function todoSetPrinted(id, lineId, k) {
  const o = etsyTodo().find(x => x.id === id), l = o && (o.lines || []).find(x => x.id === lineId);
  if (!l) return;
  const now = Number(l.printed) || 0;
  todoChange(id, x => { (x.lines || []).forEach(y => { if (y.id === lineId) y.printed = now >= k ? k - 1 : k; }); return x; }, '')
    .then(() => document.getElementById(`todo-pc-${lineId}-${k}`)?.focus());
}
// The design and part a line is for: saved when it was added from a design, else read from "Part (Design title)".
function todoLink(l) {
  const gallery = state.gallery || [];
  let g = l.galleryId && gallery.find(x => x.id === l.galleryId), part = null;
  if (g) part = l.partId ? (g.parts || []).find(p => p.id === l.partId) : null;
  else {
    const m = String(l.what || '').match(/^(.*) \((.*)\)$/);
    const low = s => String(s || '').trim().toLowerCase();
    g = m ? gallery.find(x => low(x.title) === low(m[2])) : gallery.find(x => low(x.title) === low(l.what));
    if (g && m) part = (g.parts || []).find(p => low(p.name) === low(m[1])) || null;
  }
  return g ? { g, part } : null;
}
function todoColorKey(name) {
  const n = String(name || '').trim().toLowerCase();
  const c = (state.settings.colors || []).find(x => String(x.name).trim().toLowerCase() === n);
  return c ? c.id : n === 'black' || n === 'white' ? n : '';
}
// The part's picture in its color: the design's color-ideas photo with this order's colors on every part and the
// other parts faded; else the part's own photo, else the design's first photo.
function todoPicture(o, l) {
  const link = todoLink(l);
  if (!link) return '';
  const { g, part } = link, m = g.colorMap, parts = g.parts || [];
  if (m && cmUsable(m) && parts.length) {
    const colors = {};
    parts.forEach(p => { colors[p.id] = p.defaultColor || g.colorId || 'white'; });
    (o.lines || []).forEach(x => { const lx = todoLink(x); if (lx && lx.g.id === g.id && lx.part && todoColorKey(x.color)) colors[lx.part.id] = todoColorKey(x.color); });
    if (part && todoColorKey(l.color)) colors[part.id] = todoColorKey(l.color);
    const label = part ? `${part.name} in ${l.color || 'its color'}` : `${g.title} in these colors`;
    return `<span class="todo-pic">${cmCanvas(m, parts, colors, label, 'cm-small', part ? parts.findIndex(p => p.id === part.id) : -1)}</span>`;
  }
  const photo = (part && part.photo) || (g.photos || [])[0];
  return photo ? `<span class="todo-pic">${thumbImg(photo, part ? part.name : g.title, 'thumb')}</span>` : '';
}
function todoNewLine(what, color, qty, link) {
  return { id: settingsId(), what: String(what || '').trim().slice(0, 80), color: String(color || '').trim().slice(0, 60), qty: Math.max(1, Math.min(999, parseInt(qty, 10) || 1)), printed: 0,
    ...(link && link.galleryId ? { galleryId: link.galleryId, ...(link.partId ? { partId: link.partId } : {}) } : {}) };
}
function todoAddLine() {
  const v = id => String((document.getElementById(id) || {}).value || '').trim();
  if (!v('todo-what')) { showAlert('todo-err', 'Type the part or item to print.', 'error'); return; }
  todoDraft().lines.push(todoNewLine(v('todo-what'), v('todo-color'), v('todo-qty')));
  render();
  document.getElementById('todo-what')?.focus();
}
function todoAddDesign() {
  const g = (state.gallery || []).find(x => x.id === state.todoDesign);
  if (!g) return;
  const combo = ((g.colorMap && g.colorMap.combos) || []).find(c => c.id === (document.getElementById('todo-combo') || {}).value);
  const qty = (document.getElementById('todo-dqty') || {}).value;
  const parts = (g.parts || []).filter(p => !p.optional);
  if (parts.length) parts.forEach(p => todoDraft().lines.push(todoNewLine(`${p.name}${g.title ? ` (${g.title})` : ''}`, todoColorName((combo && combo.colors[p.id]) || p.defaultColor || g.colorId || 'white'), qty, { galleryId: g.id, partId: p.id })));
  else todoDraft().lines.push(todoNewLine(g.title || 'Design', todoColorName(g.colorId || 'white'), qty, { galleryId: g.id }));
  render();
}
function todoSave() {
  const d = todoDraft();
  if (!d.lines.length) { showAlert('todo-err', 'Add at least one part to print.', 'error'); return; }
  const o = { id: d.id || settingsId(), etsyId: String(d.etsyId || '').replace(/\D/g, '').slice(0, 20), buyer: String(d.buyer || '').trim().slice(0, 80),
    due: /^\d{4}-\d{2}-\d{2}$/.test(d.due) ? d.due : '', note: String(d.note || '').trim().slice(0, 300), lines: d.lines.slice(0, 60),
    ...(String(d.title || '').trim() ? { title: String(d.title).trim().slice(0, 200) } : {}),
    createdAt: d.createdAt || new Date().toISOString(), done: !!d.done, doneAt: d.doneAt || '' };
  const list = etsyTodo();
  state.todoDraft = null;
  state.todoOpen = o.id;
  saveEtsyTodo(list.some(x => x.id === o.id) ? list.map(x => (x.id === o.id ? o : x)) : list.concat(o), 'Saved.');
}
function todoEdit(id) {
  const o = etsyTodo().find(x => x.id === id);
  if (!o) return;
  state.todoDraft = JSON.parse(JSON.stringify(o));
  render();
  document.getElementById('todo-add')?.scrollIntoView({ block: 'start' });
  document.getElementById('todo-id')?.focus();
}
function todoChange(id, fn, msg) { state.todoOpen = id; return saveEtsyTodo(etsyTodo().map(o => (o.id === id ? fn(JSON.parse(JSON.stringify(o))) : o)), msg); }
function todoPrinted(id, lineId, step) {
  todoChange(id, o => { (o.lines || []).forEach(l => { if (l.id === lineId) l.printed = Math.max(0, Math.min(Number(l.qty) || 1, (Number(l.printed) || 0) + step)); }); return o; }, '');
}
function todoFinish(id) {
  const o = etsyTodo().find(x => x.id === id);
  if (!o) return;
  const left = (o.lines || []).reduce((n, l) => n + todoLeft(l), 0);
  if (!confirm(`Mark ${o.etsyId ? 'order #' + o.etsyId : 'this order'} as shipped and done?${left ? ` ${left} part${left === 1 ? ' is' : 's are'} not marked printed yet.` : ''}`)) return;
  todoChange(id, x => ({ ...x, done: true, doneAt: new Date().toISOString() }), 'Moved to Finished.');
}
function todoReopen(id) { todoChange(id, x => ({ ...x, done: false, doneAt: '' }), 'Put back in Waiting to finish.'); }
function todoDelete(id) {
  const o = etsyTodo().find(x => x.id === id);
  if (!o || !confirm(`Delete ${o.etsyId ? 'order #' + o.etsyId : 'this Etsy order'} from this list? This can't be undone.`)) return;
  saveEtsyTodo(etsyTodo().filter(x => x.id !== id), 'Deleted.');
}
// Etsy's Order Items file: rows not shipped yet become orders here, one line per item (its options, like color, as the color).
async function todoImport(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const { rows } = await etsyReadFile(file);
  const tb = rows ? etsyTable(rows) : null;
  if (!tb || tb.col('order id') < 0 || tb.col('item name') < 0) { showAlert('todo-err', "That isn't Etsy's Order Items file. On Etsy: Shop Manager, Settings, Options, Download Data, then Order Items.", 'error'); return; }
  const get = (r, ...names) => { const k = tb.col(...names); return k >= 0 ? String(r[k] || '').trim() : ''; };
  const have = new Set(etsyTodo().map(o => String(o.etsyId)).filter(Boolean));
  const add = new Map();
  tb.body.forEach(r => {
    const id = get(r, 'order id').replace(/\D/g, ''), shipped = get(r, 'date shipped');
    if (!id || have.has(id) || (shipped && !/^-+$/.test(shipped))) return;
    if (!add.has(id)) add.set(id, { id: settingsId(), etsyId: id, buyer: get(r, 'ship name', 'buyer').slice(0, 80), due: '', note: '', createdAt: new Date().toISOString(), done: false, doneAt: '', lines: [] });
    const opts = get(r, 'variations').replace(/\s*,\s*/g, ', ');
    add.get(id).lines.push(todoNewLine(get(r, 'item name'), opts, get(r, 'quantity')));
    const name = get(r, 'item name'), o = add.get(id);
    if (name && !String(o.title || '').split(' + ').includes(name)) o.title = (o.title ? o.title + ' + ' : '') + name;
  });
  add.forEach(o => { if (o.title) o.title = o.title.slice(0, 200); });
  if (!add.size) { state.todoMsg = 'No new unshipped orders in that file.'; render(); return; }
  saveEtsyTodo(etsyTodo().concat([...add.values()]), `Added ${add.size} unshipped order${add.size === 1 ? '' : 's'}. Tap one to split its items into parts and colors with Edit.`);
}

// ── REVIEWS FROM ETSY ─────────────────────────────────────────────────────
// Settings > Reviews: Etsy's reviews.json ([{ reviewer, date_reviewed 'MM/DD/YYYY', star_rating, message, order_id }]) shown as a
// list to tick, each linkable to a design (guessed from the Etsy sale's item names when they're uploaded). Ticked ones go into the
// settings draft as site reviews ({ name, text, rating, source: 'etsy', date, designId }); Save publishes them. Ones already on the site are left out.
const ETSY_REVIEW_MAX = 40;
function etsyReviewKey(text) { return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120); }
function etsyReviewName(n) { const v = String(n || '').trim(); return /^sign in with|^etsy (user|buyer)$/i.test(v) ? '' : v.slice(0, 60); }
function etsyReviewDesign(orderId, designs) {
  const o = etsyOrders().find(x => String(x.etsyId) === String(orderId));
  const items = String((o && o.items) || '').toLowerCase();
  if (!items) return '';
  const hit = designs.find(g => g.title && items.includes(String(g.title).toLowerCase().slice(0, 24)));
  return hit ? hit.id : '';
}
function etsyReviewsChosen(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    let list;
    try { list = JSON.parse(String(r.result || '').replace(/^﻿/, '')); } catch (e) { list = null; }
    if (!Array.isArray(list) || !list.some(x => x && (x.message || x.review))) { showAlert('review-import-err', "That isn't Etsy's reviews.json file.", 'error'); return; }
    const have = new Set((state.settingsDraft.reviews || []).map(x => etsyReviewKey(x.text)));
    const designs = (state.gallery || []).filter(g => g.published);
    state.reviewImport = list.filter(x => x && String(x.message || x.review || '').trim()).map((x, n) => {
      const m = String(x.date_reviewed || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      const text = String(x.message || x.review).replace(/\s+/g, ' ').trim().slice(0, 600);
      const dup = have.has(etsyReviewKey(text));
      return { n, name: etsyReviewName(x.reviewer), text, rating: Number(x.star_rating) >= 1 && Number(x.star_rating) <= 5 ? Number(x.star_rating) : null,
        date: m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '', dup, pick: !dup, designId: etsyReviewDesign(x.order_id, designs) };
    });
    render();
    document.getElementById('review-import')?.focus();
  };
  r.readAsText(file);
}
function renderEtsyReviewImport(designs) {
  const imp = state.reviewImport, room = ETSY_REVIEW_MAX - (state.settingsDraft.reviews || []).length;
  const opener = `<div class="money-controls"><button type="button" class="btn-sm" onclick="document.getElementById('review-file').click()">Import reviews from Etsy (reviews.json)</button>
    <input type="file" id="review-file" accept=".json,application/json" hidden onchange="etsyReviewsChosen(this)" /></div>
    <div class="alert error" id="review-import-err"></div>
    ${imp ? '' : '<div class="field-help">On Etsy: Shop Manager, Settings, Options, Download Data, then Reviews. You pick which ones to show.</div>'}`;
  if (!imp) return opener;
  const picked = imp.filter(x => x.pick).length;
  return `${opener}<div class="etsy-preview review-import" id="review-import" tabindex="-1">
    <strong>${imp.length} Etsy review${imp.length === 1 ? '' : 's'}</strong>${imp.some(x => x.dup) ? ` · ${imp.filter(x => x.dup).length} already on your site` : ''}
    <div class="field-help">Tick the ones to show. Your site shows up to ${ETSY_REVIEW_MAX} reviews; room for ${Math.max(0, room)} more.</div>
    <ul class="review-import-list">${imp.map(x => `<li>
      <label class="special-order-check"><input type="checkbox" ${x.pick ? 'checked' : ''} ${x.dup ? 'disabled' : ''} onchange="state.reviewImport[${x.n}].pick = this.checked; render(); document.getElementById('review-import')?.focus();" />
        <span>${x.rating ? `<span class="review-stars-show" aria-hidden="true">${'★'.repeat(Math.floor(x.rating))}</span> ` : ''}<strong>${esc(x.name || 'A customer')}</strong>${x.date ? ` · ${esc(x.date)}` : ''}${x.dup ? ' · already on your site' : ''}<br />“${esc(x.text)}”</span></label>
      ${x.dup ? '' : `<div class="field"><label for="rvi-d-${x.n}">Design (optional)</label><select id="rvi-d-${x.n}" onchange="state.reviewImport[${x.n}].designId = this.value">
        <option value="">Not linked to a design</option>${designs.map(g => `<option value="${esc(g.id)}" ${x.designId === g.id ? 'selected' : ''}>${esc(g.title || 'Untitled')}</option>`).join('')}</select></div>`}
    </li>`).join('')}</ul>
    <div class="money-controls"><button type="button" class="btn-sm" id="review-import-add" onclick="addEtsyReviews()" ${picked ? '' : 'disabled'}>Add ${picked} review${picked === 1 ? '' : 's'}</button>
      <button type="button" class="btn-sm" onclick="state.reviewImport = null; render();">Cancel</button></div>
  </div>`;
}
function addEtsyReviews() {
  const imp = state.reviewImport || [], list = state.settingsDraft.reviews || (state.settingsDraft.reviews = []);
  const room = ETSY_REVIEW_MAX - list.length, picked = imp.filter(x => x.pick && !x.dup);
  if (picked.length > room) { showAlert('review-import-err', `Your site shows up to ${ETSY_REVIEW_MAX} reviews. Untick ${picked.length - room}, or remove some older ones first.`, 'error'); return; }
  picked.sort((a, b) => String(b.date).localeCompare(String(a.date))).forEach(x => list.push({ id: settingsId(), name: x.name, text: x.text, designId: x.designId, photos: [], rating: x.rating, source: 'etsy', date: x.date }));
  state.reviewImport = null;
  render();
  showAlert('review-import-err', `Added ${picked.length} review${picked.length === 1 ? '' : 's'}. Tap Save to put them on your site.`, 'success');
}

// ── SECTION BUTTONS (owner) ──
// Every owner page with 2+ sections gets a button per section on the side that stays in view while
// scrolling (on a phone: a "Sections" button that opens the list). Built from the page itself after each
// redraw: each top-level card's heading, plus Help's area headings, so new cards get a button by themselves.
function jumpHeadings() {
  const main = document.querySelector('#main.owner-main');
  if (!main) return [];
  const found = new Set();
  main.querySelectorAll('.card').forEach(c => {
    if (c.parentElement.closest('.card') || c.closest('.modal-backdrop, .mail-modal')) return;
    const h = c.querySelector('.card-title, .email-card-title, h2, h3, summary');
    if (h && h.closest('.card') === c) found.add(h);
  });
  main.querySelectorAll('.wiki-area, .email-group-title').forEach(h => found.add(h));
  return [...found].filter(h => h.offsetParent || h.tagName === 'SUMMARY')
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    .map(h => {
      const copy = h.cloneNode(true);
      copy.querySelectorAll('.email-to, .swatch-note, .nav-badge, .badge, button, input, select').forEach(x => x.remove());
      const name = copy.textContent.replace(/\s+/g, ' ').split(' · ')[0].trim();
      return { h, name: name.length > 34 ? name.slice(0, 32) + '…' : name };
    }).filter(x => x.name);
}
let jumpList = [];
function buildJumpNav() {
  let nav = document.getElementById('jump-nav');
  jumpList = state.view === 'owner' && state.ownerUnlocked ? jumpHeadings() : [];
  const on = jumpList.length >= 2;
  document.documentElement.classList.toggle('jump-on', on);
  if (!on) { if (nav) nav.remove(); return; }
  if (!nav) {
    nav = document.createElement('nav');
    nav.id = 'jump-nav';
    nav.className = 'jump-nav';
    nav.setAttribute('aria-label', 'Sections on this page');
    document.body.appendChild(nav);
  }
  const open = nav.classList.contains('open');
  const html = `<button type="button" class="jump-toggle" aria-expanded="${open}" onclick="toggleJumpNav()">Sections</button>
    <ol class="jump-list">${jumpList.map((x, i) => `<li><button type="button" class="jump-btn" data-jump="${i}" onclick="jumpTo(${i})">${esc(x.name)}</button></li>`).join('')}</ol>`;
  if (nav.dataset.html !== html) { nav.innerHTML = html; nav.dataset.html = html; }
  markJumpActive();
}
function toggleJumpNav(force) {
  const nav = document.getElementById('jump-nav');
  if (!nav) return;
  const open = typeof force === 'boolean' ? force : !nav.classList.contains('open');
  nav.classList.toggle('open', open);
  nav.querySelector('.jump-toggle').setAttribute('aria-expanded', open);
}
function jumpTo(i) {
  const x = jumpList[i];
  if (!x || !x.h.isConnected) return;
  const details = x.h.tagName === 'SUMMARY' ? x.h.parentElement : null;
  if (details && !details.open) details.open = true;
  const target = x.h.closest('.card') && !x.h.matches('.wiki-area, .email-group-title') ? x.h.closest('.card') : x.h;
  target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  if (!x.h.hasAttribute('tabindex') && !/^(SUMMARY|BUTTON|A)$/.test(x.h.tagName)) x.h.setAttribute('tabindex', '-1');
  x.h.focus({ preventScroll: true });
  toggleJumpNav(false);
  setTimeout(markJumpActive, 400);
}
// The section you're reading is highlighted (the last one whose heading has passed under the top bar).
function markJumpActive() {
  const nav = document.getElementById('jump-nav');
  if (!nav || !jumpList.length) return;
  let cur = 0;
  jumpList.forEach((x, i) => { if (x.h.isConnected && x.h.getBoundingClientRect().top < 140) cur = i; });
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) cur = jumpList.length - 1;
  nav.querySelectorAll('.jump-btn').forEach(b => {
    const on = +b.dataset.jump === cur;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  });
}
if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  let jumpTimer = 0;
  const later = () => { clearTimeout(jumpTimer); jumpTimer = setTimeout(buildJumpNav, 120); };
  document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('app-root');
    if (root) new MutationObserver(later).observe(root, { childList: true, subtree: true });
    addEventListener('scroll', () => requestAnimationFrame(markJumpActive), { passive: true });
    addEventListener('resize', later);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') toggleJumpNav(false); });
  });
}

// ── PRE-ORDERS ──
// A design marked "Pre-order" (a new product that isn't ready yet) can be requested like any design. Its items
// keep `preorder`; the quote, confirmed and deposit emails and the customer's order say pre-orders are made
// first come, first served (site text preorderNote, shared preorderQueueNote), and deposits set the order.
function requestLabel(g) { return g && g.preorder ? t('preorderThis') : t('requestThis'); }
// `g`: a design (its page); `b`: the customer's own order (adds their place in line and the expected time).
function renderPreorderNote(g, b) {
  if (g && !g.preorder) return '';
  const line = b ? [preorderLineText(b, state.settings), preorderEtaText(b)].filter(Boolean) : [];
  return `<div class="preorder-note"><span class="preorder-badge">${esc(t('preorderBadge'))}</span>${g && g.preorderReady ? ` <strong>Expected: ${esc(g.preorderReady)}</strong>` : ''}
    <div>${esc(t('preorderNote'))}</div>${line.map((l, n) => `<div${n ? '' : ' class="preorder-line"'}><strong>${esc(l)}</strong></div>`).join('')}</div>`;
}
// Deposit times of open pre-orders per design (what customers' place in line is counted from).
function preorderLineFromOrders(batches) {
  const out = {};
  batches.filter(b => (b.phase || 'estimate') !== 'delivered' && orderIsPreorder(b) && queueTime(b)).forEach(b => {
    (out[preorderDesignId(b)] = out[preorderDesignId(b)] || []).push(queueTime(b));
  });
  Object.keys(out).forEach(k => out[k].sort());
  return cleanPreorderLine(out);
}
// The owner types when a pre-order should print and ship (customers see it on their order and in emails).
function renderPreorderEta(b, where) {
  const id = esc(b.id), first = queueTime(b) && preorderQueue(((b.items || []).find(it => it.preorder === true) || {}).galleryId || '')[0] === b;
  return `<div class="preorder-eta"><label for="eta-${where}-${id}">${first ? 'First in line: expected print and ship time' : 'Expected print and ship time'}</label>
    <span class="preorder-eta-row"><input type="text" id="eta-${where}-${id}" maxlength="80" value="${esc(b.preorderEta || '')}" placeholder="e.g. Jan 12-15" onkeydown="if(event.key==='Enter'){savePreorderEta('${id}','${where}')}" />
    <button type="button" class="btn-sm" onclick="savePreorderEta('${id}', '${where}')">Save</button></span></div>`;
}
async function savePreorderEta(id, where) {
  const b = state.batches.find(x => x.id === id), input = document.getElementById(`eta-${where}-${id}`);
  if (!b || !input) return;
  const before = b.preorderEta || '';
  b.preorderEta = input.value.trim().slice(0, 80);
  if (!(await upsertBatch(b))) { b.preorderEta = before; return; }
  render();
}
function renderPreorderFormFields(f) {
  return `<fieldset class="owner-edit-item preorder-fields">
    <legend>Pre-order</legend>
    <label class="special-order-check"><input type="checkbox" id="gallery-preorder" ${f.preorder ? 'checked' : ''} onchange="updateGalleryForm('preorder', this.checked); render();" /> Take pre-orders for this design (it isn't ready yet)</label>
    <div class="field-help">Customers see "${esc(t('preorderBadge'))}", a "${esc(t('preorderThis'))}" button and your first come, first served note (Settings > Wording > site text "preorderNote"). Orders go through the usual steps: you send the quote, they pay a deposit, and the deposits set the order you make them in. Untick this when it's launched.</div>
    ${f.preorder ? `<div class="field" style="max-width:320px;margin-top:8px;"><label for="gallery-preorder-ready">When it should be ready (optional)</label>
      <input type="text" id="gallery-preorder-ready" maxlength="80" value="${esc(f.preorderReady || '')}" placeholder="e.g. early January" oninput="updateGalleryForm('preorderReady', this.value)" /></div>` : ''}
  </fieldset>`;
}
// Where an order stands among the pre-orders for the same design: deposits first, by when they came in.
function preorderQueue(galleryId) {
  const orders = state.batches.filter(b => (b.phase || 'estimate') !== 'delivered' && (b.items || []).some(it => it.preorder === true && (!galleryId || it.galleryId === galleryId)));
  const at = b => queueTime(b) || '';
  return orders.sort((x, y) => (at(x) && at(y) ? at(x).localeCompare(at(y)) : at(x) ? -1 : at(y) ? 1 : String(x.createdAt).localeCompare(String(y.createdAt))));
}
function preorderPlace(b) {
  const gid = ((b.items || []).find(it => it.preorder === true) || {}).galleryId || '';
  const list = preorderQueue(gid), n = list.indexOf(b) + 1;
  if (!queueTime(b)) return `No deposit yet: their place is set when it comes in (${list.filter(x => queueTime(x)).length} paid ahead).`;
  return n ? `Number ${n} of ${list.length} for this design (by deposit time).` : '';
}
// Designs page: each pre-order design with its orders in the order to make them.
function renderPreorderLists() {
  const designs = state.gallery.filter(g => g.preorder);
  const others = preorderQueue('').filter(b => !(b.items || []).some(it => it.preorder === true && designs.some(g => g.id === it.galleryId)));
  if (!designs.length && !others.length) return '';
  const rows = list => list.length ? `<ol class="preorder-list">${list.map(b => `<li><button type="button" class="btn-link" onclick="focusOwnerOrder('${esc(b.id)}')">${esc(b.clientName || b.clientEmail || 'No name')}</button>
      · ${esc(String((b.items || []).filter(it => it.preorder === true).reduce((s, it) => s + (Number(it.qty) || 1), 0)))} item(s)
      · ${queueTime(b) ? `deposit in ${esc(fmtShort(queueTime(b)))}` : beforeQuote(b.phase) ? 'needs a quote' : b.phase === 'quote_sent' ? 'quote sent' : 'waiting for the deposit'}${renderPreorderEta(b, 'card')}</li>`).join('')}</ol>` : '<div class="field-help">No pre-orders yet.</div>';
  return `<div class="card preorders-card" id="preorders">
    <h3 class="card-title">Pre-orders</h3>
    <div class="field-help">First come, first served: paid deposits first, by when they came in, then the ones still waiting. Tap a name to open the order. Type an expected print and ship time on any order (most useful for whoever is first in line); the customer sees it on their order and in their emails, along with their place in line.</div>
    ${designs.map(g => `<h4 class="preorder-design">${esc(g.title || 'Untitled')}${g.preorderReady ? ` <span class="gallery-meta">expected ${esc(g.preorderReady)}</span>` : ''}</h4>${rows(preorderQueue(g.id))}`).join('')}
    ${others.length ? `<h4 class="preorder-design">Launched designs, pre-orders still open</h4>${rows(others)}` : ''}
  </div>`;
}

// ── REVIEW PHOTOS (owner) ──
// Settings > Reviews: add or remove photos on any review (up to 4), e.g. pictures a customer sent you.
function renderReviewPhotoEditor(r, n) {
  const photos = r.photos || [];
  return `<div class="field review-photo-edit">
    <label>Photos (optional, up to 4)</label>
    ${photos.length ? `<div class="review-photos">${photos.map((u, k) => `<span class="review-photo-item"><img src="${esc(u)}" alt="Review photo ${k + 1}" loading="lazy" />
      <button type="button" class="btn-sm danger" onclick="removeReviewPhoto(${n}, ${k})" aria-label="Remove photo ${k + 1} from this review">Remove</button></span>`).join('')}</div>` : ''}
    ${photos.length < 4 ? `<label class="btn-sm" style="display:inline-block;">Add photos<input type="file" accept="image/*" multiple style="display:none;" onchange="uploadReviewPhotos(${n}, this.files); this.value='';" /></label>` : ''}
    <span class="field-help" id="rv-photo-status-${n}" role="status"></span>
  </div>`;
}
function removeReviewPhoto(n, k) {
  const r = state.settingsDraft && state.settingsDraft.reviews[n];
  if (!r || !r.photos) return;
  r.photos.splice(k, 1);
  render();
}
async function uploadReviewPhotos(n, files) {
  const r = state.settingsDraft && state.settingsDraft.reviews[n];
  const status = document.getElementById(`rv-photo-status-${n}`);
  const token = getOwnerToken();
  if (!r || !token) { if (status) status.textContent = 'Please log in again to upload.'; return; }
  r.photos = r.photos || [];
  const list = [...files].slice(0, Math.max(0, 4 - r.photos.length));
  if (!list.length) { if (status) status.textContent = 'This review already has 4 photos.'; return; }
  let added = 0;
  for (let i = 0; i < list.length; i++) {
    if (status) status.textContent = `Uploading ${i + 1} of ${list.length}...`;
    try {
      const blob = await resizePhoto(list[i], 1200);
      if (!blob) throw new Error('resize failed');
      const path = `reviews/${String(r.id || 'r').replace(/[^A-Za-z0-9_-]/g, '')}-${Date.now()}-${i}.jpg`;
      await uploadStoredPhoto(path, blob, token);
      r.photos.push(GALLERY_PUBLIC_PREFIX + path);
      added++;
    } catch (e) {
      console.error('Review photo error:', e);
      if (status) status.textContent = /unsupported/.test(e.message) ? `"${list[i].name}" isn't a format this browser can read. Try a JPG or PNG.` : "Couldn't upload. Check that you're logged in.";
      break;
    }
  }
  if (added) render();
  const again = document.getElementById(`rv-photo-status-${n}`);
  if (added && again) again.textContent = `Added ${added} photo${added > 1 ? 's' : ''}. Tap Save to keep them.`;
}
