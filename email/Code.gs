// SoloPrint order emails, sent from your own Gmail account.
// Supabase calls this script whenever an order is created or changes (see supabase/email-trigger.sql).
// Setup steps are in email/README.md.
//
// Don't paste this file into Apps Script: paste email/Loader.gs, which runs the latest copy of this file
// from GitHub. Changes here go live within about 20 minutes of reaching main, so keep the checks green.

// The loader version this file needs (see LOADER_VERSION in Loader.gs).
const LOADER_VERSION_NEEDED = 3;   // 2: collectReplies (reads replies in Gmail); 3: Drive write permission for backups

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
// Public Supabase address and key (the same ones in index.html), used by the weekly backup.
const SUPA_URL = 'https://xpssamjjyarajtwtrwqx.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhwc3NhbWpqeWFyYWp0d3Ryd3F4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMjIxNjMsImV4cCI6MjA5MDc5ODE2M30.nGzAlBtFxdGHLSMThRGTgGH4-0ijpStMSDy2UDApyaM';
const BACKUP_FOLDER = 'SoloPrint backups';
const BACKUPS_TO_KEEP = 12;

// Prices, roll rules, reminder timing and the Venmo username come from the owner's Site Settings, with the
// defaults and pricing math in the shared block below (RULE_DEFAULTS, orderRules, printPrice, rollCharge).
const FIL_LABEL = { black: 'Black', white: 'White', color: 'Color', special: 'Special Request', special_order: 'Special order' };

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return reply('bad request'); }
  const secret = getSecret();
  if (secret.length < 20 || body.secret !== secret) return reply('forbidden');
  const site = loadSiteData();
  if (body.type === 'MESSAGE') {
    const m = messageEmail(body.message || {}, body.record || {}, site);
    if (!m) return reply('sent 0');
    mail(m, m.replyTo);
    return reply('sent 1');
  }
  const phase = (body.record || {}).phase;
  if (phase === 'quote_sent' || phase === 'order_received') site.queue = loadQueue();
  const emails = emailsFor(body.type, body.record || {}, body.old_record || null, site.emails || {}, site);
  emails.forEach(m => mail(m, OWNER_EMAIL));
  logSentEmails(body.record || {}, emails);
  return reply('sent ' + emails.length);
}

// ── MESSAGES (supabase/messages.sql) ──────────────────────────────────────
// Each order has a conversation on the site. Messages written there are emailed from here; emails to
// the customer are logged on it; replies in Gmail are collected every 5 minutes (collectReplies).
// Site messages carry "[SoloPrint #<order>]" in the subject so replies find their order.
function messageTag(rec) { return '[SoloPrint #' + String(rec.id || '') + ']'; }
function messageEmail(msg, rec, site) {
  const text = String(msg.body || '').trim();
  const customer = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(rec.clientEmail || '')) ? String(rec.clientEmail) : '';
  if (!text || !rec.id) return null;
  if (msg.sender === 'owner') {
    if (!customer) return null;
    const vars = emailVars(rec, (site && site.emails) || {}, site);
    return { to: customer, replyTo: OWNER_EMAIL, subject: messageTag(rec) + ' ' + orderTitle(rec), body: text + '\n\n' + vars.footer };
  }
  const name = String(rec.clientName || '').trim() || 'A customer';
  return { to: OWNER_EMAIL, replyTo: customer || OWNER_EMAIL, subject: messageTag(rec) + ' Message from ' + name + ': ' + orderTitle(rec),
    body: name + (customer ? ' (' + customer + ')' : '') + ' wrote on their order page:\n\n' + text + '\n\nReply to this email, or on the order in your dashboard: ' + SITE_URL };
}
// The shop's emails to the customer go on the order's conversation. Never stops an email from sending.
function logSentEmails(rec, emails) {
  const customer = String(rec.clientEmail || '').toLowerCase();
  const rows = (emails || []).filter(m => customer && String(m.to).toLowerCase() === customer)
    .map(m => ({ job_id: String(rec.id || ''), email: customer, sender: 'owner', via: m.kind === 'details_check' ? 'email' : 'auto', subject: m.subject, body: m.body }));
  if (!rows.length) return;
  try { callSupabase('record_messages', { p_rows: rows }); } catch (err) { Logger.log('Messages not logged: ' + (err && err.message || err)); }
}
function emailAddress(text) {
  const s = String(text || '').split(',')[0];
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}
// The new part of a reply: everything above the quoted earlier email.
function replyText(text) {
  let t = String(text || '').replace(/\r\n/g, '\n');
  const cuts = [/\n[^\n]*On [^\n]{0,200}(\n[^\n]{0,200})?wrote:\s*\n/, /\n-{2,}\s*Original Message/i, /\n_{10,}/, /\nFrom: [^\n]+\n(Sent|Date): /];
  cuts.forEach(re => { const m = ('\n' + t).match(re); if (m) t = ('\n' + t).slice(0, m.index).slice(1); });
  return t.split('\n').filter(line => !/^\s*>/.test(line)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
// Runs every 10 minutes. Finds replies in Gmail to SoloPrint emails (the customer's, and yours written in
// Gmail) and records them on the right order. Only addresses that belong to an order are kept.
function collectReplies() {
  const owner = OWNER_EMAIL.toLowerCase();
  const rows = [];
  GmailApp.search('subject:SoloPrint newer_than:3d -in:spam -in:trash', 0, 100).forEach(thread => thread.getMessages().forEach(m => {
    const from = emailAddress(m.getFrom());
    const subject = String(m.getSubject() || '');
    const mine = from === owner;
    // The shop's own emails (never "Re:") are logged when they're sent.
    if (mine && !/^\s*re:/i.test(subject)) return;
    const body = replyText(m.getPlainBody());
    if (!body) return;
    const tag = subject.match(/\[SoloPrint #([A-Za-z0-9_-]{1,64})\]/);
    rows.push({ email_id: m.getId(), job_id: tag ? tag[1] : '', email: mine ? emailAddress(m.getTo()) : from,
      sender: mine ? 'owner' : 'customer', via: 'email', subject: subject.slice(0, 300), body: body.slice(0, 5000), at: m.getDate().toISOString() });
  }));
  const added = rows.length ? callSupabase('record_messages', { p_rows: rows }) : 0;
  Logger.log('Replies found: ' + rows.length + ', new: ' + added);
  return added;
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
  scheduleReplies(true);
  ScriptApp.newTrigger('backupToDrive').timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(3).create();
  ScriptApp.newTrigger('sendQuoteReminders').timeBased().everyDays(1).atHour(10).create();
  ScriptApp.newTrigger('healthCheck').timeBased().everyHours(6).create();
  backupToDrive();
  healthCheck();
  Logger.log('Scheduled: weekly backup (Mondays ~3am), daily quote reminders (~10am), a check every 6 hours' + (loaderHasReplies() ? ' and Gmail replies every ' + REPLY_CHECK_MINUTES + ' minutes' : '') + '. A first backup was saved to Drive > ' + BACKUP_FOLDER + '.');
}

// Runs every 6 hours. Throws when something would stop the emails; the loader then emails the owner.
// How often Gmail replies are checked. Google allows 1, 5, 10, 15 or 30; every 5 uses about 15 minutes of
// the free account's 90 minutes a day of script time, leaving plenty for emails and backups.
const REPLY_CHECK_MINUTES = 5;
// The reply check is a function of the pasted loader (version 2 and up); the code itself can't see it otherwise.
function loaderHasReplies() { return typeof globalThis !== 'undefined' && typeof globalThis.collectReplies === 'function'; }
// Makes sure the reply check runs every REPLY_CHECK_MINUTES. Runs from setupSchedules and from the 6-hourly
// check, so a new interval takes effect by itself (Apps Script can't read a schedule's interval, so the one
// set last is kept in Script properties).
function scheduleReplies(force) {
  if (!loaderHasReplies()) return false;
  const props = PropertiesService.getScriptProperties();
  const triggers = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'collectReplies');
  if (!force && triggers.length === 1 && props.getProperty('REPLY_CHECK_MINUTES') === String(REPLY_CHECK_MINUTES)) return false;
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('collectReplies').timeBased().everyMinutes(REPLY_CHECK_MINUTES).create();
  props.setProperty('REPLY_CHECK_MINUTES', String(REPLY_CHECK_MINUTES));
  return true;
}

function healthCheck() {
  try { if (scheduleReplies(false)) Logger.log('Gmail replies are now checked every ' + REPLY_CHECK_MINUTES + ' minutes.'); }
  catch (err) { Logger.log('Reply schedule not changed: ' + (err && err.message || err)); }
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
  const site = loadSiteData(), custom = site.emails || {}, rules = shopRules(site);
  const errors = [];
  const step = (name, fn) => { try { fn(); } catch (err) { errors.push(name + ': ' + (err && err.message || err)); } };
  let report = null;
  const reportData = () => report || (report = callSupabase('owner_report_data', {}));
  step('Quote reminders', () => {
    const due = callSupabase('due_quote_reminders', { p_days: rules.quoteReminderDays });
    sendAll(reminderEmails(due, custom, site));
    Logger.log('Quote reminders sent: ' + due.length);
  });
  if (!featureOff(site, 'reviews')) step('Review requests', () => sendAll(reviewRequestEmails(callSupabase('due_review_requests', { p_days: rules.reviewRequestDays }), custom, site)));
  step('Unfinished request reminders', () => sendAll(draftReminderEmails(callSupabase('due_draft_reminders', { p_days: rules.draftReminderDays }), custom)));
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
  (emails || []).forEach(m => mail(m, OWNER_EMAIL));
}

// Every email goes out as plain text plus the same text as HTML with its web links made into real links,
// so links can be tapped in every mail app.
function mail(m, replyTo) {
  MailApp.sendEmail({ to: m.to, subject: m.subject, body: m.body, htmlBody: emailHtml(m.body), name: 'SoloPrint', replyTo: replyTo });
}
function emailHtml(text) {
  const safe = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const linked = safe.replace(/\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g, url => '<a href="' + url + '">' + url + '</a>');
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;">' + linked.replace(/\n/g, '<br>') + '</div>';
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
    throw new Error(fn + " isn't set up yet: run " + (/draft/.test(fn) ? 'supabase/drafts.sql' : /review|report/.test(fn) ? 'supabase/owner-tools.sql' : 'the files in supabase/') + ' in the Supabase SQL Editor.');
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

// "Want to finish your request?" for drafts left unsent (see supabase/drafts.sql).
function draftReminderEmails(drafts, custom) {
  return (drafts || []).filter(d => validEmail(d.clientEmail) && d.id).map(d => {
    const items = ((d.data && d.data.items) || []).map(draftItemSummary).filter(Boolean);
    const vars = {
      name: String(d.clientName || '').trim() || 'there',
      draftSummary: items.length ? items.join(', ') : 'a 3D print',
      resumeLink: SITE_URL + '/?resume=' + encodeURIComponent(d.id),
      siteLink: SITE_URL
    };
    return renderEmail('draft_reminder', String(d.clientEmail), vars, custom);
  });
}
function draftItemSummary(it) {
  if (!it) return '';
  const text = String(it.name || '').trim() || String(it.notes || '').trim().split(/\s+/).slice(0, 6).join(' ');
  if (text) return text.length > 60 ? text.slice(0, 57) + '...' : text;
  const kept = Object.values(it.modeDrafts || {}).map(draftItemSummary).filter(Boolean);
  return kept[0] || (it.link ? 'a model from a link' : '');
}

// About 2 weeks before a leftover roll expires, once per roll. `sent` remembers rolls already reminded
// ({ rollId: expiresAt }); expired entries are dropped.
function rollReminderEmails(jobs, custom, site, now, sent) {
  const keep = {};
  const rules = shopRules(site);
  Object.keys(sent || {}).forEach(k => { if (new Date(sent[k]) > now) keep[k] = sent[k]; });
  const emails = [];
  leftoverRolls(jobs || [], '', rules).forEach(roll => {
    const id = roll.orderId + '|' + roll.key;
    const daysLeft = (new Date(roll.expiresAt) - now) / 864e5;
    if (keep[id] || daysLeft <= 0 || daysLeft > rules.rollReminderDays || roll.left < 50) return;
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
  const sales = jobs.filter(j => isPaidInFull(j) && j.paidAt && new Date(j.paidAt).getTime() >= weekAgo)
    .reduce((s, j) => s + orderTotal(j, site), 0);
  const inventory = (report && report.private && report.private.inventory) || {};
  const low = ((site && site.colors) || []).filter(c => {
    const s = inventory[c.id];
    return s && isFinite(s.grams) && s.grams <= (isFinite(s.low) ? s.low : shopRules(site).lowStockGrams);
  }).map(c => c.name + ' (' + Math.max(0, Math.round(inventory[c.id].grams)) + ' g)');
  const reviews = Number(report && report.new_reviews) || 0;
  const vars = {
    weekSales: money(sales),
    waitingQuote: String(jobs.filter(j => phase(j) === 'estimate').length),
    waitingApproval: String(jobs.filter(j => phase(j) === 'quote_sent').length),
    unpaid: String(jobs.filter(j => ['order_received', 'production', 'delivered'].includes(phase(j)) && !isPaidInFull(j)).length),
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
    emails.push({ to, kind: key, subject: renderEmailText(t.subject, vars).replace(/\s*\n\s*/g, ' '), body: renderEmailText(t.body, vars) });
  };

  if (type === 'INSERT') {
    send('owner_new', OWNER_EMAIL);
    send('customer_received', customer);
    return emails;
  }

  if (type !== 'UPDATE' || !old) return emails;

  if (rec.phase !== old.phase && rec.phase === 'details_check') {
    // The owner wrote and checked this email on the site; send exactly that.
    const d = rec.detailsEmail || {};
    if (customer && String(d.body || '').trim()) emails.push({ to: customer, kind: 'details_check', subject: String(d.subject || 'Quick check on your SoloPrint request').replace(/\s+/g, ' ').trim().slice(0, 200), body: String(d.body).slice(0, 10000) });
    else send('details_check', customer);
  } else if (rec.phase !== old.phase) {
    const key = { quote_sent: 'quote', order_received: 'confirmed', production: 'printing', final_payment_needed: 'final_payment_needed', delivered: 'delivered' }[rec.phase];
    if (key) send(key, customer);
  } else if (rec.phase === 'delivered' && deliveryLines(rec).join() !== deliveryLines(old).join() && deliveryLines(rec).length) {
    send('delivery_update', customer);
  }

  if (rec.customerApprovedAt && !old.customerApprovedAt) send('owner_approved', OWNER_EMAIL);

  if (rec.paymentStatus === 'deposit_received' && old.paymentStatus !== 'deposit_received' && !isPaidInFull(old)) send('deposit', customer);
  if (isPaidInFull(rec) && !isPaidInFull(old)) send('payment', customer);
  return emails;
}

// Values for the {placeholders} in email text.
function emailVars(rec, custom, site) {
  const rules = orderRules(rec, site);
  const total = orderTotal(rec, site);
  const roll = rollCharge(rec, rules);
  const left = total ? amountLeft(rec, total, rules) : 0;
  const unpaid = left > 0;
  const vars = {
    name: String(rec.clientName || '').trim() || 'there',
    customerName: String(rec.clientName || '').trim() || 'a customer',
    customerEmail: String(rec.clientEmail || ''),
    title: orderTitle(rec),
    submitted: rec.createdAt ? formatDate(rec.createdAt) : '',
    items: itemLines(rec, false, site).join('\n\n'),
    itemsWithPrices: itemLines(rec, true, site).join('\n\n'),
    estimate: total ? money(total) : '',
    total: (rec.items || []).length && rec.items.every(itemPriced) ? money(total) : '',
    specialRoll: roll ? money(roll) : '',
    extraCharges: extraCharges(rec).map(c => c.label + ': $' + money(c.amount)).join('\n'),
    amountDue: unpaid ? money(left) : '',
    venmoLink: unpaid ? venmoUrl(rec, left, rules) : '',
    materialNote: (site && site.materialNote) || DEFAULT_MATERIAL_NOTE,
    queueNote: queueNote(rec, site),
    designTermsNote: rec.designTerms ? 'This order includes a custom design. When you approve your quote, you will be asked to read and agree to my custom design terms.' : '',
    orderLink: orderLink(rec),
    delivery: deliveryLines(rec).filter(Boolean).join('\n'),
    photo: (Array.isArray(rec.finishedPhotos) ? rec.finishedPhotos : []).filter(u => /^https:\/\//.test(String(u)))[0] || '',
    vacationNote: vacationText(site && site.vacation),
    reviewLink: orderLink(rec).replace('#order-', '&review=' + encodeURIComponent(String(rec.id || '')) + '#order-'),
    siteLink: SITE_URL
  };
  vars.detailsItems = [vars.itemsWithPrices, vars.specialRoll ? 'Special order roll: $' + vars.specialRoll : '', vars.extraCharges,
    vars.total ? 'Total: $' + vars.total : ''].filter(Boolean).join('\n\n');
  vars.footer = renderEmailText(emailTemplate('footer', custom).body, vars);
  return vars;
}

// Confirmed/printing orders for the wait estimate (supabase/queue.sql). Without it, emails just skip the line.
function loadQueue() {
  try {
    const res = UrlFetchApp.fetch(SUPA_URL + '/rest/v1/rpc/order_queue', {
      method: 'post', contentType: 'application/json',
      headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY },
      payload: '{}', muteHttpExceptions: true
    });
    return res.getResponseCode() === 200 ? JSON.parse(res.getContentText() || '[]') : null;
  } catch (err) {
    return null;
  }
}

// Features the owner switched off in Settings -> Show / hide.
function featureOff(site, key) { return !!(site && site.features && site.features[key] === false); }

function queueNote(rec, site) {
  if (!site || !Array.isArray(site.queue) || featureOff(site, 'queue')) return '';
  const rules = shopRules(site), custom = orderIsCustom(rec);
  if (rec.phase === 'quote_sent') {
    const q = queueEstimate(site.queue, rules, '', custom);
    return 'Right now there ' + (q.ahead === 1 ? 'is ' : 'are ') + aheadText(q.ahead).replace(' of yours', '') + ', so once you approve, expect it to be printed in ' + daysText(q.minDays, q.maxDays) + '.';
  }
  if (rec.phase === 'order_received') {
    const at = queueTime(rec);
    if (!at) {
      const waiting = queueEstimate(site.queue.filter(e => e.at || e.printing), rules, '', custom);
      return "Your place in line is set when your deposit comes in. Right now there " + (waiting.ahead === 1 ? 'is ' : 'are ') + aheadText(waiting.ahead).replace(' of yours', '') + '.';
    }
    const q = queueEstimate(site.queue, rules, at, custom);
    return "You're number " + (q.ahead + 1) + ' in line, so expect it to be printed in ' + daysText(q.minDays, q.maxDays) + '.';
  }
  return '';
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

// ── SHARED EMAIL TEMPLATES
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
  details_check: {
    label: 'Confirm details', to: 'Customer', when: 'You tap "Confirm details" on a request. You see the email and can edit it before it sends.',
    subject: 'Quick check on your SoloPrint request',
    body: "Hi {name},\n\nThanks for your request for {title}. Before I put your quote together, please check the details below.\n\n{detailsQuestions}\n\n{detailsItems}\n\nQuestions? Just reply to this email.\n\nThanks,\nJeff Solomon\nSoloPrint"
  },
  quote: {
    label: 'Quote ready', to: 'Customer', when: 'You click Save All & Notify Client.',
    subject: 'Your SoloPrint quote: ${total}',
    body: 'Hi {name},\n\nYour quote for {title} is ready.\n\n{itemsWithPrices}\n\nSpecial order roll: ${specialRoll}\n{extraCharges}\nTotal: ${total}\n{materialNote}\n\n{designTermsNote}\n{queueNote}\n\nIf it looks good, tap "Looks good" here: {orderLink} (or just reply to this email).\nNothing is charged yet. We\'ll confirm we can make your order before asking for payment.\n\n{footer}'
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
    body: 'Hi {name},\n\nGood news: your order for {title} is confirmed and queued for the printer.\n{queueNote}\n\nTotal: ${amountDue}\nPay with Venmo: {venmoLink} (the link fills in the amount and your order number)\n\n{footer}'
  },
  printing: {
    label: 'Printing', to: 'Customer', when: 'You move the order to Printing.',
    subject: 'Your SoloPrint order is printing',
    body: "Hi {name},\n\nYour order for {title} is on the printer now. We'll let you know when it's done.\n\n{footer}"
  },
  final_payment_needed: {
    label: 'Printing complete', to: 'Customer', when: 'You move the order to Printing Complete.',
    subject: 'Your SoloPrint order is ready — final payment needed',
    body: "Hi {name},\n\nYour order for {title} is done printing! The total cost is ${amountDue}.\n\nShipping address is also needed at this point. If you are in the USA, shipping costs $15 for USPS. $1 is for packaging and the rest for postage. Typically the cost for postage is about $9.50 and anything not spent on postage will be refunded. We charge the extra amount so we can ship it on the same trip to the post office without waiting for shipping payments.\n\nPay with Venmo: {venmoLink}\nThen reply to this email with your shipping address.\n\n{footer}"
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
  deposit: {
    label: 'Deposit received', to: 'Customer', when: 'You mark the deposit received. Their place in line is set now.',
    subject: 'Deposit received for your SoloPrint order',
    body: 'Hi {name},\n\nWe received your deposit for {title}. Thank you!\n\n{queueNote}\n\nThe rest (${amountDue}) is due when your order is ready. Pay with Venmo: {venmoLink}\n\n{footer}'
  },
  payment: {
    label: 'Payment received', to: 'Customer', when: 'You mark the payment received.',
    subject: 'Payment received, thank you!',
    body: 'Hi {name},\n\nWe received your payment for {title}. Thank you!\n\n{footer}'
  },
  review_request: {
    label: 'Review request', to: 'Customer', when: "A week after an order is delivered (sent once). Reviews wait for your approval in Settings > Reviews.",
    subject: 'How did your SoloPrint order turn out?',
    body: "Hi {name},\n\nI hope you're enjoying {title}! If you have a minute, I'd love a short review: {reviewLink}\n\nIt helps other people find SoloPrint. Thank you!\n\n{footer}"
  },
  roll_reminder: {
    label: 'Leftover roll reminder', to: 'Customer', when: 'About 2 weeks before a leftover special order roll expires (sent once per roll).',
    subject: 'Your {rollColor} roll is yours until {rollExpires}',
    body: "Hi {name},\n\nYou have about {rollGrams} g left on the {rollColor} roll I ordered for you. It's yours to use until {rollExpires}, and the material is free in another order. After that, I keep any leftover.\n\nWant to use it? Start a request and choose \"Use my leftover roll\": {siteLink}\n\n{footer}"
  },
  draft_reminder: {
    label: 'Unfinished request', to: 'Customer', when: "A week after someone starts a request but doesn't send it (sent once; the days are in Prices and rules).",
    subject: 'Want to finish your SoloPrint request?',
    body: "Hi {name},\n\nYou started a request for {draftSummary} but didn't send it. It's saved, so you can pick up right where you left off: {resumeLink}\n\nIf you've changed your mind, no problem: just ignore this email.\n\nThanks,\nSoloPrint"
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
  materialNote: 'Your material note from Settings > Wording (e.g. "All prints are PLA...")',
  extraCharges: 'Charges you added to the order, one per line (e.g. "Special costs: $15.00")',
  designTermsNote: 'Quotes with a custom design: a reminder that they agree to your design terms when approving',
  detailsQuestions: 'Confirm details email: your questions for this customer (you type them when you send it)',
  detailsItems: 'Full breakdown: every item with its color, parts, logo, link, notes and price (or estimate), then charges and the total',
  queueNote: 'Quote and confirmed emails: how many orders are ahead and about how many days until it\'s printed',
  photo: 'Link to the first finished-print photo you added',
  vacationNote: 'Your vacation message, only while vacation mode is on',
  reviewLink: 'Link where the customer writes their review',
  rollColor: 'Leftover roll color, e.g. Red TPU',
  rollGrams: 'Grams left on the roll',
  rollExpires: 'Date the roll is theirs until',
  siteLink: "Your site's address",
  draftSummary: 'Unfinished request: what they started, e.g. "a phone stand"',
  resumeLink: 'Unfinished request: link that reopens their saved request',
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
    const filled = line.replace(/\{(\w+)\}/g, (match, typed) => {
      // {detailsitems} works as well as {detailsItems}
      const key = Object.prototype.hasOwnProperty.call(vars, typed) ? typed : Object.keys(vars).find(k => k.toLowerCase() === typed.toLowerCase());
      if (!key) return match;
      const value = vars[key] === null || vars[key] === undefined ? '' : String(vars[key]);
      if (!value) empty = true;
      return value;
    });
    if (!empty) lines.push(filled);
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Prices and shop rules ─────────────────────────────────────────────────
// The owner edits these in Site Settings (saved as settings.rules); anything left blank uses the default.
// Each quote saves the rates it was sent with (order.rates), so changing prices never changes an order
// that was already quoted. Orders quoted before rates were saved keep the original prices (LEGACY_RATES).
const RULE_DEFAULTS = {
  baseFee: 2,              // $ per print
  minuteRate: 0.024,       // $ per minute of print time
  gramRate: 0.024,         // $ per gram, regular colors
  specialGramRate: 0.034,  // $ per gram, special colors (silk, TPU...)
  rollCost: 20,            // usual price of a special order roll
  rollGrams: 1000,         // grams in a special order roll
  rollMonths: 2,           // how long a leftover roll stays the customer's
  quoteReminderDays: 3,    // days after a quote with no answer before the reminder email
  reviewRequestDays: 7,    // days after delivery before asking for a review
  rollReminderDays: 14,    // days before a leftover roll expires to remind the customer
  draftReminderDays: 7,    // days after someone leaves a request unsent before the "finish your request" email
  printDaysMin: 1,         // order queue: days to print an existing design, at least...
  printDaysMax: 2,         // ...and at most
  customDesignDays: 7,     // order queue: extra days to design a custom order (at least)
  depositPercent: 50,      // deposit customers can pay first, % of the total (0 = no deposit option)
  logoPrice: 1,            // $ per print to add the customer's company logo (the "Add my logo" box)
  lowStockGrams: 200,      // warn when a color is down to this many grams (each color can override)
  venmo: 'Jeffrey-Sol-3'   // Venmo username for the Pay button and email link
};
const LEGACY_RATES = { baseFee: 2, minuteRate: 0.024, gramRate: 0.024, specialGramRate: 0.034 };
const RATE_KEYS = ['baseFee', 'minuteRate', 'gramRate', 'specialGramRate', 'logoPrice'];
const DEFAULT_MATERIAL_NOTE = 'All prints are PLA unless noted or requested.';
// Terms a customer agrees to before approving a quote that includes a custom design (editable in Site
// Settings -> Wording; each quote keeps the exact text it was sent with).
const DEFAULT_DESIGN_TERMS = [
  'Custom design terms',
  '',
  '1. Free design work. I design your item without charging for the design time. You pay only for the print (print time, material and any special order roll), as quoted.',
  '2. 50% deposit. Before I start designing, you pay a deposit of half of your estimate. The rest is due when the design is done.',
  '3. Unpaid balance. If the rest isn\'t paid within 60 days after I tell you the design is done, I keep the deposit as payment for the work so far, the deposit is not refunded, and I do no further work on the order.',
  '4. Unclaimed prints. If your print is finished and you don\'t arrange shipping or pickup, or don\'t pay the rest, within 60 days after I tell you it\'s ready, I may throw the print away, and any money paid is not refunded.',
  '5. Who owns what. I own the design and its files, including any changes I make to it later. You own the printed item(s) you buy.',
  '6. My right to sell it. In exchange for the free design work, I may make, sell and share prints of the design, and keep changing and improving it, now and in the future. Personal details you give me (like a name added to your print) are not included in anything I sell.',
  '7. How the item is used. You are responsible for how the item is used. 3D prints are not tested or certified for safety, food contact, heavy loads, medical use or use by young children. To the extent the law allows, I am not responsible for any injury, damage or loss caused by how the item is used.',
  '8. Agreeing. Approving your quote means you agree to these terms for this order.'
].join('\n');

// Keeps only valid values: numbers from 0 to 100000, and a Venmo username of letters, numbers, - or _.
function cleanRules(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  Object.keys(RULE_DEFAULTS).forEach(key => {
    const value = src[key];
    if (value === null || value === undefined || value === '') return;
    if (key === 'venmo') {
      const name = String(value).trim().replace(/^@/, '');
      if (/^[A-Za-z0-9_-]{1,30}$/.test(name)) out.venmo = name;
      return;
    }
    const n = Number(value);
    if (isFinite(n) && n >= 0 && n <= 100000) out[key] = n;
  });
  return out;
}
// Per-color $ per gram set on a color in Site Settings (colorRates: { colorId: rate }). Colors without
// one use the regular or special rate.
function cleanColorRates(raw) {
  const out = {};
  if (raw && typeof raw === 'object') Object.keys(raw).forEach(id => {
    const n = raw[id];
    if (/^[a-z0-9-]{1,40}$/.test(id) && n !== null && n !== '' && isFinite(Number(n)) && Number(n) >= 0 && Number(n) <= 100000) out[id] = Number(n);
  });
  return out;
}
function shopRules(settings) {
  const colorRates = {};
  ((settings && settings.colors) || []).forEach(c => { if (c && c.id) colorRates[c.id] = c.rate; });
  return Object.assign({}, RULE_DEFAULTS, cleanRules(settings && settings.rules), { colorRates: cleanColorRates(colorRates) });
}
// Phases before a quote is sent: "Reviewing" and "Confirming details". Prices aren't locked in yet.
function beforeQuote(phase) { return !phase || phase === 'estimate' || phase === 'details_check'; }
// The prices an order uses: its saved quote rates, the original prices for older quotes, else today's.
function orderRules(order, settings) {
  const rules = shopRules(settings);
  const saved = cleanQuoteRates(order && order.rates);
  if (Object.keys(saved).length) return Object.assign(rules, { colorRates: {} }, saved);
  if (order && order.phase && !beforeQuote(order.phase)) return Object.assign(rules, LEGACY_RATES, { colorRates: {} });
  return rules;
}
// The rates a quote saves (and keeps), including any per-color rates.
function quoteRates(rules) {
  const out = {};
  RATE_KEYS.forEach(k => { if (rules && isFinite(rules[k])) out[k] = rules[k]; });
  const colorRates = cleanColorRates(rules && rules.colorRates);
  if (Object.keys(colorRates).length) out.colorRates = colorRates;
  return out;
}
function cleanQuoteRates(raw) {
  return quoteRates(Object.assign(cleanRules(raw), { colorRates: raw && raw.colorRates }));
}
function filamentRate(filType, rules) {
  if (filType === 'special_order' || filType === 'leftover') return 0;   // the customer pays for a whole roll instead
  return filType === 'special' ? rules.specialGramRate : rules.gramRate;
}
// One color's $ per gram: its own rate when set, else the regular or special rate.
function partRate(part, rules) {
  if (part.filType === 'special_order' || part.filType === 'leftover') return 0;
  const own = part.colorId && rules.colorRates && rules.colorRates[part.colorId];
  return typeof own === 'number' ? own : filamentRate(part.filType, rules);
}
// Grams per print of each color, main color first. When the owner gives the extra colors their own grams,
// `grams` is the main color's weight and each extra color adds its own; otherwise `grams` is the total,
// split evenly between the colors.
function colorGrams(item, grams) {
  const parts = itemParts(item), extras = parts.slice(1);
  const g = Number(grams === undefined ? item.grams : grams) || 0;
  return extras.some(p => Number(p.grams) > 0) ? [g].concat(extras.map(p => Number(p.grams) || 0)) : parts.map(() => g / parts.length);
}
function hasColorGrams(item) { return itemParts(item).slice(1).some(p => Number(p.grams) > 0); }
// Material cost of one print: each color's grams at that color's rate.
function colorsMaterial(item, grams, rules) {
  const each = colorGrams(item, grams);
  return itemParts(item).reduce((s, p, n) => s + each[n] * partRate(p, rules), 0);
}
// Average $ per gram over all the colors (by weight).
function colorsRate(item, rules, grams) {
  const total = colorGrams(item, grams).reduce((s, g) => s + g, 0);
  if (total > 0) return colorsMaterial(item, grams, rules) / total;
  const parts = itemParts(item);
  return parts.reduce((s, p) => s + partRate(p, rules), 0) / parts.length;
}
// "Black: body; Red: eyes" from what the customer said goes in each color (multi-color prints).
function colorPartsText(item) {
  return itemParts(item).map((p, n) => {
    const where = String((n === 0 ? item.mainParts : p.parts) || '').trim();
    return where ? (p.name || 'Main color') + ': ' + where : '';
  }).filter(Boolean).join('; ');
}
// A fixed price per print instead of the calculation: the owner's own price for this item (ownerPrice,
// set when editing a request; can be 0), else a past-work design's set price (setPrice).
function fixedPrice(item) {
  if (!item || typeof item !== 'object') return null;
  const own = item.ownerPrice;
  if (own !== null && own !== undefined && own !== '' && isFinite(Number(own)) && Number(own) >= 0) return Number(own);
  const set = Number(item.setPrice);
  return isFinite(set) && set > 0 ? set : null;
}
function setPriceOf(item) { const f = fixedPrice(item); return f === null ? 0 : f; }
// Ready to price: a fixed price, or print time and grams.
function itemPriced(item) { return fixedPrice(item) !== null || !!(item && item.minutes && item.grams); }
// Charges the owner adds to an order, each with their own label (e.g. "Special costs").
function extraCharges(order) {
  return ((order && order.extraCharges) || []).filter(c => c && isFinite(Number(c.amount)) && Number(c.amount) > 0)
    .map(c => ({ label: String(c.label || '').trim() || 'Special costs', amount: Number(c.amount) }));
}
function extraChargesTotal(order) { return extraCharges(order).reduce((s, c) => s + c.amount, 0); }
// The company logo add-on for one print (the customer ticked "Add my company logo"), unless the owner set
// their own price for the item, which already covers everything.
function logoCharge(item, rules) {
  if (!item || typeof item !== 'object' || !item.logo) return 0;
  const own = item.ownerPrice;
  if (own !== null && own !== undefined && own !== '' && isFinite(Number(own)) && Number(own) >= 0) return 0;
  return Number(rules && rules.logoPrice) || 0;
}
// Price of one print. `colors` is an item (all its colors) or a single filament type.
function printPrice(minutes, grams, colors, rules) {
  const fixed = colors && typeof colors === 'object' ? fixedPrice(colors) : null;
  if (fixed !== null) return fixed + logoCharge(colors, rules);
  const material = colors && typeof colors === 'object' ? colorsMaterial(colors, grams, rules) : Number(grams) * filamentRate(colors, rules);
  return rules.baseFee + Number(minutes) * rules.minuteRate + material + logoCharge(colors, rules);
}
// What the order pays for special order rolls: the owner's amount once set, else the usual roll price
// (nothing when every special color comes from the customer's leftover roll).
function rollCharge(order, rules) {
  const items = (order && order.items) || [];
  if (!items.some(usesRolls)) return 0;
  const set = order.specialOrderCost;
  if (set !== null && set !== undefined && set !== '' && isFinite(Number(set)) && Number(set) >= 0) return Number(set);
  return items.some(usesSpecialSpool) ? rules.rollCost : 0;
}
// ── Order queue ───────────────────────────────────────────────────────────
// `queue` is supabase order_queue(): confirmed/printing orders, oldest first ({ at, printing, custom }).
function orderDays(custom, rules) {
  const design = custom ? rules.customDesignDays : 0;
  return [design + rules.printDaysMin, design + rules.printDaysMax];
}
// Wait for one order. `at` is when it was confirmed; leave it blank for an order not confirmed yet, which
// joins the end of the line. Orders printing now count as up to one print's worth of days.
// A confirmed order's place in line is set by when its deposit (or full payment) came in; until then it has none.
function queueTime(order) { return (order && (order.depositAt || order.paidAt)) || ''; }
// `at` = this order's place ('' for a new request: everyone counts as ahead). Orders still waiting for a
// deposit (no time) only count as ahead of new requests.
function queueEstimate(queue, rules, at, custom) {
  const ahead = (queue || []).filter(e => e.printing || !at || (e.at && String(e.at) < String(at)));
  let min = 0, max = 0;
  ahead.forEach(e => {
    const d = e.printing ? [0, rules.printDaysMax] : orderDays(e.custom, rules);
    min += d[0]; max += d[1];
  });
  const own = orderDays(custom, rules);
  return { ahead: ahead.length, minDays: min + own[0], maxDays: max + own[1] };
}
function orderIsCustom(order) {
  return !!(order && (order.designTerms || (order.items || []).some(it => it.mode === 'idea')));
}
function daysText(min, max) {
  return min === max ? 'about ' + min + ' day' + (min === 1 ? '' : 's') : 'about ' + min + '-' + max + ' days';
}
function aheadText(n) { return n === 0 ? 'no orders ahead of yours' : n + ' order' + (n === 1 ? '' : 's') + ' ahead of yours'; }

// The deposit: the amount saved when it was received, else the deposit % of the total.
function depositAmount(order, total, rules) {
  const saved = Number(order && order.depositAmount);
  if (saved > 0) return saved;
  const pct = Math.min(100, Math.max(0, Number(rules.depositPercent) || 0));
  return Math.round(total * pct) / 100;
}
// Paid in full. Orders marked paid before the spelling was fixed are saved as 'payment_recieved'.
function isPaidInFull(order) { return !!order && ['payment_received', 'payment_recieved'].includes(order.paymentStatus); }
// What's still to pay: nothing once paid, the rest after a deposit, else the total.
function amountLeft(order, total, rules) {
  if (isPaidInFull(order)) return 0;
  if (order.paymentStatus === 'deposit_received') return Math.max(0, Math.round((total - depositAmount(order, total, rules)) * 100) / 100);
  return total;
}

function fmtRoll(grams) { return grams % 1000 === 0 ? (grams / 1000) + ' kg' : grams + ' g'; }
function specialOrderPolicy(rules) {
  const months = rules.rollMonths === 1 ? '1 month' : rules.rollMonths + ' months';
  return "Special orders are for a color or material I don't carry, like Red TPU. Filament only comes in full " + fmtRoll(rules.rollGrams) +
    ' rolls, so I order a whole roll for your print. The roll (usually about $' + rules.rollCost + '; the exact amount is in your quote) replaces the material charge. ' +
    'The rest of the roll is yours for ' + months + ': place another order with it and the material is free. After ' + months + ', I keep any leftover.';
}

// ── Colors in a print and leftover rolls ─────────────────────────────────
// Special orders are a color or material the owner doesn't carry: a whole 1 kg roll is bought for the
// order (when the owner confirms it). For 2 months the customer can print more in that same
// color/material from it, up to 1000 g in all (the first order included).
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
function itemGrams(it) { return colorGrams(it).reduce((s, g) => s + g, 0) * Math.max(1, Number(it.qty) || 1); }
// Grams one color of an item uses for the whole quantity (`part` from itemParts(it); the main color otherwise).
function partGrams(it, part) {
  const n = (Array.isArray(it.extraColors) ? it.extraColors : []).indexOf(part);
  return colorGrams(it)[n + 1] * Math.max(1, Number(it.qty) || 1);
}
function rollParts(it) { return itemParts(it).filter(p => p.filType === 'leftover'); }
function usesRolls(it) { return isSpecialOrder(it) || rollParts(it).length > 0; }
function rollExpiry(iso, months) { const d = new Date(iso); d.setMonth(d.getMonth() + (isFinite(months) ? months : RULE_DEFAULTS.rollMonths)); return d.toISOString(); }
function fmtShortDate(iso) { const d = new Date(iso); return isNaN(d) ? '' : SHORT_MONTHS[d.getMonth()] + ' ' + d.getDate(); }

// Every roll bought for special orders, with grams used and left. excludeId leaves one order's use out.
function leftoverRolls(batches, excludeId, rules) {
  rules = rules || RULE_DEFAULTS;
  const rolls = [];
  (batches || []).forEach(b => {
    if (!ROLL_PHASES.includes(b.phase)) return;
    const boughtAt = (b.phaseHistory || {}).order_received || b.createdAt;
    (b.items || []).filter(usesSpecialSpool).forEach(it => {
      const key = colorKey(it.specialColor);
      if (!key) return;
      let roll = rolls.find(r => r.orderId === b.id && r.key === key);
      if (!roll) rolls.push(roll = { orderId: b.id, key, color: it.specialColor, email: colorKey(b.clientEmail), boughtAt, expiresAt: rollExpiry(boughtAt, rules.rollMonths), used: 0 });
      roll.used += partGrams(it, itemParts(it)[0]);
    });
  });
  (batches || []).forEach(b => {
    if (b.id === excludeId) return;
    (b.items || []).forEach(it => rollParts(it).forEach(p => {
      const roll = findRoll(rolls, b.clientEmail, p);
      if (roll) roll.used += partGrams(it, p);
    }));
  });
  rolls.forEach(r => { r.left = Math.max(0, rules.rollGrams - r.used); });
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

function itemLines(rec, withPrices, site) {
  const rules = orderRules(rec, site);
  const months = rules.rollMonths === 1 ? '1 month' : rules.rollMonths + ' months';
  return (rec.items || []).map((it, i) => {
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const material = it.color ? `   Color: ${it.color}`
      : isSpecialOrder(it) ? `   Special order: ${it.specialColor || 'color/material not given'}${it.useLeftover ? ' (from your leftover roll, no material charge)' : ` (full ${fmtRoll(rules.rollGrams)} roll; the rest is yours for ${months}, and the material is free in another order)`}`
      : `   Filament: ${FIL_LABEL[it.filType] || 'Black'}`;
    const lines = [`${i + 1}) ${it.name || 'Unnamed'}${qty > 1 ? ` x ${qty}` : ''}`, material];
    const extras = extraColors(it);
    if (extras.length) lines.push(`   Also: ${extras.map(p => p.name + (p.filType === 'leftover' ? ' (leftover roll)' : '')).join(', ')}`);
    if (colorPartsText(it)) lines.push(`   Which parts: ${colorPartsText(it)}`);
    if (it.logo) lines.push('   Add company logo: yes (please reply with your logo file)');
    if (withPrices && itemPriced(it)) {
      const each = printPrice(it.minutes, it.grams, it, rules);
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

function extraColors(it) {
  return (Array.isArray(it.extraColors) ? it.extraColors : []).filter(p => p && p.name);
}

function orderTotal(rec, site) {
  const items = rec.items || [];
  if (!items.length || !items.every(itemPriced)) return 0;
  const rules = orderRules(rec, site);
  return items.reduce((s, it) => s + printPrice(it.minutes, it.grams, it, rules) * Math.max(1, parseInt(it.qty, 10) || 1), 0) + rollCharge(rec, rules) + extraChargesTotal(rec);
}

function orderTitle(rec) {
  const items = rec.items || [];
  return items.length ? items.map(it => it.name || 'Unnamed').join(', ') : 'your request';
}

function venmoUrl(rec, total, rules) {
  const note = `SoloPrint order ${rec.id}: ${orderTitle(rec)}`.slice(0, 140);
  return `https://venmo.com/${encodeURIComponent(rules.venmo)}?txn=pay&amount=${money(total)}&note=${encodeURIComponent(note)}`;
}

function money(n) {
  return (Number(n) || 0).toFixed(2);
}

function formatDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('en-US', { timeZone: 'America/Chicago' });
}

if (typeof module !== 'undefined') module.exports = { emailsFor, parseMakerWorldDesign, parsePagePreview, reminderEmails, orderLink };
