## Why

The dashboard create route (`POST /api/dashboards`) has happy-path and default-value coverage but no negative-path tests for malformed request bodies. Without this, a regression in JSON deserialization or request rejection could go undetected.

## What Changes

- Add ScalaTest cases in `ApiRoutesSpec` covering malformed transport input to `POST /api/dashboards`
- No production code changes — tests only

## Capabilities

### New Capabilities

- `dashboard-create-route-validation`: Negative-path route test coverage for malformed dashboard create requests

### Modified Capabilities

<!-- none -->

## Impact

- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — new test cases added
- No API contract changes
- No frontend impact
