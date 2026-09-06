# BLKBX 30-Day Fake Door

A production-ready Node.js/Express landing site for **blkbx.co** designed to validate demand before manufacturing inventory.

## What it measures

- Page views
- Product-detail views
- Waitlist submissions
- $10 reservation intent by product
- UTM source / medium / campaign / content
- Referrer

The four launch concepts are included as local image assets:

- The Reserve — $149 target retail
- The Contract — $129 target retail
- The Executive — $159 target retail
- The Night — $139 target retail

## Run locally

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3000`.

## Stripe (optional, recommended for the strongest validation)

Without Stripe, clicking **Reserve for $10** records a reservation intent and tells the visitor no charge was made.

To take a real refundable $10 launch reservation, add your Stripe secret key to `.env`:

```text
STRIPE_SECRET_KEY=sk_live_...
BASE_URL=https://blkbx.co
```

The app then sends the visitor to Stripe Checkout. The $10 is a reservation payment; refunds are handled in Stripe. Before accepting payments, add your final refund/privacy/terms language and make sure your business/payment setup is appropriate for your use case.

**The Reserve:** during this validation phase the site explicitly states that no alcohol is sold or shipped. Alcohol fulfillment should not be enabled until licensing/fulfillment requirements are handled.

## GoDaddy deployment

GoDaddy plans vary. You need a plan that supports **Node.js applications** (often through cPanel's "Setup Node.js App" / Passenger). If your specific hosting plan is static/PHP-only, deploy this Node app to a Node host and point `blkbx.co` DNS to it.

Typical cPanel flow:

1. Upload the project to a folder such as `~/blkbx`.
2. In **Setup Node.js App**, create an application using Node 18+.
3. Set the application root to the uploaded folder.
4. Set startup file to `server.js`.
5. Add environment variables from `.env.example` in the cPanel UI.
6. Run `npm install` from the Node app interface or terminal.
7. Restart the application.
8. Attach `blkbx.co` to the app and verify HTTPS is active.
9. Visit `/health` and confirm it returns `{ "ok": true, ... }`.

### GoDaddy/Passenger note

The server uses `process.env.PORT`, which is compatible with managed Node environments that inject a port. Do not hardcode port 80/443.

## Meta Pixel

Set your numeric pixel ID from Events Manager and restart:

```text
META_PIXEL_ID=123456789012345
```

Leave it unset and the pixel is disabled entirely, which is the default for local
development. `/health` reports `"metaPixel": "enabled"` or `"disabled"` so a
silently untracked ad campaign is visible without opening the browser.

The ID is served to the browser by `/config.js` rather than hardcoded in
`index.html`, so the same build can point at a test pixel locally and the real
one in production.

### Event mapping

Meta standard events are fired alongside the site's own `/api/event` records:

| Site action | Meta event | Value |
| --- | --- | --- |
| Page load | `PageView` | — |
| Product modal opened | `ViewContent` | target retail ($129–$159) |
| Waitlist modal opened | `WaitlistOpen` (custom) | — |
| Reserve modal opened | `InitiateCheckout` | $10 |
| Waitlist submitted | `Lead` | — |
| Returned from Stripe with `?reserved=` | `Purchase` | $10 |

`ViewContent` is valued at target retail because that is what the ad creative
sells; `InitiateCheckout` and `Purchase` carry the $10 deposit, which is the
money that actually moves. `Lead` is deliberately unvalued — pricing a waitlist
signup would corrupt any ROAS comparison against real reservations.

`Purchase` sends the Stripe Checkout session id as the Meta `eventID`, so a
refresh, a back-navigation, or a shared success URL cannot inflate the count the
go/no-go decision rests on.

### Known gaps

- **No `<noscript>` fallback.** The standard Meta snippet includes a tracking
  pixel image for visitors without JavaScript. It needs the ID inlined in HTML,
  which the environment-driven setup cannot do. No real signal is lost: every
  conversion on this site runs through JavaScript modals anyway.
- **Browser-only.** Ad blockers and iOS App Tracking Transparency typically
  suppress 10–30% of browser events. The Conversions API would recover those by
  also sending from `server.js`, which already records every one of these
  actions. Worth adding before scaling spend.
- **No consent banner.** The pixel fires immediately for every visitor. That is
  a deliberate choice for a US-targeted test; restrict ad targeting to the US, or
  add consent gating before running EU/UK traffic.

## View experiment metrics

Set a long random value for `ADMIN_TOKEN`, then visit:

```text
https://blkbx.co/api/metrics?token=YOUR_ADMIN_TOKEN
```

It returns totals and per-product counts. Keep this URL private.

## Data storage

The app picks its backend from the environment at startup, via `store.js`:

| Backend | When it is used | Durable? |
| --- | --- | --- |
| MySQL | `DB_HOST` (or `DATABASE_URL`) is set | Yes |
| JSON Lines under `data/` | neither is set | **No** on managed hosts |

`/health` reports which one is active and whether it connected:

```json
{ "ok": true, "service": "blkbx-fake-door", "storage": "mysql", "storageReady": true }
```

If `storageReady` is `false`, the site is serving pages but **recording nothing** — check the app logs.

### Why the database is required in production

GoDaddy Node.js Hosting replaces the application directory on every deployment. Anything written to `data/` is destroyed by the next deploy, silently. Their docs suggest `/public/assets/` for files that must persist — **do not put leads there**: that directory is served publicly by `express.static`, so the waitlist would be downloadable at `https://blkbx.co/assets/leads.jsonl` by anyone.

Use the provisioned MySQL instance instead. Nothing needs to be configured: when the hosted database is attached, GoDaddy injects `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` and `DB_PASSWORD` into both runtimes automatically, and `store.js` reads those names directly. The tables (`events`, `leads`, `reservations`) are created on first boot.

`ADMIN_TOKEN` is the one secret you must still add yourself, under **Settings -> Secrets**, or `/api/metrics` stays locked at 401.

Note that the preview and published environments share one database, so test traffic against a preview URL lands in the same tables as live traffic. Use a recognizable test email so you can exclude those rows later.

The JSON Lines path remains the default for local development, so `npm start` works with no database running.

## Suggested 30-day decision rule

Do not optimize only for email signups. The strongest signal is paid reservation behavior. Compare products on:

`product views -> reservation clicks -> paid reservations`

Use UTMs on every ad so the app can distinguish creative/campaign performance.

Example:

```text
https://blkbx.co/?utm_source=instagram&utm_medium=paid&utm_campaign=launch-test&utm_content=contract-a
```
