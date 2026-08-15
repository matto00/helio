## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, the full current `design.md`, `tasks.md`, and all four spec deltas
  (`patch-set-undo`, `patch-set-apply`, `patch-set-preview`, `mcp-patch-set-tools`) fresh from the
  worktree, plus `skeptic-design-{1,2,3}.md` (treated as claims to re-verify, not fact).
- Confirmed the round-4 revision described in the brief is genuinely present in the current files:
  design.md's new D2a (lines 40-49), D4a's rewrite (lines 87-107), D1's `rawResultingConfig` addition
  (lines 23-31), tasks.md's new 1.5 and revised 2.2/5.1/5.3, and both spec deltas' new
  requirements/scenarios (`patch-set-apply/spec.md:25-35`, `patch-set-undo/spec.md:41-47`) all match
  the summary.

**Re-verification target 1 — is `panelService.update`'s return value really materialized, and does the
new `findByIdInternal` fetch really return the raw, unmaterialized value (the distinction D2a/D4a rely
on)?**

- `PanelService.update` (`PanelService.scala:434-473`) calls `patchApplier.apply(panelId, spec, p =>
  resolveSingleBinding(p, user))` (line 462). `PanelPatchApplier.apply` (`PanelPatchApplier.scala:
  24-75`) writes the raw patched panel via `panelRepo.replace(updated, now)` (line 54) and only THEN
  calls `resolveBinding(panel)` — i.e. `resolveSingleBinding` — on the return path (lines 69-72),
  never persisting the materialized result back to the DB. Confirmed: `update`'s return value is
  materialized in-memory only; the DB row itself stays raw.
- `PatchSetApplyResolvers.resolvePanelUpdate`'s existing `priorState` capture
  (`PatchSetApplyResolvers.scala:282,298`) uses `ctx.panelRepo.findByIdInternal(panelId)` →
  `PanelResponse.fromDomain(panel)`. `PanelResponse.fromDomain` (`PanelProtocol.scala:112-123`) sets
  `config = PanelConfigCodec.encodeConfig(panel)`, and `encodeConfig` (`PanelConfigCodec.scala:24-35`)
  is a pure `panel.config.toJson` passthrough — no materialization logic anywhere in that path.
  Confirmed: the "same method" D2a cites for its new fetch is genuinely a raw/unmaterialized read, and
  a second `findByIdInternal` call issued right after `panelService.update` returns would read the DB
  row as freshly persisted by `panelRepo.replace` — i.e., genuinely raw, distinct from `update`'s
  materialized return value. D2a's premise holds.
- Confirmed `ChartPanel`/`TablePanel` are unaffected by this whole mechanism:
  `PanelServiceHelpers.withMaterializedMetric` (`PanelServiceHelpers.scala:276-299`) only sets
  `metricDeprecated` for `cp`/`tp` (lines 294-297) — no effective-field materialization for those two
  kinds, matching D4a's scoping to `MetricPanelConfig` only.

**Re-verification target 2 — does `rawResultingConfig` genuinely let the conflict check distinguish
"raw override changed" from "metric definition changed" in every combination that matters?**

Traced all three requested combinations against the mechanism as described (raw-current-live vs.
journaled `rawResultingConfig`, `metricId` unchanged):

1. *Raw override present at apply time, unrelated metric change since* — `rawResultingConfig.dataTypeId`
   at apply time already equals the raw override value (`withMaterializedMetric`'s override rule,
   `PanelServiceHelpers.scala:278-279`: `if (mp.config.dataTypeId.value.nonEmpty) mp.config.dataTypeId
   else metric.dataTypeId` — raw wins when present). The metric's own later change never touches the
   panel's raw DB row, so current-live-raw still equals the same override value → no mismatch → no
   false conflict. Correct.
2. *No raw override at apply time, metric's own field changed since* — `rawResultingConfig.dataTypeId`
   at apply time is empty (`DataTypeId("")`, no override). The metric change doesn't touch the panel's
   raw row either, so current-live-raw is still empty → matches journaled empty value → no false
   conflict. Correct.
3. *Raw override introduced/changed since apply (with or without a concurrent metric change)* —
   current-live-raw now differs from the empty/prior journaled `rawResultingConfig` value → mismatch →
   conflict correctly flagged, independent of whatever the metric did in the meantime. This is exactly
   round 3's regression scenario, now caught. Correct.

  This closes round 3's finding as designed — the raw-vs-raw comparison genuinely separates the two
  signal sources in all three combinations I traced.

**Fresh whole-design pass — a NEW gap this round's revision introduces, not present in rounds 1-3.**

D2a/task 1.5 place the new fetch **inside `PatchSetApplyForward`'s panel `update`/`create` case**,
"right after the service call succeeds" (design.md:44-49; tasks.md:7). I traced how that value is
supposed to reach the journal, and it runs into a real, unaddressed plumbing gap:

- `PatchSetApplyForward.applyOne`'s current signature is `(edit: ResolvedEdit, user: AuthenticatedUser,
  services: PatchSetApplyServices)` (`PatchSetApplyForward.scala:20-24`), and `PatchSetApplyServices`
  (`PatchSetApplyTypes.scala:100-105`) bundles only the five per-resource **services** — no
  `panelRepo`. `PatchSetApplyContext` (`PatchSetApplyTypes.scala:85-93`), which DOES carry `panelRepo`,
  is currently only threaded into `PatchSetApplyResolvers.resolveAll`
  (`PatchSetApplyService.scala:58-65`), never into `PatchSetApplyForward.applyOne`
  (`PatchSetApplyService.scala:90`: `PatchSetApplyForward.applyOne(edit, user, services)` — no `ctx`
  argument). So `ctx.panelRepo.findByIdInternal(id)`, as D2a literally names it, is not actually
  reachable from where D2a/task 1.5 place the call — some signature change is needed. This alone is
  minor/mechanical (see non-blocking notes), but it is the doorway into a bigger problem:
- `PatchSetApplyForward.applyOne`'s ONLY channel back to its caller is `Future[Either[ServiceError,
  EditOutcome]]`. `EditOutcome` (`PatchSetApplyProtocol.scala:33-39`) has exactly 5 fields — no
  `rawResultingConfig` — and `EditOutcome` is not a private, journal-only type: it is the literal wire
  element of `PatchSetApplyResponse.edits: Vector[EditOutcome]` (`PatchSetApplyProtocol.scala:46`,
  `jsonFormat5`/`jsonFormat2` at lines 49-51), which `PatchSetRoutes.scala:36-44` marshals straight to
  the `POST /api/patch-sets/apply` HTTP response with **no filtering step** in between. `PatchSetApplyService.applyResolved`'s loop (`PatchSetApplyService.scala:79-104`) builds ONE
  `applied: Vector[(ResolvedEdit, EditOutcome)]` collection and reuses it for BOTH purposes: line 98
  constructs `PatchSetApplyResponse(outcomes, failure = None)` where `outcomes = applied.map(_._2)`,
  and (per task 1.3) the SAME collection is what gets journaled.
- **The only currently-available way for the new fetch's result to reach the journal at all is to
  become part of `EditOutcome` itself** (there is no other channel out of `applyOne`), and if it does,
  it flows automatically into the `/apply` HTTP response for every panel `update`/`create` edit too —
  since `outcomes` and the journaled entries are built from the identical `EditOutcome` values, with no
  step anywhere in the current design that strips it back out before constructing the response.
- This is a REAL contract risk, not a cosmetic one: proposal.md's "What Changes" section
  (`proposal.md:10-12`) states `PatchSetApplyResponse` "gains an additive `applicationId:
  Option[String]`" as the sole wire change to that response — no second field is disclosed.
  `specs/patch-set-apply/spec.md`'s own "byte-for-byte unchanged" scenario (lines 19-24) commits to
  every field besides `applicationId` staying exactly as before. `specs/patch-set-apply/spec.md`'s NEW
  requirement for this round ("A journaled panel edit SHALL also capture a raw, unmaterialized config
  snapshot", lines 25-35) only speaks of "the journal" capturing this value — it never says the
  `/apply` response gains a field, reinforcing that `rawResultingConfig` is meant to be journal-only.
  Yet the mechanism design.md/tasks.md actually specify (fetch happens inside `applyOne`, "right after
  the service call succeeds") forces the more awkward implementation path that DOES leak it, unless an
  explicit stripping/separate-channel step is added — and nothing in design.md or tasks.md currently
  says to do that.
- This is meaningfully different from round 2's non-blocking note about the retention-pruning SQL
  shape being unspecified ("harmless either way," any reasonable implementation works) — here, the
  more obvious of the two implementation paths (grow `EditOutcome`, since that is literally the only
  data channel `applyOne` currently has) produces an undisclosed wire-contract change, while the
  correct path (keep the raw config off `EditOutcome`, threaded through a separate channel — mirroring
  how `targetKind`/`op` were deliberately kept off `EditOutcome` and threaded separately, per D1's own
  explicit note at design.md:27) requires an actual signature decision the design never makes for
  `rawResultingConfig`. Notably, `targetKind`/`op` don't have this problem because they're derivable
  from `ResolvedEdit`, already available OUTSIDE `applyOne` at the call site — `rawResultingConfig`
  can only be known from inside `applyOne`'s panel case, so the `targetKind`/`op` precedent doesn't by
  itself resolve where this value should live.
- Checked whether this only matters for `update`: for `PanelCreate`
  (`PatchSetApplyForward.scala:34-37`), `services.panelService.create(...)`'s returned `Panel` is
  ALREADY unmaterialized — `PanelService.create` (`PanelService.scala:168-186`) never calls
  `resolveSingleBinding`, so `resultingState` for a create edit is already raw. The new fetch is
  therefore redundant (not wrong, just an unneeded extra DB read) for `create` — the whole concern is
  specific to `update`. Noted below as non-blocking.

I also re-checked D1/D3/D4/D4b/D5/D6 and the other two spec deltas (`patch-set-preview`,
`mcp-patch-set-tools`) fresh against source for anything else disturbed by this round's edits: V79 is
still the correct next-unclaimed Flyway version (`ls backend/.../db/migration` tops out at
`V78__refinement_conversations.sql`); nothing else in D3/D4/D4b/D5/D6 or the two unrelated spec deltas
changed this round or shows a new inconsistency.

### Verdict: REFUTE

### Change Requests

1. **(Blocking) D2a/task 1.5 don't specify how `rawResultingConfig`'s value gets from
   `PatchSetApplyForward.applyOne`'s panel `update` case to the journal without also leaking onto the
   `POST /api/patch-sets/apply` wire response — and the literal mechanism they DO specify (fetch inside
   `applyOne`, "right after the service call succeeds") forces the more awkward of the two
   implementation paths, which does leak it.** See evidence above:
   `PatchSetApplyForward.applyOne`'s only return channel is `EditOutcome`
   (`PatchSetApplyForward.scala:20-24`), which is the literal wire element of `PatchSetApplyResponse`
   (`PatchSetApplyProtocol.scala:46`) marshaled with no filtering by `PatchSetRoutes.scala:36-44`; and
   `PatchSetApplyService.applyResolved` builds one `EditOutcome` collection reused for both the response
   and (per task 1.3) the journal (`PatchSetApplyService.scala:79-104`). Left unresolved, the natural
   implementation is to add `rawResultingConfig` to `EditOutcome`, which would silently add an
   undisclosed field to `/apply`'s response for every panel edit — contradicting proposal.md's explicit,
   sole-listed wire change (`proposal.md:10-12`, "additive `applicationId`") and
   `specs/patch-set-apply/spec.md`'s "byte-for-byte unchanged" scenario (lines 19-24), whose own new
   requirement this round (lines 25-35) frames `rawResultingConfig` as journal-only, never a
   response field.
   **Required revision — pick one, document the choice explicitly in design.md D1/D2a (mirroring the
   existing explicit note for why `targetKind`/`op` are threaded separately, design.md:27), and update
   tasks.md 1.3/1.5 to match:**
   - (a) Change `PatchSetApplyForward.applyOne`'s return type to carry the raw config as a value
     SEPARATE from `EditOutcome` (e.g. a small wrapper/tuple), and extend
     `PatchSetApplyService.applyResolved`'s `applied` accumulator to carry it alongside `ResolvedEdit`/
     `EditOutcome` — used only when building the journal payload, never merged into the `EditOutcome`s
     that become `PatchSetApplyResponse.edits`. **or**
   - (b) Add `rawResultingConfig` to `EditOutcome`, but have `PatchSetApplyService.applyResolved`
     explicitly strip it (map to `None`) on the collection used to construct `PatchSetApplyResponse`,
     keeping the un-stripped values only for the journal-write call — and say so explicitly, since the
     current single-collection-reused-for-both-purposes shape (`applied.map(_._2)` at
     `PatchSetApplyService.scala:98`) does not do this today.
   Either path also needs `PatchSetApplyForward.applyOne` to gain access to `panelRepo` (via `ctx:
   PatchSetApplyContext` or just the one repo), which its current signature lacks
   (`PatchSetApplyServices`, `PatchSetApplyTypes.scala:100-105`, has no `panelRepo` field) — a small,
   mechanical addition, but the call site (`PatchSetApplyService.scala:90`) needs updating too, so it's
   worth naming explicitly alongside whichever of (a)/(b) is chosen.

### Non-blocking notes

- `rawResultingConfig`'s extra fetch is redundant (not incorrect, just an unneeded DB round-trip) for
  `PanelCreate`: `PanelService.create` (`PanelService.scala:168-186`) never calls
  `resolveSingleBinding`, so a newly created panel's `resultingState` is already raw/unmaterialized —
  identical to what the new fetch would return. Task 1.5's "panel `update`/`create` case" wording could
  note that the `create` half is belt-and-suspenders rather than load-bearing, so a future implementer
  doesn't wonder why it's a no-op there.
- Once CR1's channel is settled, `EditOutcome`'s doc comment (`PatchSetApplyProtocol.scala:17-32`)
  should probably get a one-line update mirroring how it already documents `priorState`/`resultingState`
  provenance, so the "never a new format invented for this ticket" framing doesn't read as stale if (a)
  above is chosen (a genuinely new, non-`EditOutcome` carrier for the journal-only field).
