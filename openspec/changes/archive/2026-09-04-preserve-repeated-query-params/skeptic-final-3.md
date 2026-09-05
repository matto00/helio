## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Narrowly scoped round: verify only that commit `c078961a`'s legacy-decode ordering test
in `backend/src/test/scala/com/helio/api/protocols/sources/DataSourceProtocolSpec.scala`
can actually fail. Behavioural guards, the TreeMap claim, and the constraint checks were
out of scope (covered by rounds 1 and 2). No browser used.

### What I verified (with evidence)

**Scope of the commit.** `git show c078961a --stat`: two files — the spec file (31 lines)
and the newly added `skeptic-final-2.md` report. The code change is confined to the one
test, exactly as claimed.

**Fixture genuinely emits "z" before "a".** The fixture is now a hand-written literal at
`DataSourceProtocolSpec.scala:195`:
`"""{"connectorId":"conn-legacy-2","endpoint":"/data","queryParams":{"z":"1","a":"2"}}"""`.
No earlier `"a"` token exists in the string (`"connectorId"`, `"endpoint"`, `"/data"`,
`"queryParams"` are all distinct tokens), so the `indexOf` comparison at :196 measures the
intended pair. Measured directly under mutation C below: `"a"` at 65, `"z"` at 73 for the
`JsObject`-built form, versus passing for the literal — i.e. the literal really is
document-ordered z-then-a and the `JsObject` form really is alphabetized.

**Baseline.** `sbt testOnly ...DataSourceProtocolSpec` → 26/26 green on the tree as committed.

**Mutation A — document-order decode (the decisive one).**
`backend/src/main/scala/com/helio/domain/model/model.scala:584`, legacy `JsObject` branch,
`fields.toVector.map` → `fields.toVector.reverse.map` (for this two-key TreeMap, reverse of
key-sorted == the fixture's document order). Result: **RED, for the predicted reason**, at
the decode assertion `DataSourceProtocolSpec.scala:198`:

```
- should decodes a legacy JSON-object-shaped queryParams in KEY-SORTED order, not document order ... *** FAILED ***
  Right(RestApiConfig("conn-legacy-2","/data","GET",QueryParams(Vector(("z","1"),("a","2"))),...))
    was not equal to
  Right(RestApiConfig("conn-legacy-2","/data","GET",QueryParams(Vector(("a","2"),("z","1"))),...))
```

The observed value is exactly document order and the expected is exactly key-sorted order —
the failure is the ordering distinction itself, not an incidental breakage. (The pre-existing
already-alphabetical legacy test also went red under this mutation, which is expected and
harmless; the new test is the one that discriminates on order.)

**Mutation B — explicitly key-sorted decode.** Same line → `fields.toVector.sortBy(_._1).map`.
Result: **GREEN, 26/26.** This confirms the test pins the *key-sorted* property rather than
some incidental artifact of the `TreeMap` traversal: any explicitly key-sorted implementation
satisfies it, and only a non-key-sorted (e.g. document-order) one breaks it. Taken with
mutation A, the test is failable and failable for precisely the right reason.

**Mutation C — the self-guarding fixture assertion does what the commit claims.** Restored the
implementation (`git checkout` of `model.scala`, tree clean), then reintroduced the exact
defect round 2 found, replacing line 195 with
`JsObject("connectorId" -> ..., "endpoint" -> ..., "queryParams" -> JsObject("z" -> ..., "a" -> ...)).compactPrint`.
Result: **RED at the fixture-construction guard, `DataSourceProtocolSpec.scala:196`**, not
silently green at the decode assertion:

```
- should decodes a legacy JSON-object-shaped queryParams in KEY-SORTED order ... *** FAILED ***
  73 was not less than 65 (DataSourceProtocolSpec.scala:196)
```

That is the exact behavior the commit message promises: a future edit reintroducing the
`JsObject(...).compactPrint` mistake fails loudly at the fixture line. It also independently
re-confirms (by measurement, not by reasoning) that `JsObject.apply(...).compactPrint`
alphabetizes — `"a"` at index 65, `"z"` at index 73 — which is the premise of round 2's finding.

**Tree restored.** `git checkout` on both mutated files; `git status --short` and
`git diff --stat HEAD` both empty. Re-ran the suite on the restored tree: **26/26 green,
"All tests passed."** No source file in the review worktree differs from `c078961a`.

### Verdict: CONFIRM

The round-2 change request is genuinely and durably closed. The ordering test is no longer
vacuous: it is red under a document-order implementation, green under any key-sorted one, and
it now additionally self-guards its own fixture construction against the precise regression
that made it vacuous the first time. I found nothing new that blocks.

### Non-blocking notes

- The guard at :196 compares `indexOf` over the whole `raw` string rather than over the
  `queryParams` sub-object. It is correct as written (no earlier `"a"` token exists), but it
  would silently weaken if someone later added a top-level `"a"`-prefixed key to the fixture.
  Purely hypothetical; not worth a change now.
- Round 1's and round 2's non-blocking items (helio-mcp's `Record<string, string>` queryParams
  type; the `request.config.parameters` drop on `SourceService`'s bare-url create path) remain
  the coordinator's spinoffs to file, correctly not addressed here.
