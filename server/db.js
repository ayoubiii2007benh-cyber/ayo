'use strict';

const { Pool, types } = require('pg');
const crypto = require('node:crypto');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL environment variable is required (a Postgres connection string, e.g. from Neon: ' +
    'https://neon.tech). See server/.env.example. This app stores all user data in Postgres so it ' +
    'survives redeploys -- it never writes user data to the local disk.'
  );
}

/* node-postgres returns BIGINT (OID 20) and NUMERIC as JS strings by default, because a 64-bit
   integer can exceed what a JS number can represent exactly. Every BIGINT column in this schema
   is an epoch-millisecond timestamp (current values ~1.8e12, safe up to ~9e15, i.e. the year
   287396) and COUNT(*)/SUM() aggregates also come back as BIGINT in Postgres (unlike SQLite,
   where they're plain integers) -- both are always safe to hand back as real numbers here, and
   the rest of this codebase (arithmetic like `total + minutes`, comparisons like `x < Date.now()`,
   JSON responses the frontend expects as numbers) already assumes they are. */
types.setTypeParser(20, (val) => parseInt(val, 10));

const pool = new Pool({
  connectionString: DATABASE_URL,
  // Neon (and most managed Postgres hosts) require TLS; this keeps the connection encrypted
  // without depending on the platform's CA bundle including their specific chain.
  ssl: { rejectUnauthorized: false },
});
pool.on('error', (err) => {
  // A background/idle client hitting an error (e.g. a dropped connection) must not crash the
  // whole process -- the pool discards that client and the next query gets a fresh one.
  console.error('[db] unexpected error on idle Postgres client:', err.message);
});

/** SQLite-style `?` placeholders -> Postgres `$1, $2, ...`, in order of appearance. */
function toPgParams(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/** INSERT/UPDATE/DELETE. Returns the pg result object (rowCount, etc). */
async function run(sql, params = []) {
  return pool.query(toPgParams(sql), params);
}
/** SELECT expected to return 0 or 1 row. */
async function get(sql, params = []) {
  const res = await pool.query(toPgParams(sql), params);
  return res.rows[0];
}
/** SELECT expected to return any number of rows. */
async function all(sql, params = []) {
  const res = await pool.query(toPgParams(sql), params);
  return res.rows;
}

const db = { run, get, all, pool };

/* ============================== schema ==============================
   CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS only -- this function runs on every
   server start (including every deploy) and must NEVER be able to delete or reset existing
   data. There is deliberately no DROP, no TRUNCATE, and no "recreate the table" path anywhere
   in this file. See CLAUDE.md, Rule #1.

   Timestamps are BIGINT (epoch milliseconds from Date.now()) -- Postgres's plain INTEGER is
   32-bit (max ~2.1 billion) and overflows a real timestamp immediately; SQLite's old schema
   used INTEGER for these because SQLite's INTEGER affinity is already 64-bit. */
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL,
      last_seen_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS friend_requests (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL,
      responded_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_requests_to ON friend_requests(to_user_id, status);
    CREATE INDEX IF NOT EXISTS idx_requests_from ON friend_requests(from_user_id, status);

    CREATE TABLE IF NOT EXISTS friendships (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, friend_id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      UNIQUE (user_a, user_b)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      read_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      read_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);

    CREATE TABLE IF NOT EXISTS oauth_accounts (
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (provider, provider_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_accounts(user_id);

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      host_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      goal TEXT NOT NULL DEFAULT '',
      mission_target INTEGER,
      mission_state TEXT,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_members (
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      remaining_ms INTEGER NOT NULL DEFAULT 0,
      status_updated_at BIGINT NOT NULL,
      mission_progress INTEGER NOT NULL DEFAULT 0,
      mission_state TEXT NOT NULL DEFAULT 'pending',
      PRIMARY KEY (room_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);

    CREATE TABLE IF NOT EXISTS room_invites (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL,
      responded_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_room_invites_to ON room_invites(to_user_id, status);

    CREATE TABLE IF NOT EXISTS focus_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      minutes INTEGER NOT NULL,
      completed_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_focus_sessions_user ON focus_sessions(user_id, completed_at);

    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT,
      code_expires_at BIGINT,
      attempts INTEGER NOT NULL DEFAULT 0,
      verified_at BIGINT,
      reset_token_hash TEXT,
      reset_token_expires_at BIGINT,
      used_at BIGINT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(reset_token_hash);
  `);

  // Shared room chat. Rows (and image bytes) are removed by ON DELETE CASCADE when the room itself
  // is deleted -- which happens when the last member leaves -- so a room's chat lives exactly as long
  // as the room. Images are stored in Postgres (BYTEA), never on the local disk (CLAUDE.md, Rule #1).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL DEFAULT '',
      image BYTEA,
      image_mime TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_room_messages_room ON room_messages(room_id, created_at);
  `);

  // Columns added after the initial schema shipped. Postgres's own ADD COLUMN IF NOT EXISTS
  // (unlike SQLite) makes these safe to just always run -- no existence-check needed.
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS mission_focus_min INTEGER;
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS mission_break_min INTEGER;
  `);

  // SQLite's schema used `COLLATE NOCASE` for case-insensitive uniqueness/lookups on these
  // three columns; Postgres has no equivalent collation built in, so lookups instead compare
  // LOWER(column) (see getUserByUsername etc. in server.js) and uniqueness is enforced the same
  // case-insensitive way via a unique index on LOWER(column) rather than on the column itself.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email)) WHERE email IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_code_lower ON rooms (LOWER(code));
  `);
}

function id() {
  return crypto.randomUUID();
}

/* user_a/user_b are always stored with user_a < user_b so (a,b) and (b,a) requests collide on the UNIQUE index. */
function pairKey(u1, u2) {
  return u1 < u2 ? [u1, u2] : [u2, u1];
}

module.exports = { db, initSchema, id, pairKey };
