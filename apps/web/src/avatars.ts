import { CHARACTERS, type Character } from "@dario-kart/sim";

/**
 * Hand-built caricature portraits as inline SVG. Each driver gets the one or
 * two details people recognize them by (Jensen's leather jacket and silver
 * hair, Lisa's bob and AMD red, Satya's glasses) rather than a likeness.
 */

type Hair = "curly" | "tousled" | "crew" | "bald" | "side" | "crop" | "bob" | "long" | "swept" | "receding";
type Mouth = "smile" | "grin" | "smirk" | "earnest" | "calm" | "neutral";
type Outfit = "tee" | "crew" | "sweater" | "leather" | "blazer" | "zip";

interface Look {
  hair: Hair;
  mouth: Mouth;
  outfit: Outfit;
  glasses?: "round" | "rect" | "wayfarer";
  stubble?: boolean;
  chain?: boolean;
  brows?: "flat" | "raised" | "arched";
  quip: string;
  id?: string;
}

const LOOKS: Record<string, Look> = {
  dario: { hair: "curly", mouth: "earnest", outfit: "tee", glasses: "round", brows: "raised", quip: "Races responsibly. Still wins." },
  elon: { hair: "crew", mouth: "smirk", outfit: "tee", brows: "flat", quip: "Promises full self-driving by next lap." },
  sam: { hair: "tousled", mouth: "calm", outfit: "crew", brows: "raised", quip: "Says the next lap will feel like magic." },
  sundar: { hair: "side", mouth: "smile", outfit: "sweater", brows: "arched", quip: "Ships three karts with almost the same name." },
  mark: { hair: "crop", mouth: "neutral", outfit: "tee", glasses: "wayfarer", chain: true, brows: "flat", quip: "Moves fast. Breaks guardrails." },
  satya: { hair: "bald", mouth: "smile", outfit: "zip", glasses: "rect", stubble: true, brows: "arched", quip: "Already owns 49% of your kart." },
  lisa: { hair: "bob", mouth: "grin", outfit: "blazer", brows: "arched", quip: "Brought her own chips." },
  mira: { hair: "long", mouth: "calm", outfit: "crew", brows: "arched", quip: "Thinking very carefully about the racing line." },
  jensen: { hair: "swept", mouth: "grin", outfit: "leather", brows: "raised", quip: "The more you boost, the more you save." },
  demis: { hair: "receding", mouth: "calm", outfit: "blazer", brows: "flat", quip: "Solved the track before the race started." },
};

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

const shade = (n: number, amount: number) => {
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (n & 255) + amount));
  return hex((r << 16) | (g << 8) | b);
};

const hairBack = (look: Look, c: string) => {
  switch (look.hair) {
    case "long":
      return `<path d="M27 44 C25 20 75 20 73 44 L76 86 C66 92 34 92 24 86 Z" fill="${c}"/>`;
    case "bob":
      return `<path d="M26 46 C24 18 76 18 74 46 L75 66 C70 70 64 68 62 62 L38 62 C36 68 30 70 25 66 Z" fill="${c}"/>`;
    default:
      return "";
  }
};

const hairFront = (look: Look, c: string, hi: string) => {
  switch (look.hair) {
    case "curly":
      return `<g fill="${c}">${[
        [32, 30, 9], [42, 24, 10], [54, 23, 10], [65, 28, 9], [70, 38, 7], [29, 40, 7], [48, 30, 8], [60, 33, 7],
      ].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join("")}</g>
      <g fill="${hi}" opacity=".5"><circle cx="44" cy="21" r="3"/><circle cx="58" cy="21" r="2.5"/></g>`;
    case "tousled":
      return `<path d="M27 44 C24 12 76 8 73 44 C70 34 64 30 58 33 C52 27 44 31 40 29 C36 33 31 36 27 44 Z" fill="${c}"/>
        <path d="M40 23 C46 19 56 19 62 24" stroke="${hi}" stroke-width="2" fill="none" opacity=".45"/>`;
    case "crew":
      return `<path d="M28 42 C26 10 74 8 72 42 C68 32 60 30 50 31 C40 30 32 32 28 42 Z" fill="${c}"/>`;
    case "bald":
      return `<path d="M27 46 C26 40 28 37 30 36 L31 46 Z M73 46 C74 40 72 37 70 36 L69 46 Z" fill="${c}"/>
        <ellipse cx="44" cy="27" rx="9" ry="4" fill="#fff" opacity=".22"/>`;
    case "side":
      return `<path d="M28 43 C25 10 75 9 72 43 C69 33 63 30 55 31 L49 27 C43 31 33 33 28 43 Z" fill="${c}"/>`;
    case "crop":
      return `<path d="M29 40 C27 12 73 10 71 40 C67 33 60 31 50 32 C40 31 33 33 29 40 Z" fill="${c}"/>
        <g fill="${hi}" opacity=".35">${[36, 42, 48, 54, 60].map((x) => `<circle cx="${x}" cy="22" r="1.8"/>`).join("")}${[39, 45, 51, 57].map((x) => `<circle cx="${x}" cy="27" r="1.6"/>`).join("")}</g>`;
    case "bob":
      return `<path d="M27 44 C26 10 74 10 73 44 C67 37 58 35 50 36 C42 35 33 37 27 44 Z" fill="${c}"/>
        <path d="M34 26 C42 20 58 20 66 26" stroke="${hi}" stroke-width="2.4" fill="none" opacity=".35"/>`;
    case "long":
      return `<path d="M27 44 C27 10 73 10 73 44 C66 34 57 30 50 31 C46 35 36 39 27 44 Z" fill="${c}"/>`;
    case "swept":
      return `<path d="M27 41 C24 8 50 4 62 9 C74 13 78 28 72 42 C68 31 62 27 54 27 C46 26 36 30 27 41 Z" fill="${c}"/>
        <path d="M34 22 C44 12 60 11 70 22" stroke="#fff" stroke-width="2.2" fill="none" opacity=".6"/>`;
    case "receding":
      return `<path d="M28 42 C26 12 74 10 72 42 C69 34 64 31 57 31 L50 35 L43 31 C36 31 31 34 28 42 Z" fill="${c}"/>`;
  }
};

const outfit = (look: Look, base: number, char: Character) => {
  const c = hex(base);
  const dark = shade(base, -28);
  switch (look.outfit) {
    case "leather":
      return `<path d="M14 100 C16 80 30 72 50 72 C70 72 84 80 86 100 Z" fill="#0e0e0e"/>
        <path d="M36 74 L50 92 L64 74 L58 72 L50 82 L42 72 Z" fill="#2a2a2a"/>
        <path d="M22 84 C26 78 32 76 36 75" stroke="#5a5a5a" stroke-width="2" fill="none"/>
        <path d="M78 84 C74 78 68 76 64 75" stroke="#5a5a5a" stroke-width="2" fill="none"/>
        <circle cx="62" cy="88" r="1.6" fill="#9a9a9a"/>`;
    case "blazer":
      return `<path d="M14 100 C16 80 30 72 50 72 C70 72 84 80 86 100 Z" fill="${c}"/>
        <path d="M42 72 L50 88 L58 72 Z" fill="#f4f1ea"/>
        <path d="M38 73 L46 92 L40 100 M62 73 L54 92 L60 100" stroke="${dark}" stroke-width="2.5" fill="none"/>`;
    case "zip":
      return `<path d="M14 100 C16 80 30 72 50 72 C70 72 84 80 86 100 Z" fill="${c}"/>
        <path d="M42 72 L50 80 L58 72" stroke="${dark}" stroke-width="3" fill="none"/>
        <path d="M50 80 L50 100" stroke="#c9ced6" stroke-width="1.5"/>`;
    case "sweater":
      return `<path d="M14 100 C16 80 30 72 50 72 C70 72 84 80 86 100 Z" fill="${c}"/>
        <path d="M38 73 C44 80 56 80 62 73" stroke="${dark}" stroke-width="3" fill="none"/>`;
    case "crew":
      return `<path d="M14 100 C16 80 30 72 50 72 C70 72 84 80 86 100 Z" fill="${c}"/>
        <path d="M40 73 C44 78 56 78 60 73" stroke="${dark}" stroke-width="2" fill="none"/>`;
    case "tee":
      return `<path d="M14 100 C16 80 30 72 50 72 C70 72 84 80 86 100 Z" fill="${c}"/>
        <path d="M41 73 C45 77 55 77 59 73" stroke="${shade(base, 30)}" stroke-width="2" fill="none"/>
        ${char.id === "dario" ? `<g fill="${hex(char.color)}" transform="translate(64 88)">${[0, 60, 120].map((a) => `<rect x="-0.9" y="-4" width="1.8" height="8" rx=".9" transform="rotate(${a})"/>`).join("")}</g>` : ""}`;
  }
};

const mouth = (look: Look) => {
  switch (look.mouth) {
    case "grin":
      return `<path d="M40 60 C44 68 56 68 60 60 Z" fill="#5b1d1d"/><path d="M41 60.5 L59 60.5 L58 62.5 L42 62.5 Z" fill="#fff"/>`;
    case "smile":
      return `<path d="M42 60 C46 65 54 65 58 60" stroke="#6b2a2a" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    case "smirk":
      return `<path d="M42 62 C48 63 54 62 59 58" stroke="#6b2a2a" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    case "earnest":
      return `<path d="M43 61 C47 63 53 63 57 61" stroke="#6b2a2a" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    case "calm":
      return `<path d="M44 61 C48 63.5 52 63.5 56 61" stroke="#6b2a2a" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
    case "neutral":
      return `<path d="M43 61.5 L57 61.5" stroke="#6b2a2a" stroke-width="2.4" stroke-linecap="round"/>`;
  }
};

const brows = (look: Look, c: string) => {
  const y = look.brows === "raised" ? 38 : 40;
  if (look.brows === "arched") {
    return `<path d="M35 41 C38 38 42 38 45 40 M55 40 C58 38 62 38 65 41" stroke="${c}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  }
  if (look.mouth === "smirk") {
    return `<path d="M35 41 L45 40 M55 38 L65 40" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`;
  }
  return `<path d="M35 ${y + 1} L45 ${y} M55 ${y} L65 ${y + 1}" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`;
};

const glasses = (look: Look) => {
  switch (look.glasses) {
    case "round":
      return `<g stroke="#1b1f3b" stroke-width="1.8" fill="rgba(255,255,255,.18)"><circle cx="40" cy="47" r="6.5"/><circle cx="60" cy="47" r="6.5"/><path d="M46.5 47 L53.5 47" fill="none"/></g>`;
    case "rect":
      return `<g stroke="#3a3f4f" stroke-width="1.5" fill="rgba(255,255,255,.15)"><rect x="33" y="42" width="13" height="9" rx="2"/><rect x="54" y="42" width="13" height="9" rx="2"/><path d="M46 46 L54 46" fill="none"/></g>`;
    case "wayfarer":
      return `<g fill="#111"><path d="M32 42 L47 42 L46 51 C42 53 35 53 33 50 Z"/><path d="M53 42 L68 42 L67 50 C65 53 58 53 54 51 Z"/><rect x="46" y="43" width="8" height="2.5"/></g>
        <path d="M35 44 L40 44" stroke="#fff" stroke-width="1" opacity=".5"/>`;
    default:
      return "";
  }
};

const eyes = (look: Look) => {
  if (look.glasses === "wayfarer") return "";
  const wide = look.id === "sam";
  const r = wide ? 2.9 : 2.4;
  return `<g fill="#1b1414"><ellipse cx="40" cy="47" rx="${r}" ry="${r + 0.4}"/><ellipse cx="60" cy="47" rx="${r}" ry="${r + 0.4}"/></g>
    <g fill="#fff"><circle cx="41" cy="46" r=".9"/><circle cx="61" cy="46" r=".9"/></g>`;
};

/** SVG markup for a driver portrait. `size` is in CSS pixels. */
export const avatarSvg = (characterId: string, size = 64, ring = true): string => {
  const char = CHARACTERS.find((c) => c.id === characterId) ?? CHARACTERS[0];
  const look: Look = { ...LOOKS[char.id], id: char.id };
  const skin = hex(char.skin);
  const skinShade = shade(char.skin, -26);
  const hair = hex(char.hair);
  const hairHi = shade(char.hair, 50);
  const clip = `av-${char.id}-${size}`;
  return `<svg class="avatar" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${char.name}">
    <defs><clipPath id="${clip}"><circle cx="50" cy="50" r="48"/></clipPath></defs>
    <g clip-path="url(#${clip})">
      <rect width="100" height="100" fill="${hex(char.color)}"/>
      <circle cx="50" cy="118" r="62" fill="${shade(char.color, -30)}" opacity=".55"/>
      ${hairBack(look, hair)}
      ${outfit(look, char.outfit, char)}
      ${look.chain ? `<path d="M38 74 C42 84 58 84 62 74" stroke="#e6b422" stroke-width="2" fill="none" stroke-dasharray="2 1.2"/>` : ""}
      <rect x="43" y="62" width="14" height="13" rx="4" fill="${skinShade}"/>
      <ellipse cx="27.5" cy="49" rx="3.5" ry="5.5" fill="${skinShade}"/>
      <ellipse cx="72.5" cy="49" rx="3.5" ry="5.5" fill="${skinShade}"/>
      <ellipse cx="50" cy="47" rx="22" ry="25" fill="${skin}"/>
      ${look.stubble ? `<path d="M30 54 C32 70 42 73 50 73 C58 73 68 70 70 54 C64 62 58 66 50 66 C42 66 36 62 30 54 Z" fill="${hair}" opacity=".28"/>` : ""}
      ${hairFront(look, hair, hairHi)}
      ${brows(look, hair)}
      ${eyes(look)}
      ${glasses(look)}
      <path d="M50 49 C49 53 48 55 50 56" stroke="${skinShade}" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      ${mouth(look)}
      <ellipse cx="37" cy="57" rx="4" ry="2.2" fill="#ff7a7a" opacity=".18"/>
      <ellipse cx="63" cy="57" rx="4" ry="2.2" fill="#ff7a7a" opacity=".18"/>
    </g>
    ${ring ? `<circle cx="50" cy="50" r="48" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="2"/>` : ""}
  </svg>`;
};

export const quipFor = (characterId: string): string => LOOKS[characterId]?.quip ?? "";

/** Four trash-talk lines per driver, on keys 1–4. */
export const EMOTES: Record<string, readonly [string, string, string, string]> = {
  dario: ["Safety first. Then speed.", "I wrote an essay about this lap.", "Machines of loving grace!", "That was a constitutional overtake."],
  elon: ["Full self-driving by next lap.", "Concerning.", "This is a rounding error.", "Launching to Mars after this."],
  sam: ["This lap feels like magic.", "Feel the AGI.", "we're so back", "Next lap will be 10x better."],
  sundar: ["Kart 2.5 Pro Ultra Flash!", "AI-first overtake.", "We've been doing this since 2006.", "Gemini, hold my item."],
  mark: ["Move fast. Break guardrails.", "Open-sourcing my racing line.", "Like my glasses?", "Superintelligence lap."],
  satya: ["I own 49% of that boost.", "Copilot, take the wheel!", "Below you, above you, around you.", "Growth mindset!"],
  lisa: ["Brought my own chips.", "Chiplets beat monoliths.", "Performance per watt, baby.", "Should've bought more MI300s."],
  mira: ["Thinking... machines.", "A very considered pass.", "Taste matters.", "Carefully. Very carefully."],
  jensen: ["The more you boost, the more you save!", "This jacket is aerodynamic.", "Accelerated computing!", "Sold out until 2027."],
  demis: ["Solved it.", "AlphaKart saw this coming.", "Checkmate by lap three.", "Nobel-worthy racing line."],
};
