import fs from "fs";
import path from "path";

// HEL-1048 D9/D11 — the accent-as-TEXT guard, built from the fixpoint
// transitive closure over CSS custom-property definitions (the same method
// as `skeptic3-accent-text-closure.py`, ported here so it runs in the same
// gate as every other guard rather than living only as a one-off script).
//
// PROVES: there is NO `color: var(--X)` declaration anywhere in the frontend
// stylesheet corpus where `--X` reaches `--app-accent` by any number of
// `var()` hops. The closure must come back EMPTY — there are no carve-outs.
// An earlier version allowed two "named exceptions" per an earlier reading of
// design.md D8; both were real WCAG failures (skeptic-final-1.md), D8 now
// rules "repoint all eight, no exception", and the allowlist is gone. A regression that reintroduces `color:
// var(--app-accent)` (directly OR through a new alias, any number of hops)
// anywhere in the corpus fails this test.
//
// CANNOT PROVE: that the repointed declarations render at >= 4.5:1 in a
// real browser — that is `appearance.test.ts`'s
// "clears 4.5:1 against D2's complete scored set" test plus the running-app
// evidence in `.concertino/runs/HEL-1048/evidence/`.

const SRC_ROOT = path.join(__dirname, "..");

function findCssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findCssFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".css")) {
      out.push(full);
    }
  }
  return out;
}

interface ColorDeclaration {
  file: string;
  line: number;
  prop: string;
}

/** Fixpoint transitive closure: every custom property whose definition
 * reaches `--app-accent` through any number of `var()` hops, then every
 * `color: var(--X)` declaration where `--X` is in that reachable set.
 *
 * `maxRounds` is a TEST-ONLY escape hatch (default `Infinity`, i.e. a real
 * fixpoint) used by the "crippled fixpoint" mutation test below to prove
 * the multi-hop mechanism is actually load-bearing: capped at 1 round, a
 * two-hop chain is NOT resolved, which is exactly the defect this closure
 * exists to prevent (evaluation-1.md CR-1). Production callers never pass
 * this argument. */
function buildAccentTextClosure(files: string[], maxRounds = Infinity): ColorDeclaration[] {
  const defs = new Map<string, string[]>();
  const fileLines = new Map<string, string[]>();

  for (const file of files) {
    const lines = fs.readFileSync(file, "utf-8").split("\n");
    fileLines.set(file, lines);
    for (const line of lines) {
      const m = /^\s*(--[a-z0-9-]+)\s*:\s*(.*)/i.exec(line);
      if (m !== null) {
        const [, prop, value] = m;
        const arr = defs.get(prop) ?? [];
        arr.push(value);
        defs.set(prop, arr);
      }
    }
  }

  const reach = new Set<string>(["--app-accent"]);
  let changed = true;
  let rounds = 0;
  while (changed && rounds < maxRounds) {
    changed = false;
    rounds++;
    // Snapshot BEFORE this round's additions: a property newly added
    // partway through this pass must not be visible to another property
    // checked later in the SAME pass, or a multi-hop chain can silently
    // resolve in fewer rounds than its real hop count (Map iteration
    // order would then decide the answer instead of the algorithm) —
    // exactly the ambiguity the maxRounds test below needs to not have.
    const reachAtRoundStart = new Set(reach);
    for (const [prop, values] of defs) {
      if (reach.has(prop)) continue;
      if (values.some((v) => [...reachAtRoundStart].some((r) => v.includes(`var(${r})`)))) {
        reach.add(prop);
        changed = true;
      }
    }
  }

  const colorPattern = /(?<![-a-zA-Z])color\s*:\s*var\((--[a-z0-9-]+)\)/i;
  const results: ColorDeclaration[] = [];
  for (const file of files) {
    const lines = fileLines.get(file) ?? [];
    lines.forEach((line, idx) => {
      const m = colorPattern.exec(line);
      if (m !== null && reach.has(m[1])) {
        results.push({ file: path.relative(SRC_ROOT, file), line: idx + 1, prop: m[1] });
      }
    });
  }
  return results;
}

// HEL-1048 (skeptic-final-1.md): there is no allowlist. The two D8
// "exceptions" this file used to carry (`AddSourceModal.css:85`/`:95`,
// `SidebarBody.css:62`) were both shipping a real WCAG failure —
// `--app-accent-strong` as TEXT, which D2's scored-background-tint fact
// does not cover and which design.md D8 published failing figures for
// (Orange 3.93, Cyan 3.45, Green 3.24, Yellow 2.78 in light) — reasoned
// from a true fact about a NEIGHBOURING thing (the tint really is scored
// as a background) applied to a declaration that fact never covered (the
// TEXT color on top of that background). Both are now repointed at
// `--app-accent-text`; every `color: var(...)` reaching `--app-accent`
// anywhere in the corpus is asserted to not exist at all.
describe("accent-as-text closure guard (HEL-1048 D9/D11)", () => {
  it("finds a non-trivial corpus (sanity: the walk isn't vacuous)", () => {
    const files = findCssFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(50);
  });

  it("no color: var(...) anywhere in the corpus reaches --app-accent (zero exceptions)", () => {
    const files = findCssFiles(SRC_ROOT);
    const found = buildAccentTextClosure(files);
    expect(found).toEqual([]);
  });

  // Mutation test (design.md D11 / tasks.md 5.6): the closure/regex must
  // actually MATCH a rule this change never touched, not silently no-op.
  // `--app-success` is a real, live custom property this change does not
  // edit; wiring a synthetic one-hop alias to it and feeding the resulting
  // text through the SAME closure logic proves the pattern fires for the
  // stated reason (an accent-reaching color declaration), not just on the
  // two files it happens to have been written against.
  it("mutation test: the closure logic detects a synthetic one-hop alias to --app-accent", () => {
    const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "accent-guard-mutation-"));
    const tmpFile = path.join(tmpDir, "mutation.css");
    fs.writeFileSync(
      tmpFile,
      [
        ".mutated-rule {",
        "  --mutation-alias: var(--app-accent);",
        "  color: var(--mutation-alias);",
        "}",
      ].join("\n"),
    );
    try {
      const found = buildAccentTextClosure([tmpFile]);
      expect(found).toHaveLength(1);
      expect(found[0].prop).toBe("--mutation-alias");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // HEL-1048 CR-1 (evaluation-1.md) — the mutation test above is only
  // ONE hop (`--mutation-alias: var(--app-accent)` directly). Repointing
  // `toast.css` (D9) removed the corpus's last real two-hop chain, so
  // NOTHING in the suite was actually exercising the fixpoint's second
  // iteration — the evaluator proved this by crippling the loop to 1 round
  // and getting a fully green suite. This fixture is genuinely two hops
  // (`--hop2` -> `--app-accent`, `--hop1` -> `--hop2`, `color: var(--hop1)`)
  // and is asserted BOTH ways: found by the real (unlimited) fixpoint, and
  // NOT found when the fixpoint is crippled to 1 round — so this arm can
  // only pass for the stated reason (multi-hop resolution actually
  // running), not incidentally.
  it("mutation test: the closure logic detects a synthetic TWO-hop alias chain to --app-accent", () => {
    const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "accent-guard-twohop-"));
    const tmpFile = path.join(tmpDir, "twohop.css");
    fs.writeFileSync(
      tmpFile,
      [
        ".two-hop-rule {",
        "  --hop2: var(--app-accent);",
        "  --hop1: var(--hop2);",
        "  color: var(--hop1);",
        "}",
      ].join("\n"),
    );
    try {
      const found = buildAccentTextClosure([tmpFile]);
      expect(found).toHaveLength(1);
      expect(found[0].prop).toBe("--hop1");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("crippled-fixpoint counter-check: capping the fixpoint at 1 round misses the two-hop chain (proves the mutation arm above is not incidental)", () => {
    const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "accent-guard-crippled-"));
    const tmpFile = path.join(tmpDir, "twohop.css");
    fs.writeFileSync(
      tmpFile,
      [
        ".two-hop-rule {",
        "  --hop2: var(--app-accent);",
        "  --hop1: var(--hop2);",
        "  color: var(--hop1);",
        "}",
      ].join("\n"),
    );
    try {
      const crippled = buildAccentTextClosure([tmpFile], 1);
      expect(crippled).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Negative control: a color declaration that does NOT reach --app-accent
  // (an unrelated custom property) must not be flagged — otherwise the
  // guard would be vacuously true (flags everything) rather than actually
  // discriminating.
  it("mutation test: an unrelated custom property is NOT flagged", () => {
    const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "accent-guard-control-"));
    const tmpFile = path.join(tmpDir, "control.css");
    fs.writeFileSync(
      tmpFile,
      [".unrelated-rule {", "  color: var(--app-success);", "}"].join("\n"),
    );
    try {
      const found = buildAccentTextClosure([tmpFile]);
      expect(found).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
