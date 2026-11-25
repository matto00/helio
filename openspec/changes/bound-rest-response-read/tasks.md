## Standing Constraints

## 1. Tests (red first)

### Tests

- [x] 1.1 Add helper unit spec (256 B counting infinite source, pulled <= 4096 + 4*256, cancellation observed, exact length) plus a spec test MaxBodyBytes >= 4*MaxCodePoints+4; verify red before the helper exists
- [x] 1.2 Extend `RemoteErrorBodyStub`: `/endless` (256 B per 50 ms, never ends, per-request counter), `/huge` (64 MiB, counter), `/multibyte`, `/malformed` (ASCII filler), 2xx of exactly 8388608 and 8388609 bytes (chunked in <=64 KiB chunks, and Content-Length); verify compile
- [x] 1.3 Add driver cases (both builders): `/endless` emitted <= 5120 at completion, `/huge` emitted < 8 MiB, capped text; run the full spec on unmodified code, verify red
- [x] 1.4 Add literal two-sided success guards (8388608 succeeds, 8388609 is `Request failed`, fetch and test) and a red-today `fetchUrl` paced endless non-2xx case; verify guards green and fetchUrl case red on unmodified code
- [x] 1.5 Commit the red run output as `.txt` evidence before any implementation code

## 2. Backend implementation

### Backend

- [x] 2.1 Add `RemoteErrorText.MaxBodyBytes` (4096, asserted >= 4 * MaxCodePoints + 4) and the bounded prefix read helper; verify 1.1 passes
- [x] 2.2 Rework `issueAndParse`: status first, bounded prefix on non-2xx, 2xx limit via the local helper reproducing `getPossiblyInfiniteBytes` (D3); verify 1.3/1.4 fetch cases pass
- [x] 2.3 Rework `issueTest`: bounded prefix on non-2xx, count-not-hold fold with the same limit on 2xx; verify connection-test cases pass
- [x] 2.4 `ContentSourceSupport.fetchUrl`: cancel the entity on non-2xx with the same message; verify existing fetchUrl/CSV-url specs and a large non-2xx case pass

## 3. Verification

### Tests

- [x] 3.1 Run mutations M1-M5 from design D6 with the predicted reds (M2 red on the emitted-byte assertion, both builders) and record each red in evidence
- [x] 3.2 Run every REST/connector/source spec that touches the driver (see design D6 and the grep list) in sbt testFull shards, all green
- [x] 3.3 Record measured bytes pulled (helper and /huge stub) in evidence
