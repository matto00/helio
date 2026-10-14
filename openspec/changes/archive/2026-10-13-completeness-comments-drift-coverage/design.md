## Context

See proposal.md - Why. Premise re-derived on 2026-10-13 against a67f76b95 (after HEL-1535 #989, which only added one
line to `PipelineStepKind.All`'s scaladoc); all six items are still present:

- `PipelineStep.scala:39` is `trait PipelineStep {` (not sealed); `PipelineStepSpec` L12-15 and L128-130 call it
  sealed and its match compile-exhaustive.
- `PipelineStepConfigCodec.encodeConfig(config: Any)` scaladoc says a missing arm "is a compile error"; the HEL-1101
  comment says `upsertsource` is not in `PipelineStep.Registry`, but `PipelineStep.scala:280` registers it.
- `domain/steps/README.md` L21/L58 say 23 step kinds; the `Registry` block holds 27 `->` entries.
- `PipelineShape.scala:39` and `PipelineStepSecondSourceGuardSpec.scala:17` say "single source of truth".
- `findPanelKindEnums` visits only `enum` keys. `panel.schema.json` `oneOf.N.properties.type.const` and
  `create-panel-request.schema.json` `allOf.N.if.properties.type.const` carry all six canonical kinds as consts and
  are invisible to it. `data-source.schema.json` has `$defs.*.properties.type.const` = `text`/`image` (source types,
  not panel kinds, and not grouped under a combinator).
- Coverage keys use the raw `readdirSync(..., {recursive: true})` path, which uses `\` on Windows, while checked
  surfaces are written with `/`.

## Goals / Non-Goals

**Goals:** honest comments to the HEL-1156 standard; const-group detection; separator-free keys; red-first proof.

**Non-Goals:** no `$ref` resolution (a const reached only through `$ref` is not seen; stated in the lib's header
comment); no runtime code change in backend/frontend; no change to the 2-hit threshold.

## Decisions

**D1. Comment standard.** Each rewritten comment: drops the completeness/"single source of truth"/"compile error"
claim, names the layers known today that must change together, and gives a re-derive command (a `git grep` the
reader can run). Every factual sentence in a rewritten comment gets a verification command whose output is recorded
in `comment-verification.md` (in this change dir). Alternative (delete the comments) rejected: the layer lists are
the useful part.

**D2. `PipelineStepSpec` test name.** Rename "pattern-match coverage — sealed-trait dispatch is exhaustive" to a name
that states what it checks at runtime (each listed subtype maps to its kind; an unlisted subtype raises `MatchError`
only if added to `allSubtypes`). The class scaladoc drops "sealed trait". The real Registry parity guard is the
existing "every subtype's kind matches PipelineStepKind.All" test; the comment says so, after the executor confirms
how `PipelineStepKind.All` is derived.

**D3. `PipelineStepConfigCodec`.** `encodeConfig` scaladoc: the match is on `Any`, so a missing arm is a runtime
`IllegalArgumentException` (the `case other` arm), not a compile error; name the guard(s) that do catch it, if any
exist (executor re-derives with `git grep -n "encodeConfig" -- backend/src/test`), else say none does. The
`upsertsource` arm: it IS registered (HEL-1100); the arm stays only if behavior requires it — the executor checks
whether `UpsertSourceStep.companion.encodeConfig` is equivalent to `c.toJson.compactPrint`; if equivalent, switch
the arm to the Registry form like the others and say so in the PR; if not, keep the arm and state why. Either way the
false "NOT in Registry" text goes. The `secondaryDataSourceId` scaladoc's "the 23 `*Config` case classes" (~L105)
is the same stale count and is corrected in the same task (count command, no number).

**D4. Steps README.** Replace the current-tense numbers with count commands; keep HEL-814's "23" only as a
historical figure ("the 23 kinds registered when HEL-814 ran"). Re-derive the "two kinds have no capability spec —
`groupby` and `join`" claim against the 27 kinds and today's `openspec/specs/pipeline-*-op` dirs (excluding
non-op specs such as `pipeline-op-picker-stability`), and correct it; the list likely grows (e.g. `upsertsource`).

**D5. Const groups.** New pure helper `findPanelKindConstGroups(schema, canonicalKinds, minHits)`: walk the tree;
for each array under a `oneOf`/`anyOf`/`allOf` key, collect every string `const` inside each branch with its path
relative to the branch; group by `<combinator path>.*.<relative path>`; a group holding >= `minHits` canonical kinds
is detected, with path `[..., "oneOf", "*", "properties", "type", "const"]`. Nested combinators are visited
recursively; a const group is keyed once by its innermost combinator (no double detection). Coverage error text
says "enum or const group". `check-schema-drift.mjs` feeds both detectors into `validatePanelKindEnumCoverage` (unchanged contract)
and adds two parity surfaces for the two existing groups via a `getConstGroupAt(schema, wildcardPath, file)` helper
that fails loudly if the path resolves to nothing. Both groups compare against `canonicalPanelTypes` (today both hold
all six). Alternative (exempt them) rejected: a kind added to the enum without a `oneOf` branch makes every panel of
that kind fail `oneOf`, which is exactly drift this check exists for.

**D6. Separator.** `enumKey` normalizes `\` to `/` in the file part, so every key path (detected, covered,
exemption) goes through one place.

**D7. Proof.** The red is behavioral, never a module-load error. (a) Before any tooling edit, remove the `"form"`
branch from `panel.schema.json` `oneOf` and record that `node scripts/check-schema-drift.mjs` exits 0 (drift
undetected today); restore and prove it with `git diff --exit-code -- schemas/panels/panel.schema.json`. (b) Add the
self-test cases first with a temporary `findPanelKindConstGroups` stub in the lib that returns `[]` (and `enumKey`
unchanged), so the cases load and print `FAIL <case>` assertion lines; that output goes in `red-evidence.md`. A
`SyntaxError`/missing-export failure does not count as red. Then replace the stub with the real helper. Mutations after the fix, each restored and proven with a per-file `git diff --exit-code`, recorded in the same file:
(m1) make `findPanelKindConstGroups` return `[]` → self-test fails; (m2) the same `"form"` removal as (a)
→ `node scripts/check-schema-drift.mjs` now exits non-zero naming `missing: form`; (m3)
remove the new `panel.schema.json` const surface → the coverage error names that group; (m4) make `enumKey` stop
normalizing → the separator self-test case fails.

## Risks / Trade-offs

- [False positive: a non-panel `oneOf` of `"text"`/`"image"` consts, e.g. a future source-type union inline] →
  the exemption table with a reason handles it; the error message names where to add one.
- [`$ref`-only consts unseen] → stated limit in the lib header; no schema does this for panel kinds today
  (`data-source.schema.json`'s `$defs` consts are source types).

## Planner Notes

- Self-approved: no new dependency, no API change, no architecture change. Low-priority follow-up ticket.
- HEL-1474 (EmbeddedPostgres) is untouched; none of its files are in scope.
