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
- **Emails and MakerWorld lookups:** a Google Apps Script, `email/Code.gs`, run by `email/Loader.gs` (the only
  part pasted into Apps Script; it picks up new versions of `Code.gs` from GitHub by itself), called by the trigger in
  `supabase/email-trigger.sql`. Setup steps are in `email/README.md`.
- **Site Settings** (owner tab): about text and photo, Messenger/Etsy links, filament colors (type a name and the
  color picker fills in), reviews, **prices and rules** (base fee, time and filament rates, special order rolls,
  reminder timing, low-stock level, Venmo username), wording (material note, "How it works") and vacation mode,
  stored by `supabase/site-settings.sql`. Quotes keep the prices they were sent with.
- **For Claude Code:** `CLAUDE.md` maps the code, the checks and how to ship a change.
- **Emails** (owner tab): read and edit every automated email. Defaults are in `email-templates.js`,
  which `email/Code.gs` carries an exact copy of (a test checks); your edits are saved in site settings.
- **More owner tools** (`features.js`, data in `supabase/owner-tools.sql`): private order notes, finished-print
  photos (shown to the customer, one tap to the gallery), customer reviews you approve, filament stock that
  hides colors at 0 g (Filament tab), and sales, material and expenses with a yearly tax export (Money tab).
- **For customers:** vacation notice, "Order again", leftover-roll balances on My Requests, and a review form.
- **Install as an app:** `manifest.webmanifest`, `sw.js` and `icons/`. On iPhone: Safari → Share → Add to Home Screen.
- **Scheduled jobs** (Apps Script `setupSchedules`): weekly Drive backup; daily quote reminders, review requests
  (a week after delivery) and leftover-roll reminders (2 weeks before a roll expires); a Monday summary email to you;
  and a check every 6 hours.
- **Link previews:** `og-image.png` is the picture shown when the site's link is texted or shared.

## Automatic checks

Every push runs `.github/workflows/checks.yml` on GitHub:

- `tests/site.test.js`: every page loads without errors and passes WCAG 2.2 AA (axe-core), no sideways
  scrolling at phone widths, security (forged orders, owner login, customer data routes), pricing math,
  and the main customer and owner flows, with Supabase mocked.
- `tests/email.test.js`: order emails, MakerWorld/Thingiverse lookups and the weekly backup in `email/Code.gs`, and the
  loader's updates, saved copy and alerts in `email/Loader.gs`.
- `tests/sql/run.sh`: runs every file in `supabase/` twice on a fresh Postgres and checks the access rules.

Run locally: `cd tests && npm install && npx playwright install chromium && npm test`, and
`PGHOST=... PGUSER=... tests/sql/run.sh` against a scratch Postgres server.
