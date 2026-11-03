/**
 * Print the race server's JSON events from Workers Logs. `alchemy logs` only
 * shows event names, so this queries the telemetry API with Alchemy's saved
 * Cloudflare login.
 *
 *   bun scripts/logs.ts [minutes=60] [event]
 *   bun scripts/logs.ts 180 leave
 */
import { homedir } from "node:os";

const ACCOUNT = "d695fe99f2f3766ef9c482f5d6b9c4fb";
const SERVICE_PREFIX = "dariokart-game-prod";
const minutes = Number(process.argv[2] ?? 60);
const only = process.argv[3];

const profile = await Bun.file(`${homedir()}/.alchemy/profiles/default/cloudflare.json`).json();
const token: string = process.env.CLOUDFLARE_API_TOKEN ?? profile.values.access;

const query = async (from: number, to: number) => {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/observability/telemetry/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      queryId: "events", view: "events", limit: 2000, timeframe: { from, to },
      parameters: {
        datasets: ["cloudflare-workers"], calculations: [], groupBys: [], havings: [],
        filters: [
          { key: "$metadata.service", operation: "starts_with", type: "string", value: SERVICE_PREFIX },
          { key: "$metadata.type", operation: "eq", type: "string", value: "cf-worker" },
        ],
      },
    }),
  });
  if (res.status === 401) {
    console.error("Cloudflare login expired. Run `bun alchemy logs --stage prod --since 1m` once to refresh it, then retry.");
    process.exit(1);
  }
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const body = (await res.json()) as { result: { events: { events: Array<{ timestamp: number; source: unknown }> } } };
  return body.result.events.events;
};

// The API caps a query at 2000 events, so walk the range in 10-minute windows.
const now = Date.now();
const events: Array<{ timestamp: number; source: unknown }> = [];
for (let from = now - minutes * 60_000; from < now; from += 600_000) {
  events.push(...(await query(from, Math.min(now, from + 600_000))));
}
events.sort((a, b) => a.timestamp - b.timestamp);
for (const e of events) {
  const source = e.source as Record<string, unknown>;
  if (only && source.event !== only) continue;
  const time = new Date(e.timestamp).toISOString().slice(11, 19);
  console.log(time, JSON.stringify(source));
}
