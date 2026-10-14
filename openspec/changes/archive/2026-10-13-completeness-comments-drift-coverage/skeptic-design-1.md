## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD a67f76b9527ec9ec6aebde9077fdf9dc2caea097 (only the untracked change dir differs from it).

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` gave `READY ambient=/home/matt/Development/helio branch=task/completeness-comments-drift-coverage/hel-1467`.
- HEL-1535 (#989, d16e58d7e) fixed none of items 1-5: `git show --stat d16e58d7e` lists one file changed, `PipelineStep.scala`, `1 +`. None of the five comment sites and no drift-lib file are in that commit.
- Item 1 is still present. `PipelineStep.scala:39` is `trait PipelineStep {` and is not sealed. The `PipelineStepSpec` scaladoc (L11-14) says "PipelineStep sealed trait". The test at L128-130 says "sealed-trait dispatch is exhaustive ... fails compilation". The match has no default arm and the trait is not sealed, so the compiler cannot check it; an unlisted subtype gives a runtime `MatchError`. The real guard D2 relies on exists: `PipelineStepKind.All` is `PipelineStep.Registry.keySet` (PipelineStep.scala:374), so the "every subtype's kind matches PipelineStepKind.All" test fails when a kind is registered but missing from `allSubtypes`.
- Item 2 is still present. The `encodeConfig(config: Any)` scaladoc (L44-48) says a missing arm "is a compile error". The HEL-1101 comment (L72-78) says `upsertsource` is "deliberately NOT in PipelineStep.Registry yet", but `PipelineStep.scala` registers `UpsertSourceStep.Kind -> UpsertSourceStep.companion`. `UpsertSourceStep.scala:69` encodes with `config.asInstanceOf[UpsertSourceConfig].toJson.compactPrint`, which matches the codec's special arm, so D3's switch option is viable.
- Item 3 is still present. README L21 and L58 say 23 kinds. An awk count over the `val Registry` block finds 27 `->` entries.
- Items 4 and 5 are still present: "Single source of truth" at `PipelineShape.scala:39`, and "the single source of truth every op is registered in" at `PipelineStepSecondSourceGuardSpec.scala:17`.
- Item 6 is still present. `findPanelKindEnums` visits only `enum` keys. `enumKey` is a raw `${file}#...`, and `file` comes from `readdirSync(schemasDir, {recursive:true})` (check-schema-drift.mjs:132), so it uses the OS separator.
- I listed every string `const` under a combinator in `schemas/` (a node walk over every `.json`). There are exactly two panel-kind groups, `panels/panel.schema.json oneOf.0-5.properties.type.const` and `panels/create-panel-request.schema.json allOf.0-5.if.properties.type.const`, and each holds all six canonical kinds (`PanelType.fromString` at model.scala:151-156: text, markdown, image, divider, output, form). The only other combinator consts are `create` and `pipelineStep` in `patch-sets/patch-set.schema.json`, which are not panel kinds. This matches design.md's Context.
- The spec delta's MODIFIED requirement title matches the base spec `openspec/specs/schema-drift-panel-kind-coverage/spec.md` word for word.
- The self-test harness, `scripts/check-schema-drift.selftest.mjs` L19-23, statically imports named exports from `./lib/panelKindEnumCoverage.mjs`. It runs in CI at `.github/workflows/ci.yml:140`.
- `compareSets` prints `missing: <kind>`, so the output D7 m2 expects is reachable once a const surface is wired into the parity loop.

### Verdict: REFUTE

### Change Requests

1. **The red-first proof (AC5, D7, task 2.1, C2) as planned would be red for the wrong reason.** Task 2.1 adds self-test cases that call `findPanelKindConstGroups` and runs them "against the unmodified lib". The self-test imports statically (`import { ... } from "./lib/panelKindEnumCoverage.mjs"`, L19-23). A missing named export is an ESM link-time `SyntaxError`, so the whole file fails to load before any `check(...)` runs. That red shows only that the export is missing. It does not show that the coverage gap exists. Revise D7 and task 2.1 so the red evidence is behavioral:
   - (a) **End-to-end red on the unmodified tree:** remove the `"form"` branch from `panel.schema.json` `oneOf` (m2) before any lib or script change, then record that `node scripts/check-schema-drift.mjs` **exits 0**. That is the drift going undetected today. Restore the schema, and record the same mutation exiting non-zero with `missing: form` after the fix.
   - (b) For the new-helper unit cases, get a behavioral red. One way is a placeholder `findPanelKindConstGroups` that returns `[]`, committed to nothing and used only for the red run. Another is to write the separator and "unchecked const group errors" cases against the existing `validatePanelKindEnumCoverage`/`enumKey` API, which already exists and will fail on assertions. The recorded red output must show `FAIL <case>` assertion lines, not a module-load error.
   - State in red-evidence.md which cases were red, and why each was red.
2. **The proposal contradicts design D3.** proposal.md Non-goals says "comment and test-name edits only on the Scala side". D3 lets the executor switch the `upsertsource` arm in `PipelineStepConfigCodec.encodeConfig` to the Registry form, which is a code change even if it preserves behavior. Make them agree: either allow the behavior-preserving arm switch in the proposal (and name the spec that proves equivalence, e.g. the `PipelineStepConfigCodecSpec` "round-trip through encodeConfig for every typed config" case at L397), or drop the switch from D3.
3. **The plan leaves a stale count in a file it edits.** `PipelineStepConfigCodec.scala:105` says "the 23 `*Config` case classes", but 27 kinds are registered. This is the same false-count defect as item 3, in the same file as item 2. Under AC1's standard it should become a count command or an explicitly historical figure. Add it to task 1.2 and to comment-verification.md, or record in design.md, with a reason, why it is left out.

### Non-blocking notes

- D5 nested combinators: an outer group collects consts from inner combinators with relative paths that contain `oneOf.N`, and the inner group detects them separately. That can give two detections for one logical group. Nothing in `schemas/` triggers this today. Consider a self-test case that pins the intended behavior, or say in the lib header that it is a known limit.
- `validatePanelKindEnumCoverage`'s error text says "holds a panel-kind enum". For a const group, "enum or const group" reads better, and the spec delta already uses that wording.
- D4: when re-deriving the "no capability spec" kinds, note that `openspec/specs/` now holds 27 `pipeline-*-op`-style dirs, including `pipeline-op-picker-stability`, which is not an op spec. Filter it out explicitly. The re-derived list will probably no longer be just `groupby` and `join` (for example, there appears to be no `pipeline-upsertsource-op`).
- After each m1-m4 mutation, run `git diff --exit-code -- <file>` per file as the restore proof, not only a whole-tree `git diff`.
