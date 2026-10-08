## Why

V94 (HEL-904) copied V75's `metrics.format` JSON object (`{unit, decimals, prefix, suffix}`) verbatim onto metric-bound
Outputs as `config.format`. The readers accept only a string format (`number|integer|currency|percent`), so those
Outputs render with no format, and their unit/prefix/suffix/decimals are silently lost. V117 (HEL-1387) deliberately
left `format` alone on metric/collection Outputs. The owner ruled (2026-10-08): measure, then map ("map-approximate").

## What Changes

- New migration `V118__map_legacy_metric_format_objects.sql` (version assigned by the driver):
  - rewrites every metric/collection Output whose `config.format` is a JSON object to the closest string format:
    `decimals: 0` → `integer`; prefix exactly `$` with decimals absent or 2 → `currency`; anything else → `number`;
  - on metric Outputs only, writes the remaining prefix/unit/suffix text (space-joined) into `unit` when `unit` is
    absent or JSON null; a non-null `unit` is never overwritten;
  - records every original `format`, the prior `unit`, what was written, and a per-row list of the approximations
    made, in a new admin-only audit table `hel1410_migrated_output_formats`;
  - is idempotent and RLS-safe under the non-BYPASSRLS, table-owning `helio` role.
- `V117DeadOutputConfigKeysMigrationSpec` is pinned to target 117 (contract change: V118 now rewrites the metric
  `format` that spec asserts V117 leaves untouched).
- Tests: real-dump migration spec through V118 as a non-superuser role, plus a client/server seam test.

## Capabilities

### New Capabilities

### Modified Capabilities
- `outputs-model`: adds the requirement describing what migration V118 does to legacy object-valued `format`.

## Impact

- Prod data rewrite of `outputs.config` (dev measurement: 0 affected of 2286; prod count owner-only).
- New admin-only table `hel1410_migrated_output_formats` (V117 / V105 RLS pattern).
- No API, schema-contract or frontend production change.

## Non-goals

- New format strings (fixed decimals, prefix slot, non-USD currency). The approximations are recorded instead.
- Touching `format` on other kinds (V117 already removes it there).
- Rewriting `patch_set_applications` journals.
