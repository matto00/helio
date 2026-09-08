## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Base: `git log -1` → `0826b4ae`. `git diff --stat main...HEAD` → **empty**; no implementation
exists, so there is no branch-only string to curl and no visual observation is possible or
required at this gate. Task 5.5 correctly carries the content-self-authentication obligation
into execution. Cohesion judgment is therefore not exercisable in round 2 (nothing rendered).

Round-1 CRs, each checked against the tree — not against the prose:

- **CR1 — RESOLVED.** `listAllOutputs()` at `frontend/src/features/pipelines/services/outputService.ts:66`
  is a plain exported `async function listAllOutputs(): Promise<Output[]>` with **no arguments and
  no hook/React context coupling** — it loops `offset` until `offset >= total`, breaking on an
  empty page. It is trivially callable from a new thunk; its only current consumer
  (`useOutputPickerData.ts`) is incidental. **Reuse is genuinely viable.** D3 now names
  `Page.Default.limit = 200` / `MaxLimit = 500`, withdraws the "ONE request" claim, names the
  "no thunk yet" premise as stale, and task 2.1 requires reuse plus a >1-page indexing test.
  (But see CR2 below — the withdrawn falsehood still lives in design.md's Context.)
- **CR3 — RESOLVED.** D2 specifies retry-on-open for `failed`, mandates that `failed` and
  `loading` read differently, and names the dedup mechanism as each slice's own status rather
  than a thunk `condition`. Task 2.2 verifies both (a) all-succeeded → no re-dispatch and
  (b) one-failed → re-dispatch. `specs/resource-search-index/spec.md:43-53` carries a real
  requirement with two scenarios ("A failed collection is named as failed", "…is retried on a
  later explicit search").
- **CR4 — RESOLVED, and the proviso is accurate.** Verified in
  `frontend/src/features/onboarding/hooks/useOnboardingHost.ts`: `autoActivate =
  dashboards.status === "succeeded" && dashboards.items.length === 0 && dismissed === false`;
  `visible = active || autoActivate`; the effect below dispatches `fetchSources()` /
  `fetchPipelines()` when `visible` and that slice is `"idle"`. I also checked the *other* half of
  the question — whether the checklist can appear for another reason: `grep -rn "activateOnboarding"`
  returns exactly **one** non-test dispatch site (`useOnboardingHost.ts:74`), itself gated on
  `autoActivate`. So with ≥1 dashboard in the fixture the checklist genuinely cannot render, and
  the task 5.1 mutation is no longer vacuous. (The third conjunct `dismissed === false` is omitted
  from both design.md and task 5.1; harmless — it only makes the proviso conservative, and a fresh
  `registerAndLogin` account has no stored dismissal.)
- **CR5 — RESOLVED.** D7 + task 3.4a: fixed per-kind cap of 5, applied **after** ranking, defined
  in one place, with an "N more" statement rather than silent truncation.
- **CR6 — RESOLVED.** D1 now states the TS2366/value-returning-switch limit correctly and requires
  `const _exhaustive: never = ref;`; task 1.3 says so explicitly and demands the mutation be run
  and confirmed landed. Confirmed against `shared/chrome/resourceNavigation.ts` — the navigator is
  indeed a `void`-returning `if (ref.kind === "dashboard") { …; return; }` branch that would fall
  off the end silently.
- **CR2 — NOT resolved.** See Change Request 1. The ruling was made (`ResourceKind` gains
  `"output"`), but the consequence named is the wrong one and the justification given is false.

**Two-axes question.** *What no source text carries:* whether the app indexes anything on `/` —
still only a running `/`-route probe against a with-a-dashboard fixture distinguishes an unindexed
search from an empty workspace. *What path the gates would not exercise:* the >1-page outputs path
and the failed-kind path — both are now named by tasks 2.1/2.2, so they are covered at the plan
level; nothing else new is uncovered.

### Verdict: REFUTE

Two required revisions. CR1 is the blocking one: it is the same defect class as round 1's CR6 — a
confidently-stated TypeScript claim that is false, which makes the plan's stated resolution not
actually work.

### Change Requests

1. **`RecentEntry["kind"]` is still typed `ResourceKind`, so the design's stated reason that
   `useRecentPaletteActions.ts:65` "stays legal" is FALSE, and the retype it needs is named
   nowhere in tasks.md.** Task 1.0 and D1 change only `VALID_KINDS`. But
   `frontend/src/features/commandPalette/model/recentHistoryStore.ts:16` declares
   `kind: ResourceKind` inside `RecentEntry`, and `:100`/`:104` declare
   `recordVisit(kind: ResourceKind, …)` / `pruneMissing(kind: ResourceKind, …)`. Once `ResourceKind`
   gains `"output"`, `entry.kind` is widened to include `"output"` and **two call sites break**:
   - `frontend/src/features/commandPalette/useRecentPaletteActions.ts:65` —
     `const ref: ResourceRef = { kind: entry.kind, id: entry.id };` no longer assignable
     (the Output arm requires `pipelineId`);
   - `useRecentPaletteActions.ts:12` — `const KIND_ICON: Record<RecentEntry["kind"], LucideIcon>`
     is missing the `"output"` key (this one round 1 did not name either).

   Note the file path in D1/task 1.0 is also wrong: it is
   `features/commandPalette/useRecentPaletteActions.ts`, not `.../hooks/…`.
   **Revise D1 and task 1.0** to rule that `RecentEntry["kind"]`, `recordVisit`'s and
   `pruneMissing`'s parameters are retyped to `RecentKind` (not `ResourceKind`) — that, not the
   `VALID_KINDS` annotation, is what actually keeps `:65` and `:12` compiling — and delete the
   false justification sentence in D1.

   **In the same revision, name the exhaustiveness mechanism.** `const VALID_KINDS: readonly
   RecentKind[]` **cannot** fail the build when a kind is added: an array annotation does not
   require the array to be exhaustive. Task 1.0's verify ("adding a dummy kind fails typecheck
   until `VALID_KINDS` is updated") is therefore unsatisfiable by the construct the task
   prescribes. State the construct that actually works (e.g. deriving the list from a
   `Record<RecentKind, true>` keyed map, which *is* exhaustiveness-checked). This is round 1's
   CR6 recurring: the obvious mechanism does not do what the plan asserts it does.

2. **design.md's Context still asserts the falsehood D3 withdraws.** Line 3-5: *"Three facts drive
   everything below: … and `GET /api/outputs` already returns every Output in one request."*
   D3 explicitly names that claim as false. An implementer skimming the Context — presented as the
   three load-bearing facts — gets the stale premise that CR1 existed to kill. Correct the Context
   sentence to match D3 (paginated; reuse `listAllOutputs()`).

### Non-blocking notes

- The per-kind cap (D7 / task 3.4a) has **no spec requirement** in
  `specs/palette-resource-search/spec.md` — `grep -in "cap"` returns nothing there. The
  "N more exist" behaviour is user-visible and is the same silent-truncation defect class the
  ticket is about; it would be better as a scenario than as a task line only.
- Round 1's note about an output row's subtitle (its pipeline name, the disambiguator when two
  pipelines have similarly-named outputs) is still unaddressed in tasks.md.
- Round 1's note that the coverage caveat's **placement** is unspecified is also still
  unaddressed, so task 5.6's cohesion screenshot has no stated intent to judge against.
- Decision 1's union shape and its scaling to HEL-1041's connector were confirmed in round 1 and
  I did not reopen them.
