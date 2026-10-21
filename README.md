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
- **Link previews:** `og-image.png` is the picture shown when the site's link is texted or shared.
