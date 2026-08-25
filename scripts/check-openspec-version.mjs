#!/usr/bin/env node
/**
 * Fails when the installed `openspec` CLI drifts from the version this repo's
 * tooling is written against.
 *
 * Why this exists: Concertino's role docs invoke `openspec` by bare command and
 * agents follow those instructions literally. When the CLI's surface moves
 * underneath them, the failure is silent — CON-130 found the Planning
 * validation gate had been running a flag that did not exist, so the gate that
 * was supposed to catch malformed planning artifacts was quietly doing nothing.
 * 26 malformed spec files accumulated in this repo before anyone noticed.
 *
 * A drift check cannot prevent that on its own, but it converts "silently
 * running against an unexpected CLI" into a loud failure at check time.
 *
 * This is deliberately a *detection* mechanism, not a true dependency pin.
 * Pinning properly means a local devDependency plus rewiring every invocation
 * in Concertino's `core/` to a local binary — tracked separately. Until then,
 * this is the honest middle ground: the expected version is recorded in one
 * place and drift is caught rather than assumed away.
 */

import { execFileSync } from "node:child_process";

/** The openspec version this repo's specs, hygiene scripts, and Concertino role
 *  docs are written against. Bump deliberately, after re-validating both repos. */
const EXPECTED = "1.10.0";

function readInstalledVersion() {
  try {
    return execFileSync("openspec", ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

const installed = readInstalledVersion();

if (installed === null) {
  console.error("check:openspec-version FAILED — `openspec` is not on PATH.");
  console.error(`Install it with:  npm i -g @fission-ai/openspec@${EXPECTED}`);
  process.exit(1);
}

if (installed !== EXPECTED) {
  console.error(
    `check:openspec-version FAILED — installed openspec is ${installed}, expected ${EXPECTED}.`,
  );
  console.error("");
  console.error("The CLI surface can move between versions while the role docs that");
  console.error("invoke it stand still, which fails silently rather than loudly.");
  console.error("");
  console.error(`To match:      npm i -g @fission-ai/openspec@${EXPECTED}`);
  console.error(`To re-pin:     validate both repos against ${installed}, then update`);
  console.error("               EXPECTED in scripts/check-openspec-version.mjs.");
  console.error("");
  console.error("Re-validate with:  openspec validate --specs --strict");
  process.exit(1);
}

console.log(`check:openspec-version OK — openspec ${installed}`);
