// ─── CONFIG ────────────────────────────────────────────────────────────────
// Product direction note:
// Build changes as if SoloPrint may be sold to other small 3D print businesses.
// Prefer configurable settings, reusable wording, and owner-agnostic behavior
// over hardcoded assumptions tied to a single seller whenever practical.
const OWNER_EMAIL     = 'jeffsolo49@gmail.com';
const MAX_ITEMS       = 10;
const SUPA_URL        = 'https://xpssamjjyarajtwtrwqx.supabase.co';
const SUPA_KEY        = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhwc3NhbWpqeWFyYWp0d3Ryd3F4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMjIxNjMsImV4cCI6MjA5MDc5ODE2M30.nGzAlBtFxdGHLSMThRGTgGH4-0ijpStMSDy2UDApyaM';

// Filament pricing
// Special orders pay for a whole roll instead of per gram, so their material rate is 0.
const FIL_RATE = { black: 0.024, white: 0.024, color: 0.024, special: 0.034, special_order: 0, leftover: 0 };
const FIL_LABEL = { black: 'Black', white: 'White', color: 'Color', special: 'Special Request', special_order: 'Special order (own roll)' };
const AUSTIN_TIMEZONE = 'America/Chicago';
const MODEL_LIBRARY_KEY = 'soloprint_model_library_v1';
const CLIENT_HISTORY_EMAIL_KEY = 'soloprint_client_history_email_v1';
const OWNER_SESSION_KEY = 'soloprint_owner_session_v1';
const OWNER_SESSION_MS = 60 * 60 * 1000;
// Name of the customer tab that shows finished work with prices.
const GALLERY_NAME = 'Previous Design Work';
// Your Venmo username without the @ (e.g. 'Jeff-Solo'). The "Pay with Venmo" button stays hidden while this is blank.
const VENMO_USERNAME = 'Jeffrey-Sol-3';
// Link-preview service used to pull a model's image and title (model sites block direct browser fetches).
const PREVIEW_API = 'https://api.microlink.io/?url=';
// The SoloPrint Google Apps Script (email/Code.gs) also looks up print time and grams for MakerWorld links.
const LOOKUP_API = 'https://script.google.com/macros/s/AKfycbxiOXN2535JUBDF_-Jvr7wF-X2rE5U34_BrC66Y8vEG5pFpokhBFImoHHQQZtJc3wGWIA/exec';
const NOTIF_READ_KEY = 'soloprint_notif_read_v1';
const NOTIF_ALERTED_KEY = 'soloprint_notif_alerted_v1';
const NOTIF_PREFS_KEY = 'soloprint_notif_prefs_v1';
const ORDER_PHASES = [
  { id: 'estimate', label: 'Reviewing' },
  { id: 'quote_sent', label: 'Quote Ready' },
  { id: 'order_received', label: 'Confirmed' },
  { id: 'production', label: 'Printing' },
  { id: 'delivered', label: 'Delivered' }
];
const PAYMENT_PHASES = [
  { id: 'unpaid', label: 'Unpaid' },
  { id: 'payment_requested', label: 'Payment Requested' },
  { id: 'payment_recieved', label: 'Payment Recieved' }
];
// ──────────────────────────────────────────────────────────────────────────

function blankOwnerCalculator() {
  return {
    link: '',
    name: '',
    hours: '',
    minutes: '',
    grams: '',
    qty: 1,
    filType: 'black',
    lastResult: null
  };
}

let state = {
  view: 'client', ownerUnlocked: false,
  batches: [], clientTab: 'submit', ownerTab: 'dashboard',
  gallery: [], galleryLoaded: false, galleryError: false, galleryForm: null, galleryOpen: '',
  draftItems: [blankItem()],
  clientName: '', clientEmail: '', historyEmail: '',
  modelLibrary: {}, libraryEditingKey: '', analyticsQuery: '', ownerCalculator: blankOwnerCalculator(),
  synced: false, loading: true
};

let libraryAutoSaveTimer = null;
let librarySaveState = 'saved';

function blankItem() {
  return {
    link: '', name: '', grams: null, filType: 'black', qty: 1, notes: '', fetching: false,
    printHours: '', printMinutes: '',
    knownMinutes: null, knownFromLibrary: false, knownPrompted: false,
    previewImage: '', previewLoading: false, estimateSource: '', estimateNote: '',
    imageLinks: [], mode: '', color: '', colorId: '', specialColor: '', useLeftover: false, leftoverFrom: '', extraColors: [], showTime: false
  };
}

// ── SUPABASE ──────────────────────────────────────────────────────────────
// Owner requests carry the signed-in owner's token; everyone else uses the public key,
// which the database rules (supabase/security.sql) limit to the customer RPCs.
async function supaFetch(path, opts = {}) {
  const ownerToken = state.ownerUnlocked ? getOwnerToken() : '';
  const res = await fetch(`${SUPA_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${ownerToken || SUPA_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...(opts.headers || {})
    }
  });
  if (res.status === 401 && ownerToken) {
    clearOwnerSession();
    state.ownerUnlocked = false;
    render();
  }
  if (!res.ok) throw new Error(`Supabase error ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// The owner dashboard loads open orders plus the last 90 days; Sales Data and "Load all" fetch everything.
const RECENT_ORDER_DAYS = 90;
function ownerJobsQuery() {
  if (state.ownerHistoryAll) return '/jobs?order=created_at.asc';
  const since = new Date(Date.now() - RECENT_ORDER_DAYS * 864e5).toISOString();
  return `/jobs?or=(data->>phase.is.null,data->>phase.neq.delivered,created_at.gte.${encodeURIComponent(since)})&order=created_at.asc`;
}

async function loadAllOrders() {
  state.ownerHistoryAll = true;
  await loadBatches();
  render();
}

async function loadBatches(filterEmail = '') {
  try {
    const email = String(filterEmail || '').trim().toLowerCase();
    const rows = email
      ? (await supaFetch('/rpc/customer_jobs', { method: 'POST', body: JSON.stringify({ email }) }) || []).map(data => ({ data }))
      : await supaFetch(ownerJobsQuery());
    state.batches = (rows || []).map(r => normalizeBatch(r && r.data)).filter(Boolean);
    state.synced = true;
  } catch(e) {
    console.error('Load error:', e);
    state.synced = false;
  }
}

async function upsertBatch(batch) {
  try {
    const normalized = normalizeBatch(batch);
    await supaFetch('/jobs', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ id: normalized.id, data: normalized })
    });
    return true;
  } catch(e) {
    console.error('Upsert error:', e);
    alert("Couldn't save this change to the database. If you were logged out, log in again and retry.");
    return false;
  }
}

// Customers can only create new requests; returns false if the save failed.
async function submitBatchRemote(batch) {
  try {
    await supaFetch('/rpc/submit_job', { method: 'POST', body: JSON.stringify({ job: normalizeBatch(batch) }) });
    return true;
  } catch (e) {
    console.error('Submit error:', e);
    return false;
  }
}

async function deleteBatchRemote(id) {
  try { await supaFetch(`/jobs?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch(e) { console.error(e); }
}


// ── PRICING ───────────────────────────────────────────────────────────────
// Color name when the customer picked one of the owner's colors, otherwise Black / White / Special Request.
function filamentLabel(it) {
  const extras = (it && Array.isArray(it.extraColors) ? it.extraColors : [])
    .map(p => ` + ${p.name}${p.filType === 'leftover' ? ' (leftover roll)' : p.filType === 'special' ? ' (special)' : ''}`).join('');
  if (it && it.color) return (it.filType === 'special' ? `${it.color} (special)` : it.color) + extras;
  if (it && it.filType === 'special_order') return `Special order: ${it.specialColor || 'color/material not given'}${it.useLeftover ? ' (from their leftover roll)' : ''}${extras}`;
  return (FIL_LABEL[it && it.filType] || 'Black') + extras;
}

// Pass an item to price all of its colors, or a filament type for a single-color price.
function calcPerPrint(mins, grams, filType) {
  if (!mins || !grams) return null;
  const rate = filType && typeof filType === 'object' ? itemRate(filType) : (FIL_RATE[filType] ?? 0.024);
  return 2 + mins * 0.024 + grams * rate;
}

// Every color in a print: the main one plus any extra colors. Leftover-roll colors are filType 'leftover'.
function itemParts(it) {
  const main = it.filType === 'special_order'
    ? { name: it.specialColor || '', filType: it.useLeftover ? 'leftover' : 'special_order', leftoverFrom: it.useLeftover ? it.leftoverFrom : '' }
    : { name: it.color || FIL_LABEL[it.filType] || 'Black', filType: it.filType, colorId: it.colorId };
  return [main, ...(Array.isArray(it.extraColors) ? it.extraColors : [])];
}
// Multi-color prints split the grams evenly between their colors for pricing.
function itemRate(it) {
  const parts = itemParts(it);
  return parts.reduce((s, p) => s + (FIL_RATE[p.filType] ?? 0.024), 0) / parts.length;
}
function byName(a, b) {
  return String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base', numeric: true });
}
function calcTotal(mins, grams, filType, qty) {
  const pp = calcPerPrint(mins, grams, filType);
  return pp !== null ? pp * qty : null;
}
function fmtTime(m) {
  const h = Math.floor(m / 60), mm = Math.round(m % 60);
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}
function fmtMinutesWithHours(m) {
  if (!m && m !== 0) return '';
  const mins = Number(m);
  if (!Number.isFinite(mins)) return '';
  return `${mins} min (${fmtTime(mins)})`;
}
function hoursFromMinutes(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return '';
  return String(Math.floor(Math.round(value) / 60));
}
function minuteRemainder(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return '';
  return String(Math.round(value) % 60);
}
function minutesFromHours(hours) {
  const value = Number(hours);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 60) : null;
}
function totalPrintMinutes(hours, minutes) {
  const hourValue = Number(hours) || 0;
  const minuteValue = Number(minutes) || 0;
  const total = Math.round(hourValue * 60 + minuteValue);
  return total > 0 ? total : null;
}
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function phaseLabel(phaseId) {
  return (ORDER_PHASES.find(p => p.id === phaseId) || ORDER_PHASES[0]).label;
}

function phaseIndex(phaseId) {
  return ORDER_PHASES.findIndex(p => p.id === phaseId);
}

// Customer-facing wording for the order tracker on "My Requests".
const TRACKER_STEPS = {
  estimate:       { label: 'Request Received', detail: "We've received your request and will respond promptly after reviewing it. Any prices shown are automated estimates, not final costs." },
  quote_sent:     { label: 'Quote Ready',      detail: "Your quote is ready. Review the price below and tap \"Looks good\" if you'd like to go ahead." },
  order_received: { label: 'Order Confirmed',  detail: "Your order is confirmed and queued for the printer." },
  production:     { label: 'Printing',         detail: 'Your parts are on the printer right now.' },
  delivered:      { label: 'Delivered',        detail: 'Your order is complete. Enjoy!' }
};

function stampPhase(batch, phase) {
  batch.phaseHistory = { ...(batch.phaseHistory || {}) };
  if (!batch.phaseHistory[phase]) batch.phaseHistory[phase] = new Date().toISOString();
}

function itemsSubtotal(batch) {
  return batch.items.reduce((s, it) => s + (calcTotal(it.minutes, it.grams, it, it.qty) || 0), 0);
}

// Cost of the 1 kg roll for special orders; defaults to the typical amount (or 0 when every special
// item uses the customer's leftover roll) until the owner sets it.
function specialOrderCost(batch) {
  if (!batch.items.some(usesRolls)) return 0;
  if (Number.isFinite(batch.specialOrderCost)) return batch.specialOrderCost;
  return batch.items.some(usesSpecialSpool) ? SPECIAL_ORDER_TYPICAL : 0;
}

function orderSum(batch) {
  return itemsSubtotal(batch) + specialOrderCost(batch);
}

function batchTotal(batch) {
  if (!isBatchQuoteReady(batch)) return null;
  return orderSum(batch);
}

function venmoPayUrl(batch, total) {
  const note = `SoloPrint order ${batch.id}: ${orderTitle(batch)}`.slice(0, 140);
  return `https://venmo.com/${encodeURIComponent(VENMO_USERNAME)}?txn=pay&amount=${total.toFixed(2)}&note=${encodeURIComponent(note)}`;
}

// Next step the customer can take on an order: approve the quote, then pay once the owner confirms.
function renderCustomerOrderAction(batch) {
  const phase = batch.phase || 'estimate';
  const total = batchTotal(batch);
  if (phase === 'quote_sent') {
    if (batch.customerApprovedAt) {
      return `<div class="order-action"><strong>Thanks!</strong> We got your go-ahead and will confirm your order soon.</div>`;
    }
    return `<div class="order-action">
      <button class="btn-primary" id="customer-approve-${esc(batch.id)}" type="button" onclick="customerApproveQuote('${esc(batch.id)}')">Looks good, I'd like to order</button>
      <div class="order-action-sub">Nothing is charged yet. We'll confirm we can make your order before asking for payment.</div>
    </div>`;
  }
  if (phaseIndex(phase) >= phaseIndex('order_received')) {
    if (batch.paymentStatus === 'payment_recieved') {
      return `<div class="order-action"><strong>Payment received.</strong> Thank you!</div>`;
    }
    if (VENMO_USERNAME && total) {
      return `<div class="order-action">
        <a class="btn-venmo" href="${esc(venmoPayUrl(batch, total))}" target="_blank" rel="noopener noreferrer">Pay $${total.toFixed(2)} with Venmo</a>
        <div class="order-action-sub">Opens Venmo with the amount and order note filled in. We'll mark your payment received once it comes through.</div>
      </div>`;
    }
  }
  return '';
}

async function customerApproveQuote(batchId) {
  const btn = document.getElementById(`customer-approve-${batchId}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
  await loadBatches(state.historyEmail);
  const b = state.batches.find(x => x.id === batchId);
  if (b && b.phase === 'quote_sent' && !b.customerApprovedAt) {
    try {
      await supaFetch('/rpc/customer_approve_quote', { method: 'POST', body: JSON.stringify({ job_id: b.id, email: state.historyEmail }) });
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = "Looks good, I'd like to order"; }
      alert("We couldn't send your approval. Please try again in a moment.");
      return;
    }
    b.customerApprovedAt = new Date().toISOString();
  }
  render();
}

function renderOrderTracker(batch) {
  const phase = batch.phase || 'estimate';
  const currentIdx = Math.max(0, phaseIndex(phase));
  const history = batch.phaseHistory || {};
  const shortTime = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const steps = ORDER_PHASES.map((p, idx) => {
    const cls = idx < currentIdx || phase === 'delivered' ? 'done' : idx === currentIdx ? 'current' : '';
    const at = history[p.id] || (p.id === 'estimate' ? batch.createdAt : null);
    return `<div class="tracker-step ${cls}">
      <div class="tracker-dot">${cls === 'done' ? '✓' : idx + 1}</div>
      <div class="tracker-label">${TRACKER_STEPS[p.id].label}</div>
      <div class="tracker-time">${cls && at ? shortTime(at) : ''}</div>
    </div>`;
  }).join('');
  const deliveryInfo = [
    batch.deliveryDate && `Delivery: ${esc(batch.deliveryDate)}`,
    batch.deliveryTracking && `Tracking: ${esc(batch.deliveryTracking)}`
  ].filter(Boolean).join(' · ');
  return `<div class="tracker">${steps}</div>
    <div class="tracker-status"><strong>${TRACKER_STEPS[phase].label}:</strong> ${TRACKER_STEPS[phase].detail}${deliveryInfo ? `<div style="font-size:12px;color:var(--muted);margin-top:4px;">${deliveryInfo}</div>` : ''}</div>
    ${renderCustomerOrderAction(batch)}`;
}

function canAdvanceToPhase(currentPhase, nextPhase) {
  const currentIdx = phaseIndex(currentPhase || 'estimate');
  const nextIdx = phaseIndex(nextPhase || 'estimate');
  if (currentIdx < 0 || nextIdx < 0) return false;
  // Enforce sequential flow: stay on current phase or move exactly one step forward.
  return nextIdx === currentIdx || nextIdx === currentIdx + 1;
}

function paymentLabel(paymentStatus) {
  return (PAYMENT_PHASES.find(p => p.id === paymentStatus) || PAYMENT_PHASES[0]).label;
}

function paymentIndex(paymentStatus) {
  return PAYMENT_PHASES.findIndex(p => p.id === (paymentStatus || 'unpaid'));
}

function canAdvancePayment(currentStatus, nextStatus) {
  const currentIdx = paymentIndex(currentStatus);
  const nextIdx = paymentIndex(nextStatus);
  if (currentIdx < 0 || nextIdx < 0) return false;
  // Enforce sequential flow: stay on current status or move exactly one step forward.
  return nextIdx === currentIdx || nextIdx === currentIdx + 1;
}

function isBatchQuoteReady(batch) {
  return !!(batch && Array.isArray(batch.items) && batch.items.length && batch.items.every(it => it.minutes && it.grams));
}

// Orders come from a shared database, so coerce every field to the shape the UI
// expects before anything renders it (ids and filament types end up in HTML attributes).
function cleanText(value, max = 2000) {
  return typeof value === 'string' ? value.slice(0, max) : (typeof value === 'number' ? String(value) : '');
}
function cleanNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function cleanIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : '';
}
function cleanFilType(value) {
  return Object.prototype.hasOwnProperty.call(FIL_LABEL, value) ? value : 'black';
}
function cleanImageLinks(list) {
  return (Array.isArray(list) ? list : []).map(u => safeImageUrl(cleanText(u, 500))).filter(Boolean).slice(0, 5);
}
function parseImageLinks(text) {
  return cleanImageLinks([...new Set(String(text || '').split(/[\s,]+/))]);
}

// Thumbnails for customer photo links; falls back to a text link when the URL isn't a direct image.
function renderPhotoLinks(links) {
  const list = cleanImageLinks(links);
  if (!list.length) return '';
  return `<div class="photo-links">${list.map((u, n) => `
    <a class="photo-link" href="${esc(u)}" target="_blank" rel="noopener noreferrer" title="Open photo ${n + 1}">
      <img src="${esc(u)}" alt="Photo ${n + 1}" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('broken')" /><span>Photo ${n + 1} ↗</span>
    </a>`).join('')}</div>`;
}

function updateImageLinks(i, text) {
  if (!state.draftItems[i]) return;
  state.draftItems[i].imageLinks = parseImageLinks(text);
  const el = document.getElementById(`photo-previews-${i}`);
  if (el) el.innerHTML = renderPhotoLinks(state.draftItems[i].imageLinks);
}

function cleanItem(it) {
  it = it && typeof it === 'object' ? it : {};
  return {
    ...blankItem(),
    link: cleanText(it.link, 500),
    name: cleanText(it.name, 200),
    notes: cleanText(it.notes),
    // Special orders saved by the first version used 'special' with a typed color and no stocked color.
    filType: it.filType === 'special' && !it.colorId && it.specialColor ? 'special_order' : cleanFilType(it.filType),
    qty: Math.max(1, Math.min(999, parseInt(it.qty, 10) || 1)),
    minutes: cleanNumber(it.minutes),
    grams: cleanNumber(it.grams),
    printHours: cleanText(it.printHours, 10),
    printMinutes: cleanText(it.printMinutes, 10),
    knownMinutes: cleanNumber(it.knownMinutes),
    knownFromLibrary: it.knownFromLibrary === true,
    previewImage: safeImageUrl(it.previewImage),
    estimateSource: cleanText(it.estimateSource, 200),
    imageLinks: cleanImageLinks(it.imageLinks),
    mode: ['link', 'idea', 'gallery'].includes(it.mode) ? it.mode : '',
    color: cleanText(it.color, 40),
    colorId: /^[a-z0-9-]{1,40}$/.test(String(it.colorId)) ? it.colorId : '',
    specialColor: cleanText(it.specialColor, 60),
    useLeftover: it.useLeftover === true,
    leftoverFrom: /^[A-Za-z0-9_-]{1,64}$/.test(String(it.leftoverFrom)) ? it.leftoverFrom : '',
    extraColors: (Array.isArray(it.extraColors) ? it.extraColors : []).slice(0, 8).map(p => ({
      name: cleanText(p && p.name, 60).trim(),
      filType: ['black', 'white', 'color', 'special', 'leftover'].includes(p && p.filType) ? p.filType : 'color',
      colorId: /^[a-z0-9-]{1,40}$/.test(String(p && p.colorId)) ? p.colorId : '',
      leftoverFrom: /^[A-Za-z0-9_-]{1,64}$/.test(String(p && p.leftoverFrom)) ? p.leftoverFrom : ''
    })).filter(p => p.name)
  };
}

function normalizeBatch(batch) {
  if (!batch || typeof batch !== 'object') return null;
  const id = String(batch.id ?? '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  const phaseHistory = {};
  if (batch.phaseHistory && typeof batch.phaseHistory === 'object') {
    ORDER_PHASES.forEach(p => { const at = cleanIso(batch.phaseHistory[p.id]); if (at) phaseHistory[p.id] = at; });
  }
  batch = {
    ...batch,
    id,
    clientName: cleanText(batch.clientName, 120),
    clientEmail: cleanText(batch.clientEmail, 200),
    createdAt: cleanIso(batch.createdAt) || new Date(0).toISOString(),
    customerApprovedAt: cleanIso(batch.customerApprovedAt),
    deliveryNotes: cleanText(batch.deliveryNotes),
    deliveryTracking: cleanText(batch.deliveryTracking, 200),
    deliveryDate: cleanText(batch.deliveryDate, 100),
    specialOrderCost: Number.isFinite(Number(batch.specialOrderCost)) && batch.specialOrderCost !== null && batch.specialOrderCost !== '' && Number(batch.specialOrderCost) >= 0
      ? Math.min(Number(batch.specialOrderCost), 1000) : null,
    items: Array.isArray(batch.items) ? batch.items.slice(0, 50).map(cleanItem) : [],
    phaseHistory
  };
  const legacyStatus = batch.status;
  let phase = batch.phase;
  let paymentStatus = batch.paymentStatus;
  if (!phase) {
    phase = legacyStatus === 'quoted' ? 'quote_sent' : 'estimate';
  }
  if (!ORDER_PHASES.find(p => p.id === phase)) phase = 'estimate';
  if (paymentStatus === 'partial' || paymentStatus === 'paid') paymentStatus = 'payment_recieved';
  if (!PAYMENT_PHASES.find(p => p.id === paymentStatus)) paymentStatus = 'unpaid';
  return {
    ...batch,
    phase,
    paymentStatus
  };
}

function orderTitle(batch) {
  if (!batch || !Array.isArray(batch.items) || !batch.items.length) return 'Untitled request';
  return batch.items.map(it => it.name || 'Unnamed').join(', ');
}

function normalizeModelKey(value) {
  return String(value || '').trim().toLowerCase();
}

function isOriginalDesignText(value) {
  const s = normalizeModelKey(value);
  return !!s && /(original\s*design|custom\s*design|my\s*design|own\s*design|designed\s*by\s*me|self\s*designed)/i.test(s);
}

function isSupportedModelLink(value) {
  const s = normalizeModelKey(value);
  return !!s && /(makerworld\.com|thingiverse\.com|printables\.com)/i.test(s);
}

function isDirectModelReference(value) {
  return isSupportedModelLink(value) || isOriginalDesignText(value);
}

function isWebUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function titleCaseWords(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function modelKeyFromItem(item) {
  const linkKey = normalizeModelKey(item.link);
  if (isSupportedModelLink(linkKey)) return `link:${linkKey}`;
  const nameKey = normalizeModelKey(item.name);
  return nameKey ? `name:${nameKey}` : '';
}

function loadModelLibrary() {
  try {
    const raw = localStorage.getItem(MODEL_LIBRARY_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    state.modelLibrary = parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    state.modelLibrary = {};
  }
}

// Saved Models live in Supabase (model_library table, supabase/library-and-backups.sql) so every device
// and every customer's browser sees them. localStorage is a cache and a fallback if Supabase is unreachable.
const LIBRARY_MIGRATED_KEY = 'soloprint_model_library_uploaded_v1';
let libraryRemote = null;      // key -> JSON of each entry as last seen in Supabase; null until loaded
let librarySyncTimer = null;

function persistModelLibrary() {
  try { localStorage.setItem(MODEL_LIBRARY_KEY, JSON.stringify(state.modelLibrary)); } catch (e) {}
  if (state.ownerUnlocked && libraryRemote) {
    clearTimeout(librarySyncTimer);
    librarySyncTimer = setTimeout(syncModelLibrary, 600);
  }
}

function cleanLibraryEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const minutes = cleanNumber(e.minutes), grams = cleanNumber(e.grams);
  if (!minutes || !grams) return null;
  return { link: cleanText(e.link, 500), name: cleanText(e.name, 200), minutes, grams, filType: cleanFilType(e.filType), updatedAt: cleanIso(e.updatedAt) };
}

async function loadRemoteLibrary() {
  let rows;
  try {
    rows = await supaFetch('/model_library?select=key,data');
  } catch (e) {
    return; // table not set up yet or offline: keep the local copy
  }
  const remote = {};
  (rows || []).forEach(r => {
    const entry = cleanLibraryEntry(r && r.data);
    if (entry && typeof r.key === 'string' && r.key.length <= 600) remote[r.key] = entry;
  });
  libraryRemote = Object.fromEntries(Object.entries(remote).map(([k, v]) => [k, JSON.stringify(v)]));
  let migrated = false;
  try { migrated = localStorage.getItem(LIBRARY_MIGRATED_KEY) === '1'; } catch (e) {}
  if (state.ownerUnlocked && !migrated) {
    // First time on this device: upload anything only saved in this browser, keeping the newer copy of each.
    Object.entries(state.modelLibrary || {}).forEach(([k, v]) => {
      const local = cleanLibraryEntry(v);
      if (local && (!remote[k] || (local.updatedAt || '') > (remote[k].updatedAt || ''))) remote[k] = local;
    });
    state.modelLibrary = remote;
    persistModelLibrary();
    await syncModelLibrary();
    try { localStorage.setItem(LIBRARY_MIGRATED_KEY, '1'); } catch (e) {}
  } else {
    state.modelLibrary = remote;
    try { localStorage.setItem(MODEL_LIBRARY_KEY, JSON.stringify(remote)); } catch (e) {}
  }
}

// Push the owner's changes: upsert entries that differ from Supabase, delete ones that were removed.
async function syncModelLibrary() {
  if (!state.ownerUnlocked || !libraryRemote) return;
  const upserts = [];
  Object.entries(state.modelLibrary || {}).forEach(([key, v]) => {
    const entry = cleanLibraryEntry(v);
    if (entry && libraryRemote[key] !== JSON.stringify(entry)) upserts.push({ key, data: entry });
  });
  const deletes = Object.keys(libraryRemote).filter(k => !state.modelLibrary[k]);
  try {
    if (upserts.length) {
      await supaFetch('/model_library', { method: 'POST', headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(upserts) });
      upserts.forEach(u => { libraryRemote[u.key] = JSON.stringify(u.data); });
    }
    for (const key of deletes) {
      await supaFetch(`/model_library?key=eq.${encodeURIComponent(key)}`, { method: 'DELETE' });
      delete libraryRemote[key];
    }
  } catch (e) {
    console.error('Saved model sync error:', e);
  }
}

function loadClientHistoryEmail() {
  try {
    state.historyEmail = localStorage.getItem(CLIENT_HISTORY_EMAIL_KEY) || '';
  } catch (e) {
    state.historyEmail = '';
  }
}

function persistClientHistoryEmail() {
  try {
    localStorage.setItem(CLIENT_HISTORY_EMAIL_KEY, state.historyEmail || '');
  } catch (e) {}
}

function persistOwnerSession(session) {
  const expiresInMs = Math.min(OWNER_SESSION_MS, (Number(session.expires_in) || 3600) * 1000);
  ownerSession = { token: session.access_token, expiresAt: Date.now() + expiresInMs };
  try {
    localStorage.setItem(OWNER_SESSION_KEY, JSON.stringify(ownerSession));
  } catch (e) {}
}

let ownerSession = null;
function getOwnerToken() {
  return ownerSession && ownerSession.expiresAt > Date.now() ? ownerSession.token : '';
}

function clearOwnerSession() {
  ownerSession = null;
  try { localStorage.removeItem(OWNER_SESSION_KEY); } catch (e) {}
}

function hasValidOwnerSession() {
  try {
    const raw = localStorage.getItem(OWNER_SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const valid = !!(parsed && typeof parsed.token === 'string' && Number(parsed.expiresAt) > Date.now());
    if (!valid) { clearOwnerSession(); return false; }
    ownerSession = { token: parsed.token, expiresAt: Number(parsed.expiresAt) };
    return true;
  } catch (e) {
    clearOwnerSession();
    return false;
  }
}

function getKnownEstimate(item) {
  if (!item) return null;
  const linkKey = normalizeModelKey(item.link);
  if (linkKey && linkKey.includes('makerworld.com')) {
    const linkMatch = state.modelLibrary[`link:${linkKey}`];
    if (linkMatch) return linkMatch;
  }
  const nameKey = normalizeModelKey(item.name);
  if (nameKey) {
    const nameMatch = state.modelLibrary[`name:${nameKey}`];
    if (nameMatch) return nameMatch;
  }
  const key = modelKeyFromItem(item);
  return key ? (state.modelLibrary[key] || null) : null;
}

function saveKnownEstimate(item) {
  const key = modelKeyFromItem(item);
  if (!key || !item.minutes || !item.grams) return;
  state.modelLibrary[key] = {
    name: item.name || '',
    link: item.link || '',
    minutes: item.minutes,
    grams: item.grams,
    filType: item.filType || 'black',
    updatedAt: new Date().toISOString()
  };
  persistModelLibrary();
}

function saveModelLibraryEntry(entry) {
  const link = String(entry?.link || '').trim();
  const name = String(entry?.name || '').trim();
  const minutes = parseFloat(entry?.minutes);
  const grams = parseFloat(entry?.grams);
  const filType = cleanFilType(entry?.filType);

  const key = modelKeyFromItem({ link, name });
  if (!key) return { ok: false, error: 'Please enter a model link or model name.' };
  if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(grams) || grams <= 0) {
    return { ok: false, error: 'Please enter valid minutes and grams.' };
  }

  state.modelLibrary[key] = {
    link,
    name,
    minutes,
    grams,
    filType,
    updatedAt: new Date().toISOString()
  };
  persistModelLibrary();
  return { ok: true, key, entry: state.modelLibrary[key] };
}

function sortedLibraryEntries() {
  return Object.entries(state.modelLibrary || {})
    .sort((a, b) => {
      const aName = String(a[1]?.name || a[1]?.link || a[0] || '').toLowerCase();
      const bName = String(b[1]?.name || b[1]?.link || b[0] || '').toLowerCase();
      return aName.localeCompare(bName, 'en', { sensitivity: 'base' });
    });
}

function isSoldPhase(phase) {
  return ['order_received', 'production', 'delivered'].includes(phase || '');
}

function buildModelAnalyticsRows() {
  const rowsByKey = {};

  Object.entries(state.modelLibrary || {}).forEach(([key, entry]) => {
    rowsByKey[key] = {
      key,
      modelName: entry?.name || '',
      modelLink: entry?.link || '',
      quoteRequests: 0,
      quantityOrdered: 0,
      moneySold: 0,
      differentCustomers: new Set()
    };
  });

  (state.batches || []).forEach(batch => {
    (batch.items || []).forEach(item => {
      const key = modelKeyFromItem(item) || `fallback:${normalizeModelKey(item.name || item.link || '')}`;
      if (!rowsByKey[key]) {
        rowsByKey[key] = {
          key,
          modelName: item.name || '',
          modelLink: item.link || '',
          quoteRequests: 0,
          quantityOrdered: 0,
          moneySold: 0,
          differentCustomers: new Set()
        };
      }

      const row = rowsByKey[key];
      if (!row.modelName && item.name) row.modelName = item.name;
      if (!row.modelLink && item.link) row.modelLink = item.link;

      row.quoteRequests += 1;
      if (batch.clientEmail) row.differentCustomers.add(String(batch.clientEmail).toLowerCase());

      if (isSoldPhase(batch.phase)) {
        row.quantityOrdered += Number(item.qty) || 0;
        const total = calcTotal(item.minutes, item.grams, item, item.qty);
        if (total !== null) row.moneySold += total;
      }
    });
  });

  return Object.values(rowsByKey)
    .map(row => ({ ...row, differentCustomers: row.differentCustomers.size }))
    .sort((a, b) =>
      String(a.modelName || a.modelLink || a.key).localeCompare(
        String(b.modelName || b.modelLink || b.key),
        'en',
        { sensitivity: 'base' }
      )
    );
}

function filteredModelAnalyticsRows() {
  const query = String(state.analyticsQuery || '').trim().toLowerCase();
  const rows = buildModelAnalyticsRows();
  if (!query) return rows;
  return rows.filter(row =>
    String(row.modelName || '').toLowerCase().includes(query) ||
    String(row.modelLink || '').toLowerCase().includes(query)
  );
}

function exportModelAnalyticsCSV() {
  const rows = filteredModelAnalyticsRows();
  const escCsv = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['Model Name', 'Model', 'Quote Requests', 'Orders', 'Money Sold', 'Customers'];
  const csv = [
    header.join(','),
    ...rows.map(row => [
      escCsv(row.modelName),
      escCsv(row.modelLink),
      row.quoteRequests,
      row.quantityOrdered,
      row.moneySold.toFixed(2),
      row.differentCustomers
    ].join(','))
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'soloprint-model-analytics.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function normLibHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function parseCSVText(text) {
  let t = String(text || '');
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  const lines = t.split(/\r?\n/).filter(l => l.length);
  return lines.map(parseCSVLine);
}

function findLibColumnIndex(headers, patterns) {
  const nh = headers.map(normLibHeader);
  for (const pat of patterns) {
    const p = normLibHeader(pat);
    if (!p) continue;
    for (let i = 0; i < nh.length; i++) {
      if (nh[i] === p) return i;
    }
  }
  for (const pat of patterns) {
    const p = normLibHeader(pat);
    if (!p || p.length < 2) continue;
    for (let i = 0; i < nh.length; i++) {
      if (nh[i].includes(p)) return i;
    }
  }
  return -1;
}

function resolveFilamentFromImport(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return 'black';
  if (s.includes('special') || s === 's') return 'special';
  if (s.includes('white') || s === 'w') return 'white';
  if (s.includes('black') || s === 'b') return 'black';
  return 'black';
}

function importRowsIntoLibrary(rows) {
  const errors = [];
  if (!rows || rows.length < 2) {
    return { imported: 0, skipped: 0, errors: ['Need a header row and at least one data row.'] };
  }
  const headers = rows[0].map(c => String(c || ''));
  const li = findLibColumnIndex(headers, ['model link', 'makerworld link', 'url', 'link', 'makerworld']);
  const ni = findLibColumnIndex(headers, ['model name', 'name', 'title']);
  const mi = findLibColumnIndex(headers, ['minutes', 'min', 'print time (min)', 'print time', 'time (min)']);
  const gi = findLibColumnIndex(headers, ['grams', 'gram', 'weight', 'filament g', 'filament (g)', 'est grams', 'est. grams', 'g']);
  const fi = findLibColumnIndex(headers, ['filament type', 'fil type', 'material']);

  if (li < 0 && ni < 0) {
    return { imported: 0, skipped: 0, errors: ['Missing a Model Link or Model Name column.'] };
  }
  if (mi < 0 || gi < 0) {
    return { imported: 0, skipped: 0, errors: ['Missing Minutes and/or Grams columns.'] };
  }

  let imported = 0;
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.length) { skipped++; continue; }
    const link = li >= 0 ? String(row[li] ?? '').trim() : '';
    const name = ni >= 0 ? String(row[ni] ?? '').trim() : '';
    const minutes = parseFloat(String(row[mi] ?? '').replace(/,/g, '').trim());
    const grams = parseFloat(String(row[gi] ?? '').replace(/,/g, '').trim());
    const filRaw = fi >= 0 ? row[fi] : '';
    const filType = resolveFilamentFromImport(filRaw);

    const key = modelKeyFromItem({ link, name });
    if (!key) {
      skipped++;
      errors.push(`Row ${r + 1}: need a model link or model name.`);
      continue;
    }
    if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(grams) || grams <= 0) {
      skipped++;
      errors.push(`Row ${r + 1}: invalid minutes or grams.`);
      continue;
    }

    state.modelLibrary[key] = {
      link,
      name,
      minutes,
      grams,
      filType,
      updatedAt: new Date().toISOString()
    };
    imported++;
  }
  persistModelLibrary();
  return { imported, skipped, errors };
}

function downloadLibraryTemplate() {
  const csv = 'Model Link,Model Name,Minutes,Grams,Filament Type\n' +
    'https://makerworld.com/en/models/123-example,,120,45.5,black\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'soloprint-model-library-template.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importModelLibrarySpreadsheet(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  if (input) input.value = '';
  if (!file) return;

  const lower = file.name.toLowerCase();
  const reader = new FileReader();
  reader.onerror = () => alert('Could not read that file.');
  reader.onload = (ev) => {
    try {
      let rows;
      if (lower.endsWith('.csv')) {
        rows = parseCSVText(ev.target.result);
      } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        if (typeof XLSX === 'undefined') {
          alert('Excel support did not load. Save as CSV or refresh the page.');
          return;
        }
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      } else {
        alert('Please upload a .csv or .xlsx file.');
        return;
      }

      const res = importRowsIntoLibrary(rows);
      let msg = `Imported ${res.imported} row(s). Skipped ${res.skipped}.`;
      if (res.errors.length) msg += '\n\n' + res.errors.slice(0, 12).join('\n');
      alert(msg);
      render();
    } catch (err) {
      alert('Import failed: ' + (err && err.message ? err.message : err));
    }
  };

  if (lower.endsWith('.csv')) reader.readAsText(file);
  else reader.readAsArrayBuffer(file);
}

function maybeOfferKnownEstimate(i) {
  const draft = state.draftItems[i];
  if (!draft || draft.knownFromLibrary || draft.knownPrompted) return;
  const known = getKnownEstimate(draft);
  if (!known) return;
  draft.knownPrompted = true;
  const accepted = window.confirm('Good news: we have printed this model before, so we can fill in an automated estimate of its print time and filament. This is not a final price; we will review your request and confirm your quote. Use the saved estimate?');
  if (!accepted) return;
  draft.knownFromLibrary = true;
  draft.knownMinutes = known.minutes;
  draft.grams = known.grams;
  if (!draft.name && known.name) draft.name = known.name;
  if (!draft.filType && known.filType) draft.filType = known.filType;
  render();
  showAlert('submit-ok', `Saved estimate filled in for "${draft.name || 'model'}". It's an automated estimate; we'll confirm your quote after reviewing your request.`, 'success');
}

function formatAustinTime(iso) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: AUSTIN_TIMEZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(new Date(iso));
}

/** Last write time of this HTML document (browser). Updates whenever index.html is saved or the server sends a new Last-Modified. */
function getBuildDate() {
  const d = new Date(document.lastModified);
  if (!Number.isFinite(d.getTime()) || d.getTime() === 0) return null;
  return d;
}

/**
 * Auto build id from file mtime (milliseconds). Changes on every save that updates the file timestamp.
 * Same instant as the time shown — both come from document.lastModified.
 */
function formatBuildBadge() {
  const d = getBuildDate();
  if (!d) return '—';
  const buildId = `b${d.getTime()}`;
  const when = `${formatAustinTime(d.toISOString())} CT`;
  return `${buildId} · ${when}`;
}

// ── URL PARSING ───────────────────────────────────────────────────────────
function isNumericOnlySlug(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const seg = parts.find(p => /^\d/.test(p)) || parts[parts.length - 1];
    return /^\d+$/.test(seg);
  } catch(e) { return false; }
}

function nameFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const slug = parts.find(p => /^\d+-[a-z]/i.test(p));
    if (!slug) return null;
    return slug
      .replace(/^\d+-/, '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
  } catch(e) { return null; }
}

async function fetchNameFromServer(url) {
  // Netlify function removed; without a backend proxy, cross-origin fetches can fail.
  // Keep this async helper so existing flows still work and users can manually fill names.
  return null;
}

// ── INIT ──────────────────────────────────────────────────────────────────
async function init() {
  loadModelLibrary();
  loadClientHistoryEmail();
  restoreDraft();
  const linkedOrder = handleRequestsLink();
  state.ownerUnlocked = hasValidOwnerSession();
  handleAuthRedirect();
  await Promise.all([
    loadSettings(),
    loadRemoteLibrary(),
    // The customer view only ever loads the looked-up customer's orders, even on the owner's device.
    state.ownerUnlocked && state.view === 'owner' ? loadBatches() : state.historyEmail ? loadBatches(state.historyEmail) : null
  ]);
  state.loading = false;
  render();
  if (linkedOrder) document.getElementById(`order-${linkedOrder}`)?.scrollIntoView({ block: 'start' });
  loadGallery().then(() => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (state.view === 'client' && !typing) render();
  });
}

// ── RENDER ────────────────────────────────────────────────────────────────
function render() {
  if (state.loading) return;
  document.getElementById('app-root').innerHTML = `
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="header">
      <button class="logo" type="button" onclick="goHome()" aria-label="SoloPrint home">
        <span class="logo-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        </span>
        <span class="logo-text">SOLO<span>PRINT</span></span>
      </button>
      <div class="header-actions">
        <div class="build-badge" title="Last change to this page: build id b… is the file timestamp (ms). Time is Austin (America/Chicago). Resave index.html to refresh.">
          ${formatBuildBadge()}
        </div>
        <span title="${state.synced ? 'Synced' : 'Offline'}"><span class="sync-dot ${state.synced?'':'offline'}"></span></span>
        ${renderNotifBell()}
        ${state.view === 'client'
          ? `<button class="btn-sm" onclick="switchToOwner()">Owner</button>`
          : `<button class="btn-sm" onclick="showClientView()">Client view</button>
             ${state.ownerUnlocked ? `<button class="btn-sm danger" onclick="logoutOwner()">Logout</button>` : ''}`}
      </div>
    </header>
    ${state.view === 'client' ? renderClientApp() : renderOwnerApp()}
  `;
  attachAll();
  if (state.view === 'client' && state.clientTab === 'submit') queueDraftSave();
}

function renderBubble(tab, label, shortLabel, sub, iconPaths, badge = 0) {
  const active = state.clientTab === tab;
  const name = `${label}: ${sub}${badge ? ` (${badge})` : ''}`;
  return `<button class="bubble ${active ? 'active' : ''}" type="button" onclick="setTab('${tab}')" aria-label="${esc(name)}" ${active ? 'aria-current="page"' : ''}>
    <span class="bubble-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${iconPaths}</svg></span>
    <span>
      <span class="bubble-label"><span class="long">${esc(label)}</span><span class="short">${esc(shortLabel)}</span></span>
      <span class="bubble-sub">${esc(sub)}</span>
    </span>
    ${badge ? `<span class="nav-badge">${badge}</span>` : ''}
  </button>`;
}

function renderClientApp() {
  const hasHistoryEmail = !!String(state.historyEmail || '').trim();
  return `
    <nav class="bubble-nav" aria-label="Main">
      ${renderBubble('submit', 'Request a Quote', 'Get a Quote', 'Start a print or custom design',
        '<path d="M12 5v14M5 12h14"/>')}
      ${renderBubble('gallery', GALLERY_NAME, 'Past Work', "See what I've made",
        '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>')}
      ${renderBubble('jobs', 'My Requests', 'My Requests', 'Track your orders',
        '<path d="M9 5h11M9 12h11M9 19h11"/><path d="M4 5h.01M4 12h.01M4 19h.01"/>',
        hasHistoryEmail && state.batches.length ? state.batches.length : 0)}
    </nav>
    <main class="main" id="main" tabindex="-1">
      <h1 class="sr-only">SoloPrint: ${esc(state.clientTab === 'submit' ? 'Request a Quote' : state.clientTab === 'gallery' ? GALLERY_NAME : 'My Requests')}</h1>
      ${state.clientTab === 'submit' ? renderSubmitTab() : state.clientTab === 'gallery' ? renderGalleryTab() : renderMyJobsTab()}
    </main>`;
}

function renderOwnerNav() {
  const libCount = sortedLibraryEntries().length;
  const analyticsCount = buildModelAnalyticsRows().length;
  return `
    <nav class="nav" aria-label="Owner sections">
      <button class="nav-tab ${state.ownerTab==='dashboard'?'active':''}" onclick="setOwnerTab('dashboard')">Dashboard</button>
      <button class="nav-tab ${state.ownerTab==='calculator'?'active':''}" onclick="setOwnerTab('calculator')">Calculator</button>
      <button class="nav-tab ${state.ownerTab==='gallery'?'active':''}" onclick="setOwnerTab('gallery')">Gallery</button>
      <button class="nav-tab ${state.ownerTab==='settings'?'active':''}" onclick="setOwnerTab('settings')">Site Settings</button>
      <button class="nav-tab ${state.ownerTab==='emails'?'active':''}" onclick="setOwnerTab('emails')">Emails</button>
      <button class="nav-tab ${state.ownerTab==='library'?'active':''}" onclick="setOwnerTab('library')">Saved Models${libCount ? `<span class="nav-badge">${libCount}</span>` : ''}</button>
      <button class="nav-tab ${state.ownerTab==='analytics'?'active':''}" onclick="setOwnerTab('analytics')">Sales Data${analyticsCount ? `<span class="nav-badge">${analyticsCount}</span>` : ''}</button>
      <button class="nav-tab ${state.showPasswordForm ? 'active' : ''}" type="button" aria-pressed="${!!state.showPasswordForm}" onclick="state.showPasswordForm = !state.showPasswordForm; render(); if (state.showPasswordForm) document.getElementById('new-pw')?.focus();">Change Password</button>
    </nav>
  `;
}

// ── HOME PAGE: about, how it works, reviews, contact ─────────────────────
function renderContactButtons() {
  const { messenger, etsy } = state.settings.links;
  if (!messenger && !etsy) return '';
  return `<div class="contact-buttons">
    ${messenger ? `<a class="btn-contact" href="${esc(messenger)}" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2C6.4 2 2 6.1 2 11.4c0 2.9 1.4 5.5 3.7 7.2V22l3.4-1.9c.9.3 1.9.4 2.9.4 5.6 0 10-4.1 10-9.4S17.6 2 12 2zm1 12.6-2.6-2.7-5 2.7 5.5-5.8 2.6 2.7 4.9-2.7-5.4 5.8z"/></svg>Message me</a>` : ''}
    ${etsy ? `<a class="btn-contact etsy" href="${esc(etsy)}" target="_blank" rel="noopener noreferrer">Visit my Etsy shop</a>` : ''}
  </div>`;
}

function renderAboutCard() {
  const a = state.settings.about;
  return `<div class="card about-card">
    ${a.photo ? `<img class="about-photo" src="${esc(a.photo)}" alt="Photo of the SoloPrint owner" referrerpolicy="no-referrer" onerror="this.remove()" />` : ''}
    <div>
      <h2 class="section-title" style="font-size:20px;margin-bottom:8px;">Hi, welcome to SoloPrint</h2>
      <p class="about-text">${esc(a.text)}</p>
      ${a.replyTime ? `<p class="about-reply">${esc(a.replyTime)}</p>` : ''}
      ${renderContactButtons()}
    </div>
  </div>`;
}

function renderHowItWorks() {
  const steps = [
    ['Tell me what you want', 'Paste a model link, describe an idea, or pick something I have made before.'],
    ['I review it and send a quote', "I'll check the print time and material, then email you a price."],
    ['You approve', 'Tap "Looks good" if you want to go ahead. Nothing is charged before this.'],
    ['I print it, you pay', 'I confirm the order, print it, and you pay by Venmo. Follow every step under My Requests.']
  ];
  return `<div class="card">
    <h3 class="card-title">How it works</h3>
    <ol class="how-steps">${steps.map(([t, d], n) => `
      <li><span class="how-num" aria-hidden="true">${n + 1}</span><span><strong>${esc(t)}</strong><span class="how-desc">${esc(d)}</span></span></li>`).join('')}
    </ol>
  </div>`;
}

function renderReviews(reviews, title = 'What customers say') {
  if (!reviews.length) return '';
  return `<div class="card">
    <h3 class="card-title">${esc(title)}</h3>
    <div class="reviews">${reviews.map(r => {
      const design = r.designId && state.gallery.find(g => g.id === r.designId && g.published);
      return `<figure class="review">
        <blockquote>“${esc(r.text)}”</blockquote>
        <figcaption>${esc(r.name || 'A customer')}${design ? ` · <button class="btn-link" type="button" onclick="openWork('${esc(design.id)}')">${esc(design.title)}</button>` : ''}</figcaption>
      </figure>`;
    }).join('')}</div>
  </div>`;
}

function renderSubmitTab() {
  const items = state.draftItems;
  return `
    ${renderAboutCard()}
    ${renderRecentWork()}
    ${renderHowItWorks()}
    ${renderReviews(state.settings.reviews)}
    <div class="section-header">
      <div class="section-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
      </div>
      <div>
        <h2 class="section-title">New Quote Request</h2>
        <div class="section-sub">Tell me what you'd like printed. Nothing is charged until you approve a quote.</div>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">Your info</h3>
      <div class="row2">
        <div class="field">
          <label>Your name <span class="req">*</span></label>
          <input type="text" id="client-name" value="${esc(state.clientName)}" placeholder="Jane Smith"
            oninput="state.clientName=this.value; clearErr(this,'err-name')" />
          <div class="field-err" id="err-name">Please enter your name</div>
        </div>
        <div class="field">
          <label>Your email <span class="req">*</span></label>
          <input type="email" id="client-email" value="${esc(state.clientEmail)}" placeholder="you@email.com"
            oninput="state.clientEmail=this.value; clearErr(this,'err-email')" />
          <div class="field-err" id="err-email">Please enter a valid email</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">Items to print (${items.length}/${MAX_ITEMS})</h3>
      ${items.map((item, i) => renderItemBlock(item, i)).join('')}
      ${items.length < MAX_ITEMS ? `
        <button class="next-link-row" type="button" onclick="addItem()"><span class="plus-circle" aria-hidden="true">+</span> Add another item</button>`
        : `<div style="text-align:center;font-size:12px;color:var(--muted);padding:8px 0;">Maximum 10 items reached</div>`}
    </div>

    <button class="btn-primary" id="submit-btn" onclick="submitBatch()">Send My Request</button>
    ${state.settings.links.messenger ? `<div class="field-help" style="text-align:center;margin-top:8px;">Questions first? <a class="btn-link" href="${esc(state.settings.links.messenger)}" target="_blank" rel="noopener noreferrer">Message me</a></div>` : ''}
    <div class="field-help" style="text-align:center;margin-top:8px;">Free to ask. I'll review it and email you a quote${state.settings.about.replyTime ? ` (${esc(state.settings.about.replyTime.replace(/^I\s+/i, '').replace(/\.$/, ''))})` : ''}.</div>
    <div class="alert error" id="submit-err"></div>
    <div class="alert success" id="submit-ok"></div>
  `;
}

// Special orders: a color or material the owner doesn't carry (e.g. Red TPU). The owner buys a full
// 1 kg roll for the order; the customer pays for the roll instead of per gram.
const SPECIAL_ORDER_TYPICAL = 20;
const SPECIAL_ORDER_POLICY = `Special orders are for a color or material I don't carry, like Red TPU. Filament only comes in full 1 kg rolls, so I order a whole roll for your print. The roll (usually about $${SPECIAL_ORDER_TYPICAL}; the exact amount is in your quote) replaces the material charge. The rest of the roll is yours for 2 months: place another order with it and the material is free. After 2 months, I keep any leftover.`;
function isSpecialOrder(item) {
  return item.filType === 'special_order';
}
// Items printed from the customer's leftover roll don't buy a new one.
function usesSpecialSpool(item) {
  return isSpecialOrder(item) && !item.useLeftover;
}

// Leftover rolls: a roll is bought when the owner confirms a special order. For 2 months the customer can
// print more in that same color/material from it, up to 1000 g in all (the first order included).
const ROLL_GRAMS = 1000;
function colorKey(text) { return String(text || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function itemGrams(it) { return (Number(it.grams) || 0) * Math.max(1, Number(it.qty) || 1); }
function rollExpiry(iso) { const d = new Date(iso); d.setMonth(d.getMonth() + 2); return d.toISOString(); }
function fmtShortDate(iso) { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

function leftoverRolls(batches, excludeId = '') {
  const rolls = [];
  batches.forEach(b => {
    if (phaseIndex(b.phase || 'estimate') < phaseIndex('order_received')) return;
    const boughtAt = (b.phaseHistory || {}).order_received || b.createdAt;
    b.items.filter(usesSpecialSpool).forEach(it => {
      const key = colorKey(it.specialColor);
      if (!key) return;
      let roll = rolls.find(r => r.orderId === b.id && r.key === key);
      if (!roll) rolls.push(roll = { orderId: b.id, key, color: it.specialColor, email: colorKey(b.clientEmail), boughtAt, expiresAt: rollExpiry(boughtAt), used: 0 });
      roll.used += partGrams(it);
    });
  });
  batches.forEach(b => {
    if (b.id === excludeId) return;
    b.items.forEach(it => rollParts(it).forEach(p => {
      const roll = findRoll(rolls, b.clientEmail, p);
      if (roll) roll.used += partGrams(it);
    }));
  });
  rolls.forEach(r => { r.left = Math.max(0, ROLL_GRAMS - r.used); });
  return rolls;
}
function findRoll(rolls, email, part) {
  return rolls.find(r => r.orderId === part.leftoverFrom && r.key === colorKey(part.name) && r.email === colorKey(email));
}
function rollParts(it) { return itemParts(it).filter(p => p.filType === 'leftover'); }
function usesRolls(it) { return isSpecialOrder(it) || rollParts(it).length > 0; }
function partGrams(it) { return itemGrams(it) / itemParts(it).length; }

// Problems with an order's leftover-roll colors, for the owner to see before quoting: one list per item.
function leftoverChecks(b) {
  const rolls = leftoverRolls(state.batches, b.id);
  const uses = {};
  b.items.forEach(it => rollParts(it).forEach(p => {
    const roll = findRoll(rolls, b.clientEmail, p);
    if (roll) uses[roll.orderId + roll.key] = (uses[roll.orderId + roll.key] || 0) + partGrams(it);
  }));
  return b.items.map(it => rollParts(it).map(p => {
    const roll = findRoll(rolls, b.clientEmail, p);
    if (!roll) return { ok: false, text: `No ${p.name || 'matching'} roll found for this customer${p.leftoverFrom ? ` from order ${p.leftoverFrom}` : ''}. Charge a new roll.` };
    if (new Date(b.createdAt) > new Date(roll.expiresAt)) return { ok: false, text: `Their ${roll.color} roll expired ${fmtShortDate(roll.expiresAt)}. Charge a new roll.` };
    const need = uses[roll.orderId + roll.key];
    if (need > roll.left) return { ok: false, text: `Needs ${need.toFixed(0)} g but their ${roll.color} roll has ${roll.left.toFixed(0)} g left. Charge a new roll.` };
    return { ok: true, text: `From their ${roll.color} roll (order ${roll.orderId}): ${roll.left.toFixed(0)} g left before this order, ${(roll.left - need).toFixed(0)} g after. Good until ${fmtShortDate(roll.expiresAt)}.` };
  }));
}

// Customer side: look up their rolls by the email on the form.
async function findLeftoverRolls(i, forExtras = false) {
  const email = colorKey(state.clientEmail);
  const msg = document.getElementById(`leftover-msg-${i}`);
  if (!email.includes('@')) { if (msg) msg.textContent = 'Enter your email at the top first, so I can find your roll.'; return; }
  if (msg) msg.textContent = 'Looking up your rolls...';
  try {
    const rows = await supaFetch('/rpc/customer_jobs', { method: 'POST', body: JSON.stringify({ email }) }) || [];
    const now = new Date();
    state.leftoverRolls = leftoverRolls(rows.map(normalizeBatch).filter(Boolean))
      .filter(r => r.email === email && r.left > 0 && new Date(r.expiresAt) > now).sort((a, b) => byName({ name: a.color }, { name: b.color }));
    state.leftoverRollsFor = email;
    if (forExtras) state.draftItems[i].showExtras = true; else state.draftItems[i].showRolls = true;
  } catch (e) {
    if (msg) msg.textContent = "Couldn't look up your rolls right now. Please try again.";
    return;
  }
  rerenderPills(i, state.draftItems[i].filType);
}

function useLeftoverRoll(i, n) {
  const item = state.draftItems[i], roll = (state.leftoverRolls || [])[n];
  if (!item) return;
  item.useLeftover = !!roll;
  item.leftoverFrom = roll ? roll.orderId : '';
  if (roll) item.specialColor = roll.color;
  item.showRolls = false;
  rerenderPills(i, item.filType);
  updateCustomerPricePreview(i);
  queueDraftSave();
}

function draftRoll(part) {
  return part && part.filType === 'leftover' && state.leftoverRollsFor === colorKey(state.clientEmail)
    ? (state.leftoverRolls || []).find(r => r.orderId === part.leftoverFrom && r.key === colorKey(part.name)) : null;
}

function renderLeftoverPicker(item, i) {
  if (item.useLeftover) {
    const roll = draftRoll(itemParts(item)[0]);
    return `<div class="special-order-check">Printing from your ${esc(item.specialColor)} roll${roll ? ` (about ${roll.left.toFixed(0)} g left, until ${fmtShortDate(roll.expiresAt)})` : ''}. No roll or material charge.
      <button type="button" class="btn-sm" onclick="useLeftoverRoll(${i}, -1)">Order a new roll instead</button></div>`;
  }
  if (item.showRolls && state.leftoverRollsFor === colorKey(state.clientEmail)) {
    const rolls = state.leftoverRolls || [];
    return `<div class="special-order-check" role="group" aria-label="Your leftover rolls">
      ${rolls.length ? rolls.map((r, n) => item.extraColors.some(p => p.filType === 'leftover' && p.leftoverFrom === r.orderId && colorKey(p.name) === r.key) ? '' : `<button type="button" class="btn-sm" onclick="useLeftoverRoll(${i}, ${n})">${esc(r.color)}: about ${r.left.toFixed(0)} g left, until ${fmtShortDate(r.expiresAt)}</button>`).join('')
        : `<span>No leftover rolls found for this email. A roll can be used for 2 months after I order it, for the same color and material, up to ${ROLL_GRAMS} g in all.</span>`}
    </div>`;
  }
  return `<div class="special-order-check"><button type="button" class="btn-sm" id="special-leftover-${i}" onclick="findLeftoverRolls(${i})">Use my leftover roll</button>
    <span id="leftover-msg-${i}" role="status">Same color and material only, within 2 months, up to ${ROLL_GRAMS} g per roll in all.</span></div>`;
}

function renderSpecialOrderBox(item, i) {
  if (!isSpecialOrder(item)) return '';
  return `<div class="special-order">
    <div class="field" style="margin-bottom:8px;">
      <label for="special-color-${i}">Which color and material would you like?</label>
      <input type="text" id="special-color-${i}" value="${esc(item.specialColor || '')}" placeholder="e.g. Red TPU, translucent blue PLA"
        oninput="updateDraft(${i}, 'specialColor', this.value)" ${item.useLeftover ? 'readonly' : ''} />
    </div>
    ${renderLeftoverPicker(item, i)}
    <p class="special-order-note">${esc(SPECIAL_ORDER_POLICY)}</p>
  </div>`;
}

// With owner colors set up, every item has one picked: the matching Black/White, else the first color.
function ensureItemColor(item) {
  const colors = state.settings.colors;
  if (!colors.length || item.colorId || isSpecialOrder(item)) return;
  const c = colors.find(x => x.name.toLowerCase() === (FIL_LABEL[item.filType] || '').toLowerCase() && !x.special) || colors.find(x => !x.special) || colors[0];
  item.colorId = c.id;
  item.color = c.name;
  item.filType = c.special ? 'special' : (['black', 'white'].includes(item.filType) && c.name.toLowerCase() === item.filType ? item.filType : 'color');
}

function renderFilamentPills(i, current) {
  const item = state.draftItems[i] || {};
  const colors = state.settings.colors;
  ensureItemColor(item);
  // An extra color that is now the main color isn't an extra any more.
  const main = itemParts(item)[0];
  item.extraColors = (item.extraColors || []).filter(p => !sameColorPart(p, main));
  if (colors.length) {
    return `<div class="filament-pills" role="group" aria-label="Color">
      ${colors.map(c => `
        <button type="button" class="fil-pill swatch-pill ${item.colorId === c.id ? 'active-color' : ''}" aria-pressed="${item.colorId === c.id}" onclick="pickColor(${i}, '${esc(c.id)}')">
          <span class="swatch" style="background:${esc(c.hex)}" aria-hidden="true"></span>${esc(c.name)}${c.special ? ' <span class="swatch-note">special</span>' : ''}
        </button>`).join('')}
      <button type="button" class="fil-pill ${isSpecialOrder(item) ? 'active-special' : ''}" aria-pressed="${isSpecialOrder(item)}" onclick="pickColor(${i}, '')">Special order (color or material I don't carry)</button>
    </div>
    ${renderSpecialOrderBox(item, i)}
    ${renderExtraColors(item, i)}`;
  }
  return `<div class="filament-pills" role="group" aria-label="Filament">
    ${['black','white','special_order'].map(f => `
      <button type="button" class="fil-pill ${current===f?(f === 'special_order' ? 'active-special' : 'active-'+f):''}" aria-pressed="${current===f}"
        onclick="updateDraft(${i},'filType','${f}'); rerenderPills(${i},'${f}'); updateCustomerPricePreview(${i})">
        ${f === 'special_order' ? "Special order (color or material I don't carry)" : FIL_LABEL[f]}
      </button>`).join('')}
  </div>
  ${renderSpecialOrderBox(item, i)}
  ${renderExtraColors(item, i)}`;
}

// Colors a customer can add to a multi-color print: stocked colors, plus their leftover rolls.
function stockedColors() {
  const colors = state.settings.colors;
  return colors.length
    ? colors.map(c => ({ name: c.name, colorId: c.id, filType: c.special ? 'special' : 'color', hex: c.hex }))
    : [{ name: 'Black', colorId: '', filType: 'black', hex: '#1e1e24' }, { name: 'White', colorId: '', filType: 'white', hex: '#f4f4f4' }];
}
function sameColorPart(a, b) {
  return a.filType === 'leftover' ? b.filType === 'leftover' && a.leftoverFrom === b.leftoverFrom && colorKey(a.name) === colorKey(b.name)
    : b.filType !== 'leftover' && colorKey(a.name) === colorKey(b.name);
}
function extraColorChoices(item) {
  const main = itemParts(item)[0];
  const rolls = state.leftoverRollsFor === colorKey(state.clientEmail) ? (state.leftoverRolls || []) : [];
  return [...stockedColors(), ...rolls.map(r => ({ name: r.color, filType: 'leftover', leftoverFrom: r.orderId, roll: r }))]
    .filter(c => !sameColorPart(c, main)).sort(byName);
}

function renderExtraColors(item, i) {
  const extras = item.extraColors || [];
  if (!item.showExtras && !extras.length) {
    return `<button type="button" class="btn-sm extra-colors-open" onclick="state.draftItems[${i}].showExtras = true; rerenderPills(${i}, state.draftItems[${i}].filType)">+ Add another color (multi-color print)</button>`;
  }
  const rollsLooked = state.leftoverRollsFor === colorKey(state.clientEmail);
  return `<div class="extra-colors">
    <div class="field-help" style="margin-top:0;">Other colors in this print (optional). You can mix colors I carry with your leftover roll.</div>
    <div class="filament-pills" role="group" aria-label="Other colors in this print">
      ${extraColorChoices(item).map((c, n) => {
        const on = extras.some(p => sameColorPart(p, c));
        return `<button type="button" class="fil-pill swatch-pill ${on ? 'active-color' : ''}" aria-pressed="${on}" onclick="toggleExtraColor(${i}, ${n})">
          ${c.hex ? `<span class="swatch" style="background:${esc(c.hex)}" aria-hidden="true"></span>` : ''}${esc(c.name)}${c.roll ? ` <span class="swatch-note">your roll, ${c.roll.left.toFixed(0)} g left</span>` : c.filType === 'special' ? ' <span class="swatch-note">special</span>' : ''}
        </button>`;
      }).join('')}
    </div>
    ${rollsLooked ? '' : `<button type="button" class="btn-sm" id="extra-leftover-${i}" onclick="findLeftoverRolls(${i}, true)">Add my leftover roll</button>
      <span id="leftover-msg-${i}" role="status"></span>`}
    ${extras.length ? `<div class="field-help">For the estimate, the filament is split evenly between the colors. I'll confirm the price in your quote.</div>` : ''}
  </div>`;
}

function toggleExtraColor(i, n) {
  const item = state.draftItems[i];
  const c = item && extraColorChoices(item)[n];
  if (!c) return;
  const at = item.extraColors.findIndex(p => sameColorPart(p, c));
  if (at >= 0) item.extraColors.splice(at, 1);
  else item.extraColors.push({ name: c.name, filType: c.filType, colorId: c.colorId || '', leftoverFrom: c.leftoverFrom || '' });
  item.extraColors.sort(byName);
  rerenderPills(i, item.filType);
  updateCustomerPricePreview(i);
  queueDraftSave();
}

function pickColor(i, colorId) {
  const item = state.draftItems[i];
  if (!item) return;
  const c = state.settings.colors.find(x => x.id === colorId);
  item.colorId = c ? c.id : '';
  item.color = c ? c.name : '';
  item.filType = c ? (c.special ? 'special' : 'color') : 'special_order';
  rerenderPills(i, item.filType);
  updateCustomerPricePreview(i);
  queueDraftSave();
  if (!c) document.getElementById(`special-color-${i}`)?.focus();
}

function renderCustomerPricePreview(item) {
  const minutes = item.knownFromLibrary ? item.knownMinutes : totalPrintMinutes(item.printHours, item.printMinutes);
  const grams = Number(item.grams);
  const qty = Math.max(1, Number(item.qty) || 1);
  if (!minutes || !grams) {
    return `<div class="calc-hint">No need to know the price yet: I'll work it out when I review your request.${usesSpecialSpool(item) ? ` A special order roll usually adds about $${SPECIAL_ORDER_TYPICAL}.` : ''}</div>`;
  }
  const perPrint = calcPerPrint(minutes, grams, item);
  const total = perPrint * qty;
  const filamentRate = itemRate(item);
  return `<div class="price-preview-box" style="margin-top:12px;">
    <div class="card-title" style="margin-bottom:6px;">Automated Estimate</div>
    <div class="price-big">$${total.toFixed(2)}</div>
    <div style="font-size:12px;color:var(--muted);margin-top:4px;">$${perPrint.toFixed(2)} per print · ${fmtTime(minutes)} · ${grams.toFixed(1)}g · quantity ${qty}</div>
    <div class="price-breakdown">$2.00 flat × ${qty} = $${(2 * qty).toFixed(2)}
${fmtMinutesWithHours(minutes)} × $0.024 × ${qty} = $${(minutes * 0.024 * qty).toFixed(2)}
${grams.toFixed(1)}g × $${filamentRate.toFixed(3)} × ${qty} = $${(grams * filamentRate * qty).toFixed(2)}
$${perPrint.toFixed(2)} per print × ${qty}</div>
    ${usesSpecialSpool(item) ? `<div style="font-size:12px;font-weight:600;margin-top:8px;">+ about $${SPECIAL_ORDER_TYPICAL} for the 1 kg special order roll, instead of a material charge (confirmed in your quote)</div>` : ''}
    ${isSpecialOrder(item) && item.useLeftover ? `<div style="font-size:12px;font-weight:600;margin-top:8px;">No material charge: printed from your leftover roll.</div>` : ''}
    <div style="font-size:12px;color:var(--muted);margin-top:8px;">This is an automated estimate, not an exact cost. We'll review your request and confirm your quote.</div>
  </div>`;
}

function inferMode(item) {
  if (item.mode) return item.mode;
  if (item.link && isWebUrl(item.link)) return 'link';
  if (item.link || item.notes || item.name) return 'idea';
  return '';
}

function setItemMode(i, mode) {
  const item = state.draftItems[i];
  if (!item) return;
  if (mode === 'gallery') { setTab('gallery'); return; }
  item.mode = mode;
  render();
  const focusId = mode === 'link' ? `link-${i}` : `notes-${i}`;
  setTimeout(() => document.getElementById(focusId)?.focus(), 0);
}

function toggleItemTime(i) {
  const item = state.draftItems[i];
  if (!item) return;
  item.showTime = !item.showTime;
  render();
  if (item.showTime) setTimeout(() => document.getElementById(`hours-${i}`)?.focus(), 0);
}

function renderModeChooser(i) {
  const opt = (mode, title, sub, icon) => `
    <button type="button" class="mode-option" onclick="setItemMode(${i}, '${mode}')">
      <span class="mode-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></span>
      <span><span class="mode-title">${title}</span><span class="mode-sub">${sub}</span></span>
    </button>`;
  return `<div class="field" style="margin-bottom:4px;">
    <div class="mode-question">What would you like printed?</div>
    <div class="mode-options">
      ${opt('link', 'I have a link', 'A model on MakerWorld, Printables or Thingiverse', '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>')}
      ${opt('idea', 'I have an idea', 'Something custom: describe it and I can design it', '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>')}
      ${opt('gallery', 'Something from my past work', 'Pick a design I have made before', '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>')}
    </div>
  </div>`;
}

function renderPhotoField(item, i) {
  return `<div class="field" style="margin-bottom:8px;">
    <label>Photo links (optional)</label>
    <div class="field-help">Photos, sketches or examples help a lot. Paste links, one per line (up to 5). Google Photos, Imgur and Dropbox work; make sure each is shared publicly.</div>
    <textarea id="photos-${i}" placeholder="https://..." style="min-height:52px;"
      oninput="updateImageLinks(${i}, this.value)">${esc((item.imageLinks || []).join('\n'))}</textarea>
    <div id="photo-previews-${i}">${renderPhotoLinks(item.imageLinks)}</div>
  </div>`;
}

// Print time and grams: hidden behind a link until the customer opens it or a lookup fills them in.
function renderTimeSection(item, i) {
  const hasTime = !!(item.printHours || item.printMinutes || item.grams || item.knownFromLibrary);
  if (!(item.showTime || hasTime)) return `
          <button class="btn-link" type="button" onclick="toggleItemTime(${i})">I know the print time and weight (optional)</button>`;
  return `
          <div class="row3">
            <div class="field" style="margin-bottom:0;">
              <label>Hours (est.)</label>
              <input type="number" id="hours-${i}" value="${item.printHours || hoursFromMinutes(item.knownMinutes)}" placeholder="1"
                min="0" step="1" oninput="updateDraftPrintTime(${i}, 'hours', this.value)" />
            </div>
            <div class="field" style="margin-bottom:0;">
              <label>Minutes (est.)</label>
              <input type="number" id="minutes-${i}" value="${item.printMinutes || minuteRemainder(item.knownMinutes)}" placeholder="30"
                min="0" max="59" step="1" oninput="updateDraftPrintTime(${i}, 'minutes', this.value)" />
            </div>
            <div class="field" style="margin-bottom:0;">
              <label>Print Time (min.)</label>
              <input class="print-time-output" type="number" id="print-time-${i}" value="${item.knownFromLibrary ? item.knownMinutes : (totalPrintMinutes(item.printHours, item.printMinutes) || '')}" placeholder="Auto" readonly />
            </div>
          </div>
          <div class="field" style="margin:12px 0 0;max-width:220px;">
            <label>Grams (est.)</label>
            <input type="number" id="grams-${i}" value="${item.grams || ''}" placeholder="Auto"
              min="0" step="0.1" oninput="clearEstimateSource(${i}); updateDraft(${i},'grams',parseFloat(this.value)||null)" />
          </div>`;
}

function renderItemBlock(item, i) {
  const mode = inferMode(item);
  const modeLabel = { link: 'Model link', idea: 'Custom idea', gallery: 'From my past work' }[mode];
  return `
    <div class="item-block" id="iblock-${i}">
      <div class="item-block-header">
        <span class="item-num-badge">Item ${i + 1}${modeLabel ? ` · ${modeLabel}` : ''}</span>
        <div style="display:flex;gap:8px;align-items:center;">
          ${item.fetching ? `<span class="fetching-badge">Looking up...</span>` : ''}
          ${mode && mode !== 'gallery' ? `<button class="btn-link" type="button" onclick="state.draftItems[${i}].mode=''; render();">Change</button>` : ''}
          ${state.draftItems.length > 1 ? `<button class="btn-sm danger" type="button" onclick="removeItem(${i})">Remove</button>` : ''}
        </div>
      </div>
      ${!mode ? renderModeChooser(i) : ''}
      ${mode === 'link' ? `
        <div class="field" style="margin-bottom:8px;">
          <label>Model link</label>
          <input type="text" id="link-${i}" value="${esc(item.link)}" placeholder="https://makerworld.com/en/models/..."
            oninput="onLinkInput(${i}, this.value)" />
          <div id="preview-${i}">${renderModelPreview(item)}</div>
        </div>
        <div class="field" style="margin-bottom:8px;">
          <label>Model name</label>
          <input type="text" id="name-${i}" value="${esc(item.name)}" placeholder="Fills in from the link"
            oninput="updateDraft(${i},'name',this.value)" />
        </div>
        <div class="field" style="margin-bottom:8px;">
          <label>Anything you'd like changed? (optional)</label>
          <textarea id="notes-${i}" placeholder="Size, color, a name added, anything else" style="min-height:52px;"
            oninput="updateDraft(${i},'notes',this.value)">${esc(item.notes)}</textarea>
        </div>
        ${renderPhotoField(item, i)}` : ''}
      ${mode === 'idea' ? `
        <div class="field" style="margin-bottom:8px;">
          <label>Describe your idea</label>
          <div class="field-help">What it's for, rough size or measurements, where it will be used, colors, and anything it has to fit, hold or attach to. Custom design work is free for veterans.</div>
          <textarea id="notes-${i}" placeholder="e.g. A wall holder for three paint brushes, about 6 inches wide, in white"
            oninput="updateDraft(${i},'notes',this.value)">${esc(item.notes)}</textarea>
        </div>
        ${renderPhotoField(item, i)}
        <div class="field" style="margin-bottom:8px;">
          <label>Short name (optional)</label>
          <input type="text" id="name-${i}" value="${esc(item.name)}" placeholder="e.g. Brush holder"
            oninput="updateDraft(${i},'name',this.value)" />
        </div>
        <div id="preview-${i}" hidden></div>` : ''}
      ${mode === 'gallery' ? `
        <div class="field" style="margin-bottom:8px;">
          <label>Design</label>
          <input type="text" id="name-${i}" value="${esc(item.name)}" oninput="updateDraft(${i},'name',this.value)" />
          <div id="preview-${i}">${renderModelPreview(item)}</div>
        </div>
        <div class="field" style="margin-bottom:8px;">
          <label>Anything you'd like changed? (optional)</label>
          <textarea id="notes-${i}" placeholder="Size, color, a name added, anything else" style="min-height:52px;"
            oninput="updateDraft(${i},'notes',this.value)">${esc(item.notes)}</textarea>
        </div>` : ''}
      ${mode ? `
        <div class="field" style="margin-bottom:10px;">
          <label>${state.settings.colors.length ? 'Color' : 'Filament'}</label>
          <div class="field-help">All prints are PLA unless noted or requested.</div>
          <div id="pills-${i}">${renderFilamentPills(i, item.filType)}</div>
        </div>
        <div class="field" style="margin-bottom:10px;max-width:160px;">
          <label>Quantity</label>
          <input type="number" id="qty-${i}" value="${item.qty}" min="1" max="999" step="1"
            oninput="updateDraft(${i},'qty',parseInt(this.value)||1)" />
        </div>
        ${item.knownFromLibrary ? `<div class="price-preview-box" style="margin-bottom:10px;">
          <div class="card-title" style="margin-bottom:6px;">Saved Estimate</div>
          <div style="font-size:12px;color:var(--muted);">Filled in from a previous print: ${fmtMinutesWithHours(item.knownMinutes)}, ${item.grams}g. I'll still review your request before sending a quote.</div>
        </div>` : ``}
        <div id="time-${i}">${renderTimeSection(item, i)}</div>
        <div id="customer-price-preview-${i}">${renderCustomerPricePreview(item)}</div>` : ''}
    </div>`;
}

function renderMyJobsTab() {
  const historyEmail = String(state.historyEmail || '').trim();
  if (!historyEmail) return `
    <div class="section-header">
      <div class="section-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16v12H4z"/><path d="m4 8 8 6 8-6"/></svg>
      </div>
      <div>
        <h2 class="section-title">My Requests</h2>
        <div class="section-sub">Enter your email to view your personal request history</div>
      </div>
    </div>
    <div class="card">
      <div class="field">
        <label>Your email</label>
        <input type="email" id="history-email" value="${esc(state.historyEmail)}" placeholder="you@email.com" oninput="state.historyEmail=this.value" />
      </div>
      <button class="btn-primary" onclick="lookupMyRequests()">View My Requests</button>
      <div class="alert error" id="history-err"></div>
    </div>`;

  if (!state.batches.length) return `
    <div class="section-header">
      <div class="section-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16v12H4z"/><path d="m4 8 8 6 8-6"/></svg>
      </div>
      <div>
        <h2 class="section-title">My Requests</h2>
        <div class="section-sub">Showing request history for ${esc(historyEmail)}</div>
      </div>
    </div>
    <div class="card">
      <div class="field">
        <label>Your email</label>
        <input type="email" id="history-email" value="${esc(state.historyEmail)}" placeholder="you@email.com" oninput="state.historyEmail=this.value" />
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn-sm" onclick="lookupMyRequests()">Refresh</button>
        <button class="btn-sm danger" onclick="clearMyRequestsLookup()">Use a different email</button>
      </div>
    </div>
    <div class="empty-state">
      <div class="empty-state-icon">📋</div>
      <div class="empty-state-text">No requests found</div>
      <div class="empty-state-sub">We couldn't find request history for ${esc(historyEmail)}</div>
    </div>`;

  return `
    <div class="section-header">
      <div class="section-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16v12H4z"/><path d="m4 8 8 6 8-6"/></svg>
      </div>
      <div>
        <h2 class="section-title">My Requests</h2>
        <div class="section-sub">Showing request history for ${esc(historyEmail)}</div>
      </div>
    </div>
    <div class="card">
      <div class="field">
        <label>Your email</label>
        <input type="email" id="history-email" value="${esc(state.historyEmail)}" placeholder="you@email.com" oninput="state.historyEmail=this.value" />
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn-sm" onclick="lookupMyRequests()">Refresh</button>
        <button class="btn-sm danger" onclick="clearMyRequestsLookup()">Use a different email</button>
      </div>
      <div class="alert error" id="history-err"></div>
    </div>
    ${[...state.batches].reverse().map(b => {
      const phase = b.phase || 'estimate';
      const allDone = b.items.every(it => it.minutes && it.grams);
      const total = phase !== 'estimate' && allDone ? orderSum(b) : null;
      return `<div class="job-card ${phase}" id="order-${b.id}">
        <div class="job-header">
          <div>
            <div class="job-title">${esc(b.clientName)}'s Request</div>
            <div class="job-meta">${b.items.length} item${b.items.length>1?'s':''} · ${new Date(b.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div>
          </div>
          <span class="status ${phase}">${phaseLabel(phase)}</span>
        </div>
        <div class="job-divider"></div>
        ${renderOrderTracker(b)}
        ${b.items.map(it => {
          const ip = it.minutes ? calcTotal(it.minutes, it.grams, it, it.qty) : null;
          const pp = it.minutes ? calcPerPrint(it.minutes, it.grams, it) : null;
          return `<div class="sub-item">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
              <div style="display:flow-root;min-width:0;">${renderModelThumb(it)}
                <div class="sub-item-name">${esc(it.name)||'Unnamed'}${it.qty>1?` <span style="color:var(--muted);font-weight:400;">× ${it.qty}</span>`:''}</div>
                <div class="sub-item-meta">
                  <span class="status ${it.filType}">${esc(filamentLabel(it))}</span>
                  ${it.grams ? `${parseFloat(it.grams).toFixed(1)}g` : ''}
                ${isWebUrl(it.link) ? `<a class="job-link" href="${esc(it.link)}" target="_blank">Model Link ↗</a>` : it.link ? `<span style="color:var(--muted);">${esc(it.link)}</span>` : ''}
                </div>
                ${it.notes?`<div style="font-size:12px;color:var(--muted);margin-top:4px;font-style:italic;">"${esc(it.notes)}"</div>`:''}
                ${renderPhotoLinks(it.imageLinks)}
              </div>
              ${ip!==null
                ? `<div style="text-align:right;flex-shrink:0;">
                    <div class="sub-item-price">$${ip.toFixed(2)}</div>
                    ${it.qty>1?`<div style="font-size:11px;color:var(--muted);">$${pp.toFixed(2)} each</div>`:''}
                    ${phase === 'estimate' ? `<div style="font-size:11px;color:var(--muted);">Automated estimate</div>` : ''}
                  </div>`
                : `<div style="font-size:12px;color:var(--muted);font-style:italic;">Pending</div>`}
            </div>
          </div>`;
        }).join('')}
        ${total!==null && specialOrderCost(b) ? `<div class="sub-item"><div style="display:flex;justify-content:space-between;gap:8px;"><div class="sub-item-name">Special order roll (1 kg)</div><div class="sub-item-price">$${specialOrderCost(b).toFixed(2)}</div></div></div>` : ''}
        ${total!==null?`<div class="total-box"><span class="total-label">Total estimate</span><span class="total-price">$${total.toFixed(2)}</span></div>`:''}
      </div>`;
    }).join('')}`;
}

function renderOwnerApp() {
  if (!state.ownerUnlocked) {
    return `<main class="main" id="main" tabindex="-1"><h1 class="sr-only">SoloPrint owner login</h1><div class="login-wrap">
      <div class="section-header">
        <div class="section-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <div><h2 class="section-title">Owner Login</h2><div class="section-sub">Access your dashboard</div></div>
      </div>
      <div class="card">
        <div class="field"><label>Email</label>
          <input type="email" id="owner-email" value="${esc(OWNER_EMAIL)}" autocomplete="username" />
        </div>
        <div class="field"><label>Password</label>
          <input type="password" id="owner-pw" placeholder="Enter your password" autocomplete="current-password" />
        </div>
        <div class="alert error" id="pw-err" style="margin-bottom:10px;${state.authNotice ? 'display:block;' : ''}">${esc(state.authNotice || '')}</div>
        <div class="alert success" id="pw-ok" style="margin-bottom:10px;"></div>
        <button class="btn-primary" id="owner-login-btn" onclick="checkPw()">Login</button>
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:14px;">
          <button class="btn-link" type="button" onclick="sendOwnerAuthEmail('recover')">Forgot password?</button>
          <button class="btn-link" type="button" onclick="sendOwnerAuthEmail('otp')">Email me a login link</button>
        </div>
      </div>
    </div></main>`;
  }

  return `
    ${renderOwnerNav()}
    <main class="main owner-main" id="main" tabindex="-1">
      <h1 class="sr-only">SoloPrint owner: ${esc({ dashboard: 'Dashboard', calculator: 'Calculator', gallery: 'Gallery', settings: 'Site Settings', emails: 'Emails', library: 'Saved Models', analytics: 'Sales Data' }[state.ownerTab] || 'Dashboard')}</h1>
      ${state.showPasswordForm ? renderSetPasswordCard() : ''}
      ${state.ownerTab === 'settings'
        ? renderOwnerSettingsPage()
        : state.ownerTab === 'emails'
        ? renderOwnerEmailsPage()
        : state.ownerTab === 'gallery'
        ? renderOwnerGalleryPage()
        : state.ownerTab === 'library'
        ? renderOwnerLibraryPage()
        : state.ownerTab === 'analytics'
          ? renderOwnerAnalyticsPage()
          : state.ownerTab === 'calculator'
            ? renderOwnerCalculatorPage()
            : renderOwnerDashboard()}
    </main>`;
}

function renderOwnerDashboard() {
  const estimate = state.batches.filter(b => (b.phase || 'estimate') === 'estimate');
  const production = state.batches.filter(b => (b.phase || 'estimate') === 'production');
  const delivered = state.batches.filter(b => (b.phase || 'estimate') === 'delivered');
  const rev = delivered.reduce((s,b) => s + orderSum(b), 0);

  return `
    <div class="owner-page-header">
      <div class="section-header">
        <div class="section-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 13h6v7H4zM14 4h6v16h-6zM9 9h6v11H9z"/></svg>
        </div>
        <div><h2 class="section-title">Owner Dashboard</h2><div class="section-sub">Track quotes, production, and delivered orders</div></div>
      </div>
      <div class="owner-page-meta">${state.batches.length} request${state.batches.length === 1 ? '' : 's'}${state.ownerHistoryAll ? '' : ` · open orders and the last ${RECENT_ORDER_DAYS} days · <button class="btn-link" type="button" onclick="loadAllOrders()">Load all orders</button>`}</div>
    </div>
      <div class="stats-row">
        <div class="stat-card"><div class="stat-val orange">${estimate.length}</div><div class="stat-label">Estimate</div></div>
        <div class="stat-card"><div class="stat-val">${production.length}</div><div class="stat-label">Production</div></div>
        <div class="stat-card"><div class="stat-val green">${delivered.length}</div><div class="stat-label">Delivered</div></div>
      </div>
      <div class="card">
        <h3 class="card-title">Owner Sheet</h3>
        <div class="owner-sheet-wrap" tabindex="0" role="region" aria-label="Scrollable table">
          <table class="owner-sheet">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Email</th>
                <th>Items</th>
                <th>Created</th>
                <th>Phase</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              ${[...state.batches].reverse().map(b => `
                <tr>
                  <td>${esc(b.clientName)}</td>
                  <td><a href="mailto:${esc(b.clientEmail)}" style="color:var(--accent);">${esc(b.clientEmail)}</a></td>
                  <td>${b.items.length}</td>
                  <td>${new Date(b.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</td>
                  <td>
                    <select class="phase-select" aria-label="Order phase for ${esc(b.clientName)}" onchange="updateBatchPhase('${b.id}', this.value)">
                      ${ORDER_PHASES.map((p, idx) => {
                        const currentIdx = phaseIndex(b.phase || 'estimate');
                        const isAllowed = idx === currentIdx || idx === currentIdx + 1;
                        return `<option value="${p.id}" ${(b.phase||'estimate')===p.id?'selected':''} ${isAllowed ? '' : 'disabled'}>${p.label}</option>`;
                      }).join('')}
                    </select>
                  </td>
                  <td>
                    <select class="phase-select" aria-label="Payment status for ${esc(b.clientName)}" onchange="updatePaymentStatus('${b.id}', this.value)">
                      ${PAYMENT_PHASES.map((p, idx) => {
                        const currentIdx = paymentIndex(b.paymentStatus || 'unpaid');
                        const isAllowed = idx === currentIdx || idx === currentIdx + 1;
                        return `<option value="${p.id}" ${(b.paymentStatus||'unpaid')===p.id?'selected':''} ${isAllowed ? '' : 'disabled'}>${p.label}</option>`;
                      }).join('')}
                    </select>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card" style="margin-bottom:1rem;">
        <h3 class="card-title">Delivered Revenue${state.ownerHistoryAll ? '' : ` (last ${RECENT_ORDER_DAYS} days)`}</h3>
        <div class="price-big" style="font-size:28px;color:var(--green);">$${rev.toFixed(2)}</div>
      </div>
      ${!state.batches.length
        ? `<div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">No requests yet</div></div>`
        : [...state.batches].reverse().map(b => renderOwnerBatch(b)).join('')}
  `;
}

function renderOwnerLibraryPage() {
  const libEntries = sortedLibraryEntries();
  return `
    <div class="owner-page-header">
      <div class="section-header">
        <div class="section-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>
        </div>
        <div><h2 class="section-title">Saved Models</h2><div class="section-sub">Manage reusable estimate data in one place</div></div>
      </div>
      <div class="save-indicator ${librarySaveState === 'pending' ? 'pending' : ''}">
        <span class="save-indicator-dot"></span>
        <span>${librarySaveState === 'pending' ? 'Saving changes...' : 'All changes saved automatically'}</span>
      </div>
    </div>
    <div class="card">
      <h3 class="card-title">Add Model</h3>
      <div class="lib-grid">
        <div class="field"><label>Model link</label><input type="text" id="lib-link" placeholder="https://makerworld.com/en/models/..." /></div>
        <div class="field"><label>Model name</label><input type="text" id="lib-name" placeholder="Model name" /></div>
        <div class="field"><label>Minutes</label><input type="number" id="lib-mins" min="0" step="1" placeholder="120" /></div>
        <div class="field"><label>Filament (g)</label><input type="number" id="lib-grams" min="0" step="0.1" placeholder="85.4" /></div>
        <button class="btn-sm" onclick="addLibraryEntry()">Add Model</button>
      </div>
      <div class="lib-import-row">
        <input type="file" id="lib-import-file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none" onchange="importModelLibrarySpreadsheet(event)" />
        <button type="button" class="btn-sm" onclick="document.getElementById('lib-import-file').click()">Import spreadsheet</button>
        <button type="button" class="btn-sm" onclick="downloadLibraryTemplate()">Download CSV template</button>
        <span style="font-size:12px;color:var(--muted);">Use .csv or .xlsx. Header row required. Columns: <strong>Model Link</strong> (or Name), <strong>Minutes</strong>, and <strong>Grams</strong>. Imports merge into your library automatically.</span>
      </div>
      <div class="alert error" id="lib-err"></div>
      <div class="alert success" id="lib-ok"></div>
      ${!libEntries.length ? `<div style="font-size:12px;color:var(--muted);margin-top:10px;">No saved models yet.</div>` : `
        <div class="owner-sheet-wrap" tabindex="0" role="region" aria-label="Scrollable table">
          <table class="lib-table">
            <thead><tr><th>Model Name</th><th>Model Link</th><th>Minutes (Hours)</th><th>Grams</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>
              ${libEntries.map(([key, e], idx) => {
                const rowId = `lib-row-${idx}`;
                const encodedKey = encodeURIComponent(key);
                const isEditingLink = state.libraryEditingKey === key;
                return `<tr>
                  <td><input type="text" id="${rowId}-name" value="${esc(e.name || '')}" placeholder="Name" oninput="queueLibraryRowSave('${encodedKey}', '${rowId}')" /></td>
                  <td>
                    <div class="lib-link-cell">
                      ${isEditingLink
                        ? `<input class="lib-link-edit" type="text" id="${rowId}-link" value="${esc(e.link || '')}" placeholder="https://makerworld.com/en/models/..." oninput="queueLibraryRowSave('${encodedKey}', '${rowId}')" />`
                        : `<input type="hidden" id="${rowId}-link" value="${esc(e.link || '')}" />
                           ${e.link ? `<a class="lib-link-chip" href="${esc(e.link)}" target="_blank" rel="noopener noreferrer" title="${esc(e.link)}">Model Link</a>` : `<span class="lib-link-empty">No Link</span>`}`
                      }
                      <button class="btn-sm" type="button" onclick="toggleLibraryLinkEdit('${encodedKey}')">${isEditingLink ? 'Done' : 'Edit'}</button>
                    </div>
                  </td>
                  <td>
                    <input type="number" id="${rowId}-mins" value="${e.minutes || ''}" min="0" step="1" placeholder="mins" oninput="queueLibraryRowSave('${encodedKey}', '${rowId}')" />
                    <div style="font-size:11px;color:var(--muted);margin-top:4px;">${e.minutes ? fmtMinutesWithHours(e.minutes) : ''}</div>
                  </td>
                  <td><input type="number" id="${rowId}-grams" value="${e.grams || ''}" min="0" step="0.1" placeholder="grams" oninput="queueLibraryRowSave('${encodedKey}', '${rowId}')" /></td>
                  <td><button class="btn-sm danger btn-icon" type="button" aria-label="Remove saved model" onclick="deleteLibraryEntry('${encodedKey}')">×</button></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

function renderOwnerCalculatorLivePreview(calc) {
  const minutes = totalPrintMinutes(calc.hours, calc.minutes);
  const grams = parseFloat(calc.grams);
  const qty = Math.max(1, parseInt(calc.qty, 10) || 1);
  if (!minutes || !grams) {
    return `<div style="font-size:12px;color:var(--muted);line-height:1.8;">Fill in print time and filament weight to see the quote update live here.</div>`;
  }
  const perPrint = calcPerPrint(minutes, grams, calc.filType);
  const total = perPrint * qty;
  return `
    <div class="price-big">$${total.toFixed(2)}</div>
    <div style="font-size:12px;color:var(--muted);margin-top:6px;">Owner price for ${qty} print${qty === 1 ? '' : 's'} using ${FIL_LABEL[calc.filType] || calc.filType} filament.</div>
    <div class="calc-stat-grid">
      <div class="calc-stat"><div class="calc-stat-label">Per Print</div><div class="calc-stat-value accent">$${perPrint.toFixed(2)}</div></div>
      <div class="calc-stat"><div class="calc-stat-label">Quantity</div><div class="calc-stat-value">${qty}</div></div>
      <div class="calc-stat"><div class="calc-stat-label">Print Time</div><div class="calc-stat-value">${fmtTime(minutes)}</div></div>
      <div class="calc-stat"><div class="calc-stat-label">Filament</div><div class="calc-stat-value green">${grams.toFixed(1)}g</div></div>
    </div>
    <div class="price-preview-box" style="margin-top:16px;">
      <div class="card-title" style="margin-bottom:8px;">Breakdown</div>
      <div class="price-breakdown">$2.00 flat × ${qty} = $${(2 * qty).toFixed(2)}
${fmtMinutesWithHours(minutes)} × $0.024 × ${qty} = $${(minutes * 0.024 * qty).toFixed(2)}
${grams.toFixed(1)}g × $${(FIL_RATE[calc.filType] ?? 0.024).toFixed(3)} × ${qty} = $${(grams * (FIL_RATE[calc.filType] ?? 0.024) * qty).toFixed(2)}
$${perPrint.toFixed(2)} per print × ${qty}</div>
    </div>`;
}

function renderOwnerCalculatorPage() {
  const calc = state.ownerCalculator || blankOwnerCalculator();
  const minutes = totalPrintMinutes(calc.hours, calc.minutes);
  const grams = parseFloat(calc.grams);
  const qty = Math.max(1, parseInt(calc.qty, 10) || 1);
  const hasNumbers = Number.isFinite(minutes) && minutes > 0 && Number.isFinite(grams) && grams > 0;
  const saved = calc.lastResult;
  const modelMatch = getKnownEstimate({ link: calc.link, name: calc.name });
  const canSave = !!modelKeyFromItem({ link: calc.link, name: calc.name }) && hasNumbers;

  return `
    <div class="owner-page-header">
      <div class="section-header">
        <div class="section-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3h14v18H5z"/><path d="M8 7h8M8 11h3M8 15h8"/></svg>
        </div>
        <div><h2 class="section-title">Owner Calculator</h2><div class="section-sub">Price a model instantly, then save it into your reusable model data</div></div>
      </div>
      <div class="owner-page-meta">${sortedLibraryEntries().length} saved model${sortedLibraryEntries().length === 1 ? '' : 's'}</div>
    </div>
    <div class="card">
      <h3 class="card-title">Calculate And Save</h3>
      <div class="calc-shell">
        <div class="calc-form-card">
          <div class="lib-grid">
            <div class="field"><label>Model link</label><input type="text" id="owner-calc-link" value="${esc(calc.link)}" placeholder="https://makerworld.com/en/models/..." oninput="updateOwnerCalculatorField('link', this.value)" /></div>
            <div class="field"><label>Model name</label><input type="text" id="owner-calc-name" value="${esc(calc.name)}" placeholder="Model name" oninput="updateOwnerCalculatorField('name', this.value)" /></div>
            <div class="field"><label>Hours</label><input type="number" id="owner-calc-hours" value="${esc(calc.hours)}" min="0" step="1" placeholder="2" oninput="updateOwnerCalculatorField('hours', this.value)" /></div>
            <div class="field"><label>Minutes</label><input type="number" id="owner-calc-mins" value="${esc(calc.minutes)}" min="0" max="59" step="1" placeholder="30" oninput="updateOwnerCalculatorField('minutes', this.value)" /></div>
            <div class="field"><label>Print Time (min.)</label><input class="print-time-output" type="number" id="owner-calc-print-time" value="${minutes || ''}" placeholder="Auto" readonly /></div>
            <div class="field"><label>Filament (g)</label><input type="number" id="owner-calc-grams" value="${esc(calc.grams)}" min="0" step="0.1" placeholder="85.4" oninput="updateOwnerCalculatorField('grams', this.value)" /></div>
            <div class="field">
              <label>Filament type</label>
              <select id="owner-calc-fil" onchange="updateOwnerCalculatorField('filType', this.value)">
                ${Object.entries(FIL_LABEL).map(([value, label]) => `<option value="${value}" ${calc.filType === value ? 'selected' : ''}>${label}</option>`).join('')}
              </select>
            </div>
            <div class="field"><label>Quantity</label><input type="number" id="owner-calc-qty" value="${qty}" min="1" step="1" oninput="updateOwnerCalculatorField('qty', this.value)" /></div>
          </div>
          ${modelMatch ? `
            <div class="calc-match">
              <strong>Saved model found</strong>
              <div style="font-size:12px;color:var(--muted);">This model already exists in your library with ${fmtMinutesWithHours(modelMatch.minutes)}, ${modelMatch.grams}g, ${FIL_LABEL[modelMatch.filType] || modelMatch.filType}. Saving here will update it with the values in this calculator.</div>
            </div>
          ` : ``}
          <div class="calc-actions">
            <button class="btn-sm" id="owner-calc-save" type="button" onclick="calculateAndSaveOwnerModel()" ${canSave ? '' : 'disabled'}>Calculate &amp; Save Model</button>
            <button class="btn-sm" type="button" onclick="resetOwnerCalculator()">Clear</button>
          </div>
          <div class="alert error" id="owner-calc-err"></div>
          <div class="alert success" id="owner-calc-ok"></div>
          <div class="calc-hint">${canSave ? 'Press Enter in any calculator field to save this model.' : 'Add a model name or link, plus minutes and grams, to enable saving.'}</div>
        </div>
        <div class="calc-summary-card">
          <h3 class="card-title">Live Quote Preview</h3>
          <div id="owner-calc-live-preview">${renderOwnerCalculatorLivePreview(calc)}</div>
          ${saved ? `
            <div class="total-box">
              <span class="total-label">Last saved model</span>
              <span class="total-price">$${saved.total.toFixed(2)}</span>
            </div>
            <div style="font-size:12px;color:var(--muted);margin-top:10px;">
              Saved ${esc(saved.name || 'Unnamed model')} with ${fmtMinutesWithHours(saved.minutes)}, ${saved.grams}g, ${FIL_LABEL[saved.filType] || saved.filType}, qty ${saved.qty}.
            </div>
          ` : ``}
        </div>
      </div>
    </div>
  `;
}

function renderOwnerAnalyticsPage() {
  const rows = filteredModelAnalyticsRows();
  const totalQuotes = rows.reduce((sum, row) => sum + row.quoteRequests, 0);
  const totalSoldQty = rows.reduce((sum, row) => sum + row.quantityOrdered, 0);
  const totalSoldRevenue = rows.reduce((sum, row) => sum + row.moneySold, 0);

  return `
    <div class="owner-page-header">
      <div class="section-header">
        <div class="section-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19h16M7 16V8M12 16V5M17 16v-3"/></svg>
        </div>
        <div><h2 class="section-title">Sales Data</h2><div class="section-sub">Search quote demand and order performance by model</div></div>
      </div>
      <div class="owner-page-meta">${rows.length} model${rows.length === 1 ? '' : 's'} shown</div>
    </div>
    <div class="stats-row">
      <div class="stat-card"><div class="stat-val orange">${totalQuotes}</div><div class="stat-label">Quote Requests</div></div>
      <div class="stat-card"><div class="stat-val">${totalSoldQty}</div><div class="stat-label">Units Ordered</div></div>
      <div class="stat-card"><div class="stat-val green">$${totalSoldRevenue.toFixed(0)}</div><div class="stat-label">Money Sold</div></div>
    </div>
    <div class="card">
      <h3 class="card-title">Searchable Model Data</h3>
      <div class="analytics-toolbar">
        <div class="field">
          <label>Search models</label>
          <input type="text" id="analytics-query" value="${esc(state.analyticsQuery)}" placeholder="Search by model name or link" oninput="updateAnalyticsQuery(this.value)" />
        </div>
        <button type="button" class="btn-sm" onclick="exportModelAnalyticsCSV()">Export CSV</button>
      </div>
      ${!rows.length ? `<div style="font-size:12px;color:var(--muted);">No models match that search yet.</div>` : `
        <div class="owner-sheet-wrap" tabindex="0" role="region" aria-label="Scrollable table">
          <table class="analytics-table">
            <thead>
              <tr>
                <th>Model Name</th>
                <th>Model</th>
                <th>Quote Requests</th>
                <th>Orders</th>
                <th>Money Sold</th>
                <th>Customers</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(row => `
                <tr>
                  <td>${esc(row.modelName || 'Unnamed')}</td>
                  <td>${row.modelLink ? `<a href="${esc(row.modelLink)}" target="_blank" rel="noopener noreferrer">Open</a>` : `<span style="color:var(--muted);">No link</span>`}</td>
                  <td class="num">${row.quoteRequests}</td>
                  <td class="num">${row.quantityOrdered}</td>
                  <td class="num">$${row.moneySold.toFixed(2)}</td>
                  <td class="num">${row.differentCustomers}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

function renderOwnerBatch(b) {
  const phase = b.phase || 'estimate';
  const allDone = b.items.every(it => it.minutes && it.grams);
  const total = allDone ? orderSum(b) : null;
  const hasSpecial = b.items.some(usesRolls);
  const checks = b.items.some(it => rollParts(it).length) ? leftoverChecks(b) : [];
  const rollProblem = checks.some(list => list.some(c => !c.ok));
  const createdLabel = new Date(b.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  return `<div class="job-card ${phase}" id="order-${b.id}">
    <div class="job-header">
      <div>
        <div class="job-title">${esc(b.clientName)}</div>
        <div class="job-meta">
          <a href="mailto:${esc(b.clientEmail)}" style="color:var(--accent);">${esc(b.clientEmail)}</a>
          · ${b.items.length} item${b.items.length>1?'s':''}
          · ${createdLabel}
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <span class="status ${phase}">${phaseLabel(phase)}</span>
        <span class="status ${b.paymentStatus || 'unpaid'}">${paymentLabel(b.paymentStatus || 'unpaid')}</span>
        ${phase === 'quote_sent' && b.customerApprovedAt ? `<span class="status quoted" title="Approved ${esc(formatAustinTime(b.customerApprovedAt))}">Customer approved</span>` : ''}
        <button class="btn-sm danger" onclick="deleteBatch('${b.id}')">✕</button>
      </div>
    </div>
    <div class="owner-batch-controls">
      <div class="field" style="margin-bottom:0;">
        <label>Order Phase</label>
        <select class="phase-select" onchange="updateBatchPhase('${b.id}', this.value)">
          ${ORDER_PHASES.map((p, idx) => {
            const currentIdx = phaseIndex(b.phase || 'estimate');
            const isAllowed = idx === currentIdx || idx === currentIdx + 1;
            return `<option value="${p.id}" ${(b.phase||'estimate')===p.id?'selected':''} ${isAllowed ? '' : 'disabled'}>${p.label}</option>`;
          }).join('')}
        </select>
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>Payment Status</label>
        <select class="phase-select" onchange="updatePaymentStatus('${b.id}', this.value)">
          ${PAYMENT_PHASES.map((p, idx) => {
            const currentIdx = paymentIndex(b.paymentStatus || 'unpaid');
            const isAllowed = idx === currentIdx || idx === currentIdx + 1;
            return `<option value="${p.id}" ${(b.paymentStatus||'unpaid')===p.id?'selected':''} ${isAllowed ? '' : 'disabled'}>${p.label}</option>`;
          }).join('')}
        </select>
      </div>
    </div>
    <div class="owner-order-summary">
      <div class="card-title" style="margin-bottom:10px;">Submitted Order Summary</div>
      <div class="owner-order-summary-grid">
        <div>
          <div class="owner-order-summary-label">Customer</div>
          <div class="owner-order-summary-value">${esc(b.clientName)}</div>
        </div>
        <div>
          <div class="owner-order-summary-label">Email</div>
          <div class="owner-order-summary-value"><a href="mailto:${esc(b.clientEmail)}" style="color:var(--accent);">${esc(b.clientEmail)}</a></div>
        </div>
        <div>
          <div class="owner-order-summary-label">Submitted</div>
          <div class="owner-order-summary-value">${createdLabel}</div>
        </div>
        <div>
          <div class="owner-order-summary-label">Items</div>
          <div class="owner-order-summary-value">${b.items.length}</div>
        </div>
      </div>
      <div class="owner-item-summary-list">
        ${b.items.map((it, i) => `
          <div class="owner-item-summary">
            <div class="owner-order-summary-label">Item ${i + 1}</div>
            <div class="owner-order-summary-value"><strong>${esc(it.name || 'Unnamed')}</strong>${it.qty > 1 ? ` x ${it.qty}` : ''}</div>
            <div class="owner-order-summary-value">Filament: ${esc(filamentLabel(it))}</div>
            ${(checks[i] || []).map(c => `<div class="owner-order-summary-value roll-check ${c.ok ? 'ok' : 'bad'}">${c.ok ? '' : '⚠ '}${esc(c.text)}</div>`).join('')}
            <div class="owner-order-summary-value">Submitted grams: ${it.grams ? `${parseFloat(it.grams).toFixed(1)}g` : 'Not provided'}</div>
            <div class="owner-order-summary-value">Link: ${isWebUrl(it.link) ? `<a href="${esc(it.link)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);">Open model</a>` : esc(it.link || 'Not provided')}</div>
            <div class="owner-order-summary-value">Notes: ${esc(it.notes || 'None')}</div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="job-divider"></div>
    ${b.items.map((it, i) => renderOwnerItem(b.id, it, i)).join('')}
    ${phase === 'estimate' ? `
      ${hasSpecial ? `
        <div class="field special-order">
          <label for="special-cost-${b.id}">Special order roll cost ($)</label>
          <input type="number" id="special-cost-${b.id}" min="0" step="0.01" value="${(rollProblem && !Number.isFinite(b.specialOrderCost) ? SPECIAL_ORDER_TYPICAL : specialOrderCost(b)).toFixed(2)}" />
          <div class="field-help">The full 1 kg roll, charged instead of material. Usually about $${SPECIAL_ORDER_TYPICAL}. Use 0 when they're printing from their own leftover roll (within 2 months).</div>
        </div>` : ''}
      <div class="alert error" id="batch-err-${b.id}"></div>
      <div class="alert success" id="batch-ok-${b.id}"></div>
      <button class="btn-primary" id="approve-btn-${b.id}" onclick="approveBatch('${b.id}')" style="margin-top:1rem;">
        Save All &amp; Notify Client
      </button>
    ` : `
      <div class="total-box">
        <span class="total-label">Total quoted${specialOrderCost(b) ? ` (includes $${specialOrderCost(b).toFixed(2)} special order roll)` : ''}</span>
        <span class="total-price">$${total!==null?total.toFixed(2):'—'}</span>
      </div>
      ${phase === 'delivered' ? `
        <div class="delivery-meta">
          <div class="card-title" style="margin-bottom:10px;">Delivered Order Details</div>
          <div class="row2">
            <div class="field" style="margin-bottom:0;">
              <label>Delivery Date</label>
              <input type="text" id="ddate-${b.id}" value="${esc(b.deliveryDate || '')}" placeholder="Apr 3, 2026" />
            </div>
            <div class="field" style="margin-bottom:0;">
              <label>Tracking / Pickup</label>
              <input type="text" id="dtrack-${b.id}" value="${esc(b.deliveryTracking || '')}" placeholder="Tracking number or pickup note" />
            </div>
          </div>
          <div class="field" style="margin-top:10px;margin-bottom:0;">
            <label>Delivery Notes</label>
            <textarea id="dnotes-${b.id}" placeholder="Any details you send with final delivery">${esc(b.deliveryNotes || '')}</textarea>
          </div>
          <button class="btn-secondary" onclick="saveDeliveryInfo('${b.id}')" style="margin-top:10px;">Save Delivery Details</button>
        </div>
      ` : ``}
      <button class="btn-secondary" onclick="resetBatch('${b.id}')" style="margin-top:0.75rem;">Edit Quotes</button>
    `}
  </div>`;
}

function renderOwnerItem(batchId, it, i) {
  const pp  = it.minutes && it.grams ? calcPerPrint(it.minutes, it.grams, it) : null;
  const tot = pp !== null ? pp * it.qty : null;
  const known = getKnownEstimate(it);
  const canUseKnown = known && (!it.minutes || !it.grams);
  return `<div class="sub-item" style="padding:1rem 0;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:10px;">
      <div style="display:flow-root;min-width:0;">${renderModelThumb(it)}
        <div class="sub-item-name">${esc(it.name)||'Unnamed'} ${it.qty>1?`<span style="color:var(--muted);font-weight:400;">× ${it.qty}</span>`:''}</div>
        <div class="sub-item-meta">
          <span class="status ${it.filType}">${esc(filamentLabel(it))}</span>
          <span style="font-size:12px;color:var(--muted);">$${itemRate(it).toFixed(3)}/g</span>
          ${isWebUrl(it.link)?`<a class="job-link" href="${esc(it.link)}" target="_blank">Model Link ↗</a>`: it.link ? `<span style="color:var(--muted);">${esc(it.link)}</span>` : ''}
        </div>
        ${it.notes?`<div style="font-size:12px;color:var(--muted);font-style:italic;margin-top:4px;">"${esc(it.notes)}"</div>`:''}
        ${it.estimateSource ? `<div style="font-size:12px;color:var(--muted);margin-top:4px;">Time and grams auto-filled from ${esc(it.estimateSource)}</div>` : ''}
        ${renderPhotoLinks(it.imageLinks)}
        ${canUseKnown ? `
          <div class="price-preview-box" style="margin-top:10px;margin-bottom:0;">
            <div class="card-title" style="margin-bottom:6px;">Saved Model Match</div>
            <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Found saved estimate data for this model name: ${fmtMinutesWithHours(known.minutes)}, ${known.grams}g.</div>
            <button class="btn-sm" type="button" onclick="applyKnownEstimateToOwnerItem('${batchId}', ${i})">Use Saved Model</button>
          </div>
        ` : ``}
      </div>
      ${tot!==null?`<div style="text-align:right;flex-shrink:0;">
        <div class="sub-item-price">$${tot.toFixed(2)}</div>
        ${it.qty>1?`<div style="font-size:11px;color:var(--muted);">$${pp.toFixed(2)} ea</div>`:''}
      </div>`:''}
    </div>
    <div class="row3">
      <div class="field" style="margin-bottom:0;">
        <label>Hours</label>
        <input type="number" id="hours-${batchId}-${i}" value="${hoursFromMinutes(it.minutes)}"
          placeholder="2" min="0" step="1" oninput="updateOwnerItemPrintTime('${batchId}',${i})" />
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>Minutes</label>
        <input type="number" id="minutes-${batchId}-${i}" value="${minuteRemainder(it.minutes)}"
          placeholder="30" min="0" max="59" step="1" oninput="updateOwnerItemPrintTime('${batchId}',${i})" />
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>Print Time (min.)</label>
        <input class="print-time-output" type="number" id="mins-${batchId}-${i}" value="${it.minutes||''}"
          placeholder="Auto" readonly />
      </div>
    </div>
    <div class="row2" style="margin-top:12px;">
      <div class="field" style="margin-bottom:0;">
        <label>Filament (grams)</label>
        <input type="number" id="ograms-${batchId}-${i}" value="${it.grams||''}"
          placeholder="From Bambu Studio" min="0" step="0.1" oninput="previewOwnerItem('${batchId}',${i})" />
      </div>
    </div>
    <div id="opreview-${batchId}-${i}" style="display:none;" class="price-preview-box">
      <div class="price-big" id="opval-${batchId}-${i}"></div>
      <div class="price-breakdown" id="opsub-${batchId}-${i}"></div>
    </div>
  </div>`;
}

// ── INTERACTIONS ──────────────────────────────────────────────────────────

function setTab(tab) {
  state.clientTab = tab;
  if (tab === 'gallery') state.galleryOpen = '';
  render();
  if (tab === 'gallery') loadGallery().then(render);
}
function goHome() {
  state.clientTab = 'submit';
  if (state.view === 'owner') { showClientView(); return; }
  render();
}
async function switchToOwner() {
  state.view = 'owner';
  if (state.ownerUnlocked) await loadBatches();
  render();
}
// The owner view loads every order; reload just the looked-up customer's orders for the client view.
async function showClientView() {
  state.view = 'client';
  state.batches = [];
  if (state.historyEmail) await loadBatches(state.historyEmail);
  render();
}
function setOwnerTab(tab) {
  state.ownerTab = tab;
  if (tab === 'analytics' && !state.ownerHistoryAll) { loadAllOrders(); return; }
  render();
  if (tab === 'gallery') loadGallery().then(() => { render(); backfillThumbnails(); });
  if (tab === 'settings') { state.settingsDraft = null; Promise.all([loadSettings(), loadGallery()]).then(render); }
  if (tab === 'emails') { state.emailsDraft = null; loadSettings().then(render); }
}
function updateAnalyticsQuery(value) { state.analyticsQuery = value; render(); }
function updateOwnerCalculatorField(field, value) {
  if (!state.ownerCalculator) state.ownerCalculator = blankOwnerCalculator();
  state.ownerCalculator[field] = value;
  const printMinutes = totalPrintMinutes(state.ownerCalculator.hours, state.ownerCalculator.minutes);
  const printTimeInput = document.getElementById('owner-calc-print-time');
  if (printTimeInput) printTimeInput.value = printMinutes || '';
  const livePreview = document.getElementById('owner-calc-live-preview');
  if (livePreview) livePreview.innerHTML = renderOwnerCalculatorLivePreview(state.ownerCalculator);
  const err = document.getElementById('owner-calc-err');
  const ok = document.getElementById('owner-calc-ok');
  if (err) err.style.display = 'none';
  if (ok) ok.style.display = 'none';
  const saveButton = document.getElementById('owner-calc-save');
  if (saveButton) {
    const hasModel = !!modelKeyFromItem({ link: state.ownerCalculator.link, name: state.ownerCalculator.name });
    const hasTime = !!printMinutes;
    const hasGrams = Number(state.ownerCalculator.grams) > 0;
    saveButton.disabled = !(hasModel && hasTime && hasGrams);
  }
}

function clearEstimateSource(i) {
  if (!state.draftItems[i] || !state.draftItems[i].estimateSource) return;
  state.draftItems[i].estimateSource = '';
  rerenderModelPreview(i);
}

function updateDraftPrintTime(i, field, value) {
  if (!state.draftItems[i]) return;
  clearEstimateSource(i);
  state.draftItems[i][field === 'hours' ? 'printHours' : 'printMinutes'] = value;
  const printTimeInput = document.getElementById(`print-time-${i}`);
  const total = totalPrintMinutes(state.draftItems[i].printHours, state.draftItems[i].printMinutes);
  if (printTimeInput) printTimeInput.value = total || '';
  updateCustomerPricePreview(i);
}

function updateCustomerPricePreview(i) {
  const preview = document.getElementById(`customer-price-preview-${i}`);
  const item = state.draftItems[i];
  if (preview && item) preview.innerHTML = renderCustomerPricePreview(item);
}

function updateOwnerItemPrintTime(batchId, i) {
  const hours = (document.getElementById(`hours-${batchId}-${i}`) || { value: '' }).value;
  const minutes = (document.getElementById(`minutes-${batchId}-${i}`) || { value: '' }).value;
  const total = totalPrintMinutes(hours, minutes);
  const minutesInput = document.getElementById(`mins-${batchId}-${i}`);
  if (minutesInput) minutesInput.value = total || '';
  previewOwnerItem(batchId, i);
}

async function lookupMyRequests() {
  const email = String((document.getElementById('history-email') || { value: state.historyEmail }).value || '').trim().toLowerCase();
  if (!email || !email.includes('@') || !email.includes('.')) {
    showAlert('history-err', 'Please enter a valid email to view your request history.', 'error');
    return;
  }
  state.historyEmail = email;
  persistClientHistoryEmail();
  await loadBatches(email);
  render();
}

// ── SITE SETTINGS ─────────────────────────────────────────────────────────
// One row in site_settings (supabase/site-settings.sql): anyone can read it, only the owner edits it
// from the Site Settings tab. Everything has a default so the site works before it's filled in.
const DEFAULT_ABOUT = "I'm a veteran spouse who does 3D design and printing on the side. I'm happy to take on custom design projects and bring ideas to life, and design work is free for veterans: I only charge for material and print time.";
function blankSettings() {
  return { about: { text: DEFAULT_ABOUT, photo: '', replyTime: '' }, links: { messenger: '', etsy: '' }, colors: [], reviews: [], emails: {} };
}

// Only the parts the owner changed are kept, so improvements to the default text still reach them.
function cleanEmails(raw) {
  const out = {};
  const src = raw && typeof raw === 'object' ? raw : {};
  Object.keys(EMAIL_TEMPLATES).forEach(key => {
    const own = src[key] && typeof src[key] === 'object' ? src[key] : {};
    const def = EMAIL_TEMPLATES[key];
    const subject = cleanText(own.subject, 200).replace(/\s*\n\s*/g, ' ');
    const body = cleanText(own.body, 5000).replace(/\r\n?/g, '\n');
    const entry = {};
    if (def.subject && subject.trim() && subject !== def.subject) entry.subject = subject;
    if (body.trim() && body !== def.body) entry.body = body;
    if (Object.keys(entry).length) out[key] = entry;
  });
  return out;
}

function safeLink(url, hosts) {
  const u = String(url || '').trim();
  return /^https:\/\//i.test(u) && (!hosts || hosts.some(h => new RegExp(`^https://([a-z0-9-]+\\.)*${h.replace('.', '\\.')}(/|$)`, 'i').test(u))) ? u.slice(0, 300) : '';
}

function cleanSettings(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const def = blankSettings();
  const about = d.about && typeof d.about === 'object' ? d.about : {};
  const links = d.links && typeof d.links === 'object' ? d.links : {};
  return {
    about: { text: cleanText(about.text, 1500) || def.about.text, photo: safeImageUrl(about.photo), replyTime: cleanText(about.replyTime, 80) },
    links: { messenger: safeLink(links.messenger, ['m.me', 'messenger.com', 'facebook.com']), etsy: safeLink(links.etsy, ['etsy.com']) },
    colors: (Array.isArray(d.colors) ? d.colors : []).slice(0, 30).map(c => ({
      id: /^[a-z0-9-]{1,40}$/.test(String(c && c.id)) ? c.id : '',
      name: cleanText(c && c.name, 40).trim(),
      hex: /^#[0-9a-f]{6}$/i.test(String(c && c.hex)) ? c.hex : '#888888',
      special: !!(c && c.special)
    })).filter(c => c.id && c.name).sort(byName),
    reviews: (Array.isArray(d.reviews) ? d.reviews : []).slice(0, 40).map(r => ({
      id: /^[a-z0-9-]{1,40}$/.test(String(r && r.id)) ? r.id : '',
      name: cleanText(r && r.name, 60).trim(),
      text: cleanText(r && r.text, 600).trim(),
      designId: /^[A-Za-z0-9_-]{1,64}$/.test(String(r && r.designId)) ? r.designId : ''
    })).filter(r => r.id && r.text),
    emails: cleanEmails(d.emails)
  };
}

state.settings = blankSettings();
async function loadSettings() {
  try {
    const rows = await supaFetch('/site_settings?id=eq.1&select=data');
    if (rows && rows[0]) state.settings = cleanSettings(rows[0].data);
    state.settingsError = false;
  } catch (e) {
    console.error('Settings load error:', e); // table not set up yet: defaults stay
    state.settingsError = true;
  }
}

async function saveSettings(next) {
  const clean = cleanSettings(next);
  await supaFetch('/site_settings', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: 1, data: clean })
  });
  state.settings = clean;
}

// Filament color names that aren't CSS colors, or whose CSS color looks wrong for filament.
const FILAMENT_COLOR_NAMES = {
  'rose gold': '#b76e79', 'gold': '#d4af37', 'silver': '#c0c0c0', 'bronze': '#cd7f32', 'copper': '#b87333',
  'army green': '#4b5320', 'olive green': '#708238', 'forest green': '#228b22', 'grass green': '#5aa02c',
  'lime green': '#32cd32', 'mint green': '#98ff98', 'mint': '#98ff98', 'sage': '#9caf88', 'jade': '#00a86b',
  'neon green': '#39ff14', 'neon yellow': '#e9ff32', 'neon orange': '#ff6f1a', 'neon pink': '#ff3fa4',
  'glow': '#c8f5a0', 'glow in the dark': '#c8f5a0', 'wood': '#a0763f', 'marble': '#e2dfd8', 'stone': '#8d8a83',
  'clear': '#e8f4f8', 'transparent': '#e8f4f8', 'natural': '#efe8d8', 'ivory': '#fffff0', 'cream': '#fffdd0',
  'bone white': '#f9f6ee', 'charcoal': '#36454f', 'space gray': '#5b5f66', 'space grey': '#5b5f66',
  'dark gray': '#4a4a4a', 'dark grey': '#4a4a4a', 'light gray': '#c8c8c8', 'light grey': '#c8c8c8',
  'gray': '#8c8c8c', 'grey': '#8c8c8c', 'burgundy': '#800020', 'maroon': '#800000', 'wine': '#722f37',
  'navy blue': '#1f2a5c', 'navy': '#1f2a5c', 'sky blue': '#87ceeb', 'baby blue': '#89cff0', 'cobalt': '#0047ab',
  'teal': '#008080', 'cyan': '#00bcd4', 'aqua': '#00c8c8', 'turquoise': '#30d5c8', 'lavender': '#b57edc',
  'lilac': '#c8a2c8', 'purple': '#7b2fbe', 'violet': '#8f00ff', 'magenta': '#d0209f', 'hot pink': '#ff69b4',
  'pink': '#f7a8c4', 'peach': '#ffcba4', 'coral': '#ff7f50', 'orange': '#ff7a00', 'yellow': '#ffd400',
  'red': '#d12a2a', 'green': '#2e9e44', 'blue': '#1f5fd1', 'brown': '#6f4e37', 'tan': '#d2b48c', 'beige': '#e8dcc0',
  'black': '#1e1e24', 'white': '#f4f4f4', 'rainbow': '#ff7a00'
};
const COLOR_FILLER_WORDS = /\b(silk|matte|matt|glossy|satin|metallic|shiny|sparkle|galaxy|pla\+?|petg|abs|tpu|asa|basic|pro|tough|high speed|translucent|filament|color|colour)\b/g;

// Best guess at a hex color for a filament name like "Silk Rose Gold" or "Matte Dark Blue".
function guessColorHex(name) {
  const plain = String(name || '').toLowerCase().replace(/[-_]/g, ' ').replace(/[^a-z +]/g, ' ');
  const words = plain.replace(COLOR_FILLER_WORDS, ' ').replace(/\s+/g, ' ').trim();
  for (const text of [words, plain.replace(/\s+/g, ' ').trim()]) {
    if (!text) continue;
    if (FILAMENT_COLOR_NAMES[text]) return FILAMENT_COLOR_NAMES[text];
    const css = cssColorHex(text);
    if (css) return css;
  }
  // Longest known name inside the text wins, so "dark forest green" finds "forest green".
  const known = Object.keys(FILAMENT_COLOR_NAMES).sort((a, b) => b.length - a.length)
    .find(k => new RegExp(`\\b${k}\\b`).test(words || plain));
  if (known) return FILAMENT_COLOR_NAMES[known];
  const single = (words || plain).split(' ').reverse().map(cssColorHex).find(Boolean);
  return single || '';
}

// Resolves a CSS color name ("darkorange", "dark orange") to hex using the browser.
function cssColorHex(text) {
  const name = String(text).replace(/\s+/g, '');
  if (!/^[a-z]{3,30}$/.test(name)) return '';
  const ctx = (cssColorHex.ctx ||= document.createElement('canvas').getContext('2d'));
  if (!ctx) return '';
  ctx.fillStyle = '#000000';
  ctx.fillStyle = name;
  const first = ctx.fillStyle;
  ctx.fillStyle = '#ffffff';
  ctx.fillStyle = name;
  return first === ctx.fillStyle && /^#[0-9a-f]{6}$/.test(first) ? first : '';
}

// Keeps the owner's color list in A–Z order once a name is finished (blank new rows stay at the end).
function sortSettingsColors() {
  const colors = state.settingsDraft && state.settingsDraft.colors;
  if (!colors) return;
  const named = colors.filter(c => String(c.name || '').trim()).sort(byName);
  const order = [...named, ...colors.filter(c => !String(c.name || '').trim())];
  if (order.every((c, n) => c === colors[n])) return;
  state.settingsDraft.colors = order;
  render();
}

function onColorNameInput(n, value) {
  const c = state.settingsDraft.colors[n];
  if (!c) return;
  c.name = value;
  if (c.hexManual) return;
  const hex = guessColorHex(value);
  if (!hex) return;
  c.hex = hex;
  const picker = document.getElementById(`color-hex-${n}`);
  if (picker) picker.value = hex;
}

function settingsId() {
  return Math.random().toString(36).slice(2, 10);
}

// ── EMAILS ────────────────────────────────────────────────────────────────
// Owner tab to read and edit every automated email. Text is saved in site settings (`emails`), and the
// Google script (email/Code.gs) reads it when it sends. Defaults live in email-templates.js.
const EMAIL_SAMPLE = {
  name: 'Jane', customerName: 'Jane', customerEmail: 'jane@example.com', title: 'Benchy, Phone stand',
  submitted: 'Oct 21, 2026, 2:15 PM',
  items: '1) Benchy x 2\n   Color: Red\n\n2) Phone stand\n   Color: Black\n   Notes: Make it sturdy',
  itemsWithPrices: '1) Benchy x 2\n   Color: Red\n   Price: $9.28 ($4.64 each)\n\n2) Phone stand\n   Color: Black\n   Price: $6.40\n   Notes: Make it sturdy',
  estimate: '15.68', total: '15.68', specialRoll: '', amountDue: '15.68',
  venmoLink: `https://venmo.com/${VENMO_USERNAME}?txn=pay&amount=15.68`,
  orderLink: 'https://soloprint.vercel.app/?requests=jane%40example.com#order-1729',
  delivery: 'Delivery date: Oct 24\nTracking / pickup: Porch pickup'
};

function emailPreview(key) {
  const vars = { ...EMAIL_SAMPLE };
  vars.footer = renderEmailText(emailTemplate('footer', state.emailsDraft).body, vars);
  const t = emailTemplate(key, state.emailsDraft);
  return { subject: renderEmailText(t.subject, vars).replace(/\s*\n\s*/g, ' '), body: renderEmailText(t.body, vars) };
}

function renderEmailPreview(key) {
  const p = emailPreview(key);
  return `${EMAIL_TEMPLATES[key].subject ? `<div class="email-preview-subject">${esc(p.subject)}</div>` : ''}<pre class="email-preview-body">${esc(p.body)}</pre>`;
}

function renderOwnerEmailsPage() {
  if (!state.emailsDraft) state.emailsDraft = JSON.parse(JSON.stringify(state.settings.emails || {}));
  const changed = Object.keys(cleanEmails(state.emailsDraft)).length;
  return `
    <div class="owner-page-header">
      <div class="section-header">
        <div class="section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg></div>
        <div><h2 class="section-title">Emails</h2><div class="section-sub">Every automated email, and when it's sent. Edit any of them; the preview uses a sample order.</div></div>
      </div>
    </div>
    ${state.settingsError ? `<div class="alert error" style="display:block;">Couldn't load your saved emails. If you haven't yet, run supabase/site-settings.sql in the Supabase SQL Editor.</div>` : ''}
    <div class="card">
      <h3 class="card-title">Fill-ins</h3>
      <p class="field-help" style="margin-top:0;">Type these in curly brackets and they're filled in for each order. A line whose fill-in has nothing to show (like a Venmo link once they've paid) is left out.</p>
      <dl class="email-placeholders">
        ${Object.entries(EMAIL_PLACEHOLDERS).map(([k, d]) => `<div><dt><code>{${k}}</code></dt><dd>${esc(d)}</dd></div>`).join('')}
      </dl>
    </div>
    ${renderEmailCard('footer')}
    <h3 class="email-group-title">Emails to customers</h3>
    ${emailKeysTo('Customer').map(renderEmailCard).join('')}
    <h3 class="email-group-title">Emails to you</h3>
    <p class="field-help" style="margin-top:-6px;">Only you get these, at jeffsolo49@gmail.com.</p>
    ${emailKeysTo('You').map(renderEmailCard).join('')}
    <div class="alert error" id="emails-err"></div>
    <div class="alert success" id="emails-ok"></div>
    <div class="settings-save-row">
      <button class="btn-primary" id="emails-save" onclick="saveEmailsDraft()">Save emails</button>
      ${changed ? `<div class="field-help">${changed} email${changed === 1 ? '' : 's'} changed from the default.</div>` : ''}
    </div>`;
}

function emailKeysTo(to) {
  return Object.keys(EMAIL_TEMPLATES).filter(k => k !== 'footer' && EMAIL_TEMPLATES[k].to === to);
}

function renderEmailCard(key) {
  const def = EMAIL_TEMPLATES[key];
  const t = emailTemplate(key, state.emailsDraft);
  const own = cleanEmails({ [key]: state.emailsDraft[key] })[key];
  const usedIn = key === 'footer'
    ? Object.entries(EMAIL_TEMPLATES).filter(([k]) => emailTemplate(k, state.emailsDraft).body.includes('{footer}')).map(([, d]) => d.label) : [];
  return `<div class="card email-card${key === 'footer' ? ' email-footer-card' : ''}" id="email-${key}">
    <div class="email-card-head">
      <h3 class="email-card-title">${esc(def.label)} <span class="email-to ${def.to === 'You' ? 'to-you' : ''}">${key === 'footer' ? 'Customer emails' : def.to === 'You' ? 'To you' : 'To the customer'}</span>${own ? ' <span class="swatch-note">edited</span>' : ''}</h3>
      <div class="field-help" style="margin-top:2px;">${esc(def.when)}</div>
      ${key === 'footer' ? `<div class="field-help">Shown at the end of: ${usedIn.length ? esc(usedIn.join(', ')) : 'no emails right now (add {footer} to an email to use it)'}.</div>` : ''}
    </div>
    <div class="email-card-grid">
      <div>
        ${def.subject ? `<div class="field">
          <label for="email-subject-${key}">Subject</label>
          <input type="text" id="email-subject-${key}" value="${esc(t.subject)}" maxlength="200" oninput="updateEmailDraft('${key}', 'subject', this.value)" />
        </div>` : ''}
        <div class="field" style="margin-bottom:8px;">
          <label for="email-body-${key}">${key === 'footer' ? 'Footer text' : 'Email text'}</label>
          <textarea id="email-body-${key}" rows="${key === 'footer' ? 6 : 12}" maxlength="5000" oninput="updateEmailDraft('${key}', 'body', this.value)">${esc(t.body)}</textarea>
        </div>
        ${own ? `<button type="button" class="btn-sm" onclick="resetEmail('${key}')">Reset to default</button>` : ''}
      </div>
      <div>
        <div class="owner-order-summary-label" style="margin-bottom:6px;">Preview</div>
        <div class="email-preview" id="email-preview-${key}" aria-live="polite">${renderEmailPreview(key)}</div>
      </div>
    </div>
  </div>`;
}

function updateEmailDraft(key, field, value) {
  state.emailsDraft[key] = { ...(state.emailsDraft[key] || {}), [field]: value };
  const preview = document.getElementById(`email-preview-${key}`);
  if (preview) preview.innerHTML = renderEmailPreview(key);
  // The sign-off appears in most customer emails, so refresh those previews too.
  if (key === 'footer') Object.keys(EMAIL_TEMPLATES).forEach(k => {
    const el = document.getElementById(`email-preview-${k}`);
    if (el) el.innerHTML = renderEmailPreview(k);
  });
}

function resetEmail(key) {
  delete state.emailsDraft[key];
  render();
}

async function saveEmailsDraft() {
  const btn = document.getElementById('emails-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  try {
    await saveSettings({ ...state.settings, emails: state.emailsDraft });
    state.emailsDraft = null;
    state.settingsDraft = null;
    render();
    showAlert('emails-ok', 'Emails saved. They are used from the next email sent.', 'success');
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Save emails'; }
    showAlert('emails-err', "Couldn't save. If you were logged out, log in again.", 'error');
  }
}

// Owner tab. Edits happen on a copy (state.settingsDraft) until "Save settings".
function renderOwnerSettingsPage() {
  if (!state.settingsDraft) state.settingsDraft = JSON.parse(JSON.stringify(state.settings));
  const d = state.settingsDraft;
  const designs = state.gallery;
  return `
    <div class="owner-page-header">
      <div class="section-header">
        <div class="section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></div>
        <div><h2 class="section-title">Site Settings</h2><div class="section-sub">What customers see about you, your colors, reviews and contact links</div></div>
      </div>
    </div>
    ${state.settingsError ? `<div class="alert error" style="display:block;">Couldn't load settings. If you haven't yet, run supabase/site-settings.sql in the Supabase SQL Editor.</div>` : ''}
    <div class="card">
      <h3 class="card-title">About you</h3>
      <div class="field"><label>About text</label>
        <div class="field-help">Shown at the top of the home page.</div>
        <textarea id="set-about" style="min-height:110px;" oninput="state.settingsDraft.about.text = this.value">${esc(d.about.text)}</textarea>
      </div>
      <div class="field"><label>Typical reply time (optional)</label>
        <input type="text" id="set-reply" value="${esc(d.about.replyTime)}" placeholder="I usually reply within a day" oninput="state.settingsDraft.about.replyTime = this.value" />
      </div>
      <div class="field"><label>Photo of you (optional)</label>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          ${d.about.photo ? `<img src="${esc(d.about.photo)}" alt="Current photo" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:3px solid var(--bezel);" referrerpolicy="no-referrer" />` : ''}
          <label class="btn-sm" style="display:inline-block;">${d.about.photo ? 'Replace photo' : 'Upload photo'}
            <input type="file" accept="image/*" onchange="uploadAboutPhoto(this.files[0]); this.value='';" style="display:none;" />
          </label>
          ${d.about.photo ? `<button class="btn-sm danger" type="button" onclick="state.settingsDraft.about.photo=''; render();">Remove photo</button>` : ''}
          <span class="field-help" id="about-photo-status"></span>
        </div>
      </div>
    </div>
    <div class="card">
      <h3 class="card-title">Contact links</h3>
      <div class="row2">
        <div class="field"><label>Messenger link</label><input type="text" id="set-messenger" value="${esc(d.links.messenger)}" placeholder="https://m.me/yourname" oninput="state.settingsDraft.links.messenger = this.value" /></div>
        <div class="field"><label>Etsy shop link</label><input type="text" id="set-etsy" value="${esc(d.links.etsy)}" placeholder="https://www.etsy.com/shop/YourShop" oninput="state.settingsDraft.links.etsy = this.value" /></div>
      </div>
      <div class="field-help">Each shows as a button for customers once filled in. Messenger links start with https://m.me/ (find yours in Messenger under your profile → Share).</div>
    </div>
    <div class="card">
      <h3 class="card-title">Filament colors</h3>
      <div class="field-help">Type a color name and the color picker fills in to match; tap the swatch to adjust it. The colors customers can pick. Tick "Special" for special colors and materials you carry (like Red or White TPU); they use the special rate. Anything you don't carry, customers request as a special order. With no colors listed, customers see Black, White and Special Request.</div>
      ${d.colors.map((c, n) => `
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
          <input type="color" id="color-hex-${n}" value="${esc(c.hex)}" aria-label="Color for ${esc(c.name || 'new color')}" oninput="state.settingsDraft.colors[${n}].hex = this.value; state.settingsDraft.colors[${n}].hexManual = true" style="width:46px;height:40px;padding:2px;" />
          <input type="text" value="${esc(c.name)}" aria-label="Color name" placeholder="e.g. Red" oninput="onColorNameInput(${n}, this.value)" onchange="sortSettingsColors()" style="flex:1;min-width:140px;" />
          <label style="display:flex;gap:6px;align-items:center;font-size:13px;"><input type="checkbox" ${c.special ? 'checked' : ''} onchange="state.settingsDraft.colors[${n}].special = this.checked" style="width:auto;" /> Special</label>
          <button class="btn-sm danger" type="button" onclick="state.settingsDraft.colors.splice(${n}, 1); render();" aria-label="Remove ${esc(c.name || 'color')}">Remove</button>
        </div>`).join('')}
      <button class="btn-sm" type="button" onclick="state.settingsDraft.colors.push({ id: settingsId(), name: '', hex: '#888888', special: false }); render();">Add a color</button>
      ${d.colors.length ? '' : ` <button class="btn-sm" type="button" onclick="state.settingsDraft.colors = [{ id: 'black', name: 'Black', hex: '#1e1e24', special: false }, { id: 'white', name: 'White', hex: '#f4f4f4', special: false }]; render();">Start with Black and White</button>`}
    </div>
    <div class="card">
      <h3 class="card-title">Customer reviews</h3>
      <div class="field-help">Add real reviews customers have given you, with their permission. They show on the home page, and on a design's page if you link them to it.</div>
      ${d.reviews.map((r, n) => `
        <div class="item-block" style="margin-bottom:10px;">
          <div class="row2">
            <div class="field"><label>Customer name</label><input type="text" value="${esc(r.name)}" placeholder="Jane S." oninput="state.settingsDraft.reviews[${n}].name = this.value" /></div>
            <div class="field"><label>Design (optional)</label>
              <select onchange="state.settingsDraft.reviews[${n}].designId = this.value">
                <option value="">Not linked to a design</option>
                ${designs.map(g => `<option value="${esc(g.id)}" ${r.designId === g.id ? 'selected' : ''}>${esc(g.title || 'Untitled')}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field"><label>Review</label><textarea placeholder="What they said" oninput="state.settingsDraft.reviews[${n}].text = this.value">${esc(r.text)}</textarea></div>
          <button class="btn-sm danger" type="button" onclick="state.settingsDraft.reviews.splice(${n}, 1); render();">Remove review</button>
        </div>`).join('')}
      <button class="btn-sm" type="button" onclick="state.settingsDraft.reviews.push({ id: settingsId(), name: '', text: '', designId: '' }); render();">Add a review</button>
    </div>
    <div class="alert error" id="settings-err"></div>
    <div class="alert success" id="settings-ok"></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <button class="btn-primary" style="max-width:260px;" type="button" id="settings-save" onclick="saveSettingsDraft()">Save settings</button>
      <button class="btn-sm" type="button" onclick="state.settingsDraft = null; render();">Undo changes</button>
    </div>`;
}

async function saveSettingsDraft() {
  const btn = document.getElementById('settings-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  const d = state.settingsDraft;
  d.colors.forEach(c => { c.name = String(c.name || '').trim(); });
  d.colors.sort(byName);
  try {
    await saveSettings(d);
    state.settingsDraft = null;
    render();
    showAlert('settings-ok', 'Settings saved. Customers see the changes right away.', 'success');
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Save settings'; }
    showAlert('settings-err', "Couldn't save. If you were logged out, log in again; if this is the first time, run supabase/site-settings.sql.", 'error');
  }
}

async function uploadAboutPhoto(file) {
  const status = document.getElementById('about-photo-status');
  const token = getOwnerToken();
  if (!file || !token) return;
  if (status) status.textContent = 'Uploading...';
  try {
    const blob = await resizePhoto(file, 800);
    const path = `site/about-${Date.now()}.jpg`;
    await uploadStoredPhoto(path, blob, token);
    state.settingsDraft.about.photo = GALLERY_PUBLIC_PREFIX + path;
    render();
    showAlert('settings-ok', 'Photo uploaded. Click Save settings to show it.', 'success');
  } catch (e) {
    if (status) status.textContent = "Couldn't upload. Try a JPG or PNG, and check you're logged in.";
  }
}

// ── GALLERY ───────────────────────────────────────────────────────────────
// Finished work with prices. Stored in the gallery_items table (supabase/gallery.sql):
// visitors see published items, the signed-in owner sees and edits everything.
function cleanGalleryItem(row) {
  const data = row && row.data && typeof row.data === 'object' ? row.data : {};
  const id = String(row && row.id || '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return {
    id,
    published: row.published !== false,
    sortOrder: parseInt(row.sort_order, 10) || 0,
    title: cleanText(data.title, 120),
    description: cleanText(data.description, 8000),
    photos: cleanImageLinks(data.photos),
    filType: cleanFilType(data.filType),
    minutes: cleanNumber(data.minutes),
    grams: cleanNumber(data.grams)
  };
}

function renderWriteup(text) {
  return String(text || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('');
}

function writeupExcerpt(text, max = 160) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + '…' : t;
}

function openWork(id) {
  state.galleryOpen = id;
  state.clientTab = 'gallery';
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Photo strip of recent work for the Request a Quote page.
// Photo gallery at the top of the home page, built from the photos of published designs.
function renderRecentWork() {
  const tiles = [];
  state.gallery.filter(g => g.published).forEach(g => g.photos.forEach((photo, n) => tiles.push({ g, photo, n, first: n === 0 })));
  tiles.sort((a, b) => (b.first - a.first));
  // One featured photo (2x2) plus 4 or 8 small ones fills whole rows on both the 4- and 2-column layouts.
  const shown = tiles.slice(0, tiles.length >= 9 ? 9 : tiles.length >= 5 ? 5 : tiles.length);
  if (!shown.length) {
    return state.ownerUnlocked
      ? `<div class="card"><h3 class="card-title">My Work</h3><div class="field-help">Your photo gallery shows here once you add designs with photos in Owner → Gallery. Customers don't see this note.</div></div>`
      : '';
  }
  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:14px;flex-wrap:wrap;">
      <h2 class="section-title" style="font-size:20px;">My Work</h2>
      <button class="btn-link" type="button" onclick="setTab('gallery')">See all ${esc(GALLERY_NAME)} →</button>
    </div>
    <div class="home-gallery ${shown.length < 5 ? 'compact' : ''}" style="${shown.length < 5 ? `--cols:${shown.length}` : ''}">${shown.map((t, i) => `
      <button class="work-tile ${i === 0 && shown.length >= 5 ? 'featured' : ''}" type="button" onclick="openWork('${esc(t.g.id)}')" aria-label="${esc(t.g.title)}${t.n ? `, photo ${t.n + 1}` : ''}">
        ${thumbImg(t.photo, '', 'tile')}
        ${t.first ? `<span>${esc(t.g.title)}</span>` : ''}
      </button>`).join('')}</div>
  </div>`;
}

function renderWorkDetail(g) {
  const price = galleryPrice(g);
  return `
    <button class="btn-link" type="button" onclick="state.galleryOpen=''; render();" style="margin-bottom:14px;">← All ${esc(GALLERY_NAME)}</button>
    <div class="section-header" style="margin-bottom:1rem;"><div><h2 class="section-title">${esc(g.title || 'Untitled')}</h2></div></div>
    ${g.photos.length ? `<div class="work-detail-photo" id="work-main-photo"><img src="${esc(g.photos[0])}" alt="${esc(g.title)}" referrerpolicy="no-referrer" /></div>` : ''}
    ${g.photos.length > 1 ? `<div class="work-detail-thumbs">${g.photos.map((u, n) => `<button type="button" class="thumb-btn" onclick="showWorkPhoto('${esc(g.id)}', ${n})" aria-label="Show photo ${n + 1}">${thumbImg(u, '', 'thumb')}</button>`).join('')}</div>` : ''}
    <div class="card">
      ${g.description ? `<div class="work-writeup">${renderWriteup(g.description)}</div>` : '<div class="field-help">No write-up yet.</div>'}
      ${price !== null ? `
        <div class="job-divider" style="margin:6px 0 14px;"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
          <div>
            <div class="gallery-price">$${price.toFixed(2)} <span class="gallery-meta">each</span></div>
            <div class="gallery-meta">${esc(FIL_LABEL[g.filType])} filament${g.minutes ? ` · about ${fmtTime(g.minutes)} to print` : ''}</div>
          </div>
          <button class="btn-sm" type="button" onclick="requestGalleryItem('${esc(g.id)}')">Request this</button>
        </div>
        <div class="field-help" style="margin-top:10px;">Price is per item, printed in PLA unless noted. We'll review your request and confirm before asking for payment.</div>` : `
        <div class="field-help" style="margin-top:6px;">Want something like this? <button class="btn-link" type="button" onclick="setTab('submit')">Request a custom design →</button></div>`}
    </div>
    ${renderReviews(state.settings.reviews.filter(r => r.designId === g.id), 'Reviews for this design')}`;
}

function showWorkPhoto(id, n) {
  const g = state.gallery.find(x => x.id === id);
  const el = document.getElementById('work-main-photo');
  const src = g && g.photos[n];
  if (el && src) el.innerHTML = `<img src="${esc(src)}" alt="${esc(g.title)}" referrerpolicy="no-referrer" />`;
}

function galleryPrice(g) {
  return calcPerPrint(g.minutes, g.grams, g.filType);
}

async function loadGallery() {
  try {
    const rows = await supaFetch('/gallery_items?select=id,data,published,sort_order&order=sort_order.asc,created_at.desc');
    state.gallery = (rows || []).map(cleanGalleryItem).filter(Boolean);
    state.galleryError = false;
  } catch (e) {
    console.error('Gallery load error:', e);
    state.galleryError = true;
  }
  state.galleryLoaded = true;
}

// Show the thumbnail, fall back to the full photo if the thumbnail is missing, then give up gracefully.
function thumbImg(url, alt, mode, extra = '') {
  const thumb = thumbUrl(url);
  return `<img src="${esc(thumb)}" ${thumb !== url ? `data-full="${esc(url)}"` : ''} alt="${esc(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="photoFailed(this, '${mode}')" ${extra} />`;
}

function photoFailed(img, mode) {
  if (img.dataset.full && img.getAttribute('src') !== img.dataset.full) { img.src = img.dataset.full; return; }
  if (mode === 'tile') img.closest('.work-tile')?.remove();
  else if (mode === 'thumb') img.parentNode?.remove();
  else img.replaceWith(document.createTextNode('Photo unavailable'));
}

function renderGalleryPhoto(g) {
  const photo = g.photos[0];
  return `<div class="gallery-photo" id="gphoto-${esc(g.id)}">${photo
    ? thumbImg(photo, g.title, 'text')
    : 'No photo yet'}</div>
    ${g.photos.length > 1 ? `<div class="gallery-thumbs">${g.photos.map((u, n) => `<button type="button" class="thumb-btn" onclick="showGalleryPhoto('${esc(g.id)}', ${n})" aria-label="Show photo ${n + 1} of ${esc(g.title)}">${thumbImg(u, '', 'thumb')}</button>`).join('')}</div>` : ''}`;
}

function showGalleryPhoto(id, n) {
  const el = document.getElementById(`gphoto-${id}`);
  const g = state.gallery.find(x => x.id === id);
  const src = g && g.photos[n];
  if (el && src) el.innerHTML = thumbImg(src, g.title, 'text');
}

function renderGalleryTab() {
  const items = state.gallery.filter(g => g.published);
  const open = state.galleryOpen && items.find(g => g.id === state.galleryOpen);
  if (open) return renderWorkDetail(open);
  const header = `
    <div class="section-header">
      <div class="section-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
      </div>
      <div>
        <h2 class="section-title">${esc(GALLERY_NAME)}</h2>
        <div class="section-sub">Designs we've made before, with the story behind each one. Want one? Tap "Request this".</div>
      </div>
    </div>`;
  if (!state.galleryLoaded) return `${header}<div class="empty-state"><div class="empty-state-text">Loading...</div></div>`;
  if (!items.length) return `${header}<div class="empty-state"><div class="empty-state-icon">🖼️</div><div class="empty-state-text">Nothing here yet</div><div class="empty-state-sub">Check back soon, or request a custom print.</div></div>`;
  return `${header}
    <div class="gallery-grid">${items.map(g => {
      const price = galleryPrice(g);
      return `<div class="gallery-card">
        ${renderGalleryPhoto(g)}
        <div class="gallery-body">
          <div class="gallery-title">${esc(g.title || 'Untitled')}</div>
          <div class="gallery-desc">${esc(writeupExcerpt(g.description))}</div>
          ${price !== null ? `<div class="gallery-price">$${price.toFixed(2)} <span class="gallery-meta">each</span></div>` : ''}
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn-sm" type="button" onclick="openWork('${esc(g.id)}')">Read more</button>
            ${price !== null ? `<button class="btn-sm" type="button" onclick="requestGalleryItem('${esc(g.id)}')">Request this</button>` : ''}
          </div>
        </div>
      </div>`;
    }).join('')}</div>
    <div class="field-help" style="margin-top:14px;">Prices are per item. We'll review every request and confirm before asking for payment.</div>`;
}

// Add a gallery piece to the customer's request form with its known print time and grams.
function requestGalleryItem(id) {
  const g = state.gallery.find(x => x.id === id && x.published);
  if (!g) return;
  const item = {
    ...blankItem(),
    name: g.title,
    notes: '',
    mode: 'gallery',
    filType: g.filType,
    grams: g.grams,
    knownMinutes: g.minutes,
    knownFromLibrary: !!(g.minutes && g.grams),
    knownPrompted: true,
    previewImage: g.photos[0] || '',
    estimateSource: `the ${GALLERY_NAME} gallery`
  };
  const first = state.draftItems[0];
  const firstIsEmpty = state.draftItems.length === 1 && first && !first.name && !first.link && !first.notes;
  if (firstIsEmpty) state.draftItems[0] = item;
  else state.draftItems.push(item);
  state.clientTab = 'submit';
  render();
  showAlert('submit-ok', `Added "${g.title}" to your request. Add your name and email, then submit.`, 'success');
  document.getElementById('submit-ok')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function blankGalleryForm() {
  return { id: `g${Date.now()}`, title: '', description: '', photos: '', filType: 'black', hours: '', minutes: '', grams: '', published: true };
}

function renderGalleryFormPrice() {
  const f = state.galleryForm || blankGalleryForm();
  const minutes = totalPrintMinutes(f.hours, f.minutes);
  const price = calcPerPrint(minutes, parseFloat(f.grams), f.filType);
  return price !== null
    ? `<div class="price-big">$${price.toFixed(2)}</div><div class="field-help">Customer price per item, using the same pricing as quotes (${fmtTime(minutes)}, ${parseFloat(f.grams).toFixed(1)}g ${esc(FIL_LABEL[f.filType])}).</div>`
    : `<div class="field-help">Enter print time and grams to see the price customers will see.</div>`;
}

function updateGalleryForm(field, value) {
  if (!state.galleryForm) state.galleryForm = blankGalleryForm();
  state.galleryForm[field] = value;
  const priceEl = document.getElementById('gallery-form-price');
  if (priceEl) priceEl.innerHTML = renderGalleryFormPrice();
  if (field === 'photos') {
    const el = document.getElementById('gallery-form-photos');
    if (el) el.innerHTML = renderPhotoLinks(parseImageLinks(value));
  }
}

function renderOwnerGalleryPage() {
  if (!state.galleryForm) state.galleryForm = blankGalleryForm();
  const f = state.galleryForm;
  const editing = state.gallery.some(x => x.id === f.id);
  return `
    <div class="owner-page-header">
      <div class="section-header">
        <div class="section-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
        </div>
        <div><h2 class="section-title">Gallery</h2><div class="section-sub">Show finished work with prices on the "${esc(GALLERY_NAME)}" tab</div></div>
      </div>
      <div class="owner-page-meta">${state.gallery.filter(g => g.published).length} shown · ${state.gallery.filter(g => !g.published).length} hidden</div>
    </div>
    ${state.galleryError ? `<div class="alert error" style="display:block;">Couldn't load the gallery. If you haven't yet, run supabase/gallery.sql in the Supabase SQL Editor.</div>` : ''}
    <div class="card">
      <h3 class="card-title">${editing ? 'Edit Item' : 'Add Item'}</h3>
      <div class="field"><label>Title</label><input type="text" id="gallery-title" value="${esc(f.title)}" placeholder="Articulated dragon" oninput="updateGalleryForm('title', this.value)" /></div>
      <div class="field"><label>Write-up</label>
        <div class="field-help">Tell the story: what it was for, how you designed it, size, colors, anything interesting. Leave a blank line between paragraphs. The first sentence or two show on the card.</div>
        <textarea id="gallery-desc" style="min-height:180px;" placeholder="This started as a request for..." oninput="updateGalleryForm('description', this.value)">${esc(f.description)}</textarea>
      </div>
      <div class="field"><label>Photos</label>
        <div class="field-help">Upload up to 5 photos (they're resized and stored in your Supabase storage), or paste image links, one per line. The first photo is the main one.</div>
        <label class="btn-sm" style="display:inline-block;margin-bottom:8px;">Upload photos
          <input type="file" accept="image/*" multiple onchange="uploadGalleryPhotos(this.files); this.value='';" style="display:none;" />
        </label>
        <span class="field-help" id="gallery-upload-status" style="margin-left:8px;"></span>
        <textarea id="gallery-photos" placeholder="https://..." style="min-height:52px;" oninput="updateGalleryForm('photos', this.value)">${esc(f.photos)}</textarea>
        <div id="gallery-form-photos">${renderPhotoLinks(parseImageLinks(f.photos))}</div>
      </div>
      <div class="gallery-form-grid">
        <div class="field"><label>Filament</label>
          <select id="gallery-fil" onchange="updateGalleryForm('filType', this.value)">
            ${Object.entries(FIL_LABEL).filter(([v]) => v !== 'special_order').map(([v, label]) => `<option value="${v}" ${f.filType === v ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Hours</label><input type="number" id="gallery-hours" min="0" step="1" value="${esc(f.hours)}" placeholder="2" oninput="updateGalleryForm('hours', this.value)" /></div>
        <div class="field"><label>Minutes</label><input type="number" id="gallery-mins" min="0" max="59" step="1" value="${esc(f.minutes)}" placeholder="30" oninput="updateGalleryForm('minutes', this.value)" /></div>
        <div class="field"><label>Filament (g)</label><input type="number" id="gallery-grams" min="0" step="0.1" value="${esc(f.grams)}" placeholder="85.4" oninput="updateGalleryForm('grams', this.value)" /></div>
      </div>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px;margin:12px 0;">
        <input type="checkbox" id="gallery-published" ${f.published ? 'checked' : ''} onchange="updateGalleryForm('published', this.checked)" style="width:auto;" /> Show on the ${esc(GALLERY_NAME)} tab
      </label>
      <div class="price-preview-box" id="gallery-form-price">${renderGalleryFormPrice()}</div>
      <div class="alert error" id="gallery-err"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">
        <button class="btn-sm" type="button" id="gallery-save" onclick="saveGalleryItem()">${editing ? 'Save Changes' : 'Add to Gallery'}</button>
        ${editing ? `<button class="btn-sm" type="button" onclick="state.galleryForm = null; render();">Cancel</button>` : ''}
      </div>
    </div>
    ${state.gallery.length ? `<div class="gallery-grid">${state.gallery.map(g => {
      const price = galleryPrice(g);
      return `<div class="gallery-card ${g.published ? '' : 'hidden-item'}">
        ${renderGalleryPhoto(g)}
        <div class="gallery-body">
          <div class="gallery-title">${esc(g.title || 'Untitled')}${g.published ? '' : ' <span class="gallery-meta">(hidden)</span>'}</div>
          ${price !== null ? `<div class="gallery-price">$${price.toFixed(2)}</div>` : '<div class="gallery-meta">No price yet: add time and grams</div>'}
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn-sm" type="button" onclick="editGalleryItem('${esc(g.id)}')">Edit</button>
            <button class="btn-sm" type="button" onclick="toggleGalleryItem('${esc(g.id)}')">${g.published ? 'Hide' : 'Show'}</button>
            <button class="btn-sm danger" type="button" onclick="deleteGalleryItem('${esc(g.id)}')">Delete</button>
          </div>
        </div>
      </div>`;
    }).join('')}</div>` : (state.galleryLoaded && !state.galleryError ? `<div class="empty-state"><div class="empty-state-text">No gallery items yet</div><div class="empty-state-sub">Add your first finished project above.</div></div>` : '')}`;
}

function editGalleryItem(id) {
  const g = state.gallery.find(x => x.id === id);
  if (!g) return;
  state.galleryForm = {
    id: g.id, title: g.title, description: g.description, photos: g.photos.join('\n'), filType: g.filType,
    hours: g.minutes ? String(Math.floor(g.minutes / 60)) : '', minutes: g.minutes ? String(Math.round(g.minutes % 60)) : '',
    grams: g.grams ? String(g.grams) : '', published: g.published
  };
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function writeGalleryItem(g) {
  await supaFetch('/gallery_items', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      id: g.id,
      published: g.published,
      sort_order: g.sortOrder || 0,
      data: { title: g.title, description: g.description, photos: g.photos, filType: g.filType, minutes: g.minutes, grams: g.grams }
    })
  });
}

async function saveGalleryItem() {
  const f = state.galleryForm || blankGalleryForm();
  if (!f.title.trim()) { showAlert('gallery-err', 'Please add a title.', 'error'); return; }
  const existing = state.gallery.find(x => x.id === f.id);
  const item = cleanGalleryItem({
    id: f.id,
    published: f.published,
    sort_order: existing ? existing.sortOrder : 0,
    data: { title: f.title.trim(), description: f.description.trim(), photos: parseImageLinks(f.photos), filType: f.filType,
      minutes: totalPrintMinutes(f.hours, f.minutes), grams: parseFloat(f.grams) }
  });
  const btn = document.getElementById('gallery-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  try {
    await writeGalleryItem(item);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = existing ? 'Save Changes' : 'Add to Gallery'; }
    showAlert('gallery-err', "Couldn't save. If you were logged out, log in again and retry.", 'error');
    return;
  }
  state.galleryForm = null;
  await loadGallery();
  render();
}

async function toggleGalleryItem(id) {
  const g = state.gallery.find(x => x.id === id);
  if (!g) return;
  try {
    await writeGalleryItem({ ...g, published: !g.published });
  } catch (e) {
    alert("Couldn't save this change. If you were logged out, log in again and retry.");
  }
  await loadGallery();
  render();
}

// ── GALLERY PHOTO UPLOADS (Supabase Storage bucket "gallery", see supabase/gallery.sql) ──
const GALLERY_BUCKET = 'gallery';
const GALLERY_PUBLIC_PREFIX = `${SUPA_URL}/storage/v1/object/public/${GALLERY_BUCKET}/`;
const THUMB_SIDE = 640;

// Uploaded photos get a small "-thumb.jpg" copy for tiles and cards; other links have no thumbnail.
function thumbUrl(url) {
  return String(url).startsWith(GALLERY_PUBLIC_PREFIX) && /\.jpg$/i.test(url) && !/-thumb\.jpg$/i.test(url)
    ? url.replace(/\.jpg$/i, '-thumb.jpg') : url;
}

// Shrink photos before uploading so they load fast and stay well inside the free storage limit.
async function resizePhoto(file, maxSide = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('unsupported image'));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function uploadGalleryPhotos(files) {
  const f = state.galleryForm;
  const status = document.getElementById('gallery-upload-status');
  const token = getOwnerToken();
  if (!f || !token) { if (status) status.textContent = 'Please log in again to upload.'; return; }
  const current = parseImageLinks(f.photos);
  const list = [...files].slice(0, Math.max(0, 5 - current.length));
  if (!list.length) { if (status) status.textContent = 'This item already has 5 photos.'; return; }
  const added = [];
  for (let n = 0; n < list.length; n++) {
    if (status) status.textContent = `Uploading ${n + 1} of ${list.length}...`;
    try {
      const blob = await resizePhoto(list[n]);
      const thumb = await resizePhoto(list[n], THUMB_SIDE);
      if (!blob || !thumb) throw new Error('resize failed');
      const path = `${f.id}/${Date.now()}-${n}.jpg`;
      await uploadStoredPhoto(path, blob, token);
      await uploadStoredPhoto(path.replace(/\.jpg$/, '-thumb.jpg'), thumb, token);
      added.push(GALLERY_PUBLIC_PREFIX + path);
    } catch (e) {
      console.error('Photo upload error:', e);
      if (status) status.textContent = /unsupported/.test(e.message)
        ? `"${list[n].name}" isn't a format this browser can read. Try a JPG or PNG.`
        : "Couldn't upload. Check that supabase/gallery.sql has been run, and that you're logged in.";
      break;
    }
  }
  if (added.length) {
    f.photos = current.concat(added).join('\n');
    const area = document.getElementById('gallery-photos');
    if (area) area.value = f.photos;
    updateGalleryForm('photos', f.photos);
    if (status) status.textContent = `Uploaded ${added.length} photo${added.length === 1 ? '' : 's'}. Remember to save.`;
  }
}

async function uploadStoredPhoto(path, blob, token, upsert = false) {
  const res = await fetch(`${SUPA_URL}/storage/v1/object/${GALLERY_BUCKET}/${path}`, {
    method: 'POST',
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${token}`, 'Content-Type': 'image/jpeg', 'x-upsert': upsert ? 'true' : 'false' },
    body: blob
  });
  if (!res.ok) throw new Error(`upload ${res.status}`);
}

// Make thumbnails for photos uploaded before thumbnails existed. Runs quietly when the owner opens Gallery.
let thumbBackfillDone = false;
async function backfillThumbnails() {
  const token = getOwnerToken();
  if (thumbBackfillDone || !token) return;
  thumbBackfillDone = true;
  const urls = [...new Set(state.gallery.flatMap(g => g.photos))].filter(u => thumbUrl(u) !== u);
  for (const url of urls) {
    try {
      const head = await fetch(thumbUrl(url), { method: 'HEAD', cache: 'no-store' });
      if (head.ok) continue;
      const full = await fetch(url);
      if (!full.ok) continue;
      const thumb = await resizePhoto(await full.blob(), THUMB_SIDE);
      if (thumb) await uploadStoredPhoto(thumbUrl(url).slice(GALLERY_PUBLIC_PREFIX.length), thumb, token, true);
    } catch (e) {
      console.error('Thumbnail backfill error:', e);
    }
  }
}

async function deleteStoredPhotos(urls) {
  const stored = cleanImageLinks(urls).filter(u => u.startsWith(GALLERY_PUBLIC_PREFIX));
  const prefixes = stored.concat(stored.map(thumbUrl).filter(u => !stored.includes(u))).map(u => u.slice(GALLERY_PUBLIC_PREFIX.length));
  if (!prefixes.length) return;
  try {
    await fetch(`${SUPA_URL}/storage/v1/object/${GALLERY_BUCKET}`, {
      method: 'DELETE',
      headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${getOwnerToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes })
    });
  } catch (e) {
    console.error('Photo cleanup error:', e);
  }
}

async function deleteGalleryItem(id) {
  const g = state.gallery.find(x => x.id === id);
  if (!g || !confirm(`Delete "${g.title || 'this item'}" from the gallery? This cannot be undone.`)) return;
  try {
    await supaFetch(`/gallery_items?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    await deleteStoredPhotos(g.photos);
  } catch (e) {
    alert("Couldn't delete it. If you were logged out, log in again and retry.");
  }
  await loadGallery();
  render();
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────
// The feed is derived from order data (phaseHistory, createdAt); read state and
// preferences live in this browser only.
const NOTIF_PAGE_OPENED_AT = Date.now();
const NOTIF_UNREAD_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

function loadJsonPref(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
}
function saveJsonPref(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

function notifScope() {
  return state.view === 'owner' && state.ownerUnlocked ? 'owner' : 'client';
}

function buildNotifications() {
  const scope = notifScope();
  const read = new Set(loadJsonPref(NOTIF_READ_KEY, {})[scope] || []);
  const list = [];
  if (scope === 'owner') {
    state.batches.forEach(b => {
      const n = b.items.length;
      list.push({ id: `new-${b.id}`, batchId: b.id, at: b.createdAt,
        title: `New request from ${b.clientName || 'a customer'}`,
        body: `${n} item${n === 1 ? '' : 's'}: ${orderTitle(b)}` });
      if (b.customerApprovedAt) list.push({ id: `approved-${b.id}-${b.customerApprovedAt}`, batchId: b.id, at: b.customerApprovedAt,
        title: `${b.clientName || 'A customer'} approved their quote`,
        body: `Ready for you to confirm: ${orderTitle(b)}` });
    });
  } else {
    const email = String(state.historyEmail || '').trim().toLowerCase();
    if (!email) return [];
    state.batches.filter(b => String(b.clientEmail || '').toLowerCase() === email).forEach(b => {
      const history = { estimate: b.createdAt, ...(b.phaseHistory || {}) };
      ORDER_PHASES.forEach(p => {
        if (!history[p.id]) return;
        list.push({ id: `${b.id}-${p.id}`, batchId: b.id, at: history[p.id],
          title: `${TRACKER_STEPS[p.id].label}: ${orderTitle(b)}`,
          body: TRACKER_STEPS[p.id].detail });
      });
    });
  }
  return list
    .filter(n => n.at)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 50)
    .map(n => ({ ...n, unread: !read.has(n.id) && Date.now() - Date.parse(n.at) < NOTIF_UNREAD_WINDOW_MS }));
}

function markNotifsRead(ids) {
  const scope = notifScope();
  const all = loadJsonPref(NOTIF_READ_KEY, {});
  all[scope] = [...new Set([...(all[scope] || []), ...ids])].slice(-500);
  saveJsonPref(NOTIF_READ_KEY, all);
}

function notifTimeAgo(iso) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function browserAlertsSupported() {
  return typeof window.Notification === 'function';
}

function browserAlertsOn() {
  return browserAlertsSupported() && Notification.permission === 'granted' && !!loadJsonPref(NOTIF_PREFS_KEY, {}).alerts;
}

function renderNotifPanel(items, unread) {
  let footer;
  if (!browserAlertsSupported()) footer = `<span>Browser alerts aren't supported on this device.</span>`;
  else if (Notification.permission === 'denied') footer = `<span>Browser alerts are blocked in your browser settings.</span>`;
  else footer = `<span>${browserAlertsOn() ? 'Browser alerts are on.' : 'Get a pop-up when something changes.'}</span>
    <button type="button" onclick="toggleBrowserAlerts()">${browserAlertsOn() ? 'Turn off' : 'Turn on alerts'}</button>`;
  const empty = notifScope() === 'client' && !state.historyEmail
    ? 'Look up your email under My Requests to get updates on your orders here.'
    : "You're all caught up. Updates will show up here.";
  return `<div class="notif-panel" role="dialog" aria-label="Notifications">
    <div class="notif-head"><span>Notifications</span>${unread ? `<button type="button" onclick="markAllNotifsRead()">Mark all read</button>` : ''}</div>
    ${items.length ? items.map(n => `
      <button type="button" class="notif-item ${n.unread ? 'unread' : ''}" onclick="openNotif('${esc(n.id)}', '${esc(n.batchId)}')">
        <div class="notif-title">${esc(n.title)}</div>
        <div class="notif-body">${esc(n.body)}</div>
        <div class="notif-time">${notifTimeAgo(n.at)}</div>
      </button>`).join('') : `<div class="notif-empty">${empty}</div>`}
    <div class="notif-foot">${footer}</div>
  </div>`;
}

function renderNotifBell() {
  const items = buildNotifications();
  const unread = items.filter(n => n.unread).length;
  document.title = `${unread ? `(${unread}) ` : ''}SoloPrint — 3D Print Quote Request`;
  return `<div class="notif-wrap" id="notif-wrap">
    <button class="notif-bell" type="button" aria-label="Notifications${unread ? ` (${unread} unread)` : ''}" onclick="toggleNotifPanel()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      ${unread ? `<span class="notif-count">${unread > 9 ? '9+' : unread}</span>` : ''}
    </button>
    ${state.notifOpen ? renderNotifPanel(items, unread) : ''}
  </div>`;
}

function updateNotifBell() {
  const el = document.getElementById('notif-wrap');
  if (el) el.outerHTML = renderNotifBell();
}

function toggleNotifPanel() {
  state.notifOpen = !state.notifOpen;
  updateNotifBell();
}

function markAllNotifsRead() {
  markNotifsRead(buildNotifications().map(n => n.id));
  updateNotifBell();
}

function openNotif(id, batchId) {
  markNotifsRead([id]);
  state.notifOpen = false;
  if (notifScope() === 'owner') state.ownerTab = 'dashboard';
  else state.clientTab = 'jobs';
  render();
  const card = document.getElementById(`order-${batchId}`);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function toggleBrowserAlerts() {
  const prefs = loadJsonPref(NOTIF_PREFS_KEY, {});
  if (browserAlertsOn()) {
    prefs.alerts = false;
  } else {
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    prefs.alerts = permission === 'granted';
  }
  saveJsonPref(NOTIF_PREFS_KEY, prefs);
  updateNotifBell();
}

// Pop up a browser alert for updates that arrive while the page is open.
function sendBrowserAlerts() {
  if (!browserAlertsOn()) return;
  const alerted = new Set(loadJsonPref(NOTIF_ALERTED_KEY, []));
  const fresh = buildNotifications().filter(n => n.unread && !alerted.has(n.id) && Date.parse(n.at) > NOTIF_PAGE_OPENED_AT);
  fresh.forEach(n => {
    try {
      const alert = new Notification(n.title, { body: n.body, tag: n.id });
      alert.onclick = () => { window.focus(); openNotif(n.id, n.batchId); };
    } catch (e) {}
    alerted.add(n.id);
  });
  if (fresh.length) saveJsonPref(NOTIF_ALERTED_KEY, [...alerted].slice(-500));
}

document.addEventListener('click', e => {
  if (state.notifOpen && !e.target.closest('.notif-wrap')) {
    state.notifOpen = false;
    updateNotifBell();
  }
});

// Check for order updates every minute so the tracker and notifications stay current.
setInterval(async () => {
  const scope = notifScope();
  if (state.loading || (state.view === 'owner' && !state.ownerUnlocked)) return;
  if (scope === 'client' && !state.historyEmail) return;
  if (document.hidden && !browserAlertsOn()) return;
  const before = JSON.stringify(state.batches);
  await loadBatches(scope === 'client' ? state.historyEmail : '');
  sendBrowserAlerts();
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  // Only the customer tracker re-renders; owner pages hold unsaved form values in the DOM.
  if (JSON.stringify(state.batches) !== before && scope === 'client' && state.clientTab === 'jobs' && !typing && !state.notifOpen) render();
  else updateNotifBell();
}, 60 * 1000);

function clearMyRequestsLookup() {
  state.historyEmail = '';
  state.batches = [];
  persistClientHistoryEmail();
  render();
}

// ── EMAIL LINKS (magic link / password reset) ─────────────────────────────
// Supabase sends the owner back to this page with the session in the URL fragment
// (#access_token=...&type=magiclink|recovery). Finish the login and, for resets, ask for a new password.
// Links in emails (?requests=email#order-id) open that customer's requests with the order in view.
function handleRequestsLink() {
  const params = new URLSearchParams(location.search);
  const email = String(params.get('requests') || '').trim().toLowerCase();
  if (!email || !email.includes('@') || email.length > 200) return '';
  const order = (String(location.hash).match(/^#order-([A-Za-z0-9_-]{1,64})$/) || [])[1] || '';
  params.delete('requests');
  history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : ''));
  state.historyEmail = email;
  persistClientHistoryEmail();
  state.view = 'client';
  state.clientTab = 'jobs';
  return order;
}

function handleAuthRedirect() {
  const params = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
  if (!params.has('access_token') && !params.has('error') && !params.has('error_description')) return;
  history.replaceState(null, '', location.pathname + location.search);
  state.view = 'owner';
  if (!params.has('access_token')) {
    state.authNotice = params.get('error_code') === 'otp_expired'
      ? 'That email link has expired or was already used. Request a new one below.'
      : `That email link didn't work (${params.get('error_description') || params.get('error') || 'unknown error'}). Request a new one below.`;
    return;
  }
  persistOwnerSession({ access_token: params.get('access_token'), expires_in: params.get('expires_in') });
  state.ownerUnlocked = true;
  state.ownerTab = 'dashboard';
  state.showPasswordForm = params.get('type') === 'recovery';
}

function authRedirectUrl() {
  return location.origin && location.origin !== 'null' ? location.origin + location.pathname : '';
}

async function sendOwnerAuthEmail(kind) {
  const email = (document.getElementById('owner-email') || { value: OWNER_EMAIL }).value.trim();
  if (!email) { showAlert('pw-err', 'Enter your email first.', 'error'); return; }
  const redirect = authRedirectUrl();
  const query = redirect ? `?redirect_to=${encodeURIComponent(redirect)}` : '';
  const path = kind === 'recover' ? '/auth/v1/recover' : '/auth/v1/otp';
  const body = kind === 'recover' ? { email } : { email, create_user: false };
  try {
    const res = await fetch(`${SUPA_URL}${path}${query}`, {
      method: 'POST',
      headers: { 'apikey': SUPA_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.status === 429) throw new Error('Supabase only sends a few login emails per hour, and that limit has been reached. Try again in about an hour, or log in with your password and use Change password on the dashboard.');
    if (!res.ok) throw new Error("Couldn't send the email. Try again in a moment.");
    const pwErr = document.getElementById('pw-err');
    if (pwErr) pwErr.style.display = 'none';
    showAlert('pw-ok', kind === 'recover'
      ? `If ${email} has an owner account, a password reset link is on its way. Open it on this device.`
      : `If ${email} has an owner account, a login link is on its way. Open it on this device.`, 'success');
  } catch (e) {
    showAlert('pw-err', e.message, 'error');
  }
}

function renderSetPasswordCard() {
  return `<div class="card">
    <h3 class="card-title">Set a new password</h3>
    <div class="row2">
      <div class="field"><label>New password</label><input type="password" id="new-pw" autocomplete="new-password" placeholder="At least 8 characters" /></div>
      <div class="field"><label>Repeat it</label><input type="password" id="new-pw2" autocomplete="new-password" /></div>
    </div>
    <div class="alert error" id="new-pw-err"></div>
    <div class="alert success" id="new-pw-ok"></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <button class="btn-sm" type="button" id="new-pw-btn" onclick="saveNewPassword()">Save password</button>
      <button class="btn-sm" type="button" onclick="state.showPasswordForm = false; render();">Not now</button>
    </div>
  </div>`;
}

async function saveNewPassword() {
  const pw = document.getElementById('new-pw').value;
  const pw2 = document.getElementById('new-pw2').value;
  if (pw.length < 8) { showAlert('new-pw-err', 'Use at least 8 characters.', 'error'); return; }
  if (pw !== pw2) { showAlert('new-pw-err', "The two passwords don't match.", 'error'); return; }
  const btn = document.getElementById('new-pw-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  try {
    const res = await fetch(`${SUPA_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${getOwnerToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.msg || json.error_description || json.message || `Error ${res.status}`);
    document.getElementById('new-pw-err').style.display = 'none';
    showAlert('new-pw-ok', 'Password saved. Use it next time you log in.', 'success');
    setTimeout(() => { state.showPasswordForm = false; render(); }, 1800);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Save password'; }
    showAlert('new-pw-err', `Couldn't save the password: ${e.message}`, 'error');
  }
}

// Owner sign-in goes through Supabase Auth; the database only lets this account read and edit orders.
async function checkPw() {
  const email = (document.getElementById('owner-email') || { value: OWNER_EMAIL }).value.trim();
  const password = document.getElementById('owner-pw').value;
  const btn = document.getElementById('owner-login-btn');
  if (!password) { showAlert('pw-err', 'Please enter your password.', 'error'); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Logging in...'; }
  try {
    const res = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': SUPA_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const session = await res.json().catch(() => ({}));
    if (!res.ok || !session.access_token) throw new Error('login failed');
    persistOwnerSession(session);
    state.authNotice = '';
    state.ownerUnlocked = true;
    state.ownerTab = 'dashboard';
    await Promise.all([loadBatches(), loadRemoteLibrary()]);
    render();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Login'; }
    showAlert('pw-err', 'Incorrect email or password.', 'error');
  }
}

function logoutOwner() {
  state.ownerUnlocked = false;
  state.view = 'client';
  clearOwnerSession();
  state.batches = [];
  if (state.historyEmail) loadBatches(state.historyEmail).then(() => render());
  render();
}

function updateDraft(i, field, value) {
  if (!state.draftItems[i]) return;
  state.draftItems[i][field] = value;
  if (field === 'name' || field === 'link') maybeOfferKnownEstimate(i);
  if (field === 'grams' || field === 'qty' || field === 'filType') updateCustomerPricePreview(i);
}

function rerenderPills(i, selected) {
  const el = document.getElementById(`pills-${i}`);
  if (el) el.innerHTML = renderFilamentPills(i, selected);
}

function clearErr(input, errId) {
  input.classList.remove('invalid');
  const el = document.getElementById(errId);
  if (el) el.classList.remove('show');
}

function showFieldErr(inputId, errId) {
  const input = document.getElementById(inputId);
  const err   = document.getElementById(errId);
  if (input) input.classList.add('invalid');
  if (err)   err.classList.add('show');
}

// ── MODEL PREVIEWS ────────────────────────────────────────────────────────
const previewCache = new Map();
const previewTimers = {};

async function fetchModelPreview(url) {
  const key = normalizeModelKey(url);
  if (previewCache.has(key)) return previewCache.get(key);
  const res = await fetch(PREVIEW_API + encodeURIComponent(String(url).trim()));
  if (!res.ok) throw new Error(`Preview error ${res.status}`);
  const json = await res.json();
  const image = json?.data?.image?.url || json?.data?.logo?.url || '';
  const preview = { image: /^https:\/\//i.test(image) ? image : '', title: json?.data?.title || '' };
  previewCache.set(key, preview);
  return preview;
}

function safeImageUrl(url) {
  return /^https:\/\//i.test(String(url || '')) ? url : '';
}

// Printables blocks our lookups, so point the customer to where Printables lists the numbers.
function printablesFilesUrl(link) {
  const m = String(link || '').trim().match(/^https?:\/\/(?:www\.)?printables\.com\/(?:[a-z]{2}\/)?model\/(\d+[A-Za-z0-9-]*)/i);
  return m ? `https://www.printables.com/model/${m[1]}/files` : '';
}

function renderPrintablesHint(item) {
  const filesUrl = printablesFilesUrl(item.link);
  if (!filesUrl) return '';
  return `<div class="lookup-hint">
    <strong>Print time and filament are listed on Printables</strong>
    We can't fill these in automatically for Printables links, but you can usually find them yourself:
    open the model's <a href="${esc(filesUrl)}" target="_blank" rel="noopener noreferrer">Files tab on Printables ↗</a>,
    find a print file (G-code), and copy its print time and weight (g) into Hours, Minutes and Grams below.
    If the model has no print file, leave them blank and we'll estimate it for you.
  </div>`;
}

function renderModelPreview(item) {
  return renderModelPreviewCard(item) + renderPrintablesHint(item);
}

function renderModelPreviewCard(item) {
  if (item.previewLoading) {
    return `<div class="model-preview loading"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" /><div class="model-preview-sub">Loading preview...</div></div>`;
  }
  const img = safeImageUrl(item.previewImage);
  const note = item.estimateSource
    ? `Print time and filament filled in from ${esc(item.estimateSource)}. This is an automated estimate; edit it if you know better.`
    : esc(item.estimateNote || '');
  if (!img && !note) return '';
  return `<div class="model-preview">
    ${img ? `<img src="${esc(img)}" alt="${esc(item.name || 'Model preview')}" loading="lazy" onerror="this.remove()" />` : ''}
    <div><div class="model-preview-title">${esc(item.name || 'Model preview')}</div><div class="model-preview-sub">${note || 'Preview from the model link'}</div></div>
  </div>`;
}

function renderModelThumb(item) {
  const img = safeImageUrl(item.previewImage);
  return img ? `<img class="model-thumb" src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()" />` : '';
}

function rerenderModelPreview(i) {
  const el = document.getElementById(`preview-${i}`);
  if (el && state.draftItems[i]) el.innerHTML = renderModelPreview(state.draftItems[i]);
}

async function lookupModelEstimate(url) {
  if (!/(makerworld\.com|thingiverse\.com)/i.test(url)) return null;
  const res = await fetch(`${LOOKUP_API}?action=lookup&url=${encodeURIComponent(url)}`);
  if (!res.ok) return null;
  return res.json();
}

// Fill print time and grams from a looked-up profile, unless the customer typed them or a saved estimate applies.
function applyLookedUpEstimate(i, item, found) {
  if (!found) return;
  const minutes = cleanNumber(found.minutes);
  const grams = cleanNumber(found.grams);
  if (!found.ok || !minutes || !grams) {
    if (found.source === 'MakerWorld') item.estimateNote = 'We couldn\'t find a print time for this link, so please enter your best guess or leave it blank.';
    return;
  }
  if (item.knownFromLibrary || item.printHours || item.printMinutes || item.grams) return;
  item.printHours = String(Math.floor(minutes / 60));
  item.printMinutes = String(Math.round(minutes % 60));
  item.grams = grams;
  const profile = cleanText(found.profile, 80);
  const plates = parseInt(found.plates, 10) || 1;
  item.estimateSource = `MakerWorld${profile ? ` profile "${profile}"` : ''}${plates > 1 ? ` (${plates} plates)` : ''}`;
  const timeEl = document.getElementById(`time-${i}`);
  if (timeEl) timeEl.innerHTML = renderTimeSection(item, i);
  updateCustomerPricePreview(i);
}

function queueModelPreview(i, url) {
  clearTimeout(previewTimers[i]);
  previewTimers[i] = setTimeout(async () => {
    const item = state.draftItems[i];
    if (!item || item.link !== url) return;
    item.previewLoading = true;
    rerenderModelPreview(i);
    // Our Apps Script handles MakerWorld and Thingiverse; Microlink (limited free plan) is only the fallback.
    const found = await lookupModelEstimate(url).catch(() => null);
    const preview = found && safeImageUrl(found.image) ? null : await fetchModelPreview(url).catch(() => null);
    if (state.draftItems[i] !== item || item.link !== url) return;
    item.previewImage = (preview && preview.image) || safeImageUrl(found && found.image);
    const title = (preview && preview.title) || cleanText(found && found.name, 200);
    if (!item.name && title) {
      item.name = title;
      const el = document.getElementById(`name-${i}`);
      if (el) el.value = item.name;
    }
    applyLookedUpEstimate(i, item, found);
    item.previewLoading = false;
    rerenderModelPreview(i);
  }, 600);
}

// Link input — extract name from slug or trigger server fetch for numeric IDs
async function onLinkInput(i, value) {
  state.draftItems[i].link = value;
  state.draftItems[i].knownFromLibrary = false;
  state.draftItems[i].knownMinutes = null;
  state.draftItems[i].knownPrompted = false;
  state.draftItems[i].previewImage = '';
  state.draftItems[i].estimateNote = '';
  if (state.draftItems[i].estimateSource) {
    Object.assign(state.draftItems[i], { printHours: '', printMinutes: '', grams: null, estimateSource: '' });
    const timeEl = document.getElementById(`time-${i}`);
    if (timeEl) timeEl.innerHTML = renderTimeSection(state.draftItems[i], i);
    updateCustomerPricePreview(i);
  }
  if (isSupportedModelLink(value) && isWebUrl(value)) queueModelPreview(i, value);
  else rerenderModelPreview(i);
  if (isOriginalDesignText(value)) {
    if (!state.draftItems[i].name) {
      state.draftItems[i].name = titleCaseWords(String(value).trim());
      const el = document.getElementById(`name-${i}`);
      if (el) el.value = state.draftItems[i].name;
    }
    maybeOfferKnownEstimate(i);
    return;
  }
  if (!isSupportedModelLink(value)) return;

  const slugName = nameFromUrl(value);
  if (slugName) {
    // Slug URL — fill immediately
    state.draftItems[i].name = slugName;
    const el = document.getElementById(`name-${i}`);
    if (el) el.value = slugName;
  } else if (isNumericOnlySlug(value) && value.length > 30) {
    // Numeric-only URL — call Netlify function
    state.draftItems[i].fetching = true;
    rerenderFetchBadge(i, true);
    try {
      const name = await fetchNameFromServer(value);
      if (name) {
        state.draftItems[i].name = name;
        const el = document.getElementById(`name-${i}`);
        if (el) el.value = name;
      }
    } catch(e) { /* silently fail — user can type name */ }
    state.draftItems[i].fetching = false;
    rerenderFetchBadge(i, false);
  }
  maybeOfferKnownEstimate(i);
}

function rerenderFetchBadge(i, fetching) {
  const header = document.querySelector(`#iblock-${i} .item-block-header`);
  if (!header) return;
  const existing = header.querySelector('.fetching-badge');
  if (fetching && !existing) {
    const span = document.createElement('span');
    span.className = 'fetching-badge';
    span.textContent = 'Looking up...';
    header.querySelector('div') ? header.querySelector('div').prepend(span) : header.appendChild(span);
  } else if (!fetching && existing) {
    existing.remove();
  }
}

function addItem() {
  if (state.draftItems.length >= MAX_ITEMS) return;
  state.draftItems.push(blankItem());
  render();
  setTimeout(() => document.querySelectorAll('.item-block')[state.draftItems.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
}

function removeItem(i) {
  if (!confirm('Remove this item from your quote request?')) return;
  state.draftItems.splice(i, 1);
  render();
}

// ── DRAFT AUTOSAVE ────────────────────────────────────────────────────────
// A half-filled request survives reloads and closed tabs; cleared once it's sent.
const DRAFT_KEY = 'soloprint_request_draft_v1';
let draftSaveTimer = null;
function queueDraftSave() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveDraft, 400);
}
function saveDraft() {
  const items = state.draftItems.map(it => ({ ...it, fetching: false, previewLoading: false }));
  const empty = items.every(it => !it.name && !it.link && !it.notes && !it.mode);
  try {
    if (empty) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify({ clientName: state.clientName, clientEmail: state.clientEmail, items, savedAt: Date.now() }));
  } catch (e) {}
}
function restoreDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!d || Date.now() - d.savedAt > 30 * 864e5) return;
    state.clientName = cleanText(d.clientName, 120);
    state.clientEmail = cleanText(d.clientEmail, 200);
    const items = (Array.isArray(d.items) ? d.items : []).slice(0, MAX_ITEMS).map(it => ({ ...cleanItem(it), showTime: !!it.showTime }));
    if (items.length) state.draftItems = items;
  } catch (e) {}
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
}
document.addEventListener('input', e => { if (e.target.closest && e.target.closest('#app-root') && state.view === 'client' && state.clientTab === 'submit') queueDraftSave(); });

// ── SUBMIT ────────────────────────────────────────────────────────────────
async function submitBatch() {
  const clientName  = state.clientName.trim();
  const clientEmail = state.clientEmail.trim();
  let valid = true;

  // Required field validation
  if (!clientName) {
    showFieldErr('client-name', 'err-name');
    valid = false;
  }
  if (!clientEmail || !clientEmail.includes('@') || !clientEmail.includes('.')) {
    showFieldErr('client-email', 'err-email');
    valid = false;
  }
  if (!valid) {
    document.getElementById('client-name')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const items = state.draftItems.filter(it => String(it.name || it.link || it.notes || '').trim());
  if (!items.length) { showAlert('submit-err', 'Please tell me about at least one thing you want printed.', 'error'); return; }
  const rollUse = {};
  items.forEach(it => rollParts(it).forEach(p => {
    const roll = draftRoll(p);
    if (roll) rollUse[roll.orderId + roll.key] = { roll, grams: ((rollUse[roll.orderId + roll.key] || {}).grams || 0) + partGrams(it) };
  }));
  const over = Object.values(rollUse).find(u => u.grams > u.roll.left);
  if (over) {
    showAlert('submit-err', `Your ${over.roll.color} roll has about ${over.roll.left.toFixed(0)} g left, but this request needs about ${over.grams.toFixed(0)} g. Choose "Order a new roll instead" for some items.`, 'error');
    return;
  }
  const noColor = state.draftItems.findIndex(it => items.includes(it) && isSpecialOrder(it) && !String(it.specialColor || '').trim());
  if (noColor >= 0) {
    showAlert('submit-err', 'Please type the special order color and material you would like.', 'error');
    document.getElementById(`special-color-${noColor}`)?.focus();
    return;
  }
  // Custom ideas don't need a name: use the first few words of the description.
  items.forEach(it => {
    if (it.name.trim()) return;
    const words = String(it.notes || '').trim().split(/\s+/).slice(0, 6).join(' ');
    it.name = it.link ? (nameFromUrl(it.link) || 'Model from link') : (words ? `Custom: ${words}` : 'Custom design');
  });

  const btn = document.getElementById('submit-btn');
  btn.disabled = true; btn.textContent = 'Submitting...';

  const batch = {
    id: Date.now().toString(), clientName, clientEmail,
    items: items.map(it => ({
      ...it,
      minutes: it.knownFromLibrary ? it.knownMinutes : totalPrintMinutes(it.printHours, it.printMinutes),
      fetching: false,
      previewLoading: false
    })),
    status: 'pending',
    phase: 'estimate',
    paymentStatus: 'unpaid',
    deliveryNotes: '',
    deliveryTracking: '',
    deliveryDate: '',
    createdAt: new Date().toISOString()
  };
  batch.phaseHistory = { estimate: batch.createdAt };
  state.historyEmail = clientEmail.toLowerCase();
  persistClientHistoryEmail();
  if (!(await submitBatchRemote(batch))) {
    showAlert('submit-err', "We couldn't save your request. Please check your connection and try again.", 'error');
    btn.disabled = false; btn.textContent = 'Submit Quote Request';
    return;
  }
  state.batches.push(normalizeBatch(batch));

  showAlert('submit-ok', `Thanks! We've received your request for ${items.length} item${items.length>1?'s':''} and will respond promptly after reviewing it. Any prices shown are automated estimates, not final costs. We'll email ${clientEmail} with your confirmed quote.`, 'success');
  btn.disabled = false; btn.textContent = 'Submit Quote Request';
  state.draftItems = [blankItem()];
  clearDraft();
  state.clientTab = 'jobs';
  setTimeout(() => render(), 1200);
}

// ── OWNER ACTIONS ─────────────────────────────────────────────────────────
function previewOwnerItem(batchId, i) {
  const batch = state.batches.find(b => b.id === batchId);
  if (!batch) return;
  const it    = batch.items[i];
  const mins  = parseFloat((document.getElementById(`mins-${batchId}-${i}`)   || {value:''}).value);
  const grams = parseFloat((document.getElementById(`ograms-${batchId}-${i}`) || {value:''}).value);
  const pEl   = document.getElementById(`opreview-${batchId}-${i}`);
  if (!pEl) return;
  if (!mins || !grams) { pEl.style.display = 'none'; return; }
  const pp  = calcPerPrint(mins, grams, it);
  const tot = pp * it.qty;
  const fr  = itemRate(it);
  document.getElementById(`opval-${batchId}-${i}`).textContent = it.qty > 1 ? `$${tot.toFixed(2)} total` : `$${pp.toFixed(2)}`;
  document.getElementById(`opsub-${batchId}-${i}`).textContent =
    `$2.00 flat × ${it.qty} = $${(2*it.qty).toFixed(2)}\n` +
    `${fmtMinutesWithHours(mins)} × $0.024 × ${it.qty} = $${(mins*0.024*it.qty).toFixed(2)}\n` +
    `${grams}g × $${fr} × ${it.qty} = $${(grams*fr*it.qty).toFixed(2)}` +
    (it.qty > 1 ? `\n$${pp.toFixed(2)} per print × ${it.qty}` : '');
  pEl.style.display = 'block';
}

function applyKnownEstimateToOwnerItem(batchId, i) {
  const batch = state.batches.find(b => b.id === batchId);
  if (!batch || !batch.items || !batch.items[i]) return;
  const item = batch.items[i];
  const known = getKnownEstimate(item);
  if (!known) return;

  item.minutes = known.minutes;
  item.grams = known.grams;

  const minsInput = document.getElementById(`mins-${batchId}-${i}`);
  const hoursInput = document.getElementById(`hours-${batchId}-${i}`);
  const minutesInput = document.getElementById(`minutes-${batchId}-${i}`);
  const gramsInput = document.getElementById(`ograms-${batchId}-${i}`);
  if (minsInput) minsInput.value = known.minutes;
  if (hoursInput) hoursInput.value = hoursFromMinutes(known.minutes);
  if (minutesInput) minutesInput.value = minuteRemainder(known.minutes);
  if (gramsInput) gramsInput.value = known.grams;

  previewOwnerItem(batchId, i);
  render();
}

async function updateBatchPhase(batchId, phase) {
  const b = state.batches.find(x => x.id === batchId);
  if (!b) return;
  const currentPhase = b.phase || 'estimate';
  if (!canAdvanceToPhase(currentPhase, phase)) {
    alert(`Phase must move in order. Next step after "${phaseLabel(currentPhase)}" is "${phaseLabel(ORDER_PHASES[phaseIndex(currentPhase) + 1]?.id || currentPhase)}".`);
    render();
    return;
  }
  b.phase = phase;
  b.status = phase === 'estimate' ? 'pending' : 'quoted';
  stampPhase(b, phase);
  await upsertBatch(b);
  render();
}

async function updatePaymentStatus(batchId, paymentStatus) {
  const b = state.batches.find(x => x.id === batchId);
  if (!b) return;
  const currentStatus = b.paymentStatus || 'unpaid';
  if (!canAdvancePayment(currentStatus, paymentStatus)) {
    alert(`Payment status must move in order. Next step after "${paymentLabel(currentStatus)}" is "${paymentLabel(PAYMENT_PHASES[paymentIndex(currentStatus) + 1]?.id || currentStatus)}".`);
    render();
    return;
  }
  b.paymentStatus = paymentStatus;
  await upsertBatch(b);
  render();
}

function addLibraryEntry() {
  const link = (document.getElementById('lib-link') || { value: '' }).value.trim();
  const name = (document.getElementById('lib-name') || { value: '' }).value.trim();
  const minutes = parseFloat((document.getElementById('lib-mins') || { value: '' }).value);
  const grams = parseFloat((document.getElementById('lib-grams') || { value: '' }).value);

  const res = saveModelLibraryEntry({ link, name, minutes, grams, filType: 'black' });
  if (!res.ok) { showAlert('lib-err', res.error, 'error'); return; }

  showAlert('lib-ok', `Saved library entry (${fmtMinutesWithHours(minutes)}, ${grams}g).`, 'success');
  render();
}

function calculateAndSaveOwnerModel() {
  const calc = state.ownerCalculator || blankOwnerCalculator();
  const link = String(calc.link || '').trim();
  const name = String(calc.name || '').trim();
  const minutes = totalPrintMinutes(calc.hours, calc.minutes);
  const grams = parseFloat(calc.grams);
  const qty = Math.max(1, parseInt(calc.qty, 10) || 1);
  const filType = calc.filType || 'black';

  const res = saveModelLibraryEntry({ link, name, minutes, grams, filType });
  if (!res.ok) {
    showAlert('owner-calc-err', res.error, 'error');
    return;
  }

  const perPrint = calcPerPrint(minutes, grams, filType) || 0;
  state.ownerCalculator.lastResult = {
    link,
    name,
    minutes,
    grams,
    qty,
    filType,
    perPrint,
    total: perPrint * qty
  };

  showAlert('owner-calc-ok', `Calculated and saved ${name || 'model'} to Saved Models for future quotes.`, 'success');
  render();
}

function resetOwnerCalculator() {
  state.ownerCalculator = blankOwnerCalculator();
  render();
}

function setLibrarySaveState(next) {
  librarySaveState = next;
  const text = document.querySelector('.save-indicator span:last-child');
  const wrap = document.querySelector('.save-indicator');
  if (wrap) wrap.classList.toggle('pending', next === 'pending');
  if (text) text.textContent = next === 'pending' ? 'Saving changes...' : 'All changes saved automatically';
}

function toggleLibraryLinkEdit(encodedKey) {
  const key = decodeURIComponent(encodedKey);
  state.libraryEditingKey = state.libraryEditingKey === key ? '' : key;
  render();
}

function updateLibraryEntry(encodedKey, rowId, shouldRender = true) {
  const oldKey = decodeURIComponent(encodedKey);
  const link = (document.getElementById(`${rowId}-link`) || { value: '' }).value.trim();
  const name = (document.getElementById(`${rowId}-name`) || { value: '' }).value.trim();
  const minutes = parseFloat((document.getElementById(`${rowId}-mins`) || { value: '' }).value);
  const grams = parseFloat((document.getElementById(`${rowId}-grams`) || { value: '' }).value);
  const existing = state.modelLibrary[oldKey] || {};

  const hasAnyValue = !!(link || name || Number.isFinite(minutes) || Number.isFinite(grams));
  if (!hasAnyValue) return;

  const newKey = modelKeyFromItem({ link, name });
  if (!newKey || !Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(grams) || grams <= 0) return;

  if (newKey !== oldKey) delete state.modelLibrary[oldKey];
  state.modelLibrary[newKey] = {
    link,
    name,
    minutes,
    grams,
    filType: existing.filType || 'black',
    updatedAt: new Date().toISOString()
  };
  if (state.libraryEditingKey === oldKey || state.libraryEditingKey === newKey) state.libraryEditingKey = newKey;
  persistModelLibrary();
  setLibrarySaveState('saved');
  if (shouldRender) render();
}

function queueLibraryRowSave(encodedKey, rowId) {
  setLibrarySaveState('pending');
  if (libraryAutoSaveTimer) clearTimeout(libraryAutoSaveTimer);
  libraryAutoSaveTimer = setTimeout(() => {
    libraryAutoSaveTimer = null;
    updateLibraryEntry(encodedKey, rowId, true);
  }, 350);
}

function deleteLibraryEntry(encodedKey) {
  const key = decodeURIComponent(encodedKey);
  delete state.modelLibrary[key];
  if (state.libraryEditingKey === key) state.libraryEditingKey = '';
  persistModelLibrary();
  setLibrarySaveState('saved');
  render();
}

async function saveDeliveryInfo(batchId) {
  const b = state.batches.find(x => x.id === batchId);
  if (!b) return;
  b.deliveryDate = (document.getElementById(`ddate-${batchId}`) || { value: '' }).value.trim();
  b.deliveryTracking = (document.getElementById(`dtrack-${batchId}`) || { value: '' }).value.trim();
  b.deliveryNotes = (document.getElementById(`dnotes-${batchId}`) || { value: '' }).value.trim();
  await upsertBatch(b);
  render();
}

async function approveBatch(batchId) {
  const batch = state.batches.find(b => b.id === batchId);
  if (!batch) return;
  let allValid = true;
  batch.items.forEach((it, i) => {
    const mins  = parseFloat((document.getElementById(`mins-${batchId}-${i}`)   || {value:''}).value);
    const grams = parseFloat((document.getElementById(`ograms-${batchId}-${i}`) || {value:''}).value);
    if (!mins || !grams) allValid = false;
    it.minutes = mins  || null;
    it.grams   = grams || it.grams;
    if (mins && grams) saveKnownEstimate(it);
  });
  if (!allValid) { showAlert(`batch-err-${batchId}`, 'Please fill in print time and grams for every item.', 'error'); return; }
  const costInput = document.getElementById(`special-cost-${batchId}`);
  if (costInput) {
    const cost = parseFloat(costInput.value);
    if (!Number.isFinite(cost) || cost < 0) { showAlert(`batch-err-${batchId}`, 'Enter the special order color cost (0 or more).', 'error'); return; }
    batch.specialOrderCost = Math.round(cost * 100) / 100;
  }

  const btn = document.getElementById(`approve-btn-${batchId}`);
  btn.disabled = true; btn.textContent = 'Saving & notifying...';
  batch.status = 'quoted';
  batch.phase = 'quote_sent';
  batch.paymentStatus = 'payment_requested';
  batch.customerApprovedAt = '';
  batch.reminderSentAt = '';
  stampPhase(batch, 'quote_sent');
  await upsertBatch(batch);

  showAlert(`batch-ok-${batchId}`, `Quote saved! ${batch.clientName || 'The customer'} will get an email at ${batch.clientEmail}.`, 'success');
  setTimeout(() => render(), 1800);
}

async function resetBatch(batchId) {
  const b = state.batches.find(b => b.id === batchId);
  if (!b) return;
  b.status = 'pending';
  b.phase = 'estimate';
  b.customerApprovedAt = '';
  b.reminderSentAt = '';
  b.phaseHistory = { estimate: (b.phaseHistory || {}).estimate || b.createdAt };
  b.items.forEach(it => it.minutes = null);
  await upsertBatch(b);
  render();
}

async function deleteBatch(batchId) {
  if (!confirm('Are you sure you want to delete this order? This cannot be undone.')) return;
  state.batches = state.batches.filter(b => b.id !== batchId);
  await deleteBatchRemote(batchId);
  render();
}

function showAlert(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg; el.className = `alert ${type}`; el.style.display = 'block';
}

// Accessibility pass after each render: tie every .field label to its control, and make message
// boxes announce themselves to screen readers.
let a11yIdCounter = 0;
function linkFieldLabels(root = document) {
  root.querySelectorAll('.field').forEach(field => {
    const label = field.querySelector(':scope > label');
    const control = field.querySelector('input:not([type=hidden]), select, textarea');
    if (!label || !control || label.contains(control) || label.htmlFor) return;
    if (!control.id) control.id = `field-${++a11yIdCounter}`;
    label.htmlFor = control.id;
    const help = field.querySelector(':scope > .field-help');
    if (help && !control.hasAttribute('aria-describedby')) {
      if (!help.id) help.id = `help-${++a11yIdCounter}`;
      control.setAttribute('aria-describedby', help.id);
    }
  });
  root.querySelectorAll('.alert').forEach(el => {
    if (!el.hasAttribute('role')) el.setAttribute('role', el.classList.contains('error') ? 'alert' : 'status');
  });
}

function attachAll() {
  linkFieldLabels();
  const pw = document.getElementById('owner-pw');
  if (pw) pw.addEventListener('keydown', e => { if (e.key === 'Enter') checkPw(); });

  const addLibraryFields = ['lib-link', 'lib-name', 'lib-mins', 'lib-grams'];
  addLibraryFields.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addLibraryEntry();
      }
    });
  });

  const ownerCalcFields = ['owner-calc-link', 'owner-calc-name', 'owner-calc-hours', 'owner-calc-mins', 'owner-calc-grams', 'owner-calc-qty'];
  ownerCalcFields.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        calculateAndSaveOwnerModel();
      }
    });
  });
}

init();
