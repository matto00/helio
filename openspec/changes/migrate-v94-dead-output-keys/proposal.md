## Why

Migration V94 (HEL-904) and HEL-877 left Output `config` keys that no renderer reads (`metricLabel`, `chartAnnotation`,
`timelineOptions`, ...). Outputs migrated from panels silently lost their label, unit, annotation, timeline sort and
collection layout. HEL-1313 now rejects writing these keys but tolerates the stored ones. The owner ruled (2026-10-08)
to repair the stored data with a Flyway migration.

## What Changes

- New migration `V117__migrate_v94_dead_output_config_keys.sql` (version assigned by the driver):
  - renames each dead key to its live equivalent (`metricLabel`→`label`, `metricUnit`→`unit`,
    `chartAnnotation`→`annotation`, `collectionOptions.layout`→`layout`, `timelineOptions.sort`→`sort`) when the
    Output's kind accepts the live key, the dead value is non-null and passes the live key's shape guard, and the live
    key is absent or JSON null. Otherwise the dead key is dropped;
  - drops every dead key with no live equivalent, every dead key shadowed by a non-null live key, and every
    V94-written key the Output's kind does not accept (`format`/`columnOrder`/`chartOptions` on the wrong kind);
  - records every changed key and its prior value in a permanent audit table `hel1387_dropped_output_config_keys`;
  - is idempotent and RLS-safe under the non-BYPASSRLS, table-owning `helio` role.
- Tests: real-dump migration spec (pre-V94 fixture through V117), run as a non-superuser role; re-run idempotency;
  HEL-1313 validation accepts a migrated config round-tripped unchanged.

## Capabilities

### New Capabilities

### Modified Capabilities
- `outputs-model`: adds the requirement describing what migration V117 does to V94/HEL-877 dead Output config keys.

## Impact

- Prod data rewrite of `outputs.config` (dev measurement: 2 affected Outputs out of 2212).
- New admin-only table `hel1387_dropped_output_config_keys`: FORCE RLS plus a `_deny_all` policy, and an explicit
  `GRANT SELECT` to `helio_privileged` (V105 `oauth_states` pattern).
- No API, schema or frontend change.

## Non-goals

- Rewriting `patch_set_applications` journals (see design Risks).
- Moving chart styling (`legend` etc.) onto panel `appearance.chart`.
- Restoring values that live editor defaults now shadow (owner ruling: never overwrite a non-null live key).
