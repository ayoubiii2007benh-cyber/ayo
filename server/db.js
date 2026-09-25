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
`);

function id() {
  return crypto.randomUUID();
}

/* user_a/user_b are always stored with user_a < user_b so (a,b) and (b,a) requests collide on the UNIQUE index. */
function pairKey(u1, u2) {
  return u1 < u2 ? [u1, u2] : [u2, u1];
}

module.exports = { db, id, pairKey, DB_PATH };
