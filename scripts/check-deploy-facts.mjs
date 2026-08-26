#!/usr/bin/env node
/**
 * Fails when prose asserts a production deploy value that contradicts the
 * config that actually performs the deploy.
 *
 * WHY
 * ---
 * `--max-instances` has now been wrong in prose twice, for the same reason
 * both times. Production was capped to 2 in commit 51f110c0 because the
 * privileged DB pool (5 connections/instance) exhausts db-g1-small's
 * connection budget at 3+ concurrent instances. HEL-749 then found
 * `infra/deploy-backend.sh` still carrying a stale `3` and corrected it. In
 * HEL-495 the value `3` reappeared -- this time in CLAUDE.md's rate-limit
 * row, where it overstated the effective per-principal request ceiling by
 * 50% in exactly the row an operator reads while tuning that number.
 *
 * The second occurrence is the interesting one. It entered through the
 * TICKET text ("Cloud Run runs up to `max-instances=3`"), propagated into
 * proposal/tasks/design, and was then confirmed by review at every gate --
 * because each gate asked "is this caveat documented, and is it easy to
 * find?" (it was, prominently) and none asked "is the number true?". A
 * claim inherited from the ticket is not evidence; the deploy config is.
 *
 * So this check does not trust prose, tickets, or review. It reads the value
 * from the deployers themselves and requires every prose mention to match.
 *
 * Archived OpenSpec changes are excluded deliberately: they are a historical
 * record of what was believed at the time, and rewriting them would destroy
 * the audit trail that makes a regression like this traceable at all.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MENTION = /max[-_]instances|maxInstances/i;
const WITH_VALUE = /max[-_]instances\s*(?:=|is|to|at|of|:)?\s*`?(\d+)`?/i;

/** Files that actually deploy production. Order is not significant; they must agree. */
const DEPLOYERS = [".github/workflows/cd-backend.yml", "infra/deploy-backend.sh"];

const failures = [];

function extractAll(file) {
  const values = [];
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      // Skip comment lines -- deploy scripts explain the value in prose above it,
      // and that prose is checked as prose, not as the authoritative setting.
      const flag = line.match(/--max-instances[= ]"?(\d+)/);
      if (flag) values.push({ value: flag[1], line: i + 1 });
    });
  return values;
}

const deployed = new Map();
for (const file of DEPLOYERS) {
  const found = extractAll(file);
  if (found.length === 0) {
    failures.push(
      `${file}: no --max-instances flag found — this check has gone stale, or the deploy stopped setting it.`,
    );
    continue;
  }
  const distinct = [...new Set(found.map((f) => f.value))];
  if (distinct.length > 1) {
    failures.push(`${file}: sets --max-instances to more than one value (${distinct.join(", ")}).`);
  }
  deployed.set(file, distinct[0]);
}

const distinctAcrossDeployers = [...new Set(deployed.values())];
if (distinctAcrossDeployers.length > 1) {
  failures.push(
    `The two deploy paths disagree on --max-instances: ` +
      [...deployed].map(([f, v]) => `${f}=${v}`).join(", ") +
      `. The GitHub Actions workflow is what runs on a release push; infra/deploy-backend.sh is the manual path. They must match.`,
  );
}

const authoritative = distinctAcrossDeployers[0];

if (authoritative) {
  const tracked = execFileSync("git", ["ls-files", "*.md"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.startsWith("openspec/changes/archive/"));

  for (const file of tracked) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (!MENTION.test(line)) return;
        const m = line.match(WITH_VALUE);
        if (!m) return; // a bare mention with no number asserts nothing
        if (m[1] !== authoritative) {
          failures.push(
            `${file}:${i + 1} — states max-instances=${m[1]}, but production deploys with ${authoritative}.`,
          );
        }
      });
  }
}

if (failures.length > 0) {
  console.error("check:deploy-facts FAILED\n");
  failures.forEach((f) => console.error(`  ${f}`));
  console.error("");
  console.error("Prose must match the config that performs the deploy. If the production");
  console.error("value genuinely changed, change it in the deployers first, then update the docs.");
  console.error("Raising max-instances needs a real capacity decision — the cap exists because");
  console.error("the privileged DB pool exhausts db-g1-small's connections at 3+ instances.");
  process.exit(1);
}

console.log(
  `check:deploy-facts OK — max-instances=${authoritative}, consistent across deployers and docs`,
);
