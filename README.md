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

## View experiment metrics

Set a long random value for `ADMIN_TOKEN`, then visit:

```text
https://blkbx.co/api/metrics?token=YOUR_ADMIN_TOKEN
```

It returns totals and per-product counts. Keep this URL private.

## Data storage

For the 30-day MVP, events are stored as JSON Lines under `data/`:

- `events.jsonl`
- `leads.jsonl`
- `reservations.jsonl`

This intentionally avoids a database/native Node modules and makes GoDaddy deployment simpler. Back up the `data/` directory during the test. For a longer-lived production app, move this to Postgres or another managed database.

## Suggested 30-day decision rule

Do not optimize only for email signups. The strongest signal is paid reservation behavior. Compare products on:

`product views -> reservation clicks -> paid reservations`

Use UTMs on every ad so the app can distinguish creative/campaign performance.

Example:

```text
https://blkbx.co/?utm_source=instagram&utm_medium=paid&utm_campaign=launch-test&utm_content=contract-a
```
