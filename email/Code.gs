// SoloPrint order emails, sent from your own Gmail account.
// Supabase calls this script whenever an order is created or changes (see supabase/email-trigger.sql).
// Setup steps are in email/README.md.

const SECRET = 'PASTE-YOUR-SECRET-HERE';   // must match the secret in supabase/email-trigger.sql
const OWNER_EMAIL = 'jeffsolo49@gmail.com';
const SITE_URL = '';                       // optional: your site's address, e.g. https://soloprint.example.com
const VENMO_USERNAME = 'Jeffrey-Sol-3';

const FIL_RATE = { black: 0.024, white: 0.024, special: 0.034 };
const FIL_LABEL = { black: 'Black', white: 'White', special: 'Special Request' };

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return reply('bad request'); }
  if (!SECRET || SECRET.indexOf('PASTE') === 0 || body.secret !== SECRET) return reply('forbidden');
  const emails = emailsFor(body.type, body.record || {}, body.old_record || null);
  emails.forEach(m => MailApp.sendEmail({ to: m.to, subject: m.subject, body: m.body, name: 'SoloPrint', replyTo: OWNER_EMAIL }));
  return reply('sent ' + emails.length);
}

function reply(text) {
  return ContentService.createTextOutput(text);
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
    SITE_URL ? `Track your order any time: ${SITE_URL} (open "My Requests" and enter this email address).` : 'You can track your order on the SoloPrint site under "My Requests".',
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
    `Total: $${money(orderTotal(rec))}`,
    '',
    'If it looks good, open "My Requests" on the SoloPrint site and tap "Looks good", or just reply to this email.',
    "Nothing is charged yet. We'll confirm we can make your order before asking for payment."
  ];
}

function itemLines(rec, withPrices) {
  return (rec.items || []).map((it, i) => {
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const lines = [`${i + 1}) ${it.name || 'Unnamed'}${qty > 1 ? ` x ${qty}` : ''}`, `   Filament: ${FIL_LABEL[it.filType] || 'Black'}`];
    if (withPrices && it.minutes && it.grams) {
      const each = perPrint(it);
      lines.push(`   Price: $${money(each * qty)}${qty > 1 ? ` ($${money(each)} each)` : ''}`);
    }
    if (it.link) lines.push(`   Link: ${it.link}`);
    if (it.notes) lines.push(`   Notes: ${it.notes}`);
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
  return 2 + Number(it.minutes) * 0.024 + Number(it.grams) * (FIL_RATE[it.filType] || 0.024);
}

function orderTotal(rec) {
  const items = rec.items || [];
  if (!items.length || !items.every(it => it.minutes && it.grams)) return 0;
  return items.reduce((s, it) => s + perPrint(it) * Math.max(1, parseInt(it.qty, 10) || 1), 0);
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

if (typeof module !== 'undefined') module.exports = { emailsFor };
