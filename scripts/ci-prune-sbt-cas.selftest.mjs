#!/usr/bin/env node
// HEL-1299 selftest for scripts/ci-prune-sbt-cas.sh on a fixture sbt cache. The fixture lives under
// backend/target (gitignored) -- never under ~ and never the real ~/.cache/sbt. Needs bash only.
// PRUNE_SCRIPT overrides the script under test (used to show the test red against a mutated copy).
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  existsSync,
  symlinkSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = process.env.PRUNE_SCRIPT ?? join(root, "scripts", "ci-prune-sbt-cas.sh");
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  process.stdout.write(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` -- ${detail}`}\n`);
};

const hex = (c) => c.repeat(64);
const blob = (c, size) => `sha256-${hex(c)}-${size}`; // CAS filename form
const ref = (c, size) => `sha256-${hex(c)}/${size}`; // form named inside `ac` entries

function build() {
  mkdirSync(join(root, "backend", "target"), { recursive: true });
  const base = mkdtempSync(join(root, "backend", "target", "prune-selftest-"));
  const cache = join(base, "sbt");
  const out = join(base, "out");
  for (const d of ["cas", "ac", "proc"]) mkdirSync(join(cache, "v2", d), { recursive: true });
  mkdirSync(join(out, "jvm"), { recursive: true });
  // CAS: a, b referenced by output links; c, d unreferenced.
  for (const [c, n] of [
    ["a", 3],
    ["b", 4],
    ["c", 5],
    ["d", 6],
  ])
    writeFileSync(join(cache, "v2", "cas", blob(c, n)), "x".repeat(n));
  symlinkSync(join(cache, "v2", "cas", blob("a", 3)), join(out, "jvm", "a.jar"));
  symlinkSync(join(cache, "v2", "cas", blob("b", 4)), join(out, "jvm", "b.zip"));
  const acEntry = (...refs) =>
    JSON.stringify({
      outputFiles: refs.map((r, i) => `\${OUT}/f${i}>${r}`),
      origin: "disk",
      exitCode: 0,
      contents: [],
      isExecutable: [],
    });
  const ac = join(cache, "v2", "ac");
  writeFileSync(join(ac, "keep-both"), acEntry(ref("a", 3), ref("b", 4)));
  writeFileSync(join(ac, "drop-one-pruned"), acEntry(ref("a", 3), ref("c", 5)));
  writeFileSync(join(ac, "drop-all-pruned"), acEntry(ref("d", 6)));
  writeFileSync(
    join(ac, "keep-no-blobs"),
    JSON.stringify({ outputFiles: [], origin: "disk", exitCode: 0 }),
  );
  // A blob whose hex matches a kept one but with a different size must not count as kept.
  writeFileSync(join(ac, "drop-wrong-size"), acEntry(ref("a", 99)));
  writeFileSync(join(cache, "v2", "proc", "p1"), "proc");
  return { base, cache, out };
}
const run = (mode, f, extra = {}) =>
  spawnSync("bash", [SCRIPT, mode], {
    encoding: "utf8",
    env: { ...process.env, SBT_CACHE_DIR: f.cache, OUT_DIR: f.out, ...extra },
  });
const names = (f, d) => readdirSync(join(f.cache, "v2", d)).sort();

const fixtures = [];
try {
  // report mode deletes nothing
  let f = build();
  fixtures.push(f);
  let r = run("report", f);
  check("report exits 0", r.status === 0, r.stderr);
  check("report deletes no CAS blob", names(f, "cas").length === 4);
  check("report deletes no ac entry", names(f, "ac").length === 5);
  check(
    "report prints ac kept/dropped counts",
    /ac:\s+total=5 kept=2 dropped=3/.test(r.stdout),
    r.stdout,
  );

  // prune mode
  f = build();
  fixtures.push(f);
  r = run("prune", f);
  check("prune exits 0", r.status === 0, r.stderr + r.stdout);
  check(
    "referenced CAS blobs kept, unreferenced removed",
    names(f, "cas").join() === [blob("a", 3), blob("b", 4)].join(),
    names(f, "cas").join(),
  );
  check(
    "ac: entries whose every blob survives are kept (sha256-hex/size matched to sha256-hex-size)",
    names(f, "ac").includes("keep-both") && names(f, "ac").includes("keep-no-blobs"),
    names(f, "ac").join(),
  );
  check(
    "ac: entries naming a pruned (or wrong-size) blob are dropped",
    !names(f, "ac").some((n) => n.startsWith("drop-")),
    names(f, "ac").join(),
  );
  check("proc untouched", names(f, "proc").join() === "p1");
  check(
    "output symlinks untouched and resolvable",
    existsSync(join(f.out, "jvm", "a.jar")) && existsSync(join(f.out, "jvm", "b.zip")),
  );
  check(
    "prune log reports ac kept/dropped counts",
    /ac:\s+total=5 kept=2 dropped=3/.test(r.stdout) &&
      /cas:\s+total=4 kept=2 dropped=2/.test(r.stdout),
    r.stdout,
  );

  // a non-CAS symlink that `find` yields last must be skipped, not abort the script (regression: errexit + pipefail)
  f = build();
  fixtures.push(f);
  mkdirSync(join(f.out, "zz"), { recursive: true });
  writeFileSync(join(f.base, "elsewhere.txt"), "not in the CAS");
  symlinkSync(join(f.base, "elsewhere.txt"), join(f.out, "zz", "zz-last.txt"));
  r = run("prune", f);
  check("non-CAS symlink does not abort prune", r.status === 0, `status ${r.status} ${r.stderr}`);
  check(
    "non-CAS symlink: referenced blobs kept, others pruned",
    names(f, "cas").join() === [blob("a", 3), blob("b", 4)].join(),
    names(f, "cas").join(),
  );

  // refuses (and deletes nothing) when the output references no blob -- e.g. a failed restore
  f = build();
  fixtures.push(f);
  rmSync(join(f.out, "jvm", "a.jar"));
  rmSync(join(f.out, "jvm", "b.zip"));
  r = run("prune", f);
  check("prune refuses when output references no CAS blob", r.status === 1, `status ${r.status}`);
  check("refusal deletes nothing", names(f, "cas").length === 4 && names(f, "ac").length === 5);

  // refuses without a compile output dir
  r = run("prune", f, { OUT_DIR: join(f.base, "missing") });
  check("prune refuses without a compile output dir", r.status === 1);
} finally {
  for (const f of fixtures) rmSync(f.base, { recursive: true, force: true });
}
if (failed) {
  process.stdout.write(`${failed} check(s) failed\n`);
  process.exit(1);
}
process.stdout.write("all prune-sbt-cas checks passed\n");
