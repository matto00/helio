## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Base/registry facts (premise-validation.md re-checked, not trusted):** read
  `backend/src/main/scala/com/helio/domain/model/PipelineStep.scala` directly.
  `Registry` has exactly 27 entries (counted the map literal, lines 225-251).
  `trait Companion` (line 148) is nested inside `object PipelineStep`, is
  kind-level (one instance per companion object, not per row), and already
  backs `Registry`, `companionFor`, and `PipelineStep.All`. Confirms design.md's
  Context section and the corrected "27, not 51" premise.
- **OP_TYPES / KNOWN_UNLISTED_KINDS:** `grep -n "KNOWN_UNLISTED_KINDS"
  frontend/src/features/pipelines/state/stepNarrowing.test.ts:610` — confirmed
  `Set(["join", "groupby"])`, matching D5's stated scope. `OP_TYPES` array has
  25 entries by a raw count of object literals, matching the corrected premise.
- **Four render sites, three insert contexts:** the ticket's own corrected
  premises and design.md Context both state this identically to what I'd
  expect from grepping `PipelineRiverView`/`BranchAffordance`; consistent
  with the premise-validation doc, no contradiction found.
- **D6 component citations (CommandPalette, Modal, EmptyState, `.eyebrow`):**
  read `frontend/src/features/commandPalette/ui/CommandPalette.tsx` directly —
  it imports `Modal` and `EmptyState`, maintains a flattened `activeIndex`
  crossing group boundaries (line 71, 180, 249), and renders
  `<div className="eyebrow command-palette__group-label">` (line 244) exactly
  as design.md claims. Read `DESIGN.md` §6 ("Shared components — reuse, don't
  reinvent", line 452) — `Modal`, `EmptyState`, and the `.eyebrow` utility
  (theme.css, cross-referenced at line 478) are all listed as canonical
  primitives to reuse rather than hand-roll. `ShapePickerModal` is cited
  correctly as lacking search/groups/arrow-nav (did not independently open
  that file's guts, but design.md's negative claim about it — "no search, no
  groups, no arrow-key navigation" — is consistent with it being a modal-only
  wrapper per its name and the ticket's own framing; low materiality either
  way since CommandPalette is the actual model chosen).
- **D6 risk item (F-040 clamp "moot, not regressed"):** read
  `frontend/src/features/pipelines/ui/OpDropdown.test.tsx` (lines 77-98,
  confirms the `role="menu"` + inline `maxHeight` assertions being retired)
  and `frontend/src/shared/ui/Modal.css` (line 9: `max-height: 90vh`; line 156:
  `overflow-y: auto`, plus real design commentary on why `max-height` not
  `height` is used against non-definite ancestors). The claim that `Modal`
  structurally replaces the clamp mechanism is substantiated, not hand-waved.
- **D3/D4 wire-contract discipline:** design.md Decisions 3-4 explicitly commit
  to two ordered arrays (`groups`, `steps`) and an ABSENT (not null) group
  field, and explicitly call out that a `group: null`-asserting test "would
  pass against a serializer that emits null and prove nothing about the real
  payload" — this is stated as the actual failure mode to guard against, not
  left implicit. tasks.md 2.2 pins this as its own verify step ("a JSON test
  asserts an ungrouped entry serializes with the group key ABSENT (not
  null)"), and the `pipeline-step-catalog-api` spec's own scenario text says
  "not present with a null value, and not substituted with a catch-all group".
  This is pinned as observable behavior at both the design and spec layer, not
  left as a testable-but-untested assertion.
- **`pipeline-editor-page` MODIFIED delta completeness:** diffed the delta
  against `openspec/specs/pipeline-editor-page/spec.md` (lines 219-256) — the
  delta reproduces the entire original requirement block verbatim (heading,
  bullets, all four scenarios) with exactly one bullet changed ("Open the
  existing op-type picker anchored at that gap" → "Open the add-step palette
  carrying that gap's insert context"). No requirement text or scenario was
  dropped; nothing is lost at archive. The substituted language is accurate —
  it no longer promises "anchored at that gap" literally but does promise the
  gap's index is carried through, which the sibling `pipeline-step-palette`
  spec's "Every add-step entry point keeps its own insert position"
  requirement covers with its own scenario ("A gap control inserts at that
  gap"). No AC lost, no duplication conflict.
- **Capability decomposition:** `pipeline-step-catalog-api` (backend contract)
  vs. `pipeline-step-palette` (UI/keyboard/filtering) is a clean seam along the
  wire boundary and matches how `pipeline-shapes`/`ShapePickerModal` are
  already split in this codebase (service + UI as separate specs is the
  existing pattern here, not a new one invented for this ticket).
- **tasks.md executability:** read top to bottom. Backend tasks (1.1-2.5) precede
  frontend (3.1 depends on the wire shape 2.2 defines; 3.1's typecheck verify
  is gate-able before 3.2). 1.2's "verify sbt compile succeeds with no
  companion yet edited" is a genuine ordering check — it proves the trait
  default (`group: Option[StepGroup] = None`) doesn't force every one of 27
  companions to be touched atomically, which is the concrete way "ungrouped
  must not be a compile error" gets tested rather than just asserted. Task 5.4
  ("verify no import of OpDropdown remains anywhere") is a real, checkable
  completion gate. Task 6.5 correctly scopes e2e-flake risk to "a NEW
  signature, not a pre-existing HEL-992 one" rather than demanding zero red
  from a suite already carrying a known ~5.7% flake rate — an honest
  acknowledgment rather than a gate that would either be ignored or produce
  false escalations.

### D1 — Companion-level declaration vs. the ruling's letter

The ruling text: "Declare the step group on the backend step classes via the
`PipelineStep` trait (...), with `StepGroup` a sealed ADT ... Whether the
exposure is an existing endpoint or a new one is a design decision," and
separately allows latitude via "e.g. an abstract member or a group trait each
step mixes in." I read `trait PipelineStep` (the instance-level trait, lines
39-143) directly: its abstract members are exclusively instance-level (`id`,
`position`, `config`, `evaluate`, `enabled`, `parentStepId`) — there genuinely
is no instance to read a group off of for a kind that has never been
instantiated, which is exactly the catalog's requirement (enumerate *kinds*,
not *rows*). `Companion` already is the kind-level metadata holder `Registry`
is built from, lives in the same file (`PipelineStep.scala`), is declared
"via" the `PipelineStep` object (not a separate mapping table), and is
per-step (each of the 27 companions declares its own `group`), which is what
makes future per-group usage-metric aggregation possible — the ruling's
stated reason. The rejected alternative (case-class member + parallel
kind→group table) would have been the actual letter-violation, recreating the
mapping the ruling exists to delete.

This is a defensible, non-strained reading, not a strained one manufactured to
avoid work: it satisfies every substantive constraint the ruling names
(backend-owned, per-step, API-exposed, enables per-group metrics later) and
the alternative the ruling's own "e.g." wording gestures at (an abstract
member) is demonstrably unworkable for the catalog's actual requirement. I do
not judge this a genuine departure from the owner's intent — it is a correct
resolution of an ambiguity the ruling itself created by naming a trait whose
literal form cannot satisfy the ruling's own purpose. Not escalating this
myself per the instructions, but flagging that my read agrees with the
planner's: CONFIRM, not ESCALATION-worthy.

### D5 — All-view vs. no-broken-choice reconciliation

The two ACs pull against each other exactly as design.md states. The chosen
resolution — every registered kind appears in the catalog (so "All lists
every registered step" server-side has no exceptions), `authorable: Boolean =
true` by default, the palette filters to authorable-only for selection, and a
failable check asserts every registered kind is present-in-All-or-declared-
unauthorable — is internally consistent with the *spec text* I read (not just
design.md's narrative): the `pipeline-step-palette` spec's own requirement
says "The palette SHALL offer an 'All' view that lists every **authorable**
step in the catalog" (not "every registered step" — the spec quietly narrows
"every registered step" to "every authorable step" for the UI-facing
guarantee), while the `pipeline-step-catalog-api` spec's requirement is "The
step catalog enumerates **every registered** step kind" for the wire
contract. This is the correct place to draw that line: the wire contract
keeps the strong "nothing omitted, ever" guarantee (testable against
`Registry.keySet`, catching a newly-registered-but-undeclared kind); the UI
guarantee is honestly scoped down to what a user should see. This does not
weaken the AC in the ticket in a way that lets anything vanish silently — the
failable check (tasks.md 6.1 backend, 6.2/6.3 frontend, spec scenario "A
missing authorable step fails the check") still goes red for the one failure
mode the AC actually cares about (a step nobody can select and nobody can
see). `join`/`groupby` become explicit, reviewable, backend-declared
exceptions instead of a frontend test-file constant — an improvement, not a
regression, on the AC's own intent. CONFIRM, not an ESCALATION-worthy
weakening.

### Non-blocking notes

- D1/D6 are exactly the two items design.md itself asked the design gate to
  press hardest on. Both check out under independent grep/read verification
  in this pass; I did not find a third undisclosed weak point.
- I did not deeply read `ShapePickerModal.tsx`'s implementation to verify the
  negative claim about its missing search/groups/arrow-nav; this is
  low-materiality since the design correctly does NOT build on it.
- Nothing in the ticket's own premises is untrue at this base (origin/main
  abe2a8fa, confirmed reachable and non-diverged per premise-validation.md,
  which I did not independently re-verify via `git log` since it is a purely
  procedural claim with no bearing on design soundness).

### Verdict: CONFIRM
