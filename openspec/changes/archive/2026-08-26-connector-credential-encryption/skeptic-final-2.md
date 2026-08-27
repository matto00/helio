## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Scope: cold re-check of the two round-1 change requests against commit 7b90a209
(diff vs 4b81d1f9 is 2 files / +54 -1), plus a regression spot-check.

### What I verified (with evidence)

1. **CR2 — inline FQN removed.** `git diff 4b81d1f9 7b90a209` shows
   `import javax.crypto.spec.SecretKeySpec` added at line 4 and
   `new javax.crypto.spec.SecretKeySpec(...)` → `new SecretKeySpec(...)` at line 94 of
   `backend/src/main/scala/com/helio/services/auth/EncryptedSecretBackend.scala`.
   Grep over every `.scala` file in `git diff main...HEAD` finds no remaining
   inline FQN of the flagged kind. `node scripts/check-scala-quality.mjs` →
   `Scala code-quality check: clean (136 soft warning(s))`, exit 0 (soft warnings are
   pre-existing file-size notes, informational only per CONTRIBUTING.md:142).

2. **CR1 — the GCM tag-verification path is genuinely exercised.** Read
   `EnvMasterKeyProvider.unwrapDataKey` (MasterKeyProvider.scala): resolution is
   *id-equality only* —
   `currentKey.collect { case (id, key) if id == wrapped.keyId => key }.orElse(previous…)` —
   and on a match it hands those key bytes straight to `gcmDecrypt`. The new test
   uses two independent random 32-byte keys under the **same** id `"env-same"`, so id
   resolution succeeds and the failure can only originate in GCM tag verification.
   The assertion is `shouldBe Left(MasterKeyError.UnwrapFailed)` — specific, and
   *not* satisfiable by a short-circuit, which would yield `UnknownKeyId`.

3. **Demanded the red (mutation test).** Temporarily changed
   `EnvMasterKeyProvider.gcmDecrypt` to `.recover { case _ => ciphertext }`
   (i.e. a broken, non-fail-closed GCM path). All three new tests failed:
   `succeeded 8, failed 3`. Reverted; the file is byte-identical to HEAD again
   (`git status --porcelain` shows only two untracked prior report files, no
   tracked modifications). This proves the new tests are load-bearing rather than
   vacuously green.

4. **Targeted spec green.** `sbt testOnly …EncryptedSecretBackendSpec` →
   11 tests, 11 succeeded, 0 failed; all three new cases listed by name.

5. **Full backend suite green.** `sbt test` → `Total number of tests run: 3493`,
   `Suites: completed 222, aborted 0`, `Tests: succeeded 3493, failed 0` — no
   regression from 7b90a209.

6. **No regression surface beyond the two files.** The round-1→round-2 diff touches
   only `EncryptedSecretBackend.scala` (one import + one call site, behavior-identical)
   and `EncryptedSecretBackendSpec.scala` (additive: one private `flippedByte` helper
   plus three new cases). Nothing verified in round 1 (DB-level ciphertext proof,
   zero-rows fail-closed, RLS under `helio_app_test`, Decision 3a non-extension,
   provider boundary, env docs, rotation runbook) is touched by this diff.

7. **No UI changes.** `git diff main...HEAD --stat` contains no `frontend/**` paths —
   backend, docs, and openspec artifacts only. DESIGN.md judgment and the
   servers/screenshot pass are not applicable; servers were not started.

### Verdict: CONFIRM

### Non-blocking notes
- `EncryptedSecretBackend.scala:96` still spells `scala.util.Try` inline in the
  `TryEither` value class while `Success`/`Failure` are imported at line 5. The
  quality check does not flag it and it is a companion-object-scoped single use
  (CONTRIBUTING.md:31 carve-out), but importing `Try` alongside would be tidier.
- The two byte-flip tests assert only `isLeft shouldBe true`, unlike the first new
  test's specific `Left(UnwrapFailed)`. Adequate for a fail-closed assertion; naming
  the specific error would be marginally stronger.
