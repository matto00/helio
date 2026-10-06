## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD b2a0d80885ba15069e19f9982de199db309f2432. The worktree is unmodified apart from the untracked change dir.
I judged the artifacts (ticket.md, proposal.md, design.md, tasks.md) against the live tree. I did not rely on the
round-1 report's narrative.

### What I verified (with evidence)

- **Source shape and route order (design Context, D3).** I read `PublicDashboardRoutes.scala` in full. It is 500 lines.
  `val routes` starts at line 313, and its seven `~` alternatives appear in this order: rows (315), filter-capabilities (353),
  distinct-values (370), output-meta (389), history (406), provenance (427), list (444). All seven are `GET`, and each
  contains a literal `aclDirective.authorizeResourceWithSharing("dashboard", dashboardId, userOpt, "Dashboard not found", token)`.
  The design's description is accurate.
- **Constructor call sites (D1).** `grep -rln "new PublicDashboardRoutes" backend/src` finds `ApiRoutes.scala:817` plus
  exactly the seven specs the design names, including `pipelines/OutputHistoryQueryCountSpec`. Round-1 CR3 is resolved.
  Because the constructor is unchanged, every call site compiles untouched.
- **CR1 resolution, the access-helper guard (C1).** `ExistenceNotLeakedRoutesSpec` (lines 315-321 and 468-486) matches
  `\b(requireOwnerOnly|requireAccess|authorizeResourceWithSharing|authorizeResource)\(` on non-comment code lines and
  keys the result by file name. I grepped lines 1-312 of the source (everything D2 moves out: resolvers, validator,
  dataAsOf and orphan helpers) for that regex and got **zero hits**. The prose mentions of
  `authorizeResourceWithSharing` in doc comments have no `(` and are excluded as comment lines anyway. All seven ACL
  calls sit inside `val routes`, which D2 keeps in the entry point. So the post-split guard set stays identical, and no
  test edit is needed. The other guard in that block (`forbiddenProducerCounts`) is not affected:
  `PublicDashboardRoutes.scala` has no `ServiceError.Forbidden(`.
- **Other source-scanning specs.** These specs walk `src/main`: `SqlEgressSocketFactoriesSpec`,
  `CredentialSurfaceEnumerationSpec`, `ShareTokenGenerationSpec`, `RestSourceConstructionSiteSpec`,
  `RouteTestBaseGuardSpec` and `SchemaFieldStructuralGuardSpec`. Each scans for tokens that are absent from the moved
  code (egress factories, "credential" under ai/assistant, `RestSource(`, `RouteTest` mixins). No other test names
  `PublicDashboardRoutes.scala` by file. A test-free split is feasible.
- **Optional-auth and D8 coverage (AC3).** `OutputHistoryPublicRoutesSpec:43` and
  `OutputHistoryPayloadPublicRoutesSpec:42` build the entry point with `userOpt = None`. The payload spec asserts that
  no `id`/`hasPayload`/`payloadId`/`rows` keys are present (line 77). It also asserts that the public tree does not
  handle a payload path under history (line 85). That assertion depends on the history directive's
  `pathPrefix(Segment / "history") / pathEndOrSingleSlash` shape, which D2/D3 keep verbatim in the entry point. Both
  specs go through the entry point, so they exercise the moved `resolveHistory` and `OutputHistoryResponses.public`
  (`OutputHistoryProtocol.scala:74`).
- **Evidence plan can fail (CR2).**
  - D5(b) requires a recorded red run of the skeleton extractor: two alternatives swapped plus a dropped `parameters`
    argument.
  - D5(c) adds a `--color-moved` / indentation-normalized verbatim-move check, with every non-moved line listed and
    justified. This covers the in-body logic that the skeleton alone would miss.
  - D5(d) re-runs the guard scan.
  - D6 compares the total and per-suite counts (now including `OutputHistoryQueryCountSpec`, which would catch an extra
    DB lookup) and requires an empty `backend/src/test` diff.

  Each of these checks can go red independently.
- **Quality and hooks.** `scripts/check-scala-quality.mjs` has one hard rule, inline FQNs. The 250-line limit is a soft
  warning, so an entry file of roughly 190 directive lines plus a header passes. The README "Holds" line exists and is
  covered by task 2.7.
- **Placeholders, contradictions, scope.** There are no TODO/TBD items. Proposal, design and tasks agree (D1 keeps the
  constructor; D2 keeps directives and ACL in the entry point; C1 and C2 are restated in tasks). Every AC maps to a
  task: split to 2.1-2.6, route tree to 3.1, test count to 1.1/3.2/3.3, coverage to 3.2, and spinoffs to Planner Notes.
  The plan adds no out-of-scope work.

### Verdict: CONFIRM

### Non-blocking notes

- **AC wording.** The ticket says "route modules". The plan's modules are resolver/logic modules, and the directive tree
  stays in the entry point. The design justifies this by the guard and zero-test-diff constraints, and it is a
  defensible reading. It is an interpretation, though, so the PR body should state it explicitly.
- **Entry file size.** The entry file will probably remain above the 250-line soft budget, at about 190 directive lines
  plus the class doc, constructor and wiring. The ticket's motivation was size. The PR body should report the
  before/after line counts so the reviewer sees the residual warning, rather than finding it later.
- **Module declaration order.** Declare the module `val`s before `val routes`. Lazy per-request references make either
  order safe today, but declaring them first removes any doubt about initialization order.
- **Comment block at original lines 462-467.** D2 should say where this `access`/`accessAlreadyGranted` comment ends up.
  It describes code in the moved `resultF` body, so it belongs with that body. This falls under D4 positional-word
  latitude only.
- **Spinoff tickets.** File the two Planner-Notes spinoffs as Linear tickets at delivery, not only in design.md:
  (1) no `ExistenceNotLeakedRoutesSpec` row for the public `/history` route; (2) the stale "funnel through here"
  comment.
