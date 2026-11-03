// Screenshot the running client after it has been live for a while (real-time rAF),
// collecting console errors. Usage: bun scripts/shot.ts <url> <out.png> [waitMs]
const [url, out, wait = "12000", script = "", lobbyShot = ""] = process.argv.slice(2);
const chrome = Bun.spawn([
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "--headless=new", "--remote-debugging-port=9333", "--user-data-dir=/tmp/dk-cdp", `--window-size=${process.env.WIN ?? "1400,900"}`, ...(process.env.CHROME_ARGS ? [process.env.CHROME_ARGS] : []), "about:blank",
], { stderr: "ignore", stdout: "ignore" });
let target: { webSocketDebuggerUrl: string } | undefined;
for (let i = 0; i < 50 && !target; i++) {
  await Bun.sleep(200);
  try {
    const list = (await (await fetch("http://127.0.0.1:9333/json")).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
    target = list.find((t) => t.type === "page");
  } catch {}
}
if (!target) throw new Error("chrome did not start");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map<number, (v: any) => void>();
const errors: string[] = [];
ws.onmessage = (e) => {
  const msg = JSON.parse(String(e.data));
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)!(msg.result);
  if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push(msg.params.args.map((a: any) => a.value ?? a.description).join(" "));
};
const send = (method: string, params: object = {}) =>
  new Promise<any>((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
await send("Runtime.enable");
if (process.env.DPR) await send("Emulation.setDeviceMetricsOverride", { width: Number((process.env.WIN ?? "1400,900").split(",")[0]), height: Number((process.env.WIN ?? "1400,900").split(",")[1]), deviceScaleFactor: Number(process.env.DPR), mobile: false });
await send("Page.enable");
await send("Page.navigate", { url });
if (script) {
  await Bun.sleep(4000);
  if (lobbyShot) {
    const early = await send("Page.captureScreenshot", { format: "png" });
    await Bun.write(lobbyShot, Buffer.from(early.data, "base64"));
  }
  await send("Runtime.evaluate", { expression: script });
}
await Bun.sleep(Number(wait));
const shot = await send("Page.captureScreenshot", { format: "png" });
await Bun.write(out, Buffer.from(shot.data, "base64"));
const fps = await send("Runtime.evaluate", {
  expression: "new Promise(r=>{let n=0;const t=performance.now();const f=()=>{n++;if(performance.now()-t<2000)requestAnimationFrame(f);else r(n/2)};requestAnimationFrame(f)})",
  awaitPromise: true,
});
console.log(`fps≈${fps.result?.value}`);
console.log(errors.length ? `errors:\n${errors.join("\n")}` : "no errors");
chrome.kill();
process.exit(0);
