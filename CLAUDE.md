# CLAUDE.md

Instructions for Claude Code when working in this repository.

## Rule #1 — Never lose user data

- All user data lives in the external Postgres database (DATABASE_URL). Never store user data on the server's local disk.
- Never drop, truncate, reset or re-seed tables. Only use additive migrations (ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS).
- Before every deploy, check that no change can delete or overwrite existing user data.
- Secrets only in environment variables, never in code or git.

This app is deployed on a host with an ephemeral filesystem (Render): anything written to local disk is wiped on the next deploy. That's what caused a real data-loss incident, which is why this rule exists. See `server/db.js` for the schema and `server/server.js` for how it's used.
