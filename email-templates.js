// Automated email text: the defaults, which the owner can change on the Emails page (saved in site
// settings as `emails`). email/Code.gs carries an exact copy of this file between its SHARED EMAIL
// TEMPLATES markers, so the site and the emails always agree; a test checks the copy.
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
    body: "Hi {name},\n\nThanks for your request for {title}. We've received your submission and will respond promptly after reviewing it.\n\n{items}\n\nAutomated estimate: ${estimate}\nAny prices shown on the site are automated estimates, not exact costs. We'll email your confirmed quote once we've reviewed your request.\n\n{footer}"
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
    body: 'Hi {name},\n\nYour order for {title} is complete. Enjoy!\n\n{delivery}\n\n{footer}'
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
