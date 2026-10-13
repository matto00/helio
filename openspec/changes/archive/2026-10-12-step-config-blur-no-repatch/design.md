## Context

All three inputs are controlled `TextField`s whose `onChange` already calls the op's change handler on each keystroke
(`ConvertFormatConfig.tsx:119`, `ComputeFieldConfig.tsx:66/81`, `UpsertSourceConfig.tsx:186`). The `onBlur` on the
next line (`:120`, `:67/:82`, `:187`) calls the same pure handler with `e.target.value`, which equals the value already
emitted. The handlers flow to `stepCardOpHandlers.ts` (`onConvertFormatChange` → `emitOrPersist`,
`onUpsertSourceChange` → `persist(…, true)`) and `stepCardFieldHandlers.ts` (`onComputeChange` → `persist`).
`useStepCardPersist.persist` re-arms a 400 ms debounce on every call and PATCHes unconditionally, so a blur after the
first debounce has fired produces a second identical PATCH. `onBlur` was added with each component (HEL-1102 upsertsource,
HEL-1109 convertformat, compute pre-HEL-635); no commit message or comment gives a reason for it.

## Goals / Non-Goals

**Goals:** blur never re-emits config from these inputs; tests pin it; live probes prove it before and after.

**Non-Goals:** dedupe in the persist hook; debounce timing; flushing pending saves on unmount (see proposal Non-goals).

## Decisions

**D1 — Remove the `onBlur` re-emit rather than dedupe in `useStepCardPersist`.** The ticket offers both. A dedupe guard
changes the hook's wire behaviour that `useStepCardState.characterization.test.ts` pins, and comparing against "last
persisted config" needs extra state plus a rule for failed saves (a rejected upsertsource save that the user re-emits
should still retry). Removing `onBlur` is local, behaviour-preserving for every keystroke path, and fixes the root cause
named in the ticket. Alternative rejected: keep `onBlur` but skip when value unchanged — same effect with more code.

**D2 — Removing blur does not strand any path.** Draft (temp-id) cards: `emitOrPersist` calls `onConfigChange`
synchronously on every change, so the draft-create trigger in `usePipelineStepMutations.handleStepConfigChange` (`usePipelineStepMutations.ts:52`; deferred create applies only to `requiresCompleteConfigForCreate` AI kinds) never relied
on blur. Validation: nothing in these three components renders from blur state (unlike `AggregateConfig:252`, which only
sets local touched state and is out of scope). Executor must verify both claims in code and note it in the commit.

**D3 — Scope is set by enumeration and live probing, not by the ticket title.** The executor re-greps every
`onBlur` under `frontend/src/features/pipelines` (and any other step-config editor location) and probes each candidate
live against the worktree's own dev/backend servers (throwaway `@example.test` user, deleted by exact (id, email) via
`e2e/support/userCleanupCore.cjs` `buildUserDeleteSql`). A field enters scope only if the before-probe shows the
duplicate PATCH; a candidate that does not reproduce is documented, not changed.

**D4 — Tests.** Invert `ComputeFieldConfig.test.tsx` "calls onChange on blur of column name input" to "blur does not
call onChange"; tighten `ConvertFormatConfig.test.tsx`'s change-then-blur case to `toHaveBeenCalledTimes(1)`; add
equivalent cases for compute "Expression" and upsertsource "New source name". Add a StepCard-level test (fake timers,
mocked `updatePipelineStep`) for change → advance past debounce → blur → advance: exactly one call. Each new/changed
assertion must be shown red against the pre-fix component (revert the `onBlur` removal temporarily, record the failure).

## Risks / Trade-offs

- [A browser path where onChange does not fire but blur does, e.g. some autofill] → React's controlled `onChange`
  listens to `input` events, which autofill and paste fire; probe paste in the live run if cheap.
- [A pending debounced save is lost if the card unmounts within 400 ms] → pre-existing, unaffected by this change
  (blur re-armed the same timer that unmount clears); file a follow-up only if the executor confirms it live.

- [Upsertsource loses an accidental retry: today a blur after a failed save re-sends the same PATCH and clears the
  error; after the fix a transient 5xx/network failure stays shown until the name is edited (a 422 fails again anyway)]
  → accepted; state it in the commit message and PR body. This also means the proposal's "dedupe would block a retry"
  argument applies equally to blur removal; D1 rests on locality and the characterization contract instead.

## Planner Notes

- Self-approved D1 (smaller of the two options the ticket lists); no escalation needed: no API, schema or dependency
  change, scope is three components.
- No migration; V129 is not needed.
