## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/output-routes-api/spec.md`, and round 1's `skeptic-design-1.md` in full, fresh (cold spawn,
  no prior context).
- Confirmed round-1 CR1's plpgsql/subtransaction complaint is fixed: D2's `safe_numeric`/
  `safe_timestamptz` in `design.md` are now `LANGUAGE sql IMMUTABLE` with a regex-guarded `CASE`,
  no `EXCEPTION` block — matches tasks.md 1.1's description.
- Confirmed D9 "Performance & indexing" now exists and directly answers ticket.md's driver-context
  question ("state explicitly whether an index is needed"), with a stated rationale (row selection
  already indexed via `idx_node_snapshots_pipeline_id`; the sort/filter column is arbitrary/
  per-request so no functional index can target it; GIN doesn't help `ORDER BY`; top-N heapsort at
  the ticket's stated 10k-row scale is cheap) and an explicit escalation path if scale grows. This
  resolves round-1 CR1.
- **Independently tested D2's corrected `safe_timestamptz` regex against the actual
  `TimestampParsing.looksLikeTimestamp`** (`backend/src/main/scala/com/helio/domain/engine/TimestampParsing.scala:15-19`)
  it claims to match, rather than trusting design.md's prose assertion:
  - Ran the regex in Python against representative inputs for all four formats
    `looksLikeTimestamp` accepts (`ISO_DATE_TIME`, `ISO_LOCAL_DATE_TIME`, `ISO_LOCAL_DATE`,
    `MM/dd/yyyy`).
  - Independently confirmed via `jshell` (OpenJDK 21, the same JDK family the backend runs on) that
    `LocalDateTime.parse("2024-01-01T10:15", DateTimeFormatter.ISO_LOCAL_DATE_TIME)` and
    `ZonedDateTime.parse("2024-01-01T10:15+01:00", DateTimeFormatter.ISO_DATE_TIME)` both **succeed**
    (seconds are optional in both formatters — this is documented `DateTimeFormatter` behavior, not
    a guess), and that `ZonedDateTime.parse("2024-01-01T10:15:30+01:00[Europe/Paris]",
    DateTimeFormatter.ISO_DATE_TIME)` also succeeds (`ISO_DATE_TIME` accepts an optional bracketed
    zone-region suffix).
  - Ran D2's actual regex against these three strings: **all three fail to match** (regex requires
    `\d{2}:\d{2}:\d{2}` — seconds mandatory — and has no allowance for a `[Zone/Id]` suffix).
  - This means the round-2 regex, despite design.md's explicit claim ("corrected against real code
    ... matching `looksLikeTimestamp`'s own format set"), still does **not** fully cover what
    `looksLikeTimestamp` treats as a valid timestamp. A `TimestampType` column containing
    `2024-01-01T10:15` (no seconds — e.g., anything sourced from an HTML `datetime-local` input, a
    common shape) or an offset timestamp without seconds would be silently `NULL`ed by
    `safe_timestamptz` under D2's own stated rule, producing exactly the "materially useless sort on
    a column the schema correctly calls sortable" failure mode D2's own text identifies as
    unacceptable for the `MM/dd/yyyy` case it did fix. This is the same class of defect round 1 found
    (regex under-covers the declared source of truth), recurring in the very fix meant to close it.
  - See change request 1 below for the concrete regex fix.
- **Re-traced D4's rewritten frontend plumbing against the real `TableRenderer.tsx`** rather than
  trusting the "resolved" framing:
  - Confirmed `resetPanelPagination` (`panelsSlice.ts:112-114`) still has **zero real call sites**
    (`grep -rn "resetPanelPagination" frontend/src` — only the reducer definition, its own export,
    and its own unit test file) — consistent with D4's premise that this is genuinely unwired today.
  - Confirmed `TableRenderer.tsx`'s `handleSort` (line 507) and `handleFilterChange` (line 532) are
    the real, current click/type handlers D4 proposes to make "controlled." Reading them in full
    surfaced a mechanism **D4 does not mention anywhere**: both handlers, after updating local state
    via `toggleSort`/`setFilters`, **debounce-PATCH the choice back to the Output's persisted config**
    (`persistColumnSort`/`persistColumnFilters`, lines 192–207, calling `updateOutput(outputId,
    {config: {columnSort/columnFilters}})`) — and this PATCH is gated on `canWrite = ownerId != null
    && currentUserId != null && ownerId === currentUserId` (line 248), with an explicit, previously
    owner-ruled design decision (HEL-448 design D7, referenced in a comment at line 246) that a
    shared-dashboard grantee's sort/filter interaction "stays session-local, silently — no toast, no
    disabled control" because `updateOutput` is an RLS owner-only write.
  - **This is a real, load-bearing interaction D4's rewrite must reconcile and currently doesn't:**
    the ticket's own driver context and D6 both mandate that the NEW server-side sort/filter fetch
    is gated *only* by the Output's read-ACL (`outputRepo.findById`), not by write/ownership — i.e.
    a shared-dashboard viewer with no write access must still get a correctly server-ranked result
    when they sort, because that is the entire point of the ticket (silent wrong-ranking is exactly
    what's being fixed, and it affects viewers, not just owners). But D4's literal instruction —
    "its click/type handlers call the new callbacks **instead of** mutating local state directly" —
    says nothing about the existing `canWrite` early-return or the debounced config-PATCH sitting in
    the same functions. An executor following D4 as written has at least two plausible, materially
    different implementations available with no way to tell from the design which is correct:
    (a) preserve `handleSort`'s existing `canWrite`-gated persist logic verbatim and merely add a call
    to the new `onSortChange` callback alongside it (correct, if `onSortChange` fires unconditionally
    for every user), or
    (b) since D4 says local mutation is replaced "instead of" and the persist code lives inside the
    same local-mutation branch, fold the whole `handleSort` body — including its `if (... || !canWrite)
    return` early exit — into the new controlled/callback path, which would silently make the NEW
    server-fetch-triggering sort a no-op for every non-owner viewer, regressing exactly the
    accuracy-for-viewers guarantee this ticket exists to deliver, and doing so silently (no error, no
    disabled control — it would just look identical to the existing, intentionally-silent D7
    behavior, masking the regression).
    Nothing in D4, D6, D7, or tasks.md 4.1–4.4 says which of these an executor should build, nor does
    it say whether the debounced-persist-to-Output-config feature (a real, currently-shipped
    behavior with its own owner-only RLS semantics) is meant to survive this refactor at all. This is
    exactly the kind of "architecture invented mid-implementation" round-1 CR2 was raised to prevent,
    now surfacing in a part of the real component D4's rewrite touches but doesn't fully account for.
    See change request 2 below.
  - Confirmed (via `grep -in "canWrite|persistColumnSort|persistColumnFilters|updateOutput|ownerId|
    session-local" design.md tasks.md proposal.md`) that none of these terms appear anywhere in the
    planning documents — the existing mechanism is not merely under-specified, it is entirely
    unmentioned.
- Confirmed `openspec/specs/output-routes-api/spec.md`'s backend-only delta is internally consistent
  with D1–D9 and does not itself claim to cover the frontend plumbing question (out of its scope, as
  expected for an API spec) — no defect found there.

### Verdict: REFUTE

### Change Requests

1. **D2's corrected `safe_timestamptz` regex still does not cover everything
   `TimestampParsing.looksLikeTimestamp` accepts, despite design.md's explicit claim that it now
   does.** Confirmed via `jshell` against the real JDK: `ISO_LOCAL_DATE_TIME` and `ISO_DATE_TIME`
   both accept a time-of-day with no seconds (e.g. `2024-01-01T10:15`,
   `2024-01-01T10:15+01:00`), and `ISO_DATE_TIME` additionally accepts a bracketed zone-region
   suffix (e.g. `2024-01-01T10:15:30+01:00[Europe/Paris]`) — all three are valid timestamps per
   `looksLikeTimestamp` and would therefore be typed `TimestampType` by schema inference, but all
   three fail the current regex (`\d{2}:\d{2}:\d{2}` mandates seconds; there is no zone-bracket
   allowance) and would be silently `NULL`ed by `safe_timestamptz`, reproducing the exact
   "materially useless sort on a column the schema correctly calls sortable" failure D2 itself
   flags as unacceptable. Fix the regex (e.g. make the seconds group optional —
   `(:\d{2}(\.\d+)?)?` after minutes — and add an optional `(\[[^\]]+\])?` zone-id suffix after the
   offset), and re-verify the corrected version against `looksLikeTimestamp`'s actual four
   formats (ideally with the same kind of direct JVM check performed for this review, not a
   read-and-assert) before this decision is called resolved. If a residual gap is knowingly
   accepted instead (e.g. deciding zone-bracket timestamps are out of scope because
   `node_snapshots.data` never contains them), design.md must say so explicitly with a reason,
   rather than asserting full coverage that isn't there.

2. **D4's rewritten plumbing does not reconcile with the existing debounced
   persist-to-Output-config mechanism and its owner-only `canWrite` gate, both of which live inside
   the exact `TableRenderer` handlers D4 rewrites.** `TableRenderer.tsx`'s current `handleSort`
   (line 507) and `handleFilterChange` (line 532) already debounce-PATCH the chosen sort/filter
   back to the Output's config via `persistColumnSort`/`persistColumnFilters` (lines 192–207,
   `updateOutput`), gated on `canWrite` (owner-only; a shared-dashboard grantee's interaction is a
   previously-owner-ruled silent session-local no-op per HEL-448 design D7, referenced at line
   246). D4 says nothing about this mechanism, `canWrite`, or D7 anywhere. Design.md must state
   explicitly:
   - Whether the config-persistence behavior (sort/filter sticking as the panel's default on next
     load) is retained, and if so, that it stays gated on `canWrite`/ownership exactly as today,
     wired independently of the new `onSortChange`/`onFilterChange` callbacks; and
   - That the new callbacks — which drive the server refetch this ticket exists to add — **must**
     fire for every viewer regardless of `canWrite`, since the ticket's own D6/driver-context
     mandate is that server-side sort/filter accuracy is gated only by the Output's read ACL, not
     by write/ownership. Without this stated explicitly, an executor has at least two materially
     different, D4-consistent implementations available (see the evidence section above), one of
     which silently regresses server-side sort/filter to a no-op for every non-owner
     shared-dashboard viewer — precisely the silent-wrong-ranking failure mode this ticket exists to
     fix, now reintroduced for a specific user population, with no error surface to reveal it
     (masked by the pre-existing, intentionally-silent D7 behavior looking identical from the
     outside).

### Non-blocking notes

- D9 (performance/indexing) and D2's `LANGUAGE sql IMMUTABLE` revision are well-reasoned and
  resolve round-1 CR1 cleanly on the subtransaction-cost dimension.
- D4's core structural idea (lift `activeSort`/`activeFilter` to `PanelCardBody`, thread
  `onSortChange`/`onFilterChange` down, wire `resetPanelPagination`'s first real call site) is the
  right shape and resolves the "no mechanism exists at all" half of round-1 CR2 — the gap found here
  is a real omission in how that new mechanism coexists with pre-existing, adjacent logic in the
  same functions, not a rejection of the overall approach.
