const PRODUCTS = {
  reserve: {
    name: 'The Reserve', price: '$149', tag: 'For moments worth opening.',
    occasion: 'CELEBRATION · ANNIVERSARY · CLIENT', image: '/assets/the-reserve.png',
    description: 'A ceremonial wine presentation built around the reveal: premium bottle, black wine tools, personal message, and precision-cut black EVA foam.',
    contents: ['Premium wine selection', 'Black corkscrew', 'Black + silver bottle stopper', 'Personalized message card']
  },
  contract: {
    name: 'The Contract', price: '$129', tag: 'An agreement is only as strong as its signature.',
    occasion: 'COUPLES · ROMANCE · NOVELTY', image: '/assets/the-contract.png',
    description: 'A playful, provocative couples gift with two engraved pens and a formal presentation folder built around the ritual of signing.',
    contents: ['“Dominant” engraved black pen', '“Submissive” engraved black pen', 'Black presentation folio', 'Personalized printed contract']
  },
  executive: {
    name: 'The Executive', price: '$159', tag: 'For the next chapter.',
    occasion: 'PROMOTION · CLOSING · CLIENT', image: '/assets/the-executive.png',
    description: 'A restrained professional set for promotions, deal closings, graduations, new ventures, and client appreciation.',
    contents: ['Premium black metal pen', 'Black notebook', 'Black card holder', 'Personalized initials + message']
  },
  night: {
    name: 'The Night', price: '$139', tag: 'Everything else can wait.',
    occasion: 'DATE NIGHT · ANNIVERSARY · ROMANCE', image: '/assets/the-night.png',
    description: 'A sensory date-night presentation that turns the box itself into the beginning of the evening.',
    contents: ['Premium black candle', 'Dark chocolate collection', 'Two glass tumblers', 'Personalized message card']
  }
};

const qs = new URLSearchParams(location.search);
const attribution = {
  source: qs.get('utm_source') || '', medium: qs.get('utm_medium') || '', campaign: qs.get('utm_campaign') || '',
  content: qs.get('utm_content') || '', referrer: document.referrer, path: location.pathname + location.search
};

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...attribution, ...body }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Something went wrong.');
  return data;
}
function event(name, product='') { post('/api/event', { event: name, product }).catch(() => {}); }

// Meta Pixel. These are installed by /pixel.js and are no-ops when no pixel is
// configured, so every call site below is safe without a guard.
const track = (name, params, options) => (window.metaTrack || (() => {}))(name, params, options);
const trackCustom = (name, params) => (window.metaTrackCustom || (() => {}))(name, params);
// PRODUCTS stores price as the display string, so derive the number from it
// rather than storing the same figure twice and letting the two drift apart.
const priceValue = key => Number(String(PRODUCTS[key]?.price || '').replace(/[^0-9.]/g, '')) || 0;
// The refundable reservation deposit in dollars, mirroring PRODUCTS[*].deposit
// on the server.
const DEPOSIT = 10;

event('page_view');
document.getElementById('year').textContent = new Date().getFullYear();

const productModal = document.getElementById('productModal');
const leadModal = document.getElementById('leadModal');
let currentProduct = '';

function setOpen(modal, open) {
  modal.classList.toggle('open', open); modal.setAttribute('aria-hidden', String(!open));
  document.body.style.overflow = open ? 'hidden' : '';
}
function openProduct(key) {
  const p = PRODUCTS[key]; if (!p) return; currentProduct = key;
  document.getElementById('productImage').src = p.image;
  document.getElementById('productImage').alt = `${p.name} BLKBX concept`;
  document.getElementById('productOccasion').textContent = p.occasion;
  document.getElementById('productTitle').textContent = p.name;
  document.getElementById('productTag').textContent = p.tag;
  document.getElementById('productDescription').textContent = p.description;
  document.getElementById('productPrice').textContent = p.price;
  document.getElementById('productContents').innerHTML = p.contents.map(x => `<li>${x}</li>`).join('');
  setOpen(productModal, true); event('view_product', key);
  // Valued at target retail, not the $10 deposit: this measures interest in the
  // product, which is what the ad creative is selling.
  track('ViewContent', {
    content_ids: [key], content_type: 'product', content_name: p.name,
    content_category: p.occasion, value: priceValue(key), currency: 'USD'
  });
}
function openLead(product='', reserve=false) {
  setOpen(productModal, false); currentProduct = product;
  document.getElementById('leadProduct').value = product;
  document.getElementById('leadTitle').textContent = reserve ? `Reserve ${PRODUCTS[product]?.name || 'your BLKBX'}.` : 'Request first access.';
  document.getElementById('leadIntro').textContent = reserve ? 'Enter your email to continue to the $10 refundable launch reservation.' : 'Get launch access, founding-customer pricing, and first choice of the collection.';
  document.getElementById('leadSubmit').textContent = reserve ? 'Continue to reservation' : 'Join private launch';
  document.getElementById('leadForm').dataset.reserve = reserve ? '1' : '0';
  document.getElementById('leadStatus').textContent = '';
  setOpen(leadModal, true); event('waitlist_open', product);
  if (reserve) {
    // Fired as the reservation modal opens rather than on submit, because the
    // submit handler redirects straight to Stripe and the navigation can cut
    // the beacon off before it is sent.
    track('InitiateCheckout', {
      content_ids: product ? [product] : [], content_type: 'product',
      content_name: PRODUCTS[product]?.name || '', num_items: 1,
      value: DEPOSIT, currency: 'USD'
    });
  } else {
    // Not a Meta standard event - kept custom so it can be read as a funnel
    // step without being mistaken for a conversion.
    trackCustom('WaitlistOpen', { content_ids: product ? [product] : [] });
  }
}

document.querySelectorAll('[data-view-product]').forEach(el => el.addEventListener('click', () => openProduct(el.dataset.viewProduct)));
document.querySelectorAll('.product-card .image-button').forEach(el => el.addEventListener('click', () => openProduct(el.closest('.product-card').dataset.product)));
document.querySelectorAll('[data-open-waitlist]').forEach(el => el.addEventListener('click', () => openLead('', false)));
document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => { setOpen(productModal,false); setOpen(leadModal,false); }));
document.addEventListener('keydown', e => { if (e.key === 'Escape') { setOpen(productModal,false); setOpen(leadModal,false); } });
document.getElementById('reserveButton').addEventListener('click', () => openLead(currentProduct, true));

document.getElementById('leadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget; const submit = document.getElementById('leadSubmit'); const status = document.getElementById('leadStatus');
  const fields = Object.fromEntries(new FormData(form));
  const reserve = form.dataset.reserve === '1';
  submit.disabled = true; submit.textContent = 'One moment…'; status.textContent = '';
  try {
    if (reserve) {
      const data = await post('/api/reserve', fields);
      if (data.mode === 'stripe' && data.url) { location.href = data.url; return; }
      status.textContent = data.message; submit.textContent = 'Interest recorded';
      // Intent-only mode: without Stripe there is no redirect and no Purchase
      // will ever follow, so this submission would otherwise reach Meta as
      // nothing at all. The visitor named a product and handed over an email,
      // which is the strongest signal available until checkout is live. Once
      // STRIPE_SECRET_KEY is set, the branch above returns first and this stops
      // firing on its own - no code change needed to switch over.
      track('Lead', {
        content_ids: fields.product ? [fields.product] : [],
        content_name: PRODUCTS[fields.product]?.name || '',
        content_category: 'reservation_intent'
      });
    } else {
      const data = await post('/api/waitlist', { ...fields, intent: 'waitlist' });
      status.textContent = data.message; submit.textContent = 'You’re on the list';
      // No value: a waitlist signup has not been priced, and inventing a figure
      // would corrupt the ROAS comparison against real reservations.
      track('Lead', {
        content_name: PRODUCTS[fields.product]?.name || 'General waitlist',
        content_category: 'waitlist'
      });
    }
  } catch (err) {
    status.textContent = err.message; submit.disabled = false; submit.textContent = reserve ? 'Continue to reservation' : 'Join private launch';
  }
});

if (qs.get('reserved')) {
  // Stripe returns the visitor here after a completed reservation. Passing the
  // Checkout session id as the Meta event id lets Meta discard duplicates, so a
  // refresh, a back-navigation, or a shared success URL cannot inflate the
  // count that the go/no-go decision rests on.
  const reservedProduct = qs.get('reserved');
  const sessionId = qs.get('session_id');
  track('Purchase', {
    content_ids: [reservedProduct], content_type: 'product',
    content_name: PRODUCTS[reservedProduct]?.name || reservedProduct, num_items: 1,
    value: DEPOSIT, currency: 'USD'
  }, sessionId ? { eventID: `reserve_${sessionId}` } : undefined);

  setTimeout(() => openLead('', false), 600);
  document.getElementById('leadTitle').textContent = 'Reservation received.';
  document.getElementById('leadIntro').textContent = 'You now have priority access to the BLKBX private launch. We will follow up before production.';
}
