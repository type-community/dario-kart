export interface Character {
  readonly id: string;
  readonly name: string;
  /** Where they run things. */
  readonly org: string;
  /** Helmet / brand color. */
  readonly color: number;
  /** What they wear in the cockpit. */
  readonly outfit: number;
  readonly skin: number;
  readonly hair: number;
}

export const CHARACTERS: ReadonlyArray<Character> = [
  { id: "dario", name: "Dario", org: "Anthropic", color: 0xd97757, outfit: 0x2b2a33, skin: 0xe8b996, hair: 0x2a1d17 },
  { id: "elon", name: "Elon", org: "xAI", color: 0x9aa4b2, outfit: 0x111111, skin: 0xf0c7a6, hair: 0x5a4636 },
  { id: "sam", name: "Sam", org: "OpenAI", color: 0x10a37f, outfit: 0x6b6f76, skin: 0xf2cdb0, hair: 0x6e5a48 },
  { id: "sundar", name: "Sundar", org: "Google", color: 0x4285f4, outfit: 0x2f3a4a, skin: 0xb8865f, hair: 0x2a2522 },
  { id: "mark", name: "Mark", org: "Meta", color: 0x0866ff, outfit: 0x1b1d22, skin: 0xf3cfb3, hair: 0x4a3426 },
  { id: "satya", name: "Satya", org: "Microsoft", color: 0x00a4ef, outfit: 0x3b4a5e, skin: 0xa8784f, hair: 0x2b2420 },
  { id: "lisa", name: "Lisa", org: "AMD", color: 0xed1c24, outfit: 0xb3121a, skin: 0xe9c09c, hair: 0x14100e },
  { id: "mira", name: "Mira", org: "Thinking Machines", color: 0xb18cff, outfit: 0xf2efe9, skin: 0xe4b48f, hair: 0x2a1a14 },
  { id: "jensen", name: "Jensen", org: "NVIDIA", color: 0x76b900, outfit: 0x0e0e0e, skin: 0xe6bf9c, hair: 0xb9b9bd },
  { id: "demis", name: "Demis", org: "Google DeepMind", color: 0x1fb6c9, outfit: 0x24324a, skin: 0xd9a582, hair: 0x2e231d },
  { id: "tim", name: "Tim", org: "Apple", color: 0xa2aaad, outfit: 0x1d1d1f, skin: 0xf0cdb2, hair: 0xc9c9cc },
  { id: "andy", name: "Andy", org: "Amazon", color: 0xff9900, outfit: 0x232f3e, skin: 0xeec3a3, hair: 0x8a7a6e },
  { id: "arthur", name: "Arthur", org: "Mistral AI", color: 0xfa520f, outfit: 0x1f2937, skin: 0xedc4a5, hair: 0x3b2a20 },
  { id: "aravind", name: "Aravind", org: "Perplexity", color: 0x20808d, outfit: 0x13343b, skin: 0xb98560, hair: 0x1d1714 },
  { id: "liang", name: "Liang", org: "DeepSeek", color: 0x4d6bfe, outfit: 0x2a2f3a, skin: 0xe8c19e, hair: 0x16120f },
];

export type Perk =
  | "constitutional"
  | "unhinged"
  | "plugins"
  | "open-weights"
  | "storyteller"
  | "tank"
  | "twin-engine";

/** What kind of vehicle it is: its body on screen and its quirks in the sim. */
export type ChassisKind = "racer" | "dragster" | "kart" | "trike" | "rally" | "monster" | "hover";

export interface Chassis {
  readonly kind: ChassisKind;
  readonly label: string;
  /** One line on how it drives. */
  readonly blurb: string;
  /** Collision radius in meters (walls and other karts). */
  readonly radius: number;
  /** Multiplies mass: who shoves whom when karts touch. */
  readonly weight: number;
  /** Multiplies how fast the tail snaps back in line after a slide. */
  readonly grip: number;
  /** Multiplies how fast a drift charges. */
  readonly driftRate: number;
  /** Multiplies the drift angle. */
  readonly driftAngle: number;
  /** Multiplies ramp and jump launches. */
  readonly hop: number;
  /** Multiplies how far walls bounce you back. */
  readonly bounce: number;
}

export interface KartModel {
  readonly id: string;
  readonly name: string;
  readonly color: number;
  readonly accent: number;
  readonly speed: number;
  readonly handling: number;
  readonly reliability: number;
  readonly durability: number;
  readonly perk: Perk;
  readonly perkName: string;
  readonly perkText: string;
  readonly chassis: Chassis;
}

const chassis = (kind: ChassisKind, label: string, blurb: string, quirks: Partial<Omit<Chassis, "kind" | "label" | "blurb">> = {}): Chassis => ({
  kind, label, blurb, radius: 1, weight: 1, grip: 1, driftRate: 1, driftAngle: 1, hop: 1, bounce: 1, ...quirks,
});

/**
 * Every kart spends the same 28-point budget across its four stats, but each
 * is a different kind of machine: they should feel nothing alike.
 */
export const KARTS: ReadonlyArray<KartModel> = [
  {
    id: "claude", name: "Claude", color: 0xd97757, accent: 0xf5e6d8,
    speed: 8, handling: 8, reliability: 7, durability: 5,
    perk: "constitutional", perkName: "Constitutional",
    perkText: "Slow zones and wall hits barely slow you.",
    chassis: chassis("racer", "Open-wheel racer", "Sticks to the road. Fragile.", { radius: 0.95, weight: 0.85, grip: 1.6 }),
  },
  {
    id: "grok", name: "Grok", color: 0x111111, accent: 0xe6e6e6,
    speed: 10, handling: 2, reliability: 7, durability: 9,
    perk: "unhinged", perkName: "Unhinged",
    perkText: "Boosts hit 3% harder.",
    chassis: chassis("dragster", "Dragster", "Unbeatable on a straight, a barge in the bends.", { radius: 1.15, weight: 1.5, grip: 0.7, driftRate: 0.85, driftAngle: 0.8 }),
  },
  {
    id: "gippity", name: "Gippity", color: 0x10a37f, accent: 0xffffff,
    speed: 7, handling: 7, reliability: 7, durability: 7,
    perk: "plugins", perkName: "Plugins",
    perkText: "A full boost meter burns 25% longer.",
    chassis: chassis("kart", "Go-kart", "The classic. Good at everything."),
  },
  {
    id: "qwen", name: "Qwen", color: 0x615ced, accent: 0xffffff,
    speed: 5, handling: 10, reliability: 7, durability: 6,
    perk: "open-weights", perkName: "Open Weights",
    perkText: "Recovers from stuns 35% faster.",
    chassis: chassis("trike", "Micro trike", "Tiny and twitchy. Off the line before anyone.", { radius: 0.75, weight: 0.8, grip: 1.3, driftRate: 1.35 }),
  },
  {
    id: "fable", name: "Fable", color: 0xc96442, accent: 0xffd9a8,
    speed: 7, handling: 7, reliability: 7, durability: 7,
    perk: "storyteller", perkName: "Plot Twist",
    perkText: "Drift boosts are 50% longer.",
    chassis: chassis("rally", "Rally hatch", "Born sideways. Drifts charge fast and swing wide.", { grip: 0.75, driftRate: 1.3, driftAngle: 1.45 }),
  },
  {
    id: "astra", name: "Astra", color: 0x34a853, accent: 0xfbbc05,
    speed: 4, handling: 5, reliability: 9, durability: 10,
    perk: "tank", perkName: "Tank",
    perkText: "Missiles do half damage and spin you out for a quarter less time. You only drop 1 GPU when hit.",
    chassis: chassis("monster", "Monster truck", "Shoves everyone aside. Huge air off every ramp.", { radius: 1.35, weight: 2.2, hop: 1.4, bounce: 0.6 }),
  },
  {
    id: "gemini", name: "Gemini", color: 0x4285f4, accent: 0xa142f4,
    speed: 9, handling: 6, reliability: 6, durability: 7,
    perk: "twin-engine", perkName: "Twin Engine",
    perkText: "Holds two items at once.",
    chassis: chassis("hover", "Hovercraft", "No wheels, no grip. Glides through slides and bounces off walls.", { grip: 0.45, driftRate: 1.1, driftAngle: 1.2, bounce: 1.8, hop: 1.15 }),
  },
];

export type ThemeId = "sf" | "nyc" | "fab" | "shenzhen" | "beijing";

export interface TrackTheme {
  readonly id: ThemeId;
  readonly name: string;
  readonly tagline: string;
  /** Peak hill height in meters. */
  readonly hills: number;
  /** Superellipse exponent: 2 = round, higher = boxier city blocks. */
  readonly boxiness: number;
  /** How much each control point's radius wanders (0..1). */
  readonly wobble: number;
  readonly extraCorners: number;
  readonly widthScale: number;
  /** Loop-the-loops per lap before scaling with track length. */
  readonly loops: number;
  /** Maximum road bank angle in corners, radians. */
  readonly bank: number;
  readonly sky: number;
  readonly fog: number;
  readonly ground: number;
  readonly road: number;
  readonly wall: number;
  readonly glow: number;
  readonly buildings: ReadonlyArray<number>;
  readonly buildingHeight: readonly [number, number];
  /** How often each kind of track feature shows up (0..1 per chance), so every city drives differently. */
  readonly mix: FeatureMix;
}

export interface FeatureMix {
  /** On straights: boost pads, then jumps. */
  readonly boost: number;
  readonly ramp: number;
  /** In corners: boost lanes high on the outside, then slow zones on the inside. */
  readonly outside: number;
  readonly slow: number;
  /** Anywhere wide enough: pinball bumpers. */
  readonly bumper: number;
}

export const THEMES: ReadonlyArray<TrackTheme> = [
  {
    // Daylight and sea fog. Roller-coaster hills: jumps everywhere.
    id: "sf", name: "SF", tagline: "Brutal hills, blind crests, big air",
    hills: 56, boxiness: 2.4, wobble: 0.32, extraCorners: 2, widthScale: 1, loops: 1, bank: 0.5,
    sky: 0xbcd6ea, fog: 0xdde6ee, ground: 0x6f8f5a, road: 0x3a3d42, wall: 0xc0362c, glow: 0xffb000,
    buildings: [0xf2e3c9, 0xe8b7a0, 0xa7c4d9, 0xf7f3ea, 0xd8c4e8, 0xb9dcc2], buildingHeight: [7, 16],
    mix: { boost: 0.15, ramp: 0.6, outside: 0.3, slow: 0.12, bumper: 0.04 },
  },
  {
    // Dusk in a canyon of towers. Flat, square blocks, hard 90s with boost lanes.
    id: "nyc", name: "NYC", tagline: "Tight 90s and a loop over Broadway",
    hills: 8, boxiness: 8, wobble: 0.12, extraCorners: 6, widthScale: 0.9, loops: 1, bank: 0.25,
    sky: 0x2e3a63, fog: 0x4a4e70, ground: 0x34363d, road: 0x26272b, wall: 0xf2c200, glow: 0xffd34d,
    buildings: [0x6b6f78, 0x8a7f72, 0x4b4f58, 0xa39b8f, 0x2f3238, 0x7a5c4c], buildingHeight: [40, 170],
    mix: { boost: 0.3, ramp: 0.08, outside: 0.55, slow: 0.22, bumper: 0.08 },
  },
  {
    // Indoors under a lit ceiling. Conveyor boost pads and machines to bounce off.
    id: "fab", name: "The Fab", tagline: "A giant chip fabrication cleanroom",
    hills: 14, boxiness: 4.5, wobble: 0.22, extraCorners: 3, widthScale: 1.1, loops: 2, bank: 0.6,
    sky: 0xdfe6ef, fog: 0xe3e8ef, ground: 0xeef1f5, road: 0x7d8696, wall: 0x00b8d4, glow: 0x00e5ff,
    buildings: [0xe9edf2, 0xd4dae2, 0xffd84d, 0xc9d1dc], buildingHeight: [8, 26],
    mix: { boost: 0.5, ramp: 0.12, outside: 0.35, slow: 0.08, bumper: 0.35 },
  },
  {
    // Night and neon. Switchbacks up and down the hills, two loops.
    id: "shenzhen", name: "Shenzhen", tagline: "Neon switchbacks and double loops",
    hills: 36, boxiness: 2.2, wobble: 0.5, extraCorners: 9, widthScale: 0.95, loops: 2, bank: 0.65,
    sky: 0x14082a, fog: 0x2a0f45, ground: 0x1a1424, road: 0x2a2433, wall: 0xff2bd6, glow: 0x00ffd0,
    buildings: [0x3a2a55, 0x2c3e66, 0x5a2a4a, 0x1f4d4d], buildingHeight: [30, 120],
    mix: { boost: 0.35, ramp: 0.2, outside: 0.45, slow: 0.15, bumper: 0.15 },
  },
  {
    // Hazy afternoon on a wide, flat ring road: long sweepers, slipstream battles, few gimmicks.
    id: "beijing", name: "Beijing", tagline: "Banked ring-road sweepers at full tilt",
    hills: 6, boxiness: 2, wobble: 0.06, extraCorners: 0, widthScale: 1.3, loops: 1, bank: 0.7,
    sky: 0xe9d2a8, fog: 0xdcc59c, ground: 0x9b8e6e, road: 0x3b3a38, wall: 0xc8102e, glow: 0xffc72c,
    buildings: [0xc8102e, 0x8c1c13, 0xd9b26f, 0x6d6a63, 0xb7a58a], buildingHeight: [6, 30],
    mix: { boost: 0.12, ramp: 0.06, outside: 0.25, slow: 0.04, bumper: 0.03 },
  },
];

export const ItemKind = {
  None: 0,
  Missile: 1,
  TokenMaxing: 2,
} as const;
export type ItemKind = (typeof ItemKind)[keyof typeof ItemKind];

export const ITEM_NAMES: Record<number, string> = {
  0: "",
  1: "Outage Missile",
  2: "Token Maxing",
};

export const kartById = (id: string): KartModel => KARTS.find((k) => k.id === id) ?? KARTS[0];
export const characterById = (id: string): Character =>
  CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
export const themeById = (id: string): TrackTheme => THEMES.find((t) => t.id === id) ?? THEMES[0];
export const kartIndex = (id: string): number => Math.max(0, KARTS.findIndex((k) => k.id === id));
export const characterIndex = (id: string): number =>
  Math.max(0, CHARACTERS.findIndex((c) => c.id === id));
export const themeIndex = (id: string): number => Math.max(0, THEMES.findIndex((t) => t.id === id));
