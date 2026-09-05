const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');

// GoDaddy injects its own connection variables; accept the common spellings so
// this works without renaming anything in the Secrets panel.
function mysqlConfig() {
  const url = process.env.DATABASE_URL || process.env.MYSQL_URL || '';
  const host = process.env.MYSQL_HOST || process.env.DB_HOST || '';
  if (!url && !host) return null;

  const ssl = process.env.DB_SSL === 'skip-verify'
    ? { rejectUnauthorized: false }
    : process.env.DB_SSL === 'true' ? {} : undefined;

  const base = { connectionLimit: 5, waitForConnections: true, timezone: 'Z', ssl };
  if (url) return { ...base, uri: url };

  return {
    ...base,
    host,
    port: Number(process.env.MYSQL_PORT || process.env.DB_PORT || 3306),
    user: process.env.MYSQL_USER || process.env.DB_USER,
    password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.MYSQL_DATABASE || process.env.DB_NAME
  };
}

// Shared by every table: who the visitor was and where they came from.
const ATTRIBUTION_DDL = `
  source      VARCHAR(80)  NOT NULL DEFAULT '',
  medium      VARCHAR(80)  NOT NULL DEFAULT '',
  campaign    VARCHAR(120) NOT NULL DEFAULT '',
  content     VARCHAR(120) NOT NULL DEFAULT '',
  referrer    VARCHAR(300) NOT NULL DEFAULT '',
  path        VARCHAR(200) NOT NULL DEFAULT '',
  user_agent  VARCHAR(260) NOT NULL DEFAULT ''`;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (
     id CHAR(36) NOT NULL PRIMARY KEY,
     at DATETIME(3) NOT NULL,
     event   VARCHAR(50) NOT NULL,
     product VARCHAR(40) NOT NULL DEFAULT '',
     ${ATTRIBUTION_DDL},
     INDEX idx_events_event_product (event, product),
     INDEX idx_events_at (at)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS leads (
     id CHAR(36) NOT NULL PRIMARY KEY,
     at DATETIME(3) NOT NULL,
     email   VARCHAR(180) NOT NULL,
     zip     VARCHAR(12)  NOT NULL DEFAULT '',
     product VARCHAR(40)  NOT NULL DEFAULT '',
     intent  VARCHAR(40)  NOT NULL DEFAULT '',
     ${ATTRIBUTION_DDL},
     INDEX idx_leads_product (product),
     INDEX idx_leads_email (email)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS reservations (
     id CHAR(36) NOT NULL PRIMARY KEY,
     at DATETIME(3) NOT NULL,
     email    VARCHAR(180) NOT NULL,
     zip      VARCHAR(12)  NOT NULL DEFAULT '',
     product  VARCHAR(40)  NOT NULL DEFAULT '',
     amount   INT          NOT NULL DEFAULT 0,
     currency VARCHAR(8)   NOT NULL DEFAULT 'usd',
     status   VARCHAR(40)  NOT NULL DEFAULT '',
     ${ATTRIBUTION_DDL},
     INDEX idx_reservations_product (product),
     INDEX idx_reservations_email (email)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

const COLUMNS = {
  events: ['event', 'product'],
  leads: ['email', 'zip', 'product', 'intent'],
  reservations: ['email', 'zip', 'product', 'amount', 'currency', 'status']
};
const ATTRIBUTION = ['source', 'medium', 'campaign', 'content', 'referrer', 'path', 'userAgent'];
const COLUMN_NAME = { userAgent: 'user_agent' };

function row(payload) {
  return { id: crypto.randomUUID(), at: new Date(), ...payload };
}

function emptyByProduct(productKeys) {
  const byProduct = {};
  for (const key of productKeys) {
    byProduct[key] = { views: 0, reserveClicks: 0, leads: 0, reservations: 0 };
  }
  return byProduct;
}

let pool = null;

const mysqlBackend = {
  name: 'mysql',

  async init() {
    pool = require('mysql2/promise').createPool(mysqlConfig());
    for (const statement of SCHEMA) await pool.query(statement);
  },

  async insert(table, payload) {
    const record = row(payload);
    const fields = ['id', 'at', ...COLUMNS[table], ...ATTRIBUTION];
    const columns = fields.map(f => COLUMN_NAME[f] || f);
    const values = fields.map(f => record[f] ?? '');
    await pool.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
      values
    );
    return record;
  },

  async metrics(productKeys) {
    const rows = async (sql) => (await pool.query(sql))[0];

    const [counts] = await rows(`
      SELECT
        (SELECT COUNT(*) FROM events WHERE event = 'page_view')    AS pageViews,
        (SELECT COUNT(*) FROM events WHERE event = 'view_product') AS productViews,
        (SELECT COUNT(*) FROM leads)                               AS leads,
        (SELECT COUNT(*) FROM reservations)                        AS reservationIntents,
        (SELECT MIN(at) FROM events)                               AS startedAt`);

    const byEvent = await rows(
      `SELECT product, event, COUNT(*) AS n FROM events
        WHERE event IN ('view_product', 'reserve_click') GROUP BY product, event`);
    const byLead = await rows(`SELECT product, COUNT(*) AS n FROM leads GROUP BY product`);
    const byReservation = await rows(`SELECT product, COUNT(*) AS n FROM reservations GROUP BY product`);

    const byProduct = emptyByProduct(productKeys);
    for (const r of byEvent) {
      if (!byProduct[r.product]) continue;
      if (r.event === 'view_product') byProduct[r.product].views = Number(r.n);
      if (r.event === 'reserve_click') byProduct[r.product].reserveClicks = Number(r.n);
    }
    for (const r of byLead) if (byProduct[r.product]) byProduct[r.product].leads = Number(r.n);
    for (const r of byReservation) if (byProduct[r.product]) byProduct[r.product].reservations = Number(r.n);

    return {
      startedAt: counts.startedAt ? new Date(counts.startedAt).toISOString() : null,
      totals: {
        pageViews: Number(counts.pageViews),
        productViews: Number(counts.productViews),
        leads: Number(counts.leads),
        reservationIntents: Number(counts.reservationIntents)
      },
      byProduct
    };
  }
};

// Local-development fallback. Not durable on managed hosts - see README.
const FILES = { events: 'events.jsonl', leads: 'leads.jsonl', reservations: 'reservations.jsonl' };

const jsonlBackend = {
  name: 'jsonl',

  async init() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  },

  async insert(table, payload) {
    const record = row(payload);
    const line = JSON.stringify({ ...record, at: record.at.toISOString() }) + '\n';
    fs.appendFileSync(path.join(DATA_DIR, FILES[table]), line, 'utf8');
    return record;
  },

  async metrics(productKeys) {
    const read = file => {
      const filename = path.join(DATA_DIR, file);
      if (!fs.existsSync(filename)) return [];
      return fs.readFileSync(filename, 'utf8').split('\n').filter(Boolean)
        .map(line => { try { return JSON.parse(line); } catch { return null; } })
        .filter(Boolean);
    };

    const events = read(FILES.events);
    const leads = read(FILES.leads);
    const reservations = read(FILES.reservations);

    const byProduct = emptyByProduct(productKeys);
    for (const e of events) {
      if (!byProduct[e.product]) continue;
      if (e.event === 'view_product') byProduct[e.product].views += 1;
      if (e.event === 'reserve_click') byProduct[e.product].reserveClicks += 1;
    }
    for (const l of leads) if (byProduct[l.product]) byProduct[l.product].leads += 1;
    for (const r of reservations) if (byProduct[r.product]) byProduct[r.product].reservations += 1;

    return {
      startedAt: events[0]?.at || null,
      totals: {
        pageViews: events.filter(e => e.event === 'page_view').length,
        productViews: events.filter(e => e.event === 'view_product').length,
        leads: leads.length,
        reservationIntents: reservations.length
      },
      byProduct
    };
  }
};

const backend = mysqlConfig() ? mysqlBackend : jsonlBackend;

module.exports = {
  name: backend.name,
  init: () => backend.init(),
  recordEvent: payload => backend.insert('events', payload),
  recordLead: payload => backend.insert('leads', payload),
  recordReservation: payload => backend.insert('reservations', payload),
  metrics: productKeys => backend.metrics(productKeys)
};
