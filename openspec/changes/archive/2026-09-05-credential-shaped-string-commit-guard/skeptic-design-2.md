## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Round 1's confirmed findings (false-positive measurement, CI-absence, `ACKNOWLEDGED_UNSCANNED`)
are taken as given per the brief. This round verifies (a) CR1's resolution, (b) new defects
introduced by the revisions, (c) what round 1 missed.

### What I verified (with evidence)

**CR1 — resolution is sound, executable, and smuggles in neither forbidden escape.**

1. **The plant mechanism actually works — the load-bearing claim, checked against source.**
   Decision 2a rests on "the gate walks the filesystem rather than the git index, so a gitignored
   plant is still genuinely scanned". Two ways this could have been silently false, both checked:
   - `collectFiles` (l.342–365) uses `readdirSync(dir, {withFileTypes:true})` with **no dot-entry
     skip**. The `name.startsWith(".")` skip is at l.688, inside `classifyTopLevelDirs` only, and
     applies to repo-root top-level *directories*. So a `.hel846-`-prefixed plant under `openspec/`
     **is** collected. Had the dot-skip been in `collectFiles`, every task-5 mutation would have
     read green while proving nothing — the exact HEL-956/993 class. It is not.
   - `include: "allNonBinary"` (l.361–362) admits every file whose `extname` is not in
     `BINARY_FIXTURE_EXTENSIONS`. A `.hel846-plant.md` or an extensionless plant both qualify.
2. **The transcript is safe to commit.** `checkSecretLiterals` l.462–486: the vendor branch pushes
   `${relative(repoRoot,file)}:${line}: contains a hardcoded vendor-prefixed credential-shaped
   literal — …`, and the named branch interpolates `namedMatch[1]` (the *identifier*) only. Neither
   echoes `vendorMatch[0]` or `namedMatch[2]`. Decision 2a claim (2) and task 3.2 are correct, and
   3.2 turns it into a shipped requirement for the new message rather than an assumption.
3. **Neither forbidden escape is smuggled in.** The §5 preamble still requires planted values to
   "carry no synthetic marker (a marker would exempt them)" — the plant is relocated, not weakened.
   And no task anywhere adds an allowlist entry: task 3.2 exempts "both … only via
   `isSyntheticSecretLiteral`", and Decision 2's no-allowlist promise is restated intact.
4. **The standing repo-wide constraint is stated in all three places it needs to be**: design.md
   Decision 2a (explicitly, as permanent and repo-wide), tasks.md 9.2a (into `CONTRIBUTING.md`,
   with the marker set listed), and a new spec scenario ("A review report quotes a credential-shaped
   value") which also encodes the safe-to-quote-gate-output half. Task 10.4a closes the loop by
   running the finished gate against the finished change directory.
5. **The constraint is satisfiable today by this change's own artifacts — measured, not assumed.**
   I implemented the *planned* rule set (vendor regex + `HIGH_ENTROPY_NAMED_SECRET_REGEX` as
   specified in task 3.1, with the `_`→`-` normalization and the widened 11-marker set from tasks
   2.1/2.2) and ran it over `git ls-files openspec docs notes` **plus this change's own untracked
   artifacts** (design.md, tasks.md, skeptic-design-1.md — all new or rewritten since round 1's
   measurement, so genuinely unmeasured): **5,888 files, 0 hits.** Notably `design.md`'s own quoted
   `CONNECTOR_MASTER_KEY=REPLACE_WITH_OUTPUT_OF_openssl_rand_dash_base64_32` (49 chars, matches the
   new regex) passes **only** because tasks 2.1 and 2.2 both land — normalization plus the
   `replace-with` marker. The revisions are internally consistent with their own artifacts.

**CR2 — resolved.** Task 5.6 now pins the exercise to `notes/` or the mutated-copy harness, and
carries an explicit "**Never rename `openspec/`**" with the reason (change dir + `openspec/specs/**`
under `check:openspec`/`assert-phase.sh`).

**CR3 — resolved and independently re-measured.** `git ls-files` gives openspec 5,855 + docs 19 +
notes 8 = **5,882**, matching the corrected table label exactly. The Risks section now reads
"5,882 tracked files of the three surfaces being added (and zero on the wider nine-tree probe of
7,610 files)" — both numbers now correctly attributed.

**Both non-blocking notes applied.** Decision 2 now distinguishes the one live `docs/` false
positive from the `backend/src/test` value on an unscanned tree; task 3.1 now requires the
optional-quote comment with its markdown-transcript rationale.

**New-defect sweep on the revisions:**

6. **No CI vacuity trap.** A surface with zero collected files is a hard failure (l.798–799). All
   three new roots are tracked and non-empty in a clean checkout (openspec 5,855 / docs 19 /
   notes 8 tracked files), so the new surfaces cannot go vacuous in CI from task 8.1's wiring.
7. **Binary-extension coverage holds for the new trees.** The only binary extensions actually
   present under the three roots are `.png` (2), `.jpg` (1), `.gif` (1) — all in
   `BINARY_FIXTURE_EXTENSIONS`. Everything else is `.md`/`.yaml`/`.txt`/`.tsv`/`.py`/`.mjs`/
   `.html`/`.awk`. No utf8-read-garbage path is opened by the new surfaces today.
8. **Task 5.4's drift/detection conflation is pre-empted, not created.** Removing a `SURFACES` entry
   after task 4.2 makes the directory unclassified, so the run goes red for *drift*. 5.4 requires
   showing "the credential is no longer detected **as a credential**" and recording **both**
   observations — the right phrasing to stop a red-for-the-wrong-reason from reading as proof.
9. **Task 2.4 mechanically catches the marker-widening regression risk.** Widening markers could in
   principle exempt a value an existing selftest case asserts must be detected; 2.4 requires the
   selftest to stay green, which would surface exactly that.
10. **Spec delta still well-formed after the edits.** Both `## MODIFIED` headers match existing
    headers verbatim (l.9 "Declared scan surfaces", l.86 "False positives are resolved by
    convention"), and each MODIFIED body **preserves** the original's scenarios (2 and 2
    respectively) rather than dropping them while adding new ones. `npm run check:openspec` →
    `openspec/ is clean`.
11. **Constraints respected:** no Playwright, no e2e, no Flyway, no jest/`.husky` restructuring
    (task 8.3 forbids them explicitly). CON-132 Gate-Chain Implications Checklist is present and
    complete — all five questions answered, and task 10.1 still requires the per-script
    isolation-test transcripts. I ran no browser and modified no code.

### Verdict: CONFIRM

CR1's resolution is complete: it works mechanically (verified against `collectFiles`, not assumed),
it preserves the proof, it adds no allowlist, it states the permanent consequence in design, tasks,
and spec, and this change's own artifacts already satisfy it under measurement.

### Non-blocking notes

- **`.gitignore` convention (task 7.3).** The existing `.hel956-`/`.hel993-` entries are **exact
  paths**, not globs (`.gitignore` l.59–74). Task 7.3 says "add the `.hel846-` patterns"; the
  executor should either add one exact entry per planted path (matching the established convention)
  or a deliberate `.hel846-*` glob — silently doing neither leaves a plant committable if a
  `finally` is skipped.
- **Residual-limits wording (task 4.4).** The false-negative disclosure is currently abstract ("no
  credential with neither a known vendor prefix nor a credential-named identifier"). A concrete,
  repo-specific instance would land harder and is genuinely reachable: a `helio_session` cookie
  value pasted from a `curl -b`/`-c` transcript has neither property and would not be caught.
- **Extension list (task 4.4).** `.webp`, `.ico`, `.mp4` are absent from
  `BINARY_FIXTURE_EXTENSIONS`; none exist under the three new trees today, so this is forward-looking
  only, but it is a one-line addition to the residual-limits entry.
