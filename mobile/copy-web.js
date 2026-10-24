/*
 * Copies the website into www/, the folder the iPhone app is built from
 * (Capacitor's webDir). The app is the same site; only these changes are
 * made to the copy:
 *
 *  - The Supabase sign-in library is bundled from the npm package instead of
 *    being loaded from the CDN, so the app never runs code downloaded at run
 *    time.
 *  - The service worker isn't included: the app's files are already on the
 *    phone.
 *
 * The page notices it's in the app (window.Capacitor) and adjusts: links in
 * emails point at the website, and there's no install hint.
 * Run: node copy-web.js (or npm run sync, which also updates the iOS project).
 */
const fs = require('fs');
const path = require('path');

const SITE = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'www');
const SUPABASE_VERSION = '2.45.4';
const CDN = `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${SUPABASE_VERSION}/dist/umd/supabase.js`;
const COPY = ['index.html', 'app.js', 'styles.css', 'config.js', 'manifest.webmanifest', 'icons', 'privacy', 'support'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const item of COPY) {
  const from = path.join(SITE, item);
  if (!fs.existsSync(from)) throw new Error(`missing from the site: ${item}`);
  fs.cpSync(from, path.join(OUT, item), { recursive: true });
}

// The Supabase library from the npm package (the UMD build loads a second chunk from its own folder).
const pkg = require('@supabase/supabase-js/package.json');
if (pkg.version !== SUPABASE_VERSION) throw new Error(`@supabase/supabase-js ${pkg.version} installed; the site uses ${SUPABASE_VERSION}`);
const umd = path.join(path.dirname(require.resolve('@supabase/supabase-js/package.json')), 'dist', 'umd');
fs.cpSync(umd, path.join(OUT, 'vendor', 'supabase'), { recursive: true });

const indexFile = path.join(OUT, 'index.html');
let html = fs.readFileSync(indexFile, 'utf8');
if (!html.includes(CDN)) throw new Error('index.html no longer loads the Supabase library from the address this script replaces');
html = html.replace(CDN, 'vendor/supabase/supabase.js');
const version = `app-${new Date().toISOString().slice(0, 10)}`;
html = html.replace(/\?v=dev/g, `?v=${version}`).replace('name="app-version" content="dev"', `name="app-version" content="${version}"`);
fs.writeFileSync(indexFile, html);

// No remote code at all.
const all = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(path.join(dir, e.name)) : [path.join(dir, e.name)]));
for (const file of all(OUT).filter((f) => /\.(html|js)$/.test(f))) {
  if (/<script[^>]+src="https?:/i.test(fs.readFileSync(file, 'utf8'))) throw new Error(`${file} still loads a script from the internet`);
}
const size = all(OUT).reduce((n, f) => n + fs.statSync(f).size, 0);
console.log(`www/ ready: ${(size / 1048576).toFixed(1)} MB`);
