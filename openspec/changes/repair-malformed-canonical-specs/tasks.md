## 1. Baseline (must precede any edit)

- [x] 1.1 Confirm the branch is merged up to `origin/main` and `git merge-base HEAD origin/main` equals
      `git rev-parse origin/main`. If `main` advanced, merge again and then re-run **the full
      enumeration** (not just the 1.2 inventory): re-derive the four class conditions across every spec,
      and explicitly re-check any spec the merge added or modified against them. `main` advanced twice
      during planning alone (785e0af9 -> 8432f280, HEL-554/#413), adding `first-run-onboarding` and
      modifying `frontend-panel-empty-state` — the very file AC5 requires verifying. Verified post-merge
      at 8432f280: both are well-formed, repair set still 26, corpus N=317, and exactly one
      scenario-less requirement repo-wide (the approved exception). Re-take this if `main` moves again.
- [x] 1.2 Record a baseline inventory of all canonical specs. **Record the spec count as `N`** and use
      `N` everywhere below — do not hardcode it; `main` advanced from 316 to 317 during the design gate
      alone. Per file: the ordered list of
      `### Requirement:` names, and a sha256 of each **full requirement block**. The block runs from a
      `### Requirement:` header up to (not including) the next line matching `/^(##|###)\s/` — that is,
      the next level-2 or level-3 heading, or end of file. **`#### Scenario:` blocks and their
      `- **WHEN**` / `- **THEN**` bullets are INSIDE the hashed block** and must be hashed with it. Do
      NOT implement the boundary as `line.startswith('###')`: `#### Scenario:` satisfies that, every
      block would truncate at its first scenario, and all bodies would fall outside the hash — which is
      exactly the blindness this check exists to close (proven: deleting a `- **THEN**` bullet leaves the
      naive hash byte-identical). Hashing heading lines alone
      is proven blind to body-text loss — deleting a `- **THEN**` bullet and a whole SHALL statement
      leaves a heading-only hash byte-identical. Write it to a temp path outside the repo.
- [x] 1.3 Re-confirm `openspec validate --specs` reports 24 failures before any repair (the starting
      state the repair must move to 0). Note `openspec archive` exits 0 even when it aborts — never
      trust its exit code; assert on stdout.
- [x] 1.4 Before repairing, capture the unrepaired baseline the guard will later be validated against:
      the per-file parser-visible / validator-visible / in-file requirement-name sets across all N
      specs (25 files have visible != total today across N=317). The post-repair tree is uniformly well-formed, so it
      cannot discriminate a correct guard from a vacuous one; this baseline can.

## 2. Repair Class A — 19 raw delta files (stray `## ADDED Requirements`, no Purpose)

`csv-upload-connector`, `dashboard-appearance-settings`, `dashboard-delete`, `dashboard-ordering`,
`dashboard-panel-layouts`, `dashboard-partial-update`, `dashboard-rename`, `frontend-dashboard-creation`,
`frontend-dashboard-selection-flow`, `frontend-protected-routes`, `layout-undo-redo`,
`oauth-error-display`, `panel-delete`, `panel-duplication`, `panel-ordering`, `panel-polling`,
`panel-title-edit`, `rest-api-connector`, `smart-panel-placement`

- [x] 2.1 For each: rename the single `## ADDED Requirements` line to `## Requirements`. Touch nothing else.
- [x] 2.2 For each: prepend a `## Purpose` section describing the capability, derived **only** from the
      requirements already present in that file. Do not assert behavior not stated there. Aim past 50
      characters (shorter triggers a validator WARNING, not an error).
- [x] 2.3 Verify each file now parses with all requirements visible and validates.

## 3. Repair Class B — 2 files whose requirements are hidden by duplicate sections

- [x] 3.1 Collapse **all** requirements-bearing `##` sections in each file into a single
      `## Requirements`, preserving **document order** — the merged section contains the requirement
      blocks in the order they already appear in the file. Do NOT put one section's blocks ahead of the
      other's: in `shared-inline-error` the stray `## ADDED Requirements` comes FIRST (line 5) and
      `## Requirements` second (line 39), so "existing section first" would reverse document order and
      fail the 6.1 hash check.
- [x] 3.2 `shared-inline-error` (3 of 6 visible): rename the leading `## ADDED Requirements` to
      `## Requirements` and delete the later `## Requirements` heading line. Nothing else moves.
- [x] 3.3 `schema-inference` (4 of 8 visible): this file has a stray `## ADDED Requirements` **and a
      duplicate `## Requirements`** — the only spec in the repo with two `## Requirements` headings
      (`grep -n`, 1-indexed: `## Purpose` :1, `## Requirements` :5, `## ADDED Requirements` :110, `## Requirements` :140).
      Collapse all three requirements-bearing headings into the single one at line 5, preserving
      document order. **Delete each removed heading line together with exactly one immediately-adjacent
      blank line *where one exists*.**  (`schema-inference:140` and `shared-inline-error:39` have no
      adjacent blank line — line 139 is a SHALL sentence, 141 a `### Requirement:` — so there the
      heading line alone is deleted, which is already hash-preserving. Never delete a non-blank neighbour.) This is not cosmetic: deleting the heading alone leaves two adjacent blank lines,
      which the preceding `displayName auto-generation` block then absorbs (its boundary moves from the
      old `##` heading to the next `### Requirement:`), shifting that block's hash
      `480a83208dc4347f` -> `aa3682672fd4e467` and tripping task 10.3's mandated stop on a benign blank
      line. With the blank line removed, all 8 per-block hashes stay byte-identical
      (aggregate `09826a0bc4bc72c9`, matching baseline). The considered alternative — normalizing block
      whitespace before hashing — was rejected in favour of keeping the bytes themselves stable, which
      is the stronger evidence and keeps the diff heading-only.
- [x] 3.4 Confirm visible requirement count now equals total (8/8 and 6/6) and that every 6.1 block hash
      is unchanged for both files — including `displayName auto-generation`, per 3.3's blank-line rule.
      (`shared-inline-error` is unaffected either way: `776c1704b7b85379` before and after.)
- [x] 3.5 **`schema-inference` blocked sub-item — see section 10.** Making all 8 requirements visible
      exposes `### Requirement: InferredSchemaResponse wire format` (spec.md:138), which has zero
      scenarios; the validator requires >= 1 (hard ERROR). Do not resolve this by improvisation.

## 4. Repair Class C — 3 files with no `##` heading at all

`dashboard-create-route-validation`, `dashboard-duplication`, `overlay-management`

- [x] 4.1 For each: prepend `## Purpose` (derived as in 2.2) followed by `## Requirements`, so the bare
      `### Requirement:` blocks fall inside the requirements section. Do not reorder them.

## 5. Repair Class D — 2 remaining files

- [x] 5.1 `resource-metadata`: rename the stray `## MODIFIED Requirements` to `## Requirements` and
      prepend a `## Purpose`.
- [x] 5.2 `user-preference-update`: already has `## Requirements`; prepend a `## Purpose` only.

## 6. Prove nothing was lost

- [x] 6.1 Re-run the 1.2 inventory and diff against the baseline: the ordered requirement names and
      their full-block sha256 MUST be identical for all N files. (Scenarios are inside the block hash by
      design — do not build a second, separate scenario inventory.) Any difference is a defect — stop —
      **except** the single approved `schema-inference` exception of task 10.1, per 10.3. That one
      requirement block in that one file is the entire licensed difference; everywhere else, absolute.
- [x] 6.2 Review `git diff` and confirm every changed line is either a `## `-level heading or part of a
      prepended `## Purpose` block. No `### Requirement:`, `#### Scenario:`, `- **WHEN**` or `- **THEN**`
      line may appear as changed — **in every file except `schema-inference`**, where the single
      human-approved exception of task 10.1 adds exactly one `#### Scenario:` line with its `- **WHEN**`
      and `- **THEN**` bullets to `### Requirement: InferredSchemaResponse wire format`, and 3.3's
      blank-line rule may show one whitespace-only change. That one file, that one requirement, is the
      entire carve-out; everywhere else this rule is absolute.
- [x] 6.3 Confirm `openspec validate --specs` now reports `N passed, 0 failed`, where `N` is the spec
      count recorded in 1.2 (317 at 8432f280). Do not assert a hardcoded number.

## 7. Guard

- [x] 7.1 Add `scripts/check-spec-structure.mjs` enforcing `design.md` decision 3's **set-equality
      invariant**: the requirement-name set seen by the delta parser, the set seen by the validator's
      spec model, and the set of `### Requirement:` lines in the file must all be identical, with zero
      validator ERRORs. Plus the three diagnostic checks: `openspec validate --specs`; no delta-only
      headings; no duplicate requirement names. Print every offending file, then exit 1. Mirror
      `check-openspec-hygiene.mjs`'s convention of `process.exit(2)` if the `openspec` CLI is missing,
      rather than throwing ENOENT or passing silently.
      Implementation note: the validator's `RequirementSchema` is `{ text, scenarios }` and `parseSpec`
      discards titles, so requirement NAMES must be read one level in, via
      `new MarkdownParser(content).parseSections()` then
      `findSection(sections, 'Requirements').children.map(c => c.title.replace(/^Requirement:\s*/, ''))`.
      The `.replace` is REQUIRED, not stylistic: `c.title` carries the `Requirement: ` prefix while the
      delta parser's names do not, so omitting it fails set-equality on every spec in the repo (measured:
      317 of 317) and task 7.5 fails immediately. That is the validator's own
      traversal and reproduces its `getContentUntilNextHeader` scoping faithfully — which is the whole
      point, since that scoping is what diverges from the delta parser's.
- [x] 7.2 Verify the invariant's fidelity against the **unrepaired baseline captured in 1.4**, not
      against the repaired tree — post-repair every file is well-formed, so a vacuous implementation
      would agree on all N. It must reproduce the 25 visible != total files exactly.
- [x] 7.3 Wire it: add `"check:spec-structure"` to `package.json` and invoke it from `.husky/pre-commit`
      as its own line, placed **before** `npm run check:openspec`. `.husky/pre-commit` runs under
      `set -e`, so ordering it after the known-flaky check (HEL-657) would let that check gate this one
      and forfeit decision 2's whole attribution benefit on exactly the commits it exists to serve.
- [x] 7.4 **Prove the guard fails red.** In a temp dir outside the repo, build five malformed fixtures —
      raw delta file; well-formed file with an appended hidden `## ADDED Requirements` section; file
      with its `## Purpose` deleted; file with a stray `## MODIFIED Requirements`; and a **fifth**: a
      requirement placed after a level-1 `#` heading inside the requirements body — visible to the delta
      parser but invisible to the validator, which passes a naive guard and still aborts a real archive.
      Run the guard against each and confirm it exits non-zero and names the file. Record the actual output as evidence.
      A guard only ever observed green is not yet a guard.
- [x] 7.5 Confirm the guard exits 0 against the repaired tree.

## 8. End-to-end proof against real archive

- [x] 8.1 In a sandboxed copy of the tree (outside `openspec/changes/`), construct a throwaway change
      emitting a `MODIFIED` delta against a repaired Class A capability and a `REMOVED` delta against a
      repaired Class B capability, and run a real `openspec archive`. Both MUST succeed. The `REMOVED`
      probe MUST target a Class B capability specifically, and this is load-bearing: a `REMOVED` against
      any single-requirement spec legitimately aborts with `Spec must have at least one requirement`, and
      21 of the repaired specs are single-requirement. Both Class B files are multi-requirement (8 and
      6), so they are the correct probe targets. Do not "simplify" this into a false failure. Assert on
      **stdout** — `Specs updated successfully` present, `Aborted` absent — because archive exits 0 even
      when it aborts. A shell exit-code check here would report green on a failure.
- [x] 8.2 Confirm the repaired capability's requirement text is intact after that archive.

## 9. Gates

- [x] 9.1 `npm run lint`, `npm run format:check`, `npm test` as applicable to the touched files.
- [x] 9.2 `npm run check:openspec` and `npm run check:spec-structure`. If a bypass proves necessary,
      enumerate every gate the bypass skips by running each hook individually, and report it.
- [ ] 9.4 At archive time, hand-write the `## Purpose` for the new `openspec-spec-hygiene` spec rather
      than shipping openspec's `TBD - created by archiving change ...` skeleton. 30+ existing specs carry
      that placeholder so it is not a regression, but leaving it on a spec-hygiene ticket would be a poor
      look. (Phase 3 already greps for this string.)
- [x] 9.3 Delete all probe artifacts and temp fixtures created outside the repo; confirm `git status`
      shows only intended files.

## 10. `schema-inference` scenario-less requirement — RESOLVED (human decision: add-minimal-scenario)

Context in design.md decision 3a. `openspec/specs/schema-inference/spec.md:138`,
`### Requirement: InferredSchemaResponse wire format`, has zero scenarios; the validator requires >= 1
(hard ERROR). It passes today only because the stray heading hides it from the validator, so task 3.3's
repair exposes it. Only such requirement in all N specs.

- [x] 10.1 Append exactly this scenario to that requirement, and nothing else. It restates the
      requirement's existing SHALL sentence verbatim in WHEN/THEN form and asserts no new behavior:

      #### Scenario: Both infer endpoints return the same envelope
      - **WHEN** `POST /api/sources/infer` and `POST /api/data-sources/infer` are each called
      - **THEN** both return the same response envelope
        `{ "fields": [{ "name": string, "displayName": string, "dataType": string, "nullable": boolean }] }`

      The requirement's own SHALL sentence for comparison — the scenario must add nothing beyond it:
      "`POST /api/sources/infer` and `POST /api/data-sources/infer` SHALL both return the same response
      envelope: `{ "fields": [{ "name": string, "displayName": string, "dataType": string, "nullable":
      boolean }] }`."

      If writing this requires inventing any expectation not in that sentence, STOP and escalate — that
      is the option the human explicitly declined, arriving by the back door.
- [x] 10.2 **Prove red-before-green on the real validator**, do not assume:
      (a) with the scenario present, `openspec validate schema-inference --type spec` passes;
      (b) remove the scenario, re-run, and confirm the identical
      `requirements.6.scenarios: Requirement must have at least one scenario` ERROR returns;
      (c) restore it and re-confirm green. Record all three outputs as evidence. A check only ever
      observed green has not been shown to be the thing that made the file pass.
- [x] 10.3 This is the ONLY permitted departure from the verbatim rule. Task 6.1's hash comparison MUST
      show this one requirement block as the single expected difference across all N specs, and every
      other block byte-identical. Any second difference is a defect — stop.
- [x] 10.4 After every class is repaired, re-scan all N specs for any further scenario-less or
      SHALL-less requirement and report it rather than fixing it silently.
