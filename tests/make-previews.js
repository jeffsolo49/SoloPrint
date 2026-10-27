// Takes the small "where this shows" pictures used in the owner's Settings tabs (previews/*.jpg).
// Run again when a customer-facing area changes a lot:  CHROMIUM_PATH=/opt/pw-browsers/chromium node make-previews.js
// Uses made-up sample content and no network, so the pictures show the layout, not the live content.
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'previews');
const ICON = 'file://' + path.join(ROOT, 'icons', 'icon-512.png');

const SAMPLE = {
  about: { text: 'I design and 3D print custom pieces from my home workshop. Tell me what you need and I will make it.', replyTime: 'I usually reply within a day.' },
  links: { messenger: 'https://m.me/example', etsy: 'https://www.etsy.com/shop/Example' },
  colors: [{ id: 'black', name: 'Black', hex: '#1e1e24' }, { id: 'red', name: 'Red', hex: '#d22b2b' },
    { id: 'silk', name: 'Silk Gold', hex: '#d4af37', special: true }, { id: 'white', name: 'White', hex: '#f4f4f4' }],
  reviews: [{ id: 'r1', name: 'Mike T.', text: 'Came out perfect and arrived fast.' }, { id: 'r2', name: 'Ana P.', text: 'Exactly what I described. Great to work with.' }],
  faq: [{ id: 'f1', q: 'How long does an order take?', a: 'Usually a few days.', live: true }, { id: 'f2', q: 'Do you ship?', a: 'Local pickup for now.', live: true }],
  vacation: { on: true, until: 'June 10' }
};

// [file, what to show (run in the page), element to photograph]
const SHOTS = [
  ['about', "state.clientTab = 'submit'", '.about-card'],
  ['colors', "state.clientTab = 'submit'; state.draftItems[0].mode = 'idea'", '#pills-0'],
  ['prices', "state.clientTab = 'submit'; state.draftItems[0].mode = 'idea'; state.draftItems[0].printHours = '1'; state.draftItems[0].grams = 20", '[id^=customer-price-preview-0]'],
  ['wording', "state.clientTab = 'submit'", '.card:has(.how-steps)'],
  ['text-menu', "state.clientTab = 'submit'", '.bubble-nav'],
  ['text-form', "state.clientTab = 'submit'; state.draftItems[0].mode = ''", '.request-card >> nth=1'],
  ['text-gallery', "state.clientTab = 'gallery'", '.section-header'],
  ['text-steps', "state.clientTab = 'jobs'; state.historyEmail = 'jane@example.com'", '.job-card'],
  ['faq', "state.clientTab = 'submit'", '.faq'],
  ['vacation', "state.clientTab = 'submit'", '.vacation-banner'],
  ['reviews', "state.clientTab = 'submit'", '.card:has(.reviews)']
];

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 1 });
  await page.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForTimeout(800);
  for (const [name, setup, selector] of SHOTS) {
    await page.evaluate(([sample, icon, setup]) => {
      state.view = 'client';
      state.settings = cleanSettings(sample);
      state.settingsLoaded = true;
      state.gallery = [{ id: 'g1', published: true, title: 'Desk Organizer', description: 'A tidy desk.', photos: [icon], filType: 'white', minutes: 90, grams: 40, videos: [], parts: [] }];
      state.galleryLoaded = true;
      state.draftItems = [blankItem()];
      state.batches = [normalizeBatch({ id: 'p1', clientName: 'Jane', clientEmail: 'jane@example.com', createdAt: new Date(Date.now() - 864e5).toISOString(),
        phase: 'production', paymentStatus: 'payment_received', phaseHistory: { order_received: new Date().toISOString() },
        items: [{ name: 'Desk Organizer', qty: 1, filType: 'color', colorId: 'red', color: 'Red', minutes: 90, grams: 40 }] })];
      new Function(setup)();
      render();
    }, [SAMPLE, ICON, setup]);
    await page.evaluate(() => document.querySelectorAll('img').forEach(i => { i.loading = 'eager'; }));
    await page.waitForTimeout(600);
    await page.locator(selector).first().screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 70 });
    console.log('saved', name);
  }
  await browser.close();
})();
