/** Summary of the time between arrivals of a regular message stream. */
export interface GapSummary {
  readonly n: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  /** Gaps over 150 ms: a visible hitch. */
  readonly over150: number;
  /** Gaps over 300 ms: a freeze, then a jump. */
  readonly over300: number;
}

/** What the client measured about its connection over one race. */
export interface NetReport {
  /** Gaps between snapshots arriving (the server sends one every 50 ms). */
  readonly down: GapSummary;
  readonly rttP50: number;
  readonly rttP95: number;
  readonly rttMax: number;
  /** Frames that took over 50 ms; a stalled main thread looks like a network gap. */
  readonly longFrames: number;
  readonly frames: number;
  readonly reconnects: number;
  /** Time the tab spent in the background; the browser throttles it, so ignore its gaps. */
  readonly hiddenMs: number;
  /** `navigator.connection.effectiveType` where the browser has it. */
  readonly connection: string;
}

const MAX_SAMPLES = 20_000;

const percentile = (sorted: ReadonlyArray<number>, p: number): number =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

/** Records arrival gaps in ms. `pause()` skips the next gap (hidden tab, reconnect). */
export class GapStats {
  private readonly gaps: number[] = [];
  private last = -1;

  arrive(now: number): void {
    if (this.last >= 0 && this.gaps.length < MAX_SAMPLES) this.gaps.push(now - this.last);
    this.last = now;
  }

  pause(): void {
    this.last = -1;
  }

  reset(): void {
    this.gaps.length = 0;
    this.last = -1;
  }

  get count(): number {
    return this.gaps.length;
  }

  summary(): GapSummary {
    const sorted = [...this.gaps].sort((a, b) => a - b);
    const round = (x: number) => Math.round(x);
    return {
      n: sorted.length,
      p50: round(percentile(sorted, 0.5)),
      p95: round(percentile(sorted, 0.95)),
      p99: round(percentile(sorted, 0.99)),
      max: round(sorted.at(-1) ?? 0),
      over150: sorted.filter((g) => g > 150).length,
      over300: sorted.filter((g) => g > 300).length,
    };
  }
}

/** Clamp an untrusted report from a client to sane numbers before logging it. */
export const cleanNetReport = (raw: unknown): NetReport | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, max = 600_000) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
  const d = (r.down ?? {}) as Record<string, unknown>;
  return {
    down: {
      n: num(d.n), p50: num(d.p50), p95: num(d.p95), p99: num(d.p99), max: num(d.max),
      over150: num(d.over150), over300: num(d.over300),
    },
    rttP50: num(r.rttP50), rttP95: num(r.rttP95), rttMax: num(r.rttMax),
    longFrames: num(r.longFrames), frames: num(r.frames), reconnects: num(r.reconnects, 100),
    hiddenMs: num(r.hiddenMs, 3_600_000),
    connection: typeof r.connection === "string" ? r.connection.slice(0, 16) : "",
  };
};
