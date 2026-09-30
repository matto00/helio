## Why
GHSA-cxp5-3px4-pw24 and GHSA-wv8q-qhhj-9h54 (jackson-databind, high, affected <= 2.18.10, patched 2.18.11) fail the osv-scanner `security` CI gate on every branch.

## What Changes
- Bump the six Jackson `dependencyOverrides` pins in `backend/build.sbt` from 2.18.10 to 2.18.11 and extend the comment with both GHSA ids.

## Capabilities
### New Capabilities
None.
### Modified Capabilities
None. Build-only dependency pin; no behavioral or spec change.

## Impact
`backend/build.sbt` only. No API, schema, or frontend impact.
