const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default || require('pixelmatch');
const fs = require('fs');
const [a, b] = process.argv.slice(2);
let bad = 0;
for (const f of fs.readdirSync(a).filter((x) => x.endsWith('.png')).sort()) {
  if (!fs.existsSync(`${b}/${f}`)) { console.log(f.padEnd(34), 'MISSING in', b); bad++; continue; }
  const A = PNG.sync.read(fs.readFileSync(`${a}/${f}`)), B = PNG.sync.read(fs.readFileSync(`${b}/${f}`));
  if (A.width !== B.width || A.height !== B.height) { console.log(f.padEnd(34), `SIZE DIFFERS ${A.width}x${A.height} vs ${B.width}x${B.height}`); bad++; continue; }
  const d = pixelmatch(A.data, B.data, null, A.width, A.height, { threshold: 0.1 });
  const pct = (d / (A.width * A.height)) * 100;
  console.log(f.padEnd(34), String(d).padStart(7), 'px differ', `(${pct.toFixed(3)}%)`, pct > 0.05 ? '  <-- CHECK' : '');
  if (pct > 0.05) bad++;
}
console.log(bad ? `${bad} screens need a look` : 'all screens match');
