# SoloPrint

Quote requests, order tracking and a gallery of past work for a one-person 3D printing shop.
Live at https://soloprint.vercel.app/

## How it's put together

- `index.html` (page shell and link-preview tags), `styles.css` (look) and `app.js` (everything the
  customer pages and owner dashboard do).
- **Hosting:** Vercel builds and publishes `main` automatically. Builds for `claude/*` work branches
  are turned off in `vercel.json` so they don't hold up the live site.
- **Data and owner login:** Supabase. Database rules are in `supabase/security.sql` and
  `supabase/gallery.sql` (gallery and photo storage).
- **Emails and MakerWorld lookups:** a Google Apps Script, `email/Code.gs`, called by the trigger in
  `supabase/email-trigger.sql`. Setup steps are in `email/README.md`.
- **Site Settings** (owner tab): about text and photo, Messenger/Etsy links, filament colors (type a name and the
  color picker fills in) and reviews, stored by `supabase/site-settings.sql`.
- **Emails** (owner tab): read and edit every automated email. Defaults are in `email-templates.js`,
  which `email/Code.gs` carries an exact copy of (a test checks); your edits are saved in site settings.
- **Scheduled jobs** (Apps Script `setupSchedules`): weekly Drive backup and daily quote reminders.
- **Link previews:** `og-image.png` is the picture shown when the site's link is texted or shared.

## Automatic checks

Every push runs `.github/workflows/checks.yml` on GitHub:

- `tests/site.test.js`: every page loads without errors and passes WCAG 2.2 AA (axe-core), no sideways
  scrolling at phone widths, security (forged orders, owner login, customer data routes), pricing math,
  and the main customer and owner flows, with Supabase mocked.
- `tests/email.test.js`: order emails, MakerWorld/Thingiverse lookups and the weekly backup in `email/Code.gs`.
- `tests/sql/run.sh`: runs every file in `supabase/` twice on a fresh Postgres and checks the access rules.

Run locally: `cd tests && npm install && npx playwright install chromium && npm test`, and
`PGHOST=... PGUSER=... tests/sql/run.sh` against a scratch Postgres server.
