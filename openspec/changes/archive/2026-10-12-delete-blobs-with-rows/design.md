## Context

Stored objects (local files under `HELIO_UPLOADS_ROOT`, or GCS objects in `HELIO_UPLOADS_BUCKET`, behind the
`FileSystem` trait) back two kinds of row: `image_uploads.storage_key` (`images/<uuid>.<ext>`) and the `config.path`
of `data_sources` rows of kind csv/text/pdf/image (`csv/<id>.csv`, `text/<id>.<ext>`, `pdf/<id>.<ext>`, image).

### Delete-path inventory (AC1; verified against origin/main 4d3755079)

| Path | Rows removed | Object today |
|---|---|---|
| `DataSourceService.delete` (route, patch-set undo, apply rollback, inline-source compensation) | one file-backed source | deleted, but BEFORE the row delete; a failed row delete (P0001 race) leaves a row pointing at a deleted file |
| `WorkspaceTeardownService.teardown` | tagged sources | deleted post-commit (HEL-366) |
| `SourceService.cleaningUpOnFailure` | rest/sql/static rows only | n/a (no file) |
| HEL-1494 `compensatingFileCreate` | a fresh file-backed source | deleted (row first, then object) |
| `DELETE FROM users` (V119 `ON DELETE CASCADE`; run by e2e `userCleanupCore.cjs` and manual ops — there is no app user-delete path) | that user's `data_sources` and `image_uploads` | **leaked** |
| V119's one-time orphan cleanup (already applied in dev/prod) | orphaned sources and uploads | **leaked** (historic) |
| image_uploads direct delete | — | no such path exists (no repository delete, no endpoint) |
| Raw SQL deletes (ops) | any | **leaked** |

Related create-side leaks (write object, then insert row, no compensation): `ImageUploadService.upload`,
`AssistantConversationService.create`. `PanelFormFileSubmission.storeFormFiles` writes N objects before an in-lock
row append (to be probed; see Decision 5).

## Goals / Non-Goals

**Goals:** every committed delete of an `image_uploads` row or a file-backed `data_sources` row, by any path including
a cascade from `users` and raw SQL, eventually removes its stored object; no object still referenced by a surviving
`image_uploads` row or file-backed `data_sources` row, and nothing mid-upload, is ever removed (copies of image-source
keys held in `binary_refs`, node snapshots and history payloads are not checked — today's eager delete already leaves
those dangling; listed as a known gap, not a regression); read-only measurement of existing orphans; the two small create-side leaks closed.

**Non-Goals:** deleting historic orphans (V119 / pre-existing) in any environment — prod deletion is owner-owned and
gets a follow-up with the measured counts; form-upload objects referenced from `dataset_rows` binary-refs and
assistant-conversation blobs on conversation/user delete (follow-ups); an app-level account-deletion feature
(HEL-1301's design); any API or `schemas/` change.

## Decisions

### Decision 1 — A trigger-written deletion queue, drained on the scheduler tick

Migration `V128__stored_object_deletions.sql` (re-check the next free number before committing) creates
`stored_object_deletions (id bigserial PK, storage_key text NOT NULL, source_table text NOT NULL, enqueued_at
timestamptz NOT NULL DEFAULT now(), attempts int NOT NULL DEFAULT 0, last_attempt_at timestamptz NULL)` and
`AFTER DELETE ... FOR EACH ROW` triggers (set `ENABLE ALWAYS`, like V99/V122, so a delete under
`session_replication_role = replica` still enqueues) on `image_uploads` (enqueue `OLD.storage_key`) and on `data_sources`
(when `OLD.source_type IN ('csv','text','pdf','image')`, enqueue the key
`COALESCE(NULLIF(OLD.config->>'path',''), NULLIF(OLD.config->>'filePath',''))` if non-null). `config` is JSONB (V33).
The `filePath` fallback is required: `DataSourceConfigCodec.decodeCsv` still reads a legacy HEL-237 `filePath` key that
no migration renamed, so a trigger reading only `path` would leak every legacy CSV row's object.

Why: the cascade happens inside Postgres, so only the database sees every delete. A row trigger fires for cascaded
deletes, for raw SQL, and for every service path; it is transactional, so a rolled-back delete enqueues nothing,
and a committed one cannot lose its key. The queue holds exactly the keys of rows that were deleted, so it can never
name an in-flight upload (an upload's key is a fresh UUID whose row either exists or never existed) — this is the
"safe against in-flight uploads" property the ticket asks for, by construction rather than by a time window.

*Alternative rejected — delete before the cascade in a user-delete service path:* no such path exists; users are
deleted only by raw SQL. Building one is HEL-1301's account-deletion design.
*Alternative rejected — periodic orphan sweep (list the bucket, diff against rows):* needs an age window to be safe
against in-flight uploads, lists the whole bucket every pass, and would delete prod historic data the moment it
deploys (owner-owned). It stays as a one-off read-only measurement only (Decision 4).

**RLS:** `data_sources`/`image_uploads` have FORCE ROW LEVEL SECURITY; prod's runtime/Flyway role is NOSUPERUSER
NOBYPASSRLS, and dev/CI superusers mask every RLS defect (MISTAKES.md). The trigger must enqueue successfully when the
delete runs (a) as an RLS-bound app session with `app.current_user_id` set (service path) and (b) as a cascade from
`DELETE FROM users` with `app.current_user_id` unset. Posture (fixed, not the executor's choice): the trigger function is
`SECURITY DEFINER` with `SET search_path = pg_catalog, public` and `SET row_security = off`, re-owned to
`helio_privileged` (BYPASSRLS) with V100/V122's exact bracket (transient `GRANT CREATE` on the schema,
`ALTER FUNCTION ... OWNER TO helio_privileged`, revoke) plus explicit idempotent grants. The queue table has
ENABLE + FORCE ROW LEVEL SECURITY and NO policy, so only `helio_privileged` (the scheduler's privileged pool, BYPASSRLS)
and the definer trigger can touch it; the RLS-bound app role cannot read or write it directly. The existing
`pipeline_auto_run_debounce` / `pipeline_run_rate_window` tables are NOT a precedent: their FORCE RLS policies key on
`app.current_user_id`, so a trigger insert shaped like them would fail or be filtered and could abort the user's own
delete, which is worse than the leak. The queue is never exposed by any route.

### Decision 2 — The drain

A `StoredObjectDeletionService` (services layer) with a `StoredObjectDeletionRepository` (persistence layer, the same
privileged/system DB access `PipelineSchedulerService`'s other tick passes use) runs one bounded pass per scheduler
tick, wired into `PipelineSchedulerService.runPasses` nullable-optionally and DETACHED like HEL-1272/HEL-1477's retention
pass (started, not awaited, with an in-flight guard so at most one drain pass runs per process, and a `.recover` that
logs) — storage deletes over the network must never delay scheduled fires. The service exposes the pass as a
`Future` so specs await the pass itself, not the tick:

1. Claim up to a fixed batch (e.g. 100) of queue rows, oldest first, skipping rows at an attempt cap (e.g. 10),
   with a short claim transaction that sets a `claimed_at` lease (`FOR UPDATE SKIP LOCKED` inside the claim only; rows
   whose `claimed_at` is younger than 300 s are skipped, matching the existing lease precedent; a failed attempt clears
`claimed_at`; a row is retried only once `last_attempt_at` is older than an exponential backoff (60 s x 2^(attempts-1),
capped at 1 h), so the attempt cap of 10 spans hours of a storage outage rather than ~5 minutes), so no transaction stays open across a GCS call and two Cloud
   Run instances never double-process a row. (Add `claimed_at timestamptz NULL` to the table.)
2. For each key: if any surviving `image_uploads.storage_key` or file-backed `data_sources` key (the same
   `COALESCE(path, filePath)` expression as the trigger) still equals it, dequeue without deleting (a shared/duplicated key is never removed while referenced). Otherwise
   `FileSystem.delete(key)` (idempotent: `Files.deleteIfExists` / GCS `storage.delete` returning false on a missing
   object) and dequeue only after it succeeds.
3. On a delete failure: increment `attempts`, set `last_attempt_at`, keep the row, log the key and exception class
   only (`ImplicitConnectorCleanup.describeFailure` style) — never fail the tick.

The object delete goes through one reusable helper (lift HEL-1494's private `DataSourceService.deleteStoredObject`
into a small shared helper both services use, instead of copying it).

### Decision 3 — `DataSourceService.delete` deletes the file after the row

`deleteAfterPrecheck` currently deletes the file first. Move the object delete to after `dataSourceRepo.delete`
succeeded (via the shared helper), so the zero-root race recover (or any row-delete failure) leaves the row AND its
file. The queue also enqueues this key; the drain's delete then finds nothing — harmless. The eager delete stays so
an interactive delete frees the object immediately. Teardown is unchanged (already post-commit).

### Decision 4 — Measurement (AC3), read-only

Before any implementation, measure dev: count objects under the dev uploads root (read-only listing, `images/`,
`csv/`, `text/`, `pdf/` and the image-source prefix) whose key no row references, and rows whose object is missing.
Never read or print `backend/.env`; if the dev root/DB cannot be resolved without it, record that and measure what is
reachable. Record numbers and the exact commands in `measurements.md` in this change. For prod, write the read-only
SQL and the GCS listing procedure for the owner (no prod access from this lane) and file a follow-up for the owner to
run it and decide any cleanup by exact key. This change deletes no historic orphan anywhere.

### Decision 5 — Create-side compensation

`ImageUploadService.upload` and `AssistantConversationService.create`: when the row insert fails after the object
write, delete the just-written object (shared helper) and re-raise the original failure unchanged; a cleanup failure
is logged and never replaces it — the HEL-1494 shape. `PanelFormFileSubmission`: probe; if a failed/rejected
in-lock append demonstrably leaves objects and the fix is the same small shape, fix it; otherwise record it as a
follow-up with the probe evidence.

### Decision 6 — Proof

New specs use `VerifiedEmbeddedPostgres.start`, real repositories, a `LocalFileSystem` rooted in a fresh temp dir,
and the repo's GCS test double (a Mockito `Storage` mock behind `GcsFileSystem`) for the GCS variant.
`[hel1468-guard]` must appear in the sbt output. Queue rows are always read through the superuser or the privileged
(`helio_privileged`) connection — never by adding a policy (the queue has none by design).

**Red-first means a behavioural failure, never a compile failure.** On the pre-fix tree no queue table, repository or
service exists, so red-first specs drive only entry points that already exist: create the object (real service, or
`FileSystem.write` + row insert), delete by the real path, run one existing `PipelineSchedulerService.tick()` (every
later constructor argument is optional, so the pre-fix copy compiles without the drain parameter; after the fix the
spec awaits the drain pass itself, see Decision 2), then assert the object is gone. Red = object still present.

Every proof below is labelled with exactly one kind:

**[RED-FIRST]** — fails on the pre-fix tree, passes after:
- R1 `DELETE FROM users` for a throwaway user owning an image upload and a csv source plus at least one of
  text/pdf/image → every object gone after the drain (local; and GCS double).
- R2 Raw `DELETE FROM image_uploads WHERE id = ...` (V119-style) → object gone after the drain.
- R3 Legacy csv row whose config carries only `filePath`, deleted by `DELETE FROM users` → object gone.
- R4 `DataSourceService.delete` with the row delete forced to fail → row and file both remain (pre-fix: file deleted).
- R5 `ImageUploadService.upload` with the insert failing → object gone, original error surfaced.
- R6 `AssistantConversationService.create` with the row create failing → object gone, original error surfaced.

**[MUTATION]** — green on the pre-fix tree by construction (the queue does not exist yet); proved by the named
mutation, each run and shown red, then reverted:
- M1 Shared key: two rows reference one key, delete one → object kept; delete both → gone. Mutation: remove the
  shared-key check → red.
- M2 Legacy key in the shared-key check: a surviving `filePath`-only csv row protects its key. Mutation: the check
  reads only `path` → red. (The same mutation applied to the trigger turns R3 red.)
- M3 Drain failure: `FileSystem.delete` fails → row kept, `attempts` incremented, `claimed_at` cleared, tick completes.
  Mutation: stop incrementing `attempts` → red.
- M4 RLS, owner-role: as a NOSUPERUSER NOBYPASSRLS role that OWNS the tables and ran the migrations
  (`V119OwnerFkMigrationSpec.scala:46-59` shape), (a) with `app.current_user_id` set, delete the user's own csv source;
  (b) `DELETE FROM users` with it unset (cascade). Assert the OUTER delete commits and the key is queued. Mutations,
  each listed separately with its observed red:
  - M4.i drop `SECURITY DEFINER` → red at least on (a); record what (b) actually does (do not assume).
  - M4.ii leave the function owned by the migrating role (skip the re-own bracket) → expect `42501` on the queue insert.
  - `row_security = off` alone is NOT a mutation target: with `helio_privileged` (BYPASSRLS) as owner, dropping it is a
    no-op per V100's header. It stays as a belt-and-braces setting whose relevance is covered by M4.ii.
- M5 Lease: a row with a fresh `claimed_at` is skipped by a second concurrent claim; a row whose lease is older than
  300 s is reclaimed. Mutation: drop the lease filter from the claim → red.

**[GUARD]** — regression guards, green before and after; no meaningful mutation exists for the first three, the last
two are proved by the stated mutation:
- G1 A rolled-back delete queues nothing and keeps the object (Postgres transactional semantics; no mutation).
- G2 Workspace teardown still removes the object (existing behaviour).
- G3 The normal `DataSourceService.delete` still removes the object.
- G4 A non-file source (e.g. static/rest) enqueues nothing. Mutation: drop the `source_type IN (...)` gate → red.
- W1 Wiring (design-gate r3 note 1): a spec in the style of `PipelineSchedulerServiceDetachedRetentionSpec` proves
  `tick()` starts the drain pass and `Main.scala` passes the service. Mutation: unwire the drain from `runPasses` → red.
  The final gate also checks it live with a throwaway user.
- G5 Trigger `ENABLE ALWAYS`: a delete under `session_replication_role = replica` still enqueues. Mutation: plain
  `ENABLE` → red.

## Risks / Trade-offs

- **Prod data:** once deployed, prod objects of rows deleted from then on are removed automatically (including by an
  owner's manual `DELETE FROM users`). That is the ticket's intent but is automated prod deletion, so the PR carries
  an OWNER REVIEW section and parks for the owner rather than auto-merging.
- **Queue growth if the drain is never wired** (e.g. scheduler disabled): rows accumulate harmlessly; measured by a
  `count(*)`.
- **Trigger cost on bulk deletes:** one insert per deleted file-backed row; negligible at this scale.
- **Path stored in config JSON:** the trigger depends on the config shape (`path`, legacy csv `filePath`); pinned by the
  trigger spec for each kind and the legacy shape.
- **Refresh racing a delete:** a csv/text/pdf/image refresh that re-writes the object after the drain removed it
  recreates an orphan. A leak, never unsafe; known gap.
- **`TRUNCATE`** fires no row triggers, so a truncate of either table still leaks; known gap (no app path truncates).
- **Shared dev DB Flyway collision:** another lane taking V128 would collide on the shared dev DB; re-check before
  applying and before commit.
- **Dev only:** worktrees with different `HELIO_UPLOADS_ROOT`s share one dev DB, so whichever backend drains a queue
  row deletes in its own root; harmless in dev, impossible in prod (one bucket).
