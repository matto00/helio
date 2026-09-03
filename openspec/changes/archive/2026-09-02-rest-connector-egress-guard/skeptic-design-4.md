## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Scope per the orchestrator: verify the single round-3 change request, and check only for NEW
inconsistency it introduced. Settled ground from rounds 1-3 not re-litigated.

### What I verified (with evidence)

**Round-3 CR 1 — the universal 502-class assertion in `specs/rest-api-connector/spec.md` (FIXED).**
The requirement "REST fetches refuse disallowed destinations" now reads: "The refusal SHALL be
reported on whichever error channel the entry point already uses for a failed fetch ... For a
refresh, a preview, a pipeline run, or a schema inference that is a 502-class upstream error. A
connection test is the one exception: it already reports any failure as a 200 response carrying
`ok = false` and the reason in `error` ... (see `connection-test-endpoint`)." The entry-point list
in the first paragraph (refresh, preview, pipeline run, connection test, schema inference) is now
fully covered by the channel sentence, with no entry point left mis-assigned. The
status-code-not-specialised rationale is split into its own third paragraph, as described.

**Cross-file consistency after the edit — no new conflict found.**
- `specs/connection-test-endpoint/spec.md`: "`infer` reports it on its existing 502-class
  fetch-failure channel; `test` reports it ... as a 200 response carrying `ok = false` and the
  reason in `error`." Identical to the new wording; unchanged, as instructed.
- `proposal.md:46-49`: 400-class for `POST/PATCH /api/connectors`; 502-class for `infer` and every
  refresh/preview/pipeline-run fetch; 200 `ok = false` for `POST /api/sources/test`. Agrees.
- `design.md:131-147` Decision 8: 502 at eight `BadGateway` sites, with `testRest`/`testSql`
  carved out as 200 `ok = false`. Agrees; the new spec paragraph is its faithful restatement.
- `tasks.md` 4.3 (infer 502-class / test 200 `ok = false`), 4.4 (refresh path 502-class naming the
  address), 5.4 (typed-channel follow-up referencing Decision 8's accepted 502). Agrees.
- `specs/connectors/connector-management/spec.md:5,15`: 400-class at create/update, matching the
  third paragraph's "unaffected and remains a 400-class client error". Agrees.
- `specs/outbound-egress-guard/spec.md`: prescribes no status codes; nothing to contradict.

**Line width.** `awk 'length>120'` over `proposal.md design.md tasks.md specs/*/spec.md
specs/connectors/*/spec.md`: zero hits in the edited file (`specs/rest-api-connector/spec.md`).
The reflow claim holds. (Pre-existing over-120 lines remain in `tasks.md` — one-line task bullets,
never reflowed in any round — and `design.md:112` at 121 and
`specs/connection-test-endpoint/spec.md:6` at 123; none of these were touched this round.)

**Scenario coverage of the new carve-out.** `specs/rest-api-connector/spec.md`'s scenarios cover
only the 502 path; the 200 `ok = false` case has its own scenario ("test refuses each blocked
address class") in `specs/connection-test-endpoint/spec.md`, which is the spec that owns that
endpoint. No coverage gap, no duplication.

### Verdict: CONFIRM

The round-3 item is genuinely fixed and introduced nothing new. To answer the orchestrator's
question directly: yes — the residue is of the same shrinking clerical kind (4 → 2 → 1 → 0), all
of it prose-accuracy drift rather than anything about the approach, and this round found none at
all. A fifth round is not worth its cost; the design is sound enough to implement.

### Non-blocking notes

- Carried forward unfixed from round 3 (still non-blocking): `design.md:137` cites
  `ConnectionTest.scala:24-25` without a path; the file is
  `backend/src/main/scala/com/helio/services/sources/ConnectionTest.scala`.
