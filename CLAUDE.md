# SoloPrint: guide for Claude Code

A one-person 3D-print shop site: customers request quotes, approve them, pay by Venmo and track orders;
the owner quotes, tracks production, filament stock and money. Plain HTML/CSS/JS (no build step),
Supabase for data, a Google Apps Script for emails. Read this before exploring; it should answer
"where does X live" without opening every file.

## The owner (who you're working for)

- Not a developer. Works mostly from a phone. Wants plain-language, step-by-step instructions with
  direct links for anything they must do by hand (Supabase SQL, Apps Script), and as few manual steps
  as possible.
- When a change is done and the checks pass, merge it to `main` and confirm it's live (they expect this).
- Has said no to: a shipping tool, "typical prices" on the site, a QR code, a custom domain, Stripe or any
  card payments (Venmo only, after the owner confirms an order).
- Never add anything about veterans, military or "vets". (An early flyer's "vet" was misread; it means
  veterinarian, and the owner wants none of it on the site.)
- Prices, roll rules, reminder timing, the Venmo username, the material note, "How it works" and every
  email's wording are owner-editable on the site. Prefer adding a setting over hardcoding anything the
  owner might want to change.

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Page shell, link-preview tags, app manifest. Loads `email-templates.js`, `app.js`, `features.js`. |
| `email-templates.js` | **Shared with the email script.** Default email text (`EMAIL_TEMPLATES`, `{placeholders}`), shop rules and pricing (`RULE_DEFAULTS`, `shopRules`, `orderRules`, `printPrice`, `rollCharge`), leftover rolls (`leftoverRolls`, `itemParts`), `vacationText`. |
| `app.js` | Everything else on the site: state, Supabase calls, customer request form, My Requests. Owner tabs: Orders (`dashboard`), Designs (`gallery`), Calculator & Models (`calculator` + saved models), Money & Sales (`money` + sales data), Settings (`settings`, sub-tabs in `SETTINGS_TABS`: about, colors (+ stock), prices, wording, vacation, reviews, emails). Old tab ids map through `MERGED_TABS`. Global functions called from inline `onclick`; `render()` redraws the whole page from `state`. |
| `features.js` | Newer features: vacation mode, Order again, leftover-roll card, finished-print photos, reviews (form + owner approval), private notes, Filament tab, Money tab, Prices/Wording settings cards, service worker registration. |
| `styles.css` | Theme variables on `:root` (retro purple). Contrast is checked by the tests (WCAG 2.2 AA). |
| `api/design.js` | Vercel function: `/?design=<name>` links (rewritten here by `vercel.json`) get that design's title, description and photo in the link-preview tags. Its `designSlug` must match app.js (a test checks). Tested by `tests/share.test.js`. |
| `sw.js`, `manifest.webmanifest`, `icons/` | Install as an app. The service worker is network-first. |
| `email/Code.gs` | The Apps Script: order emails (`emailsFor`), daily jobs (`sendQuoteReminders` runs quote reminders, review requests, roll reminders, Monday summary), weekly Drive backup, MakerWorld lookups, `healthCheck`. Contains an exact copy of `email-templates.js` between the `SHARED EMAIL TEMPLATES` markers. |
| `email/Loader.gs` | The only code pasted into Apps Script. Runs the latest `email/Code.gs` from GitHub `main` (checked every 15 min), keeps a saved copy, emails the owner on problems. |
| `supabase/*.sql` | Run by the owner in the Supabase SQL Editor, in this order: `security`, `gallery`, `email-trigger`, `library-and-backups`, `site-settings`, `owner-tools`, `drafts`, `queue`. All must stay safe to re-run. |

## Data

- `jobs` (id, data jsonb): orders. Owner-only table; customers use RPCs `submit_job`, `customer_jobs(email)`,
  `customer_approve_quote`, `submit_review`. Anything in an order's data is visible to that customer, so
  private owner data goes in `owner_private` (keys: `notes`, `inventory`, `money`).
- `site_settings` (id=1, data jsonb): public read, owner write. Holds about, links, colors, reviews,
  `emails` (edited email text), `vacation`, `rules`, `materialNote`, `howItWorks`, `designTerms`, `galleryNote`, `topWork`
  (best-selling gallery ids for the home page, recomputed by `syncTopWork` when the owner dashboard loads). Cleaned by
  `cleanSettings` in app.js; add new fields there or they're dropped on save.
- Order queue: `order_queue()` (supabase/queue.sql) lists confirmed/printing orders as { at, printing, custom } only;
  `queueEstimate` in email-templates.js turns it into orders ahead and days (rules printDaysMin/Max, customDesignDays).
- `request_drafts`: unsent requests (one per email), saved through `save_request_draft` once an email is typed,
  reopened by `?resume=<id>` (`get_request_draft`), cleared on submit.
- Script-only RPCs need the shared secret (`private.email_settings`): `backup_export`, `due_quote_reminders`,
  `due_review_requests`, `due_draft_reminders`, `owner_report_data`.
- Order fields worth knowing: `phase` (estimate → quote_sent → order_received → production → delivered),
  `paymentStatus` (unpaid → payment_requested → payment_recieved, spelling is historical), `rates` (prices
  saved when the quote was sent), `designTerms` (custom design terms text the customer must agree to before approving), `specialOrderCost`, `extraCharges` ([{label, amount}], the owner's added charges; customers see label and amount), `ownerEditedAt`, `finishedPhotos`, `stockTaken`, `paidAt`. The owner edits a request in the estimate phase with "Edit request" (`renderOwnerEditForm` in features.js); `submit_job` strips owner-only fields.
- Items: `ownerPrice` (owner's own price per print, beats everything; 0 allowed), `setPrice` (past-work set price), see `fixedPrice`;
  `filType` black/white/color/special/special_order; `colorId`/`color`; `specialColor`,
  `useLeftover`, `leftoverFrom`; `extraColors` (multi-color prints; each may have `parts` (customer: which parts) and `grams` (owner: that color's weight; then
  item `grams` is the first color's, else it's the total split evenly, see `colorGrams`/`partGrams(it, part)`)), `mainParts`; `galleryId` and `setPrice` (a past-work design's set
  price, which replaces the calculation; re-read from the gallery when the owner quotes, never trusted from the customer).
- Gallery items (`gallery_items.data`): title, description, photos, filType, minutes, grams, `price` (optional set price),
  `videos` (YouTube ids, `youtubeId`; played only on the design page by `renderVideos`, never thumbnails or preview images).
  `parts` ([{id, name, grams, photo}], features.js `cleanDesignParts`): copied to a requested item as `designParts` with a
  `colorId` per part; `applyPartColors` groups them into the item's main color + `extraColors` (grams, parts).

## Rules that are easy to break

- Edit shared logic in `email-templates.js`, then copy the whole file into `email/Code.gs` between the
  markers. A test fails if the copies differ. Snippet:
  `python3 - <<'EOF'` … read both, replace between `// ── SHARED EMAIL TEMPLATES` line end and
  `// ── END SHARED EMAIL TEMPLATES` … `EOF`.
- `email/Code.gs` goes live from `main` within ~20 minutes with no review step, through the loader. Keep
  its checks green; the loader refuses a version that fails its sample email but can't catch everything.
- Colors in settings can have their own `rate` ($/g); `shopRules` turns them into `rules.colorRates`, `partRate` uses them,
  and quotes save them in `rates.colorRates` (`cleanQuoteRates`), so a sent quote keeps its color prices.
- Prices: always go through `printPrice` with `rulesFor(batch)` (an order's own prices) or `currentRules()`
  (today's, for new estimates). Never hardcode rates. An order quoted before `rates` existed uses
  `LEGACY_RATES`.
- The site starts (`init`) on DOMContentLoaded, after all three scripts load; features.js functions can be
  used anywhere at run time, but not in app.js top-level code.
- Top-level `const`s in app.js are created in file order; one used in another top-level value must be
  defined above it (EMAIL_SAMPLE once broke on this).
- New SQL: add it to a `supabase/*.sql` file, add checks in `tests/sql/checks.sql`, and add the file to
  `tests/sql/run.sh` if it's new. The owner must run it by hand; tell them, with the link
  https://supabase.com/dashboard/project/xpssamjjyarajtwtrwqx/sql/new.

## Checks

Run all three before pushing (CI runs the same on every push):

```bash
cd tests && npm install   # done for you at session start by .claude/hooks/session-start.sh
CHROMIUM_PATH=/opt/pw-browsers/chromium node site.test.js   # pages, axe accessibility, phone widths, features
node email.test.js                                         # Code.gs and Loader.gs with Google stubbed
node share.test.js                                         # api/design.js link previews
# Database rules, against a scratch Postgres 16:
D=/var/tmp/soloprint-pg; B=$(ls -d /usr/lib/postgresql/*/bin | tail -1); rm -rf $D; mkdir -p $D; chown postgres $D
su postgres -c "$B/initdb -D $D/data -A trust >/dev/null && $B/pg_ctl -D $D/data -o '-p 5499 -k $D' -l $D/log start >/dev/null"
sleep 2; PGHOST=$D PGPORT=5499 PGUSER=postgres tests/sql/run.sh; su postgres -c "$B/pg_ctl -D $D/data stop"; rm -rf $D
```

`tests/site.test.js` mocks Supabase with an in-memory `db` (same access rules as the SQL); add routes there
for new tables. `STATES` lists the pages checked for accessibility and sideways scrolling.

## Shipping a change

1. `git fetch origin main && git checkout -B <your claude/ branch> origin/main` (merged branches restart from main).
2. Make the change, run the checks, commit, push.
3. Open a PR and turn on auto-merge for it (GitHub MCP `enable_pr_auto_merge`, merge method "merge"), then
   stop: a ruleset on `main` requires the `site-and-email` and `database` checks, and GitHub merges by itself
   once they pass. No need to poll CI. If a check fails, the PR stays open; fix and push to the same branch.
   Branches are only checked through their PR, so open the PR right after the first push.
   GitHub's auto-merge sometimes doesn't fire: if both checks passed and the PR is still open, merge it
   with `merge_pull_request`.
4. Vercel publishes `main` (project "project-jfaha", https://soloprint.vercel.app; `claude/*` branches don't
   build). Confirm production is the new commit:
   `curl -s "https://api.github.com/repos/jeffsolo49/soloprint/deployments?environment=Production&per_page=1"`.
   This sandbox can't open vercel.app or supabase.co directly.
5. Tell the owner what changed in plain words, and any manual step (SQL to run) with links.
