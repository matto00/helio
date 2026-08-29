## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold reviewer. Scope of this round: verify by measurement that commit a32da612
actually closes skeptic-final-1.md CR1. Everything else was verified clean by the
round-1 cold skeptic (four tool descriptions claim-for-claim, AC5 by enumeration,
AC4 by byte-level `&` probe); I re-derived only the diff-scope claim independently.

### What I verified (with evidence)

**1. Diff scope — zero backend/frontend/migration files.** Re-derived, not trusted.
`git diff main...HEAD --stat` = 21 files, all under `helio-mcp/src/` or
`openspec/changes/`. `git diff main...HEAD --name-only | grep -E "^(backend|frontend)/|migration"`
→ no output. Working tree clean at start (`git status --porcelain` empty).

**2. The drift guard now genuinely reads the Scala source.** `scheduleTools.test.ts:45`
defines `extractCaseClassFields(scalaSource, className)`; the test at :136 calls it
with `readFileSync(resolve(__dirname, "../../../backend/.../PipelineScheduleProtocol.scala"))`.
That is a real read of the real file, not a snapshot.

**3. Sensitivity, measured on the REAL Scala file — not on fixtures.**
Baseline: `npx jest helio-mcp ...` with `--listTests` first (collection non-empty,
14 suites listed), then green: **14 suites / 250 tests passed**.

- *Added 11th field* (`runCount: Int` appended to the real `PipelineScheduleResponse`):
  **RED** — `expect(fields).toEqual([...])` at :163 fails with `+ "runCount"`.
  `Tests: 1 failed, 19 passed`.
- *Renamed field* (`lastRunAt` → `previousRunAt` in the real file):
  **RED** — same assertion fails with `- "lastRunAt" / + "previousRunAt"`.
  `Tests: 1 failed, 19 passed`.
- Reverted from a byte-copy backup; `git status --porcelain` empty again; full
  re-run back to **14 suites / 250 tests passed**.

This is the exact red the frozen-literal version could never produce. CR1 is closed.

**4. Can the parser return a wrong-but-non-empty set that still PASSES?** Probed
directly by extracting the regex into a standalone script and running seven
adversarial sources against the pass condition (`length > 0 && deepEqual(EXPECTED)`):

| case | result | derived |
|---|---|---|
| paren-bearing type mid-list `(String, Int)` | RED | `[id, meta]` (truncated prefix) |
| trailing `// (comment)` with a paren | RED | `[id]` |
| class declared without `final` | RED | `[]` → non-empty guard fires |
| added field with a default value | RED | 11 fields |
| added `Option[Map[String, String]]` field | RED | 11 fields |
| default value on an existing field | passes | correct 10 fields |
| whole class reformatted to one line | passes | correct 10 fields |

The two passing cases are cosmetic reformattings that **do not change the field
set** — passing is the correct answer there, not a false green. Every case that
truncates early yields a strict *prefix* of the expected list, which can never
deep-equal a 10-element array. So the "stops at the FIRST `)`" shortcut is sound
**for this type** (all field types are bare names or `Option[X]`, no nested parens),
and more importantly its failure direction is **fail-closed**: a type that violates
the assumption breaks the test loudly rather than silently. I found no input that
produces a wrong-but-passing set.

On the non-empty guard specifically: it is *necessary but not sufficient* on its own
— it only catches the `[]` case. Sufficiency comes from the `toEqual` against the
full ordered list, which is what makes truncation and add/rename red. Both are
present; the combination holds.

**5. Test name and comment vs. what the assertions do.** The name — "names every
field the LIVE PipelineScheduleResponse case class carries (parsed from the Scala
source, not a hand-maintained snapshot)" — is now exactly true: the fields *are*
parsed from the Scala source, and the `for (const field of fields)
expect(GET_PIPELINE_SCHEDULE_DESCRIPTION).toContain(field)` loop is precisely the
"names every field" claim. The two fabricated-source unit tests claim "proves the
guard would go red on an 11th Scala field" / "on lastRunAt becoming previousRunAt";
I verified both of those claims against the *real* file in §3, so the names
under-claim if anything. No name or comment promises more than its assertions do.

**6. Commit-message audit (a32da612).** Every claim checked: `extractCaseClassFields`
helper ✓; `readFileSync` + regex over the real protocol file ✓; non-empty guard ✓;
"four unit tests for the parser itself" ✓ (order-extraction, absent-class, added,
renamed — enumerated, exactly four in the `describe` block at :181); "sensitivity
proved by mutating the REAL files in both directions" ✓ — independently reproduced
above. No overclaim found.

**7. Gates re-run myself.** `npx tsc --noEmit -p helio-mcp/tsconfig.json` → exit 0.
`npx eslint helio-mcp/src --max-warnings 0` → exit 0. Jest as above.

**8. UI/design judgment: N/A.** The diff touches zero `frontend/**` files, so
`DESIGN.md` is not engaged and no server/visual gate applies. I did not start servers.

### Verdict: CONFIRM

### Non-blocking notes
- The `toEqual([...10 names])` right-hand side is still a hand-maintained literal.
  That is fine and is what option (a) prescribes — it now sits opposite a
  Scala-derived left side, so drift is *loud* rather than invisible. The only cost
  is that a legitimate Scala-side field addition requires updating two places (the
  literal and the description), which is the intended friction.
- `extractCaseClassFields` is duplicated conceptually with nothing else in the repo;
  if a second drift guard is ever added, promote it to a shared test util rather
  than copy-pasting the regex.
