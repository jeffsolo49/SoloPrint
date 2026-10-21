// Checks for email/Code.gs (the Google Apps Script), run in Node with Google's services stubbed.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { check, assert, finish } = require('./harness');

const CODE = fs.readFileSync(path.resolve(__dirname, '..', 'email', 'Code.gs'), 'utf8');
function load(stubs = {}) {
  const ctx = { module: {}, console, Logger: { log() {} }, ContentService: {}, CacheService: {}, PropertiesService: {}, ScriptApp: {}, MailApp: {}, ...stubs };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  return ctx;
}

const base = { id: '1729', clientName: 'Jane', clientEmail: 'jane@example.com', createdAt: '2026-10-20T15:00:00Z', phase: 'estimate', paymentStatus: 'unpaid',
  items: [{ name: 'Benchy', qty: 2, filType: 'black', minutes: 90, grams: 20, imageLinks: ['https://img.test/a.png'] }] };
const at = o => ({ ...base, ...o });

console.log('Order emails:');
const { emailsFor, parseMakerWorldDesign, parsePagePreview } = load();
const cases = [
  ['new request: owner notice + customer receipt', 'INSERT', at({}), null, ['jeffsolo49@gmail.com|New SoloPrint request from Jane', 'jane@example.com|We received your SoloPrint request']],
  ['quote sent', 'UPDATE', at({ phase: 'quote_sent' }), at({}), ['jane@example.com|Your SoloPrint quote: $9.28']],
  ['customer approved', 'UPDATE', at({ phase: 'quote_sent', customerApprovedAt: '2026-10-20T16:00:00Z' }), at({ phase: 'quote_sent' }), ['jeffsolo49@gmail.com|Jane approved their quote']],
  ['order confirmed', 'UPDATE', at({ phase: 'order_received' }), at({ phase: 'quote_sent' }), ['jane@example.com|Your SoloPrint order is confirmed']],
  ['printing', 'UPDATE', at({ phase: 'production' }), at({ phase: 'order_received' }), ['jane@example.com|Your SoloPrint order is printing']],
  ['delivered', 'UPDATE', at({ phase: 'delivered' }), at({ phase: 'production' }), ['jane@example.com|Your SoloPrint order is complete']],
  ['payment received', 'UPDATE', at({ paymentStatus: 'payment_recieved' }), at({ paymentStatus: 'payment_requested' }), ['jane@example.com|Payment received, thank you!']],
  ['reset to estimate sends nothing', 'UPDATE', at({ phase: 'estimate' }), at({ phase: 'quote_sent' }), []],
  ['unrelated edit sends nothing', 'UPDATE', at({ clientName: 'Janet' }), at({}), []]
];
cases.forEach(([name, type, rec, old, want]) => check(name, () => {
  const got = emailsFor(type, rec, old).map(m => `${m.to}|${m.subject}`);
  assert(JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);
}));
check('confirmed email has a prefilled Venmo link', () => {
  const body = emailsFor('UPDATE', at({ phase: 'order_received' }), at({ phase: 'quote_sent' }))[0].body;
  assert(body.includes('https://venmo.com/Jeffrey-Sol-3?txn=pay&amount=9.28'), body);
});
check('owner notice lists customer photo links', () => {
  assert(emailsFor('INSERT', at({}), null)[0].body.includes('Photo 1: https://img.test/a.png'), 'photo link missing');
});

console.log('\nModel lookups:');
check('MakerWorld: uses the linked profile, else the default; seconds to minutes', () => {
  const design = { title: 'Dragon', defaultInstanceId: 2, instances: [
    { id: 1, profileId: 111, title: 'A', prediction: 3600, weight: 10 },
    { id: 2, profileId: 222, title: 'Default', prediction: 5160, weight: 23 }] };
  const d = parseMakerWorldDesign(design, '');
  const linked = parseMakerWorldDesign(design, '111');
  assert(d.profile === 'Default' && d.minutes === 86 && d.grams === 23, JSON.stringify(d));
  assert(linked.profile === 'A' && linked.minutes === 60, JSON.stringify(linked));
});
check('page preview tags: title and https image only', () => {
  const p = parsePagePreview('<meta property="og:title" content="Benchy &amp; co"><meta content="https://cdn.test/a.jpg" property="og:image">', 'Thingiverse');
  assert(p.name === 'Benchy & co' && p.image === 'https://cdn.test/a.jpg', JSON.stringify(p));
  assert(parsePagePreview('<meta name="twitter:image" content="http://insecure/x.png">', 'X').image === '', 'accepted an http image');
});

console.log('\nWeekly backup:');
function backupRun(status) {
  const files = Array.from({ length: 13 }, (_, i) => ({ name: 'old' + i, date: new Date(2026, 0, i + 1), trashed: false, getDateCreated() { return this.date; }, setTrashed(v) { this.trashed = v; } }));
  const mails = [];
  const folder = {
    createFile(name) { files.push({ name, date: new Date(), trashed: false, getDateCreated() { return this.date; }, setTrashed(v) { this.trashed = v; } }); },
    getFiles() { const live = files.filter(f => !f.trashed); let i = 0; return { hasNext: () => i < live.length, next: () => live[i++] }; }
  };
  const ctx = load({
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => status, getContentText: () => status === 200 ? '{"jobs":[]}' : 'forbidden' }) },
    DriveApp: { getFoldersByName: () => ({ hasNext: () => true, next: () => folder }), createFolder: () => folder },
    Utilities: { formatDate: () => '2026-10-21' },
    MailApp: { sendEmail: m => mails.push(m.subject) }
  });
  let error = '';
  try { ctx.backupToDrive(); } catch (e) { error = e.message; }
  return { files, mails, error };
}
check('saves a file and keeps the newest 12', () => {
  const r = backupRun(200);
  const live = r.files.filter(f => !f.trashed);
  assert(!r.error && live.length === 12 && live.some(f => f.name === 'soloprint-backup-2026-10-21.json'), `kept ${live.map(f => f.name).join(', ')}`);
});
check('emails the owner when a backup fails', () => {
  const r = backupRun(400);
  assert(r.error && r.mails.includes('SoloPrint backup failed'), JSON.stringify(r.mails));
});

finish();
