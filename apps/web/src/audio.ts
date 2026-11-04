/**
 * Everything you hear is synthesized with WebAudio: no audio files. A small
 * cyber-techno sequencer carries the race, and its filter opens up with your
 * speed, so going fast sounds bright and a slowdown sounds muffled. Effects
 * are short and soft so they sit under the music instead of over it.
 */

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// A minor with a harmonic-minor turn (E major) for that neon tension.
const CHORDS = [
  [57, 60, 64], // Am
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [52, 56, 59], // E
];
// Rolling offbeat techno bass, in semitones above the chord root (-1 = rest).
const BASS = [-1, 0, 0, 12, -1, 0, 0, 7, -1, 0, 0, 12, -1, 0, 7, 10];
// Arp over the chord tones; the delay line turns it into a shimmer.
const ARP = [0, 2, 1, 2, 0, 2, 1, 3];
const THEME_KEY: Record<string, number> = { sf: 0, nyc: -2, fab: 3, shenzhen: 5, beijing: -4 };

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private delaySend!: GainNode;
  private sfx!: GainNode;
  private noise!: AudioBuffer;
  private sequencer: ReturnType<typeof setInterval> | null = null;
  private nextNote = 0;
  private step = 0;
  private tempo = 128;
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
    this.master.gain.value = this.muted ? 0 : 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = "lowpass";
    this.musicFilter.frequency.value = 2400;
    this.musicFilter.Q.value = 0.8;
    this.music = ctx.createGain();
    this.music.gain.value = 0.3;
    this.music.connect(this.musicFilter).connect(this.master);

    // Tempo-synced feedback delay for the arp.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = (60 / this.tempo) * 0.75;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 2200;
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0.5;
    this.delaySend.connect(delay);
    delay.connect(damp).connect(feedback).connect(delay);
    damp.connect(this.music);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.32;
    this.sfx.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem("dk.muted", this.muted ? "1" : "0");
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /* ---------------- primitives ---------------- */

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; slide?: number; delay?: number } = {}) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? "triangle";
    osc.frequency.setValueAtTime(freq, t);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.15, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private burst(dur: number, freq: number, opts: { gain?: number; q?: number; sweep?: number; type?: BiquadFilterType; out?: AudioNode; at?: number } = {}) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = opts.at ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type ?? "bandpass";
    filter.frequency.setValueAtTime(freq, t);
    if (opts.sweep) filter.frequency.exponentialRampToValueAtTime(opts.sweep, t + dur);
    filter.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain ?? 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(opts.out ?? this.sfx);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  /* ---------------- speed drives the music ---------------- */

  /** Called every frame in a race: the music brightens as you speed up and opens fully on a boost. */
  updateSpeed(speed: number, boosting: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const v = Math.max(0, Math.min(1, speed / 60));
    const cutoff = boosting ? 9000 : 700 + Math.pow(v, 1.6) * 5200;
    this.musicFilter.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.12);
  }

  /* ---------------- one-shots ---------------- */

  countdown(n: number): void {
    this.tone(n > 0 ? midi(69) : midi(81), n > 0 ? 0.16 : 0.45, { type: "sine", gain: n > 0 ? 0.18 : 0.22 });
  }

  rocket(result: number): void {
    if (result === 2) this.burst(0.5, 500, { sweep: 5000, gain: 0.25, q: 0.7 });
    else if (result === 1) this.burst(0.35, 500, { sweep: 2500, gain: 0.18 });
  }

  boost(kind: number): void {
    const strength = kind === 6 ? 1.2 : kind === 3 || kind === 9 ? 1 : 0.7;
    this.burst(0.4 * strength, 600, { sweep: 4000, gain: 0.14 * strength, q: 0.8 });
  }

  driftTier(tier: number): void {
    this.tone(tier >= 3 ? midi(88) : tier === 2 ? midi(84) : midi(79), 0.1, { type: "sine", gain: 0.1 });
  }

  gpu(count: number): void {
    const f = midi(79 + Math.min(10, count));
    this.tone(f, 0.07, { type: "sine", gain: 0.09 });
    this.tone(f * 1.5, 0.1, { type: "sine", gain: 0.07, delay: 0.05 });
  }

  spill(): void {
    for (let i = 0; i < 3; i++) this.tone(midi(80 - i * 3), 0.07, { type: "sine", gain: 0.07, delay: i * 0.05 });
  }

  itemTick(): void {
    this.tone(midi(88 + Math.floor(Math.random() * 5)), 0.025, { type: "sine", gain: 0.05 });
  }

  itemLand(): void {
    this.tone(midi(79), 0.1, { type: "triangle", gain: 0.13 });
    this.tone(midi(84), 0.1, { type: "triangle", gain: 0.13, delay: 0.08 });
    this.tone(midi(91), 0.3, { type: "triangle", gain: 0.12, delay: 0.16 });
  }

  fire(): void {
    this.burst(0.25, 2500, { sweep: 400, gain: 0.14 });
  }

  hit(): void {
    this.tone(110, 0.25, { type: "sine", slide: 45, gain: 0.3 });
    this.burst(0.25, 900, { gain: 0.15, sweep: 200, type: "lowpass" });
  }

  trick(): void {
    this.tone(midi(76), 0.07, { type: "sine", gain: 0.1 });
    this.tone(midi(83), 0.1, { type: "sine", gain: 0.1, delay: 0.06 });
  }

  bump(): void {
    this.tone(400, 0.12, { type: "sine", slide: 800, gain: 0.1 });
  }

  land(): void {
    this.burst(0.12, 220, { gain: 0.12, type: "lowpass" });
  }

  overtake(up: boolean): void {
    this.tone(up ? midi(76) : midi(69), 0.07, { type: "sine", gain: 0.1 });
    this.tone(up ? midi(83) : midi(64), 0.1, { type: "sine", gain: 0.1, delay: 0.06 });
  }

  lap(final: boolean): void {
    const notes = final ? [76, 79, 83, 88] : [76, 83];
    notes.forEach((n, i) => this.tone(midi(n), 0.14, { type: "triangle", gain: 0.12, delay: i * 0.08 }));
  }

  finish(place: number): void {
    const notes = place === 1 ? [76, 79, 83, 88, 91, 95] : place <= 3 ? [76, 79, 83, 88] : [71, 76, 79];
    notes.forEach((n, i) => this.tone(midi(n), 0.2, { type: "triangle", gain: 0.12, delay: i * 0.1 }));
  }

  emote(): void {
    this.tone(midi(84), 0.05, { type: "sine", gain: 0.08 });
    this.tone(midi(91), 0.07, { type: "sine", gain: 0.08, delay: 0.05 });
  }

  /* ---------------- music ---------------- */

  startMusic(theme: string): void {
    const ctx = this.ensure();
    if (!ctx) return;
    this.key = THEME_KEY[theme] ?? 0;
    this.setIntense(false);
    if (this.sequencer) return;
    this.step = 0;
    this.nextNote = ctx.currentTime + 0.1;
    this.sequencer = setInterval(() => this.schedule(), 25);
  }

  /** Final lap: faster, with a lead line on top. */
  setIntense(on: boolean): void {
    this.intense = on;
    this.tempo = on ? 136 : 128;
  }

  stopMusic(): void {
    if (this.sequencer) clearInterval(this.sequencer);
    this.sequencer = null;
    if (this.ctx) this.musicFilter.frequency.setTargetAtTime(2400, this.ctx.currentTime, 0.2);
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

  private voice(freq: number, t: number, dur: number, type: OscillatorType, gain: number, cutoff: number, send = 0) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(150, cutoff * 0.25), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filter).connect(g).connect(this.music);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(this.delaySend);
    }
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private playStep(step: number, t: number, sixteenth: number): void {
    const ctx = this.ctx!;
    const bar = Math.floor(step / 16);
    const beat = step % 16;
    const chord = CHORDS[bar % 4].map((n) => n + this.key);
    // Kick: four on the floor, a short sine thump.
    if (beat % 4 === 0) {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(130, t);
      osc.frequency.exponentialRampToValueAtTime(42, t + 0.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.75, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(g).connect(this.music);
      osc.start(t);
      osc.stop(t + 0.18);
    }
    // Clap on 2 and 4, open hat on the offbeats, ticking closed hats.
    if (beat === 4 || beat === 12) this.burst(0.12, 1400, { gain: 0.16, out: this.music, at: t, q: 0.8 });
    if (beat % 4 === 2) this.burst(0.09, 8000, { gain: 0.08, type: "highpass", out: this.music, at: t });
    else if (beat % 2 === 1) this.burst(0.025, 11000, { gain: 0.035, type: "highpass", out: this.music, at: t });
    // Rolling bass.
    const b = BASS[beat];
    if (b >= 0) this.voice(midi(chord[0] - 24 + b), t, sixteenth * 0.9, "sawtooth", 0.2, 520 + (beat % 4) * 90);
    // Arp through the delay.
    if (beat % 2 === 0) {
      const a = ARP[(beat / 2) % 8];
      const note = a === 3 ? chord[0] + 12 : chord[a] + 12;
      this.voice(midi(note), t, sixteenth * 1.2, "square", 0.035, 2600, 0.8);
    }
    // Low pad under each bar.
    if (beat === 0) for (const n of chord) this.voice(midi(n - 12), t, sixteenth * 15, "sawtooth", 0.018, 900);
    // Final lap: a lead hook rides on top.
    if (this.intense && beat % 4 === 0) {
      const hook = [12, 15, 14, 19][(beat / 4) % 4];
      this.voice(midi(chord[0] + hook), t, sixteenth * 3, "sawtooth", 0.045, 3200, 0.5);
    }
  }
}

export const sound = new Sound();
