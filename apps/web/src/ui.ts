import {
  CHARACTERS, KARTS, type LobbyPlayer, type RaceResult, THEMES, type ThemeId, characterById, kartById,
} from "@dario-kart/sim";
import { avatarSvg, quipFor } from "./avatars.ts";

export interface Profile {
  id: string;
  name: string;
  character: string;
  kart: string;
  primary: number;
  secondary: number;
}

export const SWATCHES = [
  0xd97757, 0xff3d7f, 0xc8102e, 0xff7a1a, 0xffc93c, 0x76b900,
  0x10a37f, 0x3de0ff, 0x4285f4, 0x615ced, 0xb18cff, 0x111111, 0x6b6f78, 0xf4f4f4,
];

export interface LobbyState {
  code: string;
  players: ReadonlyArray<LobbyPlayer>;
  track: ThemeId;
  bots: number;
  racing: boolean;
  /** Which entry in `players` is this tab. */
  you: string;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Given to anyone who arrives without a name, so a lobby link never stops at a form. */
export const placeholderName = () => `Racer ${100 + Math.floor(Math.random() * 900)}`;
export const isPlaceholderName = (name: string) => /^Racer( \d+)?$/.test(name);

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

const meter = (value: number) =>
  `<span class="meter" role="img" aria-label="${value} of 10">${Array.from({ length: 10 }, (_, i) => `<b class="${i < value ? "on" : ""}"></b>`).join("")}</span>`;

export const landingView = (profile: Profile, code: string, error: string) => `
  <section class="landing">
    <h1 class="wordmark">Dario<br />Kart</h1>
    <p class="pitch">Ten AI lab CEOs, seven model-powered karts, one missile and a nitro you earn by driving well. Lobbies hold up to 100 drivers, and the track grows with the field.</p>
    <form data-form="landing" novalidate>
      <div class="field">
        <label for="name">Your name</label>
        <input id="name" name="name" maxlength="16" autocomplete="nickname" value="${esc(profile.name)}" placeholder="Racer" />
      </div>
      <div class="actions">
        <button class="go" type="submit" data-action="create">Start a lobby</button>
      </div>
      <div class="field code">
        <label for="code">Lobby code</label>
        <input id="code" name="code" maxlength="8" autocomplete="off" spellcheck="false" value="${esc(code)}" />
      </div>
      <div class="actions">
        <button class="quiet" type="button" data-action="join">Join lobby</button>
        <button class="quiet" type="button" data-action="practice">Practice against bots</button>
      </div>
      <p class="error" role="alert">${esc(error)}</p>
    </form>
  </section>
`;

export const joiningView = (code: string) => `
  <section class="joining" role="status">
    <p>Joining lobby <strong>${esc(code)}</strong>…</p>
    <button class="quiet" type="button" data-action="leave">Cancel</button>
  </section>
`;

const nameForm = (name: string, saved: boolean) => {
  const unnamed = isPlaceholderName(name);
  return `
  <form class="name-form${unnamed ? " unnamed" : ""}" data-form="name" novalidate>
    <label for="lobby-name">Your name</label>
    <div class="name-row">
      <input id="lobby-name" name="name" maxlength="16" autocomplete="nickname" spellcheck="false" value="${esc(name)}" aria-describedby="name-hint" />
      <button class="go" type="submit">${saved ? "Saved" : "Save"}</button>
    </div>
    <p class="name-hint" id="name-hint">${unnamed ? `Everyone sees you as ${esc(name)}. Type your name so friends know it's you.` : "This is what everyone sees on the grid and the leaderboard."}</p>
  </form>`;
};

const howTo = `
  <section class="how-to" aria-labelledby="how-to-heading">
    <h2 id="how-to-heading">How to race</h2>
    <ul>
      <li><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><p>Drive, steer and brake. Arrow keys work too</p></li>
      <li><span><kbd>Space</kbd></span><p>Hold in a turn to drift, let go to boost. Chain them</p></li>
      <li class="key-move"><span><kbd>Shift</kbd></span><p><strong>Hold to speed up.</strong> Drifts, slipstreams and close passes refill it</p></li>
      <li><span><kbd>E</kbd></span><p>Fire a missile from a box. Hold <kbd>Q</kbd> to fire backward</p></li>
      <li><span><kbd>W</kbd> on 2</span><p>Rocket start off the line</p></li>
      <li><span><kbd>Space</kbd> in air</span><p>Trick, then land it for a boost</p></li>
    </ul>
    <p class="pad">Gamepad: RT drive, RB drift, A boost, LB fire. Green GPUs add top speed; hits knock them loose.</p>
  </section>
`;

const driverPicker = (profile: Profile) => `
  <div class="drivers" role="group" aria-label="Driver">
    ${CHARACTERS.map((c) => `
      <button class="driver" type="button" data-character="${c.id}" aria-pressed="${c.id === profile.character}" title="${c.name}, ${c.org}">
        ${avatarSvg(c.id, 52)}
        <span class="driver-name">${c.name}</span>
      </button>`).join("")}
  </div>
`;

const kartPicker = (profile: Profile) => `
  <div class="karts" role="group" aria-label="Kart">
    <div class="kart-row header"><span></span><span title="Top speed">Speed</span><span title="Turning and acceleration">Handling</span><span title="Traction: keeps your speed through walls and slow zones">Reliability</span><span title="Shrugs off hits and recovers faster">Durability</span></div>
    ${KARTS.map((k) => {
      const selected = k.id === profile.kart;
      return `
      <button class="kart-row" type="button" data-kart="${k.id}" aria-pressed="${selected}" title="${k.chassis.label}: ${esc(k.chassis.blurb)} ${k.perkName}: ${esc(k.perkText)}">
        <span class="kart-name"><i style="background:${hex(k.color)};box-shadow:3px 0 0 ${hex(k.accent)}"></i><span>${k.name}<small>${k.chassis.label}</small></span></span>
        ${meter(k.speed)}${meter(k.handling)}${meter(k.reliability)}${meter(k.durability)}
        ${selected ? `<span class="perk">${esc(k.chassis.blurb)} <strong>${k.perkName}:</strong> ${k.perkText}</span>` : ""}
      </button>`;
    }).join("")}
  </div>
`;

const swatchRow = (label: string, slot: "primary" | "secondary", current: number) => `
  <div class="paint-row" role="group" aria-label="${label} color">
    <span class="paint-label"><i style="background:${hex(current)}"></i>${label}</span>
    <div class="swatches">
      ${(SWATCHES.includes(current) ? SWATCHES : [current, ...SWATCHES]).map((c) => `<button type="button" class="swatch" data-paint="${slot}" data-color="${c}" aria-pressed="${c === current}" aria-label="${hex(c)}" style="--c:${hex(c)}"></button>`).join("")}
      <label class="swatch custom" title="Pick any color"><input type="color" data-paint-input="${slot}" value="${hex(current)}" aria-label="Custom ${label.toLowerCase()} color" /></label>
    </div>
  </div>
`;

const showroom = (profile: Profile) => {
  const c = characterById(profile.character);
  const k = kartById(profile.kart);
  return `
    <div class="kart-preview" data-preview>
      <div class="showroom-caption">
        ${avatarSvg(c.id, 48)}
        <div>
          <strong>${c.name} <span>in ${k.name}</span></strong>
          <small>${c.org}. ${quipFor(c.id)}</small>
        </div>
      </div>
      <span class="drag-hint">Drag to spin</span>
    </div>
    <div class="paint">
      ${swatchRow("Primary", "primary", profile.primary)}
      ${swatchRow("Secondary", "secondary", profile.secondary)}
      <button type="button" class="quiet" data-action="factory-paint">Use ${k.name} factory colors</button>
    </div>`;
};

export const lobbyView = (lobby: LobbyState, profile: Profile, nameSaved = false) => {
  const host = lobby.players.find((p) => p.host);
  const hostIsMe = host !== undefined && host.key === lobby.you;
  const total = lobby.players.length + lobby.bots;
  const trackButtons = THEMES.map((t) => `
    <button class="track-option" type="button" data-track="${t.id}" aria-pressed="${t.id === lobby.track}" ${hostIsMe ? "" : "disabled"} title="${t.tagline}">
      <strong>${t.name}</strong><span>${t.tagline}</span>
    </button>`).join("");
  let cta: string;
  if (lobby.racing) cta = `<p class="cta-note">Race underway. You'll join the next one.</p>`;
  else if (hostIsMe) cta = `<button class="go" type="button" data-action="start">Start race</button>`;
  else cta = `<p class="cta-note">Waiting for ${esc(host?.name ?? "the host")} to start</p>`;
  return `
  <section class="lobby">
    <header class="lobby-head">
      <h1><button type="button" class="home-link" data-action="leave" aria-label="Leave lobby and go home">Dario Kart</button></h1>
      <div class="room-code">
        <span>Lobby</span>
        <strong>${esc(lobby.code)}</strong>
        <button class="quiet" type="button" data-action="copy">Copy invite link</button>
        <button class="quiet" type="button" data-action="leave">Leave</button>
      </div>
      <div class="lobby-cta">${cta}</div>
    </header>
    <div class="lobby-body">
      <section class="lobby-col showroom" aria-label="You">${nameForm(lobby.players.find((p) => p.key === lobby.you)?.name ?? profile.name, nameSaved)}${showroom(profile)}</section>
      <section class="lobby-col picks" aria-label="Driver and kart">
        <h2>Driver</h2>
        ${driverPicker(profile)}
        <h2>Kart</h2>
        ${kartPicker(profile)}
        ${howTo}
      </section>
      <aside class="lobby-col race-setup">
        <h2>Starting grid <small>${total} racers</small></h2>
        <ol class="grid-list">
          ${lobby.players.map((p, i) => {
            const c = characterById(p.character);
            return `<li>
              <span class="pos">${i + 1}</span>
              <span class="dot">${avatarSvg(c.id, 28, false)}</span>
              <span class="who">${esc(p.name)}<small><i style="background:${hex(p.primary)}"></i><i style="background:${hex(p.secondary)}"></i>${c.name} in ${kartById(p.kart).name}</small></span>
              <span class="tag">${p.key === lobby.you ? "You" : p.id === profile.id ? "Your other tab" : p.host ? "Host" : ""}</span>
              ${p.key === lobby.you
                ? `<button class="quiet kick" type="button" data-action="rename">Rename</button>`
                : hostIsMe || p.id === profile.id
                  ? `<button class="quiet kick" type="button" data-action="kick" data-key="${esc(p.key)}" aria-label="Remove ${esc(p.name)} from the lobby">Kick</button>`
                  : "<span></span>"}
            </li>`;
          }).join("")}
          ${lobby.bots > 0 ? `<li class="bots"><span class="pos">+</span><span>${lobby.bots} bots fill out the grid</span></li>` : ""}
        </ol>
        <h2 id="track-heading">Track</h2>
        <div class="tracks" role="group" aria-labelledby="track-heading">${trackButtons}</div>
        <div class="bot-count">
          <label for="bots">Bots</label>
          <output for="bots">${lobby.bots}</output>
          <input id="bots" type="range" min="0" max="60" step="1" value="${lobby.bots}" ${hostIsMe ? "" : "disabled"} />
        </div>
      </aside>
    </div>
  </section>`;
};

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const formatTime = (t: number | null) => {
  if (t === null) return "";
  const racing = Math.max(0, t - 3);
  const m = Math.floor(racing / 60);
  return `${m}:${(racing - m * 60).toFixed(2).padStart(5, "0")}`;
};

export const resultsView = (results: ReadonlyArray<RaceResult>, mySlot: number, practice: boolean) => {
  const mine = results.findIndex((r) => r.slot === mySlot);
  const title = mine >= 0 ? `${ordinal(mine + 1)} place` : "Race over";
  const podium = [1, 0, 2].map((i) => results[i]).filter(Boolean);
  // Always list yourself, even from the back of a 100-kart field.
  const shown = results.slice(0, 20).map((r, i) => ({ r, place: i + 1 }));
  if (mine >= 20) shown.push({ r: results[mine], place: mine + 1 });
  const row = ({ r, place }: { r: RaceResult; place: number }) => {
    const me = r.slot === mySlot;
    return `
            <tr class="${me ? "me" : ""}${place === mine + 1 && mine >= 20 ? " gap" : ""}">
              <td class="place">${place}</td>
              <td class="who">${avatarSvg(r.character, 30, false)}<span>${esc(r.name)}${me ? " <em>You</em>" : ""}</span></td>
              <td>${kartById(r.kart).name}</td>
              <td class="time">${formatTime(r.time)}</td>
            </tr>`;
  };
  return `
  <section class="results">
    <div class="results-panel">
      <h1>${title}</h1>
      <div class="podium" aria-hidden="true">
        ${podium.map((r) => {
          const place = results.indexOf(r) + 1;
          return `<div class="step p${place}${r.slot === mySlot ? " me" : ""}">${avatarSvg(r.character, place === 1 ? 92 : 72)}<strong>${esc(r.slot === mySlot ? "You" : r.name)}</strong><span>${place}</span></div>`;
        }).join("")}
      </div>
      <table>
        <tbody>
          ${shown.map(row).join("")}
        </tbody>
      </table>
      ${practice
        ? `<p class="after"><button class="go" type="button" data-action="practice">Race again</button> <button class="quiet" type="button" data-action="leave">Back to start</button></p>`
        : `<p class="after">Back to the pit lane in a few seconds.</p>`}
    </div>
  </section>`;
};

export const pauseView = (online: boolean) => `
  <section class="pause" role="dialog" aria-modal="true" aria-labelledby="pause-title">
    <div class="pause-panel">
      <h1 id="pause-title">Paused</h1>
      <p>${online ? "The race keeps going without you while this is open." : "Practice is paused."}</p>
      <div class="pause-actions">
        <button class="go" type="button" data-action="resume">Keep racing</button>
        <button class="quiet" type="button" data-action="${online ? "leave-race" : "leave"}">${online ? "Leave race" : "Quit to start"}</button>
      </div>
    </div>
  </section>`;
