## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)
- Read all five artifacts in full from disk (`proposal.md` 49L, `design.md` 207L, `tasks.md` 96L,
  `specs/connector-credential-encryption/spec.md` 77L, `ticket.md` 34L) — not from the executor's
  narrative.
- **Round-3 CR1 (stale `MasterKeyProvider.current()`) — FIXED.** `tasks.md:32-34` now reads
  "`wrapDataKey` returns `Left(MasterKeyError.NoKeyConfigured)` when `CONNECTOR_MASTER_KEY` is
  unset → `encrypt` returns `Left`". A repo-wide `grep -rn "MasterKeyProvider.current"` over the
  change dir returns hits only inside prior skeptic reports (historical), never in a live artifact.
  This matches Decision 3's actual trait signature (`design.md:118-127`), which declares only
  `wrapDataKey`/`unwrapDataKey`.
- **Round-3 CR2 (three surviving "`SecretBackend` seam" references) — FIXED, all three.**
  - `design.md:15-16` (Goals) now: "a `MasterKeyProvider` seam shaped so a future Cloud-KMS
    implementation can be swapped in without redesigning callers."
  - `design.md:34` now: "The `MasterKeyProvider` seam below is deliberately narrow — `wrap`/`unwrap`
    a data key, given a key id".
  - `proposal.md:22-23` now: "what a future Cloud-KMS-backed `MasterKeyProvider` would require."
  I grepped every remaining occurrence of `SecretBackend` across the live artifacts and checked each
  in context: all are either (a) naming the pre-existing HEL-460 trait as context, (b) the explicit
  *contrast* statements ("does **not** extend `SecretBackend`", `proposal.md:34-35`,
  `tasks.md:24`, `design.md` Decision 3a), or (c) `ticket.md`'s own original wording, which is input,
  not an artifact under revision. No live artifact still calls the KMS-swap seam a `SecretBackend`
  seam. No internal contradiction with Decision 3a remains.
- **Round-3 non-blocking notes — applied.** `spec.md:72-77` ("No environment-conditional key logic
  exists") now enumerates `CONNECTOR_MASTER_KEY`/`CONNECTOR_MASTER_KEY_ID` plus the two `_PREVIOUS`
  variants. `tasks.md:75-79` resolves the runbook location to the concrete new path
  `docs/secrets-inventory.md`; I confirmed by `ls` that no such file exists in the tree today, so
  "new file" is accurate and the task is unambiguous about creating it.
- **No regression sweep.** `grep -rn "TODO\|TBD"` over the change dir: zero hits. Every ticket AC
  traces to a task: ciphertext-at-rest → 4.2; round-trip → 3.4; wrong/rotated key → 3.3; RLS
  non-bypassing → 4.3 (names the concrete `RlsOwnerTablesSpec.scala:20-60` harness); rotation doc +
  `sbt compile test` → 5.1/6.1; fail-closed-on-no-key → 3.2 + spec.md:22-29; local dev/CI without a
  prod secret → 2.3 + Decision 4 + spec.md:58-70. Storage shape (Decision 2, V92 DDL) is internally
  consistent with the columns the re-wrap job (5.2) and `WrappedKey` (Decision 3) manipulate:
  `key_id`/`wrapped_data_key`/`nonce_dek` line up exactly in all three places.
- `openspec validate connector-credential-encryption --type change --strict` re-run by me:
  `Change 'connector-credential-encryption' is valid`.

### Verdict: CONFIRM

Both round-3 blocking items landed as claimed, both non-blocking notes were applied, and nothing
regressed. The design is specific enough to implement without further guessing.

### Non-blocking notes
- `design.md` Decision 5 step 5 frames a future Cloud-KMS swap as "the same procedure, generalized:
  the 'previous' provider is the Secret-Manager-pepper `MasterKeyProvider`, the 'current' provider is
  the KMS-backed one." Steps 2-4 as written are keyed to the `_PREVIOUS` **env-var pair**, which a
  KMS provider would not use — the generalized version needs two provider *instances*, not two env
  values. Out of scope for this ticket (nothing is built for KMS here), but the executor should not
  read step 5 as implying the env-backed provider can host a KMS "previous". Worth a half-sentence
  when writing `docs/secrets-inventory.md`.
- `tasks.md:93-96` (6.2) correctly refuses to lean on HEL-616's unbuilt guard and makes the
  no-plaintext-in-logs check an explicit manual review step. Good; just note it is the one acceptance
  signal in the plan that is human-judgment rather than a test.
