/*
 * R262 subway car: interactive CAD viewer
 * ---------------------------------------
 * Loads the Fusion FBX export with three.js, only once the project scrolls
 * near, and adds:
 *   - orbit / pan / zoom (wheel zoom only after clicking in, so the page still scrolls)
 *   - hover (or tap) a part to see its name and assembly
 *   - preset views, exploded view, interior cutaway, blueprint lines, track toggle
 */
const fig = document.getElementById("r262");

if (fig) {
  const io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      io.disconnect();
      init().catch(fail);
    }
  }, { rootMargin: "600px 0px" });
  io.observe(fig);
}

function fail(err) {
  console.error(err);
  fig.classList.add("is-failed");
  document.getElementById("cadLoadText").textContent = "Couldn't load the 3D model";
}

async function init() {
  const [THREE, { FBXLoader }, { OrbitControls }, { RoomEnvironment }] = await Promise.all([
    import("three"),
    import("three/addons/loaders/FBXLoader.js"),
    import("three/addons/controls/OrbitControls.js"),
    import("three/addons/environments/RoomEnvironment.js"),
  ]);
  const V3 = THREE.Vector3;

  const stage = fig.querySelector(".cad__stage");
  const loadText = document.getElementById("cadLoadText");
  const bar = document.getElementById("cadBar");
  const sysEl = document.getElementById("cadSys");
  const partEl = document.getElementById("cadPart");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Renderer, scene, lighting ---------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;   // only redraw shadows when the model changes
  // The canvas fills the stage but never sizes it, so it can't feed back into the
  // layout, even if the stylesheet is missing or stale.
  Object.assign(renderer.domElement.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block" });
  stage.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  /* ---------- Load the model ---------- */
  const model = await new Promise((resolve, reject) =>
    new FBXLoader().load(fig.dataset.model, resolve, (e) => {
      if (!e.total) return;
      const p = e.loaded / e.total;
      bar.style.transform = `scaleX(${p})`;
      loadText.textContent = `Loading model ${Math.round(p * 100)}%`;
    }, reject));

  // Fusion exported it Z-up; stand it upright, centre it, and rest it on y = 0.
  model.rotation.x = -Math.PI / 2;
  scene.add(model);
  model.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(model);
  const c = box.getCenter(new V3());
  model.position.set(-c.x, -box.min.y, -c.z);
  model.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new V3());
  const L = size.x, H = size.y, W = size.z;   // length, height, width

  /* ---------- Materials: Fusion's Phong colours → physically based ---------- */
  const matCache = new Map();
  function convert(m) {
    if (matCache.has(m.name)) return matCache.get(m.name);
    const n = m.name.toLowerCase();
    const p = { color: m.color.clone(), roughness: 0.55, metalness: 0 };
    if (/glass/.test(n)) Object.assign(p, { roughness: 0.05, transparent: true, opacity: 0.25, depthWrite: false });
    else if (/clear/.test(n)) Object.assign(p, { roughness: 0.1, transparent: true, opacity: 0.5, depthWrite: false });
    else if (/polished/.test(n)) Object.assign(p, { metalness: 1, roughness: 0.18 });
    else if (/stainless|alum/.test(n)) Object.assign(p, { metalness: 0.85, roughness: 0.32 });
    else if (/steel/.test(n)) Object.assign(p, { metalness: 0.7, roughness: 0.45 });
    else if (/led/.test(n)) Object.assign(p, { emissive: m.color.clone(), emissiveIntensity: 0.9 });
    else if (/gloss/.test(n)) p.roughness = 0.2;
    else if (/rubber|airbag|ballast|tie|floor|truck/.test(n)) p.roughness = 0.85;
    const out = new THREE.MeshStandardMaterial(p);
    out.name = m.name;
    matCache.set(m.name, out);
    return out;
  }

  /* ---------- Parts: every mesh, tagged with its assembly ---------- */
  const SYSTEMS = {
    Track: "Track", Carbody: "Car body", Interior: "Interior",
    Doors: "Doors", Couplers: "Couplers", Motor_Truck: "Motor truck",
  };
  const groups = {};      // assembly key → [top-level objects]
  const parts = [];
  const nice = (name) => name.replace(/[\d_]+$/, "").replace(/_/g, " ").replace(/\s+/g, " ").trim();

  for (const top of model.children) {
    const key = top.name.replace(/\d+$/, "");
    (groups[key] ||= []).push(top);
    top.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
      const mats = [].concat(o.material);
      const glass = mats.every((m) => m.transparent);
      o.castShadow = !glass;
      o.receiveShadow = true;
      const part = { mesh: o, top, key, glass, material: o.material, label: nice(o.name), system: SYSTEMS[key] || nice(key) };
      o.userData.part = part;
      parts.push(part);
    });
  }

  // Which end is the cab? Used to point the 3/4 and front views at it.
  const mask = parts.find((p) => /cab_front_mask/i.test(p.mesh.name));
  const front = mask ? Math.sign(new THREE.Box3().setFromObject(mask.mesh).getCenter(new V3()).x) || 1 : 1;

  /* ---------- Exploded view offsets (world space → each mesh's parent space) ---------- */
  for (const p of parts) {
    const ctr = new THREE.Box3().setFromObject(p.mesh).getCenter(new V3());
    const off = new V3();
    switch (p.key) {
      case "Track": off.y = -H * 0.5; break;
      case "Motor_Truck": off.y = -H * 0.2; break;
      case "Couplers": off.x = Math.sign(ctr.x) * L * 0.08; break;
      case "Carbody": off.y = H * 0.75; break;
      case "Interior": off.y = H * 0.22; break;
      case "Doors":
        off.y = H * 0.75;
        if (Math.abs(ctr.z) > W * 0.2) off.z = Math.sign(ctr.z) * W * 0.35;   // side doors swing out
        else off.x = Math.sign(ctr.x) * L * 0.06;                             // end doors slide out
        break;
    }
    const inv = new THREE.Matrix3().setFromMatrix4(p.mesh.parent.matrixWorld).invert();
    p.base = p.mesh.position.clone();
    p.delta = off.applyMatrix3(inv);
  }

  /* ---------- Lights + soft ground shadow ---------- */
  scene.add(new THREE.HemisphereLight(0xffffff, 0xdedede, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(L * 0.25, H * 5, W * 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -L * 0.7, right: L * 0.7, top: L * 0.7, bottom: -L * 0.7, near: 1, far: H * 14 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = L * 0.0006;
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(L * 4, L * 4), new THREE.ShadowMaterial({ opacity: 0.12 }));
  ground.rotation.x = -Math.PI / 2;
  // Shadow catcher sits under the track; it drops with the track in the exploded view.
  ground.receiveShadow = true;
  scene.add(ground);

  /* ---------- Camera + controls ---------- */
  const camera = new THREE.PerspectiveCamera(28, 2, L * 0.01, L * 20);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enableZoom = false;
  controls.minDistance = H * 0.6;
  controls.maxDistance = L * 4;
  controls.autoRotate = !reduceMotion;
  controls.autoRotateSpeed = 0.5;

  let dragging = false;
  controls.addEventListener("start", () => { dragging = true; controls.autoRotate = false; tween = null; });
  controls.addEventListener("end", () => { dragging = false; });

  // Wheel zoom only after the visitor clicks into the viewer, so scrolling the page never gets trapped.
  renderer.domElement.addEventListener("pointerdown", () => { controls.enableZoom = true; fig.classList.add("is-active"); });
  stage.addEventListener("pointerleave", () => { controls.enableZoom = false; fig.classList.remove("is-active"); });

  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight || Math.round(w / 2);   // fall back to 2:1 if the stage has no height
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  new ResizeObserver(resize).observe(stage);

  /* ---------- Preset views ---------- */
  let view = "iso", exploded = false;
  const VIEWS = {
    iso:   { dir: [front * 0.9, 0.42, 1], span: [L * 0.9, H * 1.4], near: L * 0.3 },
    side:  { dir: [0, 0.08, 1], span: [L * 1.05, H * 1.15], near: W * 0.5 },
    front: { dir: [front, 0.12, 0.0001], span: [W * 1.7, H * 1.3], near: L * 0.5 },
    top:   { dir: [0, 1, 0.0001], span: [L * 1.05, W * 1.8], near: H * 0.5 },
  };
  function pose(key) {
    const v = VIEWS[key];
    const k = exploded ? 2.4 : 1;   // exploded parts need more height
    const target = new V3(0, H * (exploded ? 0.68 : 0.5), 0);
    const vf = THREE.MathUtils.degToRad(camera.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    const spanY = key === "top" ? v.span[1] : v.span[1] * k;
    const d = Math.max(v.span[0] / 2 / Math.tan(hf / 2), spanY / 2 / Math.tan(vf / 2)) + v.near;
    return { target, position: target.clone().addScaledVector(new V3(...v.dir).normalize(), d) };
  }

  // Animate between views along a sphere around the target, so the camera never cuts through the car.
  let tween = null;
  function goTo(key, instant = false) {
    const to = pose(key);
    if (instant || reduceMotion) {
      camera.position.copy(to.position);
      controls.target.copy(to.target);
      controls.update();
      return;
    }
    const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    const end = new THREE.Spherical().setFromVector3(to.position.clone().sub(to.target));
    let dTheta = end.theta - from.theta;
    if (dTheta > Math.PI) dTheta -= 2 * Math.PI;
    if (dTheta < -Math.PI) dTheta += 2 * Math.PI;
    tween = { from, end, dTheta, t0: performance.now(), fromT: controls.target.clone(), toT: to.target };
  }
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const sph = new THREE.Spherical();
  function stepTween(now) {
    if (!tween) return;
    const t = Math.min(1, (now - tween.t0) / 900), k = ease(t);
    sph.set(
      THREE.MathUtils.lerp(tween.from.radius, tween.end.radius, k),
      THREE.MathUtils.lerp(tween.from.phi, tween.end.phi, k),
      tween.from.theta + tween.dTheta * k,
    );
    controls.target.lerpVectors(tween.fromT, tween.toT, k);
    camera.position.setFromSpherical(sph).add(controls.target);
    if (t === 1) tween = null;
  }
  goTo("iso", true);

  /* ---------- Exploded view animation ---------- */
  let explodeT = 0, explodeGoal = 0, lastNow = performance.now();
  function stepExplode(now) {
    const dt = now - lastNow;
    lastNow = now;
    if (explodeT === explodeGoal) return;
    const step = reduceMotion ? 1 : dt / 900;
    explodeT = explodeGoal > explodeT ? Math.min(explodeGoal, explodeT + step) : Math.max(explodeGoal, explodeT - step);
    const k = ease(explodeT);
    for (const p of parts) p.mesh.position.copy(p.base).addScaledVector(p.delta, k);
    ground.position.y = -H * 0.5 * k;
    renderer.shadowMap.needsUpdate = true;
  }

  /* ---------- Blueprint mode: white fills + ink edges, built on first use ---------- */
  let blueprint = false, edgesBuilt = false;
  const paper = new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, toneMapped: false });
  const clearPaper = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const ink = new THREE.LineBasicMaterial({ color: 0x141414, toneMapped: false });

  function buildEdges() {
    for (const p of parts) {
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(p.mesh.geometry, 28), ink);
      e.raycast = () => {};
      e.visible = false;
      p.mesh.add(e);
      p.edges = e;
    }
    edgesBuilt = true;
  }

  /* ---------- Hover / tap to identify a part ---------- */
  const hl = new THREE.MeshStandardMaterial({ color: 0x0039a6, roughness: 0.4, emissive: 0x0039a6, emissiveIntensity: 0.35 });
  const hlFlat = new THREE.MeshBasicMaterial({ color: 0xc9d7f2, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, toneMapped: false });
  const baseMaterial = (p) => (blueprint ? (p.glass ? clearPaper : paper) : p.material);
  let hovered = null;

  function setHover(p) {
    if (hovered === p) return;
    if (hovered) hovered.mesh.material = baseMaterial(hovered);
    hovered = p;
    if (p) {
      p.mesh.material = blueprint ? hlFlat : hl;
      sysEl.textContent = p.system;
      partEl.textContent = p.label;
    } else {
      sysEl.textContent = "Hover a part";
      partEl.textContent = "—";
    }
  }

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let pickPending = false;
  const pickable = parts.filter((p) => !p.glass).map((p) => p.mesh);
  function queuePick(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    pickPending = true;
  }
  renderer.domElement.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") queuePick(e); });
  renderer.domElement.addEventListener("click", queuePick);   // taps on touch screens
  stage.addEventListener("pointerleave", () => { pickPending = false; setHover(null); });

  function pick() {
    if (!pickPending || dragging) return;
    pickPending = false;
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickable, false).find((h) => h.object.userData.part.top.visible);
    setHover(hit ? hit.object.userData.part : null);
  }

  /* ---------- Controls ---------- */
  const buttons = fig.querySelectorAll("button");
  const viewButtons = fig.querySelectorAll("[data-view]");

  viewButtons.forEach((b) => b.addEventListener("click", () => {
    view = b.dataset.view;
    viewButtons.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    controls.autoRotate = false;
    goTo(view);
  }));

  const show = (keys, on) => keys.forEach((k) => (groups[k] || []).forEach((o) => { o.visible = on; }));
  const TOGGLES = {
    explode(on) { exploded = on; explodeGoal = on ? 1 : 0; goTo(view); },
    interior(on) { show(["Carbody", "Doors"], !on); },
    track(on) { show(["Track"], on); },
    blueprint(on) {
      blueprint = on;
      if (on && !edgesBuilt) buildEdges();
      for (const p of parts) {
        if (p !== hovered) p.mesh.material = baseMaterial(p);
        if (p.edges) p.edges.visible = on;
      }
      if (hovered) hovered.mesh.material = on ? hlFlat : hl;
      ground.visible = !on;
      fig.classList.toggle("is-blueprint", on);
    },
  };
  fig.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => {
    const on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(on));
    TOGGLES[b.dataset.toggle](on);
    if (hovered && !hovered.top.visible) setHover(null);
    renderer.shadowMap.needsUpdate = true;
  }));

  fig.querySelectorAll("[data-zoom]").forEach((b) => b.addEventListener("click", () => {
    tween = null;
    controls.autoRotate = false;
    const offset = camera.position.clone().sub(controls.target);
    const d = THREE.MathUtils.clamp(offset.length() * (b.dataset.zoom === "in" ? 0.8 : 1.25), controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).addScaledVector(offset.normalize(), d);
  }));

  /* ---------- Render loop (paused while off screen) ---------- */
  let onScreen = true;
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; }).observe(stage);

  renderer.shadowMap.needsUpdate = true;
  renderer.setAnimationLoop((now) => {
    if (!onScreen) { lastNow = now; return; }
    stepTween(now);
    stepExplode(now);
    controls.update();
    pick();
    renderer.render(scene, camera);
  });

  buttons.forEach((b) => { b.disabled = false; });
  fig.classList.add("is-ready");
}
