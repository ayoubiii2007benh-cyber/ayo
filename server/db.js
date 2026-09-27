'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const crypto = require('node:crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS friend_requests (
    id TEXT PRIMARY KEY,
    from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    responded_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_requests_to ON friend_requests(to_user_id, status);
  CREATE INDEX IF NOT EXISTS idx_requests_from ON friend_requests(from_user_id, status);

  CREATE TABLE IF NOT EXISTS friendships (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, friend_id)
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    UNIQUE (user_a, user_b)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    read_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    read_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);

  -- Links a user row to an external identity (Google/Microsoft "sub" claim).
  -- One user can hold links to both providers; one provider identity can
  -- never point at two different users (that's the primary key).
  CREATE TABLE IF NOT EXISTS oauth_accounts (
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (provider, provider_user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_accounts(user_id);

  -- Study Lounge rooms: real multi-user co-working sessions (replaces the
  -- former client-side bot simulation). One row per live room.
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    host_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    goal TEXT NOT NULL DEFAULT '',
    mission_target INTEGER,
    mission_state TEXT,
    created_at INTEGER NOT NULL
  );

  -- One row per (room, member). remaining_ms/status are client-reported
  -- snapshots (see POST /api/lounge/rooms/:code/status) -- authoritative
  -- countdown precision isn't needed server-side, only "what to show other
  -- members right now."
  CREATE TABLE IF NOT EXISTS room_members (
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    remaining_ms INTEGER NOT NULL DEFAULT 0,
    status_updated_at INTEGER NOT NULL,
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
    created_at INTEGER NOT NULL,
    responded_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_room_invites_to ON room_invites(to_user_id, status);

  -- One row per completed focus block, the basis for the friends leaderboard.
  -- Nothing else server-side reads or trusts client XP/stats; this is its
  -- own minimal, validated record (see POST /api/stats/sessions).
  CREATE TABLE IF NOT EXISTS focus_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    minutes INTEGER NOT NULL,
    completed_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_focus_sessions_user ON focus_sessions(user_id, completed_at);
`);

// Added after the initial schema shipped -- ALTER TABLE, not CREATE TABLE
// IF NOT EXISTS, because this column doesn't exist on a database created
// before this change. Guarded so it's also safe to run against a
// database that already has it (a fresh install's CREATE TABLE could be
// updated instead, but this guard means either database layout works).
const userCols = db.prepare('PRAGMA table_info(users)').all();
if (!userCols.some((c) => c.name === 'token_version')) {
  db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
}
if (!userCols.some((c) => c.name === 'avatar_url')) {
  db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT');
}

function id() {
  return crypto.randomUUID();
}

/* user_a/user_b are always stored with user_a < user_b so (a,b) and (b,a) requests collide on the UNIQUE index. */
function pairKey(u1, u2) {
  return u1 < u2 ? [u1, u2] : [u2, u1];
}

module.exports = { db, id, pairKey, DB_PATH };
