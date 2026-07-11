## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

1. **Round-2 finding (JSON dispatch consolidation) is genuinely resolved.** Re-read `design.md`'s
   "JSON create dispatch" decision (lines 95-105) and `tasks.md` task 4.2 (fresh, not from the
   orchestrator's summary). Both now describe a single `entity(as[JsValue])` route inspecting the
   `type` discriminator once, then `convertTo[StaticDataSourceRequest]` or
   `convertTo[TextSourceUrlRequest]` — mirroring `SourceRoutes.scala`. Cross-checked against the
   actual `SourceRoutes.scala:27-56`: it is exactly `entity(as[JsValue])` → read `type` field →
   `Try(json.convertTo[SqlCreateSourceRequest])` / `Try(json.convertTo[CreateSourceRequest])`. The
   citation ("SourceRoutes.scala:31-53") is accurate to the actual file. No sibling
   `entity(as[X])` JSON route pair remains anywhere in design.md/tasks.md — the old inaccurate
   justification text round 2 flagged ("spray-json... matching the existing Static/CSV dispatch
   pattern... JSON bodies are strictified") has been removed and replaced with the correct
   Content-Type-short-circuit explanation (design.md lines 97-101), which matches what round 2's
   pekko-http-core source citations established.
2. **Confirmed against current (pre-implementation) code** that the fix is structurally sound:
   `DataSourceRoutes.scala:51` currently reads `concat(createStaticRoute, createCsvRoute)` with
   `createStaticRoute` at line 72-77 (`entity(as[StaticDataSourceRequest])`, JSON) and
   `createCsvRoute` at line 79-110 (`entity(as[Multipart.FormData])`). Also confirmed
   `StaticDataSourceRequest` (`DataSourceProtocol.scala:121-126`) already has a required `type`
   field, so branching on it via `JsValue` costs nothing new. Post-fix, the `concat` pair becomes
   one `entity(as[JsValue])` route (Static ∪ TextUrl) and one `entity(as[Multipart.FormData])`
   route (CSV ∪ TextUpload) — exactly two routes differing by Content-Type, preserving the safe
   short-circuit the current code already relies on. No new sibling-same-Content-Type route is
   introduced anywhere.
3. **Round-1 fixes confirmed still intact and accurate after trimming** (compared against what
   round 2 already verified, then re-checked against current code, not just re-reading the
   orchestrator's claim):
   - Multipart re-consumption fix: design.md lines 80-93 (single `createMultipartUploadRoute`,
     "No second `entity(as[Multipart.FormData])` unmarshalling ever happens") and tasks.md 4.1 —
     present, unchanged in substance from round 2.
   - `DataSourceService.update` closure point: design.md lines 7-10 and tasks.md 1.5 both still
     cite lines 148-153. Re-verified against current `DataSourceService.scala:148-152` — the
     4-case exhaustive match (`CsvSource|RestSource|SqlSource|StaticSource`, no catch-all) is
     exactly as described; a `TextSource` case is required and correctly planned.
   - 413/`PayloadTooLarge` mechanism: design.md lines 113-126 and tasks.md 1.6/3.5 — present.
     Re-verified `ServiceError.scala`'s 8-variant closed sealed trait is unchanged; the new
     `PayloadTooLarge` variant plus `completeError` wiring is architecturally consistent with the
     existing one-case/one-arm shape.
4. **Risk section and task 7.2 remain internally consistent** with the final route-dispatch shape:
   design.md's Risk entry (line 139) describes "Collapsing `createCsvRoute`/`createStaticRoute`
   into branching, discriminator-based routes," which now correctly matches both routes becoming
   discriminator-based (not just the multipart one), and task 7.2 requires regression tests for
   both the CSV and Static pre-existing paths plus the new JSON URL-creation path.
5. Confirmed via `git status`/`git log` that no backend code has been touched yet (this is still
   the pre-implementation design gate) — all verification above is against the actual unmodified
   codebase, not against claims.

### Verdict: CONFIRM

### Non-blocking notes

- None beyond what round 2 already logged (the `DataSourceProtocol.scala` `fromDomain`/`write`
  itemization nit) — not blocking, already covered by task 3.1's wording.
