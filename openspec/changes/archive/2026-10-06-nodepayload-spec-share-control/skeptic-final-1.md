## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 38fc5d567937ba157716aabc7bf3e0a7ca2c0ba3
Base: resolve-review-base.sh (main/origin) -> 2c1884ac5b2cc2578320ace4a21e37b32df5c603. One commit in the range.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/nodepayload-spec-share-control/HEL-1334`.
- **Diff scope:** `git diff $BASE...HEAD --stat` shows one code file, `backend/src/test/scala/com/helio/api/NodePayloadWiringSpec.scala` (+29/-9). Everything else is openspec change artifacts. No production code, ci.yml, playwright config or .gitignore touched. The change is test-only, as the ticket requires.
- **AC1 (shared helper):** `import java.security.MessageDigest` is removed, and the hand-rolled digest is replaced by `TokenHashing.sha256Hex(shareToken)`. `grep MessageDigest` on the spec returns no hits. `TokenHashing.sha256Hex` (backend/src/main/scala/com/helio/infrastructure/crypto/TokenHashing.scala:15) computes the same SHA-256 over UTF-8 bytes with lowercase-hex output, so the stored hash is unchanged.
- **AC2 (positive control):** spec lines ~123-135. In phase A no `resource_permissions` row exists, because the public-grant INSERT moved to after the control. Anonymous `GET .../history` must return `404`. The same request with `?token=<shareToken>` must return `200` with a non-empty `points` array. The anonymous 404 is what ties the 200 to the token and nothing else. Phase B adds the public grant, and the payload-path 401 assertions (anonymous and token-only) run in both phases. The original refusal check is therefore kept and strengthened, not weakened.
- **RED, reproduced by me:** I mutated the stored hash to `TokenHashing.sha256Hex(shareToken + "-skeptic-broken")`. This is a different mutation string from the executor's, so it is an independent reproduction. Then I ran `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt "testOnly com.helio.api.NodePayloadWiringSpec"`:
  `should store a payload ... *** FAILED ***` / `404 Not Found was not equal to 200 OK (NodePayloadWiringSpec.scala:130)` / `Tests: succeeded 1, failed 1`. Line 130 at HEAD is `status shouldBe StatusCodes.OK` inside the `?token=` /history check, so the red comes from the positive control itself.
- **Revert:** `git checkout -- <spec>`. Afterwards `git status --short` shows only the untracked evaluator report (`evaluation-1.md`, which existed before I started), and `git diff` is empty.
- **GREEN plus full gate:** `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull` gave exit 0, `Suites: completed 426, aborted 0`, `Tests: succeeded 6030, failed 0`. Both NodePayloadWiringSpec tests passed. I ran `sbt --client shutdown` as a separate call ("no sbt server is running").
- **Executor's mutation-evidence.md:** I treated it as a claim. My independent run matches it (same failing line, same 404).
- **Debugging law:** not applicable. This is a test-strengthening ticket and fixes no product bug. The positive control passes on unmodified main code, so there was no product bug to escalate.
- **UI:** none changed, so step 4 was skipped and no servers were started.

### Verdict: CONFIRM

### Non-blocking notes
- The optional second mutation (a token row bound to a different dashboard) was not run by the executor or by me. The broken-hash mutation plus the phase-A anonymous-404 assertion are enough to show the control is token-specific.
