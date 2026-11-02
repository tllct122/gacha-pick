// Gacha Pick — the capsule machine in 3D: real glass, lacquered metal, chrome, and capsules with physics.
// Exposes window.Machine3D once ready; the page falls back to the flat drawing if WebGL isn't available.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as CANNON from 'cannon-es';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- sizes (1 unit ≈ 1 cm) ---------------- */
const SEAT = { y: 12.1, r: 4.6 };         // the small round opening the globe sits on
const GLOBE = { r: 8.6, y: 12.1 + Math.sqrt(8.6 ** 2 - 4.6 ** 2) };   // glass globe radius & centre
const CAP_R = 1.2;                         // capsule radius
const FLOOR_Y = 12.3;                      // stops capsules falling through the opening; the round bowl of glass holds them
const TRAY = { y: 1.55, zBack: 6.6, zFront: 9.6, half: 1.9 };   // outlet tray

/** A painted wood-grain texture for the counter (no image files needed). */
function woodTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#5b3725'; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 140; i++) {
    const y = Math.random() * c.height, amp = 2 + Math.random() * 6, f = 0.004 + Math.random() * 0.01, ph = Math.random() * 6;
    g.strokeStyle = `rgba(${Math.random() < 0.5 ? '40,22,12' : '120,78,50'},${0.08 + Math.random() * 0.18})`;
    g.lineWidth = 0.6 + Math.random() * 2.2;
    g.beginPath();
    for (let x = 0; x <= c.width; x += 8) g.lineTo(x, y + Math.sin(x * f + ph) * amp);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

/** A soft bright rim where glass turns away from you (fresnel). */
function rimMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { color: { value: new THREE.Color(0xfff6e8) }, strength: { value: 0.95 } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 color; uniform float strength; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 3.0); gl_FragColor = vec4(color * f * strength, f * strength); }`,
  });
}

export function createMachine(canvas) {
  /* ---------- renderer, camera, light ---------- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(26, 1, 1, 400);
  camera.position.set(0, 21, 72);
  camera.lookAt(0, 12.4, 0);

  const key = new THREE.DirectionalLight(0xfff1dc, 2.2);
  key.position.set(-18, 34, 26);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -22; key.shadow.camera.right = 22; key.shadow.camera.top = 30; key.shadow.camera.bottom = -6;
  key.shadow.radius = 6; key.shadow.bias = -0.0006;
  scene.add(key);
  scene.add(new THREE.HemisphereLight(0xfff3df, 0x6b4430, 0.55));

  /* ---------- materials ---------- */
  const lacquer = new THREE.MeshPhysicalMaterial({ color: 0xb3202b, metalness: 0.25, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdedede, metalness: 1, roughness: 0.13 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1d1714, metalness: 0.6, roughness: 0.45 });
  const whitePlastic = new THREE.MeshPhysicalMaterial({ color: 0xf6f3ec, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  const glassFront = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.02, transparent: true, opacity: 0.24,
    envMapIntensity: 3.2, clearcoat: 1, clearcoatRoughness: 0, specularIntensity: 1, depthWrite: false });
  const glassBack = glassFront.clone(); glassBack.side = THREE.BackSide; glassBack.opacity = 0.08;
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.48, metalness: 0 });

  const machine = new THREE.Group();
  scene.add(machine);
  const shadowy = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

  /* ---------- counter ---------- */
  const woodSide = new THREE.MeshStandardMaterial({ map: wood.map, color: 0x8a7468, roughness: 0.6 });
  const counter = new THREE.Mesh(new THREE.BoxGeometry(90, 3, 40), [woodSide, woodSide, wood, woodSide, woodSide, woodSide]);
  counter.position.set(0, -1.5, 4); counter.receiveShadow = true;
  scene.add(counter);

  /* ---------- base: a tapered, lacquered pedestal ---------- */
  const lathe = (pts, mat, seg = 72) => shadowy(new THREE.Mesh(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), mat));
  machine.add(lathe([[0, 0], [8.4, 0], [8.7, 0.25], [8.7, 0.9], [8.3, 1.25], [7.9, 1.4],
    [6.0, 9.6], [6.25, 9.8], [6.3, 10.4], [5.9, 10.6], [0, 10.6]], lacquer));
  // collar ring the globe sits on
  machine.add(lathe([[0, 9.9], [6.3, 9.9], [6.45, 10.25], [6.1, 10.8], [5.4, 11.35], [5.05, 11.9], [4.95, 12.35], [4.4, 12.35], [4.4, 11.6], [0, 11.6]], chrome));
  // lid on top of the globe
  const NECK = 3.9;                                              // the globe's opening at the top
  const lidY = GLOBE.y + Math.sqrt(GLOBE.r ** 2 - NECK ** 2) - 0.15;
  machine.add(lathe([[NECK - 0.1, -0.25], [NECK + 0.45, -0.25], [NECK + 0.45, 0.35], [NECK - 0.1, 0.35]].map(([x, y]) => [x, y + lidY]), chrome));
  machine.add(lathe([[NECK + 0.55, 0.3], [NECK + 0.6, 0.9], [NECK + 0.35, 1.5], [4.4, 2.5], [3.2, 3.3], [1.8, 3.7], [0, 3.8], [0, 0.3]].map(([x, y]) => [x, y + lidY]), lacquer));
  const finial = shadowy(new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 16), chrome));
  finial.position.y = lidY + 4.35; machine.add(finial);

  /* ---------- glass globe ---------- */
  const globeGeo = new THREE.SphereGeometry(GLOBE.r, 96, 64);
  const globeBack = new THREE.Mesh(globeGeo, glassBack); globeBack.position.y = GLOBE.y; globeBack.renderOrder = 1;
  const globeFront = new THREE.Mesh(globeGeo, glassFront); globeFront.position.y = GLOBE.y; globeFront.renderOrder = 3;
  const rim = new THREE.Mesh(globeGeo, rimMaterial()); rim.position.y = GLOBE.y; rim.scale.setScalar(1.002); rim.renderOrder = 4;
  // reflections of a bright window, as in a product photo
  const soft = (() => {           // feathered edges, brightest in the middle
    const c = document.createElement('canvas'); c.width = 64; c.height = 128;
    const g = c.getContext('2d'), img = g.createImageData(64, 128);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) {
      const u = (x + 0.5) / 64, v = (y + 0.5) / 128;
      const a = Math.pow(Math.sin(Math.PI * u), 2.2) * Math.pow(Math.sin(Math.PI * v), 0.8);
      const i = (y * 64 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255 * a; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return new THREE.CanvasTexture(c);
  })();
  const glint = (phi0, phiLen, th0, thLen, op) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(GLOBE.r * 1.004, 48, 24, phi0, phiLen, th0, thLen),
      new THREE.MeshBasicMaterial({ color: 0xffffff, alphaMap: soft, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.position.y = GLOBE.y; m.renderOrder = 5; return m;
  };
  machine.add(globeBack, globeFront, rim,
    glint(0.9, 0.26, 0.45, 0.9, 0.75),                    // tall window, front left
    glint(1.2, 0.08, 0.55, 0.65, 0.5),                 // its thin neighbour
    glint(2.15, 0.14, 1.4, 0.4, 0.35));                   // a small one low right

  /* ---------- front: chrome coin plate, white handle, coin slot ---------- */
  const front = new THREE.Group();
  const tilt = Math.atan2(7.9 - 6.0, 9.6 - 1.4);       // follow the taper of the base
  front.position.set(0, 6.0, 7.0); front.rotation.x = -tilt;
  machine.add(front);
  const plate = shadowy(new THREE.Mesh(new RoundedBoxGeometry(6.4, 6.0, 1.1, 4, 0.5), chrome));
  plate.position.z = 0.15; front.add(plate);
  const slot = new THREE.Mesh(new RoundedBoxGeometry(0.42, 1.7, 0.4, 2, 0.15), darkMetal);
  slot.position.set(0, 1.95, 0.6); front.add(slot);
  const hub = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.9, 40), chrome));
  hub.rotation.x = Math.PI / 2; hub.position.set(0, -0.5, 1.0); front.add(hub);
  const handle = new THREE.Group(); handle.position.set(0, -0.5, 1.75); front.add(handle);
  const grip = shadowy(new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 4.4, 12, 32), whitePlastic));
  grip.rotation.z = Math.PI / 2; handle.add(grip);
  const cap = shadowy(new THREE.Mesh(new THREE.SphereGeometry(0.7, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), whitePlastic));
  cap.rotation.x = Math.PI / 2; cap.position.z = 0.45; handle.add(cap);

  /* ---------- outlet: chrome tray with a hinged flap ---------- */
  const trayShape = new THREE.Shape();       // a U-shaped cross-section, extruded forward
  const w = TRAY.half + 0.35, h = 2.6, t = 0.3;
  trayShape.moveTo(-w, h); trayShape.lineTo(-w, 0.6); trayShape.quadraticCurveTo(-w, 0, -w + 0.6, 0);
  trayShape.lineTo(w - 0.6, 0); trayShape.quadraticCurveTo(w, 0, w, 0.6); trayShape.lineTo(w, h);
  trayShape.lineTo(w - t, h); trayShape.lineTo(w - t, 0.7); trayShape.quadraticCurveTo(w - t, t, w - 0.7, t);
  trayShape.lineTo(-w + 0.7, t); trayShape.quadraticCurveTo(-w + t, t, -w + t, 0.7); trayShape.lineTo(-w + t, h); trayShape.closePath();
  const trayGeo = new THREE.ExtrudeGeometry(trayShape, { depth: TRAY.zFront - TRAY.zBack, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 3 });
  const tray = shadowy(new THREE.Mesh(trayGeo, chrome));
  tray.position.set(0, TRAY.y - t, TRAY.zBack); machine.add(tray);
  const lip = shadowy(new THREE.Mesh(new RoundedBoxGeometry(2 * w + 0.2, 1.3, 0.35, 3, 0.15), chrome));
  lip.position.set(0, TRAY.y + 0.35, TRAY.zFront + 0.1); machine.add(lip);
  const mouth = new THREE.Mesh(new RoundedBoxGeometry(2 * w - 0.4, 2.6, 0.8, 3, 0.3), darkMetal);   // the dark opening behind the flap
  mouth.position.set(0, TRAY.y + 1.7, TRAY.zBack - 0.15); machine.add(mouth);
  const flapPivot = new THREE.Group(); flapPivot.position.set(0, TRAY.y + 3.0, TRAY.zBack + 0.15); machine.add(flapPivot);
  const flap = shadowy(new THREE.Mesh(new RoundedBoxGeometry(2 * w - 0.5, 2.5, 0.16, 3, 0.07), chrome));
  flap.position.y = -1.25; flapPivot.add(flap);
  flapPivot.rotation.x = 0.08;

  /* ---------- physics ---------- */
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -260, 0) });
  world.allowSleep = true;
  world.defaultContactMaterial.restitution = 0.42;
  world.defaultContactMaterial.friction = 0.18;
  // collision groups: capsules in the globe only meet the globe floor; the dropped one only meets the tray
  const G_GLOBE = 1, G_TRAYCAP = 2, G_FLOOR = 4, G_TRAY = 8;
  const ground = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane(), collisionFilterGroup: G_FLOOR, collisionFilterMask: G_GLOBE });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0); ground.position.y = FLOOR_Y; world.addBody(ground);

  // the tray: floor, back, sides and the front lip
  const trayBodies = [];
  const staticBox = (hx, hy, hz, x, y, z) => { const b = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)), collisionFilterGroup: G_TRAY, collisionFilterMask: G_TRAYCAP }); b.position.set(x, y, z); world.addBody(b); trayBodies.push(b); };
  const zMid = (TRAY.zBack + TRAY.zFront) / 2, zHalf = (TRAY.zFront - TRAY.zBack) / 2;
  staticBox(TRAY.half + 0.5, 0.25, zHalf + 0.5, 0, TRAY.y - 0.25, zMid);
  staticBox(0.25, 3, zHalf + 0.5, -TRAY.half - 0.25, TRAY.y + 2, zMid);
  staticBox(0.25, 3, zHalf + 0.5, TRAY.half + 0.25, TRAY.y + 2, zMid);
  staticBox(TRAY.half + 0.5, 0.65, 0.2, 0, TRAY.y + 0.5, TRAY.zFront + 0.15);
  staticBox(TRAY.half + 0.5, 3, 0.25, 0, TRAY.y + 2, TRAY.zBack - 0.6);

  /* ---------- capsules ---------- */
  const capGeoTop = new THREE.SphereGeometry(CAP_R, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2);
  const capGeoBottom = new THREE.SphereGeometry(CAP_R * 0.985, 40, 20, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const seamGeo = new THREE.TorusGeometry(CAP_R * 0.99, 0.07, 10, 48);
  const milky = new THREE.MeshPhysicalMaterial({ color: 0xfbf8f2, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.3 });
  const matCache = {};
  const colorMat = (hex) => matCache[hex] || (matCache[hex] = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(hex), roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05 }));
  function capsuleMesh(hex) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(capGeoTop, colorMat(hex));
    const bottom = new THREE.Mesh(capGeoBottom, milky);
    const seam = new THREE.Mesh(seamGeo, colorMat(hex)); seam.rotation.x = Math.PI / 2;
    for (const m of [top, bottom, seam]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
    return g;
  }
  function capsuleBody(x, y, z, inTray) {
    const b = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(CAP_R), linearDamping: 0.06, angularDamping: 0.18,
      sleepSpeedLimit: 0.6, sleepTimeLimit: 0.5,
      collisionFilterGroup: inTray ? G_TRAYCAP : G_GLOBE, collisionFilterMask: inTray ? G_TRAY : G_GLOBE | G_FLOOR });
    b.position.set(x, y, z);
    b.quaternion.setFromEuler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    world.addBody(b);
    return b;
  }

  let inGlobe = [];        // { mesh, body }
  let outCap = null;       // the capsule in the tray
  const tweens = [];

  function setCapsules(colors) {
    for (const c of inGlobe) { world.removeBody(c.body); machine.remove(c.mesh); }
    inGlobe = [];
    const n = Math.min(colors.length, 26);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.random() * 4.2;
      const mesh = capsuleMesh(colors[i]);
      const body = capsuleBody(Math.cos(a) * rr, reduceMotion ? FLOOR_Y + CAP_R + (i % 5) * 2.2 : GLOBE.y + 2 + i * 0.9, Math.sin(a) * rr);
      machine.add(mesh);
      inGlobe.push({ mesh, body, color: colors[i] });
    }
    wake(1.2);
  }

  /** Drop one more capsule in from the top. */
  function addCapsule(color) {
    if (inGlobe.length >= 26) return;
    const mesh = capsuleMesh(color);
    const body = capsuleBody((Math.random() - 0.5) * 3, GLOBE.y + 4.5, (Math.random() - 0.5) * 3);
    body.velocity.set(0, -4, 0);
    machine.add(mesh); inGlobe.push({ mesh, body, color });
    wake(1);
  }
  /** Match the number of capsules shown, adding or taking out as few as possible. */
  function setCount(n, colorFor) {
    n = Math.min(n, 26);
    while (inGlobe.length > n) { const c = inGlobe.pop(); world.removeBody(c.body); machine.remove(c.mesh); }
    let i = 0;
    while (inGlobe.length < n && i++ < 30) addCapsule(colorFor());
    for (const c of inGlobe) c.body.wakeUp();
    wake(0.6);
  }

  /* keep capsules inside the glass (a sphere is concave from inside, so we handle it ourselves) */
  const centre = new CANNON.Vec3(0, GLOBE.y, 0);
  function containInGlobe() {
    const max = GLOBE.r - 0.35 - CAP_R;
    for (const { body } of inGlobe) {
      const d = body.position.vsub(centre), len = d.length();
      if (len <= max) continue;
      const n = d.scale(1 / len);
      body.position.copy(centre.vadd(n.scale(max)));
      const vn = body.velocity.dot(n);
      if (vn > 0) {
        body.velocity.vsub(n.scale(vn * 1.45), body.velocity);                    // bounce off the glass
        const spin = n.cross(body.velocity).scale(-0.4);                         // and roll along it
        body.angularVelocity.vadd(spin, body.angularVelocity);
      }
    }
  }

  /* ---------- turning: shake the capsules, then drop one into the tray ---------- */
  function agitate(strength) {
    for (const { body } of inGlobe) {
      body.wakeUp();
      body.velocity.set((Math.random() - 0.5) * 30 * strength, (30 + Math.random() * 38) * strength, (Math.random() - 0.5) * 30 * strength);
      body.angularVelocity.set((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40);
    }
  }

  function tween(ms, step) {
    return new Promise((done) => { tweens.push({ start: performance.now(), ms: Math.max(1, ms), step, done }); wake(ms / 1000 + 0.2); });
  }
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

  async function turn(color, removeOne) {
    if (outCap) clearTray();
    const dur = reduceMotion ? 1 : 1100;
    // the handle turns a full circle; capsules jump and flip three times on the way
    const kicks = reduceMotion ? [] : [0, 0.35, 0.7];
    let k = 0;
    await tween(dur, (p) => {
      handle.rotation.z = -ease(p) * Math.PI * 2;
      while (k < kicks.length && p >= kicks[k]) { agitate(k === 0 ? 1 : 0.75); k++; }
    });
    // one capsule leaves the globe (the lowest one, as in a real machine)
    if (inGlobe.length && removeOne) {
      let lowest = 0;
      inGlobe.forEach((c, i) => { if (c.body.position.y < inGlobe[lowest].body.position.y) lowest = i; });
      const [gone] = inGlobe.splice(lowest, 1);
      world.removeBody(gone.body);
      const from = gone.mesh.position.clone();
      await tween(reduceMotion ? 1 : 260, (p) => { gone.mesh.position.lerpVectors(from, new THREE.Vector3(0, SEAT.y - 1.5, 0), p); gone.mesh.scale.setScalar(1 - p * 0.3); });
      machine.remove(gone.mesh);
    } else if (!reduceMotion) {
      await new Promise((r) => setTimeout(r, 200));
    }
    // ...and tumbles out behind the flap into the tray
    const mesh = capsuleMesh(color);
    const body = capsuleBody(0, TRAY.y + 1.9, TRAY.zBack + 0.2, true);
    body.velocity.set((Math.random() - 0.5) * 3, 6, 15);
    body.angularVelocity.set(14 + Math.random() * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 16);
    machine.add(mesh);
    outCap = { mesh, body, color };
    tween(420, (p) => { flapPivot.rotation.x = 0.08 + Math.sin(p * Math.PI) * 0.95; });
    await new Promise((r) => setTimeout(r, reduceMotion ? 50 : 1000));
    return true;
  }

  function clearTray() {
    if (!outCap) return;
    world.removeBody(outCap.body); machine.remove(outCap.mesh); outCap = null; wake(0.1);
  }

  /* ---------- clicking: the handle turns, the capsule in the tray opens ---------- */
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const listeners = { handle: () => {}, capsule: () => {} };
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    if (outCap && ray.intersectObject(outCap.mesh, true).length) return listeners.capsule();
    if (ray.intersectObjects([plate, grip, hub, cap], false).length) return listeners.handle();
    if (outCap && ray.intersectObjects([tray, lip, flap], false).length) return listeners.capsule();
  });
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const hit = (outCap && ray.intersectObject(outCap.mesh, true).length) || ray.intersectObjects([plate, grip, hub, cap], false).length;
    canvas.style.cursor = hit ? 'pointer' : '';
  });

  /* ---------- size & loop ---------- */
  function resize() {
    const { clientWidth: cw, clientHeight: ch } = canvas;
    if (!cw || !ch) return;
    renderer.setSize(cw, ch, false);
    camera.aspect = cw / ch;
    // keep the whole machine in view on narrow screens
    const fitH = 42, fitW = 23;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const distH = fitH / 2 / Math.tan(vFov / 2), distW = fitW / 2 / Math.tan(vFov / 2) / camera.aspect;
    const dist = Math.max(distH, distW);
    camera.position.set(0, 15.7 + dist * 0.2, dist);
    camera.lookAt(0, 15.6, 0);
    camera.updateProjectionMatrix();
    wake(0.1);
  }
  new ResizeObserver(resize).observe(canvas);

  let awakeUntil = 0, last = performance.now(), running = false;
  function wake(seconds) { awakeUntil = Math.max(awakeUntil, performance.now() + seconds * 1000); if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); } }
  const sync = ({ mesh, body }) => { mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion); };
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    for (let i = 0; i < 3; i++) { world.step(1 / 180, dt / 3, 2); containInGlobe(); }
    for (const c of inGlobe) sync(c);
    if (outCap) sync(outCap);
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i], p = Math.min(1, (now - tw.start) / tw.ms);
      tw.step(p);
      if (p >= 1) { tweens.splice(i, 1); tw.done(); }
    }
    renderer.render(scene, camera);
    const moving = inGlobe.some((c) => c.body.sleepState !== CANNON.Body.SLEEPING) || (outCap && outCap.body.sleepState !== CANNON.Body.SLEEPING);
    if (moving || tweens.length || now < awakeUntil) requestAnimationFrame(frame);
    else running = false;
  }
  resize();
  wake(0.5);

  return {
    setCapsules, setCount, addCapsule, turn, clearTray,
    onHandle(fn) { listeners.handle = fn; },
    onCapsule(fn) { listeners.capsule = fn; },
    get hasCapsuleInTray() { return !!outCap; },
  };
}

/* start: the page waits for this */
try {
  const canvas = document.getElementById('machine3d');
  const test = document.createElement('canvas');
  if (canvas && (test.getContext('webgl2') || test.getContext('webgl'))) {
    window.Machine3D = createMachine(canvas);
    window.dispatchEvent(new Event('machine3d-ready'));
  }
} catch (e) {
  console.warn('3D machine unavailable, using the flat drawing', e);
}
