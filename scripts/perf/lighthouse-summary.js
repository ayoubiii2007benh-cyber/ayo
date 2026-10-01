// usage: node lhsum.js <label>   -> median metrics over lh/<label>-{mobile,desktop}-*.json
const fs = require('fs');
const dir = process.env.LH_OUT || './lh-results';
const label = process.argv[2];
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
for (const form of ['mobile', 'desktop']) {
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(`${label}-${form}-`) && f.endsWith('.json'));
  if (!files.length) continue;
  const runs = files.map((f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')));
  const pick = (fn) => med(runs.map(fn).filter((v) => v !== undefined && v !== null));
  const a = (r, id) => r.audits[id];
  const net = (r) => a(r, 'network-requests').details.items;
  const bytes = (r, type) => net(r).filter((i) => i.resourceType === type).reduce((s, i) => s + (i.transferSize || 0), 0);
  const rows = {
    'perf score': pick((r) => Math.round(r.categories.performance.score * 100)),
    'FCP (ms)': pick((r) => Math.round(a(r, 'first-contentful-paint').numericValue)),
    'LCP (ms)': pick((r) => Math.round(a(r, 'largest-contentful-paint').numericValue)),
    'TBT (ms)': pick((r) => Math.round(a(r, 'total-blocking-time').numericValue)),
    'CLS': pick((r) => +a(r, 'cumulative-layout-shift').numericValue.toFixed(3)),
    'Speed Index (ms)': pick((r) => Math.round(a(r, 'speed-index').numericValue)),
    'requests': pick((r) => net(r).length),
    'total transfer (KB)': pick((r) => Math.round(net(r).reduce((s, i) => s + (i.transferSize || 0), 0) / 1024)),
    'document transfer (KB)': pick((r) => Math.round(bytes(r, 'Document') / 1024)),
    'script transfer (KB)': pick((r) => Math.round(bytes(r, 'Script') / 1024)),
    'font transfer (KB)': pick((r) => Math.round(bytes(r, 'Font') / 1024)),
    'main-thread work (ms)': pick((r) => Math.round(a(r, 'mainthread-work-breakdown').numericValue)),
    'script eval+parse (ms)': pick((r) => Math.round(((a(r, 'bootup-time') || {}).numericValue) || 0)),
    'DOM elements': pick((r) => (a(r, 'dom-size') || a(r, 'dom-size-insight') || {}).numericValue),
  };
  console.log(`\n== ${label} / ${form} (median of ${runs.length}) ==`);
  for (const [k, v] of Object.entries(rows)) console.log(k.padEnd(26), v);
  const r0 = runs[0];
  const lce = a(r0, 'largest-contentful-paint-element') || a(r0, 'lcp-breakdown-insight') || {}; console.log('LCP element:', JSON.stringify(JSON.stringify((lce.details || {}).items || []).slice(0, 300)));
}
