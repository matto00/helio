## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **D1 mapping is exact.** Parsed the D1 bullet list programmatically and diffed against
  `ls schemas/*.schema.json`: 76 listed, 76 on disk, **0 duplicates, 0 omissions, 0 phantom
  entries**, and every per-domain declared count matches the number of names listed under it.
  This is the cleanest part of the plan.
- **D2 is accurate.** `grep -n "readdirSync(schemasDir" scripts/check-schema-drift.mjs` →
  `108:for (const file of readdirSync(schemasDir).sort()) {`. Flat, exactly as claimed; the
  `recursive: true` fix works because Node returns `schemasDir`-relative paths (the same
  option is already used at line ~78 for `protocolsDir`, so the idiom is proven in-file).
- **D3 is accurate.** The 4 hardcoded reads are at lines 231/240/249/258 for
  create-panel-request / panel / update-panels-batch-request / dashboard-proposal — matching
  D3's list and its proposed new subpaths (which agree with D1's domains).
- **Gate-chain claim is accurate.** `.husky/pre-commit:8` runs `npm run check:schemas`;
  `package.json:13` → `node scripts/check-schema-drift.mjs`. The Gate-Chain Implications
  Checklist is present and answers all five CON-132 questions; I read the script source and
  each answer (read-only, no subprocess/network, stdout+exit-code only, `import.meta.url`-
  relative path resolution so worktree-safe) is true of the real source.
- **D5 is accurate.** All 4 `JsonSchemaValidation.compile(...)` call sites exist at the cited
  file:line. `JsonSchemaValidation.schemaFile` does take a caller-supplied relative path
  (`new File(dir, s"schemas/$relativePath")`), so D5's "no change inside the harness" holds.
- **Cross-file `$ref` inventory (design's Context section) is wrong** — see CR3.
- **`development-plan.md` does not exist as a tracked file** — see CR4. Reproduced twice
  (`find -maxdepth 1`, `git ls-files`), plus `git check-ignore -v` in the main checkout.
- **`openspec validate` no-delta precedent:** the precedent is real —
  `openspec/changes/archive/2026-08-22-repackage-backend-domain-subpackages/proposal.md:49`
  states "**Therefore `openspec validate` reports 'Change must have at least one delta' —
  expected, not a defect.**", and its `skeptic-design-4.md:77` records the actual error output.
  **However, design.md/proposal.md here make no such claim and cite no precedent** — the
  string "precedent" and the archive change name appear nowhere in this change's artifacts.
  See CR5. (`node scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`; the `openspec`
  CLI itself is not installed in this worktree, so I could not run `validate` directly.)

### Verdict: REFUTE

### Change Requests

1. **D4's bare-relative rewrite rule is wrong for cross-domain refs and will produce broken
   `$ref`s.** D4 says rewrite a bare relative ref "to the new `<domain>/<file>.schema.json`".
   Relative `$ref` resolution is against the *referring* document's location, so from
   `schemas/authoring/authoring-conversation.schema.json` a ref of
   `"dashboards/dashboard-proposal.schema.json"` resolves to
   `schemas/authoring/dashboards/dashboard-proposal.schema.json` — nonexistent. The correct
   value is `"../dashboards/dashboard-proposal.schema.json"`. Real affected refs (measured):
   - `authoring-conversation` → `dashboard-proposal` (dashboards/), `patch-set` (patch-sets/)
   - `combined-proposal` → `dashboard-proposal` (dashboards/), `pipeline-proposal` (pipelines/)
   - `dashboard-authoring-response` → `dashboard-proposal` (dashboards/)
   - `refinement-response` → `patch-set` (patch-sets/)
   Same-domain refs (e.g. `update-dashboard-request` → `dashboard-appearance`, the 9
   `panel.schema.json#/$defs/*` refs from `create-panel-request`) stay bare and must NOT be
   prefixed. Restate D4 to compute a POSIX-relative path from the referrer's new directory to
   the target's new directory (`path.posix.relative`, prefixing `./` or `../` as needed).
   **Also fix the D4 risk mitigation**: it greps for "any remaining single-segment (no `/`)
   filename" as the leftover-flat-ref tripwire — that check is structurally blind to exactly
   this bug class (the wrong value `dashboards/…` *does* contain `/` and passes the grep) and
   would also false-positive on the legitimately-unchanged same-domain refs. Replace it with a
   resolution check: for every cross-file `$ref`, `path.resolve(dirname(referrer), refPath)`
   must exist on disk.

2. **D4 omits `$id` — the absolute-ref half of the plan does not work without it.** All 76
   schemas carry `"$id": "https://helio.local/schemas/<file>.schema.json"` (verified:
   `grep -l '"\$id"' schemas/*.json | wc -l` → 76). D4 rewrites the 11 absolute refs to
   `https://helio.local/schemas/<domain>/<file>.schema.json`, but nothing in the design updates
   the *targets'* `$id`s, so no document will ever declare that identifier and `$id`-based
   resolution (networknt in `JsonSchemaValidation`, and any ajv-style loader) fails. Decide and
   state explicitly one of: (a) rewrite both `$id` and absolute `$ref` to the nested form
   (recommended, keeps `$id` mirroring on-disk layout), or (b) leave `$id` and all absolute
   `$ref`s flat/unchanged (they are opaque URIs, not paths) and rewrite only bare relative refs.
   Whichever is chosen, add it to `tasks.md` 1.2 and to the verification step.

3. **The Context section's `$ref` inventory is materially understated.** design.md says "both
   classes exist today across 8 files with 22 total cross-references". Measured on the live
   tree: **17 files, 35 cross-file `$ref` occurrences** (24 bare-relative incl. 9 with `#/$defs`
   fragments, 11 `https://helio.local/…` absolute). Correct these numbers — an executor sizing
   the D4 rewrite against "8 files / 22 refs" has a wrong completeness target.

4. **D7 / tasks.md 2.2 / the ticket AC reference a file that is not in the repository.**
   `development-plan.md` is absent from this worktree and untracked
   (`git ls-files` returns nothing; in the main checkout `git check-ignore -v development-plan.md`
   → `.git/info/exclude:7:development-plan.md`). It is a *local, deliberately-excluded* file, so
   `git mv development-plan.md notes/development-plan.md` will fail and no commit can deliver
   this move. Restate D7 (and tasks 2.2, and the corresponding ticket AC bullet) to record this
   ground truth — Part 2 reduces to `git mv orchestration-flow.html notes/orchestration-flow.html`
   plus the inbound-link grep. Do not silently drop the AC; state why it is unachievable, the
   same way the restated Part-1 scope documents its drift.

5. **Pre-empt the `openspec validate` no-delta error in proposal.md.** This change has zero spec
   deltas by design (Planner Notes), which is the same situation as
   `2026-08-22-repackage-backend-domain-subpackages`. That change's `proposal.md:49` explicitly
   pre-empts `✗ [ERROR] file: Change must have at least one delta` as "expected, not a defect",
   which is what kept its later gates from reading it as a failure. Add the equivalent sentence
   here so the evaluator/skeptic-final chain does not re-litigate it.

### Non-blocking notes

- `proposal.md` "What Changes" says the drift script's "`$ref` resolution" must be rewritten;
  the script performs **no** `$ref` resolution at all (design.md D2 states this correctly). Minor
  proposal↔design contradiction — align the proposal wording to "file discovery + 4 hardcoded
  paths" to avoid the executor hunting for resolution logic that doesn't exist.
- `scripts/concertino/` is absent from this worktree; I ran `next-report-number.sh` /
  `persist-evidence.sh` from the main checkout. Not a blocker for this gate, but the evaluator's
  `assert-phase.sh` calls will need the same treatment.
- D2's added raw-file-count `console.log` is a genuinely good tripwire against the silent
  zero-file pass; keep it, and have tasks 1.4 paste that literal line as evidence (it already does).
