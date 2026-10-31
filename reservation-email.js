'use strict';

const CUSTOMER_TEMPLATE = 'd-7758bc0bade243c8b5fae8fa87539c5e';
const INTERNAL_TEMPLATE = 'd-88d4964ef5f14baa90467a77f152cc7a';
const store = require('./store');

const enabled = Boolean(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL);
let running = false;

function data(job) {
  const date = new Date(job.created_at);
  const dateText = Number.isNaN(date.getTime()) ? '' :
    date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  return {
    product_name: 'THE NIGHT',
    customer_email: job.email,
    reservation_id: job.session_id,
    payment_date: dateText,
    reservation_amount: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(job.amount / 100),
    stripe_session_id: job.session_id,
    stripe_payment_intent_id: job.payment_intent_id || ''
  };
}

async function send(job) {
  const message = {
    to: job.kind === 'customer' ? job.email : 'support@blkbx.co',
    from: {
      email: process.env.SENDGRID_FROM_EMAIL,
      name: process.env.SENDGRID_FROM_NAME || 'BLKBX'
    },
    templateId: job.kind === 'customer' ? CUSTOMER_TEMPLATE : INTERNAL_TEMPLATE,
    dynamicTemplateData: data(job),
    customArgs: { reservation_session: job.session_id.slice(0, 100), email_kind: job.kind }
  };
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.SENDGRID_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      personalizations: [{
        to: [{ email: message.to }],
        dynamic_template_data: message.dynamicTemplateData,
        custom_args: message.customArgs
      }],
      from: message.from,
      template_id: message.templateId
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('SendGrid HTTP ' + response.status);
}

async function processQueue() {
  if (!enabled || running || store.name !== 'mysql') return;
  running = true;
  try {
    for (let i = 0; i < 10; i++) {
      const job = await store.claimReservationEmail();
      if (!job) break;
      try {
        await send(job);
        await store.finishReservationEmail(job, null);
        console.log('[email] sent', job.kind, job.session_id);
      } catch (error) {
        console.error('[email] delivery failed', job.kind, job.session_id, error.message);
        await store.finishReservationEmail(job, error);
      }
    }
  } catch (error) {
    console.error('[email] queue processing failed', error);
  } finally {
    running = false;
  }
}

function start() {
  if (!enabled) {
    console.warn('[email] SendGrid not configured; reservation emails disabled');
    return;
  }
  if (store.name !== 'mysql') {
    console.warn('[email] durable MySQL storage required; reservation emails disabled');
    return;
  }
  // The outbox survives process restarts; a timer retries transient failures.
  const timer = setInterval(processQueue, 30000);
  timer.unref?.();
  processQueue();
}

module.exports = { start, processQueue };
