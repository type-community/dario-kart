import { type Input, InputBit } from "@dario-kart/sim";

const LEFT = new Set(["ArrowLeft", "KeyA"]);
const RIGHT = new Set(["ArrowRight", "KeyD"]);
const UP = new Set(["ArrowUp", "KeyW"]);
const DOWN = new Set(["ArrowDown", "KeyS"]);
const DRIFT = new Set(["Space", "ShiftLeft", "ShiftRight"]);
const ITEM = new Set(["KeyE", "KeyJ", "Enter"]);
const BACK = new Set(["KeyQ"]);
const GAME_KEYS = new Set([...LEFT, ...RIGHT, ...UP, ...DOWN, ...DRIFT, ...ITEM, ...BACK]);

/** Keyboard + gamepad, sampled once per sim tick into a sim Input. */
export class Controls {
  private readonly held = new Set<string>();
  private steer = 0;
  /** Gamepads only count once they've changed from their resting state (some devices report stuck buttons). */
  private readonly padBaseline = new Map<number, string>();
  private readonly padActive = new Set<number>();
  enabled = false;

  constructor() {
    window.addEventListener("keydown", (e) => {
      if (!this.enabled || !GAME_KEYS.has(e.code)) return;
      if (e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      this.held.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.held.delete(e.code));
    window.addEventListener("blur", () => this.held.clear());
    window.addEventListener("gamepaddisconnected", (e) => {
      this.padBaseline.delete(e.gamepad.index);
      this.padActive.delete(e.gamepad.index);
    });
  }

  private any(keys: Set<string>): boolean {
    for (const k of keys) if (this.held.has(k)) return true;
    return false;
  }

  sample(dt: number, out: Input): Input {
    let target = 0;
    let bits = 0;
    if (this.any(LEFT)) target -= 1;
    if (this.any(RIGHT)) target += 1;
    if (this.any(UP)) bits |= InputBit.Throttle;
    if (this.any(DOWN)) bits |= InputBit.Brake | InputBit.Back;
    if (this.any(DRIFT)) bits |= InputBit.Drift;
    if (this.any(ITEM)) bits |= InputBit.Item;
    if (this.any(BACK)) bits |= InputBit.Item | InputBit.Back;

    let analog: number | null = null;
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      if (!this.padActive.has(pad.index)) {
        const signature = pad.buttons.map((b) => (b.value > 0.5 ? 1 : 0)).join("") + pad.axes.map((a) => Math.round(a * 2)).join(",");
        const baseline = this.padBaseline.get(pad.index);
        if (baseline === undefined) this.padBaseline.set(pad.index, signature);
        if (baseline === undefined || baseline === signature) continue;
        this.padActive.add(pad.index);
      }
      const x = pad.axes[0] ?? 0;
      const y = pad.axes[1] ?? 0;
      if (Math.abs(x) > 0.15) analog = x;
      if ((pad.buttons[7]?.value ?? 0) > 0.2 || pad.buttons[0]?.pressed) bits |= InputBit.Throttle;
      if ((pad.buttons[6]?.value ?? 0) > 0.2 || pad.buttons[1]?.pressed) bits |= InputBit.Brake;
      if (pad.buttons[5]?.pressed || pad.buttons[2]?.pressed) bits |= InputBit.Drift;
      if (pad.buttons[4]?.pressed || pad.buttons[3]?.pressed) bits |= InputBit.Item;
      if (y > 0.5) bits |= InputBit.Back;
    }

    if (analog !== null) {
      this.steer = analog;
    } else {
      const rate = target === 0 || Math.sign(target) !== Math.sign(this.steer) ? 9 : 5;
      const delta = target - this.steer;
      this.steer += Math.sign(delta) * Math.min(Math.abs(delta), rate * dt);
    }
    out.steer = this.enabled ? this.steer : 0;
    out.bits = this.enabled ? bits : 0;
    return out;
  }
}
