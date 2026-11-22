# HEL-1802: Deleting a test user leaves its assistant-conversation files on disk (313 orphan upload folders locally)

## Description

Assistant conversations are stored as files under the uploads root, at
`assistant-conversations/{userId}/{conversationId}.json` (`AssistantConversationService`). Deleting a test user
removes only the database rows. The procedure for that is `buildUserDeleteSql` by exact id, and lane databases are
also dropped at Delivery. The files stay.

On the owner's machine on 2026-11-20, `~/.helio/uploads/assistant-conversations` held 329 user folders. 313 of them
have no matching user in the dev database, and 66 were created that day by delivery lanes' e2e and verification runs.

## Do

* Check how production deletes a user. Does account deletion remove that user's stored conversation files (and any
  other per-user upload paths)? If it doesn't, that is a real defect: fix it or split it out, and raise its priority.
* Make test-user cleanup (`buildUserDeleteSql` callers and the concertino lane cleanup) remove that user's upload
  folders too.
* Add a dry-run-first prune script for existing orphans. It must:
  * list only folders whose user id is in no given database;
  * delete nothing without an explicit flag;
  * never match by pattern, only by exact id.

## Acceptance criteria

- [ ] A test that fails on the current code: deleting a user who has a conversation leaves no folder for that user.
- [ ] The prune script's dry run lists the orphans and changes nothing.
- [ ] The production account-deletion behaviour is documented in the PR.

## Premise validation (orchestrator, 2026-11-22)

See `.concertino/runs/HEL-1802/evidence/premise-validation.md`. Verdict minor-staleness: production has NO account
deletion (no route or service deletes a `users` row). Conversation FILES are already queued for deletion when their
row is deleted (V132) and drained on the scheduler tick; what stays locally is the empty `{userId}/` directory
(297 of 331 folders in the owner's root are empty), plus files whose queue row was never drained against that root
(lane DB dropped, different root) or that predate V132. Only `assistant-conversations/` is keyed per user; every other
upload family is flat and keyed by object id. The concertino lane cleanup lives in the concertino repo (rendered,
gitignored here) and goes to a CON follow-up, not this change.
