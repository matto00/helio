# Tasks — Group co-versioned dependency families in Dependabot

## 1. Capture the validator failing before the fix

- [x] 1.1 Write `scripts/check-dependabot-groups.mjs` (task 2) **before** editing `.github/dependabot.yml`, run it against the unmodified config, and save the non-zero-exit transcript — it must name `fortawesome` as split/ungrouped. Store it at `openspec/changes/group-co-versioned-dependency-families/evidence/validator-red-precommit.txt`. A validator never seen red is not evidence.

## 2. Validator

- [x] 2.1 `scripts/check-dependabot-groups.mjs`, following the existing `scripts/check-*.mjs` conventions (ESM, exit 0 pass / non-zero fail, human-readable failure naming the offending family and the groups its members resolved to).
- [x] 2.2 Parse `.github/dependabot.yml` with a small purpose-built indentation parser scoped to this file's shape. Do **not** add a YAML dependency and do **not** rely on a transitively-installed `js-yaml`: design.md's gate-chain checklist commits to the script working without `node_modules`, which a linked worktree may not have populated at the root. Export the parser and the assignment function so the selftest can drive them directly.
- [x] 2.3 Embed the declared-families table from design.md Decision 1: `fortawesome`, `echarts`, `redux`, `markdown` (all npm `/frontend`), plus `react` (npm `/frontend`, members `react`, `react-dom`, `@types/react`, `@types/react-dom`) so Decision 2's ordering claim is actually asserted.
- [x] 2.3a Embed a `declaredIndependent` allowlist alongside it, taken verbatim from the independent rows of design.md Decision 1: `react-grid-layout`, `react-router-dom`, `axios`, `lucide-react`, `qrcode.react`, `tslib` (npm `/frontend`), and `react-markdown` (npm `/`).
- [x] 2.4 Implement Dependabot first-match-wins assignment: for each member, walk the update config's groups in declaration order, matching on `patterns` or `dependency-type` (`development`/`production`, resolved against the manifest's `devDependencies`/`dependencies` blocks). First match wins. The glob matcher MUST anchor both ends and treat `*` as the only wildcard — an unanchored or substring matcher could make the check pass for the wrong reason (design.md Decision 2).
- [x] 2.5 Fail when: a family's members resolve to more than one group; any member resolves to no group; or a declared member is absent from the manifest for that config's directory (stale declaration).
- [x] 2.5a Coverage assertion (design.md Decision 3 step 6): enumerate every entry in each configured directory's manifest `dependencies` block and fail unless it is either a declared family member or on the `declaredIndependent` allowlist, naming the unaccounted package. This is the control that would have caught `react-grid-layout`; it is not optional polish.
- [x] 2.6 `scripts/check-dependabot-groups.selftest.mjs`, per the `check-openspec-hygiene.selftest.mjs` convention. Fixture cases, all in memory: (a) ungrouped family → expect fail; (b) family split across two groups → expect fail; (c) catch-all declared before a pattern group, capturing `@types/react*` → expect fail; (d) stale declaration naming an absent package → expect fail; (e) a manifest production package on neither the family table nor the `declaredIndependent` allowlist → expect fail, asserting on the package name; (f) fully grouped, correctly ordered, fully covered → expect pass. Each negative case must assert on the *reason*, not merely on a non-zero exit.

## 3. Configuration

- [x] 3.1 `.github/dependabot.yml`: add `fortawesome`, `echarts`, `redux`, `markdown` groups to the npm `/frontend` config. Every pattern is an **exact package name**; the only wildcard anywhere is the existing `@types/react*`. The `react` group's pattern stays `react` — never `react*`, which would swallow `react-dom`, `react-redux`, `react-markdown`, `react-router-dom` and `react-grid-layout` into the first-declared group (design.md Decision 2).
- [x] 3.2 Reorder groups in both npm configs so pattern-based groups precede the `dev-dependencies` catch-all (design.md Decision 2). Add a brief comment stating the first-match-wins reason, so a future editor does not "tidy" the order back.
- [x] 3.3 Raise `open-pull-requests-limit` to `15` for the npm `/frontend` config only. Leave the other three at `10` (design.md Decision 4).
- [x] 3.4 Verify no version, manifest, or lockfile change is included: `git diff --stat` must not list `package.json` dependency blocks, `package-lock.json`, or `build.sbt`.

## 4. Wiring

- [x] 4.1 Add `"check:dependabot": "node scripts/check-dependabot-groups.mjs"` and `"check:dependabot:selftest": "node scripts/check-dependabot-groups.selftest.mjs"` to root `package.json` scripts. Scripts block only — no dependency additions.
- [x] 4.2 Add both to `.husky/pre-commit`, alongside the existing `check:*` entries.
- [x] 4.3 Add both to the `frontend` job in `.github/workflows/ci.yml`, after `format:check`.
- [x] 4.4 Gate-chain evidence (CON-132): run `scripts/concertino/test-gate-in-isolation.sh` for the new pre-commit entry and save the transcript to `openspec/changes/group-co-versioned-dependency-families/evidence/`. The design.md `Gate-Chain Implications Checklist` is already written.

## 5. Answer the FontAwesome compatibility question deterministically

- [x] 5.1 Local probe for acceptance criterion 2 (design.md Decision 6). Install the four packages at matching versions **without writing the manifest or lockfile** — the recipe is exact, because the ordinary `npm install` would write both and violate this change's own Non-Goal:

      npm --prefix frontend install --no-save --no-package-lock \
        @fortawesome/fontawesome-svg-core@7.3.1 \
        @fortawesome/free-solid-svg-icons@7.3.1 \
        @fortawesome/free-brands-svg-icons@7.3.1 \
        @fortawesome/react-fontawesome@3.5.0

  Then run `npm run typecheck`. Record the full transcript, including the resolved installed versions (`npm --prefix frontend ls @fortawesome/fontawesome-svg-core @fortawesome/free-solid-svg-icons @fortawesome/free-brands-svg-icons @fortawesome/react-fontawesome`), to `openspec/changes/group-co-versioned-dependency-families/evidence/fontawesome-matching-versions-typecheck.txt`, so the result is attributable to a known version set rather than to an assumed one.
- [x] 5.2 State the outcome plainly: either the family typechecks clean at matching versions (so the split was the entire problem), or it fails with a genuine incompatibility (so 7.3.1 really does break us and that gets reported). Do not soften whichever it is.
- [x] 5.3 **Restore the tree before any section-6 gate runs**: `npm --prefix frontend ci`. The probe mutates `frontend/node_modules`; a `typecheck` or `lint` run afterwards against the mutated tree would be certifying a dependency set nobody is shipping. This step is what keeps section 6's evidence about the actual change.
- [x] 5.4 Confirm the probe left no trace: `git status --short` shows no change to `frontend/package.json` or `frontend/package-lock.json`, and `git diff --stat` is empty for those paths.

## 6. Verification

- [x] 6.1 `npm run check:dependabot` exits zero against the fixed config.
- [x] 6.2 `npm run check:dependabot:selftest` exits zero, and its output **names each of the six fixture cases** (a)-(f) from task 2.6 individually as it evaluates them. A summary line asserting a pass count does not satisfy this — case (f) is CR3's coverage control, and a count-only assertion would accept a selftest that silently skipped it.
- [x] 6.3 Re-run the task 1.1 command against the fixed config and confirm it now passes — the same command, red before and green after, is the failable pair.
- [x] 6.4 `npm run lint`, `npm run typecheck`, `npm run format:check` pass.
- [x] 6.5 Do not run `concertino sync`. Do not touch `e2e/hel813-mobile-touch-target-floor.spec.ts` or its support files. Do not touch `dependabot-auto-merge.yml` or `dependabot-metadata.yml` (design.md Decision 5). Do not run database migrations or reseed — this change needs no database.

## 7. Post-merge (orchestrator, not executor)

- [ ] 7.1 Trigger a real Dependabot run: `@dependabot recreate` on one FontAwesome PR; confirm the four collapse into one grouped PR (design.md Decision 6). If that does not regroup, close the four and state that the next scheduled run is the fallback.
- [ ] 7.2 Record the grouped PR's `frontend` result and check it against task 5.1's local probe. If they disagree, the disagreement is the finding and must be reported, not reconciled away.
- [ ] 7.3 Leave every open Dependabot PR in a stated condition: merged, closed as superseded, or deliberately pending.
- [ ] 7.4 Post the confirmed `ci-complete` ruleset evidence to HEL-874.
