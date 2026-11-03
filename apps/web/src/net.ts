import {
  type ClientMessage, type DecodedSnapshot, type Input, MSG_SNAPSHOT, type ServerMessage,
  decodeSnapshot, encodeInputs,
} from "@dario-kart/sim";

const gameUrl = (): string => {
  const configured = import.meta.env.VITE_GAME_URL as string | undefined;
  return (configured || location.origin).replace(/\/$/, "").replace(/^http/, "ws");
};

export class Net {
  private ws: WebSocket | null = null;
  private readonly inputBuffer = new DataView(new ArrayBuffer(256));
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  rtt = 0;
  onMessage: (msg: ServerMessage) => void = () => {};
  onSnapshot: (snap: DecodedSnapshot) => void = () => {};
  onClose: (reason: string) => void = () => {};

  connect(code: string, hello: Extract<ClientMessage, { t: "hello" }>): void {
    this.close();
    const ws = new WebSocket(`${gameUrl()}/api/race/${code}?code=${code}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      this.send(hello);
      this.pingTimer = setInterval(() => this.send({ t: "ping", at: performance.now() }), 2000);
    };
    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        const msg = JSON.parse(event.data) as ServerMessage;
        if (msg.t === "pong") this.rtt = performance.now() - msg.at;
        this.onMessage(msg);
        return;
      }
      const view = new DataView(event.data as ArrayBuffer);
      if (view.getUint8(0) === MSG_SNAPSHOT) {
        const snap = decodeSnapshot(view);
        if (snap) this.onSnapshot(snap);
      }
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.stopPing();
      this.onClose(event.reason || "Lost connection to the race server.");
    };
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendInputs(inputs: ReadonlyArray<Input>, race: number): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const length = encodeInputs(inputs, this.inputBuffer, race);
    this.ws.send(new Uint8Array(this.inputBuffer.buffer, 0, length).slice());
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  close(): void {
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}
