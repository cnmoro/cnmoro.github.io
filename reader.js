import * as THREE from 'three';

const IS_MOBILE = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || window.innerWidth < 820;

const CFG = {
  pageW: 1.0,
  thickness: 0.0034,
  seg: IS_MOBILE ? 18 : 26,
  rows: IS_MOBILE ? 3 : 5,
  spacingScale: 1.45,
  maxPages: IS_MOBILE ? 24 : 40,
  texWidth: IS_MOBILE ? 640 : 900,
  maxTex: IS_MOBILE ? 6 : 10,
};

const MIN_TEX_W = CFG.texWidth;
const MAX_TEX_W = IS_MOBILE ? 1536 : 2048;
const TEX_BUDGET = IS_MOBILE ? 12e6 : 26e6;

const isPortrait = () => window.innerHeight > window.innerWidth;
let singlePage = IS_MOBILE && isPortrait();
let curlScale = singlePage ? 0.5 : 1;
let sharpening = false;

const PHYS = {
  baseK: 75,
  baseC: 14.5,
  curlK: 65,
  curlC: 14,
  lagGain: 0.3,
  maxCurl: 1.7,
  tipMin: -0.05,
  substeps: 2,
};

const COL = {
  bg: 0x0a0b0e,
  ground: 0x0d0e11,
  rim: 0xefe9dc,
  edge: 0xd8d1c2,
  stackTop: 0x1b1a18,
};

const canvas = document.getElementById('c');
const barfill = document.getElementById('barfill');
const loadtext = document.getElementById('loadtext');
const loader = document.getElementById('loader');
const errBox = document.getElementById('err');
const pageinfo = document.getElementById('pageinfo');
const btnPrev = document.getElementById('prev');
const btnNext = document.getElementById('next');
const fileInput = document.getElementById('file');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_MOBILE ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;
renderer.shadowMap.autoUpdate = false;

let needsRender = true;
let lodDirty = true;
function invalidate() { needsRender = true; }

const scene = new THREE.Scene();
scene.background = new THREE.Color(COL.bg);

const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
camera.up.set(0, 0, -1);
camera.position.set(0, 4, 0);

const key = new THREE.DirectionalLight(0xfff2e0, 2.6);
key.position.set(0.35, 6.0, -3.4);
key.castShadow = true;
key.shadow.mapSize.set(IS_MOBILE ? 512 : 1024, IS_MOBILE ? 512 : 1024);
key.shadow.camera.left = -2.0;
key.shadow.camera.right = 2.0;
key.shadow.camera.top = 2.0;
key.shadow.camera.bottom = -2.0;
key.shadow.camera.near = 0.3;
key.shadow.camera.far = 16;
key.shadow.bias = 0;
key.shadow.normalBias = 0;
key.shadow.radius = 5;
key.shadow.blurSamples = 20;
scene.add(key);
scene.add(key.target);

scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x241d16, 0.55));
const fill = new THREE.DirectionalLight(0x9fb4ff, 0.4);
fill.position.set(-1.6, 2.2, 3.2);
scene.add(fill);

const tempInput = document.getElementById('temp');
const tempVal = document.getElementById('tempval');

function kelvinToRGB(kelvin) {
  const t = kelvin / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }
  if (t <= 19) b = 0;
  else if (t < 66) b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  else b = 255;
  const c = (v) => clamp(v, 0, 255) / 255;
  return [c(r), c(g), c(b)];
}

const fillCool = new THREE.Color(0x9fb4ff);

function setTemperature(kelvin) {
  const [r, g, b] = kelvinToRGB(kelvin);
  key.color.setRGB(r, g, b, THREE.SRGBColorSpace);
  fill.color.setRGB(r, g, b, THREE.SRGBColorSpace).lerp(fillCool, 0.55);
  tempVal.textContent = `${kelvin}K`;
  invalidate();
}

const grainInput = document.getElementById('grain');
const grainVal = document.getElementById('grainval');

function setGrain(v) {
  grainUniforms.strength.value = 0.007 * v;
  const scale = v / 50;
  for (const g of grainMats) g.mat.bumpScale = g.bumpBase * scale;
  grainVal.textContent = `${Math.round(v)}`;
  invalidate();
}

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.MeshStandardMaterial({ color: COL.ground, roughness: 0.95, metalness: 0 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

function makeContactTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 8, 128, 128, 126);
  grad.addColorStop(0, 'rgba(0,0,0,0.62)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.34)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const contact = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: makeContactTexture(), transparent: true, depthWrite: false })
);
contact.rotation.x = -Math.PI / 2;
contact.position.y = 0.0015;
contact.renderOrder = -1;
scene.add(contact);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

class Strand {
  constructor(seg, length) {
    this.n = seg + 1;
    this.nr = seg;
    this.L = length / seg;
    this.x = new Float32Array(this.n);
    this.y = new Float32Array(this.n);
    this.s = new Float32Array(this.nr);
    for (let i = 0; i < this.nr; i++) this.s[i] = (i + 0.5) / this.nr;
    this.phi = 0;
    this.omega = 0;
    this.A = 0;
    this.Av = 0;
    this.baseY = 0;
    this.tx = 0;
  }

  setFlat(phi, baseY) {
    this.phi = phi;
    this.omega = 0;
    this.A = 0;
    this.Av = 0;
    this.baseY = baseY;
    this.tx = 0;
    this.build();
  }

  build() {
    const tx = this.tx;
    let x = 0, y = this.baseY;
    this.x[0] = tx;
    this.y[0] = this.baseY;
    for (let i = 0; i < this.nr; i++) {
      const g = this.s[i] * this.s[i];
      const ang = this.phi + this.A * g;
      x += Math.cos(ang) * this.L;
      y += Math.sin(ang) * this.L;
      this.x[i + 1] = tx + x;
      this.y[i + 1] = y;
    }
  }

  step(h, o) {
    const rel = o.baseTarget - this.phi;
    this.omega += (PHYS.baseK * rel - PHYS.baseC * this.omega) * h;
    this.phi += this.omega * h;
    if (this.phi < o.min) { this.phi = o.min; if (this.omega < 0) this.omega = 0; }
    if (this.phi > o.max) { this.phi = o.max; if (this.omega > 0) this.omega = 0; }

    const aTarget = -PHYS.lagGain * curlScale * this.omega;
    this.Av += (PHYS.curlK * (aTarget - this.A) - PHYS.curlC * this.Av) * h;
    this.A += this.Av * h;

    const aLow = Math.max(-PHYS.maxCurl, PHYS.tipMin - this.phi);
    const aHigh = Math.min(PHYS.maxCurl, Math.PI - PHYS.tipMin - this.phi);
    if (this.A < aLow) { this.A = aLow; if (this.Av < 0) this.Av = 0; }
    if (this.A > aHigh) { this.A = aHigh; if (this.Av > 0) this.Av = 0; }

    this.build();
  }
}

function createPageMesh(frontMat, backMat, rimMat) {
  const n = CFG.seg + 1;
  const row = CFG.rows;
  const Nv = n * (row + 1);

  const bnd = [];
  for (let i = 0; i < n; i++) bnd.push([i, 0]);
  for (let j = 1; j <= row; j++) bnd.push([n - 1, j]);
  for (let i = n - 2; i >= 0; i--) bnd.push([i, row]);
  for (let j = row - 1; j >= 1; j--) bnd.push([0, j]);
  const B = bnd.length;

  const total = 2 * Nv + 2 * B;
  const position = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);

  for (let i = 0; i < n; i++) {
    const s = i / (n - 1);
    for (let j = 0; j <= row; j++) {
      const v = 1 - j / row;
      const fi = i * (row + 1) + j;
      uv[fi * 2] = s; uv[fi * 2 + 1] = v;
      uv[(Nv + fi) * 2] = 1 - s; uv[(Nv + fi) * 2 + 1] = v;
    }
  }
  for (let k = 0; k < B; k++) {
    const u = k / B;
    uv[(2 * Nv + k) * 2] = u; uv[(2 * Nv + k) * 2 + 1] = 0;
    uv[(2 * Nv + B + k) * 2] = u; uv[(2 * Nv + B + k) * 2 + 1] = 1;
  }

  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < row; j++) {
      const a = i * (row + 1) + j;
      const b = i * (row + 1) + j + 1;
      const c = (i + 1) * (row + 1) + j + 1;
      const d = (i + 1) * (row + 1) + j;
      idx.push(a, b, c, a, c, d);
    }
  }
  const frontCount = idx.length;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < row; j++) {
      const a = i * (row + 1) + j;
      const b = i * (row + 1) + j + 1;
      const c = (i + 1) * (row + 1) + j + 1;
      const d = (i + 1) * (row + 1) + j;
      idx.push(Nv + a, Nv + c, Nv + b, Nv + a, Nv + d, Nv + c);
    }
  }
  const backCount = idx.length - frontCount;
  const rimStart = idx.length;
  for (let k = 0; k < B; k++) {
    const k2 = (k + 1) % B;
    idx.push(2 * Nv + k, 2 * Nv + B + k, 2 * Nv + B + k2);
    idx.push(2 * Nv + k, 2 * Nv + B + k2, 2 * Nv + k2);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geom.setIndex(idx);
  geom.addGroup(0, frontCount, 0);
  geom.addGroup(frontCount, backCount, 1);
  geom.addGroup(rimStart, idx.length - rimStart, 2);

  const mesh = new THREE.Mesh(geom, [frontMat, backMat, rimMat]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  const cx = new Float32Array(n), cy = new Float32Array(n);
  const cnx = new Float32Array(n), cny = new Float32Array(n);

  mesh.userData.write = (strand, depth, thickness) => {
    const pos = geom.attributes.position.array;
    const hf = thickness * 0.5;
    for (let i = 0; i < n; i++) {
      let tx, ty;
      if (i === 0) { tx = strand.x[1] - strand.x[0]; ty = strand.y[1] - strand.y[0]; }
      else if (i === n - 1) { tx = strand.x[i] - strand.x[i - 1]; ty = strand.y[i] - strand.y[i - 1]; }
      else { tx = strand.x[i + 1] - strand.x[i - 1]; ty = strand.y[i + 1] - strand.y[i - 1]; }
      const len = Math.hypot(tx, ty) || 1;
      tx /= len; ty /= len;
      const nx = -ty, ny = tx;
      cx[i] = strand.x[i]; cy[i] = strand.y[i]; cnx[i] = nx; cny[i] = ny;
      for (let j = 0; j <= row; j++) {
        const z = -depth * 0.5 + depth * (j / row);
        const fi = i * (row + 1) + j;
        pos[fi * 3] = strand.x[i] + nx * hf;
        pos[fi * 3 + 1] = strand.y[i] + ny * hf;
        pos[fi * 3 + 2] = z;
        const bi = Nv + fi;
        pos[bi * 3] = strand.x[i] - nx * hf;
        pos[bi * 3 + 1] = strand.y[i] - ny * hf;
        pos[bi * 3 + 2] = z;
      }
    }
    for (let k = 0; k < B; k++) {
      const i = bnd[k][0], j = bnd[k][1];
      const z = -depth * 0.5 + depth * (j / row);
      const fi = 2 * Nv + k;
      pos[fi * 3] = cx[i] + cnx[i] * hf;
      pos[fi * 3 + 1] = cy[i] + cny[i] * hf;
      pos[fi * 3 + 2] = z;
      const bi = 2 * Nv + B + k;
      pos[bi * 3] = cx[i] - cnx[i] * hf;
      pos[bi * 3 + 1] = cy[i] - cny[i] * hf;
      pos[bi * 3 + 2] = z;
    }
    geom.attributes.position.needsUpdate = true;
    geom.computeVertexNormals();
    geom.computeBoundingSphere();
  };

  return mesh;
}

function makeBlankTexture() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 12;
  const g = c.getContext('2d');
  g.fillStyle = '#f6f2e9';
  g.fillRect(0, 0, 8, 12);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeEdgeTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#cfc7b6');
  grad.addColorStop(0.5, '#e6dfd0');
  grad.addColorStop(1, '#c8c0af');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  g.fillStyle = 'rgba(120,110,95,.35)';
  for (let y = 0; y < 256; y += 2) g.fillRect(0, y, 4, 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 8);
  return t;
}

function makePaperGrainTexture() {
  const s = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const octaves = [2, 4, 8, 16, 32, 64, 128, 256];
  const amps = [1, 0.8, 0.65, 0.55, 0.48, 0.42, 0.36, 0.3];
  const lattices = octaves.map((f) => {
    const gr = new Float32Array(f * f);
    for (let i = 0; i < f * f; i++) gr[i] = rnd();
    return { f, gr };
  });
  const norm = amps.reduce((a, b) => a + b, 0);

  const img = g.createImageData(s, s);
  const data = img.data;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let v = 0;
      for (let o = 0; o < octaves.length; o++) {
        const lat = lattices[o], f = lat.f, gr = lat.gr;
        const fx = (x / s) * f, fy = (y / s) * f;
        const ix = fx | 0, iy = fy | 0;
        const x0 = ix % f, y0 = iy % f;
        const x1 = (x0 + 1) % f, y1 = (y0 + 1) % f;
        let tx = fx - ix, ty = fy - iy;
        tx = tx * tx * (3 - 2 * tx);
        ty = ty * ty * (3 - 2 * ty);
        const a = gr[y0 * f + x0], b = gr[y0 * f + x1];
        const cc = gr[y1 * f + x0], d = gr[y1 * f + x1];
        v += amps[o] * ((a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty);
      }
      v /= norm;
      v = 0.5 + (v - 0.5) * 0.85 + (rnd() - 0.5) * 0.12;
      const val = Math.max(0, Math.min(255, (128 + (v - 0.5) * 82) | 0));
      const i = (y * s + x) * 4;
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
      data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  const lightPath = new Path2D();
  const darkPath = new Path2D();
  for (let k = 0; k < 12000; k++) {
    const x = rnd() * s, y = rnd() * s;
    const len = 1 + rnd() * 2.5;
    const a = (rnd() - 0.5) * 0.5 + (rnd() > 0.5 ? 0 : Math.PI);
    const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
    const p = rnd() > 0.5 ? lightPath : darkPath;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        p.moveTo(x + ox * s, y + oy * s);
        p.lineTo(x + ox * s + dx, y + oy * s + dy);
      }
    }
  }
  g.globalAlpha = 0.02;
  g.lineWidth = 0.6;
  g.strokeStyle = '#ffffff';
  g.stroke(lightPath);
  g.strokeStyle = '#2b2b2b';
  g.stroke(darkPath);
  g.globalAlpha = 1;

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1.7, 2.4);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const blankTex = makeBlankTexture();
const grainTex = makePaperGrainTexture();

const grainUniforms = { strength: { value: 0.3 } };
const grainMats = [];

function applyPaperGrain(mat, bumpBase) {
  mat.bumpMap = grainTex;
  mat.bumpScale = bumpBase;
  grainMats.push({ mat, bumpBase });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.grainMap = { value: grainTex };
    shader.uniforms.grainStrength = grainUniforms.strength;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D grainMap;\nuniform float grainStrength;'
      )
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n#ifdef USE_MAP\n  float paperGrain = texture2D(grainMap, vMapUv * vec2(1.7, 2.4)).g;\n  diffuseColor.rgb *= 1.0 + grainStrength * (paperGrain - 0.5) * 2.0;\n#endif'
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\n#ifdef USE_MAP\n  roughnessFactor = clamp(roughnessFactor - grainStrength * 0.35 * (paperGrain - 0.5) * 2.0, 0.25, 1.0);\n#endif'
      );
  };
}

const texCache = new Map();
const texUsers = new Map();
let pageSource = null;
let texSeq = 0;

function registerMat(pageIdx, mat) {
  if (pageIdx < 0) return;
  if (!texUsers.has(pageIdx)) texUsers.set(pageIdx, new Set());
  texUsers.get(pageIdx).add(mat);
}

function applyTex(pageIdx, tex) {
  const set = texUsers.get(pageIdx);
  if (!set) return;
  for (const m of set) {
    m.map = tex;
    m.needsUpdate = true;
  }
}

function texelsUsed() {
  let n = 0;
  for (const e of texCache.values()) n += e.pixels;
  return n;
}

function evict() {
  while (texCache.size > 1 && (texCache.size > CFG.maxTex || texelsUsed() > TEX_BUDGET)) {
    let victim = null;
    for (const [k, e] of texCache) {
      if (book.activePages.has(k)) continue;
      if (!victim || e.used < texCache.get(victim).used) victim = k;
    }
    if (victim === null) break;
    texCache.get(victim).tex.dispose();
    texCache.delete(victim);
    applyTex(victim, blankTex);
  }
}

function desiredTexWidth() {
  const wpp = worldPerPixel();
  if (!wpp || !isFinite(wpp)) return MIN_TEX_W;
  const cssWidth = CFG.pageW / wpp;
  return Math.round(clamp(cssWidth * renderer.getPixelRatio(), MIN_TEX_W, MAX_TEX_W));
}

function makeTexture(canvasEl) {
  const t = new THREE.CanvasTexture(sharpening ? sharpenCanvas(canvasEl, 0.65) : canvasEl);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function storeEntry(pageIdx, entry) {
  texCache.set(pageIdx, entry);
  if (texUsers.has(pageIdx)) {
    applyTex(pageIdx, entry.tex);
    evict();
  } else {
    entry.tex.dispose();
    texCache.delete(pageIdx);
  }
}

function getTexture(pageIdx) {
  if (pageIdx < 0 || pageIdx >= pageSource.count) return blankTex;
  const hit = texCache.get(pageIdx);
  if (hit) {
    hit.used = ++texSeq;
    return hit.tex;
  }
  if (!pageSource.pending.has(pageIdx)) {
    pageSource.pending.add(pageIdx);
    pageSource.render(pageIdx, desiredTexWidth()).then((canvasEl) => {
      pageSource.pending.delete(pageIdx);
      if (!canvasEl) return;
      storeEntry(pageIdx, {
        tex: makeTexture(canvasEl),
        used: ++texSeq,
        width: canvasEl.width,
        height: canvasEl.height,
        pixels: canvasEl.width * canvasEl.height,
      });
      invalidate();
    }).catch(() => pageSource.pending.delete(pageIdx));
  }
  return blankTex;
}

function reTexture(idx, entry, width) {
  if (entry.reloading || !pageSource) return;
  entry.reloading = true;
  const old = entry.tex;
  pageSource.render(idx, Math.round(width)).then((canvasEl) => {
    entry.reloading = false;
    if (!canvasEl || !texCache.has(idx)) return;
    const t = makeTexture(canvasEl);
    entry.tex = t;
    entry.used = ++texSeq;
    entry.width = canvasEl.width;
    entry.height = canvasEl.height;
    entry.pixels = canvasEl.width * canvasEl.height;
    applyTex(idx, t);
    old.dispose();
    evict();
    invalidate();
  }).catch(() => { entry.reloading = false; });
}

function updateLOD() {
  if (!pageSource || book.turning) return;
  const want = desiredTexWidth();
  refreshActivePages();
  for (const idx of book.activePages) {
    const e = texCache.get(idx);
    if (!e) continue;
    if (want > e.width * 1.3 && e.width < MAX_TEX_W) reTexture(idx, e, want);
    else if (e.width > want * 2.2 && e.width > MIN_TEX_W) reTexture(idx, e, want);
  }
}

const book = {
  leaves: [],
  p: 0,
  turning: null,
  spacing: CFG.thickness * CFG.spacingScale,
  activePages: new Set(),
};

let depth = CFG.pageW * 1.414;

function flatY(side, leaf) {
  const rank = side === 'R' ? (book.leaves.length - leaf) : (leaf + 1);
  return rank * book.spacing;
}

function newLeaf(frontIdx, backIdx) {
  const frontMat = new THREE.MeshStandardMaterial({
    map: blankTex, roughness: 0.96, metalness: 0, transparent: singlePage,
  });
  const backMat = new THREE.MeshStandardMaterial({
    map: blankTex, roughness: 0.96, metalness: 0, transparent: singlePage,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    map: makeEdgeTexture(),
    color: COL.rim,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: singlePage,
  });
  applyPaperGrain(frontMat, 0.012);
  applyPaperGrain(backMat, 0.012);
  applyPaperGrain(rimMat, 0.007);
  const mesh = createPageMesh(frontMat, backMat, rimMat);
  const strand = new Strand(CFG.seg, CFG.pageW);
  scene.add(mesh);
  const leaf = { front: frontIdx, back: backIdx, side: 'R', mesh, strand, frontMat, backMat, rimMat };
  registerMat(frontIdx, frontMat);
  registerMat(backIdx, backMat);
  return leaf;
}

function fadeLeaf(leaf, k) {
  leaf.frontMat.opacity = k;
  leaf.backMat.opacity = k;
  leaf.rimMat.opacity = k;
}

function refreshActivePages() {
  const N = book.leaves.length;
  book.activePages.clear();
  const order = zoomed
    ? [book.p, book.p - 1]
    : [book.p, book.p - 1, book.p + 1, book.p - 2, book.p + 2];
  const active = new Set();
  for (const i of order) {
    if (i < 0 || i >= N || active.has(i)) continue;
    active.add(i);
    const leaf = book.leaves[i];
    book.activePages.add(leaf.front);
    book.activePages.add(leaf.back);
    const f = getTexture(leaf.front);
    if (leaf.frontMat.map !== f) { leaf.frontMat.map = f; leaf.frontMat.needsUpdate = true; }
    const b = getTexture(leaf.back);
    if (leaf.backMat.map !== b) { leaf.backMat.map = b; leaf.backMat.needsUpdate = true; }
  }
  for (let i = 0; i < N; i++) {
    if (active.has(i)) continue;
    const leaf = book.leaves[i];
    if (leaf.frontMat.map !== blankTex) { leaf.frontMat.map = blankTex; leaf.frontMat.needsUpdate = true; }
    if (leaf.backMat.map !== blankTex) { leaf.backMat.map = blankTex; leaf.backMat.needsUpdate = true; }
  }
  evict();
}

function setLeafFlat(leaf, side) {
  const phi = side === 'R' ? 0 : Math.PI;
  const y = flatY(side, book.leaves.indexOf(leaf));
  leaf.strand.setFlat(phi, y);
  fadeLeaf(leaf, 1);
  leaf.mesh.userData.write(leaf.strand, depth, CFG.thickness);
  leaf.side = side;
}

function layoutFlatLeaves() {
  for (let i = 0; i < book.leaves.length; i++) {
    if (book.turning && book.turning.index === i) continue;
    setLeafFlat(book.leaves[i], i < book.p ? 'L' : 'R');
  }
}

function startSlideTurn(index, dir) {
  if (book.turning) return false;
  if (index < 0 || index >= book.leaves.length) return false;
  const leaf = book.leaves[index];
  leaf.side = 'T';
  const strand = leaf.strand;
  const baseY = flatY('R', index);
  strand.setFlat(0, baseY);
  strand.tx = dir > 0 ? 0 : -CFG.pageW;
  strand.build();
  leaf.mesh.userData.write(strand, depth, CFG.thickness);
  fadeLeaf(leaf, dir > 0 ? 1 : 0);
  book.turning = {
    slide: true,
    dir,
    index,
    leaf,
    mesh: leaf.mesh,
    strand,
    baseY,
    elapsed: 0,
    dur: clamp(0.34 + CFG.pageW * 0.16, 0.34, 0.6),
    started: performance.now(),
  };
  refreshActivePages();
  return true;
}

function startTurn(index, sourceSide, mode) {
  if (book.turning) return false;
  if (index < 0 || index >= book.leaves.length) return false;
  if (singlePage) return startSlideTurn(index, sourceSide === 'R' ? 1 : -1);
  const leaf = book.leaves[index];
  const sourcePhi = sourceSide === 'R' ? 0 : Math.PI;
  const target = sourceSide === 'R' ? Math.PI : 0;
  leaf.side = 'T';
  const strand = leaf.strand;
  strand.setFlat(sourcePhi, flatY(sourceSide, index));
  leaf.mesh.userData.write(strand, depth, CFG.thickness);

  book.turning = {
    index,
    leaf,
    mesh: leaf.mesh,
    strand,
    sourceSide,
    destSide: sourceSide === 'R' ? 'L' : 'R',
    dir: sourceSide === 'R' ? 1 : -1,
    sourceY: flatY(sourceSide, index),
    destY: flatY(sourceSide === 'R' ? 'L' : 'R', index),
    hingeY: Math.max(flatY(sourceSide, index), flatY(sourceSide === 'R' ? 'L' : 'R', index)),
    baseTarget: target,
    min: 0,
    max: Math.PI,
    dragging: mode === 'drag',
    grabStartX: 0,
    grabStartPhi: sourcePhi,
    started: performance.now(),
  };
  refreshActivePages();
  return true;
}

function finalizeTurn() {
  const t = book.turning;
  if (t.slide) {
    if (t.dir > 0) book.p++;
    else book.p--;
    t.leaf.side = t.dir > 0 ? 'L' : 'R';
    setLeafFlat(t.leaf, t.leaf.side);
    book.turning = null;
    renderer.shadowMap.needsUpdate = true;
    lodDirty = true;
    invalidate();
    refreshActivePages();
    updateHUD();
    return;
  }
  const toLeft = t.strand.phi > Math.PI / 2;
  const side = toLeft ? 'L' : 'R';
  if (t.sourceSide === 'R' && toLeft) book.p++;
  else if (t.sourceSide === 'L' && !toLeft) book.p--;
  t.leaf.side = side;
  setLeafFlat(t.leaf, side);
  book.turning = null;
  renderer.shadowMap.needsUpdate = true;
  invalidate();
  refreshActivePages();
  updateHUD();
}

function startAutoTurn(dir) {
  if (book.turning) return;
  if (dir > 0) {
    if (book.p >= book.leaves.length) return;
    startTurn(book.p, 'R', 'click');
  } else {
    if (book.p <= 0) return;
    startTurn(book.p - 1, 'L', 'click');
  }
}

const edgeTex = makeEdgeTexture();
const blockMats = [
  new THREE.MeshStandardMaterial({ map: edgeTex, color: COL.edge, roughness: 0.95 }),
  new THREE.MeshStandardMaterial({ map: edgeTex, color: COL.edge, roughness: 0.95 }),
  new THREE.MeshStandardMaterial({ color: COL.stackTop, roughness: 1 }),
  new THREE.MeshStandardMaterial({ color: COL.stackTop, roughness: 1 }),
  new THREE.MeshStandardMaterial({ map: edgeTex, color: COL.edge, roughness: 0.95 }),
  new THREE.MeshStandardMaterial({ map: edgeTex, color: COL.edge, roughness: 0.95 }),
];
const blockGeo = new THREE.BoxGeometry(CFG.pageW, 1, 1);
const leftBlock = new THREE.Mesh(blockGeo, blockMats);
const rightBlock = new THREE.Mesh(blockGeo, blockMats);
for (const b of [leftBlock, rightBlock]) {
  b.castShadow = true;
  b.receiveShadow = true;
  scene.add(b);
}

function updateStacks() {
  let L = 0, R = 0;
  for (const leaf of book.leaves) {
    if (leaf.side === 'L') L++;
    else if (leaf.side === 'R') R++;
  }
  const clear = CFG.thickness * 0.5 + book.spacing * 0.06;
  const lh = Math.max(0.0002, L * book.spacing - clear);
  const rh = Math.max(0.0002, R * book.spacing - clear);
  leftBlock.scale.set(CFG.pageW, lh, depth);
  leftBlock.position.set(-CFG.pageW / 2, lh / 2, 0);
  rightBlock.scale.set(CFG.pageW, rh, depth);
  rightBlock.position.set(CFG.pageW / 2, rh / 2, 0);
  leftBlock.visible = !singlePage;
  for (let i = 0; i < book.leaves.length; i++) {
    const leaf = book.leaves[i];
    if (book.turning && book.turning.index === i) { leaf.mesh.visible = true; continue; }
    leaf.mesh.visible = !singlePage || leaf.side !== 'L';
  }
}

const SINGLE_ZOOM = 0.74;
const MIN_ZOOM = 0.16;
let zoomLevel = 2.4;
const view = { fitDist: 6, dist: 6, x: 0, z: 0 };
const viewTarget = { dist: 6, x: 0, z: 0 };
const focus = { x: 0, z: 0 };
let zoomScale = 1;
let zoomed = false;
let viewReady = false;

const halfTan = () => Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);

function pageDist(margin) {
  const tanH = halfTan();
  const aspect = camera.aspect || 1;
  const lift = CFG.pageW * 1.06;
  const distH = (depth * margin) / (2 * tanH) + lift;
  const distW = (CFG.pageW * margin) / (2 * tanH * aspect);
  return Math.max(distH, distW);
}

function baseFraming() {
  if (singlePage) return { x: CFG.pageW * 0.5, dist: pageDist(1.06) };
  const N = book.leaves.length;
  if (!book.turning && N > 0) {
    if (book.p <= 0) return { x: CFG.pageW * 0.5, dist: view.fitDist * SINGLE_ZOOM };
    if (book.p >= N) return { x: -CFG.pageW * 0.5, dist: view.fitDist * SINGLE_ZOOM };
  }
  return { x: 0, dist: view.fitDist };
}

function clampFocus(cx) {
  const span = singlePage ? CFG.pageW * 0.75 : CFG.pageW * 0.95;
  viewTarget.x = clamp(viewTarget.x, cx - span, cx + span);
  viewTarget.z = clamp(viewTarget.z, -depth * 0.55, depth * 0.55);
}

function cursorWorldFit(base) {
  const halfH = base.dist * halfTan();
  const halfW = halfH * (camera.aspect || 1);
  return { x: base.x + pointer.x * halfW, z: -pointer.y * halfH };
}

function worldPerPixel() {
  return (2 * view.dist * halfTan()) / window.innerHeight;
}

function updateViewTarget() {
  const base = baseFraming();
  viewTarget.dist = zoomed ? base.dist * zoomScale : base.dist;
  if (zoomed) {
    if (!dragging && !singlePage) {
      const w = cursorWorldFit(base);
      focus.x = w.x;
      focus.z = w.z;
    }
    viewTarget.x = focus.x;
    viewTarget.z = focus.z;
  } else {
    viewTarget.x = base.x;
    viewTarget.z = 0;
  }
  clampFocus(base.x);
}

function fitCamera() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  const aspect = w / h;
  camera.aspect = aspect;
  const tanH = halfTan();
  const lift = CFG.pageW * 1.06;
  const distH = (depth * 1.1) / (2 * tanH) + lift;
  const distW = (CFG.pageW * 1.1) / (tanH * aspect);
  view.fitDist = Math.max(distH, distW);
  updateViewTarget();
  if (!viewReady) {
    view.dist = viewTarget.dist;
    view.x = viewTarget.x;
    view.z = viewTarget.z;
    viewReady = true;
  }
  camera.updateProjectionMatrix();
  contact.scale.set(CFG.pageW * 3.0, depth * 2.2, 1);
  key.target.position.set(0, 0.15, 0);
  key.target.updateMatrixWorld();
  invalidate();
}

function onResize() {
  const sp = IS_MOBILE && isPortrait();
  if (sp !== singlePage) {
    singlePage = sp;
    curlScale = singlePage ? 0.5 : 1;
    zoomed = false;
    zoomScale = 1;
    viewReady = false;
    zoomBtn.classList.remove('on');
    if (pageSource) buildBook(pageSource.count);
  }
  fitCamera();
}
window.addEventListener('resize', onResize);

function applyView(dt) {
  const k = 1 - Math.exp(-dt * 9);
  view.dist += (viewTarget.dist - view.dist) * k;
  view.x += (viewTarget.x - view.x) * k;
  view.z += (viewTarget.z - view.z) * k;
  camera.position.set(view.x, view.dist, view.z);
  camera.lookAt(view.x, 0, view.z);
}

const zoomBtn = document.getElementById('zoom');

function toggleZoom() {
  zoomed = !zoomed;
  if (zoomed) {
    zoomScale = 1 / zoomLevel;
    const base = baseFraming();
    const w = singlePage ? { x: base.x, z: 0 } : cursorWorldFit(base);
    focus.x = w.x;
    focus.z = w.z;
  } else {
    zoomScale = 1;
  }
  zoomBtn.classList.toggle('on', zoomed);
  invalidate();
}
zoomBtn.addEventListener('click', toggleZoom);

const sharpBtn = document.getElementById('sharp');

function setSharpening(on) {
  if (on === sharpening) return;
  sharpening = on;
  sharpBtn.classList.toggle('on', on);
  if (pageSource) {
    const want = desiredTexWidth();
    for (const [idx, entry] of [...texCache.entries()]) reTexture(idx, entry, want);
  }
  invalidate();
}
sharpBtn.addEventListener('click', () => setSharpening(!sharpening));

const zoomInput = document.getElementById('zoomlevel');
const zoomVal = document.getElementById('zoomval');
const bar = document.getElementById('bar');
const moreBtn = document.getElementById('more');

function setZoomLevel(v) {
  zoomLevel = clamp(v, 1.2, 5);
  zoomVal.textContent = `${zoomLevel.toFixed(1)}x`;
  if (zoomed) zoomScale = 1 / zoomLevel;
  invalidate();
}
zoomInput.addEventListener('input', () => setZoomLevel(parseFloat(zoomInput.value) / 100));
moreBtn.addEventListener('click', () => bar.classList.toggle('open'));

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const planeHit = new THREE.Vector3();

function setPointer(e) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

function pickPage() {
  raycaster.setFromCamera(pointer, camera);
  const targets = book.leaves.map((l) => l.mesh);
  const hits = raycaster.intersectObjects(targets, false);
  for (const hit of hits) {
    const leaf = book.leaves.find((l) => l.mesh === hit.object);
    if (leaf) return { hit, leaf };
  }
  return null;
}

function pointerWorldX(e) {
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  dragPlane.constant = 0;
  if (raycaster.ray.intersectPlane(dragPlane, planeHit)) return planeHit.x;
  return null;
}

const pointers = new Map();
let gesture = null;
let pinch = null;
let dragging = false;
let dragMoved = 0;
let lastPointer = { x: 0, y: 0 };

function releasePageDrag() {
  const t = book.turning;
  if (!t) return;
  t.dragging = false;
  t.baseTarget = t.strand.phi > Math.PI / 2 ? Math.PI : 0;
  dragging = false;
  canvas.classList.remove('grabbing');
}

function onDown(e) {
  bar.classList.remove('open');
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);

  if (pointers.size === 2) {
    if (dragging) releasePageDrag();
    gesture = null;
    const p = [...pointers.values()];
    pinch = {
      dist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1,
      scale: zoomed ? zoomScale : 1,
      fx: focus.x,
      fz: focus.z,
      mx: (p[0].x + p[1].x) / 2,
      my: (p[0].y + p[1].y) / 2,
    };
    return;
  }
  if (pointers.size > 2) return;

  if (singlePage) {
    gesture = zoomed
      ? { mode: 'pan', lx: e.clientX, ly: e.clientY }
      : { mode: 'swipe', x: e.clientX, t: performance.now(), dx: 0 };
    return;
  }

  if (book.turning) return;
  setPointer(e);
  const pk = pickPage();
  if (!pk) return;
  const { leaf } = pk;
  const index = book.leaves.indexOf(leaf);
  let sourceSide;
  if (index === book.p && leaf.side === 'R') sourceSide = 'R';
  else if (index === book.p - 1 && leaf.side === 'L') sourceSide = 'L';
  else return;

  if (!startTurn(index, sourceSide, 'drag')) return;
  const x = pointerWorldX(e);
  book.turning.grabStartX = x === null ? 0 : x;
  book.turning.baseTarget = book.turning.grabStartPhi;
  dragging = true;
  dragMoved = 0;
  lastPointer = { x: e.clientX, y: e.clientY };
  gesture = { mode: 'page' };
  canvas.classList.add('grabbing');
}

function onMove(e) {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  setPointer(e);

  if (pointers.size >= 2 && pinch) {
    const p = [...pointers.values()];
    const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1;
    zoomScale = clamp(pinch.scale * (pinch.dist / d), MIN_ZOOM, 1);
    zoomed = zoomScale < 0.999;
    zoomBtn.classList.toggle('on', zoomed);
    const mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2;
    const wpp = worldPerPixel();
    focus.x = pinch.fx - (mx - pinch.mx) * wpp;
    focus.z = pinch.fz - (my - pinch.my) * wpp;
    invalidate();
    return;
  }

  if (!gesture) return;

  if (gesture.mode === 'pan') {
    const wpp = worldPerPixel();
    focus.x -= (e.clientX - gesture.lx) * wpp;
    focus.z -= (e.clientY - gesture.ly) * wpp;
    gesture.lx = e.clientX;
    gesture.ly = e.clientY;
    invalidate();
    return;
  }

  if (gesture.mode === 'swipe') {
    gesture.dx = e.clientX - gesture.x;
    return;
  }

  if (gesture.mode === 'page' && dragging && book.turning) {
    const t = book.turning;
    dragMoved += Math.abs(e.clientX - lastPointer.x) + Math.abs(e.clientY - lastPointer.y);
    lastPointer = { x: e.clientX, y: e.clientY };
    const x = pointerWorldX(e);
    if (x === null) return;
    const dphi = ((t.grabStartX - x) / CFG.pageW) * Math.PI;
    t.baseTarget = clamp(t.grabStartPhi + dphi, t.min, t.max);
  }
}

function onUp(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;

  if (!gesture) {
    if (dragging && pointers.size === 0) releasePageDrag();
    return;
  }

  if (gesture.mode === 'page') {
    if (pointers.size > 0) return;
    if (dragging && book.turning) {
      const t = book.turning;
      t.dragging = false;
      dragging = false;
      canvas.classList.remove('grabbing');
      if (dragMoved < 8) t.baseTarget = t.sourceSide === 'R' ? Math.PI : 0;
      else t.baseTarget = t.strand.phi > Math.PI / 2 ? Math.PI : 0;
    }
    gesture = null;
    return;
  }

  if (gesture.mode === 'swipe') {
    const dt = performance.now() - gesture.t;
    if (Math.abs(gesture.dx) > 42) startAutoTurn(gesture.dx < 0 ? 1 : -1);
    else if (dt < 320 && Math.abs(gesture.dx) < 14) startAutoTurn(1);
    gesture = null;
    return;
  }

  gesture = null;
}

canvas.addEventListener('pointerdown', onDown);
canvas.addEventListener('pointermove', onMove);
canvas.addEventListener('pointerup', onUp);
canvas.addEventListener('pointercancel', onUp);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

btnPrev.addEventListener('click', () => startAutoTurn(-1));
btnNext.addEventListener('click', () => startAutoTurn(1));
tempInput.addEventListener('input', () => setTemperature(parseInt(tempInput.value, 10)));
grainInput.addEventListener('input', () => setGrain(parseFloat(grainInput.value)));
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') startAutoTurn(-1);
  else if (e.key === 'ArrowRight') startAutoTurn(1);
  else if (e.key === 'z' || e.key === 'Z') toggleZoom();
  else if (e.key === 's' || e.key === 'S') setSharpening(!sharpening);
});

function updateHUD() {
  if (!pageSource) return;
  const total = pageSource.count;
  if (singlePage) {
    pageinfo.textContent = `${book.p + 1} / ${total}`;
    btnPrev.disabled = book.p <= 0;
    btnNext.disabled = book.p >= book.leaves.length;
    return;
  }
  const left = 2 * book.p;
  const right = 2 * book.p + 1;
  if (book.p <= 0) pageinfo.textContent = `${right} / ${total}`;
  else if (right > total) pageinfo.textContent = `${left} / ${total}`;
  else pageinfo.textContent = `${left}–${right} / ${total}`;
  btnPrev.disabled = book.p <= 0;
  btnNext.disabled = book.p >= book.leaves.length;
}

function buildBook(count) {
  for (const leaf of book.leaves) {
    scene.remove(leaf.mesh);
    leaf.mesh.geometry.dispose();
    for (const m of leaf.mesh.material) m.dispose();
  }
  grainMats.length = 0;
  book.leaves.length = 0;
  book.turning = null;
  book.p = 0;
  if (singlePage) {
    const nLeaves = Math.min(count, CFG.maxPages);
    for (let i = 0; i < nLeaves; i++) book.leaves.push(newLeaf(i, -1));
    book.p = 0;
  } else {
    const nLeaves = Math.min(Math.max(1, Math.ceil(count / 2)), Math.floor(CFG.maxPages / 2));
    for (let i = 0; i < nLeaves; i++) {
      const frontIdx = i * 2;
      const backIdx = i * 2 + 1 < count ? i * 2 + 1 : -1;
      book.leaves.push(newLeaf(frontIdx, backIdx));
    }
    book.p = book.leaves.length > 1 ? 1 : 0;
  }
  layoutFlatLeaves();
  updateStacks();
  refreshActivePages();
  updateHUD();
  setGrain(parseFloat(grainInput.value));
  renderer.shadowMap.needsUpdate = true;
  lodDirty = true;
  invalidate();
}

function sharpenCanvas(src, amount) {
  const w = src.width, h = src.height;
  const s = src.getContext('2d').getImageData(0, 0, w, h).data;
  const tmp = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = (row + x) * 4;
      const a = (row + (x > 0 ? x - 1 : x)) * 4;
      const b = (row + (x < w - 1 ? x + 1 : x)) * 4;
      const o = (row + x) * 3;
      tmp[o] = s[a] + s[i] + s[b];
      tmp[o + 1] = s[a + 1] + s[i + 1] + s[b + 1];
      tmp[o + 2] = s[a + 2] + s[i + 2] + s[b + 2];
    }
  }
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  const oimg = octx.createImageData(w, h);
  const o = oimg.data;
  for (let y = 0; y < h; y++) {
    const ym = (y > 0 ? y - 1 : y) * w;
    const yc = y * w;
    const yp = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) {
      const i = (yc + x) * 4;
      const o1 = (ym + x) * 3, o2 = (yc + x) * 3, o3 = (yp + x) * 3;
      o[i] = clamp(s[i] + amount * (s[i] - (tmp[o1] + tmp[o2] + tmp[o3]) / 9), 0, 255);
      o[i + 1] = clamp(s[i + 1] + amount * (s[i + 1] - (tmp[o1 + 1] + tmp[o2 + 1] + tmp[o3 + 1]) / 9), 0, 255);
      o[i + 2] = clamp(s[i + 2] + amount * (s[i + 2] - (tmp[o1 + 2] + tmp[o2 + 2] + tmp[o3 + 2]) / 9), 0, 255);
      o[i + 3] = s[i + 3];
    }
  }
  octx.putImageData(oimg, 0, 0);
  return out;
}

function makePdfSource(pdf) {
  return {
    count: pdf.numPages,
    pending: new Set(),
    async render(idx, width) {
      const page = await pdf.getPage(idx + 1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (width || CFG.texWidth) / base.width });
      const c = document.createElement('canvas');
      c.width = Math.floor(viewport.width);
      c.height = Math.floor(viewport.height);
      const ctx = c.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      return c;
    },
  };
}

function makeSyntheticSource() {
  const pages = [];
  const w = 800, h = 1130;
  const words = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud'];
  for (let p = 0; p < 14; p++) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#f6f2e9';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#d9d2c2';
    g.fillRect(0, 0, 26, h);
    g.fillStyle = '#1c1a16';
    g.font = '600 42px Georgia, serif';
    g.fillText(p === 0 ? 'PdfFlip' : `Section ${Math.ceil(p / 2)}`, 92, 158);
    g.font = '16px Georgia, serif';
    g.fillStyle = '#6b6459';
    g.fillText('drag a page to flip it', 92, 196);
    g.font = '21px Georgia, serif';
    g.fillStyle = '#2a271f';
    let y = 268;
    let seed = p * 97 + 13;
    for (let line = 0; line < 28; line++) {
      let count = 9;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      count += seed % 4;
      let text = '';
      for (let k = 0; k < count; k++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        text += words[seed % words.length] + ' ';
      }
      g.fillText(text.trim(), 92, y);
      y += 29;
    }
    g.fillStyle = '#8a8377';
    g.font = '16px Georgia, serif';
    g.fillText(`${p + 1}`, w / 2 - 8, h - 60);
    pages.push(c);
  }
  return {
    count: pages.length,
    pending: new Set(),
    async render(idx, width) {
      await new Promise((r) => setTimeout(r, 8));
      const src = pages[idx];
      if (!width || width <= src.width * 1.05) return src;
      const c = document.createElement('canvas');
      c.width = Math.round(width);
      c.height = Math.round((src.height * width) / src.width);
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, c.width, c.height);
      return c;
    },
  };
}

const SAMPLE_URL = 'https://raw.githubusercontent.com/mozilla/pdf.js/master/web/compressed.tracemonkey-pldi-09.pdf';

async function loadPdf(data) {
  const pdfjsLib = window.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const task = pdfjsLib.getDocument(data);
  task.onProgress = (pr) => {
    if (pr && pr.total) {
      loadtext.textContent = `Loading PDF… ${Math.round((pr.loaded / pr.total) * 100)}%`;
      barfill.style.width = `${(pr.loaded / pr.total) * 55}%`;
    }
  };
  const pdf = await task.promise;
  const first = await pdf.getPage(1);
  const vp = first.getViewport({ scale: 1 });
  depth = CFG.pageW * (vp.height / vp.width);
  pageSource = makePdfSource(pdf);
  return pdf;
}

function hideLoaderSoon() {
  barfill.style.width = '100%';
  setTimeout(() => loader.classList.add('hidden'), 350);
}

function bootFallback() {
  pageSource = makeSyntheticSource();
  depth = CFG.pageW * (1130 / 800);
  buildBook(pageSource.count);
  fitCamera();
  updateStacks();
  hideLoaderSoon();
}

async function init() {
  fitCamera();
  barfill.style.width = '12%';
  try {
    await loadPdf(SAMPLE_URL);
    buildBook(pageSource.count);
    fitCamera();
    updateStacks();
    updateHUD();
    hideLoaderSoon();
  } catch (err) {
    errBox.style.display = 'block';
    errBox.textContent = 'Could not fetch the sample PDF (network/CORS). Loading a built-in document instead — use “Open PDF” for your own file.';
    bootFallback();
  }
}

fileInput.addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  loader.classList.remove('hidden');
  errBox.style.display = 'none';
  loadtext.textContent = 'Reading file…';
  barfill.style.width = '20%';
  try {
    const buf = await f.arrayBuffer();
    await loadPdf({ data: new Uint8Array(buf) });
    buildBook(pageSource.count);
    fitCamera();
    updateStacks();
    updateHUD();
    hideLoaderSoon();
  } catch (err) {
    errBox.style.display = 'block';
    errBox.textContent = 'That file could not be opened as a PDF.';
    loadtext.textContent = '';
  }
});

let lastT = performance.now();

function animate(t) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (t - lastT) / 1000) || 0.016;
  lastT = t;

  const turn = book.turning;
  if (turn) {
    const h = dt / PHYS.substeps;
    if (turn.slide) {
      turn.elapsed += dt;
      const u = clamp(turn.elapsed / turn.dur, 0, 1);
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      const arc = Math.sin(Math.PI * e);
      turn.strand.phi = 0;
      turn.strand.A = 0.3 * arc;
      turn.strand.baseY = turn.baseY + 0.12 * arc;
      turn.strand.tx = turn.dir > 0 ? -e * 0.75 * CFG.pageW : -(1 - e) * 0.75 * CFG.pageW;
      turn.strand.build();
      turn.mesh.userData.write(turn.strand, depth, CFG.thickness);
      fadeLeaf(turn.leaf, turn.dir > 0 ? clamp((1 - u) / 0.45, 0, 1) : clamp(u / 0.45, 0, 1));
      if (u >= 1) finalizeTurn();
    } else {
      for (let s = 0; s < PHYS.substeps; s++) {
        const raw = clamp(turn.strand.phi / Math.PI, 0, 1);
        const g = turn.dir > 0 ? raw : 1 - raw;
        const baseY = g < 0.5
          ? lerp(turn.sourceY, turn.hingeY, g / 0.5)
          : lerp(turn.hingeY, turn.destY, (g - 0.5) / 0.5);
        turn.strand.baseY = baseY;
        turn.strand.step(h, { baseTarget: turn.baseTarget, min: turn.min, max: turn.max });
      }
      turn.mesh.userData.write(turn.strand, depth, CFG.thickness);
      if (!turn.dragging) {
        const settled = Math.abs(turn.strand.phi - turn.baseTarget) < 0.02 && Math.abs(turn.strand.A) < 0.02 && Math.abs(turn.strand.omega) < 0.08;
        if (settled && performance.now() - turn.started > 150) finalizeTurn();
      }
    }
  }

  const moving = () =>
    Math.abs(view.dist - viewTarget.dist) > 1e-4 ||
    Math.abs(view.x - viewTarget.x) > 1e-4 ||
    Math.abs(view.z - viewTarget.z) > 1e-4;

  const wasMoving = moving();
  updateViewTarget();
  applyView(dt);
  updateStacks();

  const nowMoving = moving();
  if (!nowMoving && wasMoving) lodDirty = true;

  if (book.turning) renderer.shadowMap.needsUpdate = true;
  if (book.turning || wasMoving || needsRender) {
    renderer.render(scene, camera);
    needsRender = false;
  }

  if (lodDirty && !book.turning && !nowMoving) {
    lodDirty = false;
    updateLOD();
  }
}

setTemperature(parseInt(tempInput.value, 10));
setGrain(parseFloat(grainInput.value));
setZoomLevel(parseFloat(zoomInput.value) / 100);
init();
requestAnimationFrame(animate);
