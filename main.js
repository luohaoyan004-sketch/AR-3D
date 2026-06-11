import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';

const video = document.getElementById('cameraVideo');
const startButton = document.getElementById('startButton');
const statusText = document.getElementById('statusText');
const DEBUG = new URLSearchParams(location.search).has('debug');
if (DEBUG) document.body.classList.add('debug');

const isAndroid = /Android/i.test(navigator.userAgent);
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

let scene, camera, renderer;
let avatarHolder, avatarRoot, mixer;
let modelLoaded = false;
let cameraStarted = false;
let xrActive = false;
let xrPlaced = false;
let hitTestSource = null;
let hitTestSourceRequested = false;
let reticle;
let overlayRoot;
let fallbackMode = false;

const clock = new THREE.Clock();

const CONFIG = {
  modelHeightPortrait: isIOS ? 1.55 : 1.45,
  modelHeightLandscape: isIOS ? 1.25 : 1.20,
  distancePortrait: isIOS ? -5.15 : -5.0,
  distanceLandscape: isIOS ? -4.8 : -4.7,
  feetYPortrait: isIOS ? -2.22 : -2.15,
  feetYLandscape: isIOS ? -1.72 : -1.65,
  xrModelHeight: 0.75,
  animationSpeed: 0.92
};

bootThree();
loadAvatar();
wireStart();

function wireStart() {
  window.startARExperience = startExperience;
  startButton.classList.add('show');
  if (window.AR_PENDING_START) startExperience();
}

function setStatus(message) {
  if (!statusText) return;
  statusText.textContent = message || '';
  statusText.classList.toggle('show', Boolean(message));
}

function hideStartButton() {
  startButton.classList.add('hide');
  startButton.classList.remove('show');
}

function showStartButton() {
  startButton.classList.remove('hide');
  startButton.classList.add('show');
}

async function startExperience() {
  hideStartButton();

  if (isAndroid && navigator.xr) {
    const supported = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
    if (supported) {
      startWebXR();
      return;
    }
  }

  startFallbackCamera();
}

function bootThree() {
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
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  avatarHolder = new THREE.Group();
  avatarHolder.visible = false;
  scene.add(avatarHolder);

  createReticle();
  addLights();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isIOS ? 1.5 : 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (modelLoaded && fallbackMode) showAvatarFallback();
  });

  renderer.setAnimationLoop(renderLoop);
}

function createReticle() {
  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.11, 0.13, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);
}

function addLights() {
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

function startWebXR() {
  setStatus(DEBUG ? '启动 AR，移动手机扫描地面' : '');

  overlayRoot = document.createElement('div');
  overlayRoot.style.display = 'none';
  document.body.appendChild(overlayRoot);

  const button = ARButton.createButton(renderer, {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: { root: overlayRoot }
  });

  button.style.display = 'none';
  document.body.appendChild(button);
  button.click();

  renderer.xr.addEventListener('sessionstart', () => {
    xrActive = true;
    fallbackMode = false;
    video.style.display = 'none';
    setStatus(DEBUG ? '扫描地面，识别后人物会自动落地' : '');
  });

  renderer.xr.addEventListener('sessionend', () => {
    xrActive = false;
    xrPlaced = false;
    hitTestSource = null;
    hitTestSourceRequested = false;
    reticle.visible = false;
    avatarHolder.visible = false;
    setStatus('');
    showStartButton();
  });

  setTimeout(() => {
    if (!xrActive) {
      setStatus(DEBUG ? 'AR 启动失败，切换普通摄像头模式' : '');
      startFallbackCamera();
    }
  }, 2800);
}

async function startFallbackCamera() {
  fallbackMode = true;
  setStatus(DEBUG ? '打开普通摄像头模式' : '');
  try {
    await startCameraWithFallback();
    cameraStarted = true;
    setStatus(modelLoaded ? '' : (DEBUG ? '摄像头已打开，正在加载人物' : ''));
    if (modelLoaded) showAvatarFallback();
  } catch (err) {
    console.warn('Camera start failed:', err);
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
  } catch (firstErr) {
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
  if (/NotAllowed|Permission/i.test(name)) return '摄像头权限被拒绝，请在 Safari/Chrome 设置中允许相机';
  if (/NotFound|DevicesNotFound/i.test(name)) return '没有找到摄像头';
  if (/NotReadable|TrackStart/i.test(name)) return '摄像头可能被其他软件占用';
  if (/Overconstrained/i.test(name)) return '摄像头参数不兼容';
  if (/getUserMedia unavailable/i.test(name)) return '当前浏览器不支持摄像头调用，请用 Safari/Chrome 打开 HTTPS 链接';
  return '摄像头启动失败';
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

    if (xrActive && reticle.visible && !xrPlaced) {
      placeAvatarOnReticle();
    } else if (fallbackMode && cameraStarted) {
      showAvatarFallback();
    } else {
      setStatus(DEBUG ? '人物已加载，请点击开始' : '');
    }
  }, (event) => {
    if (DEBUG && event.total) {
      setStatus('加载人物模型 ' + Math.round(event.loaded / event.total * 100) + '%');
    }
  }, (err) => {
    console.error('Model load failed:', err);
    setStatus(DEBUG ? '人物模型加载失败：检查 /assets/avatar.glb' : '');
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
}

function showAvatarFallback() {
  if (!avatarRoot) return;
  const portrait = window.innerHeight >= window.innerWidth;
  const targetHeight = portrait ? CONFIG.modelHeightPortrait : CONFIG.modelHeightLandscape;
  const z = portrait ? CONFIG.distancePortrait : CONFIG.distanceLandscape;
  const feetY = portrait ? CONFIG.feetYPortrait : CONFIG.feetYLandscape;

  normalizeAvatar(avatarRoot, targetHeight);
  avatarHolder.position.set(0, feetY, z);
  avatarHolder.rotation.set(0, 0, 0);
  avatarHolder.visible = true;
  setStatus('');
}

function placeAvatarOnReticle() {
  if (!avatarRoot || !reticle.visible || xrPlaced) return;
  normalizeAvatar(avatarRoot, CONFIG.xrModelHeight);
  avatarHolder.position.setFromMatrixPosition(reticle.matrix);
  avatarHolder.rotation.setFromRotationMatrix(reticle.matrix);
  avatarHolder.visible = true;
  reticle.visible = false;
  xrPlaced = true;
  setStatus('');
}

function updateHitTest(frame) {
  const session = renderer.xr.getSession();
  if (!session) return;

  if (!hitTestSourceRequested) {
    session.requestReferenceSpace('viewer').then((referenceSpace) => {
      session.requestHitTestSource({ space: referenceSpace }).then((source) => {
        hitTestSource = source;
      });
    });
    session.addEventListener('end', () => {
      hitTestSourceRequested = false;
      hitTestSource = null;
    });
    hitTestSourceRequested = true;
  }

  if (hitTestSource) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const hitTestResults = frame.getHitTestResults(hitTestSource);
    if (hitTestResults.length) {
      const hit = hitTestResults[0];
      const pose = hit.getPose(referenceSpace);
      reticle.visible = true;
      reticle.matrix.fromArray(pose.transform.matrix);
      setStatus(DEBUG && !xrPlaced ? '已识别平面，人物自动放置中' : '');
      if (modelLoaded && !xrPlaced) placeAvatarOnReticle();
    } else if (!xrPlaced) {
      reticle.visible = false;
      setStatus(DEBUG ? '正在扫描地面，请缓慢移动手机' : '');
    }
  }
}

function renderLoop(timestamp, frame) {
  const dt = Math.min(clock.getDelta(), 0.033);
  if (mixer) mixer.update(dt);

  if (xrActive && frame && !xrPlaced) updateHitTest(frame);

  if (fallbackMode && avatarHolder && avatarHolder.visible) {
    avatarHolder.rotation.y = 0;
  }

  renderer.render(scene, camera);
}
