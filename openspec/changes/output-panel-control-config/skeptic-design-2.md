## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md` (150 lines, `wc -l` = 150 — at, not
  over, the 150-line budget), `tasks.md`, and both spec deltas
  (`specs/output-panel-placement/spec.md`, `specs/output-panel-controls-editor/spec.md`)
  fresh, from the current worktree state — not from the executor's summary.
- Round 1 CR1 (D4/D5 contradiction): confirmed fixed. Read
  `backend/src/main/scala/com/helio/domain/panels/FormSchemaConsistency.scala` — its
  `check()` unconditionally re-validates every `config.fields` entry on every call, with
  no per-field skip, confirming the round-1 finding that literally mirroring
  `rejectInconsistentForm`'s "no skip-unchanged shortcut" shape would indeed re-reject an
  already-orphaned control on every future unrelated write. D4's revised text now states
  the corrected id-diff rule precisely (new-or-changed only; unchanged/orphaned entries
  carry forward unexamined), and D5 cross-references it. Requirement 2's new third
  scenario ("An untouched, already-orphaned control does not block an unrelated save") in
  `specs/output-panel-placement/spec.md` matches this rule exactly and is consistent with
  Requirement 3 (drift/orphan) below it — orphan is read-time-only, write-time rejection
  is scoped to entries that are themselves new/rebound/kind-changed.
- Verified D4's "the PATCH path... already holds the pre-patch persisted config to diff
  against" claim against the actual code, not just the prose: read
  `backend/src/main/scala/com/helio/services/panels/PanelService.scala`'s `update()`
  (fetches `existing` via `panelRepo.findByIdInternal(panelId)` *before* computing
  `resolvePatch`/validation, mirroring exactly how `effectiveFormConfig(existing, spec)`
  is already used for `rejectInconsistentForm`) and
  `backend/src/main/scala/com/helio/services/panels/PanelPatchApplier.scala` (`applyConfig`
  also re-fetches the pre-patch panel via `findByIdInternal` before calling
  `PanelConfigCodec.applyConfigPatch`). Both give `rejectInvalidControls` a real,
  pre-patch persisted `OutputPanelConfig.controls` list to id-diff against at the point
  the design says it runs. This claim holds.
- Round 1 CR2 (`defaultValue` wire shape): confirmed fixed and internally consistent.
  Grepped every `defaultValue` reference across `design.md`, both spec deltas, `tasks.md`,
  `proposal.md` — D2's per-kind shape (`text`/`dropdown` → string; `numeric-range` →
  `{"min","max"}`; `date-range` → `{"from","to"}`, both nullable) is stated once and
  referenced consistently everywhere else it's touched (D7, Requirement 1 of
  `output-panel-placement`). No contradiction found.
- Ran `openspec validate output-panel-control-config --type change` myself (not just
  trusting the executor's re-run): `Change 'output-panel-control-config' is valid`.
- Confirmed V112 is still free: `ls backend/src/main/resources/db/migration/ | grep
  'V11[0-9]__'` shows only `V110` and `V111` present.

### New finding (not present in round 1, surfaced by this round's D2/D4 revision)

D2 defines `OutputControlSpec(id: String, kind: String, column: String, label: String,
defaultValue: Option[JsValue])` — `id` is a **non-optional** `String`, and D2 states the
type "mirrors `FormFieldSpec`'s closed-set/strict-decode shape," explicitly diverging from
`FormFieldSpec` specifically *because* `FormFieldSpec` has no `id` concept. I checked the
actual precedent this claims to follow:
`backend/src/main/scala/com/helio/domain/panels/FormPanel.scala` line 273:
`FormPanelConfig.Patch(fields: Option[Vector[FormFieldSpec]], ...)` — the Patch type reuses
the *exact same* `FormFieldSpec` format for both the persisted config and an incoming patch,
with every non-optional field (`sourceField`, `control`) required on decode
(`FormFieldSpec.read`, lines ~86-124, `deserializationError` on a missing required key).

D4's corrected id-diff rule depends on every incoming `controls` entry actually carrying an
`id` to diff against `existing` by. Nowhere in D2, D4, D6, or D7 — nor in tasks 1.1/1.2/3.3
— is it stated **how a newly-added control acquires an `id` value in the wire payload
before the server has ever persisted it**. Following the stated `FormFieldSpec`-mirroring
precedent literally (same type reused for Patch, `id` required, closed-key strict decode)
means the client must supply a non-empty `id` string for every entry, *including a brand
new one*, which is either:
1. a client-generated id (e.g. `crypto.randomUUID()`) that the server accepts and persists
   verbatim — which makes D2's "`id` is server-assigned" claim inaccurate (it would in fact
   be client-assigned, server-trusted), or
2. some distinct, undocumented decode path for Patch entries where `id` is optional and the
   server mints a UUID only on genuine detection of "new" — which contradicts D2's stated
   "mirrors `FormFieldSpec`'s... shape" (the actual precedent shape reuses one type with no
   optional-id variant), and which D7's "choosing a kind immediately calls
   `accumulatePanelUpdate` with the new control appended... no further required step before
   it appears in the list" flow doesn't account for either (the frontend still needs *some*
   stable local id for the list item the instant it's appended, before any server
   round-trip — D7 never says what that is or whether it survives the save).

This is not a cosmetic gap: it's the exact kind of two-competent-implementers-diverge
ambiguity the design gate exists to catch, and it sits directly in the mechanism (D4's
id-diff) this round's fix is built on. (For what it's worth, I also checked whether a
client being able to freely choose `id` values would let it bypass D4's validation by
reusing an existing valid entry's `id` on a *different* new control — it would not: D4's
rule already re-validates whenever `kind`/`column` differ from the persisted entry at that
`id`, so an id collision with mismatched kind/column still validates. This is not a
security hole, just an unresolved wire-contract decision.)

### Verdict: REFUTE

### Change Requests

1. **design.md D2 (and, if needed, D4/D7)** — state explicitly how a newly-added control's
   `id` is produced and travels across the wire: either (a) the frontend generates the id
   client-side (state the mechanism, e.g. `crypto.randomUUID()`) and the server accepts it
   verbatim on a genuine add (in which case "server-assigned" in D2 should be corrected to
   reflect that), or (b) the wire shape for an incoming `controls` Patch entry is distinct
   from the persisted/response `OutputControlSpec` (e.g. `id: Option[String]`, `None` =
   new, server mints a UUID and the response — not just the next read — returns the
   assigned id so the frontend's local state can reconcile it). Either resolution is fine;
   what's missing is a stated choice the executor doesn't have to guess, and (if (b)) an
   acknowledgment that this is a real divergence from `FormPanelConfig.Patch`'s
   same-type-reuse precedent rather than a literal mirror of it.

### Non-blocking notes

- None beyond CR1 above; everything else re-checked from round 1 (D4/D5 coherence,
  `defaultValue` shape, openspec validity, line budget, migration slot) holds up under
  fresh, independent verification against the actual code and files.
