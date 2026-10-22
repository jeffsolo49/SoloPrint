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
    ['specialGramRate', 'Filament, special colors ($ per gram)', 0.001, g => `$${(g * 1000).toFixed(2)} per kg`]
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
    <div class="owner-order-summary-label">"How it works" on the home page</div>
    ${steps.map((step, n) => `<div class="row2 how-edit">
      <div class="field"><label for="how-title-${n}">Step ${n + 1}</label><input type="text" id="how-title-${n}" maxlength="80" value="${esc(step.title)}" oninput="state.settingsDraft.howItWorks[${n}].title = this.value" /></div>
      <div class="field"><label for="how-text-${n}">Details</label><input type="text" id="how-text-${n}" maxlength="300" value="${esc(step.text)}" oninput="state.settingsDraft.howItWorks[${n}].text = this.value" /></div>
    </div>`).join('')}
    <button type="button" class="btn-sm" onclick="state.settingsDraft.howItWorks = DEFAULT_HOW_IT_WORKS.map(s => ({ ...s })); render();">Reset steps to default</button>
    <div class="field" style="margin-top:14px;">
      <label for="design-terms">Custom design terms</label>
      <div class="field-help">Shown when a customer approves a quote that includes a custom design; they must tick "I agree" first. Each quote keeps the wording it was sent with.</div>
      <textarea id="design-terms" rows="10" maxlength="4000" oninput="state.settingsDraft.designTerms = this.value">${esc(d.designTerms || DEFAULT_DESIGN_TERMS)}</textarea>
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
      filType: it.filType, color: it.color, colorId: it.colorId, specialColor: it.specialColor,
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
    <button type="button" class="btn-sm" onclick="orderAgain('${esc(b.id)}')">Order again</button>
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

// ── LEFTOVER ROLL BALANCES (customer) ─────────────────────────────────────
function customerRolls() {
  const email = colorKey(state.historyEmail);
  const now = new Date();
  return leftoverRolls(state.batches, '', currentRules()).filter(r => r.email === email && r.left > 0 && new Date(r.expiresAt) > now)
    .sort((a, b) => byName({ name: a.color }, { name: b.color }));
}

function renderRollsCard() {
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
    if (p.colorId && !['special_order', 'leftover'].includes(p.filType)) used[p.colorId] = (used[p.colorId] || 0) + partGrams(it);
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

function renderOwnerFilamentPage() {
  const colors = state.settings.colors;
  return `
    <div class="owner-page-header">
      <div class="section-header">
        <div class="section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg></div>
        <div><h2 class="section-title">Filament</h2><div class="section-sub">How much of each color you have. Grams come off when an order moves to Printing.</div></div>
      </div>
    </div>
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
      </div>` : `<div class="field-help">Add your colors in Site Settings first.</div>`}
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
    if (!['special_order', 'leftover'].includes(p.filType)) cost += partGrams(it) * perGram;
  }));
  return cost;
}

function moneyReport(year) {
  const months = MONTH_NAMES.map(name => ({ name, sales: 0, material: 0, expenses: 0, orders: 0 }));
  const orders = [];
  state.batches.forEach(b => {
    if (b.paymentStatus !== 'payment_recieved') return;
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
  const unpaid = state.batches.filter(b => ['order_received', 'production', 'delivered'].includes(b.phase) && b.paymentStatus !== 'payment_recieved');
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
