/**
 * Risk tiers for pull requests, set from the change rather than the author.
 *
 *   low     docs, copy, tests, scripts             0 human approvals once AI + security review are clean
 *   medium  ordinary gameplay, client, sim          1 approval
 *   high    deploy, CI, server rooms, wire format   2 approvals (capped at the number of eligible reviewers)
 *
 * Authors outside TRUSTED_AUTHORS never get the low path: they need at least one approval.
 * Approvals only count if they are on the PR's current head commit and come from a human who isn't the author.
 */

export type Tier = "low" | "medium" | "high";

/** Owners of the repo. Only these authors get the zero-approval path. */
export const TRUSTED_AUTHORS = ["krashidov"];

const HIGH: RegExp[] = [
  /^\.github\//,
  /^alchemy\.run\.ts$/,
  /^apps\/server\/src\//,
  /^packages\/sim\/src\/protocol\.ts$/,
  /^specs\/.*\.tla$/,
  /^package\.json$/,
  /^bun\.lock$/,
  /^scripts\/review\//,
];

const LOW: RegExp[] = [
  /\.md$/,
  /^specs\/.*\.cfg$/,
  /^scripts\//,
  /\/test\//,
  /\.test\.ts$/,
];

export function fileTier(path: string): Tier {
  if (HIGH.some((r) => r.test(path))) return "high";
  if (LOW.some((r) => r.test(path))) return "low";
  return "medium";
}

const RANK: Record<Tier, number> = { low: 0, medium: 1, high: 2 };

export function prTier(files: string[]): Tier {
  let tier: Tier = "low";
  for (const f of files) if (RANK[fileTier(f)] > RANK[tier]) tier = fileTier(f);
  // An empty diff is suspicious, not safe.
  return files.length === 0 ? "medium" : tier;
}

export function requiredApprovals(tier: Tier, author: string): number {
  const base = RANK[tier];
  return TRUSTED_AUTHORS.includes(author) ? base : Math.max(1, base);
}

export type Review = { user: string; state: string; commit: string; bot: boolean };

/** Distinct humans (not the author) whose latest review approves the head commit. */
export function countApprovals(reviews: Review[], author: string, headSha: string): number {
  const latest = new Map<string, Review>();
  for (const r of reviews) {
    if (r.bot || r.user === author || r.state === "COMMENTED") continue;
    latest.set(r.user, r);
  }
  let n = 0;
  for (const r of latest.values()) if (r.state === "APPROVED" && r.commit === headSha) n++;
  return n;
}

/** CI entry point: `bun scripts/review/risk-tier.ts` with PR, REPO and GH_TOKEN set. */
async function main() {
  const pr = process.env.PR!;
  const repo = process.env.REPO!;
  const gh = async (path: string) => {
    const out = await Bun.$`gh api --paginate ${path}`.text();
    // --paginate concatenates JSON arrays; normalise to one array.
    return JSON.parse(`[${out.trim().replace(/\]\s*\[/g, ",").replace(/^\[|\]$/g, "")}]`);
  };
  const info = JSON.parse(await Bun.$`gh api repos/${repo}/pulls/${pr}`.text());
  const files: string[] = (await gh(`repos/${repo}/pulls/${pr}/files`)).map((f: { filename: string }) => f.filename);
  const reviews: Review[] = (await gh(`repos/${repo}/pulls/${pr}/reviews`)).map((r: any) => ({
    user: r.user.login, state: r.state, commit: r.commit_id, bot: r.user.type === "Bot",
  }));
  const author: string = info.user.login;
  const tier = prTier(files);
  let required = requiredApprovals(tier, author);
  // A solo repo can't produce two other humans; don't make high-risk PRs unmergeable.
  const eligible = TRUSTED_AUTHORS.filter((u) => u !== author).length;
  if (tier === "high") required = Math.max(Math.min(required, eligible), TRUSTED_AUTHORS.includes(author) ? 0 : 1);
  const got = countApprovals(reviews, author, info.head.sha);

  const lines = [
    `### Risk tier: **${tier}**`,
    `Approvals on \`${info.head.sha.slice(0, 7)}\`: ${got}/${required}`,
    "",
    "| File | Tier |", "| --- | --- |",
    ...files.map((f) => `| \`${f}\` | ${fileTier(f)} |`),
  ];
  if (process.env.GITHUB_STEP_SUMMARY) await Bun.write(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
  console.log(lines.join("\n"));

  if (process.env.GITHUB_OUTPUT) await Bun.write(process.env.GITHUB_OUTPUT, `tier=${tier}\n`);
  if (got < required) {
    console.error(`Needs ${required - got} more human approval(s) on the head commit for a ${tier}-risk change.`);
    process.exit(1);
  }
}

if (import.meta.main) await main();
