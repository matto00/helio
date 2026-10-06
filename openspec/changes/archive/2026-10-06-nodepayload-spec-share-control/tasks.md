## Standing Constraints

## 1. Tests

- [x] 1.1 Replace the inline `MessageDigest` SHA-256 in `NodePayloadWiringSpec` with `TokenHashing.sha256Hex`; drop the unused import; verify it compiles
- [x] 1.2 Seed the dashboard WITHOUT the public grant first; assert anonymous public `/history` is not 200 (actual status asserted); verify via spec run
- [x] 1.3 Add the positive control: `?token=<share>` on public `/history` through the full `api` tree is 200 with history points in the body; verify via spec run
- [x] 1.4 Keep the `""`/`?token=` 401 payload-path assertions in phase A, then insert the public viewer grant and re-assert them (phase B); verify via spec run
- [x] 1.5 Mutation: break the stored hash, run the spec, record the RED positive-control failure; revert and record GREEN; never commit the mutation
- [x] 1.6 Run `nice -n 19 sbt testFull` (timeout 600000, <=2 workers) and the frontend/pre-commit gates; then `sbt --client shutdown` as a separate call
