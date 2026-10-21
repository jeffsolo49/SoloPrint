# SoloPrint order emails

Order emails are sent from your own Gmail by a small Google Apps Script (`Code.gs`).
Supabase calls it automatically whenever an order is created or changes, so the website itself
never sends email and there are no email keys in the page.

| When | Who gets it |
| --- | --- |
| New request submitted | You, plus a "we got your request" email to the customer (or their quote, if every item matched a saved model) |
| You send a quote | Customer, with item prices and total |
| Customer taps "Looks good" | You |
| You confirm the order | Customer, with a prefilled Venmo payment link |
| Printing starts | Customer |
| Delivered, or delivery details saved | Customer |
| You mark payment received | Customer |

Gmail allows about 100 recipients a day on a personal account.

## Setup (about 10 minutes)

Do this after running `supabase/security.sql`.

1. **Make a secret.** Use a password generator to make a random string of 30+ letters and numbers.
   It stops anyone else from triggering emails through your script. Don't commit it to the repo.
2. **Create the script.** Go to <https://script.google.com>, signed in as jeffsolo49@gmail.com, and
   click **New project**. Name it "SoloPrint emails", delete the sample code, and paste in all of `Code.gs`.
   At the top, set `SECRET` to your secret and `SITE_URL` to your site's address. Click **Save**.
3. **Allow Gmail access.** In the toolbar, pick `sendTestEmail` from the function menu and click **Run**.
   Google asks for permission. Because this is your own script, it shows "Google hasn't verified this app";
   click **Advanced**, then **Go to SoloPrint emails**, then **Allow**. You should get a test email.
4. **Publish it.** Click **Deploy → New deployment**, choose the gear icon → **Web app**, set
   **Execute as: Me** and **Who has access: Anyone**, then **Deploy**. Copy the **Web app URL**.
   ("Anyone" is required so Supabase can reach it; the secret keeps everyone else out.)
5. **Connect Supabase.** In Supabase → SQL Editor → New query, paste `supabase/email-trigger.sql`,
   replace `PASTE-WEB-APP-URL-HERE` with the Web app URL and `PASTE-YOUR-SECRET-HERE` with your secret,
   then **Run**.
6. **Try it.** Submit a request on the site using your own email address. You should get both the owner
   and customer emails within a minute.

## If an email doesn't arrive

- **Apps Script → Executions** lists every call. A `forbidden` result means the secrets don't match.
- In the Supabase SQL Editor, `select status_code, content, created from net._http_response order by created desc limit 10;`
  shows what Supabase got back from the script.
- Check Gmail's **Sent** folder: emails go out from your account, so they show up there.

## Changing the emails later

Edit `Code.gs` in the Apps Script editor, save, then **Deploy → Manage deployments → ✏️ Edit →
Version: New version → Deploy**. The Web app URL stays the same, so Supabase needs no changes.

## Print time and grams from model links

The same script also looks up MakerWorld and Printables links, so the request form can pre-fill
print time and filament weight. The customer can edit the numbers, they're labeled as automated
estimates, and you see where they came from on each order. Thingiverse has no such data.

After pasting the new `Code.gs` (put your secret back on line 5), deploy a new version, then:

1. Pick `testLookup` in the function menu and click **Run**. Google asks for one more permission
   ("connect to an external service"); allow it the same way as before.
2. Open **Execution log**. Each test link should show `"ok":true` with `minutes` and `grams`.
   If something says `false` or `ERROR`, paste the log into your chat with Claude.

### Optional: MakerWorld login

Only needed if `testLookup` shows MakerWorld returning 401 or 403. Use a separate free MakerWorld
account rather than the one your printers use.

1. Apps Script → **Project Settings** (gear) → **Script properties** → add `MW_EMAIL` and `MW_PASSWORD`.
2. Run `connectMakerWorld`. If the log says a code was emailed, add it as `MW_CODE` and run it again.
3. The log says "Connected" when it worked; your password is then removed from the script properties.
   The login lasts about 3 months. When lookups stop working, add `MW_PASSWORD` again and rerun.
