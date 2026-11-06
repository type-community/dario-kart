import {
  type ClientMessage, type DecodedSnapshot, GapStats, type Input, KICKED, MSG_SNAPSHOT, type NetReport, type ServerMessage,
  LOBBY_FULL, decodeSnapshot, encodeInputs,
} from "@dario-kart/sim";

const gameUrl = (): string => {
  const configured = import.meta.env.VITE_GAME_URL as string | undefined;
  return (configured || location.origin).replace(/\/$/, "").replace(/^http/, "ws");
};

/** Waits between reconnect attempts. After the last one we give up and say why. */
const RETRY_MS = [300, 1000, 2000, 4000, 8000];
/** No pong for this long means the socket is dead even if the browser hasn't noticed. */
const PONG_TIMEOUT_MS = 7000;

/**
 * Close codes that mean "don't come back": we left, the lobby is full, a
 * newer connection took our seat (retrying would just take it back), or we
 * were kicked. Not 1013: that's Cloudflare shedding load, and worth a retry.
 */
const FINAL_CODES = new Set([1000, 4000, KICKED, LOBBY_FULL]);

export class Net {
  private ws: WebSocket | null = null;
  private readonly inputBuffer = new DataView(new ArrayBuffer(256));
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private target: { code: string; hello: Extract<ClientMessage, { t: "hello" }> } | null = null;
  private attempt = 0;
  private lastPong = 0;
  rtt = 0;
  // Connection quality for the current race, reported to the server for the logs.
  private readonly snapshotGaps = new GapStats();
  private rtts: number[] = [];
  private reconnects = 0;
  private frames = 0;
  private longFrames = 0;
  private hiddenMs = 0;
  private hiddenAt = -1;
  onMessage: (msg: ServerMessage) => void = () => {};
  onSnapshot: (snap: DecodedSnapshot) => void = () => {};
  /** The connection is gone for good. */
  onClose: (reason: string, code: number) => void = () => {};
  /** A drop we're retrying; `attempt` starts at 1. */
  onReconnecting: (attempt: number) => void = () => {};
  onReconnected: () => void = () => {};

  constructor() {
    // Background tabs throttle timers; don't count that time as a missing pong.
    document.addEventListener("visibilitychange", () => {
      const now = performance.now();
      if (document.hidden) this.hiddenAt = now;
      else {
        this.lastPong = now;
        if (this.hiddenAt >= 0) this.hiddenMs += now - this.hiddenAt;
        this.hiddenAt = -1;
      }
      // Background tabs get throttled; that's not the network's fault.
      this.snapshotGaps.pause();
    });
  }

  connect(code: string, hello: Extract<ClientMessage, { t: "hello" }>): void {
    this.close();
    this.target = { code, hello };
    this.attempt = 0;
    this.open();
  }

  /** Keep the hello current so a reconnect brings back the latest picks. */
  updateHello(hello: Extract<ClientMessage, { t: "hello" }>): void {
    if (this.target) this.target.hello = hello;
  }

  private open(): void {
    const target = this.target;
    if (!target) return;
    const ws = new WebSocket(`${gameUrl()}/api/race/${target.code}?code=${target.code}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.send(target.hello);
      this.lastPong = performance.now();
      if (this.attempt > 0) this.onReconnected();
      this.attempt = 0;
      this.stopPing();
      this.pingTimer = setInterval(() => {
        if (performance.now() - this.lastPong > PONG_TIMEOUT_MS && !document.hidden) {
          // Half-open socket: force it closed so the reconnect path takes over.
          ws.close(4001, "No pong");
          this.dropped(ws, 4001, "No pong from the race server");
          return;
        }
        this.send({ t: "ping", at: performance.now() });
      }, 2000);
    };
    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        const msg = JSON.parse(event.data) as ServerMessage;
        if (msg.t === "pong") {
          this.rtt = performance.now() - msg.at;
          this.lastPong = performance.now();
          if (this.rtts.length < 2000) this.rtts.push(this.rtt);
        }
        this.onMessage(msg);
        return;
      }
      this.lastPong = performance.now();
      const view = new DataView(event.data as ArrayBuffer);
      if (view.getUint8(0) === MSG_SNAPSHOT) {
        if (!document.hidden) this.snapshotGaps.arrive(performance.now());
        const snap = decodeSnapshot(view);
        if (snap) this.onSnapshot(snap);
      }
    };
    ws.onclose = (event) => this.dropped(ws, event.code, event.reason);
  }

  private dropped(ws: WebSocket, code: number, reason: string): void {
    if (this.ws !== ws) return;
    this.ws = null;
    this.stopPing();
    this.snapshotGaps.pause();
    if (!this.target || FINAL_CODES.has(code) || this.attempt >= RETRY_MS.length) {
      this.target = null;
      this.onClose(`${reason || "Lost connection to the race server."} (code ${code})`, code);
      return;
    }
    const delay = RETRY_MS[this.attempt++];
    this.reconnects++;
    this.onReconnecting(this.attempt);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendInputs(inputs: ReadonlyArray<Input>, race: number): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const length = encodeInputs(inputs, this.inputBuffer, race);
    this.ws.send(new Uint8Array(this.inputBuffer.buffer, 0, length).slice());
  }

  /** Start measuring a new race. */
  resetStats(): void {
    this.snapshotGaps.reset();
    this.rtts = [];
    this.reconnects = 0;
    this.frames = 0;
    this.longFrames = 0;
    this.hiddenMs = 0;
    this.hiddenAt = document.hidden ? performance.now() : -1;
  }

  recordFrame(dtMs: number): void {
    this.frames++;
    // Over a second is the tab coming back from the background, not a slow frame.
    if (dtMs > 50 && dtMs < 1000 && !document.hidden) this.longFrames++;
  }

  report(): NetReport {
    const rtts = [...this.rtts].sort((a, b) => a - b);
    const at = (p: number) => Math.round(rtts[Math.min(rtts.length - 1, Math.floor(rtts.length * p))] ?? 0);
    const hiddenMs = Math.round(this.hiddenMs + (this.hiddenAt >= 0 ? performance.now() - this.hiddenAt : 0));
    const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType ?? "";
    return {
      down: this.snapshotGaps.summary(),
      rttP50: at(0.5), rttP95: at(0.95), rttMax: Math.round(rtts.at(-1) ?? 0),
      longFrames: this.longFrames, frames: this.frames, reconnects: this.reconnects, hiddenMs, connection,
    };
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  /** Leave on purpose: no reconnect. */
  close(): void {
    this.stopPing();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.target = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, "Left");
  }
}
