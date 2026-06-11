import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const video = document.getElementById('cameraVideo');
const startButton = document.getElementById('startButton');
const statusText = document.getElementById('statusText');
const DEBUG = new URLSearchParams(location.search).has('debug');
if (DEBUG) document.body.classList.add('debug');

const isAndroid = /Android/i.test(navigator.userAgent);
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

const ASSETS = {
  avatar: ['./assets/avatar.glb', './assets/danceing.glb'],
  sign: ['./assets/happy_birthday.glb', './assets/happy birthday 3d model.glb'],
  cake: ['./assets/cake.glb', './assets/fbx.glb']
};

const CONFIG = {
  animationSpeed: 0.92,

  fallbackDistancePortrait: -5.25,
  fallbackDistanceLandscape: -4.85,
  fallbackFeetYPortrait: -2.12,
  fallbackFeetYLandscape: -1.66,
  avatarHeightFallbackPortrait: 1.85,
  avatarHeightFallbackLandscape: 1.46,
  signHeightFallback: 0.72,
  cakeHeightFallback: 0.36,

  avatarHeightXR: 0.95,
  signHeightXR: 0.42,
  cakeHeightXR: 0.30
};

let scene, camera, renderer;
let rootGroup, contentGroup, reticle;
let mixer;
let hitTestSource = null;
let hitTestSourceRequested = false;
let xrActive = false;
let xrPlaced = false;
let fallbackMode = false;
let cameraStarted = false;
let startRequested = false;

const models = {
  avatar: null,
  sign: null,
  cake: null
};

const loaded = {
  avatar: false,
  sign: false,
  cake: false
};

const missing = {
  sign: false,
  cake: false
};

const clock = new THREE.Clock();
const loader = new GLTFLoader();

initThree();
loadModelsRobustly();
wireStartButton();

function wireStartButton() {
  window.startARExperience = startExperience;
  showStartButton();
  if (window.AR_PENDING_START) startExperience();
}

function setStatus(message) {
  if (!statusText) return;
  statusText.textContent = message || '';
  statusText.classList.toggle('show', Boolean(message));
}

function debug(message) {
  if (DEBUG) setStatus(message);
}

function showStartButton() {
  startButton.classList.remove('hide');
  startButton.classList.add('show');
}

function hideStartButton() {
  startButton.classList.add('hide');
  startButton.classList.remove('show');
}

function initThree() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.01, 100);
  camera.position.set(0, 0, 0);

  renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isIOS ? 1.5 : 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 2.35;
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  rootGroup = new THREE.Group();
  rootGroup.visible = false;
  scene.add(rootGroup);

  contentGroup = new THREE.Group();
  rootGroup.add(contentGroup);

  createReticle();
  addLights();

  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && cameraStarted && video.paused) {
      video.play().catch(() => {});
    }
  });

  renderer.setAnimationLoop(renderLoop);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isIOS ? 1.5 : 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  refreshLayout();
}

function createReticle() {
  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.11, 0.13, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.82 })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);
}

function addLights() {
  scene.add(new THREE.AmbientLight(0xffffff, 3.8));
  scene.add(new THREE.HemisphereLight(0xffffff, 0xdde7ff, 4.3));

  const key = new THREE.DirectionalLight(0xffffff, 5.0);
  key.position.set(2.5, 4.2, 4.6);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xffffff, 3.0);
  fill.position.set(-3.0, 2.8, 3.0);
  scene.add(fill);

  const back = new THREE.DirectionalLight(0xffffff, 1.8);
  back.position.set(0.5, 3.2, -4.5);
  scene.add(back);
}

async function loadModelsRobustly() {
  debug('加载人物模型');

  try {
    const avatar = await loadFirstAvailable(ASSETS.avatar, true);
    models.avatar = avatar.scene;
    loaded.avatar = true;
    fixMaterials(models.avatar);
    contentGroup.add(models.avatar);
    setupAvatarAnimation(avatar.animations || []);
    refreshLayout();
    debug('人物已加载，继续加载生日元素');
  } catch (err) {
    console.error('Avatar load failed:', err);
    setStatus(DEBUG ? '人物模型加载失败：请确认 assets/avatar.glb 存在' : '');
    showStartButton();
    return;
  }

  loadOptionalModel('sign', ASSETS.sign, 'Happy Birthday');
  loadOptionalModel('cake', ASSETS.cake, '生日蛋糕');
}

async function loadOptionalModel(key, candidates, label) {
  try {
    const gltf = await loadFirstAvailable(candidates, false);
    models[key] = gltf.scene;
    loaded[key] = true;
    fixMaterials(models[key]);
    contentGroup.add(models[key]);
    refreshLayout();
    if (DEBUG) {
      const count = [loaded.avatar, loaded.sign, loaded.cake].filter(Boolean).length;
      debug(`已加载 ${count}/3 个模型`);
    }
  } catch (err) {
    missing[key] = true;
    console.warn(`${label} model missing:`, err);
    refreshLayout();
    if (DEBUG) debug(`${label} 未找到，但人物会继续显示`);
  }
}

function loadFirstAvailable(candidates, required) {
  let index = 0;
  return new Promise((resolve, reject) => {
    const tryNext = () => {
      if (index >= candidates.length) {
        reject(new Error(`No model found: ${candidates.join(', ')}`));
        return;
      }

      const url = candidates[index++];
      loader.load(url, resolve, undefined, () => tryNext());
    };
    tryNext();
  });
}

function setupAvatarAnimation(animations) {
  if (!animations || animations.length === 0 || !models.avatar) return;
  mixer = new THREE.AnimationMixer(models.avatar);
  const action = mixer.clipAction(animations[0]);
  action.reset();
  action.setLoop(THREE.LoopRepeat);
  action.timeScale = CONFIG.animationSpeed;
  action.play();
}

function fixMaterials(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.frustumCulled = false;
    obj.castShadow = false;
    obj.receiveShadow = false;

    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    materials.forEach((mat) => {
      if (!mat) return;
      mat.side = THREE.DoubleSide;
      mat.depthTest = true;
      mat.depthWrite = true;
      mat.alphaTest = Math.max(mat.alphaTest || 0, 0.18);
      if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
      mat.needsUpdate = true;
    });
  });
}

async function startExperience() {
  if (startRequested) return;
  startRequested = true;
  hideStartButton();

  if (isAndroid && navigator.xr) {
    try {
      await startWebXR();
      return;
    } catch (err) {
      console.warn('WebXR failed, fallback to camera:', err);
      debug('WebXR 未启动，切换普通摄像头模式');
    }
  }

  await startFallbackCameraMode();
}

async function startWebXR() {
  debug('启动 AR，缓慢移动手机扫描地面');

  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: { root: document.body }
  });

  xrActive = true;
  fallbackMode = false;
  xrPlaced = false;
  cameraStarted = false;
  video.style.display = 'none';
  rootGroup.visible = false;
  reticle.visible = false;

  session.addEventListener('end', () => {
    xrActive = false;
    xrPlaced = false;
    hitTestSource = null;
    hitTestSourceRequested = false;
    reticle.visible = false;
    rootGroup.visible = false;
    startRequested = false;
    showStartButton();
    setStatus('');
  }, { once: true });

  await renderer.xr.setSession(session);
  debug('正在扫描地面，请缓慢移动手机');
}

async function startFallbackCameraMode() {
  fallbackMode = true;
  xrActive = false;
  video.style.display = 'block';
  debug('打开普通摄像头模式');

  try {
    await startCameraWithFallback();
    cameraStarted = true;
    refreshLayout();
    if (!loaded.avatar) debug('摄像头已打开，等待人物模型加载');
  } catch (err) {
    console.warn('Camera failed:', err);
    startRequested = false;
    setStatus(DEBUG ? readableCameraError(err) : '');
    showStartButton();
  }
}

async function startCameraWithFallback() {
  try {
    await startCamera({
      audio: false,
      video: {
        facingMode: isMobile ? { ideal: 'environment' } : 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });
  } catch (err) {
    await startCamera({ audio: false, video: true });
  }
}

async function startCamera(constraints) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('getUserMedia unavailable');
  }

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');

  await new Promise((resolve) => {
    if (video.readyState >= 2) return resolve();
    video.onloadedmetadata = () => resolve();
  });
  await video.play();
}

function readableCameraError(err) {
  const name = err && (err.name || err.message) || '';
  if (/NotAllowed|Permission/i.test(name)) return '摄像头权限被拒绝，请允许相机';
  if (/NotFound|DevicesNotFound/i.test(name)) return '没有找到摄像头';
  if (/NotReadable|TrackStart/i.test(name)) return '摄像头可能被其他软件占用';
  if (/Overconstrained/i.test(name)) return '摄像头参数不兼容';
  if (/getUserMedia unavailable/i.test(name)) return '当前浏览器不支持摄像头调用';
  return '摄像头启动失败';
}

function resetModel(root) {
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.setScalar(1);
  root.updateWorldMatrix(true, true);
}

function normalizeModel(root, targetHeight) {
  if (!root) return;
  resetModel(root);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const originalHeight = size.y || 1;
  root.scale.setScalar(targetHeight / originalHeight);
  root.updateWorldMatrix(true, true);

  const box2 = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  box2.getCenter(center);
  root.position.x -= center.x;
  root.position.y -= box2.min.y;
  root.position.z -= center.z;
}

function layoutScene({ avatarHeight, signHeight, cakeHeight }) {
  if (!loaded.avatar) return;

  normalizeModel(models.avatar, avatarHeight);
  models.avatar.position.set(0, 0, 0);

  if (loaded.sign) {
    normalizeModel(models.sign, signHeight);
    models.sign.position.set(0, avatarHeight * 0.88, -avatarHeight * 0.16);
    models.sign.rotation.y = 0;
  }

  if (loaded.cake) {
    normalizeModel(models.cake, cakeHeight);
    models.cake.position.set(avatarHeight * 0.43, 0, avatarHeight * 0.18);
    models.cake.rotation.y = -0.35;
  }
}

function refreshLayout() {
  if (!loaded.avatar) return;

  if (fallbackMode && cameraStarted) {
    layoutFallback();
  } else if (xrActive && xrPlaced) {
    layoutXRAtCurrentAnchor();
  }
}

function layoutFallback() {
  const portrait = window.innerHeight >= window.innerWidth;
  const avatarHeight = portrait ? CONFIG.avatarHeightFallbackPortrait : CONFIG.avatarHeightFallbackLandscape;
  const z = portrait ? CONFIG.fallbackDistancePortrait : CONFIG.fallbackDistanceLandscape;
  const feetY = portrait ? CONFIG.fallbackFeetYPortrait : CONFIG.fallbackFeetYLandscape;

  layoutScene({
    avatarHeight,
    signHeight: CONFIG.signHeightFallback,
    cakeHeight: CONFIG.cakeHeightFallback
  });

  rootGroup.position.set(0, feetY, z);
  rootGroup.rotation.set(0, 0, 0);
  rootGroup.visible = true;

  if (DEBUG) {
    const count = [loaded.avatar, loaded.sign, loaded.cake].filter(Boolean).length;
    setStatus(count === 3 ? '' : `已显示 ${count}/3 个模型；请确认 birthday/cake glb 已上传到 assets`);
  } else {
    setStatus('');
  }
}

function layoutXRAtCurrentAnchor() {
  layoutScene({
    avatarHeight: CONFIG.avatarHeightXR,
    signHeight: CONFIG.signHeightXR,
    cakeHeight: CONFIG.cakeHeightXR
  });
}

function placeOnReticle() {
  if (!loaded.avatar || !reticle.visible || xrPlaced) return;

  layoutScene({
    avatarHeight: CONFIG.avatarHeightXR,
    signHeight: CONFIG.signHeightXR,
    cakeHeight: CONFIG.cakeHeightXR
  });

  rootGroup.position.setFromMatrixPosition(reticle.matrix);
  rootGroup.rotation.setFromRotationMatrix(reticle.matrix);
  rootGroup.visible = true;
  reticle.visible = false;
  xrPlaced = true;
  setStatus('');
}

function updateHitTest(frame) {
  const session = renderer.xr.getSession();
  if (!session) return;

  if (!hitTestSourceRequested) {
    session.requestReferenceSpace('viewer').then((viewerSpace) => {
      session.requestHitTestSource({ space: viewerSpace }).then((source) => {
        hitTestSource = source;
      }).catch((err) => console.warn('Hit test source failed:', err));
    });

    session.addEventListener('end', () => {
      hitTestSourceRequested = false;
      hitTestSource = null;
    }, { once: true });

    hitTestSourceRequested = true;
  }

  if (!hitTestSource) return;

  const referenceSpace = renderer.xr.getReferenceSpace();
  const hitTestResults = frame.getHitTestResults(hitTestSource);

  if (hitTestResults.length > 0) {
    const hit = hitTestResults[0];
    const pose = hit.getPose(referenceSpace);
    reticle.visible = !xrPlaced;
    reticle.matrix.fromArray(pose.transform.matrix);
    if (DEBUG && !xrPlaced) setStatus('已识别平面，正在放置模型');
    if (!xrPlaced) placeOnReticle();
  } else if (!xrPlaced) {
    reticle.visible = false;
    if (DEBUG) setStatus('正在扫描地面，请缓慢移动手机');
  }
}

function renderLoop(timestamp, frame) {
  const dt = Math.min(clock.getDelta(), 0.033);
  if (mixer) mixer.update(dt);

  if (xrActive && frame && !xrPlaced) {
    updateHitTest(frame);
  }

  renderer.render(scene, camera);
}
