## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/agent-surface-credential-gate/spec.md` in full.
- Read the SHIPPED gate `scripts/check-no-credential-in-agent-surface.mjs` (775 lines) and its
  self-test (382 lines) rather than trusting the artifacts' description of them.
- Clean-tree count claim (design Decision 5 / AC5) — verified fresh:
  `node scripts/check-no-credential-in-agent-surface.mjs`
  → `check-no-credential-in-agent-surface: OK (82 files scanned: 13 assistant-surface, 3 fixture,
  66 mcp, 0 violations)` / `exit=0`. Matches the plan exactly.
- Husky wiring claim (design Gate-Chain checklist "lines 17–18") — verified: `.husky/pre-commit`
  line 17 `npm run check:no-credential-leak`, line 18 `...:selftest`. Correct.
- `runMutatedScript` exists (selftest L96) and does enforce exactly-one-occurrence against the
  shipped source (L98–105) — Decision 4's mechanism is real.
- The three residual paths themselves are real in the shipped script: `runChecksForSurface`
  `catch { continue }` (L552), `findBannedImport` `catch { continue }` (L492), the entry guard
  (L764), and no self-test case for `importGraph`/`credentialProp` (grepped the selftest: cases
  cover fixture/mcp secret/bcrypt/email/drift/vacuity/SURFACES-shape only).
- Grepped both files for the claim that the three residuals are "documented in the script header" —
  **not found** (see CR1).
- Grepped `.gitignore` (L57–62): HEL-956 self-test artifacts are listed as four **explicit paths**,
  not a `.hel956-` prefix glob.
- Read `collectFiles` (L305–336): it has a third, unaddressed silent-drop `catch` (see CR2).

### Verdict: REFUTE

The plan is close and largely well-grounded (the count, the mutation harness, the surface-table and
`credentialProp`-stays-assistant-only judgement calls are all correctly preserved, and the Planner
Notes are the right kind of self-approved reversible call — none of those are objections). But it
contains one unexecutable task built on a false premise, one silent-drop path of exactly the class
this ticket exists to close that the plan does not mention at all, one ordering interaction that
would violate its own new spec scenario, and two smaller coverage/mechanics gaps.

### Change Requests

1. **`tasks.md` 1.4 is unexecutable — the premise is false.** `ticket.md` ("documented in the script
   header"), `proposal.md` ("All three are recorded in the script header as known residual limits")
   and task 1.4 ("remove the three now-closed residuals" from the header block) all assume the three
   residuals are written in the script header. They are not. The header's *"Known residual limits of
   the drift guard"* block (L131–137) covers directory-vs-file classification and dot-dirs; the
   *"Other known residual limits"* block (L138–150) lists exactly three unrelated items: the
   exact-word `credential` match, relative-only `extractRelativeImports`, and the entropy-gated
   secret-literal check. None of the three HEL-993 residuals appears; the entry-guard comment
   (L756–763) in fact says the opposite — that it was "fixed rather than left as a documented
   residual limit". Task 1.4 as written directs an executor either to no-op silently or to delete
   three *legitimate, still-true* residual entries. Rewrite 1.4 to say what is actually required
   (e.g. ADD header notes recording that the read-failure and entry-guard paths are now closed by
   HEL-993, and leave the existing three residual entries intact), and correct the false "recorded
   in the script header" sentence in `proposal.md` — Why.

2. **`collectFiles`'s `readdirSync` `catch { return out; }` (L307–310) is a fourth silent-green path
   and the plan is silent on it.** Decisions 1 and 2 address only the two `readFileSync` catches. An
   unlistable directory under a declared surface root (e.g. `chmod 000` on
   `frontend/src/features/assistant/components/`) drops every file beneath it, contributes zero to
   the count, and does not make the surface vacuous — so the gate prints a confident OK over code it
   never collected. This is the same defect shape as residual 1 and it defeats the spec's own new
   requirement ("the reported count SHALL be the number of files the gate actually examined"):
   files never collected are never "examined" either. Either close it in Decision 1 (a readdir
   failure is an error), or record an explicit decision to defer it with a named follow-up ticket
   AND a header residual-limits entry — but the plan must not stay silent on it.

3. **Decision 1's "excluded from that surface's counted list" collides with the vacuity check and
   would violate the plan's own new spec scenario.** `main()` builds `surfaceRecords` and exits
   early with `VACUOUS SURFACE` whenever `files.length === 0` (L706–724), *before* the `allErrors`
   report (L730+). If unreadable files are subtracted from the same `files` array the vacuity check
   reads, a surface whose files are all unreadable exits 1 with a VACUOUS message that never names
   the file or the read error — contradicting spec scenario "A scanned file cannot be read" → "AND
   the message names the file and the read error". The phrase is also ambiguous (subtract from
   `surfaceRecords[].files`, or keep a separate examined-count?), which is exactly the two-readings
   ambiguity this gate should catch. State explicitly which list is filtered and how read errors are
   ordered relative to drift/vacuity errors so a read error is never masked.

4. **Decision 2 / spec require the import-graph read failure, but no self-test case covers it.**
   The spec ADDs "The same SHALL hold for a file reached through the import-graph walk", and task
   1.2 gives only a manual verify step; tasks 2.1–2.4 add no case for it, and 3.1's mutation list
   folds it into a single "the read-failure error". Since the whole ticket's thesis is that "I
   reviewed it and it looks right" is not evidence about a gate, add either a self-test case for the
   BFS read failure (plant an unreadable transitively-imported module) or an explicit, reasoned
   statement in design.md of why the surface-level case is sufficient coverage for both catch sites.

5. **Planting on the assistant surface needs `.gitignore` entries, and no task covers it.** Task 2.5
   says planted paths are "`.hel993-`-prefixed, gitignored" — but `.gitignore` L57–62 lists HEL-956's
   artifacts as four **explicit paths**, not a prefix pattern, so nothing currently ignores a
   `.hel993-*` file. Task 3.2 simultaneously demands a clean `git status`. Add an explicit task to
   register every new planted path in `.gitignore` (and name the paths). While there, confirm in
   design.md that a dot-prefixed `.hel993-*.ts` planted under `frontend/src/features/assistant/`
   IS collected — `collectFiles` does not skip dotfiles and `isSourceFile`/`isTestFile` (L296–302)
   would accept it, so this holds, but the cases in 2.3/2.4 depend on it and it should be stated.

### Non-blocking notes

- Decision 4 says cases are "mutation-verified against the **shipped** script", while
  `runMutatedScript` actually executes a derived copy (the shipped source with one occurrence-checked
  replacement). That is the established HEL-956 convention and is defensible — the exactly-once
  assertion binds the copy to shipped source — but given AC4's wording ("A self-test that exercises
  a copy is a test of the copy"), design.md should say plainly: the green/red *assertion* arm runs
  the shipped script, and the copy is used only for the mutation arm.
- Decision 3's basename backstop works for the mutated-copy harness (copy's `argv[1]` and
  `import.meta.url` share a basename), so task 2.2 is feasible as written — no change needed, just
  noting I checked.
- Decision 1 reads every surface file up front; `findBannedImport` will then read the root file a
  second time. Harmless at 82 files; mention it or don't.
