#!/usr/bin/env node
// overlap-check.mjs: measures the real page at laptop, tablet and phone sizes and fails when
//   - two sections' bounds cross (a fixed-height section spilling over the next),
//   - a section's content is taller than the section's own .wrap (content cut or laid over),
//   - two blocks of running text overlap each other,
//   - the document scrolls sideways.
//
// Usage:
//   node tools/overlap-check.mjs                 # every viewport
//   node tools/overlap-check.mjs --shots         # also write shots/check/<w>x<h>-<section>.jpg
//   node tools/overlap-check.mjs --widths 1440,390
//
// Node 22+, no dependencies: its own headless Chrome and a tiny static server.

import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { extname, join, resolve, sep } from 'node:path';

const ROOT = resolve('.');
const OUT = join(ROOT, 'shots', 'check');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8',
};
const VIEWPORTS = [
  [1440, 900, 'laptop 1440'], [1366, 768, 'laptop 1366'], [1280, 720, 'laptop 1280'],
  [1024, 768, 'tablet landscape'], [820, 1180, 'tablet'], [768, 1024, 'tablet portrait'],
  [390, 844, 'phone'], [320, 640, 'small phone'],
];
const args = process.argv.slice(2);
const shots = args.includes('--shots');
const wArg = args.indexOf('--widths');
const only = wArg >= 0 ? new Set(String(args[wArg + 1] || '').split(',').map((n) => Number(n.trim()))) : null;
const vps = only ? VIEWPORTS.filter(([w]) => only.has(w)) : VIEWPORTS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- static server
const server = createServer((req, res) => {
  try {
    let f = resolve(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (f !== ROOT && !f.startsWith(ROOT + sep)) { res.writeHead(403); return res.end(); }
    if (statSync(f).isDirectory()) f = join(f, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(f).pipe(res);
  } catch { res.writeHead(404); res.end('not found'); }
});
const port = await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server.address().port)));
const base = `http://127.0.0.1:${port}/index.html`;

// ---------------------------------------------------------------- headless Chrome over CDP
function findChrome() {
  const env = process.env.CHROME_PATH;
  if (env && existsSync(env)) return env;
  const local = process.env.LOCALAPPDATA || '', pf = process.env.PROGRAMFILES || 'C:\\Program Files', pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return [
    join(pf, 'Google/Chrome/Application/chrome.exe'), join(pf86, 'Google/Chrome/Application/chrome.exe'), join(local, 'Google/Chrome/Application/chrome.exe'),
    join(pf86, 'Microsoft/Edge/Application/msedge.exe'), join(pf, 'Microsoft/Edge/Application/msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium',
    join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  ].find((c) => c && existsSync(c)) || null;
}
async function launch() {
  if (typeof WebSocket === 'undefined') throw new Error('Node 22+ required');
  const exe = findChrome();
  if (!exe) throw new Error('No Chrome, Edge or Chromium found; set CHROME_PATH.');
  const profile = join(ROOT, '.taste-skill', 'chrome-overlap', `run-${process.pid}`);
  rmSync(profile, { recursive: true, force: true }); mkdirSync(profile, { recursive: true });
  const proc = spawn(exe, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--mute-audio', '--hide-scrollbars', '--disable-gpu', '--force-color-profile=srgb',
    '--disable-features=Translate,MediaRouter', '--window-size=1440,900', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const kill = () => { if (proc.exitCode === null) spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); };
  const ws = await new Promise((ok, no) => {
    let buf = '';
    const t = setTimeout(() => no(new Error('Chrome did not start within 45s')), 45000);
    proc.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); ok(m[1]); } });
    proc.once('exit', (c) => { clearTimeout(t); no(new Error('Chrome exited early (' + c + ')')); });
  });
  process.once('exit', kill);
  return { ws, kill, profile, proc };
}
class CDP {
  constructor(ws) {
    this.ws = ws; this.n = 0; this.pending = new Map(); this.listeners = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id); clearTimeout(p.t);
        m.error ? p.no(new Error(m.error.message)) : p.ok(m.result);
      } else if (m.method) for (const fn of this.listeners.get(m.method) || []) fn(m.params);
    };
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('CDP socket failed')); });
    return new CDP(ws);
  }
  send(method, params = {}, ms = 30000) {
    const id = ++this.n;
    return new Promise((ok, no) => {
      const t = setTimeout(() => { this.pending.delete(id); no(new Error('CDP timeout: ' + method)); }, ms);
      this.pending.set(id, { ok, no, t });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) { if (!this.listeners.has(method)) this.listeners.set(method, new Set()); this.listeners.get(method).add(fn); }
}

// ---------------------------------------------------------------- the page-side measurement
const MEASURE = String.raw`(() => {
  const out = { sections: [], sectionOverlaps: [], wrapOverflow: [], textOverlaps: [], horizontal: 0, docHeight: 0 };
  const vh = innerHeight, vw = innerWidth;
  out.docHeight = document.documentElement.scrollHeight;
  out.horizontal = Math.max(0, document.documentElement.scrollWidth - vw);
  const box = (el) => { const r = el.getBoundingClientRect(); return {
    top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY),
    left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height), w: Math.round(r.width) }; };
  const visible = (el) => {
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1;
  };
  const secs = [...document.querySelectorAll('main > section, main > .section, footer.closing')].filter(visible);
  out.sections = secs.map((s) => ({ id: s.id || s.className.split(' ')[0] || s.tagName.toLowerCase(), ...box(s) }));
  out.chapters = [...document.querySelectorAll('#work .chapter')].map((c) => ({ cls: c.className, ...box(c) }));
  out.chapterKids = [...document.querySelectorAll('#work .chapter')].map((c) => [...c.children].map((k) => ({ cls: String(k.className).slice(0, 40), h: Math.round(k.getBoundingClientRect().height) })));
  for (let i = 0; i < out.sections.length - 1; i++) {
    const a = out.sections[i], b = out.sections[i + 1];
    if (a.bottom > b.top + 1) out.sectionOverlaps.push({ a: a.id, aBottom: a.bottom, b: b.id, bTop: b.top, over: a.bottom - b.top });
  }
  for (const s of secs) {
    for (const w of s.querySelectorAll(':scope > .wrap, :scope > .container')) {
      const over = w.scrollHeight - w.clientHeight;
      if (over > 2) out.wrapOverflow.push({ section: s.id || s.tagName.toLowerCase(), over, client: w.clientHeight, scroll: w.scrollHeight });
    }
  }
  // running text only: skip UI fragments, panels, art, fixed chrome, dialogs and SVG
  const skip = (el) => el.closest('[data-ui], .ui, .stage, .panel, [role="img"], svg, dialog, header, .skip-link, .hero__art, .globe-poster, canvas, .close__word');
  const textEls = [...document.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,figcaption,button,a.btn')]
    .filter((el) => visible(el) && !skip(el) && el.textContent.trim().length > 1);
  const rects = textEls.map((el) => ({ el, r: el.getBoundingClientRect() }));
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const A = rects[i], B = rects[j];
    if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
    const x = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
    const y = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
    if (x > 4 && y > 4 && x * y > 400) {
      const label = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''));
      out.textOverlaps.push({ a: label(A.el), b: label(B.el), x: Math.round(x), y: Math.round(y), text: A.el.textContent.trim().slice(0, 40) });
    }
  }
  return out;
})()`;

// ---------------------------------------------------------------- run
const chrome = await launch();
let wsUrl = chrome.ws.replace('/devtools/browser/', '/devtools/page/');
// the initial about:blank page target: its direct socket keeps commands simple
const targets = await (await fetch(`http://127.0.0.1:${new URL(chrome.ws).port}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');
const cdp = await CDP.connect(page.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
const loaded = new Set();
cdp.on('Page.loadEventFired', () => loaded.add('now'));

let failures = 0;
for (const [w, h, name] of vps) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 640 });
  loaded.clear();
  await cdp.send('Page.navigate', { url: `${base}?check=${w}x${h}-${Date.now()}` });
  for (let i = 0; i < 100 && !loaded.has('now'); i++) await sleep(100);
  // let lazy images decode and the entrance settle, then walk the page once so moments mount
  await cdp.send('Runtime.evaluate', { expression: `(async () => {
    document.querySelectorAll('img[loading="lazy"]').forEach((i) => { i.loading = 'eager'; });
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })));
  })()` , awaitPromise: true });
  await cdp.send('Runtime.evaluate', { expression: `scrollTo(0, document.body.scrollHeight)`, awaitPromise: true });
  await sleep(450);
  await cdp.send('Runtime.evaluate', { expression: `scrollTo(0, 0)`, awaitPromise: true });
  await sleep(250);
  const res = await cdp.send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
  const m = res.result.value;
  const problems = m.sectionOverlaps.length + m.wrapOverflow.length + m.textOverlaps.length + (m.horizontal > 1 ? 1 : 0);
  failures += problems;
  const mark = problems ? 'FAIL' : 'ok  ';
  const secs = m.sections.map((s) => `${s.id} ${s.top}-${s.bottom}`).join('  ');
  console.log(`${mark} ${String(w).padStart(4)}x${String(h).padEnd(4)} ${name.padEnd(15)} sections ${m.sections.length}  doc ${m.docHeight}  ${secs}`);
  if (m.chapters && m.chapters.length) console.log(`       chapters: ${m.chapters.map((c) => `${c.cls.split(' ').pop()} ${c.h}px`).join('  ')}`);
  if (m.chapterKids) console.log(`       kids: ${m.chapterKids.map((ks) => ks.map((k) => `${k.cls}:${k.h}`).join(', ')).join(' | ')}`);
  for (const o of m.sectionOverlaps) console.log(`       overlap: ${o.a} ends ${o.aBottom}, ${o.b} starts ${o.bTop} (${o.over}px)`);
  for (const o of m.wrapOverflow) console.log(`       content overflows: #${o.section} wrap ${o.scroll}px in ${o.client}px (${o.over}px)`);
  for (const o of m.textOverlaps) console.log(`       text over text: ${o.a} × ${o.b} (${o.x}×${o.y}) "${o.text}"`);
  if (m.horizontal > 1) console.log(`       horizontal scroll: ${m.horizontal}px`);

  if (shots) {
    mkdirSync(OUT, { recursive: true });
    for (const id of ['record', 'work', 'work-tegna', 'build']) {
      const r = await cdp.send('Runtime.evaluate', { expression: `(() => { const e = document.querySelector('#${id}'); if (!e) return null; const b = e.getBoundingClientRect(); scrollTo(0, 0); return { y: Math.round(b.top + scrollY), h: Math.round(b.height) }; })()`, returnByValue: true });
      const v = r.result.value; if (!v) continue;
      await sleep(350);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 72, captureBeyondViewport: true, clip: { x: 0, y: v.y, width: w, height: v.h, scale: 1 } }, 60000);
      const file = join(OUT, `${w}x${h}-${id}.jpg`);
      const { writeFileSync } = await import('node:fs');
      writeFileSync(file, Buffer.from(shot.data, 'base64'));
      console.log(`       shot: ${file}`);
    }
  }
}
cdp.ws.close();
chrome.kill();
server.close();
rmSync(chrome.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
console.log(failures ? `\nOVERLAP: ${failures} problem(s)` : '\nOVERLAP: none');
process.exit(failures ? 1 : 0);
