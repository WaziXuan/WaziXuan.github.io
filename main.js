import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const calm = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.35 : 1;
const coarse = matchMedia('(pointer: coarse)').matches;
const UP = new THREE.Vector3(0, 1, 0);
const rand = (a, b) => a + Math.random() * (b - a);
const damp = (k, dt) => 1 - Math.exp(-k * dt);

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x06303c, 0.04);

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 120);
const TAN_HALF = Math.tan(THREE.MathUtils.degToRad(19));

function fitCamera() {
  const a = innerWidth / innerHeight;
  camera.aspect = a;
  camera.position.set(0, 0.2, a < 1 ? 10 / Math.max(a, 0.45) * 0.78 : 10);
  camera.lookAt(0, -0.1, 0);
  camera.updateProjectionMatrix();
}
fitCamera();

// deep-water gradient dome
scene.add(new THREE.Mesh(
  new THREE.SphereGeometry(60, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x2a8ea3) },
      mid: { value: new THREE.Color(0x07384a) },
      bottom: { value: new THREE.Color(0x010608) },
    },
    vertexShader: `varying vec3 vP;
      void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform vec3 top, mid, bottom; varying vec3 vP;
      void main(){
        float h = vP.y;
        vec3 c = h > 0. ? mix(mid, top, smoothstep(0., .55, h)) : mix(mid, bottom, smoothstep(0., .45, -h));
        gl_FragColor = vec4(c, 1.);
      }`,
  }),
));

scene.add(new THREE.HemisphereLight(0x9fe8ff, 0x0b1c26, 1.3));
const sun = new THREE.DirectionalLight(0xe2f9ff, 2.4);
sun.position.set(2, 8, 5);
scene.add(sun);
const rim = new THREE.DirectionalLight(0xff9fc6, 1.8);
rim.position.set(-4, 2.5, -6);
scene.add(rim);

// ---------- textures ----------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const skinTex = canvasTex(512, 256, (g, w, h) => {
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 300; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = rand(2, 10);
    for (const ox of [-w, 0, w]) {
      const grd = g.createRadialGradient(x + ox, y, 0, x + ox, y, r);
      grd.addColorStop(0, 'rgba(140,30,40,0.5)');
      grd.addColorStop(1, 'rgba(140,30,40,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x + ox, y, r, 0, Math.PI * 2); g.fill();
    }
  }
});
skinTex.wrapS = skinTex.wrapT = THREE.RepeatWrapping;

const glowTex = canvasTex(128, 128, (g, w) => {
  const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, w);
});

const rayTex = canvasTex(64, 256, (g, w, h) => {
  const v = g.createLinearGradient(0, 0, 0, h);
  v.addColorStop(0, 'rgba(255,255,255,1)');
  v.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-in';
  const s = g.createLinearGradient(0, 0, w, 0);
  s.addColorStop(0, 'rgba(0,0,0,0)');
  s.addColorStop(0.5, 'rgba(0,0,0,1)');
  s.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = s;
  g.fillRect(0, 0, w, h);
});

// ---------- environment: light shafts + marine snow ----------
const shafts = [];
for (let i = 0; i < 5; i++) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(rand(1.2, 2.6), 16),
    new THREE.MeshBasicMaterial({
      map: rayTex, color: 0xaef4ff, transparent: true, opacity: rand(0.04, 0.09),
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }),
  );
  m.position.set(rand(-6, 6), 5, rand(-8, -3));
  m.rotation.z = rand(-0.35, 0.05);
  m.userData = { base: m.rotation.z, ph: rand(0, 6) };
  shafts.push(m);
  scene.add(m);
}

const SNOW = 700;
const snowPos = new Float32Array(SNOW * 3);
for (let i = 0; i < SNOW; i++) {
  snowPos[i * 3] = rand(-10, 10);
  snowPos[i * 3 + 1] = rand(-6, 6);
  snowPos[i * 3 + 2] = rand(-8, 5);
}
const snowGeo = new THREE.BufferGeometry();
snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({
  map: glowTex, color: 0xcff3ff, size: 0.07, transparent: true, opacity: 0.55,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
scene.add(snow);

// ---------- octopus ----------
const octo = new THREE.Group();
scene.add(octo);
const HOME = new THREE.Vector3(0, 0.35, 0);

const skin = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, map: skinTex, vertexColors: true,
  roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.35,
  sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xffc4b4),
});
const C_TOP = new THREE.Color(0xe9533e);
const C_BELLY = new THREE.Color(0xffcdb8);

const bodyGeo = new THREE.SphereGeometry(1, 80, 60);
{
  const p = bodyGeo.attributes.position, v = new THREE.Vector3(), col = [];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const up = Math.max(0, v.y);
    v.y = v.y > 0 ? v.y * 1.55 : v.y * 0.82;
    v.z -= up * up * 0.6;
    const cheek = 1 + 0.13 * Math.exp(-(((v.y - 0.02) / 0.38) ** 2));
    v.x *= (1 - up * 0.1) * cheek;
    v.z *= cheek * 0.5 + 0.5;
    p.setXYZ(i, v.x, v.y, v.z);
    const c = C_TOP.clone().lerp(C_BELLY, THREE.MathUtils.smoothstep(-v.y, 0.15, 0.75) * 0.85);
    col.push(c.r, c.g, c.b);
  }
  bodyGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  bodyGeo.computeVertexNormals();
}
const body = new THREE.Mesh(bodyGeo, skin);
octo.add(body);

// eyes
const lidMat = new THREE.MeshPhysicalMaterial({
  color: C_TOP, map: skinTex, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.35,
});
const eyeBallGeo = new THREE.SphereGeometry(0.25, 32, 24);
const eyeBallMat = new THREE.MeshPhysicalMaterial({ color: 0xfff4d6, emissive: 0x3a2e22, roughness: 0.12, clearcoat: 1 });
const pupilMat = new THREE.MeshStandardMaterial({ color: 0x07070c, roughness: 0.15 });
const glintMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(2.2), fog: false });
const eyes = [-1, 1].map((sx) => {
  const g = new THREE.Group();
  g.position.set(sx * 0.44, 0.1, 0.8);
  const look = new THREE.Group();
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), pupilMat);
  pupil.scale.set(0.13, 0.06, 0.03);
  pupil.position.z = 0.235;
  look.add(new THREE.Mesh(eyeBallGeo, eyeBallMat), pupil);
  const glint = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), glintMat);
  glint.position.set(0.07, 0.09, 0.225);
  const lid = new THREE.Mesh(new THREE.SphereGeometry(0.268, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), lidMat);
  g.add(look, glint, lid);
  body.add(g);
  return { g, look, pupil, lid };
});

// arms
const N = 46, RAD = 12, ARMS = 8, SUCK = 14;
const suckers = new THREE.InstancedMesh(
  new THREE.SphereGeometry(1, 12, 8),
  new THREE.MeshPhysicalMaterial({ color: 0xffd8c8, roughness: 0.35, clearcoat: 0.5 }),
  ARMS * SUCK * 2,
);
octo.add(suckers);

const _t = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(),
  _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);

class Arm {
  constructor(k) {
    const a = (k + 0.5) / ARMS * Math.PI * 2;
    this.o = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    this.side = new THREE.Vector3().crossVectors(UP, this.o);
    this.base = this.o.clone().multiplyScalar(0.56).setY(-0.6);
    this.ph = rand(0, 6.28);
    this.ph2 = rand(0, 6.28);
    this.len = rand(2.9, 3.4);
    this.reach = 0;
    this.P = Array.from({ length: N + 1 }, () => new THREE.Vector3());
    this.T = Array.from({ length: N + 1 }, () => new THREE.Vector3());
    this.Nm = Array.from({ length: N + 1 }, () => new THREE.Vector3());
    this.B = Array.from({ length: N + 1 }, () => new THREE.Vector3());
    this.R = new Float32Array(N + 1);

    const vc = (N + 1) * (RAD + 1);
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(vc * 3), 3);
    this.nor = new THREE.BufferAttribute(new Float32Array(vc * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.nor.setUsage(THREE.DynamicDrawUsage);
    const col = new Float32Array(vc * 3), uv = new Float32Array(vc * 2), idx = [];
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= RAD; j++) {
        const v = i * (RAD + 1) + j, th = j / RAD * Math.PI * 2;
        const c = C_TOP.clone().lerp(C_BELLY, THREE.MathUtils.smoothstep((1 - Math.cos(th)) / 2, 0.55, 0.85));
        col.set([c.r, c.g, c.b], v * 3);
        uv.set([j / RAD, i / N * 3], v * 2);
        if (i < N && j < RAD) {
          const a0 = v, b0 = v + RAD + 1, c0 = b0 + 1, d0 = v + 1;
          idx.push(a0, d0, b0, b0, d0, c0);
        }
      }
    }
    geo.setAttribute('position', this.pos);
    geo.setAttribute('normal', this.nor);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, skin);
    this.mesh.frustumCulled = false;
    octo.add(this.mesh);
  }

  update(t, pulse, target) {
    const P = this.P, ds = this.len / N;
    P[0].copy(this.base);
    let phi = -1.05 + pulse * 0.8;
    for (let i = 1; i <= N; i++) {
      const s = i / N;
      const wave = Math.sin(t * 1.5 - s * 5 + this.ph) * calm;
      phi += ds * ((0.12 + 1.7 * s * s) * (1 - pulse * 0.85) + 0.95 * wave * s);
      const psi = 0.5 * s * Math.sin(t * 0.85 - s * 3.4 + this.ph2) * calm;
      _d.copy(this.o).multiplyScalar(Math.cos(phi) * Math.cos(psi))
        .addScaledVector(UP, Math.sin(phi) * Math.cos(psi))
        .addScaledVector(this.side, Math.sin(psi));
      if (this.reach > 0.001) {
        _t.subVectors(target, P[i - 1]).normalize();
        _d.lerp(_t, this.reach * 0.55 * THREE.MathUtils.smoothstep(s, 0.15, 0.9)).normalize();
      }
      P[i].copy(P[i - 1]).addScaledVector(_d, ds);
    }
    // frames (parallel transport)
    const T = this.T, Nm = this.Nm, B = this.B;
    for (let i = 0; i <= N; i++) T[i].subVectors(P[Math.min(i + 1, N)], P[Math.max(i - 1, 0)]).normalize();
    Nm[0].copy(UP).addScaledVector(T[0], -T[0].dot(UP)).normalize();
    for (let i = 1; i <= N; i++) {
      _q.setFromUnitVectors(T[i - 1], T[i]);
      Nm[i].copy(Nm[i - 1]).applyQuaternion(_q);
      Nm[i].addScaledVector(T[i], -Nm[i].dot(T[i])).normalize();
    }
    for (let i = 0; i <= N; i++) B[i].crossVectors(T[i], Nm[i]);
    // skin
    const pa = this.pos.array, na = this.nor.array;
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      const r = 0.2 * Math.pow(1 - s, 1.25) + 0.03 * (1 - s ** 6);
      this.R[i] = r;
      for (let j = 0; j <= RAD; j++) {
        const th = j / RAD * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
        const nx = c * Nm[i].x + sn * B[i].x, ny = c * Nm[i].y + sn * B[i].y, nz = c * Nm[i].z + sn * B[i].z;
        const v = (i * (RAD + 1) + j) * 3;
        pa[v] = P[i].x + r * nx; pa[v + 1] = P[i].y + r * ny; pa[v + 2] = P[i].z + r * nz;
        na[v] = nx; na[v + 1] = ny; na[v + 2] = nz;
      }
    }
    this.pos.needsUpdate = true;
    this.nor.needsUpdate = true;
  }

  writeSuckers(k) {
    let n = k * SUCK * 2;
    for (let q = 0; q < SUCK; q++) {
      const i = Math.round(3 + q / (SUCK - 1) * (N - 9));
      const r = this.R[i];
      for (const off of [-0.42, 0.42]) {
        const th = Math.PI + off;
        _d.copy(this.Nm[i]).multiplyScalar(Math.cos(th)).addScaledVector(this.B[i], Math.sin(th));
        _t.copy(this.P[i]).addScaledVector(_d, r * 0.9);
        _q.setFromUnitVectors(_z, _d);
        const sz = r * 0.34;
        _m.compose(_t, _q, _s.set(sz, sz, sz * 0.5));
        suckers.setMatrixAt(n++, _m);
      }
    }
  }
}
const arms = Array.from({ length: ARMS }, (_, k) => new Arm(k));

// ---------- the plankton cursor ----------
const orb = new THREE.Group();
const orbCore = new THREE.Mesh(
  new THREE.SphereGeometry(0.055, 16, 12),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(0xc8ffff).multiplyScalar(5), fog: false }),
);
const orbGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTex, color: 0x6ff3ff, transparent: true, opacity: 0.85,
  blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
}));
orbGlow.scale.setScalar(0.9);
const orbLight = new THREE.PointLight(0x7ff6ff, 2.6, 5, 1.8);
orb.add(orbCore, orbGlow, orbLight);
orb.position.set(2.5, 1.2, 1.6);
scene.add(orb);

// ---------- particles: ink + bubbles ----------
function particlePool(count, color, blending, ring) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3), size = new Float32Array(count), alpha = new Float32Array(count);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uScale: { value: 1 } },
    defines: ring ? { RING: 1 } : {},
    vertexShader: `attribute float aSize; attribute float aAlpha; uniform float uScale; varying float vA;
      void main(){ vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.);
        gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main(){ float d = length(gl_PointCoord - .5);
        #ifdef RING
          float a = smoothstep(.5, .43, d) * (smoothstep(.28, .45, d) + .5 * smoothstep(.16, .0, length(gl_PointCoord - vec2(.35, .32))));
        #else
          float a = pow(smoothstep(.5, .0, d), 1.6);
        #endif
        gl_FragColor = vec4(uColor, a * vA); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  const ps = Array.from({ length: count }, () => ({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), s0: 0, s1: 0, a0: 0, wob: 0 }));
  return { geo, mat, ps, next: 0 };
}
const ink = particlePool(320, 0x0c0618, THREE.NormalBlending, false);
const bubbles = particlePool(160, 0xd8fbff, THREE.AdditiveBlending, true);

function emit(pool, n, at, init) {
  for (let k = 0; k < n; k++) {
    const q = pool.ps[pool.next];
    pool.next = (pool.next + 1) % pool.ps.length;
    q.p.copy(at);
    init(q);
  }
}

function stepPool(pool, dt, physics) {
  const pa = pool.geo.attributes.position.array, sa = pool.geo.attributes.aSize.array, aa = pool.geo.attributes.aAlpha.array;
  pool.ps.forEach((q, i) => {
    if (q.life > 0) {
      q.life -= dt;
      physics(q, dt);
      const k = 1 - Math.max(q.life, 0) / q.max;
      sa[i] = THREE.MathUtils.lerp(q.s0, q.s1, Math.sqrt(k));
      aa[i] = q.a0 * Math.min(1, k * 8) * (1 - k);
    } else aa[i] = 0;
    pa[i * 3] = q.p.x; pa[i * 3 + 1] = q.p.y; pa[i * 3 + 2] = q.p.z;
  });
  pool.geo.attributes.position.needsUpdate = true;
  pool.geo.attributes.aSize.needsUpdate = true;
  pool.geo.attributes.aAlpha.needsUpdate = true;
}

// ---------- post ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.6, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function setScale() {
  const s = renderer.domElement.height / (2 * TAN_HALF);
  ink.mat.uniforms.uScale.value = s;
  bubbles.mat.uniforms.uScale.value = s;
}
setScale();

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  fitCamera();
  setScale();
});

// ---------- input ----------
const ndc = new THREE.Vector2();
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -1.6);
const pointer = new THREE.Vector3();
let lastInput = -1e9, hovering = false;

function toWorld(e) {
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  ray.ray.intersectPlane(plane, pointer);
}

function hitsOcto() {
  if (ray.intersectObject(body, true).length) return true;
  for (const a of arms) {
    octo.updateMatrixWorld();
    for (let i = 0; i <= N; i += 3) {
      _t.copy(a.P[i]).applyMatrix4(octo.matrixWorld);
      if (ray.ray.distanceSqToPoint(_t) < (a.R[i] + 0.12) ** 2) return true;
    }
  }
  return false;
}

addEventListener('pointermove', (e) => {
  toWorld(e);
  lastInput = clock.elapsedTime;
  hovering = hitsOcto();
});
addEventListener('pointerdown', (e) => {
  toWorld(e);
  lastInput = clock.elapsedTime;
  orb.position.copy(pointer);
  if (hitsOcto()) startle();
  else blowBubbles(pointer, 12);
});

// ---------- behaviours ----------
const state = {
  offset: new THREE.Vector3(0, -5.5, 0), vel: new THREE.Vector3(0, 0, 0),
  swimT: 99, nextSwim: 0.2, flash: 0, blush: 0, squint: 0, blink: 0, nextBlink: 2.5,
  lastStartle: -9, excite: 0,
};

function swim(strength = 1, dir = UP) {
  state.swimT = 0;
  state.vel.addScaledVector(dir, 2.6 * strength);
}

function startle() {
  const t = clock.elapsedTime;
  if (t - state.lastStartle < 1.2) return;
  state.lastStartle = t;
  octo.updateMatrixWorld();
  const at = new THREE.Vector3(0, -0.4, 0.3).applyMatrix4(octo.matrixWorld);
  emit(ink, 220, at, (q) => {
    q.p.add(_t.set(rand(-0.45, 0.45), rand(-0.5, 0.3), rand(-0.2, 0.4)));
    q.v.set(rand(-1, 1), rand(-1, 0.6), rand(-0.3, 0.8)).normalize().multiplyScalar(rand(0.4, 1.8));
    q.max = q.life = rand(2.6, 4.2);
    q.s0 = rand(0.1, 0.35); q.s1 = rand(0.6, 1.5); q.a0 = rand(0.25, 0.6);
  });
  state.flash = 1;
  state.squint = 1;
  const away = new THREE.Vector3().subVectors(octo.position, pointer).setZ(0);
  if (away.lengthSq() < 0.01) away.set(Math.random() < 0.5 ? -1 : 1, 0, 0);
  away.normalize();
  away.y = THREE.MathUtils.clamp(away.y, -0.3, 0.3);
  if (Math.abs(away.x) < 0.5) away.x = Math.sign(away.x || 1) * 0.8;
  swim(1.9, away.add(new THREE.Vector3(0, 0.2, -0.3)).normalize());
}

function blowBubbles(at, n) {
  emit(bubbles, n, at, (q) => {
    q.p.add(_t.set(rand(-0.12, 0.12), rand(-0.1, 0.1), rand(-0.1, 0.1)));
    q.v.set(rand(-0.15, 0.15), rand(0.6, 1.4), 0);
    q.max = q.life = rand(2.2, 3.6);
    const s = rand(0.06, 0.2);
    q.s0 = s * 0.6; q.s1 = s; q.a0 = rand(0.5, 0.9); q.wob = rand(0, 6.28);
  });
}

// ---------- loop ----------
const clock = new THREE.Clock();
const autoTarget = new THREE.Vector3();
const local = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const tint = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1), BLUSH = new THREE.Color(0xff8fb6), DARK = new THREE.Color(0x8a1d42);
const LID_BASE = C_TOP.clone();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;

  // plankton: follows the pointer, wanders by itself when left alone
  const idle = t - lastInput > 3.5;
  if (idle) {
    autoTarget.set(2.7 * Math.sin(t * 0.33), 0.4 + 1.3 * Math.sin(t * 0.51 + 1), 1.6 + 0.5 * Math.sin(t * 0.27));
    orb.position.lerp(autoTarget, damp(1.2, dt));
  } else {
    orb.position.lerp(pointer, damp(14, dt));
  }
  const tw = 1 + 0.12 * Math.sin(t * 6.3) + (hovering && !idle ? 0.35 : 0);
  orbGlow.scale.setScalar(THREE.MathUtils.lerp(orbGlow.scale.x, 0.9 * tw, damp(10, dt)));

  // octopus mood
  const dist = orb.position.distanceTo(octo.position);
  const near = 1 - THREE.MathUtils.smoothstep(dist, 1.8, 3.6);
  state.excite = THREE.MathUtils.lerp(state.excite, Math.max(near, hovering && !idle ? 1 : 0), damp(3, dt));
  state.blush = THREE.MathUtils.lerp(state.blush, state.excite * 0.5, damp(2, dt));
  state.flash = Math.max(0, state.flash - dt * 0.55);
  state.squint = Math.max(0, state.squint - dt * 0.9);

  // swimming: periodic jet pulses, plus a spring back home
  state.swimT += dt;
  if (state.swimT > state.nextSwim) {
    const low = state.offset.y < -1.5;
    swim(low ? 2.4 : 0.55);
    state.nextSwim = low ? 1.2 : rand(4.5, 8);
  }
  const pulse = Math.sin(Math.min(state.swimT / 1.3, 1) * Math.PI) ** 2 * (state.swimT < 0.4 ? state.swimT / 0.4 : 1);
  state.vel.addScaledVector(state.offset, -(clock.elapsedTime - state.lastStartle < 2.2 ? 0.6 : 2.2) * dt);
  state.vel.multiplyScalar(1 - damp(1.4, dt));
  state.offset.addScaledVector(state.vel, dt);
  if (state.offset.y > 0.9) { state.offset.y = 0.9; state.vel.y = Math.min(state.vel.y, 0); }
  state.offset.x = THREE.MathUtils.clamp(state.offset.x, -3.2, 3.2);

  const follow = _s.set(orb.position.x * 0.16, orb.position.y * 0.08, 0);
  octo.position.copy(HOME).add(state.offset).add(follow);
  octo.position.y += Math.sin(t * 0.8) * 0.12 * calm;

  const yaw = THREE.MathUtils.clamp(Math.atan2(orb.position.x - octo.position.x, orb.position.z - octo.position.z + 2), -0.55, 0.55);
  const pitch = THREE.MathUtils.clamp(-(orb.position.y - octo.position.y) * 0.1, -0.25, 0.25) - state.vel.y * 0.05;
  octo.rotation.y = THREE.MathUtils.lerp(octo.rotation.y, yaw * 0.7, damp(2.5, dt));
  octo.rotation.x = THREE.MathUtils.lerp(octo.rotation.x, pitch, damp(2.5, dt));
  octo.rotation.z = Math.sin(t * 0.6) * 0.04 * calm;

  // breathing + mantle squeeze while jetting
  const br = Math.sin(t * 1.7) * 0.03 * calm;
  body.scale.set(1 + br - pulse * 0.08, 1 - br * 0.6 + pulse * 0.07, 1 + br - pulse * 0.08);

  // arms: the one closest to the plankton reaches for it
  octo.updateMatrixWorld();
  local.copy(orb.position);
  octo.worldToLocal(local);
  let best = -1, bestD = 1e9;
  arms.forEach((a, k) => {
    const d = a.P[N >> 1].distanceToSquared(local);
    if (d < bestD) { bestD = d; best = k; }
  });
  const reachOK = Math.sqrt(bestD) < 3.2 && state.flash < 0.3;
  arms.forEach((a, k) => {
    a.reach = THREE.MathUtils.lerp(a.reach, k === best && reachOK ? 0.9 : 0, damp(k === best ? 2 : 1.2, dt));
    a.update(t, pulse, local);
    a.writeSuckers(k);
  });
  suckers.instanceMatrix.needsUpdate = true;

  // eyes: track, blink, squint, widen
  state.nextBlink -= dt;
  if (state.nextBlink < 0) { state.blink = 1; state.nextBlink = rand(2.5, 6); }
  state.blink = Math.max(0, state.blink - dt * 7);
  const blinkAmt = Math.sin(state.blink * Math.PI);
  lookTarget.copy(orb.position);
  for (const e of eyes) {
    const q0 = e.look.quaternion.clone();
    e.look.lookAt(lookTarget);
    const q1 = e.look.quaternion.clone();
    e.look.quaternion.copy(q0).slerp(q1, damp(9, dt));
    const open = -0.75 - state.excite * 0.35;
    e.lid.rotation.x = THREE.MathUtils.lerp(open, 1.45, Math.max(blinkAmt, state.squint * 0.6));
    e.pupil.scale.y = THREE.MathUtils.lerp(e.pupil.scale.y, 0.055 + state.excite * 0.05 - state.flash * 0.03, damp(6, dt));
  }

  // colour: blush when curious, dark flush when startled
  tint.copy(WHITE).lerp(BLUSH, state.blush).lerp(DARK, state.flash * 0.7);
  skin.color.copy(tint);
  lidMat.color.copy(LID_BASE).multiply(tint);

  // environment
  shafts.forEach((m) => { m.rotation.z = m.userData.base + Math.sin(t * 0.15 + m.userData.ph) * 0.06; });
  const sp = snowGeo.attributes.position.array;
  for (let i = 0; i < SNOW; i++) {
    sp[i * 3 + 1] -= dt * (0.05 + (i % 7) * 0.01);
    sp[i * 3] += Math.sin(t * 0.3 + i) * dt * 0.03;
    if (sp[i * 3 + 1] < -6) sp[i * 3 + 1] = 6;
  }
  snowGeo.attributes.position.needsUpdate = true;

  stepPool(ink, dt, (q, d) => { q.p.addScaledVector(q.v, d); q.v.multiplyScalar(1 - damp(1.6, d)); q.v.y += 0.05 * d; });
  stepPool(bubbles, dt, (q, d) => {
    q.p.addScaledVector(q.v, d);
    q.p.x += Math.sin(t * 4 + q.wob) * 0.004;
    q.v.y += 0.4 * d;
  });
  if (Math.random() < dt * 0.35) {
    octo.updateMatrixWorld();
    blowBubbles(_t.set(0, 1.4, -0.4).applyMatrix4(octo.matrixWorld), 1);
  }

  composer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
