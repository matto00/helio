## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit 3a29c27afe5f38086f7676ecd0d414359632845a.

### Phase 1: Spec Review — PASS
All 7 ACs addressed: connect-time re-validation for postgresql (PgEgressSocketFactory) and mysql (MysqlEgressSocketFactory) via driver Properties (no URL rewriting); rebinding tests for both dialects; unknown dialect refused (SqlConfigRefusedException at connect, 400 at create/infer/test/inline pipeline paths); spec delta REMOVES the exact-named exemption requirement (matches openspec/specs/outbound-egress-guard/spec.md:98) and ADDS the replacement; TLS proven for pgjdbc (SqlConnectorTlsSpec), mysql honestly stated as not proven; app pool untouched (PipelineRunNotifyBus unchanged, guard test); JDBC open sites enumerated, dev-DB inventory read-only (0 rows). Database-name whitelist closes the URL-parameter override bypass (sensible, in scope). Issues: none.

### Phase 2: Code Review — PASS
Gates run fresh: `cd backend && nice -n 19 sbt testFull` -> 5478 succeeded, 0 failed, 0 aborted (378 suites). No known flakes seen. Mutation re-run independently: replacing the factory's blocked-address check with `if true` turned 4 of 7 SqlConnectorRebindingSpec tests red (postgresql/mysql rebinding, both hook-only-strict); restored via git checkout, worktree clean. Factory validates the InetAddress, never re-resolves; unresolved fails closed; EgressConnectRefusedException deliberately non-SocketException to avoid mysql address-loop retry; thread-local restored in finally. Issues: none.

### Phase 3: UI Review — N/A
Backend-only.

### Overall: PASS

### Non-blocking Suggestions
- Host is still interpolated into the JDBC URL; it is guarded by DNS resolution (fail-closed on unresolvable) so a `?`-bearing host cannot resolve, but adding host to the shape validator would be defense in depth.
