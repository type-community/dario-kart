import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildKartBody } from "./scene.ts";

export interface PreviewLook {
  kart: string;
  character: string;
  primary: number;
  secondary: number;
}

/** A turntable for the kart you're building in the lobby. Owns its own small renderer. */
export class KartPreview {
  readonly canvas = document.createElement("canvas");
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  private readonly turntable = new THREE.Group();
  private body: THREE.Group | null = null;
  private glow: THREE.Material | null = null;
  private key = "";
  private running = false;
  private last = 0;
  private spin = 0.6;
  private dragging = false;
  private dragX = 0;

  constructor() {
    this.canvas.className = "kart-preview-canvas";
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.9;

    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(4, 7, 5);
    const rim = new THREE.DirectionalLight(0x3de0ff, 1.6);
    rim.position.set(-5, 3, -5);
    const fill = new THREE.DirectionalLight(0xff3d7f, 0.8);
    fill.position.set(-6, 2, 4);
    this.scene.add(key, rim, fill, new THREE.AmbientLight(0xffffff, 0.25));

    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.6, 0.2, 48),
      new THREE.MeshStandardMaterial({ color: 0x1b1f3b, roughness: 0.35, metalness: 0.6 }),
    );
    disc.position.y = -0.1;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(3.45, 0.04, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0xffc93c }),
    );
    ring.rotation.x = Math.PI / 2;
    this.turntable.add(disc, ring);
    this.scene.add(this.turntable);

    this.camera.position.set(5.6, 2.5, 6.2);
    this.camera.lookAt(0, 0.55, 0);

    this.canvas.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.dragX = e.clientX;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      this.turntable.rotation.y += (e.clientX - this.dragX) * 0.01;
      this.dragX = e.clientX;
    });
    this.canvas.addEventListener("pointerup", () => (this.dragging = false));
  }

  setLook(look: PreviewLook): void {
    const key = `${look.kart}|${look.character}|${look.primary}|${look.secondary}`;
    if (key === this.key) return;
    this.key = key;
    if (this.body) {
      this.turntable.remove(this.body);
      this.glow?.dispose();
    }
    const built = buildKartBody(look);
    this.body = built.body;
    this.glow = built.glow;
    this.turntable.add(this.body);
    // A monster truck or a dragster needs the camera further back than a go-kart.
    const size = new THREE.Box3().setFromObject(this.body).getSize(new THREE.Vector3());
    const middle = size.y / 2;
    const distance = 8.6 * Math.max(1, size.length() / 5.2) * (1 + Math.max(0, size.y - 1.8) * 0.3);
    this.camera.position.set(5.6, 1.95, 6.2).setLength(distance).add(new THREE.Vector3(0, middle * 0.6 + 0.3, 0));
    this.camera.lookAt(0, middle * 0.6 + 0.2, 0);
  }

  /** Attach into a container; the canvas survives lobby re-renders. */
  mount(container: HTMLElement): void {
    if (this.canvas.parentElement !== container) container.append(this.canvas);
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(this.frame);
    }
  }

  stop(): void {
    this.running = false;
    this.canvas.remove();
  }

  private frame = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.dragging) this.turntable.rotation.y += this.spin * dt;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w > 0 && h > 0) {
      if (this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio())) {
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
      this.renderer.render(this.scene, this.camera);
    }
    requestAnimationFrame(this.frame);
  };
}
