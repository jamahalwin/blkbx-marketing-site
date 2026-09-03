require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA_DIR = path.join(__dirname, 'data');
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

fs.mkdirSync(DATA_DIR, { recursive: true });

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

function record(file, payload) {
  const line = JSON.stringify({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    ...payload
  }) + '\n';
  fs.appendFileSync(path.join(DATA_DIR, file), line, 'utf8');
}

function readJsonl(file) {
  const filename = path.join(DATA_DIR, file);
  if (!fs.existsSync(filename)) return [];
  return fs.readFileSync(filename, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
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

app.post('/api/event', (req, res) => {
  const event = clean(req.body.event, 50);
  const allowed = new Set(['page_view', 'view_product', 'reserve_click', 'waitlist_open', 'waitlist_submit']);
  if (!allowed.has(event)) return res.status(400).json({ ok: false });
  record('events.jsonl', { event, ...context(req) });
  res.json({ ok: true });
});

app.post('/api/waitlist', (req, res) => {
  const email = clean(req.body.email, 180).toLowerCase();
  const zip = clean(req.body.zip, 12);
  const product = clean(req.body.product, 40);
  if (!validEmail(email)) return res.status(400).json({ ok: false, message: 'Enter a valid email address.' });
  if (product && !PRODUCTS[product]) return res.status(400).json({ ok: false, message: 'Unknown collection.' });

  record('leads.jsonl', {
    email,
    zip,
    product: product || 'general',
    intent: clean(req.body.intent, 40) || 'waitlist',
    ...context(req)
  });
  record('events.jsonl', { event: 'waitlist_submit', product: product || 'general', ...context(req) });
  res.json({ ok: true, message: "You're on the private launch list." });
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

  record('reservations.jsonl', reservation);
  record('events.jsonl', { event: 'reserve_click', product: productKey, ...context(req) });

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

app.get('/api/metrics', (req, res) => {
  const token = clean(req.query.token, 300);
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) return res.status(401).json({ ok: false });

  const events = readJsonl('events.jsonl');
  const leads = readJsonl('leads.jsonl');
  const reservations = readJsonl('reservations.jsonl');
  const byProduct = {};
  for (const key of Object.keys(PRODUCTS)) {
    byProduct[key] = { views: 0, reserveClicks: 0, leads: 0, reservations: 0 };
  }
  for (const e of events) {
    if (!byProduct[e.product]) continue;
    if (e.event === 'view_product') byProduct[e.product].views += 1;
    if (e.event === 'reserve_click') byProduct[e.product].reserveClicks += 1;
  }
  for (const l of leads) if (byProduct[l.product]) byProduct[l.product].leads += 1;
  for (const r of reservations) if (byProduct[r.product]) byProduct[r.product].reservations += 1;

  res.json({
    ok: true,
    startedAt: events[0]?.at || null,
    totals: {
      pageViews: events.filter(e => e.event === 'page_view').length,
      productViews: events.filter(e => e.event === 'view_product').length,
      leads: leads.length,
      reservationIntents: reservations.length
    },
    byProduct
  });
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'blkbx-fake-door' }));

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`BLKBX listening on ${PORT}`);
  console.log(`Payment mode: ${stripe ? 'Stripe enabled' : 'intent-only'}`);
});
