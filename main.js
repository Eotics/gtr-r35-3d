import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const isMobile = matchMedia('(max-width: 820px)').matches;

/* ---------- Renderer / scene ---------- */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: DEBUG });
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060b);
scene.fog = new THREE.FogExp2(0x05060b, 0.045);

const camera = new THREE.PerspectiveCamera(isMobile ? 46 : 34, innerWidth / innerHeight, 0.1, 200);
camera.position.set(6, 1.6, 6);

/* ---------- Neon studio environment (reflections) ---------- */
function buildEnv() {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x020308);
  const box = new THREE.Mesh(new THREE.BoxGeometry(30, 14, 30), new THREE.MeshBasicMaterial({ color: 0x05070f, side: THREE.BackSide }));
  env.add(box);
  const panel = (w, h, color, intensity, pos, rot) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos); if (rot) m.rotation.set(...rot); env.add(m);
  };
  panel(16, 2.2, 0xffffff, 3.2, [0, 6.8, 0], [Math.PI / 2, 0, 0]);       // softbox top
  panel(0.6, 9, 0x00f0ff, 6, [-9, 2, -4], [0, Math.PI / 2, 0]);          // cyan strips
  panel(0.6, 9, 0x00f0ff, 6, [-9, 2, 4], [0, Math.PI / 2, 0]);
  panel(0.6, 9, 0xff2bd6, 6, [9, 2, -4], [0, -Math.PI / 2, 0]);          // pink strips
  panel(0.6, 9, 0xff2bd6, 6, [9, 2, 4], [0, -Math.PI / 2, 0]);
  panel(14, 0.5, 0x7b5cff, 4, [0, 3, -14.5]);                             // violet back bar
  panel(14, 0.5, 0xffffff, 2, [0, 3, 14.5]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}
scene.environment = buildEnv();
scene.environmentIntensity = 1.0;

/* ---------- Lights ---------- */
scene.add(new THREE.HemisphereLight(0x8fb8ff, 0x080410, 0.35));
const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 8, 4); scene.add(key);
const cyanL = new THREE.PointLight(0x00f0ff, 14, 12, 2); cyanL.position.set(-6.5, 1.6, 3); scene.add(cyanL);
const pinkL = new THREE.PointLight(0xff2bd6, 14, 12, 2); pinkL.position.set(6.5, 1.6, -3); scene.add(pinkL);

/* ---------- Floor: dark glossy + neon grid + ring ---------- */
const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: 0x06070d, roughness: 0.6, metalness: 0.25 }));
floor.rotation.x = -Math.PI / 2; scene.add(floor);

const gridMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uTime: { value: 0 }, uC1: { value: new THREE.Color(0x00f0ff) }, uC2: { value: new THREE.Color(0xff2bd6) } },
  vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `varying vec2 vP; uniform float uTime; uniform vec3 uC1; uniform vec3 uC2;
    float line(float x, float w){ float d = abs(fract(x)-.5); return smoothstep(w, 0., .5-d); }
    void main(){
      vec2 p = vP*0.9; p.y += uTime*.25;
      float g = max(line(p.x,.02), line(p.y,.02));
      float r = length(vP);
      float fade = smoothstep(18., 3., r);
      vec3 c = mix(uC1, uC2, smoothstep(-8., 8., vP.x));
      gl_FragColor = vec4(c*1.2, g*fade*.22);
    }`
});
const grid = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), gridMat);
grid.rotation.x = -Math.PI / 2; grid.position.y = 0.002; scene.add(grid);

function neonRing(r, color, y, tube = 0.018) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 160), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.5), toneMapped: false }));
  m.rotation.x = Math.PI / 2; m.position.y = y; scene.add(m); return m;
}
const ring1 = neonRing(3.3, 0x00f0ff, 0.01, 0.012);
const ring2 = neonRing(3.55, 0xff2bd6, 0.01, 0.007);

// soft contact shadow
const shCanvas = document.createElement('canvas'); shCanvas.width = shCanvas.height = 256;
const sctx = shCanvas.getContext('2d');
const grd = sctx.createRadialGradient(128, 128, 10, 128, 128, 128);
grd.addColorStop(0, 'rgba(0,0,0,0.95)'); grd.addColorStop(0.55, 'rgba(0,0,0,0.6)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
sctx.fillStyle = grd; sctx.fillRect(0, 0, 256, 256);
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shCanvas), transparent: true, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.004; scene.add(shadow);

/* ---------- Post-processing ---------- */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.42, 0.55, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ---------- Car materials ---------- */
const PAINTS = [
  { name: 'Stealth Grey', c: '#3a3f47' },
  { name: 'Neon Cyan', c: '#00c8d8' },
  { name: 'Ultra Violet', c: '#5b2bd9' },
  { name: 'Hot Magenta', c: '#d11a9e' },
  { name: 'Nismo Red', c: '#c4101c' },
  { name: 'Pearl White', c: '#e8e9ec' },
  { name: 'Midnight Black', c: '#0a0b0d' },
  { name: 'Toxic Lime', c: '#7cff2e' },
];
const RIMS = [
  { name: 'Gold', c: '#b8862b' },
  { name: 'Gunmetal', c: '#2a2d33' },
  { name: 'Chrome', c: '#d9dde3' },
  { name: 'Neon Cyan', c: '#00e0f0' },
  { name: 'Red', c: '#c4101c' },
];

const paintMat = new THREE.MeshPhysicalMaterial({ color: PAINTS[0].c, metalness: 0.65, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.3 });
const rimMat = new THREE.MeshPhysicalMaterial({ color: RIMS[0].c, metalness: 1, roughness: 0.28, clearcoat: 0.6 });
const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(0xdff6ff), emissiveIntensity: 2.2 });
const tailMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: new THREE.Color(0xff1020), emissiveIntensity: 2.4 });

// material name -> role (names come from the original Blender file)
const ROLE = {
  CarpaintMatteBlack: 'paint', CarpaintMetallicBlack: 'paint', CarpaintGlossBlack: 'trimGloss', CarpaintMetallicDarkGrey: 'trimGloss',
  CarpaintMetallicGoldenYellow: 'rim',
  PlasticGlassWhitewindshield: 'glass', PlasticGlassWhite: 'lens', PlasticGlassRed: 'redLens',
  headlight: 'head', taillight: 'tail',
  chrome_a: 'chrome', chrome_b: 'chrome', brakedisc: 'disc',
  CarbonFiberBlack: 'carbon', CarbonFiberBlackmatte: 'carbonMatte',
  blackmatt2b: 'plasticMatte', mattblack: 'plasticMatte', blackglossmat: 'trimGloss', PianoBlack: 'trimGloss', gloassygreyishblackmat: 'trimGloss',
  redg: 'redAccent', redlogo: 'redAccent', redlogob: 'redAccent', goldstripe: 'gold',
  Leather_all: 'leather', whitemat: 'white', gloassywhitemat: 'white',
};
const shared = {
  glass: new THREE.MeshPhysicalMaterial({ color: 0x0b0f14, metalness: 0, roughness: 0.02, transmission: 0, transparent: true, opacity: 0.55, envMapIntensity: 2.2, clearcoat: 1 }),
  lens: new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.18, envMapIntensity: 2 }),
  redLens: new THREE.MeshPhysicalMaterial({ color: 0xff0a1e, emissive: 0x400005, roughness: 0.08, transparent: true, opacity: 0.85, envMapIntensity: 1.5 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.06 }),
  disc: new THREE.MeshStandardMaterial({ color: 0x777b82, metalness: 1, roughness: 0.38 }),
  carbon: new THREE.MeshPhysicalMaterial({ color: 0x0d0e10, metalness: 0.4, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 }),
  carbonMatte: new THREE.MeshStandardMaterial({ color: 0x0c0c0e, metalness: 0.2, roughness: 0.7 }),
  plasticMatte: new THREE.MeshStandardMaterial({ color: 0x060607, metalness: 0.1, roughness: 0.85 }),
  trimGloss: new THREE.MeshPhysicalMaterial({ color: 0x0a0a0c, metalness: 0.5, roughness: 0.2, clearcoat: 1 }),
  redAccent: new THREE.MeshPhysicalMaterial({ color: 0xc8000f, metalness: 0.2, roughness: 0.25, clearcoat: 1 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xc9861a, metalness: 0.8, roughness: 0.3 }),
  leather: new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.75 }),
  white: new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.4 }),
};

function styleMaterial(m) {
  const role = ROLE[m.name];
  if (role === 'paint') return paintMat;
  if (role === 'rim') return rimMat;
  if (role === 'head') return headMat;
  if (role === 'tail') return tailMat;
  if (role && shared[role]) return shared[role];
  // textured ones (tyres, rim disc, plate) keep their map
  if (m.map) { m.roughness = m.name === 'tirerubber' ? 0.85 : 0.35; m.metalness = m.name === 'tirerubber' ? 0 : m.metalness; return m; }
  return m;
}

/* ---------- Load car ---------- */
const car = new THREE.Group(); scene.add(car);
const wheels = [];
const manager = new THREE.LoadingManager();
const draco = new DRACOLoader(manager).setDecoderPath('./vendor/jsm/libs/draco/gltf/');
const loader = new GLTFLoader(manager).setDRACOLoader(draco);
const fill = document.getElementById('loader-fill'), pct = document.getElementById('loader-pct');

loader.load('models/gtr.glb', (gltf) => {
  const root = gltf.scene;
  const debugMats = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (DEBUG) {
      const arr = Array.isArray(o.material) ? o.material : [o.material];
      arr.forEach((m) => { if (!debugMats.includes(m.name)) debugMats.push(m.name); });
    }
    o.material = Array.isArray(o.material) ? o.material.map(styleMaterial) : styleMaterial(o.material);
    if (/^Wheel\./.test(o.name)) wheels.push(o);
  });
  if (DEBUG) {
    window.__mats = debugMats;
    const solo = params.get('solo');
    if (solo) root.traverse((o) => { if (!o.isMesh) return; const f = (m) => (m === paintMat && solo === 'paint') ? m : (m.name === solo ? new THREE.MeshBasicMaterial({ color: 0x00ff00 }) : m); o.material = Array.isArray(o.material) ? o.material.map(f) : f(o.material); });
  }
  // normalise: length along X → rotate so car points to +Z, centre on floor
  let box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  if (size.x > size.z) root.rotation.y = Math.PI / 2;
  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);
  const s = 4.6 / Math.max(...box.getSize(new THREE.Vector3()).toArray());
  root.scale.setScalar(s);
  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  root.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
  car.add(root);
  const fs = box.getSize(new THREE.Vector3());
  shadow.scale.set(fs.x * 1.35, fs.z * 1.2, 1);
  window.__carReady = true;
}, (e) => xhrProgress(e), (e) => { console.error(e); pct.textContent = 'Erreur'; });

function xhrProgress(e) { if (e.lengthComputable) { const p = Math.round((e.loaded / e.total) * 100); fill.style.width = p + '%'; pct.textContent = p; } }
manager.onLoad = () => { fill.style.width = '100%'; pct.textContent = 100; setTimeout(() => document.getElementById('loader').classList.add('done'), 350); onScroll(); };

/* ---------- Camera path driven by scroll ---------- */
// spherical: [azimuth deg (0 = front), elevation deg, distance], target [x,y,z]
const SHOTS = {
  hero:   { az: 38,  el: 8,  d: 9.6, ox: 0.26,   oy: 0.02 },
  side:   { az: 90,  el: 5,  d: 9.0, ox: -0.17, oy: 0.04 },
  rear:   { az: 215, el: 11, d: 8.6, ox: 0.18,  oy: 0.02 },
  front:  { az: -32, el: 10, d: 11.5, ox: 0.22,  oy: 0.03 },
  config: { az: 40,  el: 15, d: 9.0, ox: 0.2,  oy: 0.04 },
};
const TARGET = [0, 0.62, 0];
if (isMobile) Object.values(SHOTS).forEach((s) => { s.d *= 1.4; s.ox = 0; s.oy = 0.2; });

const sections = [...document.querySelectorAll('[data-cam]')];
const cur = { az: SHOTS.hero.az, el: SHOTS.hero.el, d: SHOTS.hero.d, ox: SHOTS.hero.ox, oy: SHOTS.hero.oy, t: new THREE.Vector3(...TARGET) };
const goal = { ...cur, t: cur.t.clone() };
let scrollP = 0;

function onScroll() {
  const mid = scrollY + innerHeight / 2;
  const centers = sections.map((s) => s.offsetTop + s.offsetHeight / 2);
  let i = 0;
  while (i < centers.length - 1 && mid > centers[i + 1]) i++;
  const a = SHOTS[sections[i].dataset.cam];
  const b = SHOTS[sections[Math.min(i + 1, sections.length - 1)].dataset.cam];
  let k = i < centers.length - 1 ? (mid - centers[i]) / (centers[i + 1] - centers[i]) : 0;
  k = THREE.MathUtils.clamp(k, 0, 1);
  k = k * k * (3 - 2 * k);
  let daz = b.az - a.az; if (daz > 180) daz -= 360; if (daz < -180) daz += 360;
  goal.az = a.az + daz * k; goal.el = a.el + (b.el - a.el) * k; goal.d = a.d + (b.d - a.d) * k;
  goal.ox = a.ox + (b.ox - a.ox) * k; goal.oy = a.oy + (b.oy - a.oy) * k;
  scrollP = scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight);

  const cfg = document.getElementById('config').getBoundingClientRect();
  setOrbit(cfg.top < innerHeight * 0.35);
}
addEventListener('scroll', onScroll, { passive: true });

/* ---------- Orbit mode (configurator) ---------- */
const controls = new OrbitControls(camera, canvas);
controls.enabled = false; controls.enableDamping = true; controls.dampingFactor = 0.06;
controls.enablePan = false; controls.minDistance = 5; controls.maxDistance = 13;
controls.minPolarAngle = 0.15; controls.maxPolarAngle = Math.PI / 2 - 0.04;
controls.autoRotateSpeed = 0.9;
let orbit = false, autoSpin = true;
function setOrbit(on) {
  if (on === orbit) return;
  orbit = on; document.body.classList.toggle('orbit', on);
  if (on) { controls.target.copy(cur.t); controls.enabled = true; controls.autoRotate = autoSpin; controls.update(); }
  else { controls.enabled = false; syncFromCamera(); }
}
function syncFromCamera() { // keep continuity when leaving orbit
  const off = camera.position.clone().sub(controls.target);
  const sph = new THREE.Spherical().setFromVector3(off);
  cur.d = sph.radius; cur.el = 90 - THREE.MathUtils.radToDeg(sph.phi); cur.az = THREE.MathUtils.radToDeg(sph.theta);
  cur.t.copy(controls.target);
}

/* ---------- UI: swatches & toggles ---------- */
function buildSwatches(el, list, onPick, labelEl) {
  list.forEach((p, idx) => {
    const b = document.createElement('button');
    b.className = 'sw'; b.style.setProperty('--c', p.c); b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', p.name); b.title = p.name; b.setAttribute('aria-checked', idx === 0);
    b.onclick = () => { el.querySelectorAll('.sw').forEach((x) => x.setAttribute('aria-checked', x === b)); labelEl.textContent = p.name; onPick(p.c); };
    el.appendChild(b);
  });
}
const tweenColor = (mat, hex) => { const from = mat.color.clone(), to = new THREE.Color(hex); let t = 0; const step = () => { t = Math.min(1, t + 0.06); mat.color.copy(from).lerp(to, t); if (t < 1) requestAnimationFrame(step); }; step(); };
buildSwatches(document.getElementById('swatches'), PAINTS, (c) => tweenColor(paintMat, c), document.getElementById('paint-name'));
buildSwatches(document.getElementById('rims'), RIMS, (c) => tweenColor(rimMat, c), document.getElementById('rim-name'));

const btnSpin = document.getElementById('btn-spin');
btnSpin.onclick = () => { autoSpin = !autoSpin; controls.autoRotate = autoSpin && orbit; btnSpin.setAttribute('aria-pressed', autoSpin); };
const btnLights = document.getElementById('btn-lights');
let lightsOn = true;
btnLights.onclick = () => { lightsOn = !lightsOn; headMat.emissiveIntensity = lightsOn ? 2.2 : 0; tailMat.emissiveIntensity = lightsOn ? 2.4 : 0.2; btnLights.setAttribute('aria-pressed', lightsOn); };

/* ---------- Counters & gauges ---------- */
const io = new IntersectionObserver((entries) => entries.forEach((en) => {
  if (!en.isIntersecting) return;
  en.target.querySelectorAll('[data-count]').forEach((n) => {
    if (n.dataset.done) return; n.dataset.done = 1;
    const end = parseFloat(n.dataset.count), dec = +(n.dataset.dec || 0), t0 = performance.now();
    const tick = (now) => { const k = Math.min(1, (now - t0) / 1400), e = 1 - Math.pow(1 - k, 3); n.textContent = (end * e).toFixed(dec).replace('.', ','); if (k < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  en.target.querySelectorAll('.gauge').forEach((g) => g.classList.add('on'));
}), { threshold: 0.35 });
document.querySelectorAll('.panel').forEach((p) => io.observe(p));

/* ---------- Loop ---------- */
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  gridMat.uniforms.uTime.value = t;
  ring1.scale.setScalar(1 + Math.sin(t * 1.6) * 0.012);
  ring2.rotation.z = t * 0.2;
  cyanL.intensity = 8 + Math.sin(t * 2.1) * 2;
  pinkL.intensity = 8 + Math.cos(t * 1.7) * 2;

  if (orbit) {
    controls.update();
  } else {
    const ease = 1 - Math.pow(0.0025, dt);
    let daz = goal.az - cur.az; if (daz > 180) daz -= 360; if (daz < -180) daz += 360;
    cur.az += daz * ease; cur.el += (goal.el - cur.el) * ease; cur.d += (goal.d - cur.d) * ease; cur.ox += (goal.ox - cur.ox) * ease; cur.oy += (goal.oy - cur.oy) * ease;
    const az = THREE.MathUtils.degToRad(cur.az), el = THREE.MathUtils.degToRad(cur.el);
    camera.position.set(cur.t.x + cur.d * Math.cos(el) * Math.sin(az), cur.t.y + cur.d * Math.sin(el), cur.t.z + cur.d * Math.cos(el) * Math.cos(az));
    camera.lookAt(cur.t);
  }
  camera.setViewOffset(innerWidth, innerHeight, -cur.ox * innerWidth, cur.oy * innerHeight, innerWidth, innerHeight);
  composer.render();
  requestAnimationFrame(frame);
}
frame();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  onScroll();
});
