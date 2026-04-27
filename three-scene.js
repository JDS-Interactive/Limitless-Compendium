import * as THREE from "three";

export const ORB_COLORS = [
  0x8be9fd,
  0xbd93f9,
  0x50fa7b,
  0xffb86c,
  0xff79c6,
  0xf1fa8c
];

const FORWARD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const TEMP = new THREE.Vector3();
const TARGET_POS = new THREE.Vector3();
const TARGET_LOOK = new THREE.Vector3();
const START_POS = new THREE.Vector3();
const START_QUAT = new THREE.Quaternion();
const END_QUAT = new THREE.Quaternion();

export class NeuralScene {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x050816, 0.012);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 3000);
    this.camera.position.set(0, 0, 8);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance"
    });

    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x050816, 1);

    this.clock = new THREE.Clock();

    this.yaw = 0;
    this.pitch = 0;
    this.lookSensitivity = 0.0022;
    this.flySpeed = 10.5;

    this.moveState = {
      forward: 0,
      strafe: 0,
      desktopForward: false,
      desktopBackward: false,
      wheelVelocity: 0,
      lookX: 0,
      lookY: 0
    };
    this.mouseLookHeld = false;

    this.orbGroup = new THREE.Group();
    this.orbMeshes = new Map();
    this.selectedOrbId = null;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.lastPointerDown = null;
    this.clickTimer = null;
    this.lastClickedOrbId = null;
    this.clickDelay = 260;
    this.tapMemory = {
      id: null,
      time: 0
    };

    this.travel = null;

    this.scene.add(this.orbGroup);
    this.#initLights();
    this.#initBackdrop();
    this.#bindEvents();
    this.resize();
  }

  #initLights() {
    this.scene.add(new THREE.AmbientLight(0x7f9cff, 1.2));

    const key = new THREE.PointLight(0x8be9fd, 2.2, 260);
    key.position.set(30, 40, 40);
    this.scene.add(key);

    const fill = new THREE.PointLight(0xbd93f9, 1.7, 260);
    fill.position.set(-45, -25, 30);
    this.scene.add(fill);
  }

  #initBackdrop() {
    const starGeometry = new THREE.BufferGeometry();
    const count = 1800;
    const positions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const radius = 180 + Math.random() * 780;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);
    }

    starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        color: 0xc8d9ff,
        size: 1.1,
        transparent: true,
        opacity: 0.78,
        depthWrite: false
      })
    );

    this.scene.add(stars);

    const neuronMaterial = new THREE.LineBasicMaterial({
      color: 0x37517e,
      transparent: true,
      opacity: 0.22
    });

    for (let i = 0; i < 90; i++) {
      const points = [];
      const origin = new THREE.Vector3(
        (Math.random() - 0.5) * 260,
        (Math.random() - 0.5) * 160,
        (Math.random() - 0.5) * 260
      );

      for (let j = 0; j < 4; j++) {
        points.push(origin.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * 28,
          (Math.random() - 0.5) * 28,
          (Math.random() - 0.5) * 28
        )));
      }

      const curve = new THREE.CatmullRomCurve3(points);
      const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(18));
      this.scene.add(new THREE.Line(geometry, neuronMaterial));
    }
  }

  #bindEvents() {
    window.addEventListener("resize", () => this.resize());

    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    this.canvas.addEventListener("pointerdown", (event) => {
      this.lastPointerDown = {
        x: event.clientX,
        y: event.clientY,
        button: event.button,
        pointerType: event.pointerType,
        time: performance.now()
      };

      this.canvas.setPointerCapture(event.pointerId);

      if (event.pointerType === "touch") return;
      if (this.travel) return;

      if (event.button === 0 || event.button === 2) {
        this.mouseLookHeld = true;
      }

      if (event.button === 1) {
        event.preventDefault();
        this.callbacks.onPlaceOrb?.(this.getPlacementPosition());
      }
    });

    this.canvas.addEventListener("pointerup", (event) => {
      const down = this.lastPointerDown;
      if (!down) return;

      const dx = event.clientX - down.x;
      const dy = event.clientY - down.y;
      const distance = Math.hypot(dx, dy);
      const elapsed = performance.now() - down.time;

      if (event.pointerType !== "touch") {
        if (event.button === 0 || event.button === 2) {
          this.mouseLookHeld = false;
        }
      }

      const isTapLike = distance < 10 && elapsed < 330;
      if (isTapLike && (event.pointerType === "touch" || down.button === 0)) {
        this.#handleOrbTap(event);
      }
    });

    this.canvas.addEventListener("pointercancel", () => {
      this.moveState.desktopForward = false;
      this.moveState.desktopBackward = false;
    });

    this.canvas.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") return;
      if (this.travel) return;

      if (!this.mouseLookHeld) return;

      const movementX = event.movementX || 0;
      const movementY = event.movementY || 0;
      this.look(movementX, movementY);
    });

    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      if (this.travel) return;
      this.moveState.wheelVelocity += event.deltaY < 0 ? 3.8 : -3.8;
    }, { passive: false });

    window.addEventListener("keydown", (event) => {
      if (event.code === "Space" && !isTypingTarget(event.target)) {
        event.preventDefault();
        this.callbacks.onPlaceOrb?.(this.getPlacementPosition());
      }
    });

    window.addEventListener("keyup", (event) => {
      if (event.code === "KeyW") this.moveState.forward = 0;
      if (event.code === "KeyS") this.moveState.forward = 0;
      if (event.code === "KeyA") this.moveState.strafe = 0;
      if (event.code === "KeyD") this.moveState.strafe = 0;
    });

    window.addEventListener("keydown", (event) => {
      if (isTypingTarget(event.target) || this.travel) return;
      if (event.code === "KeyW") this.moveState.forward = 1;
      if (event.code === "KeyS") this.moveState.forward = -1;
      if (event.code === "KeyA") this.moveState.strafe = -1;
      if (event.code === "KeyD") this.moveState.strafe = 1;
    });
  }

  #handleOrbTap(event) {
    if (this.travel) return;

    const orb = this.pickOrb(event.clientX, event.clientY);
    if (!orb) {
      this.setSelectedOrb(null);
      return;
    }

    const id = orb.userData.id;
    const now = performance.now();
    const repeatedTap = this.tapMemory.id === id && now - this.tapMemory.time < 900;

    if (repeatedTap) {
      this.tapMemory = { id: null, time: 0 };
      this.startEnterOrbTravel(id);
      return;
    }

    this.tapMemory = { id, time: now };
    this.setSelectedOrb(id);
    this.callbacks.onSelectOrb?.(id);
  }

  setSelectedOrb(id) {
    this.selectedOrbId = id;
    for (const [orbId, mesh] of this.orbMeshes) {
      mesh.userData.selected = orbId === id;
      this.#refreshOrbSelection(mesh);
    }
  }

  startEnterOrbTravel(id) {
    const mesh = this.orbMeshes.get(id);
    if (!mesh) return;

    this.setSelectedOrb(id);
    this.moveState.desktopForward = false;
    this.moveState.desktopBackward = false;
    this.moveState.forward = 0;
    this.moveState.strafe = 0;
    this.moveState.wheelVelocity = 0;

    const orbRadius = mesh.scale.x;
    const startDistance = this.camera.position.distanceTo(mesh.position);
    const approachDistance = Math.max(0.32, Math.min(1.2, orbRadius * 0.38));

    START_POS.copy(this.camera.position);
    START_QUAT.copy(this.camera.quaternion);

    TARGET_LOOK.copy(mesh.position);
    const fromOrbToCamera = START_POS.clone().sub(mesh.position).normalize();
    if (fromOrbToCamera.lengthSq() < 0.001) {
      this.camera.getWorldDirection(fromOrbToCamera).multiplyScalar(-1);
    }

    TARGET_POS.copy(mesh.position).add(fromOrbToCamera.multiplyScalar(approachDistance));
    this.camera.lookAt(TARGET_LOOK);
    END_QUAT.copy(this.camera.quaternion);
    this.camera.position.copy(START_POS);
    this.camera.quaternion.copy(START_QUAT);

    this.travel = {
      id,
      startTime: performance.now(),
      duration: THREE.MathUtils.clamp(startDistance * 130, 900, 2400),
      startPos: START_POS.clone(),
      endPos: TARGET_POS.clone(),
      startQuat: START_QUAT.clone(),
      endQuat: END_QUAT.clone(),
      lastBob: 0
    };

    this.callbacks.onTravelStart?.(id);
  }


  travelToMemory(id) {
    this.startEnterOrbTravel(id);
  }

  resize() {
    const width = this.canvas.clientWidth || innerWidth;
    const height = this.canvas.clientHeight || innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  look(deltaX, deltaY) {
    this.yaw -= deltaX * this.lookSensitivity;
    this.pitch -= deltaY * this.lookSensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);

    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  syncYawPitchFromCamera() {
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ");
    this.yaw = euler.y;
    this.pitch = euler.x;
  }

  setMobileMove(x, y) {
    if (this.travel) return;
    this.moveState.strafe = x;
    this.moveState.forward = -y;
  }

  setMobileLook(x, y) {
    if (this.travel) return;
    this.moveState.lookX = x;
    this.moveState.lookY = y;
  }

  getPlacementPosition(distance = 7) {
    this.camera.getWorldDirection(FORWARD);
    const position = this.camera.position.clone().add(FORWARD.multiplyScalar(distance));
    return {
      x: Number(position.x.toFixed(3)),
      y: Number(position.y.toFixed(3)),
      z: Number(position.z.toFixed(3))
    };
  }

  renderMemories(memories) {
    const visibleIds = new Set(memories.map((memory) => memory.id));

    for (const [id, mesh] of this.orbMeshes) {
      if (!visibleIds.has(id)) {
        this.orbGroup.remove(mesh);
        this.orbMeshes.delete(id);
      }
    }

    for (const memory of memories) {
      let mesh = this.orbMeshes.get(memory.id);
      if (!mesh) {
        mesh = this.#createOrbMesh(memory);
        this.orbMeshes.set(memory.id, mesh);
        this.orbGroup.add(mesh);
      }

      this.#applyMemoryToMesh(mesh, memory);
    }

    this.#rebuildLinks(memories);
  }

  #createOrbMesh(memory) {
    const geometry = new THREE.SphereGeometry(1, 32, 32);
    const material = new THREE.MeshStandardMaterial({
      color: ORB_COLORS[memory.colorIndex % ORB_COLORS.length],
      emissive: ORB_COLORS[memory.colorIndex % ORB_COLORS.length],
      emissiveIntensity: 1.45,
      roughness: 0.3,
      metalness: 0.15,
      transparent: true,
      opacity: 0.9
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.id = memory.id;

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(1.18, 32, 32),
      new THREE.MeshBasicMaterial({
        color: ORB_COLORS[memory.colorIndex % ORB_COLORS.length],
        transparent: true,
        opacity: 0.12,
        depthWrite: false
      })
    );

    const selectionRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.45, 0.035, 12, 96),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false
      })
    );
    selectionRing.rotation.x = Math.PI / 2;

    mesh.add(halo);
    mesh.add(selectionRing);
    return mesh;
  }

  #applyMemoryToMesh(mesh, memory) {
    const color = ORB_COLORS[memory.colorIndex % ORB_COLORS.length];
    const size = 0.55 + (memory.strength ?? 0.2) * 0.75;

    mesh.position.set(memory.position.x, memory.position.y, memory.position.z);
    mesh.scale.setScalar(size);
    mesh.material.color.setHex(color);
    mesh.material.emissive.setHex(color);
    mesh.material.emissiveIntensity = 1.1 + (memory.strength ?? 0.2) * 0.8;
    mesh.children[0].material.color.setHex(color);
    mesh.children[0].material.opacity = 0.1 + Math.min(memory.strength ?? 0.2, 1.5) * 0.08;
    mesh.userData.memory = memory;
    mesh.userData.selected = this.selectedOrbId === memory.id;
    this.#refreshOrbSelection(mesh);
  }

  #refreshOrbSelection(mesh) {
    const ring = mesh.children[1];
    if (!ring) return;
    ring.material.opacity = mesh.userData.selected ? 0.8 : 0;
    ring.scale.setScalar(mesh.userData.selected ? 1.05 : 1);
  }

  #rebuildLinks(memories) {
    if (this.linkGroup) this.scene.remove(this.linkGroup);
    this.linkGroup = new THREE.Group();

    const memoryMap = new Map(memories.map((memory) => [memory.id, memory]));
    const material = new THREE.LineBasicMaterial({
      color: 0x8be9fd,
      transparent: true,
      opacity: 0.32
    });

    for (const memory of memories) {
      for (const linkId of memory.links || []) {
        const linked = memoryMap.get(linkId);
        if (!linked) continue;

        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(memory.position.x, memory.position.y, memory.position.z),
          new THREE.Vector3(linked.position.x, linked.position.y, linked.position.z)
        ]);

        this.linkGroup.add(new THREE.Line(geometry, material));
      }
    }

    this.scene.add(this.linkGroup);
  }

  pickOrb(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects([...this.orbMeshes.values()], false);
    return intersections[0]?.object || null;
  }

  start() {
    this.renderer.setAnimationLoop(() => this.#tick());
  }

  #tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.travel) {
      this.#tickTravel();
    } else {
      this.look(
        this.moveState.lookX * 18,
        this.moveState.lookY * 18
      );

      const forwardAmount =
      this.moveState.forward +
      this.moveState.wheelVelocity;

      this.moveState.wheelVelocity *= Math.pow(0.0009, dt);

      this.camera.getWorldDirection(FORWARD);
      FORWARD.normalize();

      RIGHT.crossVectors(FORWARD, this.camera.up).normalize();

      TEMP.set(0, 0, 0);
      TEMP.addScaledVector(FORWARD, forwardAmount);
      TEMP.addScaledVector(RIGHT, this.moveState.strafe);

      if (TEMP.lengthSq() > 0.0001) {
        TEMP.normalize().multiplyScalar(this.flySpeed * dt * Math.min(Math.abs(forwardAmount) + Math.abs(this.moveState.strafe), 2.2));
        this.camera.position.add(TEMP);
      }
    }

    const t = performance.now() * 0.001;
    for (const mesh of this.orbMeshes.values()) {
      mesh.rotation.y += dt * 0.18;
      mesh.children[0].scale.setScalar(1 + Math.sin(t * 2.2 + mesh.position.x) * 0.035);
      if (mesh.children[1]) {
        mesh.children[1].lookAt(this.camera.position);
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  #tickTravel() {
    const travel = this.travel;
    const elapsed = performance.now() - travel.startTime;
    const raw = Math.min(elapsed / travel.duration, 1);
    const eased = easeInOutCubic(raw);

    const bob = Math.sin(eased * Math.PI * 8) * 0.045 * (1 - eased);
    this.camera.position.lerpVectors(travel.startPos, travel.endPos, eased);
    this.camera.position.y += bob;

    this.camera.quaternion.slerpQuaternions(travel.startQuat, travel.endQuat, eased);

    const mesh = this.orbMeshes.get(travel.id);
    if (mesh) {
      const collisionDistance = Math.max(0.55, mesh.scale.x * 0.92);
      if (this.camera.position.distanceTo(mesh.position) <= collisionDistance || raw >= 1) {
        this.travel = null;
        this.camera.position.copy(mesh.position);
        this.camera.lookAt(mesh.position.clone().add(new THREE.Vector3(0, 0, -1)));
        this.syncYawPitchFromCamera();
        this.callbacks.onTravelComplete?.(travel.id);
      }
    } else {
      this.travel = null;
    }
  }
}

function easeInOutCubic(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function isTypingTarget(target) {
  const tag = target?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || target?.isContentEditable;
}
