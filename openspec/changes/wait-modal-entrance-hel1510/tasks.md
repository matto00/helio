## Standing Constraints

- [C1] Claim only that the entrance-animation race is real and the wait is load-bearing, not that it caused the observed CI flake; log the stretch factor (prefer 5-10x) and the raw resting card content-right next to HEL-1613's numbers

## 1. Tests

- [x] 1.1 `cd frontend && nice -n 19 npm ci`; start lane servers via start-servers.sh with the lane DATABASE_URL (helio_hel1621)
- [x] 1.2 Write the probe copy of the hel1510 spec with the D1 slowed-entrance init script; diff it against the spec
- [x] 1.3 Run the probe without any wait -> RED on the spec's own overflow assertion; commit log + probe as .txt (before the fix)
- [x] 1.4 Add the D2 wait to `e2e/hel1510-output-editor-table-overflow.spec.ts` (dialog's own finite animations finished)
- [x] 1.5 Probe with the wait -> GREEN; mutation (wait removed) -> RED again; commit logs + diffs as .txt
- [x] 1.6 Real spec `--repeat-each=20 --workers=2` under nice -n 19 -> 20/20; commit log as .txt
- [x] 1.7 Remove the probe spec from e2e/; lint/format/typecheck clean; stop servers
