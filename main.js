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

const MODEL_URLS = {
  avatar: './assets/avatar.glb',
  sign: './assets/happy_birthday.glb',
  cake: './assets/cake.glb'
};

// 版式目标：上方横向 Happy Birthday / 中间人物 / 下方蛋糕。
// signWidth 用“宽度”控制 Happy Birthday，而不是用高度控制，避免变成上方一小团。
const CONFIG = {
  animationSpeed: 0.92,

  fallbackDistancePortrait: -5.65,
  fallbackDistanceLandscape: -5.05,
  fallbackFeetYPortrait: -1.72,
  fallbackFeetYLandscape: -1.36,

  avatarHeightFallbackPortrait: 1.38,
  avatarHeightFallbackLandscape: 1.16,
  signWidthFallbackPortrait: 2.05,
  signWidthFallbackLandscape: 1.75,
  cakeHeightFallbackPortrait: 0.34,
  cakeHeightFallbackLandscape: 0.28,

  avatarHeightXR: 0.78,
  signWidthXR: 1.12,
  cakeHeightXR: 0.22
};

let scene, camera, renderer;
let rootGroup, contentGroup, reticle;
let avatarScene, signScene, cakeScene;
let mixer;
let allModelsLoaded = false;
let modelLoadError = '';
let startRequested = false;
let cameraStarted = false;
let fallbackMode = false;
let xrActive = false;
let xrPlaced = false;
let hitTestSource = null;
let hitTestSourceRequested = false;

const clock = new THREE.Clock();
const loader = new GLTFLoader();

initThree();
loadAllRequiredModels();
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
  renderer.toneMappingExposure = 2.55;
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
    if (!document.hidden && cameraStarted && video.paused) video.play().catch(() => {});
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
  scene.add(new THREE.AmbientLight(0xffffff, 4.3));
  scene.add(new THREE.HemisphereLight(0xffffff, 0xdde7ff, 4.8));
  const key = new THREE.DirectionalLight(0xffffff, 5.2);
  key.position.set(2.5, 4.2, 4.6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 3.2);
  fill.position.set(-3.0, 2.8, 3.0);
  scene.add(fill);
}

async function loadAllRequiredModels() {
  try {
    if (DEBUG) setStatus('加载模型');
    const [avatar, sign, cake] = await Promise.all([
      loadRequiredGLB(MODEL_URLS.avatar, 'avatar.glb'),
      loadRequiredGLB(MODEL_URLS.sign, 'happy_birthday.glb'),
      loadRequiredGLB(MODEL_URLS.cake, 'cake.glb')
    ]);

    avatarScene = avatar.scene;
    signScene = sign.scene;
    cakeScene = cake.scene;

    fixMaterials(avatarScene);
    fixMaterials(signScene);
    fixMaterials(cakeScene);

    contentGroup.add(signScene);
    contentGroup.add(avatarScene);
    contentGroup.add(cakeScene);

    if (avatar.animations && avatar.animations.length > 0) {
      mixer = new THREE.AnimationMixer(avatarScene);
      const action = mixer.clipAction(avatar.animations[0]);
      action.reset();
      action.setLoop(THREE.LoopRepeat);
      action.timeScale = CONFIG.animationSpeed;
      action.play();
    }

    allModelsLoaded = true;
    modelLoadError = '';
    if (DEBUG) setStatus('');
    refreshLayout();
  } catch (err) {
    console.error('Required model load failed:', err);
    modelLoadError = err && err.message ? err.message : String(err);
    allModelsLoaded = false;
    setStatus(DEBUG ? `模型加载失败：${modelLoadError}` : '');
    showStartButton();
  }
}

function loadRequiredGLB(url, label) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, () => {
      if (DEBUG) setStatus('加载模型');
    }, () => reject(new Error(`缺少 ${label}`)));
  });
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

  if (!allModelsLoaded) {
    setStatus(DEBUG ? (modelLoadError || '加载模型') : '');
    startRequested = false;
    showStartButton();
    return;
  }

  if (isAndroid && navigator.xr) {
    try {
      await startWebXR();
      return;
    } catch (err) {
      console.warn('WebXR failed, fallback to camera:', err);
    }
  }

  await startFallbackCameraMode();
}

async function startWebXR() {
  if (DEBUG) setStatus('扫描地面');
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
}

async function startFallbackCameraMode() {
  fallbackMode = true;
  xrActive = false;
  video.style.display = 'block';
  try {
    await startCameraWithFallback();
    cameraStarted = true;
    refreshLayout();
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
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('getUserMedia unavailable');
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
  return '摄像头启动失败';
}

function resetModel(root) {
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.setScalar(1);
  root.updateWorldMatrix(true, true);
}

function centerModel(root, centerY = true) {
  const box = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  box.getCenter(center);
  root.position.x -= center.x;
  root.position.z -= center.z;
  if (centerY) root.position.y -= center.y;
  else root.position.y -= box.min.y;
  root.updateWorldMatrix(true, true);
}

function normalizeModel(root, targetHeight) {
  resetModel(root);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  root.scale.setScalar(targetHeight / (size.y || 1));
  root.updateWorldMatrix(true, true);
  centerModel(root, false);
}

function prepareSignAsBanner(root, targetWidth) {
  resetModel(root);

  // 尝试多种朝向，选择“屏幕横向宽度最大”的朝向，解决模型坐标轴不是横向的问题。
  const candidates = [
    [0, 0, 0],
    [0, 0, Math.PI / 2],
    [0, 0, -Math.PI / 2],
    [Math.PI / 2, 0, 0],
    [-Math.PI / 2, 0, 0],
    [0, Math.PI / 2, 0],
    [0, -Math.PI / 2, 0],
    [Math.PI / 2, 0, Math.PI / 2],
    [-Math.PI / 2, 0, -Math.PI / 2]
  ];

  let best = candidates[0];
  let bestScore = -Infinity;

  for (const rot of candidates) {
    root.position.set(0, 0, 0);
    root.scale.setScalar(1);
    root.rotation.set(rot[0], rot[1], rot[2]);
    root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const horizontal = size.x;
    const vertical = size.y || 0.001;
    const depth = size.z || 0.001;
    const score = horizontal * 3 - vertical * 0.55 - depth * 0.15;
    if (score > bestScore) {
      bestScore = score;
      best = rot;
    }
  }

  root.position.set(0, 0, 0);
  root.rotation.set(best[0], best[1], best[2]);
  root.scale.setScalar(1);
  root.updateWorldMatrix(true, true);

  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  root.scale.setScalar(targetWidth / (size.x || 1));
  root.updateWorldMatrix(true, true);
  centerModel(root, true);
}

function layoutScene({ avatarHeight, signWidth, cakeHeight }) {
  if (!allModelsLoaded) return;

  normalizeModel(avatarScene, avatarHeight);
  prepareSignAsBanner(signScene, signWidth);
  normalizeModel(cakeScene, cakeHeight);

  avatarScene.position.set(0, 0, 0);

  // 标题：真正横向悬在人物上方，略微靠后，避免贴头。
  signScene.position.x += 0;
  signScene.position.y += avatarHeight * 1.12;
  signScene.position.z += -avatarHeight * 0.18;

  // 蛋糕：居中放在人物脚下偏前方，形成“上中下”结构。
  cakeScene.position.x += 0;
  cakeScene.position.y += -avatarHeight * 0.20;
  cakeScene.position.z += avatarHeight * 0.32;
  cakeScene.rotation.y = 0;
}

function refreshLayout() {
  if (!allModelsLoaded) return;
  if (fallbackMode && cameraStarted) layoutFallback();
  else if (xrActive && xrPlaced) layoutXRAtCurrentAnchor();
}

function layoutFallback() {
  const portrait = window.innerHeight >= window.innerWidth;
  const avatarHeight = portrait ? CONFIG.avatarHeightFallbackPortrait : CONFIG.avatarHeightFallbackLandscape;
  const signWidth = portrait ? CONFIG.signWidthFallbackPortrait : CONFIG.signWidthFallbackLandscape;
  const cakeHeight = portrait ? CONFIG.cakeHeightFallbackPortrait : CONFIG.cakeHeightFallbackLandscape;
  const z = portrait ? CONFIG.fallbackDistancePortrait : CONFIG.fallbackDistanceLandscape;
  const feetY = portrait ? CONFIG.fallbackFeetYPortrait : CONFIG.fallbackFeetYLandscape;

  layoutScene({ avatarHeight, signWidth, cakeHeight });

  rootGroup.position.set(0, feetY, z);
  rootGroup.rotation.set(0, 0, 0);
  rootGroup.visible = true;
  setStatus('');
}

function layoutXRAtCurrentAnchor() {
  layoutScene({
    avatarHeight: CONFIG.avatarHeightXR,
    signWidth: CONFIG.signWidthXR,
    cakeHeight: CONFIG.cakeHeightXR
  });
}

function placeOnReticle() {
  if (!allModelsLoaded || !reticle.visible || xrPlaced) return;
  layoutXRAtCurrentAnchor();
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
    if (!xrPlaced) placeOnReticle();
  } else if (!xrPlaced) {
    reticle.visible = false;
    if (DEBUG) setStatus('扫描地面');
  }
}

function renderLoop(timestamp, frame) {
  const dt = Math.min(clock.getDelta(), 0.033);
  if (mixer) mixer.update(dt);
  if (xrActive && frame && !xrPlaced) updateHitTest(frame);
  renderer.render(scene, camera);
}
