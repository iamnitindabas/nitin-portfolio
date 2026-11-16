// A spinning globe of dots: real coastlines from the kit's land polygons, orthographic, open on
// the Atlantic so Europe and the United States both face the viewer, with arcs out of Delhi.
// Canvas 2D only — no WebGL, no library — so it draws in every browser and in the CPU checker.
// Reduced motion gets one still frame; off screen it stops; the pointer can drag it.
import { LAND, LAKES } from "../objects/print-globe/land.js";

const host = document.querySelector("[data-globe]");
const canvas = host && host.querySelector("canvas");
if (host && canvas) start();

function start() {
  const ctx = canvas.getContext("2d");
  const INK = "#0a0d14";
  const ACCENT = "#2456d6";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------ geography */
  const inRing = (lon, lat, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const isLand = (lon, lat) =>
    LAND.some((r) => inRing(lon, lat, r)) && !LAKES.some((r) => inRing(lon, lat, r));

  const rad = (d) => (d * Math.PI) / 180;
  const vec = (lon, lat) => {
    const p = rad(lat), t = rad(lon);
    return [Math.cos(p) * Math.sin(t), Math.sin(p), Math.cos(p) * Math.cos(t)];
  };

  // land dots on a Fibonacci lattice
  const dots = [];
  const N = 8200, gold = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = gold * i;
    const v = [Math.cos(a) * r, y, Math.sin(a) * r];
    const lon = (Math.atan2(v[0], v[2]) * 180) / Math.PI;
    const lat = (Math.asin(v[1]) * 180) / Math.PI;
    if (isLand(lon, lat)) dots.push(v);
  }

  // arcs: Delhi out to Rotterdam and Tysons, lifted off the surface
  const HOME = vec(77.21, 28.61);
  const SITES = [vec(4.13, 51.92), vec(-77.23, 38.92)];
  const slerp = (a, b, t) => {
    const d = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    const o = Math.acos(d);
    if (o < 1e-6) return a;
    const s = Math.sin(o), k1 = Math.sin((1 - t) * o) / s, k2 = Math.sin(t * o) / s;
    return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
  };
  const arcs = SITES.map((site) => {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const t = i / 64;
      const v = slerp(HOME, site, t);
      const lift = 1 + 0.17 * Math.sin(Math.PI * t);
      pts.push([v[0] * lift, v[1] * lift, v[2] * lift]);
    }
    return pts;
  });

  /* ------------------------------------------------------------ projection */
  const PITCH = rad(14);
  const cp = Math.cos(PITCH), sp = Math.sin(PITCH);
  const project = (v, yaw) => {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const x1 = v[0] * cy + v[2] * sy;
    const z1 = -v[0] * sy + v[2] * cy;
    const y2 = v[1] * cp - z1 * sp;
    const z2 = v[1] * sp + z1 * cp;
    return [x1, y2, z2];
  };

  let w = 0, h = 0, dpr = 1, R = 1, cx = 0, cy0 = 0;
  const fit = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = host.clientWidth;
    h = host.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    R = Math.min(w, h) * 0.43;
    cx = w / 2;
    cy0 = h / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  let yaw = rad(-8);
  const draw = () => {
    ctx.clearRect(0, 0, w, h);

    // dots, far side faint
    for (const v of dots) {
      const [x, y, z] = project(v, yaw);
      if (z < -0.12) continue;
      const k = Math.min(1, (z + 0.12) / 1.12);
      ctx.globalAlpha = 0.18 + k * 0.72;
      ctx.beginPath();
      ctx.arc(cx + x * R, cy0 - y * R, 0.45 + k * 0.75, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = INK;

    // the arcs, each segment faded by its depth
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.1;
    ctx.lineCap = "round";
    for (const pts of arcs) {
      for (let i = 1; i < pts.length; i++) {
        const a = project(pts[i - 1], yaw);
        const b = project(pts[i], yaw);
        if (a[2] < -0.05 || b[2] < -0.05) continue;
        const k = Math.min(1, (Math.min(a[2], b[2]) + 0.05) / 1.05);
        ctx.globalAlpha = 0.18 + k * 0.62;
        ctx.beginPath();
        ctx.moveTo(cx + a[0] * R, cy0 - a[1] * R);
        ctx.lineTo(cx + b[0] * R, cy0 - b[1] * R);
        ctx.stroke();
      }
      const end = project(pts[pts.length - 1], yaw);
      if (end[2] > -0.05) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = ACCENT;
        ctx.beginPath();
        ctx.arc(cx + end[0] * R, cy0 - end[1] * R, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Delhi: a filled mark and a ring
    const hp = project(HOME, yaw);
    if (hp[2] > -0.05) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(cx + hp[0] * R, cy0 - hp[1] * R, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx + hp[0] * R, cy0 - hp[1] * R, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  /* ------------------------------------------------------------ the loop */
  let live = false, raf = 0, last = 0, drag = null;
  const step = (now) => {
    const dt = last ? Math.min(64, now - last) : 16;
    last = now;
    yaw += drag ? 0 : dt * 0.000045;
    draw();
    raf = requestAnimationFrame(step);
  };
  const play = () => {
    if (live || reduce) return;
    live = true;
    last = 0;
    raf = requestAnimationFrame(step);
  };
  const pause = () => {
    live = false;
    cancelAnimationFrame(raf);
  };

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) e.isIntersecting ? play() : pause();
  }, { rootMargin: "200px" });

  canvas.addEventListener("pointerdown", (e) => {
    if (reduce) return;
    drag = { x: e.clientX, y: yaw };
    canvas.setPointerCapture(e.pointerId);
    pause();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    yaw = drag.y + (e.clientX - drag.x) * 0.008;
    draw();
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    play();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  addEventListener("resize", () => { fit(); draw(); });

  fit();
  draw();
  host.setAttribute("data-globe-ready", "");
  if (!reduce) { io.observe(host); play(); }
}
