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
