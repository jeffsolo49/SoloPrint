// SoloPrint order emails, sent from your own Gmail account.
// Supabase calls this script whenever an order is created or changes (see supabase/email-trigger.sql).
// Setup steps are in email/README.md.

// The secret is NOT stored in this file (the repo is public). Save it once in Apps Script:
// Project Settings (gear) -> Script properties -> Add script property: SECRET = your secret.
// It must match the secret in supabase/email-trigger.sql. New versions of this file can then be pasted as-is.
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
  const emails = emailsFor(body.type, body.record || {}, body.old_record || null);
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
    .filter(t => ['backupToDrive', 'sendQuoteReminders'].includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('backupToDrive').timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(3).create();
  ScriptApp.newTrigger('sendQuoteReminders').timeBased().everyDays(1).atHour(10).create();
  backupToDrive();
  Logger.log('Scheduled: weekly backup (Mondays ~3am) and daily quote reminders (~10am). A first backup was saved to Drive > ' + BACKUP_FOLDER + '.');
}

// Older name, kept so instructions that mention it still work.
function setupWeeklyBackup() {
  setupSchedules();
}

// One friendly reminder per quote that's waited 3+ days without a "Looks good".
function sendQuoteReminders() {
  const res = UrlFetchApp.fetch(SUPA_URL + '/rest/v1/rpc/due_quote_reminders', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY },
    payload: JSON.stringify({ p_secret: getSecret(), p_days: 3 }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('Quote reminders failed (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300));
  const due = JSON.parse(res.getContentText() || '[]');
  reminderEmails(due).forEach(m => MailApp.sendEmail({ to: m.to, subject: m.subject, body: m.body, name: 'SoloPrint', replyTo: OWNER_EMAIL }));
  Logger.log('Quote reminders sent: ' + due.length);
}

// Pure function so it can be tested outside Apps Script.
function reminderEmails(records) {
  return (records || []).filter(rec => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(rec.clientEmail || ''))).map(rec => ({
    to: String(rec.clientEmail),
    subject: 'Still interested? Your SoloPrint quote is waiting',
    body: [
      `Hi ${String(rec.clientName || '').trim() || 'there'},`,
      '',
      `Just checking in: your quote for ${orderTitle(rec)} is still ready${orderTotal(rec) ? ` ($${money(orderTotal(rec))})` : ''}.`,
      '',
      `If it looks good, tap "Looks good" here: ${orderLink(rec)}`,
      'Want something changed, or have a question? Just reply to this email.',
      '',
      "No pressure: nothing is charged until we've both confirmed the order.",
      '',
      'Thanks,',
      'SoloPrint'
    ].join('\n')
  }));
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
function emailsFor(type, rec, old) {
  const emails = [];
  const customer = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(rec.clientEmail || '')) ? String(rec.clientEmail) : '';
  const name = String(rec.clientName || '').trim() || 'there';
  const title = orderTitle(rec);
  const footer = [
    '',
    `Track your order any time: ${orderLink(rec)}`,
    'Questions? Just reply to this email.',
    '',
    'Thanks,',
    'SoloPrint'
  ].join('\n');
  const toCustomer = (subject, lines) => {
    if (customer) emails.push({ to: customer, subject, body: [`Hi ${name},`, ''].concat(lines, footer).join('\n') });
  };
  const toOwner = (subject, lines) => emails.push({ to: OWNER_EMAIL, subject, body: lines.join('\n') });

  if (type === 'INSERT') {
    const estimate = orderTotal(rec);
    toOwner(`New SoloPrint request from ${rec.clientName || 'a customer'}`, [
      `Customer: ${rec.clientName || ''}`,
      `Email: ${rec.clientEmail || ''}`,
      `Submitted: ${formatDate(rec.createdAt)}`,
      estimate ? `Automated estimate: $${money(estimate)} (review and send the quote from your dashboard)` : 'Needs an estimate.',
      '',
      itemLines(rec, false).join('\n\n')
    ]);
    toCustomer('We received your SoloPrint request', [
      `Thanks for your request for ${title}. We've received your submission and will respond promptly after reviewing it.`,
      '',
      itemLines(rec, false).join('\n\n'),
      ''
    ].concat(estimate ? [`Automated estimate: $${money(estimate)}`] : [], [
      'Any prices shown on the site are automated estimates, not exact costs. We\'ll email your confirmed quote once we\'ve reviewed your request.'
    ]));
    return emails;
  }

  if (type !== 'UPDATE' || !old) return emails;

  if (rec.phase !== old.phase) {
    if (rec.phase === 'quote_sent') {
      toCustomer(`Your SoloPrint quote: $${money(orderTotal(rec))}`, quoteLines(rec));
    } else if (rec.phase === 'order_received') {
      const total = orderTotal(rec);
      const lines = [`Good news: your order for ${title} is confirmed and queued for the printer.`];
      if (total && rec.paymentStatus !== 'payment_recieved') {
        lines.push('', `Total: $${money(total)}`, `Pay with Venmo: ${venmoUrl(rec, total)}`, '(The link fills in the amount and your order number.)');
      }
      toCustomer('Your SoloPrint order is confirmed', lines);
    } else if (rec.phase === 'production') {
      toCustomer('Your SoloPrint order is printing', [`Your order for ${title} is on the printer now. We'll let you know when it's done.`]);
    } else if (rec.phase === 'delivered') {
      toCustomer('Your SoloPrint order is complete', [`Your order for ${title} is complete. Enjoy!`].concat(deliveryLines(rec)));
    }
  } else if (rec.phase === 'delivered' && deliveryLines(rec).join() !== deliveryLines(old).join() && deliveryLines(rec).length) {
    toCustomer('Delivery details for your SoloPrint order', [`Here are the delivery details for ${title}:`].concat(deliveryLines(rec)));
  }

  if (rec.customerApprovedAt && !old.customerApprovedAt) {
    toOwner(`${rec.clientName || 'A customer'} approved their quote`, [
      `${rec.clientName || 'The customer'} (${rec.clientEmail || ''}) approved the quote of $${money(orderTotal(rec))} for ${title}.`,
      'Confirm the order on your dashboard when you know you can make it.'
    ]);
  }

  if (rec.paymentStatus === 'payment_recieved' && old.paymentStatus !== 'payment_recieved') {
    toCustomer('Payment received, thank you!', [`We received your payment for ${title}. Thank you!`]);
  }
  return emails;
}

function quoteLines(rec) {
  return [
    `Your quote for ${orderTitle(rec)} is ready.`,
    '',
    itemLines(rec, true).join('\n\n'),
    '',
    ...(specialOrderCost(rec) ? [`Special order roll (1 kg): $${money(specialOrderCost(rec))}`] : []),
    `Total: $${money(orderTotal(rec))}`,
    'All prints are PLA unless noted or requested.',
    '',
    `If it looks good, tap "Looks good" here: ${orderLink(rec)} (or just reply to this email).`,
    "Nothing is charged yet. We'll confirm we can make your order before asking for payment."
  ];
}

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
