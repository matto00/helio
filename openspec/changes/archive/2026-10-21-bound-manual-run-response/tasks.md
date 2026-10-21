## Standing Constraints

- [C1] The heap measurement (G3) and the three routes use one shared streaming-marshaller definition; never a spec-local copy.
- [C2] Do not cap, drop or rename any response field or row; the wire body stays byte-identical to spray compact JSON.

## 1. Red-first measurement

- [x] 1.1 Extend `RunPathHeapSpec` to marshal and drain each run's response through a pluggable marshaller (default = today's spray marshalling), sampling per piece; verify it compiles and the default-mode run reproduces today's numbers for existing shapes
- [x] 1.2 Red: on unchanged route behavior, measure `fewrows-utf16-200` and `rowwidth-at-limit` (real + dry, -Xmx768m, SerialGC, taskset -c 0, >= 2 repeats, one probe at a time); save the summary to scratch; if no shape exceeds 192 MB, stop and escalate (design D4)

## 2. Backend

- [x] 2.1 Add the streaming compact printer (design D2); verify with G1 (task 3.1)
- [x] 2.2 Add the chunked `application/json` marshaller on it (design D3); verify G2 (task 3.2)
- [x] 2.3 Wire it into the success path of the run, apply-proposal and combined-apply routes, statuses unchanged; verify existing route specs stay green

## 3. Tests

- [x] 3.1 G1 printer-equivalence spec; mutation-check it and record the red output
- [x] 3.2 G2 route specs (run real/dry, both apply endpoints): chunked entity, bytes equal compact rendering, bounded pieces; mutation-check by reverting one route to the default marshaller
- [x] 3.3 G3 green measurement: all `RunPathHeapSpec` shapes <= 192 MB with the streaming marshaller (same JVM bounds, >= 2 repeats); mutation-check by reverting the marshaller; save summaries as evidence
- [x] 3.4 `sbt testFull` (under the sbt lock), helio-mcp tests, frontend jest (HELIO_JEST_MAX_WORKERS=2) green; HEL-1660/1679 guards green
