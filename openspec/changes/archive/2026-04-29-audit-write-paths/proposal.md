## Why

The frontend issues a discrete API call for every individual user action that mutates state. Before designing a batch write API (HEL-135), we need a precise inventory of what those calls are, what triggers them, and how many fire in a typical session.

## What Changes

- A new spec document `write-path-audit` is created that catalogues all current PATCH/POST write endpoints, their triggering interactions, payload shapes, and estimated call frequency per session.
- No production code is modified.

## Capabilities

### New Capabilities

- `write-path-audit`: Audit document cataloguing all PATCH/POST write paths currently issued during a normal dashboard session, including endpoint, trigger, payload shape, and call frequency baseline.

### Modified Capabilities

<!-- None — this is a read-only audit task. No existing spec requirements change. -->

## Impact

No runtime code is affected. The resulting spec feeds directly into the batch API design (HEL-135).

## Non-goals

- Implementing any changes to the write paths
- Optimizing request volume
- Designing the batch API (that is HEL-135 scope)
