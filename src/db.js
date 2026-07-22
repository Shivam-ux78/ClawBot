import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

let _pool = null;

export async function initDb() {
  if (_pool) return _pool;

  _pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: { rejectUnauthorized: false }
  });

  await runSchema(_pool);
  console.log('[DB] PostgreSQL initialised at', config.databaseUrl.split('@')[1]);
  return _pool;
}

export function getDb() {
  if (!_pool) throw new Error('Database not initialised. Call initDb() first.');
  return _pool;
}

/* ─────────────────────────────────────────────────
   Query Helpers (Async)
───────────────────────────────────────────────── */

/**
 * Run a write statement (INSERT / UPDATE / DELETE).
 * Automatically returns the first row if RETURNING is used.
 */
export async function run(sql, params = []) {
  const result = await getDb().query(sql, params);
  return { 
    lastInsertRowid: result.rows[0]?.id || null, 
    changes: result.rowCount 
  };
}

/**
 * Get a single row.
 */
export async function get(sql, params = []) {
  const result = await getDb().query(sql, params);
  return result.rows[0];
}

/**
 * Get all matching rows.
 */
export async function all(sql, params = []) {
  const result = await getDb().query(sql, params);
  return result.rows;
}

/* ─────────────────────────────────────────────────
   Schema Setup
───────────────────────────────────────────────── */
async function runSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS creators (
      id              SERIAL PRIMARY KEY,
      username        VARCHAR(255) NOT NULL UNIQUE,
      followers       INTEGER,
      niche           VARCHAR(255),
      location        VARCHAR(255),
      bio             TEXT,
      state           VARCHAR(50) NOT NULL DEFAULT 'pending',
      bot_state       VARCHAR(50) NOT NULL DEFAULT 'active',
      quoted_price    NUMERIC,
      custom_message  TEXT,
      created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // Add bio, location, and discovery scoring columns (safe if already exists)
  await pool.query(`
    ALTER TABLE creators ADD COLUMN IF NOT EXISTS bio TEXT;
    ALTER TABLE creators ADD COLUMN IF NOT EXISTS location VARCHAR(255);
    ALTER TABLE creators ADD COLUMN IF NOT EXISTS category VARCHAR(100);
    ALTER TABLE creators ADD COLUMN IF NOT EXISTS confidence INTEGER;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id          SERIAL PRIMARY KEY,
      creator_id  INTEGER NOT NULL REFERENCES creators(id),
      direction   VARCHAR(10) NOT NULL,
      message     TEXT NOT NULL,
      sent_by     VARCHAR(50) NOT NULL DEFAULT 'bot',
      created_at  TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS deals (
      id              SERIAL PRIMARY KEY,
      creator_id      INTEGER NOT NULL REFERENCES creators(id),
      proposed_price  NUMERIC NOT NULL,
      status          VARCHAR(50) NOT NULL DEFAULT 'pending',
      created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
      resolved_at     TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dm_log (
      id          SERIAL PRIMARY KEY,
      creator_id  INTEGER NOT NULL REFERENCES creators(id),
      sent_at     TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key         VARCHAR(255) PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // LinkedIn → Email outreach channel (free discovery pipeline, parallel to the IG pipeline)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_leads (
      id                 SERIAL PRIMARY KEY,
      apollo_contact_id  VARCHAR(255) UNIQUE,
      full_name          VARCHAR(255),
      email              VARCHAR(255) NOT NULL UNIQUE,
      linkedin_url       VARCHAR(500),
      company            VARCHAR(255),
      title              VARCHAR(255),
      location           VARCHAR(255),
      niche              VARCHAR(255),
      state              VARCHAR(50) NOT NULL DEFAULT 'pending',
      bot_state          VARCHAR(50) NOT NULL DEFAULT 'active',
      channel            VARCHAR(50) NOT NULL DEFAULT 'linkedin_email',
      custom_message     TEXT,
      created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_conversations (
      id          SERIAL PRIMARY KEY,
      lead_id     INTEGER NOT NULL REFERENCES email_leads(id),
      direction   VARCHAR(10) NOT NULL,
      message     TEXT NOT NULL,
      sent_by     VARCHAR(50) NOT NULL DEFAULT 'bot',
      created_at  TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // Tracks outreach emails sent via Gmail SMTP, to enforce EMAIL_DAILY_LIMIT.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_send_log (
      id          SERIAL PRIMARY KEY,
      lead_id     INTEGER REFERENCES email_leads(id),
      recipient   VARCHAR(255) NOT NULL,
      sent_at     TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
}
