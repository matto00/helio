## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 67cf9e0e0451b781be463e82db25c57a8c8795bf. The change dir is untracked planning artifacts: ticket.md,
proposal.md, design.md, tasks.md, specs/stored-object-lifecycle/spec.md.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/form-assistant-blob-cleanup/HEL-1530`.
- **V132 number:** `git ls-tree origin/main` lists V130 as the highest migration. `gh pr diff --name-only` for the open
  PRs: #994 adds `V131__patch_set_applied_proposals.sql`, and #996, #991, #990 and #986 add no migration. No sibling
  worktree has anything past V131. The claim holds. Task 1.1 re-checks it before push.
- **Postgres semantics.** I tested these on a scratch PG 18.4 cluster I started myself (not the shared dev DB). CI
  uses PG 16 and every feature involved has existed since PG 11.
  - An AFTER DELETE `FOR EACH STATEMENT` trigger with `REFERENCING OLD TABLE` fires under an FK `ON DELETE CASCADE`
    from `DELETE FROM users`. It ran as a NOSUPERUSER NOBYPASSRLS role with the RLS context unset, on FORCE-RLS
    tables. The SECURITY DEFINER function was owned by a BYPASSRLS role with `row_security = off`. Both form keys
    were queued. **Confirmed.**
  - `BEFORE TRUNCATE FOR EACH STATEMENT` on a grandchild fires for `TRUNCATE users CASCADE`: queued 1. After
    `ROLLBACK` the count was 0. `TRUNCATE users, q CASCADE`, which also truncates the queue, raises no error.
    **Confirmed.**
  - `jsonb_path_query(x, 'lax $.**.storageKey')` returned no error on `null`, nested empty arrays, a bare string,
    `1e300`, a numeric `storageKey`, a null `storageKey` and top-level arrays. The regex filter rejected
    `assistant-conversations/...`, `form-uploads/zzz` and plain strings. **Confirmed.**
- **Code facts in design.md Context:** these match the tree.
  - `PanelFormFileSubmission.storeFormFiles` writes `form-uploads/<uuid>.<ext>`.
  - The ext comes from `FormUploadConfig.extensionOf`, lowercased, with a 12-entry allowlist, so it fits `[a-z0-9]{1,16}`.
  - The pinned test is at `FormSubmitRoutesSpec.scala:541`.
  - The guard (`StoredObjectDeletionRepository.isReferenced`) checks only `image_uploads` and `data_sources`.
  - `gcs_body_ref` is stable across transcript updates (`AssistantConversationService:101-102`).
  - `assistant_conversations.owner_id` is NO ACTION (V80:20).
  - `binary_refs` copies any `storageKey` map (`PipelineRunSucceededWrites:332`).
  - Dataset rows are rewritten by DELETE + INSERT in replace and schema migration
    (`DataSourceRepository:731-732, 1060-1061`) and by UPDATE in `patchRow` (`:785`).
- **Security premise:** `DatasetRowValidator.validateValue` accepts ANY `JsObject` for a `BinaryRefType` field
  (`DatasetRowValidator.scala:74`) and any `JsString` for a string field. Row JSON really is user-writable with
  arbitrary `storageKey` values and arbitrary key strings. This confirms that D2's regex is load-bearing. It also
  exposes the gap in CR1 below.
- **Timeouts:** `grep statement_timeout|lock_timeout|queryTimeout backend/src/main` finds none in the app DB config
  (only Hikari `connectionTimeout = 5000` and a connector-driver `setQueryTimeout(30)`).
- **Deploy shape:** `cd-backend.yml` and `deploy-backend.sh` use `--no-cpu-throttling`, `--min-instances=0` and
  `--max-instances=2`. CPU is always allocated, so an old-revision instance keeps running its scheduler tick for as
  long as it is alive after V132 is applied.

### Verdict: REFUTE

### Change Requests

1. **D5 makes `dataset_rows` "Authoritative" for keys that D2 never re-queues, so the claimed invariant is false
   and the result is a permanent leak that users can trigger.** D5 dequeues an Authoritative hit "because that row's
   own delete will queue the key again". But D2's trigger re-queues only `storageKey` values that match the
   form-upload regex. Two other hit types match D5's guard and are never re-queued:
   - D5's `strpos(data::text, '"'||key||'"')` match on `dataset_rows.data` also hits `images/...`,
     `assistant-conversations/...` and data-source paths.
   - It also hits bare string values that are not under `storageKey`.

   Any user can write `{"storageKey":"images/<victim-id>.png"}` into a binary-ref field, or the bare key into a
   string field (`DatasetRowValidator.scala:74`). When the victim deletes the upload, the guard sees an
   Authoritative `dataset_rows` hit and dequeues. When the attacker's row is deleted, D2 queues nothing. The object
   leaks forever. That contradicts AC3 ("not leaked once the copy goes away") and the new spec requirement "SHALL be
   removed once no table holds it". A pipeline write-back of an image binary-ref into a dataset gets the same result
   with no attacker involved.

   **Required:** define the `dataset_rows` Authoritative test with exactly the trigger's extraction: a `storageKey`
   value reached by `lax $.**.storageKey`, of string type, matching the form-upload regex. Any other textual hit in
   `dataset_rows` must be classed as DerivedOnly (deferred) or ignored. Add a spec scenario and a 3.2 test: an
   image key copied into a dataset row is kept while the row exists and deleted after the row is deleted.

2. **D8's rolling-deploy guard covers a 300 s window that nothing shows is long enough, and it does not cover D7 or
   deferred entries. An old drain in the overlap can delete objects that are still referenced (data loss, not a
   leak).** The V128-era drain checks only `image_uploads` and `data_sources`, and V132's triggers are live as soon
   as Flyway applies V132 at new-revision boot. Normal operations then go wrong:
   - `replaceRows` and `updateDatasetSchema` DELETE + re-INSERT rows that keep their file values
     (`DataSourceRepository:731-732, 1060-1061`). Each queues keys that the re-inserted rows still hold. Once the
     300 s lease lapses, any old-revision instance still ticking claims those rows and deletes live objects.
   - D7's enqueue is application code, not a V132 trigger, so it is not covered at all (`claimed_at` NULL).
     An old drain ignores `not_before` and deletes a failed-append key immediately, including when the row committed.
   - A D5 deferral clears `claimed_at`, so a deferred key can be claimed and deleted by an old drain at once.

   With `--no-cpu-throttling`, an old instance ticks for as long as Cloud Run keeps it alive. No evidence bounds that
   time, or the time from boot to the traffic switch, below 300 s.

   **Required, either:**
   - (a) Make new-semantics rows **unclaimable by V128 code for any duration**, and update D6 and D5's defer step to
     match. For example: every V132 trigger insert, D7's `enqueue` and D5's `defer` set `claimed_at = 'infinity'`,
     which V128's `claimed_at < stale` can never pass. The new claim gates on `not_before` and treats `'infinity'`
     as unleased.
   - (b) Use an equivalent marker that the old claim predicate provably excludes.

   Add a task and test that run the **V128 claim SQL verbatim** against these rows and assert it claims none. The
   OWNER REVIEW section must state the overlap behaviour accurately.

3. **D7's grace-window rationale is factually wrong.** "900 s is far longer than any statement or lock timeout"
   assumes timeouts that do not exist: no `statement_timeout` or `lock_timeout` is configured for the app DB
   (grep of `backend/src/main`). The conclusion may still hold, because a Slick future completes only after its
   transaction commits or rolls back, and a client-side connection loss before COMMIT can never commit afterwards.
   That is the argument the design must make, and design.md must state it, because the owner reads this rationale
   to judge a prod-deleting change.

   **Required:**
   - Replace the rationale with the actual one, or add a bounded timeout for the append transaction.
   - Name the post-commit failure source this design handles: `triggerAutoRunAwaited` in
     `DataSourceService.appendFormRow:930` can fail after the row committed. That is the "committed-then-failed"
     case 3.3 must exercise, so cite it.

### Non-blocking notes

- `alert_events.value` (V61) can hold a cell value, so a binary-ref object could end up there, and the guard
  doesn't check it. That is another derived-copy table outside the guard's list. If a dangling copy there is
  acceptable, list it as a known gap.
- `binary_refs` rows with `pipeline_id IS NULL` (legacy, V98:169) never go away, so a key held only by one of them
  stays deferred forever, with one re-check an hour. That is a harmless leak; document it in the OWNER REVIEW
  section.
- D5's "batched per table per pass" combined with sequential deletes widens the window between the guard check and
  the delete. The design already accepts this for snapshots. Note that a user insert of a just-deleted form key
  cannot be prevented either; the result is a dangling copy, never a wrong delete of a referenced row, because
  that row was gone at check time.
- tasks.md has no task for the PR body's OWNER REVIEW section or for the `README.md` updates under
  `services/sources/`, `services/panels/` and `infrastructure/persistence/sources/`, which all describe HEL-1434's
  coverage. Add both so they are gated.
