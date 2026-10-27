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
  lowStockGrams: 200,      // warn when a color is down to this many grams (each color can override)
  venmo: 'Jeffrey-Sol-3'   // Venmo username for the Pay button and email link
};
const LEGACY_RATES = { baseFee: 2, minuteRate: 0.024, gramRate: 0.024, specialGramRate: 0.034 };
const RATE_KEYS = ['baseFee', 'minuteRate', 'gramRate', 'specialGramRate'];
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
// The prices an order uses: its saved quote rates, the original prices for older quotes, else today's.
function orderRules(order, settings) {
  const rules = shopRules(settings);
  const saved = cleanQuoteRates(order && order.rates);
  if (Object.keys(saved).length) return Object.assign(rules, { colorRates: {} }, saved);
  if (order && order.phase && order.phase !== 'estimate') return Object.assign(rules, LEGACY_RATES, { colorRates: {} });
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
// Price of one print. `colors` is an item (all its colors) or a single filament type.
function printPrice(minutes, grams, colors, rules) {
  const fixed = colors && typeof colors === 'object' ? fixedPrice(colors) : null;
  if (fixed !== null) return fixed;
  const material = colors && typeof colors === 'object' ? colorsMaterial(colors, grams, rules) : Number(grams) * filamentRate(colors, rules);
  return rules.baseFee + Number(minutes) * rules.minuteRate + material;
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
// What's still to pay: nothing once paid, the rest after a deposit, else the total.
function amountLeft(order, total, rules) {
  if (order.paymentStatus === 'payment_received') return 0;
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
