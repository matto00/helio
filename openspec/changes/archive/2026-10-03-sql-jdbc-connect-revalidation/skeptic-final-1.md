## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Head reviewed: 3a29c27afe5f38086f7676ecd0d414359632845a

### What I verified (with evidence)
1. Connect path: SqlConnectorDriver.connect sets socketFactory (Pg/Mysql EgressSocketFactory) via Properties, never URL text; EgressValidatingSocket.connect checks the InetAddress actually being connected to before super.connect. Production default predicate = isBlocked(config.host, addr), and every production caller passes sqlIsBlocked, whose default is ContentSourceSupport.isBlockedAddress (SourceService.scala:47). Only tests inject a seam. Absent thread-local predicate falls back to the real denylist (fail closed). The executor's deviation (connectIsBlocked defaults to the guard's seam) is acceptable; the rebinding tests use the real default hook (guard resolver lies, driver resolves localhost itself -> loopback), and separate tests make the hook strict while the guard is permissive.
2. Mutation / red-on-main re-derived by me: removing the socketFactory property assignments (equivalent to main's connect) -> SqlConnectorRebindingSpec 4 FAILED (pg + mysql rebinding, both hook-only-strict). Restored via git checkout; worktree clean (only untracked evaluation-1.md). Green: 63/63 across Rebinding, SocketFactories, ConfigShape, EgressGuard, Tls specs; PipelineInlineSqlShapeSpec + SourceServiceSpec 37/37. Evaluator's full-suite 5478 pass claim not re-run; no failures seen in my targeted runs.
3. Injection: database restricted to [A-Za-z0-9_.$-]+ with whole-string match (trailing newline refused). host passes checkEgressHost's charset gate ^[A-Za-z0-9.\-:\[\]]+$ plus URI round-trip, so no ?/&/#/@ can enter the URL; port is Int; user/password go in Properties.
4. Unknown dialect / shape: validateConfigShape is called in createSql, inferSql, testSql, PipelineService inline sql (1621), PipelineProposalService inline validate (215), and connect re-applies it (covers persisted rows). Assistant path: AssistantToolExecutor.executeTestConnection -> sourceService.testSql; assistant/proposal apply -> sourceService.createSql; both covered. buildJdbcUrl throws on other dialects.
5. App pool / PipelineRunNotifyBus untouched (not in diff stat); factory class names appear only in SqlConnectorDriver + factories file (guarded by a test).
6. TLS: SqlConnectorTlsSpec passed in my run (real TLS pg, sslmode=require encrypted, hook still refuses). MySQL TLS not proven (no server); the executor says so honestly; useSSL=false URL unchanged, so no regression.
7. Spec delta: `openspec validate sql-jdbc-connect-revalidation` valid; REMOVED requirement title matches main spec line 98 exactly, so archive will apply. Empty-database: pattern requires 1+ chars, so empty is refused; dev DB has 0 sql sources (executor inventory; not re-queried).
8. Threading: pg loginTimeout=0 pins connect to the calling thread; predicate thread-local is set/restored in try/finally (leak test passes). If a driver ever hopped threads the fallback is the real denylist (stricter), so it fails closed, not open.

### Verdict: CONFIRM

### Non-blocking notes
- The assistant path has no dedicated test; it is covered transitively through testSql/createSql.
- MySQL TLS and a real mysql server are unproven; behaviour rests on StandardSocketFactory TLS upgrade over the Socket subclass.
- Pre-existing unrelated: an unresolvable-at-create host is tolerated by design (HEL-952), connect fails closed.
- Full backend suite not re-run by me.
