// Checks for email/Code.gs (the Google Apps Script), run in Node with Google's services stubbed.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { check, assert, finish } = require('./harness');

const CODE = fs.readFileSync(path.resolve(__dirname, '..', 'email', 'Code.gs'), 'utf8');
function load(stubs = {}) {
  const props = { SECRET: '0123456789abcdef0123456789abcdef' };
  const ctx = { module: {}, console, Logger: { log() {} }, ContentService: { createTextOutput: t => ({ text: t }) }, CacheService: {},
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, getProperties: () => ({ ...props }) }) }, ScriptApp: {}, MailApp: {}, ...stubs };
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
  ['payment received', 'UPDATE', at({ paymentStatus: 'payment_received' }), at({ paymentStatus: 'payment_requested' }), ['jane@example.com|Payment received, thank you!']],
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

check('special order: 1 kg roll replaces the material charge', () => {
  const special = { name: 'Vase', qty: 1, filType: 'special_order', specialColor: 'Red TPU', minutes: 60, grams: 10 };
  const [mail] = emailsFor('UPDATE', at({ phase: 'quote_sent', items: [special] }), at({}));
  assert(mail.subject === 'Your SoloPrint quote: $23.44', mail.subject);   // 2 + 1.44 print time + 20 roll, no per-gram charge
  assert(mail.body.includes('Special order: Red TPU') && mail.body.includes('Special order roll: $20.00'), mail.body);
  assert(mail.body.includes('PLA unless noted'), 'PLA note missing');
  const custom = emailsFor('UPDATE', at({ phase: 'quote_sent', items: [special], specialOrderCost: 15 }), at({}))[0];
  assert(custom.subject === 'Your SoloPrint quote: $18.44', custom.subject);
  const leftover = emailsFor('UPDATE', at({ phase: 'quote_sent', items: [{ ...special, useLeftover: true }] }), at({}))[0];
  assert(leftover.subject === 'Your SoloPrint quote: $3.44', leftover.subject);
  const stocked = emailsFor('UPDATE', at({ phase: 'quote_sent', items: [{ ...special, filType: 'special', colorId: 'red', color: 'Red', specialColor: '' }] }), at({}))[0];
  assert(stocked.subject === 'Your SoloPrint quote: $3.78', `a stocked special color is not a special order: ${stocked.subject}`);
});
check('multi-color print with a leftover roll', () => {
  const it = { name: 'Case', qty: 1, filType: 'color', color: 'Black', minutes: 60, grams: 30,
    extraColors: [{ name: 'Red TPU', filType: 'leftover', leftoverFrom: 'r1' }] };
  const [mail] = emailsFor('UPDATE', at({ phase: 'quote_sent', items: [it] }), at({}));
  assert(mail.subject === 'Your SoloPrint quote: $3.80', mail.subject);   // 2 + 1.44 + 15 g x 0.024, no roll charge
  assert(mail.body.includes('Also: Red TPU (leftover roll)'), mail.body);
});
check('your own item price and added charges are in the quote, with only their label', () => {
  const rec = at({ phase: 'quote_sent', items: [{ ...base.items[0], ownerPrice: 5 }], extraCharges: [{ label: 'Special costs', amount: 15 }] });
  const [mail] = emailsFor('UPDATE', rec, at({}));
  assert(mail.subject === 'Your SoloPrint quote: $25.00', mail.subject);   // 2 x $5 + $15
  assert(mail.body.includes('Special costs: $15.00') && !/added by you|owner/i.test(mail.body), mail.body);
  const free = emailsFor('UPDATE', at({ phase: 'quote_sent', items: [{ ...base.items[0], ownerPrice: 0 }] }), at({}))[0];
  assert(free.subject === 'Your SoloPrint quote: $0.00', `a price of 0 is still your price: ${free.subject}`);
});
check('a color with its own price per gram: the quote uses the rate it was sent with', () => {
  const item = { name: 'Rose', qty: 1, filType: 'color', colorId: 'red', color: 'Red', minutes: 60, grams: 100 };
  const sent = emailsFor('UPDATE', at({ phase: 'quote_sent', items: [item], rates: { baseFee: 2, minuteRate: 0.024, gramRate: 0.024, specialGramRate: 0.034, colorRates: { red: 0.044 } } }), at({}))[0];
  assert(sent.subject === 'Your SoloPrint quote: $7.84', sent.subject);   // 2 + 1.44 + 100 g x 0.044
  const older = emailsFor('UPDATE', at({ phase: 'quote_sent', items: [item], rates: { baseFee: 2, minuteRate: 0.024, gramRate: 0.024, specialGramRate: 0.034 } }), at({}))[0];
  assert(older.subject === 'Your SoloPrint quote: $5.84', `a quote sent before color rates keeps the regular rate: ${older.subject}`);
});
check('multi-color: each color priced by its own grams, and the email says which parts', () => {
  const it = { name: 'Owl', qty: 1, filType: 'color', colorId: 'black', color: 'Black', minutes: 60, grams: 80, mainParts: 'the body',
    extraColors: [{ name: 'Red', filType: 'color', colorId: 'red', grams: 20, parts: 'the eyes' }] };
  const rates = { baseFee: 2, minuteRate: 0.024, gramRate: 0.024, specialGramRate: 0.034, colorRates: { red: 0.044 } };
  const [mail] = emailsFor('UPDATE', at({ phase: 'quote_sent', items: [it], rates }), at({}));
  assert(mail.subject === 'Your SoloPrint quote: $6.24', mail.subject);   // 2 + 1.44 + 80 x 0.024 + 20 x 0.044
  assert(mail.body.includes('Which parts: Black: the body; Red: the eyes'), mail.body);
});
check('order queue switched off: no wait estimate in emails', () => {
  const queue = [{ at: '2026-10-19T10:00:00Z', printing: true, custom: false }];
  const on = emailsFor('UPDATE', at({ phase: 'quote_sent' }), at({}), {}, { queue })[0].body;
  const off = emailsFor('UPDATE', at({ phase: 'quote_sent' }), at({}), {}, { queue, features: { queue: false } })[0].body;
  assert(/expect it to be printed/.test(on) && !/expect it to be printed/.test(off), off);
});
check('owner-edited email text is used, blanks fall back to the default', () => {
  const custom = { quote: { subject: 'Quote for {title}: ${total}', body: '' }, footer: { body: 'Cheers,\nJeff' } };
  const [mail] = emailsFor('UPDATE', at({ phase: 'quote_sent' }), at({}), custom);
  assert(mail.subject === 'Quote for Benchy: $9.28', mail.subject);
  assert(mail.body.startsWith('Hi Jane,') && mail.body.includes('Total: $9.28') && mail.body.endsWith('Cheers,\nJeff'), mail.body);
  const paid = emailsFor('UPDATE', at({ phase: 'order_received', paymentStatus: 'payment_received' }), at({ phase: 'quote_sent' }))[0].body;
  assert(!paid.includes('venmo') && !paid.includes('Total:'), `paid orders should drop the payment lines: ${paid}`);
  const note = emailsFor('INSERT', at({ items: [{ name: 'X', notes: 'Price {total} please' }] }), null)[0].body;
  assert(note.includes('Price {total} please'), 'customer text should not be treated as fill-ins');
});
check('Code.gs carries an exact copy of email-templates.js', () => {
  const shared = fs.readFileSync(path.resolve(__dirname, '..', 'email-templates.js'), 'utf8');
  const start = CODE.indexOf('\n', CODE.indexOf('// ── SHARED EMAIL TEMPLATES')) + 1;
  const end = CODE.indexOf('// ── END SHARED EMAIL TEMPLATES');
  assert(start > 0 && end > start && CODE.slice(start, end) === shared, 'copy the whole of email-templates.js into Code.gs between the markers');
});
check('quotes with a custom design mention the design terms', () => {
  const withTerms = emailsFor('UPDATE', at({ phase: 'quote_sent', designTerms: 'Custom design terms...' }), at({}))[0].body;
  assert(withTerms.includes('you will be asked to read and agree to my custom design terms'), withTerms);
  const without = emailsFor('UPDATE', at({ phase: 'quote_sent' }), at({}))[0].body;
  assert(!without.includes('design terms'), without);
});
check('a past-work set price is used as is in the quote email', () => {
  const [m] = emailsFor('UPDATE', at({ phase: 'quote_sent', items: [{ name: 'Sign', qty: 2, filType: 'black', setPrice: 12 }] }), at({}));
  assert(m.subject === 'Your SoloPrint quote: $24.00' && m.body.includes('Price: $24.00 ($12.00 each)'), m.subject + '\n' + m.body);
});
check('company logo add-on: the logo price is in the quote and the email asks for the logo', () => {
  const [m] = emailsFor('UPDATE', at({ phase: 'quote_sent', items: [{ name: 'Sign', qty: 2, filType: 'black', setPrice: 12, logo: true }] }), at({}));
  assert(m.subject === 'Your SoloPrint quote: $26.00' && m.body.includes('Price: $26.00 ($13.00 each)') && m.body.includes('Add company logo: yes'), m.subject + '\n' + m.body);
});
check('orders marked paid with the old spelling count as paid, and re-saving one sends no second payment email', () => {
  const resaved = emailsFor('UPDATE', at({ phase: 'delivered', paymentStatus: 'payment_received' }), at({ phase: 'delivered', paymentStatus: 'payment_recieved' }));
  assert(!resaved.some(m => /Payment received/.test(m.subject)), JSON.stringify(resaved.map(m => m.subject)));
  const paid = emailsFor('UPDATE', at({ phase: 'order_received', paymentStatus: 'payment_received' }), at({ phase: 'order_received', paymentStatus: 'payment_requested' }));
  assert(paid.some(m => /Payment received/.test(m.subject)), 'a real payment still gets its email');
});
check('confirm details: sends exactly the email the owner approved, once', () => {
  const rec = at({ phase: 'details_check', detailsEmail: { subject: 'A quick\nquestion', body: 'Hi Jane,\n\nHow tall?\n\nThanks' } });
  const out = emailsFor('UPDATE', rec, at({ phase: 'estimate' }));
  assert(out.length === 1 && out[0].to === 'jane@example.com' && out[0].subject === 'A quick question' && out[0].body === 'Hi Jane,\n\nHow tall?\n\nThanks', JSON.stringify(out));
  assert(!emailsFor('UPDATE', rec, at({ phase: 'details_check' })).length, 'no resend while it stays in that step');
});
check('quote and confirmed emails say how far back in line the order is', () => {
  const queue = [{ at: '2026-10-01T00:00:00Z', printing: true, custom: false }, { at: '2026-10-02T00:00:00Z', printing: false, custom: true }];
  const quote = emailsFor('UPDATE', at({ phase: 'quote_sent' }), at({}), {}, { queue })[0].body;
  assert(quote.includes('Right now there are 2 orders ahead, so once you approve, expect it to be printed in about 9-13 days.'), quote);
  // Confirmed but no deposit yet: no place in line until it comes in.
  const waiting = queue.concat({ at: null, printing: false, custom: false });
  const confirmed = emailsFor('UPDATE', at({ phase: 'order_received', paymentStatus: 'payment_requested' }), at({ phase: 'quote_sent' }), {}, { queue: waiting })[0].body;
  assert(confirmed.includes('Your place in line is set when your deposit comes in. Right now there are 2 orders ahead.'), confirmed);
  // Deposit in: they're placed by when it came in, and told the rest due.
  const placed = queue.concat({ at: '2026-10-03T00:00:00Z', printing: false, custom: false });
  const deposit = emailsFor('UPDATE', at({ phase: 'order_received', paymentStatus: 'deposit_received', depositAt: '2026-10-03T00:00:00Z', depositAmount: 4.64 }),
    at({ phase: 'order_received', paymentStatus: 'payment_requested' }), {}, { queue: placed });
  assert(deposit.length === 1 && deposit[0].subject === 'Deposit received for your SoloPrint order', JSON.stringify(deposit.map(m => m.subject)));
  assert(deposit[0].body.includes("You're number 3 in line, so expect it to be printed in about 9-13 days.") && deposit[0].body.includes('The rest ($4.64) is due') && deposit[0].body.includes('amount=4.64'), deposit[0].body);
  const none = emailsFor('UPDATE', at({ phase: 'quote_sent' }), at({}))[0].body;
  assert(!none.includes('in line') && !none.includes('ahead'), 'queue line without queue data');
});
check('quote email links straight to the order', () => {
  const body = emailsFor('UPDATE', at({ phase: 'quote_sent' }), at({}))[0].body;
  assert(body.includes('https://soloprint.vercel.app/?requests=jane%40example.com#order-1729'), body);
});
check('quote reminders: one per valid customer, with the order link', () => {
  const { reminderEmails } = load();
  const out = reminderEmails([at({ phase: 'quote_sent' }), at({ clientEmail: 'not-an-email' })]);
  assert(out.length === 1 && out[0].subject.includes('quote is waiting') && out[0].body.includes('#order-1729') && out[0].body.includes('$9.28'), JSON.stringify(out));
});

check('webhook accepts the saved secret and refuses anything else', () => {
  const sent = [];
  const ctx = load({ MailApp: { sendEmail: m => sent.push(m.subject) } });
  const post = secret => ctx.doPost({ postData: { contents: JSON.stringify({ secret, type: 'INSERT', record: at({}) }) } }).text;
  assert(post('wrong') === 'forbidden' && sent.length === 0, 'wrong secret was accepted');
  assert(post('0123456789abcdef0123456789abcdef') === 'sent 2' && sent.length === 2, 'right secret was refused');
});
check('secret saved as lowercase "secret", with quotes or a semicolon, still works', () => {
  const ctx = load({ PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({ secret: " '0123456789abcdef0123456789abcdef'; " }) }) } });
  assert(ctx.getSecret() === '0123456789abcdef0123456789abcdef', ctx.getSecret());
});
check('no secret is written in Code.gs', () => {
  assert(!/[0-9a-f]{40}/i.test(CODE) && !/const SECRET\s*=/.test(CODE), 'Code.gs contains a secret');
});

console.log('\nMessages on orders:');
const SECRET = '0123456789abcdef0123456789abcdef';
// A Supabase stub that records the RPC calls the script makes.
function fetchStub(calls) {
  return { fetch: (url, opt) => { calls.push({ fn: url.split('/rpc/')[1] || url, args: JSON.parse((opt && opt.payload) || '{}') });
    return { getResponseCode: () => 200, getContentText: () => (/record_messages/.test(url) ? '1' : /site_settings/.test(url) ? '[]' : '[]') }; } };
}
check('your message from the site is emailed to the customer, tagged with the order', () => {
  const sent = [], calls = [];
  const ctx = load({ MailApp: { sendEmail: m => sent.push(m) }, UrlFetchApp: fetchStub(calls) });
  const out = ctx.doPost({ postData: { contents: JSON.stringify({ secret: SECRET, type: 'MESSAGE', message: { sender: 'owner', via: 'site', body: 'Blue works.' }, record: at({}) }) } }).text;
  assert(out === 'sent 1' && sent[0].to === 'jane@example.com' && sent[0].subject.startsWith('[SoloPrint #1729] ') && sent[0].body.startsWith('Blue works.') && sent[0].body.includes('#order-1729'), JSON.stringify(sent));
});
check("a customer's message from their order page is emailed to you, and replying goes to them", () => {
  const sent = [];
  const ctx = load({ MailApp: { sendEmail: m => sent.push(m) }, UrlFetchApp: fetchStub([]) });
  ctx.doPost({ postData: { contents: JSON.stringify({ secret: SECRET, type: 'MESSAGE', message: { sender: 'customer', via: 'site', body: 'Can it be blue?' }, record: at({}) }) } });
  assert(sent[0].to === 'jeffsolo49@gmail.com' && sent[0].replyTo === 'jane@example.com' && /Message from Jane/.test(sent[0].subject) && sent[0].body.includes('Can it be blue?'), JSON.stringify(sent));
});
check("emails to the customer are logged on the order's conversation", () => {
  const calls = [];
  const ctx = load({ MailApp: { sendEmail() {} }, UrlFetchApp: fetchStub(calls) });
  ctx.doPost({ postData: { contents: JSON.stringify({ secret: SECRET, type: 'UPDATE', record: at({ phase: 'quote_sent' }), old_record: at({}) }) } });
  const rows = (calls.find(c => c.fn === 'record_messages') || { args: { p_rows: [] } }).args.p_rows;
  assert(rows.length === 1 && rows[0].job_id === '1729' && rows[0].via === 'auto' && rows[0].sender === 'owner' && /quote/.test(rows[0].subject), JSON.stringify(calls));
});
check('only the new part of an emailed reply is kept', () => {
  const { replyText } = load();
  const t = replyText('Yes, blue please!\nThanks\n\nOn Mon, Oct 27, 2026 at 3:00 PM SoloPrint <jeffsolo49@gmail.com>\nwrote:\n> Hi Jane,\n> Which color?');
  assert(t === 'Yes, blue please!\nThanks', JSON.stringify(t));
  assert(load().replyText('Sure\n-----Original Message-----\nFrom: x') === 'Sure', 'Outlook style');
});
check('Gmail replies: customers and your own replies are collected; the shop emails are not', () => {
  const calls = [];
  const msg = (from, to, subject, body, id) => ({ getFrom: () => from, getTo: () => to, getSubject: () => subject, getPlainBody: () => body, getId: () => id, getDate: () => new Date('2026-10-27T15:00:00Z') });
  const thread = { getMessages: () => [
    msg('SoloPrint <jeffsolo49@gmail.com>', 'jane@example.com', 'Your SoloPrint quote: $9.28', 'Hi Jane, your quote...', 'm1'),
    msg('Jane <Jane@Example.com>', 'jeffsolo49@gmail.com', 'Re: Your SoloPrint quote: $9.28', 'Looks great!\n\nOn Mon wrote:\n> Hi Jane', 'm2'),
    msg('jeffsolo49@gmail.com', 'Jane <jane@example.com>', 'Re: [SoloPrint #1729] Benchy', 'Thanks Jane!', 'm3')] };
  const ctx = load({ GmailApp: { search: () => [thread] }, UrlFetchApp: fetchStub(calls) });
  ctx.collectReplies();
  const rows = calls.find(c => c.fn === 'record_messages').args.p_rows;
  assert(rows.length === 2 && rows[0].sender === 'customer' && rows[0].email === 'jane@example.com' && rows[0].body === 'Looks great!' && rows[0].email_id === 'm2'
    && rows[1].sender === 'owner' && rows[1].email === 'jane@example.com' && rows[1].job_id === '1729', JSON.stringify(rows));
});
check('the email code asks for loader version 2 (Gmail replies), and the loader provides it', () => {
  const loader = fs.readFileSync(path.resolve(__dirname, '..', 'email', 'Loader.gs'), 'utf8');
  assert(/const LOADER_VERSION_NEEDED = 2;/.test(CODE) && /const LOADER_VERSION = 2;/.test(loader) && /function collectReplies\(\)/.test(loader) && /GmailApp\.search/.test(loader), 'loader and code disagree');
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

console.log('\nDaily and weekly emails:');
const ctxD = load();
const DAY = 864e5, NOW = new Date('2026-10-22T15:00:00Z');
const daysAgo = n => new Date(NOW - n * DAY).toISOString();
check('vacation note goes in the request-received email only while on', () => {
  const on = emailsFor('INSERT', at({}), null, {}, { vacation: { on: true, until: 'Nov 3' } })[1].body;
  assert(on.includes("I'm away until Nov 3. I'll review your request when I'm back."), on);
  const off = emailsFor('INSERT', at({}), null, {}, { vacation: { on: false, until: 'Nov 3' } })[1].body;
  assert(!off.includes('away'), off);
});
check('order-complete email links the finished-print photo', () => {
  const body = emailsFor('UPDATE', at({ phase: 'delivered', finishedPhotos: ['https://img.test/done.jpg'] }), at({ phase: 'production' }))[0].body;
  assert(body.includes("Here's a photo of your print: https://img.test/done.jpg"), body);
  const none = emailsFor('UPDATE', at({ phase: 'delivered' }), at({ phase: 'production' }))[0].body;
  assert(!none.includes('photo'), none);
});
check('review request links to the review form', () => {
  const [m] = ctxD.reviewRequestEmails([at({ phase: 'delivered' })], {}, {});
  assert(m.to === 'jane@example.com' && m.subject === 'How did your SoloPrint order turn out?', m.subject);
  assert(m.body.includes('https://soloprint.vercel.app/?requests=jane%40example.com&review=1729#order-1729'), m.body);
});
check('leftover roll reminder: about 2 weeks before it expires, once per roll', () => {
  const roll = (id, boughtDaysAgo, grams) => ({ id, clientName: 'Lee', clientEmail: 'lee@example.com', phase: 'delivered', createdAt: daysAgo(boughtDaysAgo + 1),
    phaseHistory: { order_received: daysAgo(boughtDaysAgo) }, items: [{ name: 'Case', qty: 1, filType: 'special_order', specialColor: 'Red TPU', grams }] });
  const jobs = [roll('soon', 50, 300), roll('later', 20, 300), roll('used-up', 50, 980)];
  const first = ctxD.rollReminderEmails(jobs, {}, {}, NOW, {});
  assert(first.emails.length === 1 && first.emails[0].subject.startsWith('Your Red TPU roll is yours until') && /about 700 g left/.test(first.emails[0].body), JSON.stringify(first.emails.map(m => m.subject)));
  const again = ctxD.rollReminderEmails(jobs, {}, {}, NOW, first.sent);
  assert(again.emails.length === 0, 'reminded twice');
});
check('weekly summary counts what needs attention', () => {
  const jobs = [at({ id: 'a' }), at({ id: 'b', phase: 'quote_sent' }), at({ id: 'c', phase: 'production', paymentStatus: 'payment_requested' }),
    at({ id: 'd', phase: 'delivered', paymentStatus: 'payment_received', paidAt: daysAgo(2) }), at({ id: 'e', phase: 'delivered', paymentStatus: 'payment_received', paidAt: daysAgo(30) })];
  const site = { colors: [{ id: 'black', name: 'Black' }, { id: 'red', name: 'Red' }] };
  const m = ctxD.weeklySummaryEmail({ jobs, private: { inventory: { black: { grams: 150 }, red: { grams: 800 } } }, new_reviews: 2 }, {}, site, NOW);
  assert(m.to === 'jeffsolo49@gmail.com' && m.subject === 'SoloPrint this week: $9.28 in sales', m.subject);
  for (const line of ['Waiting for a quote from you: 1', 'Quotes waiting on the customer: 1', 'Confirmed but not paid yet: 1', 'Printing now: 1', 'New reviews to approve: 2', 'Running low on: Black (150 g)']) {
    assert(m.body.includes(line), `missing "${line}" in\n${m.body}`);
  }
});
check('daily run: one failing part does not stop the others', () => {
  const mails = [];
  const props = { SECRET: '0123456789abcdef0123456789abcdef' };
  const ctx = load({
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, getProperties: () => ({ ...props }), setProperty: (k, v) => { props[k] = v; } }) },
    MailApp: { sendEmail: m => mails.push(m.subject) },
    UrlFetchApp: { fetch: url => {
      const fn = url.split('/rpc/')[1] || '';
      const reply = fn === 'due_quote_reminders' ? [200, JSON.stringify([at({ phase: 'quote_sent' })])]
        : fn === 'due_review_requests' ? [404, '{"message":"Could not find the function"}']
        : fn === 'owner_report_data' ? [200, JSON.stringify({ jobs: [], private: {}, new_reviews: 0 })] : [200, '[]'];
      return { getResponseCode: () => reply[0], getContentText: () => reply[1] };
    } }
  });
  let error = '';
  try { ctx.sendQuoteReminders(); } catch (e) { error = e.message; }
  assert(mails.includes('Still interested? Your SoloPrint quote is waiting'), 'quote reminder not sent');
  assert(/Review requests: due_review_requests isn't set up yet: run supabase\/owner-tools\.sql/.test(error), error);
});

console.log('\nPrices and rules from Site Settings:');
check("new prices apply to new requests, never to quotes already sent", () => {
  const site = { rules: { baseFee: 5, minuteRate: 0.05, venmo: 'New-Name' } };
  const fresh = emailsFor('INSERT', at({}), null, {}, site)[1].body;            // 2 x (5 + 90 x 0.05 + 20 x 0.024) = 19.96
  assert(fresh.includes('Automated estimate: $19.96'), fresh);
  const old = emailsFor('UPDATE', at({ phase: 'quote_sent' }), at({}), {}, site)[0];   // quoted before rates were saved: original prices
  assert(old.subject === 'Your SoloPrint quote: $9.28', old.subject);
  const saved = emailsFor('UPDATE', at({ phase: 'quote_sent', rates: { baseFee: 3, minuteRate: 0.024, gramRate: 0.024, specialGramRate: 0.034 } }), at({}), {}, site)[0];
  assert(saved.subject === 'Your SoloPrint quote: $11.28', saved.subject);       // the rates saved on the quote
  const confirmed = emailsFor('UPDATE', at({ phase: 'order_received' }), at({ phase: 'quote_sent' }), {}, site)[0].body;
  assert(confirmed.includes('https://venmo.com/New-Name?txn=pay&amount=9.28'), confirmed);
});
check('bad rule values are ignored', () => {
  const r = ctxD.shopRules({ rules: { baseFee: -1, minuteRate: 'abc', gramRate: '0.03', venmo: 'bad name!' } });
  assert(r.baseFee === 2 && r.minuteRate === 0.024 && r.gramRate === 0.03 && r.venmo === 'Jeffrey-Sol-3', JSON.stringify(r));
});
check('material note from Site Settings goes in the quote', () => {
  const body = emailsFor('UPDATE', at({ phase: 'quote_sent' }), at({}), {}, { materialNote: 'Printed in PETG unless noted.' })[0].body;
  assert(body.includes('Printed in PETG unless noted.') && !body.includes('PLA'), body);
});
check('reminder timing comes from Site Settings', () => {
  const days = {};
  const props = { SECRET: '0123456789abcdef0123456789abcdef' };
  const ctx = load({
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, getProperties: () => ({ ...props }), setProperty: (k, v) => { props[k] = v; } }) },
    MailApp: { sendEmail() {} },
    UrlFetchApp: { fetch: (url, opt) => {
      if (url.includes('/site_settings')) return { getResponseCode: () => 200, getContentText: () => JSON.stringify([{ data: { rules: { quoteReminderDays: 5, reviewRequestDays: 10 } } }]) };
      const fn = url.split('/rpc/')[1];
      days[fn] = JSON.parse(opt.payload).p_days;
      return { getResponseCode: () => 200, getContentText: () => (fn === 'owner_report_data' ? '{"jobs":[]}' : '[]') };
    } }
  });
  ctx.sendQuoteReminders();
  assert(days.due_quote_reminders === 5 && days.due_review_requests === 10, JSON.stringify(days));
});

check('unfinished request reminder links back to the saved request', () => {
  const [m] = ctxD.draftReminderEmails([{ id: 'abc-123', clientEmail: 'kim@example.com', clientName: 'Kim',
    data: { items: [{ mode: 'idea', notes: 'A phone stand for my desk at work please' }, { mode: 'link', modeDrafts: { idea: { name: 'Coaster' } } }] } }], {});
  assert(m.to === 'kim@example.com' && m.subject === 'Want to finish your SoloPrint request?', m.subject);
  assert(m.body.includes('Hi Kim,') && m.body.includes('a request for A phone stand for my desk, Coaster') && m.body.includes('https://soloprint.vercel.app/?resume=abc-123'), m.body);
});

console.log('\nLoader (email/Loader.gs):');
const zlib = require('zlib');
const LOADER = fs.readFileSync(path.resolve(__dirname, '..', 'email', 'Loader.gs'), 'utf8');
const blob = bytes => ({ bytes: Buffer.from(bytes), getBytes() { return this.bytes; }, getDataAsString() { return this.bytes.toString('utf8'); } });
const GoogleUtilities = {
  newBlob: data => blob(data), gzip: b => blob(zlib.gzipSync(b.getBytes())), ungzip: b => blob(zlib.gunzipSync(b.getBytes())),
  base64Encode: bytes => Buffer.from(bytes).toString('base64'), base64Decode: str => Buffer.from(str, 'base64'),
  base64EncodeWebSafe: str => Buffer.from(str).toString('base64url'), formatDate: () => '2026-10-22'
};
// One Google account: Script properties and cache last between runs; each run() is a fresh execution.
function google() {
  const props = { SECRET: '0123456789abcdef0123456789abcdef' }, cache = {}, mails = [], fetches = [];
  const g = { props, cache, mails, fetches, github: () => CODE, supabase: () => [200, '[]'], failMail: () => false };
  g.run = (fn, ...args) => {
    const ctx = {
      console, Logger: { log() {} }, Utilities: GoogleUtilities, DriveApp: {}, ScriptApp: {},
      ContentService: { createTextOutput: t => ({ text: t }), MimeType: {} },
      PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), getProperties: () => ({ ...props }), setProperties: v => Object.assign(props, v) }) },
      CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
      MailApp: { sendEmail: m => { if (g.failMail(m)) throw new Error('Mail quota exceeded'); mails.push(m); } },
      UrlFetchApp: { fetch: url => {
        fetches.push(url);
        const [code, text] = url.startsWith('https://raw.githubusercontent.com/') ? (g.github() === null ? [500, 'down'] : [200, g.github()]) : g.supabase(url);
        return { getResponseCode: () => code, getContentText: () => text };
      } }
    };
    vm.createContext(ctx);
    vm.runInContext(LOADER, ctx);
    return ctx[fn](...args);
  };
  g.post = record => g.run('doPost', { postData: { contents: JSON.stringify({ secret: props.SECRET, type: 'INSERT', record }) } });
  g.alerts = () => mails.filter(m => m.subject === 'SoloPrint emails need attention');
  return g;
}
const order = { ...base, id: '42' };

check('runs the latest code from GitHub, saves a copy, and checks GitHub at most every 15 minutes', () => {
  const g = google();
  assert(g.post(order).text === 'sent 2', 'emails not sent');
  assert(g.props.SAVED_CODE_PARTS > 0 && g.cache.code === CODE, 'copy not saved');
  g.post(order);
  assert(g.fetches.filter(u => u.includes('githubusercontent')).length === 1, 'GitHub fetched again within 15 minutes');
  assert(!g.alerts().length, 'unexpected alert');
});
check('GitHub down: keeps sending with the saved copy, alerts after repeated failures', () => {
  const g = google();
  g.post(order);
  g.github = () => null;
  for (let i = 0; i < 2; i++) { delete g.cache.code; assert(g.post(order).text === 'sent 2', 'saved copy not used'); }
  assert(!g.alerts().length, 'alerted on a short GitHub hiccup');
  delete g.cache.code; g.post(order);
  delete g.cache.code; g.post(order);
  assert(g.alerts().length === 1 && /GitHub couldn't be reached/.test(g.alerts()[0].body), `alerts: ${g.alerts().length}`);
});
check('a broken update is not used: the last good version keeps running and you are alerted', () => {
  const g = google();
  g.post(order);
  for (const broken of ['function doPost( {', CODE.replace('function emailsFor(type, rec, old, custom) {', 'function emailsFor(type, rec, old, custom) { return [];')]) {
    g.github = () => broken; delete g.cache.code; delete g.cache['alerted:bad-update'];
    assert(g.post(order).text === 'sent 2', 'emails stopped after a broken update');
    assert(/new version of the email code has an error/.test(g.alerts().pop().body), 'no alert for the broken update');
  }
  const b64 = Array.from({ length: Number(g.props.SAVED_CODE_PARTS) }, (_, i) => g.props['SAVED_CODE_' + i]).join('');
  assert(GoogleUtilities.ungzip(blob(GoogleUtilities.base64Decode(b64))).getDataAsString() === CODE, 'saved copy replaced by a broken version');
});
check('a failed send alerts you once, not on every order', () => {
  const g = google();
  g.failMail = m => m.to !== 'jeffsolo49@gmail.com';
  for (let i = 0; i < 3; i++) { try { g.post(order); } catch (e) { /* expected */ } }
  const alerts = g.alerts();
  assert(alerts.length === 1 && /Sending order emails failed/.test(alerts[0].body) && /Mail quota exceeded/.test(alerts[0].body), `alerts ${alerts.length}`);
});
check('no saved copy and GitHub down: alerts that emails are stopped', () => {
  const g = google();
  g.github = () => null;
  let threw = false;
  try { g.post(order); } catch (e) { threw = true; }
  assert(threw && /could not be loaded/.test((g.alerts()[0] || {}).body), 'no alert');
});
check('the 6-hourly check alerts when the secret no longer matches Supabase', () => {
  const g = google();
  g.run('healthCheck');
  assert(!g.alerts().length, 'alert when everything is fine');
  g.supabase = () => [400, '{"message":"forbidden"}'];
  try { g.run('healthCheck'); } catch (e) { /* expected */ }
  assert(/6-hourly check failed/.test((g.alerts()[0] || {}).body) && /doesn't match/.test(g.alerts()[0].body), 'no mismatch alert');
});

finish();
