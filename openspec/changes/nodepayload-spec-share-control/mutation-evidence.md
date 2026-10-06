# Mutation evidence (HEL-1334)

Command: `cd backend && nice -n 19 sbt "testOnly com.helio.api.NodePayloadWiringSpec"`

## RED: mutation `val tokenHash = TokenHashing.sha256Hex(shareToken + "-broken")` (never committed)
```
[info] - should store a payload on a real opted-in run via the API and serve it on the rows route *** FAILED ***
[info]   404 Not Found was not equal to 200 OK (NodePayloadWiringSpec.scala:130)
[info] - should purge a downgraded tier's payload on the tick
[info] Tests: succeeded 1, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```
Line 130 is the positive control (`?token=` on public /history expecting 200); observed 404 Not Found.

## GREEN: mutation reverted
```
[info] - should store a payload on a real opted-in run via the API and serve it on the rows route
[info] - should purge a downgraded tier's payload on the tick
[info] Tests: succeeded 2, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
```

Optional second mutation (token row pointing at a different dashboard_id) not run: share_tokens.dashboard_id is an FK so it needs an extra seeded dashboard; the broken-hash mutation suffices.
