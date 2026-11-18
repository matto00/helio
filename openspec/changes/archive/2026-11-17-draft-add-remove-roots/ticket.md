# HEL-1734: Live draft preview (i): add and remove roots inside a draft (save body, fingerprint, lock protocol, undo, draft-root samples)

## Description

Split out of HEL-1684 by owner ruling (split-as-proposed). This ticket makes adding and removing roots (sources) draftable. Today they are blocked while a draft is open ("Save or discard your draft first", HEL-1631 ruling).

The atomic save does not accept root changes: HEL-1629 listed root edits as a non-goal. This needs backend work first, so it gets its own design and skeptic gate.

## Scope

* Extend `POST /api/pipelines/:id/draft/save` to accept root add and remove.
* Include roots in the pipeline fingerprint, so the stale-base 409 covers them.
* Extend the verified lock protocol (G1-G3) to the roots writes.
* Extend the undo journal, so undo re-applies the prior roots.
* Draft-root sample access. `GET /api/data-sources/:id/sample?pipelineId=P` serves an editor only a source that is already a root of P, so today an editor's draft root has no preview frames.
* Then the client: draft model, kept draft, draft preview.

## Acceptance Criteria

* Root add and remove work inside a draft, and are applied atomically on Save & run or thrown away on Discard.
* Kept-draft restore and the stale-base path still work.
* Desktop and phone, light and dark, with e2e coverage per action that fails first.

## Driver context (claims to verify)

* Flyway: if a migration is needed, use V143 (V140 HEL-1755, V141 HEL-1740, V142 reserved HEL-1742). Shared dev DB has V140 applied and no outOfOrder: use a lane-private DB (createdb helio_hel1734, DATABASE_URL override on start-servers.sh) and drop it at Delivery. Just before merge, renumber to origin/main max+1 if needed.
* Concurrent lanes: HEL-1755 (assistant model picker; assistant/chat, Settings, V140), HEL-1740 (new `insight` Output kind; backend model.scala OutputKind and frontend kind enums in pipelines.ts, outputs.ts, pipelineProposal.ts, types.ts). Keep any diff to those files minimal and report it.
* Draft preview never calls a model; no live model calls needed.
