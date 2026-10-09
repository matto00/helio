# HEL-1347: data_sources.owner_id has no foreign key — deleting a user leaves orphaned data sources

## Description

origin_kind: followup
origin_ticket: HEL-1336

HEL-1336's evaluator found that `data_sources.owner_id` has no foreign key to `users`. Deleting a user does not cascade to, and is not blocked by, that user's data sources. Twenty `data_sources` rows were orphaned this way before the lane deleted them by exact id. The same hazard applies to any user deletion, including the account deletion HEL-1301 is considering.

Verify against main. Check the other `owner_id` columns too, for example pipelines, outputs and connectors.

## Acceptance Criteria

* Inventory every `owner_id` / user-reference column and its FK or `ON DELETE` behaviour.
* For `data_sources`: decide between a CASCADE and a RESTRICT FK. **That is a data-lifecycle decision for the owner.** Also decide how to handle existing orphans, which need cleanup by exact id before the FK can be added. The migration would be V117 or later.
* Also note: `audit_events` rows for deleted users cannot be removed, because a trigger blocks DELETE (HEL-471). That is intended, but it should be documented as permanent residue for test users.

## Related

HEL-1336, HEL-1301, HEL-471. Labels: Follow-up, Bug. Priority: Medium.
