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
];

export type Perk =
  | "constitutional"
  | "unhinged"
  | "plugins"
  | "open-weights"
  | "storyteller"
  | "tank"
  | "twin-engine";

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
}

/** Every kart spends the same 28-point budget across its four stats. */
export const KARTS: ReadonlyArray<KartModel> = [
  {
    id: "claude", name: "Claude", color: 0xd97757, accent: 0xf5e6d8,
    speed: 6, handling: 8, reliability: 9, durability: 5,
    perk: "constitutional", perkName: "Constitutional",
    perkText: "Context Overload Oil only half affects you.",
  },
  {
    id: "grok", name: "Grok", color: 0x111111, accent: 0xe6e6e6,
    speed: 10, handling: 5, reliability: 4, durability: 9,
    perk: "unhinged", perkName: "Unhinged",
    perkText: "Boosts hit 15% harder.",
  },
  {
    id: "gippity", name: "Gippity", color: 0x10a37f, accent: 0xffffff,
    speed: 7, handling: 7, reliability: 7, durability: 7,
    perk: "plugins", perkName: "Plugins",
    perkText: "Timed items (AGI, Nerf Bullet) last 20% longer.",
  },
  {
    id: "qwen", name: "Qwen", color: 0x615ced, accent: 0xffffff,
    speed: 5, handling: 10, reliability: 7, durability: 6,
    perk: "open-weights", perkName: "Open Weights",
    perkText: "Light and nimble. Recovers from stuns 35% faster.",
  },
  {
    id: "fable", name: "Fable", color: 0xc96442, accent: 0xffd9a8,
    speed: 8, handling: 8, reliability: 6, durability: 6,
    perk: "storyteller", perkName: "Plot Twist",
    perkText: "Drift boosts are 40% longer.",
  },
  {
    id: "astra", name: "Astra", color: 0x34a853, accent: 0xfbbc05,
    speed: 4, handling: 7, reliability: 7, durability: 10,
    perk: "tank", perkName: "Tank",
    perkText: "Missiles do half damage, and you only drop 1 GPU when hit.",
  },
  {
    id: "gemini", name: "Gemini", color: 0x4285f4, accent: 0xa142f4,
    speed: 9, handling: 6, reliability: 6, durability: 7,
    perk: "twin-engine", perkName: "Twin Engine",
    perkText: "Holds two items at once.",
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
}

export const THEMES: ReadonlyArray<TrackTheme> = [
  {
    id: "sf", name: "SF", tagline: "Brutal hills, blind crests, big air",
    hills: 42, boxiness: 2.4, wobble: 0.32, extraCorners: 2, widthScale: 1, loops: 1, bank: 0.5,
    sky: 0xbfd4e6, fog: 0xc9d6e0, ground: 0x6f8f5a, road: 0x3a3d42, wall: 0xc0362c, glow: 0xffb000,
    buildings: [0xf2e3c9, 0xe8b7a0, 0xa7c4d9, 0xf7f3ea, 0xd8c4e8], buildingHeight: [8, 26],
  },
  {
    id: "nyc", name: "NYC", tagline: "Tight 90s and a loop over Broadway",
    hills: 18, boxiness: 6, wobble: 0.2, extraCorners: 5, widthScale: 0.95, loops: 1, bank: 0.4,
    sky: 0x9fb3c8, fog: 0xa9b4bf, ground: 0x55585e, road: 0x2b2c30, wall: 0xf2c200, glow: 0xffd34d,
    buildings: [0x6b6f78, 0x8a7f72, 0x4b4f58, 0xa39b8f, 0x2f3238], buildingHeight: [30, 120],
  },
  {
    id: "fab", name: "The Fab", tagline: "A giant chip fabrication cleanroom",
    hills: 26, boxiness: 3.2, wobble: 0.28, extraCorners: 3, widthScale: 1.1, loops: 2, bank: 0.6,
    sky: 0x0b1020, fog: 0x101a33, ground: 0xd9dde4, road: 0x8d96a6, wall: 0x00e5ff, glow: 0x00e5ff,
    buildings: [0xe9edf2, 0xb8c1cc, 0xffd84d, 0x8a94a3], buildingHeight: [10, 40],
  },
  {
    id: "shenzhen", name: "Shenzhen", tagline: "Neon switchbacks and double loops",
    hills: 34, boxiness: 2.2, wobble: 0.4, extraCorners: 7, widthScale: 0.95, loops: 2, bank: 0.65,
    sky: 0x1a0b2e, fog: 0x2a0f45, ground: 0x221a2e, road: 0x2a2433, wall: 0xff2bd6, glow: 0x00ffd0,
    buildings: [0x3a2a55, 0x2c3e66, 0x5a2a4a, 0x1f4d4d], buildingHeight: [25, 90],
  },
  {
    id: "beijing", name: "Beijing", tagline: "Banked ring-road sweepers at full tilt",
    hills: 20, boxiness: 2, wobble: 0.2, extraCorners: 1, widthScale: 1.15, loops: 1, bank: 0.55,
    sky: 0xe7d3b0, fog: 0xd9c7a5, ground: 0x9b8e6e, road: 0x3b3a38, wall: 0xc8102e, glow: 0xffc72c,
    buildings: [0xc8102e, 0x8c1c13, 0xd9b26f, 0x6d6a63], buildingHeight: [6, 45],
  },
];

export const ItemKind = {
  None: 0,
  Missile: 1,
  TripleMissile: 2,
  Oil: 3,
  Reset: 4,
  NerfBullet: 5,
  Agi: 6,
} as const;
export type ItemKind = (typeof ItemKind)[keyof typeof ItemKind];

export const ITEM_NAMES: Record<number, string> = {
  0: "",
  1: "Outage Missile",
  2: "Outage Missile ×3",
  3: "Context Overload Oil",
  4: "The Reset",
  5: "The Nerf Bullet",
  6: "Internal AGI Achieved",
};

export const kartById = (id: string): KartModel => KARTS.find((k) => k.id === id) ?? KARTS[0];
export const characterById = (id: string): Character =>
  CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
export const themeById = (id: string): TrackTheme => THEMES.find((t) => t.id === id) ?? THEMES[0];
export const kartIndex = (id: string): number => Math.max(0, KARTS.findIndex((k) => k.id === id));
export const characterIndex = (id: string): number =>
  Math.max(0, CHARACTERS.findIndex((c) => c.id === id));
export const themeIndex = (id: string): number => Math.max(0, THEMES.findIndex((t) => t.id === id));
