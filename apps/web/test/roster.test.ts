import { describe, expect, test } from "bun:test";
import { CHARACTERS } from "@dario-kart/sim";
import { EMOTES, quipFor } from "../src/avatars.ts";

describe("driver roster", () => {
  test("includes the newer tech CEOs", () => {
    const ids = CHARACTERS.map((c) => c.id);
    for (const id of ["tim", "andy", "arthur", "aravind", "liang"]) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every driver has a portrait quip and four trash-talk lines", () => {
    for (const c of CHARACTERS) {
      expect(quipFor(c.id)).not.toBe("");
      expect(EMOTES[c.id]?.length).toBe(4);
    }
  });
});
