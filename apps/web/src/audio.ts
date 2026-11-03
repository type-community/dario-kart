/**
 * Everything you hear is synthesized with WebAudio: no audio files. A small
 * synthwave sequencer for music, an engine voice that tracks your kart, and
 * one-shot effects for every event worth feeling.
 */

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// i–VI–III–VII in A minor, the classic driving progression.
const CHORDS = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [48, 52, 55], // C
  [55, 59, 62], // G
];
const THEME_KEY: Record<string, number> = { sf: 0, nyc: -2, fab: 3, shenzhen: 5, beijing: -4 };

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private sfx!: GainNode;
  private noise!: AudioBuffer;
  private engine: { osc: OscillatorNode; sub: OscillatorNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private screech: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private wind: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private sequencer: ReturnType<typeof setInterval> | null = null;
  private nextNote = 0;
  private step = 0;
  private tempo = 122;
  private key = 0;
  private intense = false;
  muted = localStorage.getItem("dk.muted") === "1";

  constructor() {
    const unlock = () => {
      this.ensure();
      void this.ctx?.resume();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
    } catch {
      return null;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.music = ctx.createGain();
    this.music.gain.value = 0.32;
    this.music.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.7;
    this.sfx.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem("dk.muted", this.muted ? "1" : "0");
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /* ---------------- primitives ---------------- */

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; slide?: number; delay?: number; out?: AudioNode } = {}) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? "square";
    osc.frequency.setValueAtTime(freq, t);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.2, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(opts.out ?? this.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private burst(dur: number, freq: number, opts: { gain?: number; q?: number; sweep?: number; delay?: number; type?: BiquadFilterType; out?: AudioNode; at?: number } = {}) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = opts.at ?? ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type ?? "bandpass";
    filter.frequency.setValueAtTime(freq, t);
    if (opts.sweep) filter.frequency.exponentialRampToValueAtTime(opts.sweep, t + dur);
    filter.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain ?? 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(opts.out ?? this.sfx);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  /* ---------------- engine & continuous ---------------- */

  startEngine(): void {
    const ctx = this.ensure();
    if (!ctx || this.engine) return;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    const sub = ctx.createOscillator();
    sub.type = "square";
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 6;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain).connect(this.sfx);
    osc.start();
    sub.start();
    this.engine = { osc, sub, filter, gain };

    const loop = (freq: number, type: BiquadFilterType) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = 3;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.sfx);
      src.start();
      return { gain: g, filter: f };
    };
    this.screech = loop(2600, "bandpass");
    this.wind = loop(800, "highpass");
  }

  stopEngine(): void {
    if (!this.ctx || !this.engine) return;
    const t = this.ctx.currentTime;
    for (const node of [this.engine.gain, this.screech?.gain, this.wind?.gain]) node?.gain.setTargetAtTime(0, t, 0.05);
    const engine = this.engine;
    setTimeout(() => {
      engine.osc.stop();
      engine.sub.stop();
    }, 300);
    this.engine = null;
    this.screech = null;
    this.wind = null;
  }

  updateEngine(speed: number, throttle: boolean, boosting: boolean, drifting: boolean, airborne: boolean, cut: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.engine) return;
    const t = ctx.currentTime;
    const v = Math.max(0, speed);
    // Fake gearbox: pitch climbs, drops at each shift.
    const gear = Math.min(4, Math.floor(v / 18));
    const inGear = (v - gear * 18) / 18;
    const base = 52 + gear * 9 + inGear * 46 + (boosting ? 30 : 0) + (airborne ? 18 : 0);
    this.engine.osc.frequency.setTargetAtTime(base, t, 0.04);
    this.engine.sub.frequency.setTargetAtTime(base / 2, t, 0.04);
    this.engine.filter.frequency.setTargetAtTime(500 + v * 28 + (boosting ? 1500 : 0), t, 0.05);
    this.engine.gain.gain.setTargetAtTime(cut ? 0.01 : (throttle ? 0.13 : 0.07) + (boosting ? 0.05 : 0), t, 0.06);
    this.screech?.gain.gain.setTargetAtTime(drifting && !airborne ? 0.05 : 0, t, 0.05);
    this.wind?.gain.gain.setTargetAtTime(Math.min(0.09, v / 900) + (boosting ? 0.04 : 0), t, 0.1);
  }

  /* ---------------- one-shots ---------------- */

  countdown(n: number): void {
    this.tone(n > 0 ? 440 : 880, n > 0 ? 0.18 : 0.5, { type: "square", gain: 0.25 });
    if (n === 0) this.tone(1320, 0.5, { type: "triangle", gain: 0.15 });
  }

  rocket(result: number): void {
    if (result === 2) {
      this.burst(0.6, 600, { sweep: 6000, gain: 0.5, q: 0.7 });
      this.tone(220, 0.5, { type: "sawtooth", slide: 880, gain: 0.15 });
    } else if (result === 1) {
      this.burst(0.4, 500, { sweep: 3000, gain: 0.35 });
    } else if (result === -1) {
      this.tone(140, 0.35, { type: "sawtooth", slide: 60, gain: 0.2 });
      this.burst(0.5, 300, { gain: 0.3, type: "lowpass" });
    }
  }

  boost(kind: number): void {
    const strength = kind === 6 ? 1.3 : kind === 3 || kind === 9 ? 1 : 0.7;
    this.burst(0.5 * strength, 400, { sweep: 5000, gain: 0.35 * strength, q: 0.8 });
    if (kind === 6) this.tone(660, 0.35, { type: "triangle", slide: 1320, gain: 0.12 });
  }

  driftTier(tier: number): void {
    this.tone(tier >= 3 ? 1568 : tier === 2 ? 1175 : 880, 0.12, { type: "triangle", gain: 0.14 });
  }

  gpu(count: number): void {
    const f = midi(76 + Math.min(10, count));
    this.tone(f, 0.08, { type: "square", gain: 0.1 });
    this.tone(f * 1.5, 0.14, { type: "square", gain: 0.08, delay: 0.06 });
  }

  spill(): void {
    for (let i = 0; i < 3; i++) this.tone(midi(84 - i * 3), 0.07, { type: "square", gain: 0.08, delay: i * 0.05 });
  }

  itemTick(): void {
    this.tone(1200 + Math.random() * 400, 0.03, { type: "square", gain: 0.06 });
  }

  itemLand(): void {
    this.tone(midi(79), 0.1, { type: "square", gain: 0.15 });
    this.tone(midi(84), 0.25, { type: "square", gain: 0.15, delay: 0.08 });
  }

  fire(): void {
    this.burst(0.35, 2000, { sweep: 300, gain: 0.3 });
  }

  hit(): void {
    this.tone(120, 0.3, { type: "sine", slide: 40, gain: 0.5 });
    this.burst(0.35, 1200, { gain: 0.45, sweep: 200, type: "lowpass" });
  }

  trick(): void {
    this.tone(midi(72), 0.08, { type: "triangle", gain: 0.12 });
    this.tone(midi(79), 0.12, { type: "triangle", gain: 0.12, delay: 0.07 });
  }

  bump(): void {
    this.tone(330, 0.15, { type: "square", slide: 660, gain: 0.15 });
  }

  land(): void {
    this.burst(0.2, 200, { gain: 0.3, type: "lowpass" });
  }

  overtake(up: boolean): void {
    this.tone(up ? midi(72) : midi(67), 0.08, { type: "triangle", gain: 0.12 });
    this.tone(up ? midi(79) : midi(60), 0.12, { type: "triangle", gain: 0.12, delay: 0.07 });
  }

  lap(final: boolean): void {
    const notes = final ? [72, 76, 79, 84] : [72, 79];
    notes.forEach((n, i) => this.tone(midi(n), 0.16, { type: "square", gain: 0.14, delay: i * 0.09 }));
  }

  finish(place: number): void {
    const notes = place === 1 ? [72, 76, 79, 84, 88, 91] : place <= 3 ? [72, 76, 79, 84] : [67, 72, 76];
    notes.forEach((n, i) => this.tone(midi(n), 0.22, { type: "square", gain: 0.14, delay: i * 0.11 }));
  }

  emote(): void {
    this.tone(midi(81), 0.06, { type: "triangle", gain: 0.1 });
    this.tone(midi(88), 0.08, { type: "triangle", gain: 0.1, delay: 0.05 });
  }

  wrongWay(): void {
    this.tone(220, 0.2, { type: "square", gain: 0.1 });
  }

  /* ---------------- music ---------------- */

  startMusic(theme: string): void {
    const ctx = this.ensure();
    if (!ctx) return;
    this.key = THEME_KEY[theme] ?? 0;
    this.tempo = 122;
    this.intense = false;
    if (this.sequencer) return;
    this.step = 0;
    this.nextNote = ctx.currentTime + 0.1;
    this.sequencer = setInterval(() => this.schedule(), 25);
  }

  /** Final lap: faster, brighter, with the lead line on top. */
  setIntense(on: boolean): void {
    this.intense = on;
    this.tempo = on ? 140 : 122;
  }

  stopMusic(): void {
    if (this.sequencer) clearInterval(this.sequencer);
    this.sequencer = null;
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const sixteenth = 60 / this.tempo / 4;
    while (this.nextNote < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextNote, sixteenth);
      this.nextNote += sixteenth;
      this.step = (this.step + 1) % 64;
    }
  }

  private voice(freq: number, t: number, dur: number, type: OscillatorType, gain: number, cutoff: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff * 0.3), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filter).connect(g).connect(this.music);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private playStep(step: number, t: number, sixteenth: number): void {
    const bar = Math.floor(step / 16);
    const beat = step % 16;
    const chord = CHORDS[bar % 4].map((n) => n + this.key);
    // Drums: four on the floor, snare on 2 and 4, offbeat hats.
    if (beat % 4 === 0) {
      const ctx = this.ctx!;
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(g).connect(this.music);
      osc.start(t);
      osc.stop(t + 0.2);
    }
    if (beat === 4 || beat === 12) this.burst(0.16, 1800, { gain: 0.35, out: this.music, at: t, q: 0.6 });
    if (beat % 2 === 1 || this.intense) this.burst(0.03, 9000, { gain: this.intense ? 0.12 : 0.09, type: "highpass", out: this.music, at: t });
    // Bass: driving eighths on the root.
    if (beat % 2 === 0) this.voice(midi(chord[0] - 24), t, sixteenth * 1.8, "sawtooth", 0.3, 900);
    // Arp: chord tones climbing in sixteenths.
    const arp = chord[beat % 3] + (beat % 6 >= 3 ? 12 : 0);
    this.voice(midi(arp), t, sixteenth * 0.9, "square", 0.06, 2600);
    // Pad stab at the top of each bar.
    if (beat === 0) for (const n of chord) this.voice(midi(n), t, sixteenth * 14, "sawtooth", 0.035, 1400);
    // Final lap lead: a soaring hook.
    if (this.intense && beat % 4 === 0) {
      const hook = [12, 7, 10, 12][(beat / 4) % 4];
      this.voice(midi(chord[0] + hook), t, sixteenth * 3.5, "sawtooth", 0.07, 4000);
    }
  }
}

export const sound = new Sound();
