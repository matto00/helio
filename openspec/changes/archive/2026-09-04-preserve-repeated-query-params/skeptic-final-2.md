## Skeptic Report — final gate (round 2, skeptic-final-2.md)

### What I verified (with evidence)

**Ground truth.** `git log 9c1f29bf..HEAD` = the four stated commits (`9380517b`, `72ab6847`,
`6ebc360f`, `79437121`). Working tree clean. `git diff --stat` = 28 files. No `.sql` and no
`db/migration/**` path in the diff (the two `RestSourceConnectorMigration*` files that match a
naive `migration` grep are Scala services, not Flyway migrations) — **no Flyway migration**, as
required. Nothing matching `LocalFileSystem` / CSV / schema-inference / `ContentSource` — HEL-881
and HEL-893 untouched.

**CR1 — corrected, and I verified the replacement claim is actually TRUE rather than merely
different.** `specs/rest-api-connector/spec.md:9` now says key-sorted, with the TreeMap rationale.
I did not take the rationale on faith. In a detached scratch worktree at `79437121` I ran a probe
feeding `DataSourceConfigCodec.decodeRest` a **hand-written** legacy blob whose document order is
`z` before `a`:

```
PROBE2-IN={"connectorId":"c","endpoint":"/data","queryParams":{"z":"1","a":"2"}}
PROBE2-OUT=Right((a,2),(z,1))
```

and confirmed the parsed field map's runtime class is `scala.collection.immutable.TreeMap`. The
shipped behaviour is key-sorted; the corrected SHALL is factually accurate. CR1's substance is
genuinely closed.

**CR2 — the new test exists AND I proved it failable myself, with two independent mutations.**
Baseline unmutated: `RestApiConnectorDriverQueryParamsSpec` 6/6 green, including the new
"resolves a templated value at each occurrence of a repeated key". I then mutated the
implementation in the scratch worktree (never the review worktree, which stayed clean throughout):

- **Mutation 1 — collapse before resolving** (`qp.pairs.toMap.toVector.foldLeft` in
  `resolveQueryParams`): the new templating test FAILED, `"tag=b"` vs expected `"tag=a&tag=b"`.
- **Mutation 2 — resolve per-unique-key instead of per-pair** (preserving duplicates and order,
  but resolving every occurrence of a key from that key's *first* template): the new templating
  test FAILED, `"tag=a&tag=a"` vs expected `"tag=a&tag=b"`.

Mutation 2 is the decisive one: it leaves multiplicity and ordering intact and breaks *only* the
per-pair templating semantics that AC 3's repeated-key clause is about. The test is not vacuous —
it is specifically sensitive to the behaviour it claims to guard, and the `{{first}}`/`{{second}}`
→ `a`/`b` fixture makes the two occurrences distinguishable. Both mutations reverted; scratch
worktree removed; `git status` clean in both trees.

**Gates re-run by me, not read from the evaluation.** `npm run lint` rc=0, `npm run typecheck`
rc=0, `npm run format:check` rc=0 ("All matched files use Prettier code style"),
`node scripts/check-schema-drift.mjs` rc=0 (74 schemas / 7 enum surfaces / 14 tool surfaces in
sync), `node scripts/check-scala-quality.mjs` rc=0 (clean, soft warnings only). Every pre-commit
gate passes on the tree as committed, so no `git commit -n` bypass is in evidence.

**UI.** No browser work, per instruction and on the merits: the frontend delta is two pure
functions plus a wire type, with no rendered surface.

### Verdict: REFUTE

CR1 and CR2 are both genuinely fixed. But applying fresh judgment beyond round 1's list, I found
a new, live instance of exactly the vacuous-test failure mode this run has already produced once —
and it sits directly under CR1's own claim. It is one line to fix.

### Change Requests

1. **The test that purports to pin key-sorted legacy decode is vacuous, and carries a comment
   explicitly (and falsely) asserting that it is not.**
   `backend/src/test/scala/com/helio/api/protocols/sources/DataSourceProtocolSpec.scala:186`
   ("decodes a legacy JSON-object-shaped queryParams in KEY-SORTED order, not document order")
   builds its fixture as `JsObject("z" -> JsString("1"), "a" -> JsString("2")).compactPrint`.
   spray-json's `JsObject.apply` already stores fields in a sorted map, so that `compactPrint`
   emits **`{"a":"2","z":"1"}`** — I measured it directly:

   ```
   PROBE-RAW={"a":"2","z":"1"}
   PROBE-PARSED-CLASS=scala.collection.immutable.TreeMap
   PROBE-PARSED-ORDER=a,z
   ```

   The JSON string actually handed to `decodeRest` is therefore *already alphabetical*, so the
   test cannot distinguish key-sorted decode from document-order decode — a hypothetical
   document-order implementation would produce the identical expected value and the test would
   still pass. The comment at lines 178-185 states the opposite: "This fixture's document order
   ('z' then 'a') differs from alphabetical, so it genuinely pins the key-sorted behavior rather
   than passing coincidentally." That sentence is false as written, and it was added in direct
   response to evaluation-1.md CR3, which asked for precisely this coincidence to be removed — so
   the reviewer request was answered with something that does not do the job.

   This matters because the ordering claim is now a normative SHALL in the archived spec delta
   (CR1's fix), and **no test in the branch pins it**: the task 8.2 legacy-blob fixture in
   `RestApiConnectorDriverQueryParamsSpec.scala:243` is `{"a":"1","b":"2"}`, also already
   alphabetical.

   Fix: build the fixture from a **hand-written string literal** with non-alphabetical document
   order rather than from a constructed `JsObject`, e.g.
   `"""{"connectorId":"conn-legacy-2","endpoint":"/data","queryParams":{"z":"1","a":"2"}}"""`,
   keeping the existing expectation `QueryParams(Vector("a" -> "2", "z" -> "1"))`. I have already
   confirmed this stays green against the shipped implementation (PROBE2 above), and unlike the
   current form it genuinely fails if the legacy branch ever stops being key-sorted. Correct the
   accompanying comment to describe what the fixture now actually does.

### Non-blocking notes

- The runtime behaviour of this change remains, in my judgement, correct and well covered. Every
  behavioural guard I mutated (collapse, per-unique-key resolution) went red as it should. My one
  change request is about a durable-artifact/coverage defect, not a live bug.
- Round 1's two non-blocking items (helio-mcp's `Record<string, string>` `queryParams` type; the
  `request.config.parameters` drop on `SourceService`'s bare-url create path) remain the
  coordinator's spinoffs to file, correctly not addressed here.
