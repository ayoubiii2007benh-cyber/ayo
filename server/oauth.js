'use strict';

/* Minimal OAuth 2.0 / OIDC authorization-code + PKCE client for "Continue
   with Google" / "Continue with Microsoft". No SDK dependency: just two
   fetches (token exchange, userinfo) per provider, using Node's built-in
   fetch. PKCE (RFC 7636) protects the code exchange even though these are
   confidential clients with a secret -- it costs nothing and stops a code
   intercepted in transit (logs, browser history, a referrer leak) from
   being redeemed by anyone but the party that started this exact flow. */

const crypto = require('node:crypto');

const PROVIDERS = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
    extraAuthParams: { access_type: 'online', prompt: 'select_account' },
  },
  microsoft: {
    clientId: process.env.MICROSOFT_CLIENT_ID || '',
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
    get authorizeUrl() { return `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT || 'common'}/oauth2/v2.0/authorize`; },
    get tokenUrl() { return `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT || 'common'}/oauth2/v2.0/token`; },
    userinfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
    scope: 'openid email profile',
    extraAuthParams: { prompt: 'select_account' },
  },
};

function isConfigured(name) {
  const p = PROVIDERS[name];
  return !!(p && p.clientId && p.clientSecret);
}

function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function authorizeUrl(name, { state, challenge, redirectUri }) {
  const p = PROVIDERS[name];
  const params = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: p.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...p.extraAuthParams,
  });
  return `${p.authorizeUrl}?${params.toString()}`;
}

async function exchangeCode(name, { code, verifier, redirectUri }) {
  const p = PROVIDERS[name];
  const body = new URLSearchParams({
    client_id: p.clientId,
    client_secret: p.clientSecret,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`${name} token exchange failed (${res.status})`);
  return res.json();
}

/* Uses the provider's OIDC userinfo endpoint (authenticated by the access
   token we just received) rather than decoding the id_token ourselves --
   that sidesteps needing a JWKS/signature-verification library entirely,
   since the userinfo response is only reachable with a token the provider
   itself just issued to us over this exact TLS connection. */
async function fetchProfile(name, accessToken) {
  const p = PROVIDERS[name];
  const res = await fetch(p.userinfoUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`${name} userinfo fetch failed (${res.status})`);
  const data = await res.json();
  // Google explicitly asserts whether the email is verified. Microsoft's
  // userinfo response carries no such claim; an email present there belongs
  // to a mailbox Microsoft itself authenticated the sign-in against, so it's
  // treated as verified too. Documented in SECURITY.md -- this is the one
  // trust assumption the account-linking logic depends on.
  const emailVerified = name === 'google' ? data.email_verified === true : !!data.email;
  if (!data.sub || !data.email) throw new Error(`${name} userinfo missing sub/email`);
  return { sub: String(data.sub), email: String(data.email), emailVerified, name: data.name || null };
}

module.exports = { PROVIDERS, isConfigured, pkcePair, authorizeUrl, exchangeCode, fetchProfile };
