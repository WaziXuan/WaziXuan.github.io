// octopoup — concept B "abyss": night water, a matte octopus lit only by the plankton you carry
'use strict';

const cv = document.getElementById('c');
const g = cv.getContext('2d');
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.3 : 1;
const coarse = matchMedia('(pointer: coarse)').matches;
const DPR = Math.min(devicePixelRatio || 1, coarse ? 1.5 : 2);

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, k) => a + (b - a) * k;
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const sstep = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// palette
const BODY = [38, 70, 84];       // matte teal-slate
const BODY_BACK = [24, 48, 60];
const GLOW = [150, 225, 225];    // plankton / bioluminescence
const EYE = '#070d14';

let W = 0, H = 0, R = 0, HX = 0, HY = 0;
let bgGrad = null, hazeGrad = null;
function resize() {
  W = innerWidth; H = innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  R = clamp(Math.min(W * 0.2, H * 0.145), 44, 180);
  HX = W / 2; HY = H * 0.45;
  bgGrad = g.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#0a2230');
  bgGrad.addColorStop(0.5, '#051621');
  bgGrad.addColorStop(1, '#020a10');
  hazeGrad = g.createRadialGradient(W * 0.5, -H * 0.2, 0, W * 0.5, -H * 0.2, H * 0.9);
  hazeGrad.addColorStop(0, 'rgba(90,150,160,0.22)');
  hazeGrad.addColorStop(1, 'rgba(90,150,160,0)');
}
addEventListener('resize', resize);
resize();

// film grain tile
const grain = document.createElement('canvas');
grain.width = grain.height = 256;
{
  const gg = grain.getContext('2d');
  const id = gg.createImageData(256, 256);
  for (let i = 0; i < id.data.length; i += 4) {
    const v = Math.random();
    id.data[i] = 200; id.data[i + 1] = 220; id.data[i + 2] = 225;
    id.data[i + 3] = v * 9;
  }
  gg.putImageData(id, 0, 0);
}
let grainPat = null;

// marine snow
const SNOW = 110;
const snow = Array.from({ length: SNOW }, () => ({ x: Math.random(), y: Math.random(), s: rand(0.6, 1.6), v: rand(0.004, 0.012), ph: rand(0, 6.28) }));

// ---------- octopus model ----------
const ARMS = 8, N = 34;
const CURL = [1.0, 0.7, -0.8, 1.0, 1.0, -0.8, 0.7, 1.0];
const LEN = [2.0, 1.85, 2.15, 1.95, 1.95, 2.15, 1.85, 2.0];

class Arm {
  constructor(k) {
    this.k = k;
    const a = lerp(-1, 1, k / (ARMS - 1));
    this.a = a;
    this.sgn = a < 0 ? -1 : 1;
    this.z = Math.cos(a * 1.15);
    this.bx = 0.72 * a * (1 - 0.1 * Math.abs(a));
    this.by = 0.5 - 0.17 * a * a;
    this.th0 = a * 0.72;
    this.curl = CURL[k] * this.sgn;
    this.len = LEN[k];
    this.ph = rand(0, 6.28);
    this.ph2 = rand(0, 6.28);
    this.reach = 0;
    this.P = Array.from({ length: N + 1 }, () => [0, 0]);
    this.Nn = Array.from({ length: N + 1 }, () => [0, 1]);
    this.Rr = new Float32Array(N + 1);
  }
  update(t, dt, tgt, flow, pulse) {
    const P = this.P, ds = this.len / N;
    let x = this.bx, y = this.by, th = this.th0 * (1 - pulse * 0.35);
    P[0][0] = x; P[0][1] = y;
    const fm = Math.hypot(flow[0], flow[1]);
    const fl = Math.min(1, fm / 5);
    const fx = fl > 0.001 ? -flow[0] / fm : 0, fy = fl > 0.001 ? -flow[1] / fm : 0;
    for (let i = 1; i <= N; i++) {
      const s = i / N;
      const wave = Math.sin(t * 1.25 - s * 4.2 + this.ph) * calm;
      const wave2 = Math.sin(t * 0.7 + s * 2.1 + this.ph2) * calm;
      th += ((this.curl * (0.1 + 3.6 * s * s)) * (1 - pulse * 0.6) + 0.8 * wave * s + 0.2 * wave2) * ds;
      let dx = Math.sin(th), dy = Math.cos(th);
      if (fl > 0.02) { const w = fl * 0.55 * s; dx = lerp(dx, fx, w); dy = lerp(dy, fy, w); }
      if (this.reach > 0.002) {
        let tx = tgt[0] - x, ty = tgt[1] - y;
        const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
        const w = this.reach * 0.6 * sstep(s, 0.12, 0.9);
        dx = lerp(dx, tx, w); dy = lerp(dy, ty, w);
      }
      const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      x += dx * ds; y += dy * ds;
      P[i][0] = x; P[i][1] = y;
    }
    for (let i = 0; i <= N; i++) {
      const a = P[Math.max(i - 1, 0)], b = P[Math.min(i + 1, N)];
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const l = Math.hypot(tx, ty) || 1;
      this.Nn[i][0] = -ty / l; this.Nn[i][1] = tx / l;
      const s = i / N;
      this.Rr[i] = 0.19 * Math.pow(1 - s, 1.35) + 0.03 * (1 - s * s * s * s);
    }
  }
  path(ctx, scale) {
    const P = this.P, Nn = this.Nn, Rr = this.Rr;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const r = Rr[i] * scale;
      const X = P[i][0] * scale + Nn[i][0] * r, Y = P[i][1] * scale + Nn[i][1] * r;
      if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    {
      const i = N, r = Rr[i] * scale;
      const ang = Math.atan2(Nn[i][1], Nn[i][0]);
      ctx.arc(P[i][0] * scale, P[i][1] * scale, r, ang, ang + Math.PI, true);
    }
    for (let i = N; i >= 0; i--) {
      const r = Rr[i] * scale;
      ctx.lineTo(P[i][0] * scale - Nn[i][0] * r, P[i][1] * scale - Nn[i][1] * r);
    }
    ctx.closePath();
  }
}
const arms = Array.from({ length: ARMS }, (_, k) => new Arm(k));
const backArms = arms.filter((a) => a.z < 0.75);
const frontArms = arms.filter((a) => a.z >= 0.75);

function mantle(ctx, s, br) {
  const w = 1.0 * (1 + br), h = 1 - br * 0.6;
  ctx.beginPath();
  ctx.moveTo(-w, -0.02 * h);
  ctx.bezierCurveTo(-w, -0.62 * h, -0.62 * w, -0.98 * h, 0, -0.98 * h);
  ctx.bezierCurveTo(0.62 * w, -0.98 * h, w, -0.62 * h, w, -0.02 * h);
  ctx.bezierCurveTo(w, 0.38 * h, 0.66 * w, 0.64 * h, 0, 0.64 * h);
  ctx.bezierCurveTo(-0.66 * w, 0.64 * h, -w, 0.38 * h, -w, -0.02 * h);
  ctx.closePath();
}

// ---------- particles ----------
const inks = [], bubbles = [], sparks = [];

function releaseInk(x, y, awayX) {
  for (let i = 0; i < 30; i++) {
    const ang = rand(0, Math.PI * 2);
    const sp = rand(0.15, 1.0);
    inks.push({
      x: x + rand(-0.3, 0.3) * R, y: y + rand(-0.1, 0.3) * R,
      vx: (Math.cos(ang) * sp + awayX * 0.5) * R * 0.9,
      vy: (Math.sin(ang) * sp * 0.7 + 0.15) * R * 0.9,
      r0: rand(0.1, 0.25) * R, r1: rand(0.6, 1.3) * R,
      life: 0, max: rand(3.5, 5.5), a0: rand(0.5, 0.85),
    });
  }
}
function blowBubbles(x, y, n) {
  for (let i = 0; i < n; i++) {
    bubbles.push({
      x: x + rand(-0.1, 0.1) * R, y: y + rand(-0.05, 0.05) * R,
      vx: rand(-0.1, 0.1) * R, vy: -rand(0.35, 0.8) * R,
      r: rand(0.035, 0.11) * R, life: 0, max: rand(2.2, 3.4), wob: rand(0, 6.28),
    });
  }
}

// ---------- input ----------
let pointer = [HX + 2.4 * R, HY - 1.2 * R];
let light = [pointer[0], pointer[1]];
let lastInput = -1e9, hovering = false, timeNow = 0;

function hitsOcto(px, py) {
  const lx = (px - octo.x) / R, ly = (py - octo.y) / R;
  const c = Math.cos(-octo.rot), s = Math.sin(-octo.rot);
  const x = lx * c - ly * s, y = lx * s + ly * c;
  if ((x / 1.08) ** 2 + ((y + 0.16) / 0.9) ** 2 < 1) return true;
  for (const a of arms) {
    for (let i = 0; i <= N; i += 2) {
      if (Math.hypot(a.P[i][0] - x, a.P[i][1] - y) < a.Rr[i] + 0.12) return true;
    }
  }
  return false;
}

addEventListener('pointermove', (e) => {
  pointer = [e.clientX, e.clientY];
  lastInput = timeNow;
  hovering = hitsOcto(e.clientX, e.clientY);
}, { passive: true });
addEventListener('pointerdown', (e) => {
  pointer = [e.clientX, e.clientY];
  light = [e.clientX, e.clientY];
  lastInput = timeNow;
  if (hitsOcto(e.clientX, e.clientY)) startle();
  else blowBubbles(e.clientX, e.clientY, 7);
});
addEventListener('pointerup', () => { lastInput = timeNow; });
addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- state ----------
const octo = {
  x: HX, y: HY, rot: 0,
  ox: 0, oy: -4 * R, vx: 0, vy: 0,
  swimT: 99, nextSwim: 0.3, flash: 0, squint: 0, blink: 0, nextBlink: 2.2,
  lastStartle: -9, excite: 0, glow: 0,
};

function swim(strength, dx, dy) {
  octo.swimT = 0;
  octo.vx += dx * 2.4 * strength * R;
  octo.vy += dy * 2.4 * strength * R;
}

function startle() {
  if (timeNow - octo.lastStartle < 1.2) return;
  octo.lastStartle = timeNow;
  let ax = octo.x - light[0], ay = octo.y - light[1];
  const l = Math.hypot(ax, ay);
  if (l < 1) { ax = Math.random() < 0.5 ? -1 : 1; ay = 0; } else { ax /= l; ay /= l; }
  ay = clamp(ay, -0.35, 0.25);
  if (Math.abs(ax) < 0.55) ax = Math.sign(ax || 1) * 0.85;
  const n = Math.hypot(ax, ay); ax /= n; ay /= n;
  releaseInk(octo.x, octo.y + 0.35 * R, -ax);
  octo.flash = 1; octo.squint = 1;
  swim(2.1, ax, ay - 0.15);
}

// light falling on a shape: call with the shape already as the current path
function litFill(base, lightScreen, ox, oy, strength) {
  // base matte colour
  g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  g.fill();
  // soft illumination from the plankton (screen-space gradient, in local coords)
  const lx = lightScreen[0], ly = lightScreen[1];
  const rad = R * 2.6;
  const gr = g.createRadialGradient(lx, ly, 0, lx, ly, rad);
  gr.addColorStop(0, `rgba(${GLOW[0]},${GLOW[1]},${GLOW[2]},${0.55 * strength})`);
  gr.addColorStop(0.3, `rgba(${GLOW[0]},${GLOW[1]},${GLOW[2]},${0.2 * strength})`);
  gr.addColorStop(1, `rgba(${GLOW[0]},${GLOW[1]},${GLOW[2]},0)`);
  g.fillStyle = gr;
  g.fill();
  // deep-water shading from below
  const sh = g.createLinearGradient(0, -1.2 * R, 0, 2.2 * R);
  sh.addColorStop(0, 'rgba(2,10,16,0)');
  sh.addColorStop(1, 'rgba(2,10,16,0.45)');
  g.fillStyle = sh;
  g.fill();
}

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  timeNow += dt; const t = timeNow;

  const idle = t - lastInput > 3.5;
  if (idle) {
    const tx = HX + 2.5 * R * Math.sin(t * 0.31 * calm + 0.4);
    const ty = HY - 0.5 * R + 1.5 * R * Math.sin(t * 0.47 * calm + 1.3);
    light[0] = lerp(light[0], tx, damp(1.1, dt));
    light[1] = lerp(light[1], ty, damp(1.1, dt));
  } else {
    light[0] = lerp(light[0], pointer[0], damp(16, dt));
    light[1] = lerp(light[1], pointer[1], damp(16, dt));
  }
  // bioluminescent trail
  if (Math.random() < dt * 14 * calm) {
    sparks.push({ x: light[0] + rand(-4, 4), y: light[1] + rand(-4, 4), vx: rand(-6, 6), vy: rand(-10, 2), life: 0, max: rand(0.8, 1.8), r: rand(0.6, 1.5) });
  }

  const dist = Math.hypot(light[0] - octo.x, light[1] - octo.y) / R;
  const near = 1 - sstep(dist, 1.9, 3.6);
  const hov = hovering && !idle ? 1 : 0;
  octo.excite = lerp(octo.excite, Math.max(near, hov), damp(3, dt));
  octo.glow = lerp(octo.glow, octo.excite, damp(1.6, dt));
  octo.flash = Math.max(0, octo.flash - dt * 0.55);
  octo.squint = Math.max(0, octo.squint - dt * 0.9);

  octo.swimT += dt;
  if (octo.swimT > octo.nextSwim) {
    const low = octo.oy > 1.6 * R;
    swim(low ? 2.0 : 0.45, 0, -1);
    octo.nextSwim = low ? 1.2 : rand(5, 9);
  }
  const pulse = Math.sin(Math.min(octo.swimT / 1.3, 1) * Math.PI) ** 2 * (octo.swimT < 0.4 ? octo.swimT / 0.4 : 1) * calm;
  const spring = (t - octo.lastStartle < 2.2 ? 0.6 : 2.2);
  octo.vx -= octo.ox * spring * dt; octo.vy -= octo.oy * spring * dt;
  const dmp = 1 - damp(1.4, dt);
  octo.vx *= dmp; octo.vy *= dmp;
  octo.ox += octo.vx * dt; octo.oy += octo.vy * dt;
  if (octo.oy < -0.9 * R) { octo.oy = -0.9 * R; octo.vy = Math.max(octo.vy, 0); }
  const lim = Math.min(3 * R, W * 0.5 - 1.4 * R);
  octo.ox = clamp(octo.ox, -lim, lim);

  const fx = (light[0] - HX) * 0.07, fy = (light[1] - HY) * 0.05;
  octo.x = HX + octo.ox + fx;
  octo.y = HY + octo.oy + fy + Math.sin(t * 0.8) * 0.08 * R * calm;
  const leanT = clamp((light[0] - octo.x) / R * 0.05, -0.13, 0.13) + octo.vx / R * 0.02;
  octo.rot = lerp(octo.rot, leanT, damp(2.5, dt));

  const c = Math.cos(-octo.rot), s = Math.sin(-octo.rot);
  const lx = (light[0] - octo.x) / R, ly = (light[1] - octo.y) / R;
  const tgt = [lx * c - ly * s, lx * s + ly * c];
  const lightLocal = [tgt[0] * R, tgt[1] * R];
  let best = -1, bestD = 1e9;
  arms.forEach((a, k) => {
    const p = a.P[N >> 1];
    const d = Math.hypot(p[0] - tgt[0], p[1] - tgt[1]);
    if (d < bestD) { bestD = d; best = k; }
  });
  const reachOK = bestD < 3.0 && octo.flash < 0.3;
  const flow = [octo.vx / R, octo.vy / R];
  arms.forEach((a, k) => {
    a.reach = lerp(a.reach, k === best && reachOK ? 0.9 : 0, damp(k === best ? 2 : 1.2, dt));
    a.update(t, dt, tgt, flow, pulse);
  });

  octo.nextBlink -= dt;
  if (octo.nextBlink < 0) { octo.blink = 1; octo.nextBlink = rand(2.5, 6); }
  octo.blink = Math.max(0, octo.blink - dt * 7);
  const blinkAmt = Math.max(Math.sin(octo.blink * Math.PI), sstep(octo.squint, 0.5, 0.8));

  // ---- render ----
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.fillStyle = bgGrad; g.fillRect(0, 0, W, H);
  g.fillStyle = hazeGrad; g.fillRect(0, 0, W, H);

  // marine snow
  for (const p of snow) {
    p.y += p.v * dt * calm; if (p.y > 1.02) { p.y = -0.02; p.x = Math.random(); }
    const X = p.x * W + Math.sin(t * 0.25 + p.ph) * 6, Y = p.y * H;
    g.fillStyle = `rgba(170,200,205,${0.08 + 0.1 * p.s})`;
    g.beginPath(); g.arc(X, Y, p.s, 0, Math.PI * 2); g.fill();
  }

  // bubbles
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const q = bubbles[i]; q.life += dt;
    const k = q.life / q.max;
    if (k >= 1) { bubbles.splice(i, 1); continue; }
    q.x += q.vx * dt + Math.sin(t * 3.5 + q.wob) * 0.25; q.y += q.vy * dt; q.vy -= 0.25 * R * dt;
    g.beginPath(); g.arc(q.x, q.y, q.r * (0.7 + 0.3 * k), 0, Math.PI * 2);
    g.strokeStyle = `rgba(190,225,230,${0.55 * (1 - k)})`;
    g.lineWidth = 1; g.stroke();
    g.fillStyle = `rgba(190,225,230,${0.35 * (1 - k)})`;
    g.beginPath(); g.arc(q.x - q.r * 0.3, q.y - q.r * 0.3, q.r * 0.22, 0, Math.PI * 2); g.fill();
  }

  // octopus
  g.save();
  g.translate(octo.x, octo.y);
  g.rotate(octo.rot);
  const br = Math.sin(t * 1.6) * 0.022 * calm - pulse * 0.05;

  for (const a of backArms) { a.path(g, R); litFill(BODY_BACK, lightLocal, 0, 0, 0.6); }
  g.save(); g.scale(R, R); mantle(g, 1, br); g.restore();
  litFill(BODY, lightLocal, 0, 0, 1);
  for (const a of frontArms) { a.path(g, R); litFill(BODY, lightLocal, 0, 0, 1); }

  // bioluminescent dots along the front arms + mantle freckles (brighten with curiosity)
  {
    const ga = 0.1 + 0.6 * octo.glow;
    g.fillStyle = `rgba(${GLOW[0]},${GLOW[1]},${GLOW[2]},${ga})`;
    for (const a of frontArms) {
      for (let i = 3; i < N - 1; i += 3) {
        const r = a.Rr[i] * R;
        const px = a.P[i][0] * R - a.Nn[i][0] * r * 0.55 * a.sgn, py = a.P[i][1] * R - a.Nn[i][1] * r * 0.55 * a.sgn;
        g.beginPath(); g.arc(px, py, Math.max(0.7, r * 0.13), 0, Math.PI * 2); g.fill();
      }
    }
    const fr = [[-0.55, -0.55], [-0.2, -0.75], [0.25, -0.7], [0.6, -0.45], [0.05, -0.4], [-0.75, -0.2], [0.8, -0.1]];
    for (const [fxp, fyp] of fr) {
      const pulse2 = 0.7 + 0.3 * Math.sin(t * 1.3 + fxp * 7 + fyp * 3);
      g.fillStyle = `rgba(${GLOW[0]},${GLOW[1]},${GLOW[2]},${ga * pulse2 * 0.8})`;
      g.beginPath(); g.arc(fxp * R, fyp * R, R * 0.022, 0, Math.PI * 2); g.fill();
    }
  }

  // eyes: large, dark, glossy; the glint is the plankton's reflection
  {
    const er = (0.15 + 0.02 * octo.excite) * R;
    let dx = tgt[0], dy = tgt[1] - 0.08;
    const dl = Math.hypot(dx, dy) || 1;
    const off = Math.min(dl / 3, 1) * 0.04 * R;
    const gx = dx / dl * er * 0.42, gy = dy / dl * er * 0.42;
    dx = dx / dl * off; dy = dy / dl * off;
    for (const sx of [-1, 1]) {
      const ex = sx * 0.4 * R + dx, ey = 0.06 * R + dy;
      g.save();
      g.beginPath(); g.ellipse(ex, ey, er, er * (1 - blinkAmt * 0.94), 0, 0, Math.PI * 2); g.clip();
      g.fillStyle = EYE; g.fillRect(ex - er, ey - er, er * 2, er * 2);
      // iris sheen, faint
      const ir = g.createRadialGradient(ex - gx * 0.6, ey - gy * 0.6, 0, ex, ey, er);
      ir.addColorStop(0, 'rgba(120,170,175,0.0)');
      ir.addColorStop(0.75, 'rgba(120,170,175,0.08)');
      ir.addColorStop(1, 'rgba(120,170,175,0.3)');
      g.fillStyle = ir; g.fillRect(ex - er, ey - er, er * 2, er * 2);
      // glint toward the light
      g.fillStyle = 'rgba(225,245,245,0.95)';
      g.beginPath(); g.arc(ex + gx, ey + gy, er * 0.17, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(225,245,245,0.35)';
      g.beginPath(); g.arc(ex - gx * 0.5, ey - gy * 0.5 + er * 0.3, er * 0.09, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  }
  g.restore();

  // ink: dark cloud that swallows light
  for (let i = inks.length - 1; i >= 0; i--) {
    const q = inks[i]; q.life += dt;
    const k = q.life / q.max;
    if (k >= 1) { inks.splice(i, 1); continue; }
    q.x += q.vx * dt; q.y += q.vy * dt;
    q.vx *= 1 - damp(1.5, dt); q.vy *= 1 - damp(1.5, dt); q.vy += 0.03 * R * dt;
    const r = lerp(q.r0, q.r1, Math.sqrt(k));
    const a = q.a0 * Math.min(1, k * 10) * (1 - k);
    const gr = g.createRadialGradient(q.x, q.y, 0, q.x, q.y, r);
    gr.addColorStop(0, `rgba(2,6,10,${a})`);
    gr.addColorStop(0.5, `rgba(2,6,10,${a * 0.6})`);
    gr.addColorStop(1, 'rgba(2,6,10,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(q.x, q.y, r, 0, Math.PI * 2); g.fill();
  }

  // sparks (trail)
  for (let i = sparks.length - 1; i >= 0; i--) {
    const q = sparks[i]; q.life += dt;
    const k = q.life / q.max;
    if (k >= 1) { sparks.splice(i, 1); continue; }
    q.x += q.vx * dt; q.y += q.vy * dt;
    g.fillStyle = `rgba(${GLOW[0]},${GLOW[1]},${GLOW[2]},${0.7 * (1 - k)})`;
    g.beginPath(); g.arc(q.x, q.y, q.r * (1 - k * 0.5), 0, Math.PI * 2); g.fill();
  }

  // the plankton
  {
    const tw = 1 + 0.08 * Math.sin(t * 5.1) + (hov ? 0.45 : 0);
    const hr = R * 0.7 * tw;
    const gr = g.createRadialGradient(light[0], light[1], 0, light[0], light[1], hr);
    gr.addColorStop(0, `rgba(${GLOW[0]},${GLOW[1]},${GLOW[2]},0.5)`);
    gr.addColorStop(0.25, `rgba(${GLOW[0]},${GLOW[1]},${GLOW[2]},0.12)`);
    gr.addColorStop(1, `rgba(${GLOW[0]},${GLOW[1]},${GLOW[2]},0)`);
    g.fillStyle = gr;
    g.beginPath(); g.arc(light[0], light[1], hr, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#eafcfc';
    g.beginPath(); g.arc(light[0], light[1], 3 * (1 + 0.12 * Math.sin(t * 5.1)), 0, Math.PI * 2); g.fill();
  }

  // vignette + grain
  {
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(1,5,9,0)');
    vg.addColorStop(1, 'rgba(1,5,9,0.55)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
  }
  if (!grainPat) grainPat = g.createPattern(grain, 'repeat');
  g.fillStyle = grainPat;
  g.fillRect(0, 0, W, H);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
