require('dotenv').config();

const express = require('express');
const path = require('path');
const store = require('./store');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

// The Meta Pixel ID is not a secret - it ships to every browser that loads the
// site - but it does differ per environment, so it comes from the environment
// rather than being hardcoded into the static HTML.
const RAW_PIXEL_ID = String(process.env.META_PIXEL_ID || '').trim();
// Pixel IDs are numeric. Rejecting anything else keeps a mistyped env var from
// becoming a script-injection vector when it is interpolated into /config.js.
const META_PIXEL_ID = /^\d{6,20}$/.test(RAW_PIXEL_ID) ? RAW_PIXEL_ID : '';
if (RAW_PIXEL_ID && !META_PIXEL_ID) {
  console.warn('[meta] META_PIXEL_ID is not a numeric pixel ID - the pixel is disabled');
}

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  etag: true
}));

const PRODUCTS = {
  reserve: { name: 'The Reserve', price: 14900, deposit: 1000 },
  contract: { name: 'The Contract', price: 12900, deposit: 1000 },
  executive: { name: 'The Executive', price: 15900, deposit: 1000 },
  night: { name: 'The Night', price: 13900, deposit: 1000 }
};

function clean(value, max = 160) {
  return String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function context(req) {
  const body = req.body || {};
  return {
    product: clean(body.product, 40),
    source: clean(body.source, 80),
    medium: clean(body.medium, 80),
    campaign: clean(body.campaign, 120),
    content: clean(body.content, 120),
    referrer: clean(body.referrer, 300),
    path: clean(body.path, 200),
    userAgent: clean(req.get('user-agent'), 260)
  };
}

app.post('/api/event', async (req, res) => {
  const event = clean(req.body.event, 50);
  const allowed = new Set(['page_view', 'view_product', 'reserve_click', 'waitlist_open', 'waitlist_submit']);
  if (!allowed.has(event)) return res.status(400).json({ ok: false });
  try {
    await store.recordEvent({ event, ...context(req) });
    res.json({ ok: true });
  } catch (error) {
    console.error('[store] event write failed', error);
    res.status(500).json({ ok: false });
  }
});

app.post('/api/waitlist', async (req, res) => {
  const email = clean(req.body.email, 180).toLowerCase();
  const zip = clean(req.body.zip, 12);
  const product = clean(req.body.product, 40);
  if (!validEmail(email)) return res.status(400).json({ ok: false, message: 'Enter a valid email address.' });
  if (product && !PRODUCTS[product]) return res.status(400).json({ ok: false, message: 'Unknown collection.' });

  try {
    await store.recordLead({
      email,
      zip,
      product: product || 'general',
      intent: clean(req.body.intent, 40) || 'waitlist',
      ...context(req)
    });
    await store.recordEvent({ event: 'waitlist_submit', product: product || 'general', ...context(req) });
    res.json({ ok: true, message: "You're on the private launch list." });
  } catch (error) {
    console.error('[store] lead write failed', error);
    res.status(500).json({ ok: false, message: 'We could not save that. Please try again.' });
  }
});

app.post('/api/reserve', async (req, res) => {
  const productKey = clean(req.body.product, 40);
  const product = PRODUCTS[productKey];
  const email = clean(req.body.email, 180).toLowerCase();
  const zip = clean(req.body.zip, 12);

  if (!product) return res.status(400).json({ ok: false, message: 'Unknown collection.' });
  if (!validEmail(email)) return res.status(400).json({ ok: false, message: 'Enter a valid email address.' });

  const reservation = {
    email,
    zip,
    product: productKey,
    amount: product.deposit,
    currency: 'usd',
    status: stripe ? 'checkout_created' : 'intent_only',
    ...context(req)
  };

  try {
    await store.recordReservation(reservation);
    await store.recordEvent({ event: 'reserve_click', product: productKey, ...context(req) });
  } catch (error) {
    console.error('[store] reservation write failed', error);
    return res.status(500).json({ ok: false, message: 'We could not save that. Please try again.' });
  }

  if (!stripe) {
    return res.json({
      ok: true,
      mode: 'intent_only',
      message: `Your interest in ${product.name} has been recorded. No charge was made.`
    });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: product.deposit,
          product_data: {
            name: `${product.name} — refundable launch reservation`,
            description: `Holds priority access to the BLKBX private launch. Target retail $${(product.price / 100).toFixed(0)}.`
          }
        },
        quantity: 1
      }],
      metadata: { product: productKey, zip },
      success_url: `${BASE_URL}/?reserved=${productKey}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/?cancelled=${productKey}`
    });
    res.json({ ok: true, mode: 'stripe', url: session.url });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, message: 'Checkout could not be started. Please join the launch list instead.' });
  }
});

app.get('/api/metrics', async (req, res) => {
  const token = clean(req.query.token, 300);
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) return res.status(401).json({ ok: false });

  try {
    const metrics = await store.metrics(Object.keys(PRODUCTS));
    res.json({ ok: true, storage: store.name, ...metrics });
  } catch (error) {
    console.error('[store] metrics read failed', error);
    res.status(500).json({ ok: false });
  }
});

// Public runtime configuration for the browser. Must stay ahead of the catch-all
// route below, which would otherwise answer with index.html.
app.get('/config.js', (_req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'public, max-age=300');
  res.send(`window.BLKBX_CONFIG=${JSON.stringify({ metaPixelId: META_PIXEL_ID })};`);
});

let storageReady = false;

app.get('/health', (_req, res) => res.json({
  ok: true,
  service: 'blkbx-fake-door',
  storage: store.name,
  storageReady,
  // Whether the metrics secret reached this runtime at all - never its value.
  // Without this, a missing ADMIN_TOKEN and a mistyped one both look like 401.
  adminTokenSet: Boolean(process.env.ADMIN_TOKEN),
  adminTokenLength: process.env.ADMIN_TOKEN ? process.env.ADMIN_TOKEN.length : 0,
  // A silently disabled pixel means an ad spend with no measurable conversions,
  // so surface it the same way as storage.
  metaPixel: META_PIXEL_ID ? 'enabled' : 'disabled'
}));

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Start the listener either way: a storage outage should not take the site
// down, but it must be visible at /health rather than silently losing signups.
store.init().then(() => {
  storageReady = true;
}).catch(error => {
  console.error(`[store] ${store.name} init FAILED - the site is up but recording nothing`, error);
}).finally(() => {
  app.listen(PORT, () => {
    console.log(`BLKBX listening on ${PORT}`);
    console.log(`Storage: ${store.name}${storageReady ? '' : ' (UNAVAILABLE)'}`);
    console.log(`Payment mode: ${stripe ? 'Stripe enabled' : 'intent-only'}`);
  });
});
