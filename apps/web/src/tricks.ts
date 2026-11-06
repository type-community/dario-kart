/** Trick animations: each trick a kart pulls picks one at random. Visual only. */
export const TRICKS = ["barrelRoll", "frontFlip"] as const;
export type Trick = (typeof TRICKS)[number];

/** Seconds a trick animation lasts (matches the sim's trickT). */
export const TRICK_SECONDS = 0.45;

export const randomTrick = (roll = Math.random()): Trick => TRICKS[Math.min(TRICKS.length - 1, Math.floor(roll * TRICKS.length))];

/** Body rotation for a trick with trickT seconds left: one full turn over the trick. */
export const trickPose = (trick: Trick, trickT: number): { x: number; z: number } => {
  const turn = (1 - trickT / TRICK_SECONDS) * Math.PI * 2;
  return trick === "frontFlip" ? { x: turn, z: 0 } : { x: 0, z: turn };
};
