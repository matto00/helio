# User-reference inventory

Every column that references a user, what happens to it when the user row is deleted, and what a `DELETE FROM users`
now reaches. Written for HEL-1347 (V119 bound `data_sources` and `image_uploads` to their owner) and as input to the
account-deletion design (HEL-1301). **No application code deletes users today**; this describes the database's
behaviour, not a feature.

## Foreign keys referencing users

One row per foreign key whose target is `users(id)`. This table is parsed by `V119OwnerFkMigrationSpec`, which compares
it to the foreign keys of a fully migrated database, so it goes red when this list drifts from the schema. Keep the
three columns and the `| Table | Column | ON DELETE |` header exactly.

| Table                         | Column       | ON DELETE |
| ----------------------------- | ------------ | --------- |
| `agent_memory`                | `owner_id`   | CASCADE   |
| `agent_preferences`           | `user_id`    | CASCADE   |
| `alert_events`                | `owner_id`   | NO ACTION |
| `alert_rules`                 | `owner_id`   | NO ACTION |
| `api_tokens`                  | `user_id`    | CASCADE   |
| `assistant_conversations`     | `owner_id`   | NO ACTION |
| `assistant_daily_usage`       | `user_id`    | NO ACTION |
| `authoring_conversations`     | `owner_id`   | NO ACTION |
| `connector_completion_tokens` | `user_id`    | CASCADE   |
| `connector_credentials`       | `user_id`    | CASCADE   |
| `connectors`                  | `owner_id`   | CASCADE   |
| `dashboards`                  | `owner_id`   | NO ACTION |
| `data_sources`                | `owner_id`   | CASCADE   |
| `image_uploads`               | `owner_id`   | CASCADE   |
| `invite_codes`                | `user_id`    | NO ACTION |
| `mfa_backup_codes`            | `user_id`    | CASCADE   |
| `mfa_login_challenges`        | `user_id`    | CASCADE   |
| `outputs`                     | `owner_id`   | NO ACTION |
| `panels`                      | `owner_id`   | NO ACTION |
| `patch_set_applications`      | `owner_id`   | NO ACTION |
| `pipeline_run_rate_window`    | `user_id`    | NO ACTION |
| `pipelines`                   | `owner_id`   | NO ACTION |
| `product_events`              | `user_id`    | CASCADE   |
| `resource_permissions`        | `grantee_id` | CASCADE   |
| `share_tokens`                | `user_id`    | CASCADE   |
| `user_dashboard_zoom`         | `user_id`    | CASCADE   |
| `user_mfa`                    | `user_id`    | CASCADE   |
| `user_sessions`               | `user_id`    | CASCADE   |

`NO ACTION` blocks the whole `DELETE FROM users` statement (SQLSTATE `23503`) while any referencing row exists.
`CASCADE` deletes the referencing rows with the user.

## Indirect and non-FK user references

| Column                                                      | Reference                                         | Behaviour on user delete                                                                                                                                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pipeline_runs.triggered_by_token_id`                       | `api_tokens(id)`, `ON DELETE SET NULL`            | The user's tokens cascade away; the run keeps its row with the token id cleared.                                                                                                                         |
| `connectors.credential_id`                                  | `connector_credentials(id)`, `ON DELETE RESTRICT` | Both `connectors` and `connector_credentials` cascade from `users`. RESTRICT is checked immediately rather than at end of statement, so the outcome depends on which RI trigger fires first (see below). |
| `audit_events.actor_user_id`, `audit_events.actor_token_id` | none (V91)                                        | Rows are kept. See "Permanent audit residue".                                                                                                                                                            |
| `dashboards.created_by`, `panels.created_by`                | none, TEXT provenance                             | Left as-is.                                                                                                                                                                                              |
| `connectors.completed_by`                                   | none, TEXT principal (V103)                       | Left as-is.                                                                                                                                                                                              |

## What deleting a user now reaches

Since V119 (HEL-1347), `DELETE FROM users` cascades into `data_sources` (and from there `dataset_rows` and
`pipeline_roots`) and `image_uploads`. A `pipeline_roots` delete cascades further: `pipeline_steps`, `outputs` and
`binary_refs` (all via `root_id`), and from `outputs` to `panels`, `alert_rules`, `alert_events` and
`output_snapshot_history`. Only a lane's first step carries `root_id`; later steps hang off it through
`pipeline_steps.parent_step_id`, which is `NO ACTION`.

Each outcome below is pinned by `V119OwnerFkMigrationSpec` with an explicit lane length.

- **Blocked, nothing deleted:** a user who owns a dashboard, panel, pipeline, output, alert rule or event,
  conversation, patch-set, invite code, daily-usage or rate-window row (all `NO ACTION`).
- **Blocked, nothing deleted:** a cascade that would remove a pipeline's last root. For a one-step lane the V99 zero-root
  trigger raises (`P0001`); for a lane of two or more steps the `parent_step_id` foreign key fails first (`23503`).
  Which error surfaces depends on RI trigger order, so treat "rejected, nothing deleted" as the guarantee, not the code.
- **Blocked, nothing deleted:** a cascade into a root whose lane has two or more steps (`23503`), even when the
  pipeline has another root.
- **Silently reached (the cost of the CASCADE ruling):** if the deleted user's source is one of several roots of a
  pipeline owned by someone else, and that root's lane has at most one step, the root, its step, its Outputs, their
  alerts and history, and the dashboard panels bound to those Outputs are deleted from the other user's workspace; the
  pipeline and its other roots survive and the V99 trigger does not fire. Creating such a root through the API requires
  owning the source, so this needs legacy or directly-written data, but it is possible.
- **Dangling (not foreign keys):** another user's step `secondaryInput` or `upsertsource` target and form panel
  `dataSourceId` naming a deleted source, an image panel's `image_url` naming a deleted upload, and TEXT ids left
  in snapshot and history rows.
- **A user with a connector and its credential:** observed on a freshly migrated database, the delete succeeds and
  removes both. This is order-dependent behaviour of the RESTRICT check inside one cascade, not a guarantee; do not
  build on it without re-measuring.
- **Not cleaned up:** storage blobs (GCS or local files) behind deleted image uploads and CSV sources.

These are follow-ups for HEL-1301's account-deletion design. V119 itself never reaches any of this on deploy: its guard
aborts, before deleting anything, if a data source it would delete is still referenced.

## Permanent audit residue

`audit_events` is append-only (HEL-471): a trigger rejects `DELETE`, `UPDATE` and `TRUNCATE` on it, for every role
(the triggers fire regardless of session_replication_role). Its `actor_user_id` and `actor_token_id` are plain
columns with no foreign key, and rows about a user (`resource_type = 'User'`, `resource_id` = the user id) carry
the id as text. So when a user is deleted, their audit rows remain forever. This is intended: the audit trail must
outlive the actor. For test users it is permanent residue that cannot be cleaned up; do not try to delete it, and do not
count it as an orphan.
