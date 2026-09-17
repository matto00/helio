## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### Headline

Round 3's CR1 and CR2 are **genuinely fixed** — not re-worded. Round 3's CR3 is **80% fixed**:
D9 exists, task 1.9 requires the tolerant arm, task 4.9 proves it, and a spec scenario makes
read-tolerance observable — but the revision introduced a contradiction between tasks 1.2, 1.9
and 4.9 about *where strictness lives*, such that no single implementation satisfies all three.
That is CR1 below, and it is the round-4 self-inflicted defect the planner predicted. A second,
cheaper self-inflicted defect (CR2) is the `types only` claim the CR2 fix made false in two
places.

**No individual change request has survived two rounds of believed fixes.** But the strict/tolerant
seam has now been in front of this gate twice (round 3 CR3, round 4 CR1). If round 5 does not
close it cleanly, it should go to the human rather than a round 6.

### What I verified (with evidence)

**Authority record, read myself, not relayed.** `cat .concertino/runs/HEL-1083/answer.json`:
`subAnswers` = `jsonb-column`, `reference-declared-field`, `add-to-proposal-surfaces`,
`"complete": true`. D1/D3/D7 implement those three faithfully. Not relitigated; the three
rulings are treated as settled.

**Round-3 CR1 (two declarations of the CLOSED attribute set) — FIXED.** The three enumerations
now AGREE:
- `design.md:50-51` (D3): `{sourceField, control, label?, placeholder?, helpText?, required?,
  initialValue?, step?, options?}`
- `design.md:156-157` (Planner Notes): `label`/`placeholder`/`helpText`/`required`/
  `initialValue`/`step`/`options`, CLOSED and 400-enforced, with the self-approval restated as
  "makes HEL-1088's counter a CONFIGURATION rather than a delta"
- `specs/form-panel-type/spec.md:50-52`: same seven, declared CLOSED
- `tasks.md` 1.2 requires `step` in `FormFieldSpec`; 4.1 pins the unrecognized-attribute
  rejection; 4.1b pins the `step` PATCH round-trip

The executor can no longer build a set that rejects `step`. Note it is still declared in THREE
places rather than one — they agree today, and this same duplication produced a finding in
rounds 2, 3 AND 4. That structural fix is polish note (a).

**Round-3 CR2 (`PanelContent.tsx` fallthrough) — FIXED, and option (b) is the right call
because the fallthrough is genuinely reachable. I proved reachability from source, not from
D10's narrative:**
- `panelNarrowing.ts`: `getOutputId(panel)` returns `null` for any non-output panel.
- `usePanelData.ts:44-45`: `const outputId = getOutputId(panel); const currentFetchKey =
  outputId ? panel.id + "|" + outputId : null;`
- `usePanelData.ts:105-118`: `if (!currentFetchKey)` returns `{ isLoading: false, error: null,
  noData: false, ... }` — so a form panel short-circuits every guard clause in `PanelContent`
  (`isLoading` :235, `error` :246, `noData && neverMaterialized` :264, `noData` :288).
- `PanelContent.tsx:297-316`: five type guards, none matching `form`; `:318-319` falls to
  `// Exhaustiveness fallback — the union is closed so this is unreachable.` →
  `return <MetricRenderer data={data} />` with `data` always `null` (`usePanelData` returns
  `data: null` on both branches).
- `MetricRenderer.tsx:60-76` then renders `<div className="panel-content panel-content--metric">`
  with `--` and the literal `No data`.

So a `form` panel on a real dashboard today renders a broken metric card. D10's "live wrong
render rather than a deferrable gap" is accurate, and the in-scope decision is justified rather
than scope creep.

**Task 4.10 can genuinely fail.** `tsc` cannot catch this (if-chain, C10 — confirmed), but the
red is discriminable: removing the 3.4 branch makes `.panel-content--metric` / `No data` appear
instead of the placeholder, both assertable via RTL. Contrast `mobilePanelHeights.ts:83-95`,
which IS an exhaustive `switch` with no `default` returning a non-nullable
`MobilePanelHeightPolicy` — adding `form` to `PanelKind` there DOES hard-fail `tsc`, so task
3.2's stated verification is also sound. The asymmetry the plan draws between the two sites is
real.

**No HEL-1085 encroachment.** 3.4 adds one branch returning a neutral `panel-content--state`
placeholder — the class already exists (`PanelContent.tsx:207`, `:240`, `:270`, `:290`), so no
CSS and no new component. D10 states "The real form UI stays HEL-1085's." Bounded correctly.

**Round-3 CR3 (strict/tolerant seam) — PARTIALLY fixed; see CR1.** What IS fixed: D9 exists and
scopes the 400 to the write path; task 1.9 requires catch/log/`Empty` and "never propagate a
500"; task 4.9 proves it by direct JSONB insert re-read through `findByIdInternal`;
`spec.md:160-162` makes read-tolerance an observable contract. D9's two obligations do **not**
contradict C8: C8 is per-attribute on the WRITE path (an attribute the caller just supplied is
never dropped), while D9's fallback is a whole-config failure on the READ path that degrades to
a *visibly unconfigured* panel with a logged warning. Those are genuinely different obligations
and the spec scenario makes the second one observable rather than silent. Coherent. The defect
is purely in where the plan puts the strictness — CR1.

**Renumbering audit (asked for explicitly).** Section 4 ids: 4.1, 4.1b, 4.2, 4.3a, 4.3b, 4.4,
4.5, 4.6, 4.6b, 4.7, 4.8, 4.9, 4.10, 4.11 — no duplicate, no dangling. Every cross-reference
resolves: 4.7 → 4.3a/4.3b/4.4 (all exist); C11 → 1.9 + 4.9 (both exist, both carry the stated
content); D10 → 3.4; task 1.2 → 1.9; Risks → C4. No artifact references a plain "4.3". C1–C11 in
`workflow-state.md` CONSTRAINTS match the tasks.md mirror one-for-one, C1 `retired:true` matches
"RETIRED", and Planner Notes' "C1–C5 at Planning, C6–C11 promoted by the design gate" matches
`CONSTRAINT_REVIEWS`. Round 3's stale-`C1–C5` note is closed (`design.md:162`).

**Round-3 non-blocking notes actioned, verified individually.** `output_id` attribution is now
"HEL-909's follow-up to HEL-296" (`design.md:12`) ✓. `proposal.md:42` says "the four
kind-enum-bearing files under `schemas/panels/`" ✓ (the separate "five JSON schemas" at
`proposal.md:20` is NOT stale — four panels schemas plus `dashboard-proposal.schema.json` = five,
matching tasks 2.1–2.4). Task 2.3 now carries the no-drift-surface warning ✓. Task 4.3b's
`findByIdInternal` no-ACL caveat remains correctly test-scoped ✓.

**Budgets.** `design.md` 162 lines vs the 150 in `openspec/config.yaml:48` — see ruling (a)
below. `proposal.md` 68 ≤ 80 ✓, `tasks.md` 59 ≤ 80 ✓, one line per task ✓. I grepped
`check-openspec-hygiene.mjs` / `check-spec-structure.mjs` for any line-count budget and found
none, which matches the planner's empirical measurement.

No mtime-ordering or positional evidence was relied on anywhere in this report; every finding
cites file:line content I read this round. No report I drilled into disclosed unsound evidence
mtimes, so there is no gate defect of that family to record.

### Verdict: REFUTE

Two change requests, both self-inflicted by round 3's fixes, both cheap. Neither reopens an
owner ruling, neither undoes an earlier fix, and the plan's overall shape is sound and
materially better than at round 1.

### Change Requests

**1. [blocking-for-correctness] Tasks 1.2, 1.9 and 4.9 cannot all be satisfied by one
implementation — the CR3 fix put the strictness in a place that makes its own test
unachievable.** Task 1.2 says "the 400-on-unrecognized-attribute rule is a WRITE-PATH rule
belonging to `decodeCreate`/`Patch.decode` (**NOT to a bare `decode` the row mapper reuses** —
see 1.9)". Task 1.9 says the mapper's arm must "**catch a strict decode failure**, log a warning
… and fall back to `FormPanelConfig.Empty`". Task 4.9 asserts a directly-inserted row carrying an
unrecognized attribute "decodes to `FormPanelConfig.Empty` with a logged warning". Trace the two
readings:
- If bare `decode` does not reject unrecognized attributes (1.2's parenthetical read literally),
  there is **no failure for 1.9 to catch**, the row decodes as a valid-looking config with the
  attribute silently discarded, and **task 4.9 fails** — while producing exactly the
  silent-per-attribute drop C8 forbids, on the read path.
- If bare `decode` does reject (what 1.9 and 4.9 require), then **1.2's own parenthetical is
  false**.

D9's prose is closer to correct than task 1.2 is ("MUST NOT reuse that strict failure: it catches
it" presupposes `decode` raises), so the defect is localized and the layering is one sentence
away. Fix by naming three layers explicitly, in task 1.2 and mirrored in D9: (i) `decode` is
**strict** — an unrecognized field attribute is a decode failure, raised as a plain decode error,
not an HTTP concern; (ii) `decodeCreate`/`Patch.decode` are the only callers that **map that
failure to a 400** — that mapping, not the strictness, is the write-path rule; (iii)
`PanelRowMapper.rowToDomain`'s `form` arm calls `decode` inside a catch and falls back to
`FormPanelConfig.Empty` with a logged warning. Then amend 4.9 to assert against (iii) explicitly
(`Empty` + warning + no exception), which it already does, and it becomes achievable. Without
this the executor must guess, and one of the two guesses ships a silent read-path attribute drop.

**2. [blocking-for-correctness, cheap] The CR2 fix made "types only" false in two places, and
`PanelContent.tsx` is absent from the Impact list.** `proposal.md:47-48` reads "Frontend:
`features/panels/types/panel.ts`, `state/panelNarrowing.ts`, `ui/grid/mobilePanelHeights.ts`
(**types only — no new components**)", and `tasks.md`'s section-3 heading is "### 3. Frontend —
**types only, no components**". Task 3.4 now edits `PanelContent.tsx` — a render branch and a
comment correction, not a type — and that file appears in no Impact list. Two consequences, both
real: the final gate diffs `files-modified.md` against this Impact list, so an unlisted edited
file reads as scope creep at exactly the gate least able to re-derive the justification; and the
section heading tells the executor 3.4 is out of family with its own group. Fix: add
`ui/PanelContent.tsx` to proposal.md's Frontend impact list, change the parenthetical to
something true (e.g. "types plus one renderer-dispatch branch — no new components", which
remains accurate), and retitle tasks.md §3 to match (e.g. "Frontend — types and one dispatch
branch"). `design.md:21-22` already states this correctly ("no form rendering beyond the neutral
placeholder D10 requires"), so only these two places are stale.

### Rulings requested by the planner

**(a) The 162-vs-150 line overage — [polish]. The disclosure was the right call; the judgement
that it is advisory is not quite right, but the remedy is cheap and I am naming the cut rather
than leaving you a stalemate.** `openspec/config.yaml` states "Maximum 150 lines" as a rule, and
I confirm no gate enforces it (no line budget in `check-openspec-hygiene.mjs` or
`check-spec-structure.mjs`), so this cannot break delivery. Do **not** cut D9, D10, the corrected
Planner Notes or the C9 register — all four are gate-mandated. Four genuinely redundant places,
~12 lines, in priority order:
1. **Planner Notes' re-enumeration of the attribute set (`:156-157`)** — replace the seven-item
   list with "the `FormFieldSpec` attribute set defined in D3 (closed, 400-enforced)". This saves
   two lines AND removes the duplicate declaration that produced a finding in three consecutive
   rounds. Highest value cut in the document.
2. **D7 (`:88-102`, 15 lines)** restates proposal.md's Non-goals paragraph and C6 almost verbatim.
   Keep the ruling, the `buildNonDataConfig`/`mergeConfig` mechanism and the "no silent
   drop/repair" sentence; replace the tracking/prompt-copy narration with a pointer to
   proposal.md and C6. ~5 lines.
3. **D2's four-policy enumeration (`:45-47`)** — the decision is "no policy change is needed";
   the full V36 policy inventory is round-1 CR4's evidence, not a decision, and now lives in
   skeptic-design-1/2. ~2 lines.
4. **Context's closing sentence (`:12-14`)** — the snapshot-wire and `DatasetFieldDeclaration`
   facts are both restated where they are used (D3 / the round-trip reasoning). ~2 lines.

**(b) Diff-read for self-inflicted contradictions — done, and it found two (CR1, CR2 above).**
Everything else I checked held: no renumbering casualty, no dangling or duplicated task id, no
constraint-mirror drift, no claim a revision made stale beyond CR2's two, and the Planner Notes /
D3 / spec attribute sets now agree. Your prediction about the failure mode was correct — both
findings this round are revisions' own byproducts, not original planning gaps.

### Non-blocking notes

- **The closed attribute set is still declared three times** (D3, Planner Notes, spec.md). They
  agree today. Rounds 2, 3 and 4 each produced a finding rooted in this duplication, so the
  durable fix is one normative definition (the spec requirement) with D3 and Planner Notes
  referencing it. Ruling (a)(1) does half of this for free.
- **D10/task 3.4 cite `PanelContent.tsx:295-319`; the dispatcher is `:296-319`** (`:295` is
  blank, `:296` is the `// Dispatcher:` comment, `:297-316` the guards, `:318-319` the fallback).
  Task 3.4's `~` softens it. Cosmetic.
- **The new placeholder's a11y attributes are unspecified.** Sibling states use `role="status"`
  (`:270`) or nothing (`:290`). One clause in 3.4 picking one avoids HEL-1090 inheriting an
  arbitrary choice — or state explicitly that the placeholder's a11y is HEL-1090's to audit.
- **Nothing forecloses the downstream tickets**, re-checked individually: `step` is a
  configuration and `min`/`max` an additive delta (HEL-1088); the author-time schema-consistency
  check is explicitly left to HEL-1084; `file` persists without upload semantics (HEL-1086);
  `submit` is an object so submit-time concerns can be added without a wire break (HEL-1087); the
  placeholder is explicitly HEL-1085's to replace.
