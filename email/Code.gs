// SoloPrint order emails, sent from your own Gmail account.
// Supabase calls this script whenever an order is created or changes (see supabase/email-trigger.sql).
// Setup steps are in email/README.md.
//
// Don't paste this file into Apps Script: paste email/Loader.gs, which runs the latest copy of this file
// from GitHub. Changes here go live within about 20 minutes of reaching main, so keep the checks green.

// The loader version this file needs (see LOADER_VERSION in Loader.gs).
const LOADER_VERSION_NEEDED = 1;

// The secret is NOT stored in this file (the repo is public). Save it once in Apps Script:
// Project Settings (gear) -> Script properties -> Add script property: SECRET = your secret.
// It must match the secret in supabase/email-trigger.sql.
function getSecret() {
  // Forgive quotes, a semicolon or spaces copied along with the secret.
  // The property name is matched in any capitalization (SECRET, Secret, secret).
  const props = PropertiesService.getScriptProperties().getProperties();
  const key = Object.keys(props).find(k => k.trim().toLowerCase() === 'secret');
  return String(key ? props[key] : '').trim().replace(/^['"`]+|['"`;]+$/g, '').trim();
}

// Run from the editor if emails, backups or reminders say "forbidden": shows what the script has saved and
// asks Supabase whether it matches.
function checkSetup() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const names = Object.keys(props);
  const secret = getSecret();
  Logger.log('Script properties found: ' + (names.length ? names.join(', ') : '(none)'));
  if (!secret) {
    Logger.log('No SECRET property. Add it under Project Settings -> Script properties: name SECRET, value = your secret (no quotes).');
    return;
  }
  Logger.log('SECRET is ' + secret.length + ' characters: ' + secret.slice(0, 4) + '...' + secret.slice(-4));
  const res = UrlFetchApp.fetch(SUPA_URL + '/rest/v1/rpc/due_quote_reminders', {
    method: 'post', contentType: 'application/json',
    headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY },
    payload: JSON.stringify({ p_secret: secret, p_days: 36500 }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code === 200) Logger.log('Supabase accepted the secret. Emails, backups and reminders will work.');
  else if (/forbidden/.test(res.getContentText())) Logger.log('Supabase says the secret does NOT match the one in private.email_settings. Fix whichever one is wrong (see email/README.md).');
  else Logger.log('Supabase replied ' + code + ': ' + res.getContentText().slice(0, 200) + ' (if it says the function does not exist, run supabase/site-settings.sql).');
}
const OWNER_EMAIL = 'jeffsolo49@gmail.com';
const SITE_URL = 'https://soloprint.vercel.app';  // your site's address, used for links in emails
const VENMO_USERNAME = 'Jeffrey-Sol-3';
// Public Supabase address and key (the same ones in index.html), used by the weekly backup.
const SUPA_URL = 'https://xpssamjjyarajtwtrwqx.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhwc3NhbWpqeWFyYWp0d3Ryd3F4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMjIxNjMsImV4cCI6MjA5MDc5ODE2M30.nGzAlBtFxdGHLSMThRGTgGH4-0ijpStMSDy2UDApyaM';
const BACKUP_FOLDER = 'SoloPrint backups';
const BACKUPS_TO_KEEP = 12;

const FIL_RATE = { black: 0.024, white: 0.024, color: 0.024, special: 0.034, special_order: 0, leftover: 0 };
const FIL_LABEL = { black: 'Black', white: 'White', color: 'Color', special: 'Special Request', special_order: 'Special order' };

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return reply('bad request'); }
  const secret = getSecret();
  if (secret.length < 20 || body.secret !== secret) return reply('forbidden');
  const site = loadSiteData();
  const emails = emailsFor(body.type, body.record || {}, body.old_record || null, site.emails || {}, site);
  emails.forEach(m => MailApp.sendEmail({ to: m.to, subject: m.subject, body: m.body, name: 'SoloPrint', replyTo: OWNER_EMAIL }));
  return reply('sent ' + emails.length);
}

function reply(text) {
  return ContentService.createTextOutput(text);
}

// ── MODEL LOOKUPS ─────────────────────────────────────────────────────────
// The site calls this (GET ?action=lookup&url=...) when a customer pastes a MakerWorld link, to pre-fill
// print time and filament weight. Browsers can't read MakerWorld directly. (Printables blocks requests
// from Google's servers, so it isn't supported.)
// Results are best-effort automated estimates; the customer can edit them and the owner reviews every order.

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.action !== 'lookup') return reply('ok');
  let result;
  try {
    result = lookupModel(String(params.url || ''));
  } catch (err) {
    result = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function lookupModel(url) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'lookup:' + Utilities.base64EncodeWebSafe(url).slice(0, 200);
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);
  let result;
  const mw = url.match(/^https:\/\/(?:www\.)?makerworld\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?models\/(\d+)/i);
  if (mw) {
    const profile = (url.match(/profileId-(\d+)/i) || [])[1] || '';
    result = parseMakerWorldDesign(fetchMakerWorldDesign(mw[1]), profile);
  } else if (/^https:\/\/(?:www\.)?thingiverse\.com\/thing:\d+/i.test(url)) {
    result = fetchPagePreview(url, 'Thingiverse');
  } else {
    result = { ok: false, error: 'Only MakerWorld and Thingiverse links are supported.' };
  }
  if (result.ok || result.image) cache.put(cacheKey, JSON.stringify(result), 6 * 60 * 60);
  return result;
}

// Title and preview image from a page's link-preview tags. No print time or grams (those sites don't list them).
function fetchPagePreview(url, source) {
  const res = UrlFetchApp.fetch(url, { headers: { 'User-Agent': BROWSER_UA }, muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) return { ok: false, source, error: source + ' returned ' + res.getResponseCode() };
  return parsePagePreview(res.getContentText().slice(0, 300000), source);
}

// Pure function so it can be tested outside Apps Script.
function parsePagePreview(html, source) {
  const meta = name => {
    const re = new RegExp('<meta[^>]+(?:property|name)=["\']' + name + '["\'][^>]*>', 'i');
    const tag = (html.match(re) || [])[0] || '';
    return ((tag.match(/content=["']([^"']*)["']/i) || [])[1] || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  };
  const image = meta('og:image') || meta('twitter:image');
  return {
    ok: false, source, name: meta('og:title') || meta('twitter:title'),
    image: /^https:\/\//i.test(image) ? image : '', minutes: null, grams: null, error: ''
  };
}

function fetchMakerWorldDesign(designId) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('MW_TOKEN');
  const urls = [
    'https://api.bambulab.com/v1/design-service/design/' + designId,
    'https://makerworld.com/api/v1/design-service/design/' + designId
  ];
  const errors = [];
  for (const url of urls) {
    const headers = { 'User-Agent': BROWSER_UA, 'Accept': 'application/json', 'Referer': 'https://makerworld.com/' };
    let res = UrlFetchApp.fetch(url, { headers, muteHttpExceptions: true });
    if ((res.getResponseCode() === 401 || res.getResponseCode() === 403) && token) {
      headers.Authorization = 'Bearer ' + token;
      res = UrlFetchApp.fetch(url, { headers, muteHttpExceptions: true });
    }
    if (res.getResponseCode() === 200) return JSON.parse(res.getContentText());
    errors.push(describeFailure(url, res));
  }
  throw new Error('MakerWorld lookup failed: ' + errors.join(' || '));
}

// Pure function so it can be tested outside Apps Script. prediction is in seconds, weight in grams.
function parseMakerWorldDesign(design, profileId) {
  const instances = Array.isArray(design && design.instances) ? design.instances : [];
  const inst = instances.find(i => profileId && (String(i.id) === profileId || String(i.profileId) === profileId))
    || instances.find(i => String(i.id) === String(design.defaultInstanceId))
    || instances.find(i => i.isDefault) || instances[0];
  if (!inst) return { ok: false, error: 'No print profiles found.' };
  const plates = Array.isArray(inst.plates) ? inst.plates : [];
  const seconds = firstNumber(inst, ['prediction', 'printTime', 'costTime'])
    || sumOf(plates, p => firstNumber(p, ['prediction', 'printTime', 'costTime']));
  const grams = firstNumber(inst, ['weight', 'filamentWeight'])
    || sumOf(plates, p => firstNumber(p, ['weight', 'filamentWeight'])
      || sumOf(p.filaments || [], f => firstNumber(f, ['usedG', 'weight'])));
  const minutes = seconds ? Math.round(seconds / 60) : 0;
  return {
    ok: !!(minutes && grams),
    source: 'MakerWorld',
    name: String(design.title || ''),
    image: String(design.coverUrl || design.cover || ''),
    profile: String(inst.title || ''),
    plates: plates.length,
    minutes: minutes || null,
    grams: grams ? Math.round(grams * 10) / 10 : null,
    error: minutes && grams ? '' : 'This model has no print time or weight listed.'
  };
}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function describeFailure(url, res) {
  const text = res.getContentText().replace(/\s+/g, ' ').slice(0, 200);
  const blocked = /cloudflare|cf-ray|just a moment|attention required/i.test(text) ? ' [looks like a bot check]' : '';
  return url + ' -> ' + res.getResponseCode() + blocked + ': ' + text;
}

function firstNumber(obj, keys) {
  for (const k of keys) {
    const n = Number(obj && obj[k]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function sumOf(list, fn) {
  return (Array.isArray(list) ? list : []).reduce((s, x) => s + (fn(x) || 0), 0);
}

// Optional: only needed if MakerWorld refuses lookups without a login.
// 1. Project Settings -> Script properties: add MW_EMAIL and MW_PASSWORD for a MakerWorld account.
// 2. Run connectMakerWorld. If it says a code was emailed, add MW_CODE with that code and run it again.
function connectMakerWorld() {
  const props = PropertiesService.getScriptProperties();
  const account = props.getProperty('MW_EMAIL');
  const code = props.getProperty('MW_CODE');
  const body = code ? { account, code } : { account, password: props.getProperty('MW_PASSWORD') };
  const res = UrlFetchApp.fetch('https://api.bambulab.com/v1/user-service/user/login', {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true
  });
  const json = JSON.parse(res.getContentText() || '{}');
  if (json.accessToken) {
    props.setProperty('MW_TOKEN', json.accessToken);
    props.deleteProperty('MW_CODE');
    props.deleteProperty('MW_PASSWORD');
    Logger.log('Connected. The login lasts about 3 months; run this again (with MW_PASSWORD) when lookups stop working.');
  } else if (json.loginType === 'verifyCode') {
    Logger.log('MakerWorld emailed a verification code to ' + account + '. Add it as the MW_CODE script property and run connectMakerWorld again.');
  } else {
    Logger.log('Login failed (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300));
  }
}

// Run from the editor to check lookups; paste the log into your chat with Claude if something looks wrong.
function testLookup() {
  ['https://makerworld.com/en/models/922568'].forEach(url => {
    try {
      const mw = url.match(/makerworld\.com\/.*models\/(\d+)/);
      if (mw) {
        const design = fetchMakerWorldDesign(mw[1]);
        const inst = (design.instances || [])[0] || {};
        Logger.log('MakerWorld fields: design=' + Object.keys(design).join(',') + ' | instance=' + Object.keys(inst).join(',')
          + ' | plate=' + Object.keys((inst.plates || [])[0] || {}).join(','));
        Logger.log('MakerWorld first profile: ' + JSON.stringify(inst).slice(0, 1500));
      }
      Logger.log(url + '\n' + JSON.stringify(lookupModel(url)));
    } catch (err) {
      Logger.log(url + '\nERROR ' + err);
    }
  });
}

// ── SCHEDULED JOBS ────────────────────────────────────────────────────────
// Run setupSchedules once (running it again is safe). It schedules:
//  - backupToDrive: every Monday around 3am, saves orders, gallery items and saved models to a JSON file in
//    Google Drive ("SoloPrint backups"), keeping the newest 12. A first backup is made right away.
//  - sendQuoteReminders: every day around 10am, emails customers whose quote has waited 3+ days.
function setupSchedules() {
  ScriptApp.getProjectTriggers()
    .filter(t => ['backupToDrive', 'sendQuoteReminders', 'healthCheck'].includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('backupToDrive').timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(3).create();
  ScriptApp.newTrigger('sendQuoteReminders').timeBased().everyDays(1).atHour(10).create();
  ScriptApp.newTrigger('healthCheck').timeBased().everyHours(6).create();
  backupToDrive();
  healthCheck();
  Logger.log('Scheduled: weekly backup (Mondays ~3am), daily quote reminders (~10am) and a check every 6 hours. A first backup was saved to Drive > ' + BACKUP_FOLDER + '.');
}

// Runs every 6 hours. Throws when something would stop the emails; the loader then emails the owner.
function healthCheck() {
  const secret = getSecret();
  if (secret.length < 20) throw new Error('The SECRET script property is missing or too short (Apps Script -> Project Settings -> Script properties).');
  const res = UrlFetchApp.fetch(SUPA_URL + '/rest/v1/rpc/due_quote_reminders', {
    method: 'post', contentType: 'application/json',
    headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY },
    payload: JSON.stringify({ p_secret: secret, p_days: 36500 }),   // nothing is that old, so no reminders are touched
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (/forbidden/.test(res.getContentText())) throw new Error("The SECRET script property doesn't match the secret saved in Supabase, so Supabase can't send emails through this script.");
  if (code !== 200) throw new Error('Supabase replied ' + code + ': ' + res.getContentText().slice(0, 200));
  Logger.log('All good: the secret matches Supabase.');
}

// Older name, kept so instructions that mention it still work.
function setupWeeklyBackup() {
  setupSchedules();
}

// One friendly reminder per quote that's waited 3+ days without a "Looks good".
// Runs daily (~10am, see setupSchedules): quote reminders, review requests, leftover-roll reminders, and on
// Mondays the owner's weekly summary. Each part runs even if another fails; failures are reported together.
function sendQuoteReminders() {
  const site = loadSiteData(), custom = site.emails || {};
  const errors = [];
  const step = (name, fn) => { try { fn(); } catch (err) { errors.push(name + ': ' + (err && err.message || err)); } };
  let report = null;
  const reportData = () => report || (report = callSupabase('owner_report_data', {}));
  step('Quote reminders', () => {
    const due = callSupabase('due_quote_reminders', { p_days: 3 });
    sendAll(reminderEmails(due, custom, site));
    Logger.log('Quote reminders sent: ' + due.length);
  });
  step('Review requests', () => sendAll(reviewRequestEmails(callSupabase('due_review_requests', { p_days: 7 }), custom, site)));
  step('Leftover roll reminders', () => {
    const props = PropertiesService.getScriptProperties();
    const sent = JSON.parse(props.getProperty('ROLL_REMINDERS') || '{}');
    const out = rollReminderEmails(reportData().jobs, custom, site, new Date(), sent);
    sendAll(out.emails);
    props.setProperty('ROLL_REMINDERS', JSON.stringify(out.sent));
  });
  if (new Date().getDay() === 1) step('Weekly summary', () => sendAll([weeklySummaryEmail(reportData(), custom, site, new Date())]));
  if (errors.length) throw new Error(errors.join('\n'));
}

function sendAll(emails) {
  (emails || []).forEach(m => MailApp.sendEmail({ to: m.to, subject: m.subject, body: m.body, name: 'SoloPrint', replyTo: OWNER_EMAIL }));
}

// Calls one of the secret-protected database functions (supabase/*.sql).
function callSupabase(fn, args) {
  const res = UrlFetchApp.fetch(SUPA_URL + '/rest/v1/rpc/' + fn, {
    method: 'post', contentType: 'application/json',
    headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY },
    payload: JSON.stringify(Object.assign({ p_secret: getSecret() }, args || {})),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode(), text = res.getContentText();
  if (code === 404 || /Could not find the function/i.test(text)) {
    throw new Error(fn + " isn't set up yet: run " + (/review|report/.test(fn) ? 'supabase/owner-tools.sql' : 'the files in supabase/') + ' in the Supabase SQL Editor.');
  }
  if (code !== 200) throw new Error(fn + ' failed (' + code + '): ' + text.slice(0, 300));
  return JSON.parse(text || 'null');
}

function renderEmail(key, to, vars, custom) {
  const t = emailTemplate(key, custom);
  return { to, subject: renderEmailText(t.subject, vars).replace(/\s*\n\s*/g, ' '), body: renderEmailText(t.body, vars) };
}
function validEmail(text) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(text || '')); }

// Pure functions from here, so they can be tested outside Apps Script.
function reviewRequestEmails(records, custom, site) {
  return (records || []).filter(rec => validEmail(rec.clientEmail)).map(rec => renderEmail('review_request', String(rec.clientEmail), emailVars(rec, custom, site), custom));
}

// About 2 weeks before a leftover roll expires, once per roll. `sent` remembers rolls already reminded
// ({ rollId: expiresAt }); expired entries are dropped.
function rollReminderEmails(jobs, custom, site, now, sent) {
  const keep = {};
  Object.keys(sent || {}).forEach(k => { if (new Date(sent[k]) > now) keep[k] = sent[k]; });
  const emails = [];
  leftoverRolls(jobs || []).forEach(roll => {
    const id = roll.orderId + '|' + roll.key;
    const daysLeft = (new Date(roll.expiresAt) - now) / 864e5;
    if (keep[id] || daysLeft <= 0 || daysLeft > 14 || roll.left < 50) return;
    const rec = (jobs || []).find(j => j.id === roll.orderId);
    if (!rec || !validEmail(rec.clientEmail)) return;
    const vars = Object.assign(emailVars(rec, custom, site), { rollColor: roll.color, rollGrams: roll.left.toFixed(0), rollExpires: fmtShortDate(roll.expiresAt) });
    emails.push(renderEmail('roll_reminder', String(rec.clientEmail), vars, custom));
    keep[id] = roll.expiresAt;
  });
  return { emails, sent: keep };
}

function weeklySummaryEmail(report, custom, site, now) {
  const jobs = (report && report.jobs) || [];
  const phase = j => j.phase || 'estimate';
  const weekAgo = now.getTime() - 7 * 864e5;
  const sales = jobs.filter(j => j.paymentStatus === 'payment_recieved' && j.paidAt && new Date(j.paidAt).getTime() >= weekAgo)
    .reduce((s, j) => s + orderTotal(j), 0);
  const inventory = (report && report.private && report.private.inventory) || {};
  const low = ((site && site.colors) || []).filter(c => {
    const s = inventory[c.id];
    return s && isFinite(s.grams) && s.grams <= (isFinite(s.low) ? s.low : 200);
  }).map(c => c.name + ' (' + Math.max(0, Math.round(inventory[c.id].grams)) + ' g)');
  const reviews = Number(report && report.new_reviews) || 0;
  const vars = {
    weekSales: money(sales),
    waitingQuote: String(jobs.filter(j => phase(j) === 'estimate').length),
    waitingApproval: String(jobs.filter(j => phase(j) === 'quote_sent').length),
    unpaid: String(jobs.filter(j => ['order_received', 'production', 'delivered'].includes(phase(j)) && j.paymentStatus !== 'payment_recieved').length),
    printing: String(jobs.filter(j => phase(j) === 'production').length),
    newReviews: reviews ? String(reviews) : '',
    lowStock: low.join(', '),
    siteLink: SITE_URL
  };
  return renderEmail('weekly_summary', OWNER_EMAIL, vars, custom);
}

function reminderEmails(records, custom, site) {
  return (records || []).filter(rec => validEmail(rec.clientEmail)).map(rec => renderEmail('reminder', String(rec.clientEmail), emailVars(rec, custom, site), custom));
}

// Link that opens the customer's requests with this order in view.
function orderLink(rec) {
  return SITE_URL + '/?requests=' + encodeURIComponent(String(rec.clientEmail || '')) + (rec.id ? '#order-' + encodeURIComponent(String(rec.id)) : '');
}

function backupToDrive() {
  const res = UrlFetchApp.fetch(SUPA_URL + '/rest/v1/rpc/backup_export', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY },
    payload: JSON.stringify({ p_secret: getSecret() }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    const msg = 'SoloPrint backup failed (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300);
    MailApp.sendEmail({ to: OWNER_EMAIL, subject: 'SoloPrint backup failed', body: msg + '\n\nCheck that supabase/library-and-backups.sql has been run.', name: 'SoloPrint' });
    throw new Error(msg);
  }
  const folders = DriveApp.getFoldersByName(BACKUP_FOLDER);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(BACKUP_FOLDER);
  const stamp = Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd');
  folder.createFile('soloprint-backup-' + stamp + '.json', res.getContentText(), 'application/json');
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort((a, b) => b.getDateCreated() - a.getDateCreated()).slice(BACKUPS_TO_KEEP).forEach(f => f.setTrashed(true));
  Logger.log('Backup saved: soloprint-backup-' + stamp + '.json');
}

// Run this once from the Apps Script editor to approve Gmail access and send yourself a test email.
function sendTestEmail() {
  MailApp.sendEmail({ to: OWNER_EMAIL, subject: 'SoloPrint email test', body: 'Order emails are set up and working.', name: 'SoloPrint' });
}

// Decide which emails an order change should send. Pure function so it can be tested outside Apps Script.
// `custom` is the owner's edited email text from the site's Emails page; `site` is the site settings
// (for vacation mode). Both come from loadSiteData.
function emailsFor(type, rec, old, custom, site) {
  const emails = [];
  const customer = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(rec.clientEmail || '')) ? String(rec.clientEmail) : '';
  const vars = emailVars(rec, custom, site);
  const send = (key, to) => {
    if (!to) return;
    const t = emailTemplate(key, custom);
    emails.push({ to, subject: renderEmailText(t.subject, vars).replace(/\s*\n\s*/g, ' '), body: renderEmailText(t.body, vars) });
  };

  if (type === 'INSERT') {
    send('owner_new', OWNER_EMAIL);
    send('customer_received', customer);
    return emails;
  }

  if (type !== 'UPDATE' || !old) return emails;

  if (rec.phase !== old.phase) {
    const key = { quote_sent: 'quote', order_received: 'confirmed', production: 'printing', delivered: 'delivered' }[rec.phase];
    if (key) send(key, customer);
  } else if (rec.phase === 'delivered' && deliveryLines(rec).join() !== deliveryLines(old).join() && deliveryLines(rec).length) {
    send('delivery_update', customer);
  }

  if (rec.customerApprovedAt && !old.customerApprovedAt) send('owner_approved', OWNER_EMAIL);

  if (rec.paymentStatus === 'payment_recieved' && old.paymentStatus !== 'payment_recieved') send('payment', customer);
  return emails;
}

// Values for the {placeholders} in email text.
function emailVars(rec, custom, site) {
  const total = orderTotal(rec);
  const unpaid = total && rec.paymentStatus !== 'payment_recieved';
  const vars = {
    name: String(rec.clientName || '').trim() || 'there',
    customerName: String(rec.clientName || '').trim() || 'a customer',
    customerEmail: String(rec.clientEmail || ''),
    title: orderTitle(rec),
    submitted: rec.createdAt ? formatDate(rec.createdAt) : '',
    items: itemLines(rec, false).join('\n\n'),
    itemsWithPrices: itemLines(rec, true).join('\n\n'),
    estimate: total ? money(total) : '',
    total: total ? money(total) : '',
    specialRoll: specialOrderCost(rec) ? money(specialOrderCost(rec)) : '',
    amountDue: unpaid ? money(total) : '',
    venmoLink: unpaid ? venmoUrl(rec, total) : '',
    orderLink: orderLink(rec),
    delivery: deliveryLines(rec).filter(Boolean).join('\n'),
    photo: (Array.isArray(rec.finishedPhotos) ? rec.finishedPhotos : []).filter(u => /^https:\/\//.test(String(u)))[0] || '',
    vacationNote: vacationText(site && site.vacation),
    reviewLink: orderLink(rec).replace('#order-', '&review=' + encodeURIComponent(String(rec.id || '')) + '#order-'),
    siteLink: SITE_URL
  };
  vars.footer = renderEmailText(emailTemplate('footer', custom).body, vars);
  return vars;
}

// Site settings, including the owner's edited email text (Emails page) and vacation mode. If they can't be
// read, emails still go out with the default text.
function loadSiteData() {
  try {
    const res = UrlFetchApp.fetch(SUPA_URL + '/rest/v1/site_settings?id=eq.1&select=data', {
      headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) return {};
    const rows = JSON.parse(res.getContentText() || '[]');
    const data = rows[0] && rows[0].data;
    return data && typeof data === 'object' ? data : {};
  } catch (err) {
    return {};
  }
}

// ── SHARED EMAIL TEMPLATES (exact copy of email-templates.js on the site; edit both together) ──
// Shared by the site and the emails: the automated email text (defaults the owner can change on the
// Emails page, saved in site settings as `emails`) and the leftover-roll rules. email/Code.gs carries
// an exact copy of this file between its SHARED EMAIL TEMPLATES markers, so the site and the emails
// always agree; a test checks the copy.
//
// {placeholders} are filled in when an email is sent. A line whose placeholder has nothing to show
// (no estimate yet, already paid, no delivery details) is left out of the email.

const EMAIL_TEMPLATES = {
  footer: {
    label: 'Footer', to: 'Customer', when: 'The ending of customer emails (wherever {footer} appears). Change it here once and every email uses it.',
    body: 'Track your order any time: {orderLink}\nQuestions? Just reply to this email.\n\nThanks,\nSoloPrint'
  },
  owner_new: {
    label: 'New request', to: 'You', when: 'A customer sends a request.',
    subject: 'New SoloPrint request from {customerName}',
    body: 'Customer: {customerName}\nEmail: {customerEmail}\nSubmitted: {submitted}\nAutomated estimate: ${estimate} (review and send the quote from your dashboard)\n\n{items}'
  },
  customer_received: {
    label: 'Request received', to: 'Customer', when: 'Right after they send a request.',
    subject: 'We received your SoloPrint request',
    body: "Hi {name},\n\nThanks for your request for {title}. We've received your submission and will respond promptly after reviewing it.\n\n{vacationNote}\n\n{items}\n\nAutomated estimate: ${estimate}\nAny prices shown on the site are automated estimates, not exact costs. We'll email your confirmed quote once we've reviewed your request.\n\n{footer}"
  },
  quote: {
    label: 'Quote ready', to: 'Customer', when: 'You click Save All & Notify Client.',
    subject: 'Your SoloPrint quote: ${total}',
    body: 'Hi {name},\n\nYour quote for {title} is ready.\n\n{itemsWithPrices}\n\nSpecial order roll (1 kg): ${specialRoll}\nTotal: ${total}\nAll prints are PLA unless noted or requested.\n\nIf it looks good, tap "Looks good" here: {orderLink} (or just reply to this email).\nNothing is charged yet. We\'ll confirm we can make your order before asking for payment.\n\n{footer}'
  },
  reminder: {
    label: 'Quote reminder', to: 'Customer', when: "3 days after a quote they haven't approved (sent once).",
    subject: 'Still interested? Your SoloPrint quote is waiting',
    body: 'Hi {name},\n\nJust checking in: your quote for {title} is still ready (${total}).\n\nIf it looks good, tap "Looks good" here: {orderLink}\nWant something changed, or have a question? Just reply to this email.\n\nNo pressure: nothing is charged until we\'ve both confirmed the order.\n\n{footer}'
  },
  owner_approved: {
    label: 'Quote approved', to: 'You', when: 'The customer taps "Looks good" on their quote.',
    subject: '{customerName} approved their quote',
    body: '{customerName} ({customerEmail}) approved the quote of ${total} for {title}.\nConfirm the order on your dashboard when you know you can make it.'
  },
  confirmed: {
    label: 'Order confirmed', to: 'Customer', when: 'You move the order to Confirmed.',
    subject: 'Your SoloPrint order is confirmed',
    body: 'Hi {name},\n\nGood news: your order for {title} is confirmed and queued for the printer.\n\nTotal: ${amountDue}\nPay with Venmo: {venmoLink} (the link fills in the amount and your order number)\n\n{footer}'
  },
  printing: {
    label: 'Printing', to: 'Customer', when: 'You move the order to Printing.',
    subject: 'Your SoloPrint order is printing',
    body: "Hi {name},\n\nYour order for {title} is on the printer now. We'll let you know when it's done.\n\n{footer}"
  },
  delivered: {
    label: 'Order complete', to: 'Customer', when: 'You move the order to Delivered.',
    subject: 'Your SoloPrint order is complete',
    body: "Hi {name},\n\nYour order for {title} is complete. Enjoy!\n\nHere's a photo of your print: {photo}\n\n{delivery}\n\n{footer}"
  },
  delivery_update: {
    label: 'Delivery details', to: 'Customer', when: 'You save new delivery details on a delivered order.',
    subject: 'Delivery details for your SoloPrint order',
    body: 'Hi {name},\n\nHere are the delivery details for {title}:\n\n{delivery}\n\n{footer}'
  },
  payment: {
    label: 'Payment received', to: 'Customer', when: 'You mark the payment received.',
    subject: 'Payment received, thank you!',
    body: 'Hi {name},\n\nWe received your payment for {title}. Thank you!\n\n{footer}'
  },
  review_request: {
    label: 'Review request', to: 'Customer', when: "A week after an order is delivered (sent once). Reviews wait for your approval in Site Settings.",
    subject: 'How did your SoloPrint order turn out?',
    body: "Hi {name},\n\nI hope you're enjoying {title}! If you have a minute, I'd love a short review: {reviewLink}\n\nIt helps other people find SoloPrint. Thank you!\n\n{footer}"
  },
  roll_reminder: {
    label: 'Leftover roll reminder', to: 'Customer', when: 'About 2 weeks before a leftover special order roll expires (sent once per roll).',
    subject: 'Your {rollColor} roll is yours until {rollExpires}',
    body: "Hi {name},\n\nYou have about {rollGrams} g left on the {rollColor} roll I ordered for you. It's yours to use until {rollExpires}, and the material is free in another order. After that, I keep any leftover.\n\nWant to use it? Start a request and choose \"Use my leftover roll\": {siteLink}\n\n{footer}"
  },
  weekly_summary: {
    label: 'Weekly summary', to: 'You', when: 'Monday mornings.',
    subject: 'SoloPrint this week: ${weekSales} in sales',
    body: "Here's your week at SoloPrint.\n\nSales in the last 7 days (paid): ${weekSales}\nWaiting for a quote from you: {waitingQuote}\nQuotes waiting on the customer: {waitingApproval}\nConfirmed but not paid yet: {unpaid}\nPrinting now: {printing}\nNew reviews to approve: {newReviews}\nRunning low on: {lowStock}\n\nOpen your dashboard: {siteLink}"
  }
};

const EMAIL_PLACEHOLDERS = {
  name: "Customer's name (or \"there\")",
  customerName: "Customer's name",
  customerEmail: "Customer's email",
  title: 'What they ordered, e.g. "Benchy, Phone stand"',
  submitted: 'When the request was sent',
  items: 'The list of items, colors, links and notes',
  itemsWithPrices: 'The list of items with prices',
  estimate: 'Automated estimate amount',
  total: 'Order total',
  specialRoll: 'Special order roll cost',
  amountDue: 'Total, only while unpaid',
  venmoLink: 'Venmo link with the amount filled in, only while unpaid',
  orderLink: "Link to the customer's order on the site",
  delivery: 'Delivery date, tracking or pickup, and notes',
  photo: 'Link to the first finished-print photo you added',
  vacationNote: 'Your vacation message, only while vacation mode is on',
  reviewLink: 'Link where the customer writes their review',
  rollColor: 'Leftover roll color, e.g. Red TPU',
  rollGrams: 'Grams left on the roll',
  rollExpires: 'Date the roll is theirs until',
  siteLink: "Your site's address",
  weekSales: 'Weekly summary: paid sales in the last 7 days',
  waitingQuote: 'Weekly summary: requests waiting for your quote',
  waitingApproval: 'Weekly summary: quotes waiting on the customer',
  unpaid: 'Weekly summary: confirmed orders not paid yet',
  printing: 'Weekly summary: orders printing now',
  newReviews: 'Weekly summary: reviews waiting for approval',
  lowStock: 'Weekly summary: colors running low',
  footer: 'The Footer, edited at the top of this page'
};

// The owner's version of an email, falling back to the default for any part left blank.
function emailTemplate(key, custom) {
  const def = EMAIL_TEMPLATES[key] || { subject: '', body: '' };
  const own = (custom && custom[key]) || {};
  const pick = (value, fallback) => (typeof value === 'string' && value.trim() ? value : fallback || '');
  return { subject: pick(own.subject, def.subject), body: pick(own.body, def.body) };
}

// Fills in {placeholders}. Lines whose placeholder is empty are dropped; unknown {words} stay as typed.
function renderEmailText(text, vars) {
  const lines = [];
  String(text || '').split('\n').forEach(line => {
    let empty = false;
    const filled = line.replace(/\{(\w+)\}/g, (match, key) => {
      if (!Object.prototype.hasOwnProperty.call(vars, key)) return match;
      const value = vars[key] === null || vars[key] === undefined ? '' : String(vars[key]);
      if (!value) empty = true;
      return value;
    });
    if (!empty) lines.push(filled);
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Colors in a print and leftover rolls ─────────────────────────────────
// Special orders are a color or material the owner doesn't carry: a whole 1 kg roll is bought for the
// order (when the owner confirms it). For 2 months the customer can print more in that same
// color/material from it, up to 1000 g in all (the first order included).
const ROLL_GRAMS = 1000;
const ROLL_PHASES = ['order_received', 'production', 'delivered'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isSpecialOrder(item) {
  return item.filType === 'special_order';
}
// Items printed from the customer's leftover roll don't buy a new one.
function usesSpecialSpool(item) {
  return isSpecialOrder(item) && !item.useLeftover;
}
// Every color in a print: the main one plus any extra colors. Leftover-roll colors are filType 'leftover'.
function itemParts(it) {
  const main = it.filType === 'special_order'
    ? { name: it.specialColor || '', filType: it.useLeftover ? 'leftover' : 'special_order', leftoverFrom: it.useLeftover ? it.leftoverFrom : '' }
    : { name: it.color || FIL_LABEL[it.filType] || 'Black', filType: it.filType, colorId: it.colorId };
  return [main].concat(Array.isArray(it.extraColors) ? it.extraColors : []);
}
function colorKey(text) { return String(text || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function itemGrams(it) { return (Number(it.grams) || 0) * Math.max(1, Number(it.qty) || 1); }
function partGrams(it) { return itemGrams(it) / itemParts(it).length; }
function rollParts(it) { return itemParts(it).filter(p => p.filType === 'leftover'); }
function usesRolls(it) { return isSpecialOrder(it) || rollParts(it).length > 0; }
function rollExpiry(iso) { const d = new Date(iso); d.setMonth(d.getMonth() + 2); return d.toISOString(); }
function fmtShortDate(iso) { const d = new Date(iso); return isNaN(d) ? '' : SHORT_MONTHS[d.getMonth()] + ' ' + d.getDate(); }

// Every roll bought for special orders, with grams used and left. excludeId leaves one order's use out.
function leftoverRolls(batches, excludeId) {
  const rolls = [];
  (batches || []).forEach(b => {
    if (!ROLL_PHASES.includes(b.phase)) return;
    const boughtAt = (b.phaseHistory || {}).order_received || b.createdAt;
    (b.items || []).filter(usesSpecialSpool).forEach(it => {
      const key = colorKey(it.specialColor);
      if (!key) return;
      let roll = rolls.find(r => r.orderId === b.id && r.key === key);
      if (!roll) rolls.push(roll = { orderId: b.id, key, color: it.specialColor, email: colorKey(b.clientEmail), boughtAt, expiresAt: rollExpiry(boughtAt), used: 0 });
      roll.used += partGrams(it);
    });
  });
  (batches || []).forEach(b => {
    if (b.id === excludeId) return;
    (b.items || []).forEach(it => rollParts(it).forEach(p => {
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

// What customers are told while vacation mode is on (site banner and request-received email).
function vacationText(v) {
  if (!v || !v.on) return '';
  if (v.message && String(v.message).trim()) return String(v.message).trim();
  return v.until ? "I'm away until " + v.until + ". I'll review your request when I'm back." : "I'm away right now. I'll review your request when I'm back.";
}
// ── END SHARED EMAIL TEMPLATES ──

function itemLines(rec, withPrices) {
  return (rec.items || []).map((it, i) => {
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const material = it.color ? `   Color: ${it.color}${it.filType === 'special' ? ' (special)' : ''}`
      : isSpecialOrderItem(it) ? `   Special order: ${it.specialColor || 'color/material not given'}${it.useLeftover ? ' (from your leftover roll, no material charge)' : ' (full 1 kg roll; the rest is yours for 2 months, and the material is free in another order)'}`
      : `   Filament: ${FIL_LABEL[it.filType] || 'Black'}`;
    const lines = [`${i + 1}) ${it.name || 'Unnamed'}${qty > 1 ? ` x ${qty}` : ''}`, material];
    const extras = extraColors(it);
    if (extras.length) lines.push(`   Also: ${extras.map(p => p.name + (p.filType === 'leftover' ? ' (leftover roll)' : '')).join(', ')}`);
    if (withPrices && it.minutes && it.grams) {
      const each = perPrint(it);
      lines.push(`   Price: $${money(each * qty)}${qty > 1 ? ` ($${money(each)} each)` : ''}`);
    }
    if (it.link) lines.push(`   Link: ${it.link}`);
    if (it.notes) lines.push(`   Notes: ${it.notes}`);
    (Array.isArray(it.imageLinks) ? it.imageLinks : []).slice(0, 5).forEach((u, n) => lines.push(`   Photo ${n + 1}: ${u}`));
    return lines.join('\n');
  });
}

function deliveryLines(rec) {
  const lines = [];
  if (rec.deliveryDate) lines.push(`Delivery date: ${rec.deliveryDate}`);
  if (rec.deliveryTracking) lines.push(`Tracking / pickup: ${rec.deliveryTracking}`);
  if (rec.deliveryNotes) lines.push(`Notes: ${rec.deliveryNotes}`);
  return lines.length ? [''].concat(lines) : [];
}

function perPrint(it) {
  return 2 + Number(it.minutes) * 0.024 + Number(it.grams) * itemRate(it);
}

function extraColors(it) {
  return (Array.isArray(it.extraColors) ? it.extraColors : []).filter(p => p && p.name);
}

// Multi-color prints split the grams evenly between their colors; rolls (new or leftover) have no per-gram charge.
function itemRate(it) {
  const main = isSpecialOrderItem(it) ? 0 : (FIL_RATE[it.filType] ?? 0.024);
  const rates = [main].concat(extraColors(it).map(p => FIL_RATE[p.filType] ?? 0.024));
  return rates.reduce((s, r) => s + r, 0) / rates.length;
}

function orderTotal(rec) {
  const items = rec.items || [];
  if (!items.length || !items.every(it => it.minutes && it.grams)) return 0;
  return items.reduce((s, it) => s + perPrint(it) * Math.max(1, parseInt(it.qty, 10) || 1), 0) + specialOrderCost(rec);
}

function isSpecialOrderItem(it) {
  return it.filType === 'special_order' || (it.filType === 'special' && !it.colorId && !!it.specialColor);
}

// The 1 kg roll for special orders (a color or material not carried), charged instead of per gram.
// The owner can change it per order; 0 when every special item uses the customer's leftover roll.
function specialOrderCost(rec) {
  const items = (rec.items || []).filter(it => isSpecialOrderItem(it) || extraColors(it).some(p => p.filType === 'leftover'));
  if (!items.length) return 0;
  const cost = rec.specialOrderCost;
  if (cost !== null && cost !== undefined && cost !== '' && Number(cost) >= 0) return Number(cost);
  return items.some(it => isSpecialOrderItem(it) && !it.useLeftover) ? 20 : 0;
}

function orderTitle(rec) {
  const items = rec.items || [];
  return items.length ? items.map(it => it.name || 'Unnamed').join(', ') : 'your request';
}

function venmoUrl(rec, total) {
  const note = `SoloPrint order ${rec.id}: ${orderTitle(rec)}`.slice(0, 140);
  return `https://venmo.com/${encodeURIComponent(VENMO_USERNAME)}?txn=pay&amount=${money(total)}&note=${encodeURIComponent(note)}`;
}

function money(n) {
  return (Number(n) || 0).toFixed(2);
}

function formatDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('en-US', { timeZone: 'America/Chicago' });
}

if (typeof module !== 'undefined') module.exports = { emailsFor, parseMakerWorldDesign, parsePagePreview, reminderEmails, orderLink };
