import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const video = document.getElementById('cameraVideo');
const startButton = document.getElementById('startButton');
const statusText = document.getElementById('statusText');
const DEBUG = new URLSearchParams(location.search).has('debug');
if (DEBUG) document.body.classList.add('debug');

const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let scene, camera, renderer;
let avatarHolder, avatarRoot, mixer;
let modelLoaded = false;
let cameraStarted = false;
let experienceStarted = false;
let normalizedOnce = false;

const clock = new THREE.Clock();

// iOS稳定版：不用 WebXR 平面检测，避免 iPhone 黑屏。
// 人物固定在摄像头画面的下方，完整显示，并随镜头画面一起移动。
const CONFIG = {
  modelHeightPortrait: isIOS ? 1.55 : 1.45,
  modelHeightLandscape: isIOS ? 1.25 : 1.20,
  distancePortrait: isIOS ? -5.15 : -5.0,
  distanceLandscape: isIOS ? -4.8 : -4.7,
  feetYPortrait: isIOS ? -2.22 : -2.15,
  feetYLandscape: isIOS ? -1.72 : -1.65,
  animationSpeed: 0.92
};

initThree();
loadAvatar();

startButton.addEventListener('click', () => startExperience(false), { passive: true });
window.addEventListener('pageshow', () => {
  // 尝试自动弹出 iOS/Android 的系统摄像头权限。
  // 如果系统要求用户手势，会失败并显示唯一的“开始”按钮。
  setTimeout(() => startExperience(true), 220);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && cameraStarted && video.paused) {
    video.play().catch(() => {});
  }
});

function setStatus(message) {
  if (!statusText) return;
  statusText.textContent = message || '';
  statusText.classList.toggle('show', Boolean(message));
}

function showStartButton() {
  startButton.classList.add('show');
}

function hideStartButton() {
  startButton.classList.remove('show');
}

async function startExperience(isAutoAttempt) {
  if (experienceStarted || cameraStarted) return;
  experienceStarted = true;
  hideStartButton();
  setStatus(DEBUG ? '启动摄像头' : '');

  try {
    await startCamera();
    cameraStarted = true;
    setStatus(modelLoaded ? '' : (DEBUG ? '加载人物模型' : ''));
    if (modelLoaded) showAvatarStable();
  } catch (err) {
    console.warn('Camera start failed:', err);
    experienceStarted = false;

    // 自动启动失败是正常情况：iOS 有时需要用户点一下。
    if (isAutoAttempt) {
      setStatus('');
      showStartButton();
    } else {
      setStatus(DEBUG ? readableCameraError(err) : '');
      showStartButton();
    }
  }
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('getUserMedia unavailable');
  }

  const constraints = {
    audio: false,
    video: {
      facingMode: isMobile ? { ideal: 'environment' } : 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
  };

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
  if (/NotAllowed|Permission/i.test(name)) return '摄像头权限被拒绝，请在 Safari 设置中允许相机';
  if (/NotFound|DevicesNotFound/i.test(name)) return '没有找到摄像头';
  if (/NotReadable|TrackStart/i.test(name)) return '摄像头可能被其他软件占用';
  if (/Overconstrained/i.test(name)) return '摄像头参数不兼容';
  return '摄像头启动失败';
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
  renderer.toneMappingExposure = 2.75;
  document.body.appendChild(renderer.domElement);

  avatarHolder = new THREE.Group();
  avatarHolder.visible = false;
  scene.add(avatarHolder);

  addStableLighting();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isIOS ? 1.5 : 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (modelLoaded) showAvatarStable();
  });

  renderer.setAnimationLoop(renderLoop);
}

function addStableLighting() {
  scene.add(new THREE.AmbientLight(0xffffff, 3.8));
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8e4ff, 4.2));

  const key = new THREE.DirectionalLight(0xffffff, 5.2);
  key.position.set(2.5, 4.2, 4.5);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xffffff, 3.3);
  fill.position.set(-3.0, 2.7, 3.0);
  scene.add(fill);

  const back = new THREE.DirectionalLight(0xffffff, 2.0);
  back.position.set(0.5, 3.2, -4.5);
  scene.add(back);
}

function loadAvatar() {
  setStatus(DEBUG ? '加载人物模型' : '');
  const loader = new GLTFLoader();
  loader.load('./assets/avatar.glb', (gltf) => {
    avatarRoot = gltf.scene;
    fixMaterials(avatarRoot);
    avatarHolder.add(avatarRoot);
    modelLoaded = true;

    if (gltf.animations && gltf.animations.length > 0) {
      mixer = new THREE.AnimationMixer(avatarRoot);
      const action = mixer.clipAction(gltf.animations[0]);
      action.reset();
      action.setLoop(THREE.LoopRepeat);
      action.timeScale = CONFIG.animationSpeed;
      action.play();
    }

    setStatus(cameraStarted ? '' : (DEBUG ? '等待摄像头' : ''));
    if (cameraStarted) showAvatarStable();
  }, (event) => {
    if (DEBUG && event.total) {
      setStatus('加载人物模型 ' + Math.round(event.loaded / event.total * 100) + '%');
    }
  }, (err) => {
    console.error('Model load failed:', err);
    setStatus(DEBUG ? '人物模型加载失败：检查 assets/avatar.glb' : '');
    showStartButton();
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
      mat.transparent = false;
      mat.alphaTest = Math.max(mat.alphaTest || 0, 0.18);
      if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
      mat.needsUpdate = true;
    });
  });
}

function normalizeAvatar(root, targetHeight) {
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.setScalar(1);
  root.updateWorldMatrix(true, true);

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
  normalizedOnce = true;
}

function showAvatarStable() {
  if (!avatarRoot) return;

  const portrait = window.innerHeight >= window.innerWidth;
  const targetHeight = portrait ? CONFIG.modelHeightPortrait : CONFIG.modelHeightLandscape;
  const z = portrait ? CONFIG.distancePortrait : CONFIG.distanceLandscape;
  const feetY = portrait ? CONFIG.feetYPortrait : CONFIG.feetYLandscape;

  normalizeAvatar(avatarRoot, targetHeight);

  avatarHolder.matrixAutoUpdate = true;
  avatarHolder.position.set(0, feetY, z);
  avatarHolder.rotation.set(0, 0, 0);
  avatarHolder.visible = true;
  setStatus('');
}

function renderLoop() {
  const dt = Math.min(clock.getDelta(), 0.033);
  if (mixer) mixer.update(dt);

  // 稍微跟随屏幕方向保持稳定，不做真实世界平面锚定，确保 iOS 不黑屏。
  if (avatarHolder && avatarHolder.visible && cameraStarted) {
    avatarHolder.rotation.y = 0;
  }

  renderer.render(scene, camera);
}
