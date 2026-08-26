## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

**1. Re-derived every stated target programmatically from `osv-baseline-raw.txt`** (compile-scope
rows only), applying D2's rule myself — per artifact, the MAX over its advisories of the LOWEST
fix inside the D3-permitted major line; then MAX across a pinned family:

| Artifact | Rule-derived target | Artifact states | Verdict |
|---|---|---|---|
| netty family | codec 4.1.136 / codec-http **4.1.137** (GHSA-8c42-7qj2-3j46) / codec-http2 4.1.136 / handler 4.1.135 / transport-native-epoll+kqueue 4.1.135 / handler-proxy 4.1.133 / common 4.1.118 → **4.1.137.Final** | design D2 + tasks 4.2 = 4.1.137.Final | CORRECT |
| jackson-databind | 2.18.9 (GHSA-5jmj-h7xm-6q6v; other 4 at 2.18.8) | 2.18.9 | CORRECT |
| jackson-core | 2.18.8 (2.18.8, 2.18.6) — covered by the consistent 2.18.9 pin | 2.18.9 | CORRECT |
| protobuf-java | 3.25.5 (only advisory) | 3.25.5 | CORRECT |
| ivy | 2.5.2 | 2.5.2 | CORRECT |
| commons-lang3 | 3.18.0 | 3.18.0 | CORRECT |
| log4j-core 2.25.4 / log4j-1.2-api 2.25.4 / log4j-api 2.25.5 → family 2.25.5 | 2.25.5 | tasks 4.3 states no number, defers to 4.1's rule | NO ERROR (see note 2) |
| spark-core | ≥3.5.7 within 3.5.x | 3.5.9 (direct bump, D1) | SAFE |
| postgresql | ≥42.7.12 | 42.7.13 | SAFE |
| logback-core | ≥1.5.34 within 1.5.x (4 advisories: 1.5.19/1.5.25/1.5.33/1.5.34) | 1.5.38, "clears the 4 logback-core advisories" — exactly 4 exist | CORRECT |
| grpc-netty-shaded | 1.75.0 | 1.75.0 (task 2.4) | CORRECT |

Round 3's single blocking item is fixed and fixed correctly: no artifact carries the same
arithmetic error.

**2. The netty target exists.** `curl -o /dev/null -w %{http_code}` on
`repo1.maven.org/.../netty-codec-http/4.1.137.Final/netty-codec-http-4.1.137.Final.pom` → `200`.

**3. No stale figure survived the edit.** `grep` across `proposal.md`, `design.md`, `tasks.md`,
`ticket.md` for every version pattern: no residual `4.1.136` presented as the family target
(4.1.136 appears only where it is correct — codec/codec-http2's own per-artifact maximum, inside
D2's derivation). Baseline totals (250 / 70 / 23 / 1-30-34-5) are identical in all four documents.
Zero `TODO` / `TBD` / "figure out later" anywhere in the change dir.

**4. No regression alongside the edit.** `git status --porcelain` in the worktree shows only the
untracked change directory; `git diff HEAD --stat` is empty. No source file was touched, and
`feature/audit-event-append-only-store/HEL-471` was not gone near.

**5. Executability end-to-end.** Tasks 1→6 form a closed loop: measured baseline with an abort-on-
truncation guard and a coordinate-count sanity check (1.1–1.3a), direct bumps (2), the highest-risk
Jackson pin gated on `sbt test` with a documented step-down path (3, D6), overrides derived by the
D2 rule with instructions to RE-DERIVE rather than trust literals (4.1–4.2), re-scan as the
acceptance oracle (5), gates (6). Every remaining advisory is forced by 5.2 into the deferred set
with a three-part justification, so nothing can silently survive unaccounted for.

### Verdict: CONFIRM

### Non-blocking notes

1. **D5's `lz4-java` bullet is under-specified, not wrong.** The baseline shows three advisories on
   `org.lz4:lz4-java` 1.8.0: `GHSA-cmp6-m4wj-q63q` (fixed=-, the one D5 names), `GHSA-xx22-p4ch-683r`
   (also fixed=-, unnamed), and `GHSA-vqf4-7m7x-wgfc` (fixed=**1.8.1** — actually fixable). D5's
   sentence "no fixed version has ever been published" is true of the advisory it names but reads as
   if it covered the artifact. Task 5.2 catches this anyway; worth tightening the wording when the
   executor updates D5 (task 5.4).
2. **log4j has no stated family target.** Task 4.3 says "the log4j 2.x artifacts" and leaves the
   version to 4.1's rule. Applying it gives **2.25.5** (driven by `log4j-api` GHSA-qv9r-c865-cp47;
   core and 1.2-api both land at 2.25.4). Stating it inline would match how netty/Jackson are handled.
3. spark 3.5.9, pgjdbc 42.7.13 and logback 1.5.38 all sit above the D2 minimum (3.5.7 / 42.7.12 /
   1.5.34). That is consistent with D1 (direct bumps to the current patch), not a D2 violation — but
   D2's "minimise distance from Spark's tested closure" language does not explicitly carve out D1
   direct bumps, so a reader could see tension.
