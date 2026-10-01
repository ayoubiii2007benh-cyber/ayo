'use strict';

/* Serving of the site's own static text files (HTML pages, CSS, JS, JSON) with:
   - brotli / gzip, compressed once and kept in memory (the origin can't rely on a CDN in front for this);
   - content-hashed URLs: every page has `/assets/x.css` rewritten to `/assets/x.css?v=<hash>` as it is served,
     and a request whose hash matches the file's current content is cacheable for a year ("immutable"), so a
     deploy changes the hash and browsers fetch the new file, while repeat visits download nothing;
   - ETag / 304 handling (Express does it for us when we res.send a Buffer).
   Nothing here touches user data: only files that ship with the app. */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const TEXT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const MIN_COMPRESS_BYTES = 1024;
const YEAR = 'public, max-age=31536000, immutable';

/** abs path -> { mtimeMs, size, entry } (re-read automatically if the file changes on disk) */
const files = new Map();

function makeEntry(body) {
  const entry = { body, version: crypto.createHash('sha256').update(body).digest('hex').slice(0, 10) };
  if (body.length >= MIN_COMPRESS_BYTES) {
    try {
      entry.br = zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length } });
      entry.gz = zlib.gzipSync(body, { level: 9 });
    } catch { /* serve uncompressed */ }
  }
  return entry;
}

/** The (cached) entry for a file on disk, or null if it doesn't exist. */
function loadFile(abs) {
  let stat;
  try { stat = fs.statSync(abs); } catch { return null; }
  if (!stat.isFile()) return null;
  const cached = files.get(abs);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.entry;
  const entry = makeEntry(fs.readFileSync(abs));
  files.set(abs, { mtimeMs: stat.mtimeMs, size: stat.size, entry });
  return entry;
}

/** Sends an entry with the best encoding the client accepts. */
function sendEntry(req, res, entry, contentType, cacheControl) {
  res.set('Content-Type', contentType);
  res.set('Cache-Control', cacheControl);
  res.vary('Accept-Encoding');
  let body = entry.body;
  if (entry.br && req.acceptsEncodings('br')) { res.set('Content-Encoding', 'br'); body = entry.br; }
  else if (entry.gz && req.acceptsEncodings('gzip')) { res.set('Content-Encoding', 'gzip'); body = entry.gz; }
  res.send(body);
}

/** Adds ?v=<content hash> to every /assets/... URL an HTML page references. */
function withVersionedAssets(html, rootDir) {
  return html.replace(/\b(href|src)="(\/assets\/[^"?#]+)"/g, (match, attr, url) => {
    const entry = loadFile(path.join(rootDir, url));
    return entry ? `${attr}="${url}?v=${entry.version}"` : match;
  });
}

/** A rendered (asset-versioned, compressed) HTML page, rebuilt only when it or an asset it references changes. */
const pages = new Map();
function renderPage(abs, rootDir) {
  const source = loadFile(abs);
  if (!source) return null;
  const html = source.body.toString('utf8');
  const versioned = withVersionedAssets(html, rootDir);
  const signature = crypto.createHash('sha256').update(versioned).digest('hex');
  const cached = pages.get(abs);
  if (cached && cached.signature === signature) return cached.entry;
  const entry = makeEntry(Buffer.from(versioned, 'utf8'));
  pages.set(abs, { signature, entry });
  return entry;
}

function sendPage(req, res, abs, rootDir) {
  const entry = renderPage(abs, rootDir);
  if (!entry) return res.status(404).type('text/plain').send('Not found');
  // no-cache = always revalidate (a cheap 304 when unchanged): a new deploy is picked up immediately, and
  // the assets it points at change URL with their content.
  return sendEntry(req, res, entry, TEXT_TYPES['.html'], 'no-cache');
}

/** Express middleware serving the text files under `dir` (mounted at /assets). Anything else falls through. */
function textAssets(dir) {
  const root = path.resolve(dir);
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel;
    try { rel = decodeURIComponent(req.path); } catch { return next(); }
    if (!/^\/[A-Za-z0-9._\/-]+$/.test(rel) || rel.includes('..')) return next();
    const type = TEXT_TYPES[path.extname(rel).toLowerCase()];
    if (!type) return next();
    const abs = path.join(root, rel);
    if (!abs.startsWith(root + path.sep)) return next();
    const entry = loadFile(abs);
    if (!entry) return next();
    // Immutable only when the URL carries the file's CURRENT content hash; anything else revalidates.
    const cacheControl = req.query.v === entry.version ? YEAR : 'public, max-age=0, must-revalidate';
    return sendEntry(req, res, entry, type, cacheControl);
  };
}

module.exports = { loadFile, sendPage, textAssets, YEAR };
