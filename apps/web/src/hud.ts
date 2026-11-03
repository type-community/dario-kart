import {
  BoostKind, DRAFT_SECONDS, DRIFT_TIER1, DRIFT_TIER2, DRIFT_TIER3, HICCUP_CUT_SECONDS, MAX_GPUS, ITEM_NAMES, ITEM_ROLL_SECONDS, ItemKind, KARTS, type Track,
} from "@dario-kart/sim";

const GLYPHS: Record<number, string> = {
  [ItemKind.Missile]: "🚀",
  [ItemKind.TripleMissile]: "🚀",
  [ItemKind.Oil]: "🛢️",
  [ItemKind.Reset]: "⏪",
  [ItemKind.NerfBullet]: "🔫",
  [ItemKind.Agi]: "🧠",
};
const REEL = [GLYPHS[1], GLYPHS[3], GLYPHS[4], GLYPHS[6], GLYPHS[5]];

const ITEM_HINT: Record<number, string> = {
  [ItemKind.Missile]: "E fires ahead, Q fires behind",
  [ItemKind.TripleMissile]: "Three shots. E ahead, Q behind",
  [ItemKind.Oil]: "E drops a slick behind you",
  [ItemKind.Reset]: "E sends a slow-down wall at everyone behind you",
  [ItemKind.NerfBullet]: "E turns you into an unstoppable bullet",
  [ItemKind.Agi]: "E: invincible, faster, knocks out anyone you touch",
};

const BOOST_NAMES: Record<number, string> = {
  [BoostKind.Pad]: "Boost pad",
  [BoostKind.Drift]: "Mini boost",
  [BoostKind.SuperDrift]: "Super boost",
  [BoostKind.Landing]: "Landing boost",
  [BoostKind.UltraDrift]: "ULTRA boost",
  [BoostKind.Draft]: "Slipstream boost",
  [BoostKind.Trick]: "Trick boost",
};

export interface HudState {
  place: number;
  total: number;
  lap: number;
  laps: number;
  raceSeconds: number;
  speed: number;
  maxSpeed: number;
  boosting: boolean;
  hp: number;
  hpMax: number;
  item: number;
  itemCount: number;
  item2: number;
  item2Count: number;
  twin: boolean;
  countdown: number;
  racing: boolean;
  resetActive: boolean;
  resetSafe: boolean;
  status: string;
  statusBad: boolean;
  finishedPlace: number;
  spectating: boolean;
  drifting: boolean;
  driftCharge: number;
  boostKind: number;
  itemRollT: number;
  hiccupT: number;
  kartModel: number;
  gpus: number;
  draftCharge: number;
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
  private tachBars: HTMLElement[] = [];
  private lastBoostKind = 0;
  private wasRolling = false;
  private calloutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-lap"><span data-k="lap"></span><small data-k="time"></small></div>
      <div class="hud-items" data-k="items">
        <div class="item-slot" data-k="slot1"><span class="glyph" data-k="glyph1"></span><span class="count" data-k="count1"></span></div>
        <div class="item-slot second" data-k="slot2" hidden><span class="glyph" data-k="glyph2"></span><span class="count" data-k="count2"></span></div>
        <div class="item-name" data-k="itemName"></div>
      </div>
      <canvas class="hud-map" width="380" height="380"></canvas>
      <div class="hud-feed" data-k="feed" aria-live="polite"></div>
      <div class="hud-status" data-k="status"></div>
      <div class="hud-callout" data-k="callout" hidden></div>
      <div class="hud-drift" data-k="drift" hidden>
        <div class="drift-label" data-k="driftLabel"></div>
        <div class="drift-bar"><i data-k="driftFill"></i><b style="left:${(DRIFT_TIER1 / DRIFT_TIER3) * 100}%"></b><b style="left:${(DRIFT_TIER2 / DRIFT_TIER3) * 100}%"></b></div>
      </div>
      <div class="hud-ratelimit" data-k="ratelimit" hidden>
        <strong data-k="rlTitle"></strong><span data-k="rlBody"></span>
      </div>
      <div class="hud-center" data-k="center"></div>
      <div class="hud-banner" data-k="banner" hidden><strong data-k="bannerTitle"></strong><span data-k="bannerSub"></span></div>
      <div class="hud-placepop" data-k="placepop" hidden></div>
      <div class="hud-wrongway" data-k="wrongway" hidden>Wrong way</div>
      <div class="hud-draft" data-k="draft" hidden><span>Slipstream</span><i data-k="draftFill"></i></div>
      <div class="hud-emotes" data-k="emotes"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd> trash talk <kbd>M</kbd> sound</div>
      <div class="hud-tips" data-k="tips" hidden>
        <p>Press <kbd>W</kbd> right as it says 2 → 1 for a rocket start. Too early floods the engine</p>
        <p>Hold <kbd>Space</kbd> while turning to drift. Sparks go blue, then pink. Let go to boost.</p>
        <p>Tap <kbd>Space</kbd> in the air to trick. Land it for a boost</p>
        <p>Grab green GPUs: each one adds top speed. Hits make you drop them</p>
        <p>Tuck in behind a rival to slipstream</p>
        <p><kbd>Esc</kbd> to leave</p>
      </div>
      <div class="hud-pos"><span class="place" data-k="place"></span><span class="of" data-k="of"></span></div>
      <div class="hud-speed">
        <div class="gpus" data-k="gpus"></div>
        <div><span class="num" data-k="speed"></span> <span class="unit">km/h</span></div>
        <div class="tach" data-k="tach"></div>
        <div class="hp"><i data-k="hp"></i></div>
      </div>
      <div class="hud-reset" data-k="reset" hidden>The Reset is coming. Floor it.</div>
      <div class="hud-spectate" data-k="spectate" hidden>Spectating. You'll join the next race.</div>
    `;
    for (const node of root.querySelectorAll<HTMLElement>("[data-k]")) this.el[node.dataset.k!] = node;
    this.map = root.querySelector("canvas")!;
    for (let i = 0; i < 16; i++) {
      const b = document.createElement("b");
      this.el.tach.append(b);
      this.tachBars.push(b);
    }
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
    this.wasRolling = false;
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
  banner(title: string, sub: string, tone: "boost" | "final" | "bad"): void {
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

  update(s: HudState, dots: ReadonlyArray<MapDot>, resetDist: number | null): void {
    const pos = ordinal(s.finishedPlace > 0 ? s.finishedPlace : s.place);
    this.set("place", pos.n);
    this.set("of", `${pos.suffix} / ${s.total}`);
    this.set("lap", s.finishedPlace > 0 ? "Finished" : `Lap ${s.lap} of ${s.laps}`);
    this.set("time", formatTime(Math.max(0, s.raceSeconds)));
    this.set("speed", String(Math.round(Math.abs(s.speed) * 3.6)));
    const lit = Math.round((Math.abs(s.speed) / (s.maxSpeed * 1.45)) * 16);
    const tachKey = `${lit}${s.boosting}`;
    if (this.last.tach !== tachKey) {
      this.last.tach = tachKey;
      this.tachBars.forEach((b, i) => {
        b.className = i < lit ? (i >= 11 || s.boosting ? "on hot" : "on") : "";
      });
    }
    this.el.hp.style.width = `${Math.max(0, Math.min(1, s.hp / s.hpMax)) * 100}%`;

    // Item roulette: spin through the reel, then land on what you actually got.
    const rolling = s.itemRollT > 0 && s.item !== ItemKind.None;
    if (rolling) {
      const progress = 1 - s.itemRollT / ITEM_ROLL_SECONDS;
      const speed = 22 - progress * 16;
      const frame = Math.floor(performance.now() / (1000 / speed)) % REEL.length;
      this.set("glyph1", REEL[frame]);
      this.el.slot1.classList.add("rolling");
      this.set("count1", "");
      this.set("itemName", "");
    } else {
      this.el.slot1.classList.remove("rolling");
      this.set("glyph1", GLYPHS[s.item] ?? "");
      this.set("count1", s.itemCount > 1 ? `×${s.itemCount}` : "");
      const name = s.item === ItemKind.None ? "" : ITEM_NAMES[s.item];
      if (this.last.itemName !== name) {
        this.last.itemName = name;
        this.el.itemName.innerHTML = name ? `${name}<small>${ITEM_HINT[s.item] ?? ""}</small>` : "";
      }
    }
    if (this.wasRolling && !rolling && s.item !== ItemKind.None) {
      this.el.slot1.classList.remove("landed");
      void this.el.slot1.offsetWidth;
      this.el.slot1.classList.add("landed");
      this.callout(`You got ${ITEM_NAMES[s.item]}`, "item");
    }
    this.wasRolling = rolling;
    this.el.slot1.classList.toggle("full", s.item !== ItemKind.None);
    this.el.slot2.hidden = !s.twin;
    this.set("glyph2", GLYPHS[s.item2] ?? "");
    this.set("count2", s.item2Count > 1 ? `×${s.item2Count}` : "");
    this.el.items.hidden = s.spectating;
    this.el.spectate.hidden = !s.spectating;

    // Drift meter: shows exactly when a boost is banked.
    this.el.drift.hidden = !s.drifting || s.spectating;
    if (s.drifting) {
      const fill = Math.min(1, s.driftCharge / DRIFT_TIER3);
      const tier = s.driftCharge >= DRIFT_TIER3 ? 3 : s.driftCharge >= DRIFT_TIER2 ? 2 : s.driftCharge >= DRIFT_TIER1 ? 1 : 0;
      this.el.driftFill.style.width = `${fill * 100}%`;
      this.el.drift.dataset.tier = String(tier);
      this.set("driftLabel", tier === 3 ? "ULTRA boost ready. Let go!" : tier === 2 ? "Super boost ready. Hold for ULTRA" : tier === 1 ? "Mini boost ready. Hold for super" : "Drifting");
    }
    if (s.boostKind !== this.lastBoostKind) {
      if (s.boostKind !== BoostKind.None && BOOST_NAMES[s.boostKind] && !s.spectating) {
        this.callout(BOOST_NAMES[s.boostKind], s.boostKind === BoostKind.SuperDrift || s.boostKind === BoostKind.UltraDrift ? "super" : "boost");
      }
      this.lastBoostKind = s.boostKind;
    }

    const gpuKey = `${s.gpus}`;
    if (this.last.gpus !== gpuKey) {
      this.last.gpus = gpuKey;
      this.el.gpus.innerHTML = `${Array.from({ length: MAX_GPUS }, (_, i) => `<b class="${i < s.gpus ? "on" : ""}"></b>`).join("")}<span>${s.gpus} GPU${s.gpus === 1 ? "" : "s"}</span>`;
    }
    this.el.gpus.hidden = s.spectating;
    this.el.draft.hidden = s.draftCharge <= 0.05 || s.spectating;
    if (s.draftCharge > 0.05) this.el.draftFill.style.width = `${Math.min(1, s.draftCharge / DRAFT_SECONDS) * 100}%`;
    this.el.emotes.hidden = s.spectating;

    // Rate limits are explained, not just announced.
    const model = KARTS[s.kartModel];
    const cut = s.hiccupT > 0 && s.hiccupT <= HICCUP_CUT_SECONDS;
    const warn = s.hiccupT > HICCUP_CUT_SECONDS;
    this.el.ratelimit.hidden = !(cut || warn) || s.spectating;
    if (cut || warn) {
      this.el.ratelimit.classList.toggle("cut", cut);
      this.set("rlTitle", cut ? "Rate limited. Engine paused" : "Rate limit incoming");
      this.set("rlBody", `${model?.name ?? "Your kart"} has ${model?.reliability ?? "?"}/10 reliability, so it stalls now and then.`);
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

    this.el.reset.hidden = !(s.resetActive && !s.resetSafe);
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
      if (resetDist !== null) {
        const r = project(resetDist, 0);
        ctx.fillStyle = "#ff3d7f";
        ctx.beginPath();
        ctx.arc(r.x, r.z, 12, 0, Math.PI * 2);
        ctx.fill();
      }
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
    while (this.el.feed.children.length > 5) this.el.feed.lastElementChild?.remove();
    setTimeout(() => p.remove(), 6000);
  }
}
