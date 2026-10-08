#!/usr/bin/env node
// HEL-1299 selftest for scripts/cache-janitor.mjs: feeds a fixture cache listing to selectDeletions and asserts the
// exact deletion set. JANITOR_MODULE overrides the module under test (used to show the test red on a mutated copy).
import { pathToFileURL, fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const mod = await import(
  process.env.JANITOR_MODULE
    ? pathToFileURL(process.env.JANITOR_MODULE).href
    : pathToFileURL(join(here, "cache-janitor.mjs")).href
);
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  process.stdout.write(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` -- ${detail}`}\n`);
};

let id = 0;
const MAIN = "refs/heads/main";
const mk = (key, day, ref = MAIN, size = 100) => ({
  id: ++id,
  key,
  ref,
  size_in_bytes: size,
  created_at: `2026-10-0${day}T00:00:00Z`,
});
const hex64 = (c) => c.repeat(64);
const cq = (lang, n) =>
  `codeql-overlay-base-database-1-c801913f1ee29663-${lang}-2.27.1-sha${n}-run${n}-1`;

const listing = [
  // backend compile: 4 on main (keep newest 2 -> delete days 1,2), PR + tag copies survive
  mk("backend-compile-v3-Linux-a", 1),
  mk("backend-compile-v3-Linux-b", 2),
  mk("backend-compile-v3-Linux-c", 3),
  mk("backend-compile-v3-Linux-d", 4),
  mk("backend-compile-v3-Linux-pr", 1, "refs/pull/7/merge"),
  mk("backend-compile-v3-Linux-tag", 1, "refs/tags/v1"),
  // codeql per language: independent families
  mk(cq("javascript", 1), 1),
  mk(cq("javascript", 2), 2),
  mk(cq("javascript", 3), 3),
  mk(cq("python", 1), 1),
  mk(cq("python", 2), 2),
  mk(cq("actions", 1), 1),
  // sbt deps: keep 1
  mk(`sbt-${hex64("a")}`, 1),
  mk(`sbt-${hex64("b")}`, 2),
  mk(`sbt-${hex64("c")}`, 3, "refs/pull/9/merge"),
  // never touched: other families on main (including near-misses of the allowlist)
  mk("node-cache-Linux-x64-npm-1", 1),
  mk("node-cache-Linux-x64-npm-2", 2),
  mk("node-cache-Linux-x64-npm-3", 3),
  mk("Linux-X64-sbt-runner-2.0.9-1.5.3", 1),
  mk("Linux-X64-sbt-runner-2.0.9-1.5.3-old", 0),
  mk("sbt-compile-v2-old", 1),
  mk("sbt-short", 1),
  mk("sbt-short2", 2),
  mk(`sbt-${hex64("a")}-extra`, 1),
  mk("codeql-overlay-base-database-1-c801913f1ee29663-ruby-2.27.1-x", 1),
  mk("codeql-overlay-base-database-1-c801913f1ee29663-ruby-2.27.1-y", 2),
];
const keys = (xs) => xs.map((c) => c.key).sort();
const got = keys(mod.selectDeletions(listing));
const want = keys([
  listing[0],
  listing[1], // backend-compile a, b
  listing[6], // javascript day 1
  listing[12], // sbt-a (superseded by sbt-b)
]);
check(
  "exact deletion set",
  JSON.stringify(got) === JSON.stringify(want),
  `got ${JSON.stringify(got)}\nwant ${JSON.stringify(want)}`,
);
check(
  "only refs/heads/main entries selected",
  mod.selectDeletions(listing).every((c) => c.ref === "refs/heads/main"),
);
check(
  "newest of every family survives",
  !got.includes("backend-compile-v3-Linux-d") &&
    !got.includes(cq("javascript", 3)) &&
    !got.includes(`sbt-${hex64("b")}`),
);
check("sole codeql actions entry survives", !got.includes(cq("actions", 1)));
check(
  "npm / setup-sbt / unknown-language entries untouched",
  !got.some((k) => /^node-cache|^Linux-X64|ruby/.test(k)),
);
check(
  "near-miss sbt keys untouched",
  !got.some((k) => k === "sbt-compile-v2-old" || k.startsWith("sbt-short") || k.endsWith("-extra")),
);
check("empty listing deletes nothing", mod.selectDeletions([]).length === 0);
const shuffled = [...listing].reverse();
check(
  "order of the listing does not matter",
  JSON.stringify(keys(mod.selectDeletions(shuffled))) === JSON.stringify(want),
);

if (failed) {
  process.stdout.write(`${failed} check(s) failed\n`);
  process.exit(1);
}
process.stdout.write("all cache-janitor checks passed\n");
