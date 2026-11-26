## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: `feature/rest-source-pagination/HEL-1013` at 5613ea63fdae31dbd1b1fe5d28663eb3d3fb676b. There are no code commits; the change dir is untracked, so the artifacts on disk are the live versions. I took owner rulings (a)-(e) as given.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/rest-source-pagination/HEL-1013`.
- I re-read ticket.md, proposal.md, design.md, tasks.md, specs/rest-source-pagination/spec.md and the round-2 report.

**CR-A (endpoint names): fixed everywhere.**
- `grep -n "api/data-sources\|api/sources"` across proposal, design, tasks and spec finds zero `/api/data-sources` hits. Every REST reference is `POST /api/sources` or `POST /api/sources/infer|test`:
  - spec l.105 and l.136
  - design l.30, l.165-166 and l.215
  - tasks 3.6
- I checked these against the live routes:
  - `SourceRoutes.scala:29`: `pathPrefix("sources")`, the REST create.
  - `SourcePreviewRoutes.scala:46/49/74`: `sources` / `infer` / `test`.
  - `DataSourcePreviewRoutes.scala:86`: the multipart CSV infer, which no artifact now cites.

**CR-B (time budget): fixed, and the three artifacts agree.**
- **Spec (l.115-125):** a fetch fails with no rows if its pages do not complete within 120 s of the first request. This explicitly includes a deadline that passes during the last page, and no page starts after the deadline. There are two scenarios, slow pages and deadline during the final page.
- **D3 (l.59, l.64-68):** the whole `fetchPaged` future is raced against `pekko.pattern.after(TotalTimeout)`. A `deadlineHit` flag blocks new pages, each per-page `toStrict` uses `min(30 s, remaining)`, and "never succeeds after 120 s" is stated.
- **Test plan (l.216-218):** two cases with an injectable budget, the second being "LAST page completes after the deadline gives `Left`".
- **Tasks 3.4a** mirrors D3.
- **Feasibility check:** the driver has an implicit typed `ActorSystem[_]` (`RestApiConnectorDriver.scala:58`), which is enough for `pekko.pattern.after`. The per-page `toStrict(30.seconds, maxStrictBytes)` it modifies is at l.361.

**Round-2 notes: all applied.**
- The 400 wording now says "create, infer and test, and on an inline pipeline REST root. There is no REST config update route." (spec l.16)
- Dry pipeline runs page and the root-schema dry run does not, in both spec l.105 and D8.
- The bare-url notice is evaluated on the request payload before `toEphemeral` drops the key (D9).

**New-contradiction sweep.**
- Proposal, design, tasks and spec agree on all of these:
  - only the run and sample paths page
  - the notice rule
  - `pagesFetched` semantics
  - the `maxRequests` bound and its default (20, range 1..100)
  - guard-first, then same-origin
  - whole-fetch failure semantics
- D7 says "Each page also keeps its own 30 s ceiling" while D3 says `min(30 s, remaining)`. These are compatible: 30 s is the upper bound. This is not a contradiction.

**Whole-design judgment.** Every acceptance criterion maps to a requirement and a mutation-proven test:
- multi-page retrieval
- no-config unchanged (guarded by mutation (e))
- cap truncation, made distinguishable by `pagesFetched`
- the loud request bound
- the per-URL egress guard, asserted on the guard's exact refusal text
- the red-arm mutation for page-following
- the mid-pagination curated `fetchError`

Ticket scope item 4 (looks-paged without config) is decided deliberately: a notice only, with no auto-detected idiom. I found no placeholders, TBDs or deferred blocking decisions.

### Verdict: CONFIRM

### Non-blocking notes

- **Negative timeout at the deadline.** `min(30 s, remaining)` can be zero or negative when a page's headers arrive right at or after the deadline. Clamp it to a small positive floor, or discard the entity explicitly, so a discarded in-flight page never throws inside the `toStrict` call with its entity undrained.
- **"Unknown key" scope.** In spec requirement 1, "a config with ... an unknown key SHALL be rejected" should be read as unknown keys inside the `pagination` object. The top-level REST config decoder's tolerance must not change, per C1 and the Migration Plan. The executor should keep that tolerance; a one-word fix ("an unknown `pagination` key") would remove the ambiguity.
