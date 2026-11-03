// Measure frame cost in Chrome: usage bun scripts/perf-browser.ts <url> [waitMs]
const [url, wait = "9000"] = process.argv.slice(2);
const chrome = Bun.spawn([
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "--headless=new", "--remote-debugging-port=9334", `--user-data-dir=/tmp/dk-perf-${Date.now()}`, "--window-size=1440,820", "about:blank",
], { stderr: "ignore", stdout: "ignore" });
let target: { webSocketDebuggerUrl: string } | undefined;
for (let i = 0; i < 50 && !target; i++) {
  await Bun.sleep(200);
  try {
    const list = (await (await fetch("http://127.0.0.1:9334/json")).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
    target = list.find((t) => t.type === "page");
  } catch {}
}
const ws = new WebSocket(target!.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map<number, (v: any) => void>();
ws.onmessage = (e) => {
  const msg = JSON.parse(String(e.data));
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)!(msg.result);
};
const send = (method: string, params: object = {}) =>
  new Promise<any>((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
await send("Page.enable");
await send("Page.navigate", { url });
await Bun.sleep(Number(wait));
const r = await send("Runtime.evaluate", {
  expression: "JSON.stringify({ ...__dk.stage.stats, dpr: __dk.stage.renderer.getPixelRatio(), geometries: __dk.stage.renderer.info.memory.geometries, textures: __dk.stage.renderer.info.memory.textures })",
});
console.log(r.result.value);
chrome.kill();
process.exit(0);
