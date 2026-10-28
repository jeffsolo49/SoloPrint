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
- Keeps Claude usage down: don't watch PRs (no `subscribe_pr_activity`, no check-ins); open the PR, turn on
  auto-merge, and say it will be live in a few minutes (the site's "Updated N min ago" corner confirms it).
  Keep screenshots and repeat test runs to what a change needs. Whenever a request doesn't need Opus (wording,
  a color, a one-line fix, a quick question, a lookup, a checklist, a small doc edit), say so in one line at
  the start of the reply and suggest switching to Sonnet with `/model` (or the app's model picker); big
  features, tricky bugs and careful planning or research stay on Opus.

## Open ideas (offered, not started)

- Automatic Supabase updates: a GitHub job running `supabase/*.sql` on merge via a `SUPABASE_ACCESS_TOKEN`
  secret; `email-trigger.sql` would first need to keep the saved webhook URL/secret when its placeholders are blank.
- Photos in order messages (site uploads both ways; Gmail attachments saved to the owner's Drive).
- My Requests opens with just an email address; require the order link or an emailed code.
- Order-flow problems from the diagram (https://claude.ai/artifact/5tgxMcnutahHxZ6FkbpBpu): "Quote Ready" in the
  phase list skips the quote checks; "Payment Requested" set at quote time; no warning when printing unpaid;
  confirmed email lacks the deposit; "final payment" email sent when already paid and asks pickups for an address;
  "Delivered" says complete before it arrives; payment and phase emails a minute apart.

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Page shell, link-preview tags, app manifest. Loads `email-templates.js`, `app.js`, `features.js`. |
| `email-templates.js` | **Shared with the email script.** Default email text (`EMAIL_TEMPLATES`, `{placeholders}`), shop rules and pricing (`RULE_DEFAULTS`, `shopRules`, `orderRules`, `printPrice`, `rollCharge`), leftover rolls (`leftoverRolls`, `itemParts`), `vacationText`. |
| `app.js` | Everything else on the site: state, Supabase calls, customer request form, My Requests. Owner tabs: Orders (`dashboard`), Designs (`gallery`), Calculator & Models (`calculator` + saved models), Money & Sales (`money` + sales data), Settings (`settings`, sub-tabs in `SETTINGS_TABS`: about, colors (+ stock), prices, wording, vacation, reviews, emails). Old tab ids map through `MERGED_TABS`. Global functions called from inline `onclick`; `render()` redraws the whole page from `state`. |
| `features.js` | Newer features: vacation mode, Order again, leftover-roll card, finished-print photos, reviews (form + owner approval), private notes, Filament tab, Money tab, Prices/Wording settings cards, site text/FAQ/show-hide settings, service worker registration. |
| `styles.css` | Theme variables on `:root` (retro purple). Contrast is checked by the tests (WCAG 2.2 AA). |
| `api/design.js` | Vercel function: `/?design=<name>` links (rewritten here by `vercel.json`) get that design's title, description and photo in the link-preview tags. Its `designSlug` must match app.js (a test checks). Tested by `tests/share.test.js`. |
| `sw.js`, `manifest.webmanifest`, `icons/` | Install as an app. The service worker is network-first. |
| `previews/*.jpg`, `tests/make-previews.js` | Small "where this shows" pictures in the Settings tabs (`AREA_PREVIEWS`, `areaPreview` in features.js), taken with sample content. Re-run the script after a big change to one of those areas. |
| `email/Code.gs` | The Apps Script: order emails (`emailsFor`), daily jobs (`sendQuoteReminders` runs quote reminders, review requests, roll reminders, Monday summary), weekly Drive backup, MakerWorld lookups, `healthCheck`. Contains an exact copy of `email-templates.js` between the `SHARED EMAIL TEMPLATES` markers. |
| `email/Loader.gs` | The only code pasted into Apps Script. Runs the latest `email/Code.gs` from GitHub `main` (checked every 15 min), keeps a saved copy, emails the owner on problems. |
| `supabase/*.sql` | Run by the owner in the Supabase SQL Editor, in this order: `security`, `gallery`, `email-trigger`, `library-and-backups`, `site-settings`, `owner-tools`, `drafts`, `queue`, `messages`. All must stay safe to re-run. |

## Data

- `jobs` (id, data jsonb): orders. Owner-only table; customers use RPCs `submit_job`, `customer_jobs(email)`,
  `customer_approve_quote`, `submit_review`. Anything in an order's data is visible to that customer, so
  private owner data goes in `owner_private` (keys: `notes`, `inventory`, `money`).
- `site_settings` (id=1, data jsonb): public read, owner write. Holds about, links, colors, reviews,
  `emails` (edited email text), colors may have `photo` (real-life picture, `swatchHtml`), `vacation`, `rules`, `materialNote`, `howItWorks`, `designTerms`, `galleryNote`, `topWork`
  (best-selling gallery ids for the home page, recomputed by `syncTopWork` when the owner dashboard loads).
  `siteText` ({key: {text, live}}, keys and defaults in `SITE_TEXT` in features.js; use `t(key)` for any customer-facing
  text the owner might want to change, including step names), `faq` ([{id, q, a, live}]), `features` ({key: false} for
  switched-off parts, `featureOn(key)`; Code.gs `featureOff`). Drafts (not live) show only to the owner with `previewDrafts` on. Cleaned by
  `cleanSettings` in app.js; add new fields there or they're dropped on save.
- Order queue: `order_queue()` (supabase/queue.sql) lists confirmed/printing orders as { at, printing, custom } only, `at` =
  `queueTime` (deposit or full-payment time; null = waiting for a deposit, last in line; deposit % is rule `depositPercent`);
  `queueEstimate` in email-templates.js turns it into orders ahead and days (rules printDaysMin/Max, customDesignDays).
- `order_messages` (supabase/messages.sql): one conversation per order (`sender` owner/customer, `via` site/email/auto). Owner reads/writes the table;
  customers use `customer_messages`/`customer_send_message`; site messages fire a `MESSAGE` webhook (Code.gs `messageEmail`); Code.gs logs its emails
  (`logSentEmails`) and `collectReplies` (every 5 min, `REPLY_CHECK_MINUTES`; `scheduleReplies` resets the trigger from `healthCheck`; needs Loader v2+ for Gmail) records Gmail replies via secret RPC `record_messages`. Site: messages section of features.js.
  Message text goes through `linkifyText` (links tappable); `.autogrow` boxes grow to fit (`growMessageBoxes` after render). The owner's first message on an
  order starts from site text `firstReply` (`ownerMessageDraft`). "Edit their request" in the conversation (before the quote) opens the edit form beside it (`.chat-edit`).
  Client notes (Clients page) live in `owner_private` key `clients`, never in orders.
- Practice tab (owner, `renderPracticePage` in features.js): a pretend order in `state.practice` only, never saved or emailed; its emails are
  rendered from the real templates into the chat by `practiceChange` (mirrors Code.gs `emailsFor`; keep in step). A test checks it makes no writes.
  Conversations are text-message style (`renderThread`); the step bar (`renderTrackerSteps`) sits above them.
- `request_drafts`: unsent requests (one per email), saved through `save_request_draft` once an email is typed,
  reopened by `?resume=<id>` (`get_request_draft`), cleared on submit.
- Script-only RPCs need the shared secret (`private.email_settings`): `backup_export`, `due_quote_reminders`,
  `due_review_requests`, `due_draft_reminders`, `owner_report_data`.
- Order fields worth knowing: `phase` (estimate → details_check (optional "Confirming Details": `detailsQuestions`, `detailsEmail` {subject, body} the owner approved, sent as is by Code.gs; `renderDetailsCheck` in features.js; `beforeQuote(phase)` covers both pre-quote phases) → quote_sent → order_received → production → final_payment_needed → delivered),
  `paymentStatus` (unpaid → payment_requested → deposit_received (optional; sets `depositAt`, `depositAmount`) → payment_recieved, spelling is historical), `rates` (prices
  saved when the quote was sent), `designTerms` (custom design terms text the customer must agree to before approving), `specialOrderCost`, `extraCharges` ([{label, amount}], the owner's added charges; customers see label and amount), `ownerEditedAt`, `finishedPhotos`, `stockTaken`, `paidAt`. The owner edits a request in the estimate phase with "Edit request" (`renderOwnerEditForm` in features.js); `submit_job` strips owner-only fields.
- Items: `ownerPrice` (owner's own price per print, beats everything; 0 allowed), `setPrice` (past-work set price), see `fixedPrice`; `logo` (customer ticked "Add my company logo": `logoCharge` adds rule `logoPrice` per print in `printPrice`, not on top of `ownerPrice`);
  `filType` black/white/color/special/special_order; `colorId`/`color`; `specialColor`,
  `useLeftover`, `leftoverFrom`; `extraColors` (multi-color prints; each may have `parts` (customer: which parts) and `grams` (owner: that color's weight; then
  item `grams` is the first color's, else it's the total split evenly, see `colorGrams`/`partGrams(it, part)`)), `mainParts`; `galleryId` and `setPrice` (a past-work design's set
  price, which replaces the calculation; re-read from the gallery when the owner quotes, never trusted from the customer).
- Gallery items (`gallery_items.data`): title, description, photos, filType, `colorId` (the design's color, blank = White), minutes, grams, `price` (optional set price);
  shown prices come from `designEstimate(g)` (features.js), which prices the design as a request would start (`designEstimateItem`),
  `colorMap` ({ photo (PNG), regions [{hexes (joined found colors), part}], combos [{id, name, colors {partId: colorKey}}]}: "Color ideas", the photo repainted per part;
  `findColorRegions`/`labelPixels`/`recolorPixels`, `renderColorMapForm` (owner), `renderColorIdeas` (design page), `cmRequestPreview` (request form) in features.js),
  `videos` (YouTube ids, `youtubeId`; played only on the design page by `renderVideos`, never thumbnails or preview images).
  `parts` ([{id, name, grams, photo, optional, price, minutes, defaultColor}] (defaultColor = owner's starting color; else White, `defaultColor()` in app.js) (minutes = add-on print time, added to `baseMinutes`), features.js `cleanDesignParts`; optional = add-on the customer ticks (`include`),
  price = add-on price on set-price designs, added by `ownerSetPrice` from the gallery): copied to a requested item as `designParts` with a
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
- Every estimate shows per-color lines with `colorLines`/`renderColorLines` (features.js) when an item has several colors or a color with its own rate.
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
   stop (don't subscribe to its activity): a ruleset on `main` requires the `site-and-email` and `database` checks, and GitHub merges by itself
   once they pass. No need to poll CI. If a check fails, the PR stays open; fix and push to the same branch.
   Branches are only checked through their PR, so open the PR right after the first push.
   GitHub's auto-merge sometimes doesn't fire: at the start of the next request, if an earlier PR is still open
   with both checks passed, merge it with `merge_pull_request`.
4. Vercel publishes `main` (project "project-jfaha", https://soloprint.vercel.app; `claude/*` branches don't
   build). Confirm production is the new commit:
   `curl -s "https://api.github.com/repos/jeffsolo49/soloprint/deployments?environment=Production&per_page=1"`.
   This sandbox can't open vercel.app or supabase.co directly.
5. Tell the owner what changed in plain words, and any manual step (SQL to run) with links.
