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
- Don't remind the owner about the Catheter Caddy brief or what they said before about it (they asked to stop); only bring it up if they ask.
- Doesn't want repeated boilerplate in replies: don't mention Help entries, test counts, "no SQL needed" or "all tests passed" unless something needs the owner's action. Say what changed in plain words, when it's live, and anything they must do.
- Keeps Claude usage down: don't watch PRs (no `subscribe_pr_activity`, no check-ins); open the PR, turn on
  auto-merge, and say it will be live in a few minutes (the site's "Updated N min ago" corner confirms it).
  Keep screenshots and repeat test runs to what a change needs. Whenever a request doesn't need Opus (wording,
  a color, a one-line fix, a quick question, a lookup, a checklist, a small doc edit), reply with only one line
  suggesting Sonnet (`/model`, or the app's model picker) and stop: don't start the task until the owner
  answers (they switch, then say go; if they answer without switching, just do it). Big features, tricky
  bugs and careful planning or research stay on Opus, with no suggestion.

## Open ideas (offered, not started)

- Automatic Supabase updates: a GitHub job running `supabase/*.sql` on merge via a `SUPABASE_ACCESS_TOKEN`
  secret; `email-trigger.sql` would first need to keep the saved webhook URL/secret when its placeholders are blank.
- Photos in order messages (site uploads both ways; Gmail attachments saved to the owner's Drive).
- Order-flow problems still open (diagram https://claude.ai/artifact/5tgxMcnutahHxZ6FkbpBpu): "Payment Requested" set at
  quote time. (The order desk fixed the phase-list quote skip, printing unpaid, paid-in-full final email, and the two
  emails for one payment.)

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Page shell, link-preview tags, app manifest. Loads `email-templates.js`, `app.js`, `features.js`. |
| `email-templates.js` | **Shared with the email script.** Default email text (`EMAIL_TEMPLATES`, `{placeholders}`), shop rules and pricing (`RULE_DEFAULTS`, `shopRules`, `orderRules`, `printPrice`, `rollCharge`), leftover rolls (`leftoverRolls`, `itemParts`), `vacationText`. |
| `app.js` | Everything else on the site: state, Supabase calls, customer request form, My Requests. Orders opens with a "When do emails go out?" guide (`renderEmailGuide`, features.js) and every phase/payment/shipping change that emails the customer first asks (`confirmEmail`, `emailForPhase`, `emailForPayment`: keep these in step with Code.gs `emailsFor`; the Numbers page must never change a phase or payment step). Customer menu has a 4th button, FAQ (`faq` tab; hidden when no questions are live), and the FAQ also sits at the bottom of every customer page. Owner tabs: Orders (`dashboard`, "order desk", `renderOwnerDashboard`: a list of orders in tabs Needs me / Waiting on them / Done (`deskTone`, from `orderNeeds`), search looks in every tab; the chosen order beside it (`state.deskOrder`; on a phone separate screens, `state.deskOpen`). The order screen (`renderOwnerBatch`) has a 6-step bar (`deskStep`), ONE next-step card with one main button (`renderNextStep`: Send quote = `renderQuoteForm`/`approveBatch`, Confirm order `deskConfirm`, Deposit received / They paid it all `deskPayment` with an amount box, Printing done `deskPrinted` (paid in full: straight to ready_to_ship, no email), Payment received (also moves to ready_to_ship), Save tracking and mark Shipped `saveDeliveryInfo`, Handed over in person `deskHandOver`), each with an "Email ..." tickbox; one feed of messages, emails and steps (`renderOwnerConversation` + `orderEvents`); folded details (`renderOrderFolds`: their request, price, notes and photos, About customer with client notes and their other orders); rare actions only in the More menu (`renderOrderMenu`: change the quote, go back a step `deskBack`, print without a deposit `printWithoutDeposit`, fix numbers, delete). No phase or payment dropdowns: keep it that way. `focusOwnerOrder(id)` opens an order (used by `?admin=` links, notifications and Money & Sales); old tabs `orders`/`clients` map here through `MERGED_TABS`; sub-menu: Orders, "Fix numbers" = `numbers`; the Orders tab shows how many orders need the owner),  Designs (`gallery`; sub-menu Calculator & Models = `calculator` + saved models; under the calculator, "Compare several links" = `renderLinkCompare`/`compareLinks` in features.js, nothing saved), Money & Sales (`money` + `renderOwnerOrdersList`, every order by date, + sales data), Numbers page (`numbers`, `renderNumbersPage` in features.js: fix typed amounts on any order: deposit, balance and shipping deposit paid (`balancePaid`, `shippingDepositPaid`; paying everything marks the order paid), postage, refund sent (`refundSent`), special order roll, added charges), Settings (`settings`, sub-tabs in `SETTINGS_TABS`: about, colors (+ stock), prices, wording, vacation, reviews, emails, updates). Old tab ids map through `MERGED_TABS`. Owner top menu is Orders, Designs, Money & Sales, Settings, Help; Practice (`practice`) and Preview (`preview`) are Help's sub-menu (`ownerSection` = help) and the password card is Settings > Password (`renderSetPasswordCard(true)`); Settings sub-tabs are about, colors, prices, wording (Wording & FAQ: also site text and FAQ), features (Show / hide & vacation), reviews, emails, password, updates (`SETTINGS_TAB_ALIASES` keep `text`/`faq`/`vacation` links working); the design form (first thing on Designs) has a labeled button row (`renderDesignOptions`: "Make this a pre-order", "Add accessories (n)", "Versions", "Color editions"; `toggleDesignOpt`, `state.galleryOpt` opens one section at a time); the owner's design cards show badges (pre-order, N accessories, "Accessory of ...") and an "Add accessories" shortcut (`editGalleryItemOpt`); customers see "Accessories available" on the gallery card and a jump button on the design page; **rule: anything a customer or the owner may need must be a visible labeled button, never buried;** the owner menu wraps to two rows on a phone so every button shows; folded sections (`.fold-card`) show an arrow and a bold title; the order's rare actions are the "More actions" button; under the design list the pre-order lists, people interested and one-tap set-ups sit in folds (`renderDesignFolds`); Money & Sales cards fold (`renderMoneyFolds`/`foldOwnerCards`: the first card stays open, the others open one at a time or with "Open all sections", `state.moneyFold`/`moneyOpenAll`; the jump buttons open a fold). Global functions called from inline `onclick`; `render()` redraws the whole page from `state`. |
| `features.js` | Newer features: Settings → Updates (`loadSiteUpdates`, merged PRs from GitHub), vacation mode, Order again, leftover-roll card, finished-print photos, reviews (form + owner approval), private notes, Filament tab, Money tab, Prices/Wording settings cards, site text/FAQ/show-hide settings, service worker registration. |
| `styles.css` | Theme variables on `:root` (retro purple, customers). Owner mode has its own plain white/grey/blue colors: `html.owner-mode` (set in `render()`) redefines the variables. Contrast is checked by the tests (WCAG 2.2 AA). |
| `api/design.js` | Vercel function: `/?design=<name>` links (rewritten here by `vercel.json`) get that design's title, description and photo in the link-preview tags. Its `designSlug` must match app.js (a test checks). Tested by `tests/share.test.js`. |
| `sw.js`, `manifest.webmanifest`, `icons/` | Install as an app. The service worker is network-first. A page left open keeps its old code: when `loadLastUpdate` (app.js) sees a production deploy newer than the one at page load (`pageDeployAt`), `showNewVersionBar` offers "Reload now". |
| `previews/*.jpg`, `tests/make-previews.js` | Small "where this shows" pictures in the Settings tabs (`AREA_PREVIEWS`, `areaPreview` in features.js), taken with sample content. Re-run the script after a big change to one of those areas. |
| `email/Code.gs` | The Apps Script: order emails (`emailsFor`), daily jobs (`sendQuoteReminders` runs quote reminders, review requests, roll reminders, Monday summary), weekly Drive backup, MakerWorld lookups, `healthCheck`. Contains an exact copy of `email-templates.js` between the `SHARED EMAIL TEMPLATES` markers. |
| `email/Loader.gs` | The only code pasted into Apps Script. Runs the latest `email/Code.gs` from GitHub `main` (checked every 15 min), keeps a saved copy, emails the owner on problems. |
| `supabase/*.sql` | Run by the owner in the Supabase SQL Editor, in this order: `security`, `gallery`, `email-trigger`, `library-and-backups`, `site-settings`, `owner-tools`, `drafts`, `queue`, `messages`, `order-links` (last: it holds every function customers can call). All must stay safe to re-run. |

## Owner login

Supabase Auth password login. "Keep me logged in on this device for 30 days" (`owner-remember`) stores the refresh token in
localStorage (`OWNER_REMEMBER_KEY`, `refreshOwnerSession`, also retried on a 401 in `supaFetch` and at start in `init`); unticked = the old
1-hour login. When the login runs out with the page open, `supaFetch` renews it or shows the login again (never asks as a logged-out visitor, which made the shop look empty); a failed owner load shows `#load-failed` (`state.loadFailed`) with Try again. Logout and "Log out everywhere" (`logoutEverywhere`, in the Change Password card) revoke the login on Supabase. New passwords go through
`weakPasswordReason` (12+ characters, no common words); the card lists safety tips. Supabase dashboard settings the owner can add: 2-step on the login Gmail,
Auth → Sessions "time-box"/"inactivity timeout" (Pro), and leaked-password protection (Pro).

## Payments wording

Venmo note (`venmoNote`, email-templates.js, shared): "SoloPrint" + up to 3 words of the first item + deposit / balance / full; never "order" or a number
(owner doesn't want it to look like a business). Every customer message about paying explains the choice (pay in full = one Venmo payment, or deposit now and
the rest later = two) and that the shipping deposit is only partly refunded, based on the real packaging and postage cost (quote, reminder, confirmed,
deposit, printing done, payment, shipped emails; site order action; `shippingDepositNote`). Keep that when editing these texts.

## Color ideas: reverse, save, share

On a design with parts and a color-ideas picture, customers see "Reverse colors" (`reverseColors`, `reverseCmColors`; only when exactly 2 different colors are on show; also on the request form's part colors, `reversePartColors`),
can save a combination with a name on their own device (`saveCmColors`, localStorage `soloprint_saved_colors_v1`, shown as "Name (mine)"), and send it (`sendCmColors`,
RPC `submit_color_idea` -> table `color_ideas`, owner-tools.sql; 20 waiting per design, 200 in all). The owner sees them on the Designs page (`renderColorIdeasInbox`),
is told on the bell (`colorIdeaNotifications`, loaded with the orders by `fetchColorIdeas`; tapping opens the inbox, `openColorIdeaInbox`), renames and publishes (`publishColorIdea` adds to the design's `colorMap.combos`, now up to 16) or dismisses. The design's color-map form also has "Paste several color ideas at once" (`importCmCombos`: one `Name, color, color` line per idea, a color per part in the part order shown; any bad line adds nothing). The owner must run supabase/owner-tools.sql once for sending to work. Designs page card "Drying rack color ideas" (`renderDryingRackSetup`, `addDryingRackIdeas`, `DRYING_RACK_PRESET`, picture `presets/drying-rack.png`): one tap adds the owner's 10 named ideas, the picture and Base/Spine parts. New parts carry no grams: the site's own rule then splits the design's total weight evenly between the colors (`applyPartColors`); never invent a split.

## Reviews: half stars

Review ratings run 1 to 5 in half steps (`customer_reviews.rating` numeric(2,1), converted once by owner-tools.sql; `submit_review(..., p_rating numeric, ...)` in order-links.sql). The form has a left and right half on each star
(`.review-stars`, each half at least 24px wide for the accessibility check). Until the owner re-runs owner-tools.sql then order-links.sql, `sendReview` falls back to the whole star below a half so no review is lost.

## Etsy sales

Money page card "Etsy sales" (`renderEtsyCard` in features.js), data in `owner_private` key `etsy` ({ orders, costs, seen }; never in an order, no addresses kept).
Upload Etsy's Orders CSV (Shop Manager > Settings > Options > Download Data), Order Items CSV (item names) or a monthly statement CSV (fees, shipping labels, listing fees/ads);
`etsyPlan` reads columns by name and shows a preview, `applyEtsyImport` saves. Re-imports update by Etsy order id (orders edited by hand stay as they are: `edited`), statement lines are
fingerprinted in `seen` so nothing counts twice, and a statement "Processing fee" is skipped when the Orders file already gave the card fee. Every sale is editable or typed by hand
(`renderEtsyForm`/`saveEtsyForm`); material = typed $ or grams x the Money page cost per kg. `etsyProfit` = sale + shipping paid - refund - fees - label - material (sales tax not counted). `label` is all shipping costs: labels plus Etsy's "Transaction fee: Shipping" (`etsyShipFee`; statements imported before that rule are moved once by `etsyMoveShipFees`, flag `shipFeesMoved`).
Marketing: an order's `ads` (Offsite Ads fee from a statement "Marketing" line with its order number) and costs with `kind: 'ads'` (Etsy Ads; older costs without a kind count as ads when the name says so, `etsyCostIsAds`); "Etsy marketing" stat, column, export column; old imports' Offsite Ads fees move once with the shipping fees (flag `adsMoved`).
Upload takes many files at once (up to 60, e.g. a year or two: Orders, Order Items and 12+ statements; `etsyFileChosen`): files are sorted Orders, Order Items, statements (oldest first), each planned on the result of the one before (`etsyPlan` then `etsyApplyPlan`, on a copy), shown as one preview (`state.etsyImport = { plans, bad, result }`) and saved once by `applyEtsyImport`.
Statements: every money line counts except deposits, reserves and payments of the Etsy bill ("Card Payment"; older imports' credits for them are ignored, `etsyIsBillPayment`) (and buyers' sales tax): a Sale row for an order not in an Orders file becomes a sale (`fromStatement`; a later Orders file updates it, swapping the statement's processing fee `stmtCardFee` for its card fee and keeping refunds `stmtRefund`), Refund rows add to that order's refund, positive lines are credits (negative charges); a buyer's sales-tax line takes the tax back out of a sale read from the statement (`f.tax`), since Etsy's Sale row includes it. Charges naming an order that isn't uploaded are flagged (`etsyOrphanCharges`, `#etsy-orphans`) and move onto the order once it arrives (`etsyRelinkCosts`). Loose charges are classed by `etsyCostKind` (ads / shipping / fees; `kind` 'ads', 'label' or 'fee').
A hand-typed sale with `summary: true` is a yearly summary (the owner's Etsy activity summary): it counts until a monthly statement is uploaded for every month it covers (plus the Orders file for months with sales: `statementMonths`, `saleMonths`, `ordersMonths`, `etsySummaryMissing`), then `etsyApplyPlan` removes it (with charges typed by hand on its date, `etsySummaryPart`, which count with it meanwhile); months before the first statement ever uploaded are before the shop opened and not required. Uploads inside an active summary are saved but not counted (`etsyPending`), shown "Not counted yet"; the card lists the months still needed.
Card layout (`renderEtsyCard`, `renderEtsyTabs`; each kind has its own color, `--sec-orders/ads/fees/shipping/profit` in styles.css, classes `sec-*`): always all years (all-time profit box with "How this is worked out" and stat row; the "Both shops" line uses the Money page year). Tabs (`etsyTab`): "Profit & loss" (default, `renderEtsyOverview`: tiles for this month, last month, this year, last year, all time with the change on the period before; then each year folds open to a table of its months: sales #, sales, fees, shipping, marketing, material, profit, margin; a month opens its orders, `etsyOpenMonth`), Orders, Marketing, Fees, Shipping. Every period total comes from `etsyPeriod(prefix)` / `etsyCalc` (loose charges included), so months add up to years. Months without sales still show (`etsyAllMonths`: first activity to now): P&L rows, Orders headings with "No sales this month" and their costs, and a total row per month in the Spreadsheet when sorted by date. Search (`etsyQuery`), Group by (`etsyGroup`: default "Year, then month" nests years then months, `etsyGrouped`; also week/month/year/all; newest open, or `state.etsyOpenGroup`). Orders: each sale folds open to its costs (List) or a sortable Spreadsheet (`ETSY_COLUMNS`, `ETSY_SORTS`); the cost tabs list every charge with its order number (`etsyTabRows`, tap to open the order, `etsyOpenOrder`) and an "Add ... by hand" form. Tab, view and grouping are remembered per device (localStorage `soloprint_etsyTab`, `soloprint_etsyView`, `soloprint_etsyGroup`).
The yearly Excel export has an Etsy sheet and "both shops" totals. SoloPrint's own ad spending is `money.ads` ([{ id, date, where, amount }], `renderAdsCard`, `addAdCost`), shown as its own stat, monthly column and export sheet, and subtracted in "Sales minus expenses and ads" and the both-shops total.

Owner photos on reviews: each review in Settings > Reviews has "Add photos" (`renderReviewPhotoEditor`, `uploadReviewPhotos`, `removeReviewPhoto`, up to 4, stored in the gallery bucket under `reviews/`); `cleanSettings` keeps 4 per review (customers' own uploads stay at 2).

## Reviews from Etsy

Settings > Reviews has "Import reviews from Etsy (reviews.json)" (`etsyReviewsChosen`, `renderEtsyReviewImport`, `addEtsyReviews` at the end of features.js): Etsy's file is
[{ reviewer, date_reviewed 'MM/DD/YYYY', star_rating, message, order_id }]; the owner ticks which to add (ones whose text is already on the site are left out; "Sign in with Apple user" shows as "A customer"),
links each to a design (guessed from the uploaded Etsy sale's item names), then Saves. Site reviews keep `rating` (half steps), `source: 'etsy'` and `date` (`cleanSettings`); `renderReviews` shows the stars and "on Etsy".
Approved customer reviews keep their rating too (`decideReview`). Up to 40 reviews (`ETSY_REVIEW_MAX`, the `cleanSettings` limit).

## To make (print list: site orders and Etsy orders)

Orders > "To make" (`etsytodo` tab) is one list for both: Etsy orders from `etsy_todo` plus every site order that is Confirmed & Printing (`siteTodoOrders`: one line per part and color, `todoOpenOrders` merges them; site lines have `site: true` and tick boxes saved in `owner_private` key `site_todo` { ticks: { lineId: printed } } by `siteTick`; they have an "Open order" button instead of Shipped/Edit/Delete). "Print this list" (`printTodoList`, print styles under `html.printing-todo`) prints just `#todo-orders`. A design with no uploaded photos uses its color-ideas photo as its photo (`cleanGalleryItem`: `photos` falls back to `colorMap.photo`, `ownPhotos` is what the owner uploaded and is what gets saved; api/design.js does the same for link previews). Owner-mode photos for color ideas and parts are large (`.cm-big`, `.cm-mask`, `.part-thumb`).

## Etsy to make (the Etsy half of the list above)

Orders > "Etsy to make" (`etsytodo` tab, `renderEtsyTodoPage` at the end of features.js): Etsy orders still to print, in `owner_private` key `etsy_todo` (keys must be lowercase a-z and _, the table's check)
({ orders: [{ id, etsyId, buyer, due (ship by), note, done, doneAt, lines: [{ id, what, color (name text), qty, printed }] }] }). One list of waiting orders (no separate print list): color buttons on top show how many are left in each color and filter the list to that color (`state.todoColor`); each part has tick boxes per piece (`todoPieces`), Change (inline what/color/qty, `todoLineForm`/`todoLineSave`) and Remove (`todoLineRemove`); each order Shipped: done (`todoFinish`, asks first), Edit order, Delete order; finished orders can be put back or deleted.
Add by hand (`state.todoDraft`), from a design's parts with a color idea (`todoAddDesign`, `colorMap.combos`), or unshipped rows of Etsy's Order Items
file (`todoImport`: no Date Shipped, skips order numbers already listed; Variations become the color text). Never touches the Etsy sales numbers.
Waiting orders show open (not folded), like the edit screen: Etsy's listing title (`title`, only on orders from the Order Items file; editable in Edit), then each part with its picture (`todoPicture`: the design's color-ideas photo in this order's colors with that part alone, `cmCanvas(..., focus)`; else the part's or design's photo; lines remember `galleryId`/`partId` when added from a design, older ones are matched from "Part (Design)" by `todoLink`) and a tick box per piece printed (`todoPieces`/`todoSetPrinted`; a counter past 12).

## Amazon invoices

"Read an Amazon invoice" (`renderInvoiceReader('money' | 'stock')`, Money > Expenses and Settings > Colors > Stock on hand; features.js): photos/screenshots via Tesseract OCR, PDFs via pdf.js (both loaded on first use from jsdelivr/cdnjs, `INVOICE_LIBS`).
`parseInvoiceText` reads the invoice ("1 of:" rows, price = one item x qty), the saved "Order Details" page (name above "Sold by", price after; stops at "Pick up where you left off" so ads are ignored), or any priced lines;
`invoiceLines` makes one line per color (packs split evenly; grams from kg/g, packs, qty). Only filament is added (`invoiceIsFilament`: PLA/PETG/TPU/ABS/ASA..., not nozzles, glue, dryers...), plus the filament's share of tax, shipping and discounts.
Nothing saves until the owner checks the review (`renderInvoiceReview`) and taps Add (`applyInvoice`): new colors into Settings colors, grams onto `inventory`, one expense per line (`invoice` = Amazon order number, `money.invoices` warns on repeats), optional cost per kg.
Tests: `tests/fixtures/amazon-invoice.pdf` and `amazon-order-details.pdf` (made-up data), read with `pdfjs-dist` from tests/node_modules (the cdnjs URL is routed to it).

## Owner Help (wiki)

Owner menu "Help" (`help` tab, `renderWikiPage` in features.js): step-by-step entries for everything in owner mode (`OWNER_WIKI`: { id, area, title, keys, steps, go: [ownerTab, settingsTab] } for "Take me there", `wikiGo`),
a search box matching every typed word against title, area, keywords and steps (`wikiMatches`, results redrawn in place so typing keeps focus), and the owner's own notes (owner_private key `wiki`, { entries: [{ id, title, text }] }, shown as "My notes").
**When you add or change an owner feature, add or update its entry in `OWNER_WIKI`** (exact button names).

## Section buttons (owner)

Every owner page with 2+ sections gets a button per section on the right that stays in view (`buildJumpNav` at the end of features.js, `#jump-nav` outside `#app-root`;
under 1000px wide a "Sections" button opens the list). Built from the page after each redraw (a MutationObserver): each top-level `.card`'s heading, plus `.wiki-area` and
`.email-group-title`, so a new card with a `.card-title` gets its button by itself. Highlights the section in view (`markJumpActive`).

## Pre-orders

A design with the "Pre-order" box (`preorder`, `preorderReady` on gallery data; `renderPreorderFormFields`) shows a badge, "Pre-order this" (`requestLabel`) and the first come, first served note (`renderPreorderNote`, site text `preorderNote`/`preorderBadge`/`preorderThis`).
Requested items keep `preorder: true` (`galleryItemFields`, `cleanItem`). Shared `orderIsPreorder`, `preorderNoteText(settings)` (the owner's live site text or `DEFAULT_PREORDER_NOTE`), `preorderQueueNote`: the quote, confirmed and deposit emails' `{queueNote}` is that note instead of a days estimate (Code.gs `queueNote`, site `stepEmailPreview` vars). `{detailsItems}` lists "Pre-order".
Owner: Designs page "Pre-orders" card (`renderPreorderLists`, `preorderQueue`: paid deposits by `queueTime`, then the rest by request time), a desk chip and "Number N of M" on the order (`preorderPlace`). Normal order steps and deposits; nothing new in the database.
The line customers see: `settings.preorderLine` ({ designId: [deposit times] }, times only, kept by `syncTopWork` via `preorderLineFromOrders` and after every owner order save/delete; `cleanPreorderLine`) feeds shared `preorderLine`/`preorderLineText`, so the customer's order and the emails say "You're number N in line" (or how many are ahead before their deposit). The owner types `preorderEta` ("Expected print and ship time", `renderPreorderEta`, `savePreorderEta`; card and order screen); shared `preorderEtaText` shows it to the customer.

## Versions, joining pack, color groups

Gallery data: `versions` ([{ id, name, count, needsPack }], `cleanVersions`), `packId` (the joining pack's own design), parts' `group` (same group = one shared color: `partLead`, `syncGroupColors` run inside `applyPartColors`; the request form shows one row per group, `setPartColor` sets the whole group, design-page "pick your own" is per group) and color ideas' `photo` (`uploadComboPhoto`; a picked idea with a photo shows it instead of the repainted picture, `cmUsable` is true when any idea has a photo; "Pick your own" hides when no area is mapped).
Print time, grams and price are for one main item: `applyVersion` (and `applyPartColors` via `item.versionCount`) multiply them by the version's `count`. Items keep `versionId/versionName/versionCount/needsPack/packFor`. `requestGalleryItem` and `setItemVersion` add or remove the pack item (`packItemFor`, `packFor` = the main design). A design with versions or Pre-order can be requested before it has a price ("Price confirmed in your quote").
Parts also have `allowed` (color ids; empty = every color; owner form "Limit colors", `togglePartAllowed`): `partAllowed`/`partChoicesFor` give a part or group (intersection of its members' lists) only those colors in the request form, color ideas "Pick your own", `cmPartColors` and `applyPartColors`.
The Catheter Caddy picker hides limited colors per step (`caddyLimits`, `caddyAllowed`, `caddyFix(c, lim)`). Owner side bar: the page's main Save button is repeated there (`pageSaveButton`, `PAGE_SAVE_IDS`, `clickPageSave`, `#jump-save`); new pages with a main save button should add its id to `PAGE_SAVE_IDS`. Color-map areas on the design form are tiles (`.cm-regions` grid).
Owner form (Parts): "Grouped with other parts" (`part-group-list` datalist of names already used, `partGroupSummary` lists the groups); color ideas honor groups too (`setCmComboColor` sets the whole group, `cmPartColors` gives a group the color of its first part).
The nudge: `joinHint` on the request form (their `state.batches` history: `singleUnits`, `hasPackFor`) and `joinSuggestion(b)` for the owner (all orders with the same email; chip "Joining pack?"). Details emails list "Version: ...". The extra colors charge still applies by color count.

## Accessories (part of ordering the main design)

Gallery data `accessories` ([design ids], `cleanGalleryItem`, `galleryRowOf`; owner ticks them under "Accessories (optional)" in the design form, `renderAccessoriesForm`). A design listed under another's `accessories` (`isAccessory`) is not shown on its own: left out of the gallery grid, home page and the request form's design picker. On the main design's page `renderAccessoryPicker` (inside `renderWorkPrice`) gives a quantity per shown accessory and "I only want accessories" (`designOpts(id).acc / .skipMain`, `setAccessoryQty`, `setAccessoriesOnly`). `requestGalleryItem` adds the main item (unless accessories only; with none picked it asks for one) plus one item per accessory (`accessoryItemFor`, item `accessoryFor` = the main design, qty = quantity). Caddy: `setupCatheterCaddy` links its 13 accessories; a caddy set up earlier gets the card "Make accessories part of the caddy order" (`linkCaddyAccessories`). The Joining Kit still works through `packId`.

## Add a design wizard + compact spacing

Designs > "Add a design (wizard)" (`newdesign` tab, `renderDesignWizard`, features.js end): six steps (`WIZ_STEPS`: Name, Photos, Price and time, Parts and colors, Options, Finish) that fill the same `state.galleryForm` as the Designs form (`startDesignWizard`, `wizGo`, `wizCreate` -> `saveGalleryItem`); starts hidden unless "Show it on the site now" is ticked; leaving the tab clears the form. The photos field is shared (`renderGalleryPhotosField`). Color areas on the design form have a sticky live preview (`renderCmLive`, `setCmLive`). Desktop spacing is tightened in a `@media (min-width: 900px) and (hover: hover) and (pointer: fine)` block at the end of styles.css (cards, fields, inputs, tick boxes stay 24px for the target-size check); touch devices keep the larger sizes. Settings > Emails editors fold (`details.email-card`, `state.emailOpen`).

## Set-ups (reusable, Designs > Set-ups fold)

`renderSetups` (features.js, end; fold title "Set-ups", `renderDesignFolds`): saved set-ups in owner_private key `setups` ({ items: [{ id, name, designs: [gallery rows], links: { main } }] }, `savedSetups`/`writeSetups`). "Save as set-up" button on each design card (`openSetupSave`) or the "Save a design as a set-up" form (`saveSetup`: the design plus its `accessories` and `packId` design, photos only if ticked, links stored as indexes); "Use this set-up" (`useSetup`) makes hidden copies with new ids and remapped links through `writeGalleryItem` (preview-aware); `renameSetup`, `deleteSetup`. The built-in set-ups (Catheter Caddy, its remove card, drying rack ideas) are listed under "Built-in set-ups".

## Catheter Caddy pre-order (the template for a configurable pre-order product)

Designs page "Set up the Catheter Caddy pre-order" (`renderCaddySetup`, `setupCatheterCaddy`, data `CADDY_MAIN`/`CADDY_ACCESSORIES`/`CADDY_JOINING_KIT` at the end of features.js; product wording as the owner wrote it): hidden pre-order designs, no pictures/grams/times, caddy set price $50.
Editions (`editions` [{ id, name, desc, merge { group: into }, files }], `editionOf`, `applyEdition`, item `editionId/editionName/groupMerge`): an edition merges color groups (Two-Tone: Drawer colour > Accent colour, Tab colour > Shell colour), so the request form has one color row per effective group (`partGroup`, `partLead`, `syncGroupColors` take `merge`). `contrast` ([[a,b]]) = groups that must not match after merging (`colorsClash`: message site text `contrastNote`, blocks `submitBatch`). Versions now also have `price` (own set price), `tbd` (price in the quote), `packIncluded` (joining parts in the price, no separate pack item), `askOrder` (`matchOrder`, not auto-matched yet) and `note`. Design flags `colorFeeIncluded` (no more-than-2-colors charge: `colorCharge` skips items with it) and `sideWall` (`sideWallNote` after more than 2 in a request).
Pre-order terms (shared `PREORDER_TEXT`, `preorderText`; site text `preorderPay/Secure/Ship/Cancel/Policy/Assembly`; Policy = "Site policies still apply to unclaimed items." (the owner's store policy resells unclaimed or unpaid-shipping orders eventually; the wording is deliberately short)): paid in full by Venmo, no credit card checkout and a Message me/contact button (`renderPreorderNote`), shipping by location in a separate payment, cancellation, assembly. Pre-orders have no deposit option: `orderRules` sets `depositPercent` 0 for them and `payWording` (shared; template vars `payIntro`, `secondPaymentNote`, `orPay`, `howPaying`) words the quote and confirmed emails to match; it also words them for any order when the owner sets the deposit to 0.
Timing: `settings.preorderTiming` ({ launch, days, extraDays, breaks [{name, from, to}] }, defaults `PREORDER_TIMING`, editor `renderPreorderTimingSettings` in Settings > Prices & rules, `cleanPreorderTiming`): `preorderReadyDate(units, settings, now)` starts at the launch date, adds `days` + `extraDays` per extra unit (`preorderUnits`: qty x version count), skips breaks; shown as "Estimated ready to ship" on the note and in the quote/confirmed emails unless the owner typed an expected time. Seller-only `renderFulfilment(b)` fold on the order. `renderCaddyRemove`/`removeCatheterCaddy` delete all 15 set-up designs in one tap (and hide the set-up card via localStorage `soloprint_caddy_hidden`). Not built yet: pictures by exact color combination and by accessory color, hiding the Single Handle Grip for a joined pair, matching an entered order number to that order, adding add-on quantities.

## Catheter Caddy color picker

Replaces the old editions for the caddy (`isCaddyDesign`; `renderEditionPicker`/`applyEdition` skip it, new set-ups save `editions: []`). Three steps (features.js, `renderCaddyPicker`): body White/Black; secondary (dividers and handle) = opposite of the body or Red/Green/Blue/Orange, never the body color; drawers = the secondary, or with an opposite-of-body secondary also any accent. `caddyFix` makes any choice valid (only 18 combinations); tabs follow (`tab` = secondary when the drawers differ, else the body), `style` is "2-color"/"3-color". The choice lives on the item as `caddy` { body, secondary, drawer, tab, style } (`cleanItem`, `cleanCaddy`), design-page choice in `designOpts(id).caddy`; `applyCaddyColors` sets the part color groups (Shell = body, Accent = secondary, Drawer, Tab), `caddyPackSync` colors the Joining Kit item with the body color; `renderPartColors` shows the picker instead of per-part rows for the caddy. "Match my first caddy" = `caddyMatch`/`caddyEarlier`. Preview = the design's color-ideas photo repainted like any design (`colorMap`, one photo whose areas the owner matches to the parts; for the caddy the BACK view first so body, secondary, drawer and tab colors are all there; optional `colorMap.photoAlt` = front view in the same colors, `uploadColorMapAltPhoto`, gives the Front/Back buttons; `caddyPreviewHtml`; the old color-ideas card is off for the caddy, `cmShown`). Without a photo it falls back to ready-made pictures `presets/caddy/caddy_<Body>_<Secondary>_<Drawer>_<front|back>.png` (36 files, 640x640; `caddyImage`, preloaded by `caddyPreload`); a missing picture shows "Photo unavailable" and the summary line still works. Order screen: details text and the Fulfilment fold show the summary.

## Pre-order step 1: name and email

A design with Pre-order shows `renderPreorderGate` (Step 1: name and email) in place of the version/edition pickers and Request button until `preorderLeadOk()` (valid email + name, and the device's localStorage `soloprint_preorder_lead` matches that email). `requestGalleryItem` and `pickGalleryForItem` send them to the gate instead. `preorderContinue` saves the lead immediately (`saveLead` -> RPC `save_request_draft`, so it needs supabase/drafts.sql; data `{ items, lead: { designs, at } }`, kept by later draft saves via `leadForDraft`), without the 3 second draft delay; if the save fails it is retried on the next page load (`pending`). Owner: Designs page "People interested" (`renderPreorderLeads`, reads request_drafts with the owner login, hides emails that already have an order, "Copy all emails"). Code.gs `draftReminderEmails` skips drafts with no items, so a pure lead gets no automatic email; the owner follows up.

## Saved notes (Help > My notes)

`SEEDED_NOTES` (features.js, end) are notes the owner asked to keep: `seedWikiNotes` adds each once to owner_private `wiki` (`seeded` ids remembered, so a deleted note doesn't come back). Currently the Catheter Caddy product description.

## Combine-shipping pop-up

When a customer adds their first item from the store (`requestGalleryItem` -> `showShipCombine`, features.js) a pop-up says shipping can be combined on more than one item: once per visit, "Don't show this again" kept on the device (`soloprint_shipnote_off`), owner wording in Settings > Wording & FAQ (site text `shipCombineTitle`/`shipCombineText`), switch `shipCombine` in Settings > Show / hide. Never shown in owner mode. The tests' `open()` turns it off by default.

## Custom color delay note

Site text `colorDelayNote` (default `DEFAULT_COLOR_DELAY_NOTE`, shared; `colorDelayText(settings)` reads the owner's live override): custom colors can mean ordering more material first, which can delay starting. Shown as `.color-delay-note` (`colorDelayNote()`) on the request form's color area, design pages (`renderWorkPrice`), unfinished customer order cards (`renderCustomerOrderExtras`), and added to the `{materialNote}` email variable (Code.gs and the site's previews).

## Preview mode (owner)

Owner menu "Preview" (`renderPreviewPage`; bar `renderPreviewBar` on every page while on; features.js, end): a private copy of the site's settings and designs in `owner_private` key `preview` ({ settings, base, gallery (gallery_items rows), baseGallery, startedAt }). `previewActive()` (= owner logged in + device flag `soloprint-preview-on` + a saved preview) makes `loadSettings`/`loadGallery` show the preview (`applyPreview`), `saveSettings` and `writeGalleryItem` (via `galleryRowOf`)/`deleteGalleryItem` write to it instead of the live tables, and `syncTopWork` stand down. The customer view as owner shows the preview too; real customers, orders, emails and Code.gs never see it. `pushPreviewLive` confirms with the list from `previewChanges()`, then writes only what differs from `base`/`baseGallery` (settings per top-level key on top of the latest live settings via `saveSettings(pv.settings, pv.base)`, changed or new designs, removed designs) and clears the preview. `startPreview`, `exitPreview` (keeps changes), `discardPreview`. Any new site-wide setting or design field must be written through `saveSettings`/`writeGalleryItem` to be previewable.

## Send an email now

Order screen fold "Send an email now" (`renderSendEmailFold`, `MANUAL_EMAILS`, `askSendEmail`, `sendManualEmail` in features.js): the owner previews the exact email and confirms; the site saves
`manualEmail { key, at }` (+ `manualEmails` log) on the order and Code.gs `emailsFor` sends that one email when `manualEmail.at` is new (keys in `MANUAL_EMAIL_KEYS`, keep both lists in step).
A manual review request / quote reminder also sets `reviewRequestedAt` / `reminderSentAt` so the daily job doesn't repeat it. The pop-up's subject and text are editable: if the owner changes them, `manualEmail` also carries `subject`/`body` and Code.gs sends exactly that (else it fills the template itself).

## Data

- `jobs` (id, data jsonb): orders. Owner-only table; customers use RPCs `submit_job` (returns the new order's key), `customer_orders(keys)`,
  `customer_approve_quote`, `submit_review` (up to 2 review photos: customers upload into the gallery bucket's `reviews/` folder, allowed for anon by a storage policy in owner-tools.sql; `customer_reviews.photos`, copied to the site review on approval). Anything in an order's data is visible to that customer, so
  private owner data goes in `owner_private` (keys: `notes`, `inventory`, `money`).
- Private order links (supabase/order-links.sql): each order has a 12-character random key (`jobs.access_token`, alphabet without look-alikes,
  never changed; a trigger also copies it into the order's data as `accessToken`; earlier long keys are kept in `old_access_token` and still open).
  Emails link to `/?o=<key>` (Code.gs `orderLink`; site `orderLinkFor`; `&review=1` opens the review form); the site keeps the keys it has seen in
  localStorage (`state.tokens`, `addOrderKey`) and removes the key from the address bar. Customers see, approve, message and review only with a key;
  an email address alone opens nothing. Lost links: "Email me my links" (`request_order_links` -> `LINKS` webhook -> Code.gs `linksEmail`; same answer
  for every address; one email per address per hour). Old `?requests=email` links open nothing and offer that form.
  Never put a customer's email in a URL, and never add a customer function that takes an email as proof.
- Emails to the owner link to `/?admin=<order number>` (Code.gs `ownerLink`; site `handleOwnerLink`/`showPendingOwnerOrder`): it opens owner mode and,
  after the normal password login, the order. It grants nothing by itself.
- "Looks good" confirms the order: `customer_approve_quote` also moves it to order_received (which emails the deposit request) unless the owner switched off
  `features.autoDeposit` (Settings > Show or hide). The Practice tab mirrors this (`practiceApprove`).
- Every owner step that emails the customer (Send quote `approveBatch`, and each order step via `askMail(id, code, key)`) first shows that exact email, editable, in `emailPopup` (features.js), built by `stepEmailPreview` from a copy of the order with the step applied (`stepPreviewOrder`; place-in-line text is the shared `queueNoteText`). A changed email is saved as `emailEdits { at, list: { key: { subject, body } } }` with the step (`quietIfUnticked`), and Code.gs `emailsFor`'s `send` uses that text when `emailEdits.at` is new in the save. The pop-up (`askMail` in app.js: "Send email and continue" / "Don't send email, continue" / Cancel; it sets a hidden `step-mail-<id>` box that the step reads): not sending saves `quietEmails: { at, keys }` (keys = email names: confirmed, deposit, payment, final_payment_needed, delivered, ...) with that change; Code.gs `emailsFor` skips those customer emails only when `quietEmails.at` is new in that save. Go back a step and Handed over never email.
- Payment receipts say how much was paid: marking Deposit Received or Payment Received asks for the amount first (`askPaymentAmount`; saved as
  `depositAmount` / `balancePaid`); Code.gs `emailsFor` sends the receipt only when that amount is on the order (else it emails the owner a notice).
- `site_settings` (id=1, data jsonb): public read, owner write. Holds about, links, colors, reviews,
  `emails` (edited email text), colors may have `photo` (real-life picture, `swatchHtml`), `vacation`, `rules`, `materialNote`, `howItWorks`, `designTerms`, `galleryNote`, `topWork`
  (best-selling gallery ids for the home page, recomputed by `syncTopWork` when the owner dashboard loads).
  `siteText` ({key: {text, live}}, keys and defaults in `SITE_TEXT` in features.js; use `t(key)` for any customer-facing
  text the owner might want to change, including step names), `faq` ([{id, q, a, live}]), `features` ({key: false} for
  switched-off parts, `featureOn(key)`; Code.gs `featureOff`). Drafts (not live) show only to the owner with `previewDrafts` on. Cleaned by
  `cleanSettings` in app.js; add new fields there or they're dropped on save.
- Order queue: `order_queue()` (supabase/queue.sql) lists confirmed/printing orders as { at, printing, custom } only, `at` =
  `queueTime` (deposit or full-payment time; null = waiting for a deposit, last in line; deposit % is rule `depositPercent`, default 75 so later price rises rarely need a second deposit);
  `queueEstimate` in email-templates.js turns it into orders ahead and days (rules printDaysMin/Max, customDesignDays).
- `order_messages` (supabase/messages.sql): one conversation per order (`sender` owner/customer, `via` site/email/auto). Owner reads/writes the table;
  customers use `customer_messages(key)`/`customer_send_message(key, body)`; site messages fire a `MESSAGE` webhook (Code.gs `messageEmail`); Code.gs logs its emails
  (`logSentEmails`) and `collectReplies` (every 5 min, `REPLY_CHECK_MINUTES`; `scheduleReplies` resets the trigger from `healthCheck`; needs Loader v2+ for Gmail) records Gmail replies via secret RPC `record_messages`. Site: messages section of features.js.
  Links: any web address in page text becomes a link (`linkifyPage`, run by a MutationObserver in features.js); every email is sent with an
  `htmlBody` (Code.gs `mail`/`emailHtml`) so links work in all mail apps. `{detailsItems}` = full breakdown with prices or estimates and total
  (site `detailsBreakdown`, Code.gs `emailVars`); the "printing done" email uses `{total}`, `{deposit}` (typed on the order after it's paid, `setDepositAmount`), `{remainder}` = total − deposit + rule `shippingFee` (a shipping DEPOSIT, always called that to customers: $15 = rule `packagingFee` $1 + postage; the unused part is refunded; `finalPayment`, `postageRefund`) and `{remainderLink}`; the Shipped email adds `{invoiceSummary}`, `{refundNote}` from the owner's typed `postageCost` (saving tracking on Ready to Ship ships the order, `saveDeliveryInfo`); placeholders match in any capitals. Message text goes through `linkifyText` (links tappable); `.autogrow` boxes grow to fit (`growMessageBoxes` after render). The owner's first message on an
  order starts from site text `firstReply` (`ownerMessageDraft`). "Edit their request" in the conversation (before the quote) opens the edit form beside it (`.chat-edit`).
  Client notes (Clients page) live in `owner_private` key `clients`, never in orders.
- Practice tab (owner, `renderPracticePage` in features.js): a pretend order in `state.practice` only, never saved or emailed; its emails are
  rendered from the real templates into the chat by `practiceChange` (mirrors Code.gs `emailsFor`; keep in step). A test checks it makes no writes.
  Conversations are text-message style (`renderThread`); the step bar (`renderTrackerSteps`) sits above them.
- `request_drafts`: unsent requests (one per email), saved through `save_request_draft` once an email is typed,
  reopened by `?resume=<id>` (`get_request_draft`), cleared on submit.
- Script-only RPCs need the shared secret (`private.email_settings`): `backup_export`, `due_quote_reminders`,
  `due_review_requests`, `due_draft_reminders`, `owner_report_data`.
- Order fields worth knowing: `phase` (estimate → details_check ("Confirming Details" is part of the Reviewing step, not its own step in the dropdown or tracker; optional: `detailsQuestions`, `detailsEmail` {subject, body} the owner approved, sent as is by Code.gs; `renderDetailsCheck` in features.js; `beforeQuote(phase)` covers both pre-quote phases) → quote_sent → order_received → order_received ("Confirmed & Printing"; old `production` orders are read as this in `cleanBatch`, stock is taken when printing is done) → final_payment_needed → ready_to_ship (paid; the owner enters carrier + tracking in `deliveryTracking`) → delivered (labelled "Shipped"; its email carries `{delivery}`)),
  `paymentStatus` (unpaid → payment_requested → deposit_received (optional; sets `depositAt`, `depositAmount`) → payment_recieved, spelling is historical), `rates` (prices
  saved when the quote was sent), `designTerms` (custom design terms text the customer must agree to before approving), `specialOrderCost`, `extraCharges` ([{label, amount}], the owner's added charges; customers see label and amount), `ownerEditedAt`, `finishedPhotos`, `stockTaken`, `paidAt`. The owner edits a request in the estimate phase with "Edit request" (`renderOwnerEditForm` in features.js); `submit_job` strips owner-only fields.
- Extra colors charge: a print with more different colors than rule `freeColors` (2) costs rule `colorFee` ($2) more per print (`colorCount`, `colorCharge`, `addOnCharge` in email-templates.js, added in `printPrice` like the logo; never on top of `ownerPrice`). Both are in `RATE_KEYS`, so quotes keep them; quotes saved before the charge existed get `colorFee: 0` (`orderRules`). Customers see `colorFeeNote` (site text `colorFeeNote`) where they pick extra colors or part colors; it's explained as extra color changes and work, never as a privilege.
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
