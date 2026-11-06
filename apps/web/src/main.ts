import "./style.css";
import {
  CHARACTERS, KARTS, KICKED, LAPS, cleanName, PROTOCOL_VERSION, type RaceResult, type RaceSlot, type ServerMessage, THEMES, TICK_RATE, type ThemeId, kartById, validHat,
} from "@dario-kart/sim";
import { sound } from "./audio.ts";
import { Controls } from "./controls.ts";
import { RaceView, type RaceSetup, Stage } from "./game.ts";
import { Hud } from "./hud.ts";
import { Net } from "./net.ts";
import { KartPreview } from "./preview.ts";
import {
  type LobbyState, type Profile, joiningView, landingView, lobbyView, pauseView, placeholderName, resultsView,
} from "./ui.ts";

type Screen =
  | { kind: "landing"; error: string }
  | { kind: "joining"; code: string }
  | { kind: "lobby" }
  | { kind: "race"; paused: boolean }
  | { kind: "results"; results: ReadonlyArray<RaceResult>; slot: number; practice: boolean };

const ui = document.getElementById("ui")!;
const stage = new Stage(document.getElementById("scene") as HTMLCanvasElement);
const hud = new Hud(document.getElementById("hud")!);
const controls = new Controls();
const net = new Net();
const preview = new KartPreview();

const stored = (key: string, fallback: string) => localStorage.getItem(`dk.${key}`) ?? fallback;
const initialKart = stored("kart", KARTS[Math.floor(Math.random() * KARTS.length)].id);
// The id is per tab (sessionStorage survives reloads), so two tabs are two players
// instead of one player who keeps taking their own seat back.
const tabId = sessionStorage.getItem("dk.id") ?? crypto.randomUUID();
sessionStorage.setItem("dk.id", tabId);
const profile: Profile = {
  id: tabId,
  name: cleanName(stored("name", ""), placeholderName()),
  character: stored("character", CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].id),
  kart: initialKart,
  primary: Number(stored("primary", String(kartById(initialKart).color))),
  secondary: Number(stored("secondary", String(kartById(initialKart).accent))),
  hat: validHat(stored("hat", "none")),
};
const saveProfile = () => {
  for (const [k, v] of Object.entries(profile)) if (k !== "id") localStorage.setItem(`dk.${k}`, String(v));
};
saveProfile();

let screen: Screen = { kind: "landing", error: "" };
let lobby: LobbyState | null = null;
let view: RaceView | null = null;
let practicing = false;
let attractTheme: ThemeId | null = null;
let resultsUntil = 0;

const setView = (next: RaceView | null) => {
  view?.dispose();
  view = next;
};

/** A bots-only race running locally behind the menus. */
const attract = (theme: ThemeId) => {
  if (attractTheme === theme && view) return;
  attractTheme = theme;
  const slots: RaceSlot[] = Array.from({ length: 8 }, (_, i) => {
    const kart = KARTS[i % KARTS.length];
    return { id: `a${i}`, name: CHARACTERS[i].name, character: CHARACTERS[i].id, kart: kart.id, primary: kart.color, secondary: kart.accent, bot: true };
  });
  setView(new RaceView(stage, { seed: (Math.random() * 1e9) | 0, track: theme, laps: 99, slots, you: -1 }, { kind: "attract" }, null, null));
};

const startRace = (setup: RaceSetup, isPractice: boolean) => {
  attractTheme = null;
  practicing = isPractice;
  const autopilot = new URLSearchParams(location.search).has("autopilot");
  const next = new RaceView(stage, setup, isPractice ? { kind: "practice", autopilot } : { kind: "online", net }, controls, hud);
  if (isPractice) {
    next.onFinish = (world) => {
      const results: RaceResult[] = world.order.map((k) => ({
        slot: k.slot, name: setup.slots[k.slot].name, kart: setup.slots[k.slot].kart, character: setup.slots[k.slot].character,
        bot: setup.slots[k.slot].bot, time: k.finished ? k.finishTick / TICK_RATE : null,
      }));
      go({ kind: "results", results, slot: setup.you, practice: true });
    };
  }
  setView(next);
  go({ kind: "race", paused: false });
};

const practice = () => {
  net.close();
  lobby = null;
  if (!new URLSearchParams(location.search).has("practice")) history.pushState({ practice: true }, "", "?practice");
  const requested = new URLSearchParams(location.search).get("track");
  const theme = THEMES.find((t) => t.id === requested)?.id ?? THEMES[Math.floor(Math.random() * THEMES.length)].id;
  const slots: RaceSlot[] = [
    { id: profile.id, name: profile.name, character: profile.character, kart: profile.kart, primary: profile.primary, secondary: profile.secondary, hat: profile.hat, bot: false },
    ...Array.from({ length: 7 }, (_, i) => {
      const c = CHARACTERS[(i + 3) % CHARACTERS.length];
      const kart = KARTS[(i + 1) % KARTS.length];
      return { id: `b${i}`, name: `${c.name} Bot`, character: c.id, kart: kart.id, primary: kart.color, secondary: kart.accent, bot: true };
    }),
  ];
  startRace({ seed: (Math.random() * 1e9) | 0, track: theme, laps: LAPS, slots, you: 0 }, true);
};

const go = (next: Screen) => {
  screen = next;
  hud.show(next.kind === "race" || next.kind === "results");
  if (next.kind !== "lobby") preview.stop();
  if (view) view.paused = next.kind === "race" && next.paused && practicing;
  controls.enabled = next.kind === "race" && !next.paused && (view?.setup.you ?? -1) >= 0;
  switch (next.kind) {
    case "landing": {
      const code = new URLSearchParams(location.search).get("race") ?? "";
      ui.innerHTML = landingView(profile, code.toUpperCase(), next.error);
      if (!view || attractTheme === null) attract(THEMES[Math.floor(Math.random() * THEMES.length)].id);
      break;
    }
    case "joining":
      ui.innerHTML = joiningView(next.code);
      break;
    case "lobby": {
      if (!lobby) return;
      const scroll = ui.scrollTop;
      // Lobby updates redraw everything; don't wipe out a name being typed.
      const typing = document.activeElement?.id === "lobby-name" ? document.activeElement as HTMLInputElement : null;
      ui.innerHTML = lobbyView(lobby, profile, nameSaved !== null);
      ui.scrollTop = scroll;
      const nameInput = ui.querySelector<HTMLInputElement>("#lobby-name");
      if (typing && nameInput) {
        nameInput.value = typing.value;
        nameInput.focus();
        nameInput.setSelectionRange(typing.selectionStart, typing.selectionEnd);
      }
      const slot = ui.querySelector<HTMLElement>("[data-preview]");
      if (slot) {
        preview.setLook(profile);
        preview.mount(slot);
      }
      attract(lobby.track);
      break;
    }
    case "race":
      ui.innerHTML = next.paused ? pauseView(!practicing) : "";
      ui.querySelector<HTMLButtonElement>("[data-action=resume]")?.focus();
      break;
    case "results":
      ui.innerHTML = resultsView(next.results, next.slot, next.practice);
      break;
  }
};

/** Leave whatever lobby/race you're in and land on the start screen. */
const goHome = (error = "", updateUrl = true) => {
  sendNetStats(true);
  net.send({ t: "leave" });
  net.close();
  lobby = null;
  practicing = false;
  if (updateUrl && location.search) history.pushState(null, "", location.pathname);
  setView(null);
  attractTheme = null;
  go({ kind: "landing", error });
};

const newCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => alphabet[b % alphabet.length]).join("");
};

const hello = () => ({
  t: "hello" as const, v: PROTOCOL_VERSION, id: profile.id, name: profile.name, character: profile.character, kart: profile.kart,
  primary: profile.primary, secondary: profile.secondary, hat: profile.hat,
});

const join = (code: string, pushHistory = true) => {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(clean)) {
    go({ kind: "landing", error: "Lobby codes are 4 to 8 letters or numbers." });
    return;
  }
  if (pushHistory && new URLSearchParams(location.search).get("race") !== clean) history.pushState({ race: clean }, "", `?race=${clean}`);
  go({ kind: "joining", code: clean });
  net.connect(clean, hello());
};

net.onClose = (reason, code) => {
  hideReconnecting();
  let message = `${reason} Check your connection and try again.`;
  if (code === 4000) message = "You joined this race from another tab or device.";
  else if (code === KICKED) message = reason.replace(/ \(code \d+\)$/, "");
  goHome(message, false);
};

let reconnectBanner: HTMLElement | null = null;
const hideReconnecting = () => {
  reconnectBanner?.remove();
  reconnectBanner = null;
};
net.onReconnecting = (attempt) => {
  if (!reconnectBanner) {
    reconnectBanner = document.createElement("div");
    reconnectBanner.className = "notice reconnecting";
    reconnectBanner.setAttribute("role", "status");
    document.body.append(reconnectBanner);
  }
  reconnectBanner.textContent = attempt === 1 ? "Connection dropped. Reconnecting…" : `Still reconnecting (try ${attempt})…`;
};
net.onReconnected = () => {
  hideReconnecting();
  notice("Reconnected.");
};

// Browser errors go to the race server's logs so we can see what players hit.
let errorsSent = 0;
const reportError = (message: string, stack?: string) => {
  if (errorsSent++ >= 10) return;
  net.send({ t: "clientError", message, stack, context: screen.kind });
};
window.addEventListener("error", (e) => reportError(e.message, e.error?.stack));
window.addEventListener("unhandledrejection", (e) => reportError(String(e.reason?.message ?? e.reason), e.reason?.stack));

const sendPick = () => {
  saveProfile();
  net.updateHello(hello());
  net.send({ t: "pick", name: profile.name, character: profile.character, kart: profile.kart, primary: profile.primary, secondary: profile.secondary, hat: profile.hat });
  if (screen.kind === "lobby") go({ kind: "lobby" });
};

// Connection quality per race: a running report every 10 s (so a player who drops
// still leaves numbers behind) and a final one when the results arrive.
let statsSeed = -1;
let statsTimer: ReturnType<typeof setInterval> | null = null;
const sendNetStats = (final: boolean) => {
  if (statsSeed >= 0) net.send({ t: "netStats", seed: statsSeed, final, report: net.report() });
  if (final) {
    statsSeed = -1;
    if (statsTimer) clearInterval(statsTimer);
    statsTimer = null;
  }
};

net.onMessage = (msg: ServerMessage) => {
  switch (msg.t) {
    case "lobby":
      if (msg.v !== PROTOCOL_VERSION) {
        // Lobbies keep running the code they started on for a while after a deploy.
        goHome("This lobby is still on the previous version of Dario Kart. Start a new lobby, or try again in a few minutes.", false);
        break;
      }
      lobby = { code: msg.code, players: msg.players, track: msg.track, bots: msg.bots, racing: msg.racing, you: msg.you };
      if (screen.kind === "landing" || screen.kind === "joining" || screen.kind === "lobby") go({ kind: "lobby" });
      else if (screen.kind === "race" && !practicing && !msg.racing) {
        // The server has no race (it was reset). Don't strand the player on a frozen race.
        go({ kind: "lobby" });
        notice("The race server restarted, so that race was lost. Start another one.");
      }
      else if (screen.kind === "results" && performance.now() > resultsUntil && !msg.racing) go({ kind: "lobby" });
      break;
    case "race":
      if (msg.seed !== statsSeed) {
        // A rejoin mid-race resends "race"; keep measuring the same race.
        net.resetStats();
        statsSeed = msg.seed;
        if (statsTimer) clearInterval(statsTimer);
        statsTimer = setInterval(() => sendNetStats(false), 10_000);
      }
      startRace({ seed: msg.seed, track: msg.track, laps: msg.laps, slots: msg.slots, you: msg.you, batch: msg.batch }, false);
      break;
    case "results": {
      sendNetStats(true);
      resultsUntil = performance.now() + 8500;
      const slot = view?.setup.you ?? -1;
      go({ kind: "results", results: msg.results, slot, practice: false });
      setTimeout(() => {
        // Always leave results eventually; a stale "racing" flag must not keep us here.
        if (screen.kind === "results" && lobby) go({ kind: "lobby" });
      }, 9200);
      break;
    }
    case "event":
      hud.feed(msg.text);
      break;
    case "emote":
      view?.showEmote(msg.slot, msg.n);
      break;
    case "error":
      goHome(msg.message, false);
      break;
    case "pong":
      break;
  }
};

/** A short-lived message across the top of the lobby. */
const notice = (text: string) => {
  const el = document.createElement("div");
  el.className = "notice";
  el.setAttribute("role", "status");
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 6000);
};

const readName = () => {
  const input = ui.querySelector<HTMLInputElement>("#name");
  if (input) {
    profile.name = cleanName(input.value, profile.name);
    saveProfile();
  }
};

/**
 * Rename from the lobby. An empty box keeps the old name. Runs on Enter and on
 * blur (Chrome fires "change" before the form's submit, and the redraw drops
 * that submit, so both paths end up here).
 */
let nameSaved: ReturnType<typeof setTimeout> | null = null;
const commitLobbyName = () => {
  const input = ui.querySelector<HTMLInputElement>("#lobby-name");
  if (!input) return;
  const name = cleanName(input.value, profile.name);
  input.value = name;
  if (name === profile.name && lobby?.players.find((p) => p.key === lobby?.you)?.name === name) return;
  profile.name = name;
  if (nameSaved) clearTimeout(nameSaved);
  nameSaved = setTimeout(() => {
    nameSaved = null;
    if (screen.kind === "lobby") go({ kind: "lobby" });
  }, 1800);
  sendPick();
  ui.querySelector<HTMLInputElement>("#lobby-name")?.blur();
};

ui.addEventListener("submit", (e) => {
  e.preventDefault();
  if ((e.target as HTMLElement).dataset.form === "name") {
    commitLobbyName();
    return;
  }
  readName();
  join(newCode());
});

ui.addEventListener("click", (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>("button");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "join") {
    readName();
    join(ui.querySelector<HTMLInputElement>("#code")?.value ?? "");
  } else if (action === "practice") {
    readName();
    practice();
  } else if (action === "start") {
    net.send({ t: "start" });
  } else if (action === "rename") {
    const input = ui.querySelector<HTMLInputElement>("#lobby-name");
    input?.focus();
    input?.select();
  } else if (action === "kick" && target.dataset.key) {
    net.send({ t: "kick", key: target.dataset.key });
  } else if (action === "copy" && lobby) {
    const link = `${location.origin}${location.pathname}?race=${lobby.code}`;
    navigator.clipboard?.writeText(link).then(() => {
      target.textContent = "Link copied";
      setTimeout(() => (target.textContent = "Copy invite link"), 1500);
    });
  } else if (action === "leave" || action === "leave-race") {
    goHome();
  } else if (action === "resume") {
    go({ kind: "race", paused: false });
  } else if (action === "factory-paint") {
    const model = kartById(profile.kart);
    profile.primary = model.color;
    profile.secondary = model.accent;
    sendPick();
  } else if (target.dataset.paint) {
    profile[target.dataset.paint as "primary" | "secondary"] = Number(target.dataset.color);
    sendPick();
  } else if (target.dataset.hat) {
    profile.hat = validHat(target.dataset.hat);
    sendPick();
  } else if (target.dataset.character) {
    profile.character = target.dataset.character;
    sendPick();
  } else if (target.dataset.kart) {
    const before = kartById(profile.kart);
    const usingFactory = profile.primary === before.color && profile.secondary === before.accent;
    profile.kart = target.dataset.kart;
    if (usingFactory) {
      profile.primary = kartById(profile.kart).color;
      profile.secondary = kartById(profile.kart).accent;
    }
    sendPick();
  } else if (target.dataset.track && lobby) {
    net.send({ t: "settings", track: target.dataset.track as ThemeId, bots: lobby.bots });
  }
});

ui.addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id === "bots" && lobby) {
    const output = ui.querySelector("output");
    if (output) output.textContent = input.value;
  } else if (input.dataset.paintInput) {
    // Live preview while dragging in the color picker; commit on change.
    preview.setLook({ ...profile, [input.dataset.paintInput]: Number.parseInt(input.value.slice(1), 16) });
  }
});

ui.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id === "bots" && lobby) net.send({ t: "settings", track: lobby.track, bots: Number(input.value) });
  else if (input.id === "lobby-name") commitLobbyName();
  else if (input.dataset.paintInput) {
    profile[input.dataset.paintInput as "primary" | "secondary"] = Number.parseInt(input.value.slice(1), 16);
    sendPick();
  }
});

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === "KeyM") {
    sound.toggleMute();
    return;
  }
  if (screen.kind === "race" && !screen.paused && /^Digit[1-4]$/.test(e.code) && view && view.setup.you >= 0) {
    const n = Number(e.code.slice(5)) - 1;
    if (practicing) view.showEmote(view.setup.you, n);
    else net.send({ t: "emote", n });
    return;
  }
  if (e.key !== "Escape") return;
  if (screen.kind === "race") go({ kind: "race", paused: !screen.paused });
});

window.addEventListener("popstate", () => {
  const params = new URLSearchParams(location.search);
  const code = params.get("race");
  if (code && lobby?.code !== code.toUpperCase()) join(code, false);
  else if (!code && !params.has("practice") && screen.kind !== "landing") goHome("", false);
});

let last = performance.now();
let menuSkip = 0;
let menuDt = 0;
const loop = (now: number) => {
  const dt = (now - last) / 1000;
  last = now;
  requestAnimationFrame(loop);
  // Behind the menus the race is just a backdrop: 30 fps at low resolution is plenty.
  const menu = screen.kind === "landing" || screen.kind === "joining" || screen.kind === "lobby";
  stage.setMenuMode(menu);
  if (menu) {
    menuDt += dt;
    if (menuSkip++ % 2 === 1) return;
  }
  const step = menu ? menuDt : dt;
  menuDt = 0;
  const start = performance.now();
  if (view) view.frame(step);
  else stage.render();
  stage.recordFrame(performance.now() - start, dt);
  if (screen.kind === "race" && !practicing) net.recordFrame(dt * 1000);
};
(window as unknown as { __dk: unknown }).__dk = { stage, net, get view() { return view; } };
requestAnimationFrame(loop);

const params = new URLSearchParams(location.search);
const nameParam = params.get("name");
if (nameParam) profile.name = cleanName(nameParam, profile.name);
saveProfile();
go({ kind: "landing", error: "" });
const initial = params.get("race");
// An invite link goes straight to the lobby; the name can be changed there.
if (params.has("practice")) practice();
else if (initial) join(initial, false);
