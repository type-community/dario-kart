import {
  BoostKind, DRIFT_TIER1, DRIFT_TIER2, DRIFT_TIER3, MAX_GPUS, NITRO_MIN, SlowFlag, ItemKind, type Track,
} from "@dario-kart/sim";

const GLYPHS: Record<number, string> = {
  [ItemKind.Missile]: "🚀",
};

const SLOW_CAUSES = [
  { flag: SlowFlag.Hit, icon: "💥", title: "Hit!", body: "Spun out. You'll recover in a moment" },
  { flag: SlowFlag.SlowZone, icon: "⛔", title: "Slow zone", body: "Stay off the red stripes" },
  { flag: SlowFlag.Wall, icon: "🧱", title: "Hit the wall", body: "Glance off walls instead of hitting them head on" },
] as const;

/** Only boosts you earned get a callout; pads and your own nitro speak for themselves. */
const BOOST_NAMES: Record<number, string> = {
  [BoostKind.Drift]: "Mini boost",
  [BoostKind.SuperDrift]: "Super boost",
  [BoostKind.UltraDrift]: "ULTRA boost",
  [BoostKind.Trick]: "Trick boost",
};
const DRIFT_BOOSTS: ReadonlySet<number> = new Set([BoostKind.Drift, BoostKind.SuperDrift, BoostKind.UltraDrift]);

export interface HudState {
  place: number;
  total: number;
  lap: number;
  laps: number;
  raceSeconds: number;
  speed: number;
  boosting: boolean;
  item: number;
  itemCount: number;
  item2: number;
  item2Count: number;
  twin: boolean;
  countdown: number;
  racing: boolean;
  status: string;
  statusBad: boolean;
  finishedPlace: number;
  spectating: boolean;
  drifting: boolean;
  driftCharge: number;
  boostKind: number;
  slowFlags: number;
  gpus: number;
  /** Slipstream strength, 0..1. */
  draft: number;
  /** Compute meter, 0..1. */
  nitro: number;
  nitroLit: boolean;
  driftChain: number;
  passes: number;
}

export interface MapDot {
  dist: number;
  d: number;
  me: boolean;
}

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return { n: String(n), suffix: s[(v - 20) % 10] || s[v] || s[0] };
};

const formatTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
};

export class Hud {
  private readonly root: HTMLElement;
  private readonly el: Record<string, HTMLElement> = {};
  private readonly map: HTMLCanvasElement;
  private mapTrack: HTMLCanvasElement | null = null;
  private mapTransform = { scale: 1, ox: 0, oy: 0 };
  private track: Track | null = null;
  private last: Record<string, string> = {};
  private lastCountdown = -1;
  private lastBoostKind = 0;
  private lastItem = 0;
  private lastPasses = 0;
  private calloutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-lap"><span data-k="lap"></span><small data-k="time"></small></div>
      <div class="hud-items" data-k="items">
        <div class="item-slot" data-k="slot1"><span class="glyph" data-k="glyph1"></span><span class="count" data-k="count1"></span></div>
        <div class="item-slot second" data-k="slot2" hidden><span class="glyph" data-k="glyph2"></span><span class="count" data-k="count2"></span></div>
        <kbd class="item-key">E</kbd>
      </div>
      <canvas class="hud-map" width="380" height="380"></canvas>
      <div class="hud-feed" data-k="feed" aria-live="polite"></div>
      <div class="hud-status" data-k="status"></div>
      <div class="hud-callout" data-k="callout" hidden></div>
      <div class="hud-drift" data-k="drift" hidden>
        <div class="drift-label" data-k="driftLabel"></div>
        <div class="drift-bar"><i data-k="driftFill"></i><b style="left:${(DRIFT_TIER1 / DRIFT_TIER3) * 100}%"></b><b style="left:${(DRIFT_TIER2 / DRIFT_TIER3) * 100}%"></b></div>
      </div>
      <div class="hud-vignette" data-k="vignette"></div>
      <div class="hud-slow" data-k="slow" hidden><b data-k="slowIcon"></b><div><strong data-k="slowTitle"></strong><span data-k="slowBody"></span></div></div>
      <div class="hud-center" data-k="center"></div>
      <div class="hud-banner" data-k="banner" hidden><strong data-k="bannerTitle"></strong><span data-k="bannerSub"></span></div>
      <div class="hud-placepop" data-k="placepop" hidden></div>
      <div class="hud-wrongway" data-k="wrongway" hidden>Wrong way</div>
      <div class="hud-emotes" data-k="emotes"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd> trash talk <kbd>M</kbd> sound</div>
      <div class="hud-tips" data-k="tips" hidden>
        <p>Press <kbd>W</kbd> as it hits 2 for a rocket start</p>
        <p>Hold <kbd>Space</kbd> in turns to drift, let go to boost</p>
        <p><kbd>Shift</kbd> burns your Compute meter</p>
      </div>
      <div class="hud-pos"><span class="place" data-k="place"></span><span class="of" data-k="of"></span></div>
      <div class="hud-speed">
        <div class="speed-row"><span class="gpus" data-k="gpus" title="GPUs: each adds top speed"></span><span class="num" data-k="speed"></span><span class="unit">km/h</span></div>
        <div class="nitro" data-k="nitro"><div class="bar"><i data-k="nitroFill"></i></div><span>Compute <kbd>Shift</kbd></span></div>
      </div>
      <div class="hud-spectate" data-k="spectate" hidden>Spectating. You'll join the next race.</div>
    `;
    for (const node of root.querySelectorAll<HTMLElement>("[data-k]")) this.el[node.dataset.k!] = node;
    this.map = root.querySelector("canvas")!;
  }

  show(visible: boolean): void {
    this.root.hidden = !visible;
  }

  setTrack(track: Track): void {
    this.track = track;
    this.el.feed.replaceChildren();
    this.lastCountdown = -1;
    this.last = {};
    this.lastBoostKind = 0;
    this.lastItem = 0;
    this.lastPasses = 0;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let k = 0; k < track.count; k++) {
      minX = Math.min(minX, track.px[k]); maxX = Math.max(maxX, track.px[k]);
      minZ = Math.min(minZ, track.pz[k]); maxZ = Math.max(maxZ, track.pz[k]);
    }
    const size = this.map.width;
    const scale = (size - 40) / Math.max(maxX - minX, maxZ - minZ);
    this.mapTransform = {
      scale,
      ox: size / 2 - ((minX + maxX) / 2) * scale,
      oy: size / 2 - ((minZ + maxZ) / 2) * scale,
    };
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let k = 0; k <= track.count; k++) {
      const i = k % track.count;
      const x = track.px[i] * scale + this.mapTransform.ox;
      const y = track.pz[i] * scale + this.mapTransform.oy;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(17,20,42,0.85)";
    ctx.lineWidth = 16;
    ctx.stroke();
    ctx.strokeStyle = "#d7dce6";
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = "#3de0ff";
    for (const loop of track.loops) {
      const k = Math.round(loop.s / track.step) % track.count;
      ctx.beginPath();
      ctx.arc(track.px[k] * scale + this.mapTransform.ox, track.pz[k] * scale + this.mapTransform.oy, 9, 0, Math.PI * 2);
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#3de0ff";
      ctx.stroke();
    }
    const sx = track.px[0] * scale + this.mapTransform.ox;
    const sy = track.pz[0] * scale + this.mapTransform.oy;
    ctx.fillStyle = "#ffc93c";
    ctx.fillRect(sx - 6, sy - 6, 12, 12);
    this.mapTrack = canvas;
  }

  private set(key: string, value: string): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    this.el[key].textContent = value;
  }

  private bannerTimer: ReturnType<typeof setTimeout> | null = null;
  private placeTimer: ReturnType<typeof setTimeout> | null = null;

  /** Big centered moment: final lap, rocket start, lap splits. */
  banner(title: string, sub: string, tone: "boost" | "final"): void {
    const el = this.el.banner;
    this.set("bannerTitle", title);
    this.set("bannerSub", sub);
    el.className = `hud-banner ${tone}`;
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add("pop");
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => (el.hidden = true), 2200);
  }

  placePop(place: number, up: boolean): void {
    const el = this.el.placepop;
    const o = ordinal(place);
    el.textContent = `${up ? "▲" : "▼"} ${o.n}${o.suffix}`;
    el.className = `hud-placepop ${up ? "up" : "down"}`;
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add("pop");
    if (this.placeTimer) clearTimeout(this.placeTimer);
    this.placeTimer = setTimeout(() => (el.hidden = true), 900);
  }

  wrongWay(show: boolean): void {
    this.el.wrongway.hidden = !show;
  }

  calloutText(text: string, tone: "boost" | "super" | "item"): void {
    this.callout(text, tone);
  }

  private callout(text: string, tone: "boost" | "super" | "item"): void {
    const el = this.el.callout;
    el.textContent = text;
    el.className = `hud-callout ${tone}`;
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add("pop");
    if (this.calloutTimer) clearTimeout(this.calloutTimer);
    this.calloutTimer = setTimeout(() => (el.hidden = true), 1100);
  }

  update(s: HudState, dots: ReadonlyArray<MapDot>): void {
    const pos = ordinal(s.finishedPlace > 0 ? s.finishedPlace : s.place);
    this.set("place", pos.n);
    this.set("of", `${pos.suffix} / ${s.total}`);
    this.set("lap", s.finishedPlace > 0 ? "Finished" : `Lap ${s.lap} of ${s.laps}`);
    this.set("time", formatTime(Math.max(0, s.raceSeconds)));
    this.set("speed", String(Math.round(Math.abs(s.speed) * 3.6)));
    this.el.speed.classList.toggle("boosting", s.boosting);

    this.set("glyph1", GLYPHS[s.item] ?? "");
    this.set("count1", s.itemCount > 1 ? `×${s.itemCount}` : "");
    if (s.item !== ItemKind.None && this.lastItem === ItemKind.None && !s.spectating) {
      this.el.slot1.classList.remove("landed");
      void this.el.slot1.offsetWidth;
      this.el.slot1.classList.add("landed");
    }
    this.lastItem = s.item;
    this.el.slot1.classList.toggle("full", s.item !== ItemKind.None);
    this.el.slot2.hidden = !s.twin;
    this.set("glyph2", GLYPHS[s.item2] ?? "");
    this.set("count2", s.item2Count > 1 ? `×${s.item2Count}` : "");
    // Nothing to show until you're holding something.
    this.el.items.hidden = s.spectating || s.item === ItemKind.None;
    this.el.spectate.hidden = !s.spectating;

    // Drift meter: shows exactly when a boost is banked.
    this.el.drift.hidden = !s.drifting || s.spectating;
    if (s.drifting) {
      const fill = Math.min(1, s.driftCharge / DRIFT_TIER3);
      const tier = s.driftCharge >= DRIFT_TIER3 ? 3 : s.driftCharge >= DRIFT_TIER2 ? 2 : s.driftCharge >= DRIFT_TIER1 ? 1 : 0;
      this.el.driftFill.style.width = `${fill * 100}%`;
      this.el.drift.dataset.tier = String(tier);
      const label = tier === 3 ? "ULTRA boost ready. Let go!" : tier === 2 ? "Super boost ready. Hold for ULTRA" : tier === 1 ? "Mini boost ready. Hold for super" : "Drifting";
      // The chain bonus applies when this drift pays out, so show what it will be.
      this.set("driftLabel", s.driftChain > 0 ? `${label} · chain ×${s.driftChain + 1}` : label);
    }
    if (s.boostKind !== this.lastBoostKind) {
      if (s.boostKind !== BoostKind.None && BOOST_NAMES[s.boostKind] && !s.spectating) {
        const chained = DRIFT_BOOSTS.has(s.boostKind) && s.driftChain > 1 ? ` ×${s.driftChain} chain` : "";
        this.callout(BOOST_NAMES[s.boostKind] + chained, s.boostKind === BoostKind.SuperDrift || s.boostKind === BoostKind.UltraDrift || chained ? "super" : "boost");
      }
      this.lastBoostKind = s.boostKind;
    }
    if (s.passes > this.lastPasses && !s.spectating) this.callout("Close pass! +Compute", "item");
    this.lastPasses = s.passes;

    const gpuKey = `${s.gpus}`;
    if (this.last.gpus !== gpuKey) {
      this.last.gpus = gpuKey;
      this.el.gpus.textContent = String(s.gpus);
      this.el.gpus.classList.toggle("max", s.gpus >= MAX_GPUS);
    }
    this.el.gpus.hidden = s.spectating || s.gpus === 0;
    this.el.nitro.hidden = s.spectating;
    // Slipstream shows on the meter it fills instead of with a bar of its own.
    this.el.nitro.classList.toggle("filling", s.draft > 0.05 && !s.nitroLit);
    this.el.nitroFill.style.width = `${Math.max(0, Math.min(1, s.nitro)) * 100}%`;
    const nitroState = s.nitroLit ? "lit" : s.nitro >= 0.99 ? "full" : s.nitro >= NITRO_MIN ? "ready" : "";
    if (this.last.nitroState !== nitroState) {
      this.last.nitroState = nitroState;
      this.el.nitro.dataset.state = nitroState;
    }


    // Every slowdown says exactly what caused it.
    const cause = SLOW_CAUSES.find((c) => s.slowFlags & c.flag);
    this.el.slow.hidden = !cause || s.spectating;
    this.el.vignette.classList.toggle("on", !!cause && !s.spectating);
    this.el.vignette.classList.toggle("nitro", s.nitroLit && !s.spectating);
    this.el.speed.classList.toggle("slowed", !!cause);
    if (cause) {
      this.set("slowIcon", cause.icon);
      this.set("slowTitle", cause.title);
      this.set("slowBody", cause.body);
    }

    const countdown = s.racing ? (s.raceSeconds < 1 ? 0 : -1) : Math.ceil(s.countdown);
    if (countdown !== this.lastCountdown) {
      this.lastCountdown = countdown;
      const text = countdown > 0 ? String(countdown) : countdown === 0 ? "Go" : "";
      const center = this.el.center;
      center.textContent = text;
      center.classList.remove("slam");
      void center.offsetWidth;
      if (text) center.classList.add("slam");
    }
    this.el.tips.hidden = s.spectating || !(countdown > 0 || (s.racing && s.raceSeconds < 4));
    this.el.emotes.hidden = this.el.tips.hidden;

    this.set("status", s.status);
    this.el.status.classList.toggle("bad", s.statusBad);

    const ctx = this.map.getContext("2d")!;
    ctx.clearRect(0, 0, this.map.width, this.map.height);
    if (this.mapTrack && this.track) {
      ctx.drawImage(this.mapTrack, 0, 0);
      const { scale, ox, oy } = this.mapTransform;
      const track = this.track;
      const p = { x: 0, z: 0 };
      const project = (dist: number, d: number) => {
        const L = track.length;
        const i = Math.floor((((dist % L) + L) % L) / track.step) % track.count;
        const rx = track.ty[i] * track.uz[i] - track.tz[i] * track.uy[i];
        const rz = track.tx[i] * track.uy[i] - track.ty[i] * track.ux[i];
        p.x = (track.px[i] + rx * d) * scale + ox;
        p.z = (track.pz[i] + rz * d) * scale + oy;
        return p;
      };
      for (const dot of dots) {
        if (dot.me) continue;
        const q = project(dot.dist, dot.d);
        ctx.fillStyle = "#1b1f3b";
        ctx.beginPath();
        ctx.arc(q.x, q.z, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#8f97b3";
        ctx.beginPath();
        ctx.arc(q.x, q.z, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      const mine = dots.find((d) => d.me);
      if (mine) {
        const q = project(mine.dist, mine.d);
        ctx.fillStyle = "#11142a";
        ctx.beginPath();
        ctx.arc(q.x, q.z, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffc93c";
        ctx.beginPath();
        ctx.arc(q.x, q.z, 7.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  feed(text: string): void {
    const p = document.createElement("p");
    p.textContent = text;
    this.el.feed.prepend(p);
    while (this.el.feed.children.length > 3) this.el.feed.lastElementChild?.remove();
    setTimeout(() => p.remove(), 4000);
  }
}
