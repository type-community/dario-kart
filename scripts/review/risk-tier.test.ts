import { describe, expect, test } from "bun:test";
import { countApprovals, fileTier, prTier, requiredApprovals } from "./risk-tier.ts";

describe("risk tiers", () => {
  test("paths map to tiers", () => {
    expect(fileTier("README.md")).toBe("low");
    expect(fileTier("packages/sim/test/sim.test.ts")).toBe("low");
    expect(fileTier("apps/web/src/hud.ts")).toBe("medium");
    expect(fileTier("packages/sim/src/world.ts")).toBe("medium");
    expect(fileTier("packages/sim/src/protocol.ts")).toBe("high");
    expect(fileTier(".github/workflows/ci.yml")).toBe("high");
    expect(fileTier("apps/server/src/room.ts")).toBe("high");
  });

  test("the riskiest file sets the PR tier", () => {
    expect(prTier(["README.md", "apps/web/src/hud.ts"])).toBe("medium");
    expect(prTier(["README.md", "alchemy.run.ts"])).toBe("high");
    expect(prTier([])).toBe("medium");
  });

  test("untrusted authors never get the zero-approval path", () => {
    expect(requiredApprovals("low", "krashidov")).toBe(0);
    expect(requiredApprovals("low", "drive-by")).toBe(1);
    expect(requiredApprovals("high", "drive-by")).toBe(2);
  });

  test("approvals count once per human, only on the head commit, never from the author or bots", () => {
    const reviews = [
      { user: "a", state: "APPROVED", commit: "old", bot: false },
      { user: "b", state: "APPROVED", commit: "head", bot: false },
      { user: "b", state: "COMMENTED", commit: "head", bot: false },
      { user: "c", state: "APPROVED", commit: "head", bot: false },
      { user: "c", state: "CHANGES_REQUESTED", commit: "head", bot: false },
      { user: "claude[bot]", state: "APPROVED", commit: "head", bot: true },
      { user: "me", state: "APPROVED", commit: "head", bot: false },
    ];
    expect(countApprovals(reviews, "me", "head")).toBe(1);
  });
});
