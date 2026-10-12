# HEL-1515: After HEL-1514: one shared step reference-check chain for create/update/duplicate; pin lane-check messages; audit updateStep descendant-lane cycles

## Description

These follow-ups came from HEL-1514 (matto00/helio#968, b5b5558bc). That change fixed silent cast edit loss (the owner chose the
row-hint option). It also made duplicate run create's three reference checks: secondary-source ownership (now closed per
the owner, 404), lane reference, and upsert target.

1. Create, update and duplicate each carry their own copy of the ownership -> lane -> upsert check chain. Extract one
   shared helper so they can't drift. Keep the behaviour unchanged.
2. The lane-check tests in `DuplicateStepReferenceChecksSpec` assert only the status code. The spec says "same status
   and message" as create, so pin the message too.
3. **Audit:** `PipelineStepWrites.updateStep` checks lane references only against ancestors. A lane reference to a
   descendant (a cycle) wasn't audited. Reproduce first.
4. `e2e/hel908-tail-attach.spec.ts` is still quarantined (HEL-951/HEL-962), so no e2e covers step duplicate.

## Acceptance Criteria (driver brief, owner-picked)

- AC1: One shared reference-check chain (ownership -> lane -> upsert) is used by create, update and duplicate.
  Behaviour-preserving: every existing status and message is unchanged, proven by the existing specs passing unmodified
  plus a mutation per stage.
- AC2: `DuplicateStepReferenceChecksSpec` lane-check tests pin the message, not just the status code.
- AC3: The `updateStep` descendant-lane-cycle question is reproduced first. If it's real, it's fixed with a test that fails
  first. If fixing it changes what users can do (a product call), it's escalated.
- AC4: Find out whether `e2e/hel908-tail-attach.spec.ts` can be un-quarantined now. If yes, un-quarantine it. If not,
  report why and leave the quarantine and HEL-951/HEL-962 alone.

## Driver constraints

- Red first where behaviour changes. New specs use `VerifiedEmbeddedPostgres.start`. `[hel1468-guard]` must appear in
  sbt runs. No inline FQNs.
- Identity: every probe registers its own throwaway @example.test user, records its id, and verifies via /api/auth/me.
  Never act as matt@helio.dev.
- No claude.ai session link and no Claude-Session trailer in commits or PR bodies.
