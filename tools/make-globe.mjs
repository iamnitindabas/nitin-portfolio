// Builds globe-fallback.svg: a dot globe from the kit's real coastlines, orthographic, turned so
// Europe, Africa and Asia face the viewer, with great-circle arcs out of Delhi.
import { LAND, LAKES } from '../assets/objects/print-globe/land.js';
import fs from 'node:fs';

const W = 460, C = W / 2, R = 196;
const YAW = 8 * Math.PI / 180;     // turn the sphere so western Europe faces us
const PITCH = 14 * Math.PI / 180;  // tilt the north pole toward the viewer

const rad = d => d * Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const isLand = (lon, lat) => LAND.some(r => inRing(lon, lat, r)) && !LAKES.some(r => inRing(lon, lat, r));

function rotate([x, y, z]) {
  // yaw about Y, then pitch about X
  const cy = Math.cos(YAW), sy = Math.sin(YAW);
  const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
  const cp = Math.cos(PITCH), sp = Math.sin(PITCH);
  const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
  return [x1, y2, z2];
}
const project = ([x, y, z]) => [C + x * R, C - y * R, z];
const toVec = (lon, lat) => {
  const p = rad(lat), t = rad(lon);
  return [Math.cos(p) * Math.sin(t), Math.sin(p), Math.cos(p) * Math.cos(t)];
};
const slerp = (a, b, t) => {
  const d = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
  const o = Math.acos(d);
  if (o < 1e-6) return a;
  const s = Math.sin(o), k1 = Math.sin((1 - t) * o) / s, k2 = Math.sin(t * o) / s;
  return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
};

// dots: a Fibonacci lattice, land kept, sea sparse
const dots = [];
const N = 9000;
const gold = Math.PI * (3 - Math.sqrt(5));
for (let i = 0; i < N; i++) {
  const y = 1 - (i / (N - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const a = gold * i;
  const v = [Math.cos(a) * r, y, Math.sin(a) * r];
  const lon = Math.atan2(v[0], v[2]) * 180 / Math.PI;
  const lat = Math.asin(v[1]) * 180 / Math.PI;
  const land = isLand(lon, lat);
  const [px, py, pz] = project(rotate(v));
  if (pz < -0.18) continue;                       // the far side is not drawn
  const k = clamp((pz + 0.18) / 1.18, 0, 1);
  if (land) {
    dots.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(0.75 + k * 0.65).toFixed(2)}" opacity="${(0.35 + k * 0.6).toFixed(2)}"/>`);
  }
}

// arcs: Delhi to Rotterdam and Tysons. A great circle lifted off the sphere, projected.
const HOME = { lon: 77.21, lat: 28.61 };
const SITES = [
  { lon: 4.4, lat: 51.22 },
  { lon: -77.23, lat: 38.92 },
];
let arcs = '', marks = '';
for (const s of SITES) {
  const a = toVec(HOME.lon, HOME.lat), b = toVec(s.lon, s.lat);
  const pts = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const v = slerp(a, b, t);
    const lift = 1 + 0.17 * Math.sin(Math.PI * t);      // rise off the surface in the middle
    pts.push(project(rotate([v[0] * lift, v[1] * lift, v[2] * lift])));
  }
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  arcs += `<path d="${d}" fill="none" stroke="#2456d6" stroke-width="1.1" opacity=".7"/>`;
  const [[ex, ey]] = [pts[pts.length - 1]];
  marks += `<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="2.6" fill="#2456d6"/>`;
}
const [hx, hy] = project(rotate(toVec(HOME.lon, HOME.lat)));
marks += `<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="3.4" fill="#0a0d14"/><circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="7" fill="none" stroke="#0a0d14" stroke-width="1" opacity=".45"/>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}" width="${W}" height="${W}"><g fill="#0a0d14">${dots.join('')}</g><g>${arcs}${marks}</g></svg>`;
fs.writeFileSync('globe-fallback.svg', svg);
console.log('dots', dots.length, 'bytes', svg.length);
