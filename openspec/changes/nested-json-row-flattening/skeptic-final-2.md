## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Fresh cold reviewer. Everything below is derived from the worktree at `5b3fcaad` — the diff, the
files, and a probe I wrote and ran myself. Round 1's report and `evaluation-1.md` were read as
claims only.

### What I verified (with evidence)

**Ground truth.** `git log main..HEAD` → two commits (`f0870495`, `5b3fcaad`). `git diff
main...HEAD --stat` → 29 files, **zero under `frontend/`** — backend + openspec only, so no UI
surface changed and no design-standard review applies (servers not started; correct for this
diff). Full reads of `JsonFlattener.scala`, `PipelineRowJson.scala`,
`SchemaInferenceEngine.scala`, the round-2 test diff, `ticket.md`, `design.md`,
`specs/nested-json-flattening/spec.md`, and `skeptic-final-1.md`.

#### CR1 — schema-side dotted-key collision duplicate: **genuinely closed**

Fixed in the code, as claimed, not in the test. `JsonFlattener.leaves` now folds `walk`'s raw
output through a `ListMap` (last-in-walk-order wins) **before** the path sort, so the
deduplication happens once, inside the shared traversal, rather than being delegated to each
caller's discretion. That is the structurally correct option: `SchemaInferenceEngine.flattenObject`
(`SchemaInferenceEngine.scala:105-111`) maps `leaves` straight into `InferredField`s and still
never folds — it no longer needs to.

The new tests assert the right things. `JsonFlattenerSpec` now asserts on the **raw `Seq`**
(`leaves should have size 1`), not `leaves(obj).toMap` — the exact fold that hid the bug.
`SchemaInferenceEngineSpec` asserts `fromJson(json).fields.map(_.name) shouldBe Seq("a.b")` against
real `fromJson` output. I checked both would go red under the old implementation (the old `leaves`
returned `List((a.b,2), (a.b,1))`, so `have size 1` and `shouldBe Seq("a.b")` both fail).

#### The invariant itself, probed adversarially (well beyond the one shipped case)

I wrote a throwaway spec (`ZzSkepticProbeSpec`, since deleted — `git status --porcelain` is empty)
that, for each input, compares **three** projections: `SchemaInferenceEngine.fromJson(...).fields`
names, `PipelineRowJson.jsRowToRow(...)` key set, and `JsonFlattener.flattenJsObject(...)` field
names (the preview projection, which round 1 did not probe). It asserts set equality across all
three, no duplicate field names, and equal cardinality. Measured output:

```
multi-dot-key   {"a.b.c":1,"a":{"b":{"c":2}}}          agree=true dupes=[] -> [a.b.c]
leading-dot     {".a":1,"":{"a":2}}                    agree=true dupes=[] -> [.a, a]
trailing-dot    {"a.":1,"a":{"":2}}                    agree=true dupes=[] -> [a.]
empty-key       {"":1,"x":2}                           agree=true dupes=[] -> ["", x]
empty-key-nest  {"":{"":1},".":2}                      agree=true dupes=[] -> ["", .]
unicode         {"日本.語":1,"日本":{"語":2},"café"...}   agree=true dupes=[] -> [café, café, 日本.語]
collide-deeper  {"a":{"b":{"c":1}},"a.b":{"c":2},"a.b.c":3}  agree=true dupes=[] -> [a.b.c]
dup-diff-depths {"x.y.z":1,"x":{"y.z":2},"x.y":{"z":3}}      agree=true dupes=[] -> [x.y.z]
array-at-collis {"a.b":[1,2,3],"a":{"b":{"deep":1}}}   agree=true dupes=[] -> [a.b, a.b.deep]
obj-at-collis   (same, reversed key order)             agree=true dupes=[] -> [a.b, a.b.deep]
null-at-collis  {"a.b":null,"a":{"b":5}}               agree=true dupes=[] -> [a.b]
ordinary-nested {"id":1,"player":{...},"tags":[1,2]}   agree=true dupes=[] -> [id, player.first, player.meta.x, tags]
empty-nested    {"a":{},"b":1}                         agree=true dupes=[] -> [b]
array-of-objs   {"a":[{"x":1}],"b":2}                  agree=true dupes=[] -> [a, b]
```

Every case: schema field-name set **exactly** equals the row column-key set, and no duplicate field
name is emitted anywhere. Three-way collisions (`collide-deeper`, `dup-diff-depths`) collapse to a
single column, including one where a literal key collides with a *deeper* generated path. A
collision site with mixed kinds (array vs object) correctly yields the array as the `a.b` leaf plus
the object's own deeper `a.b.deep` — schema and row agree on both, in either key order.

Stability: 50 repeated `leaves` calls on each of three colliding inputs → `runs.toSet.size == 1`
in every case. The winner is not a hash-order flap.

Two behaviours worth recording (neither a defect, both consistent across projections):
`{"":{"":1}}` flattens to path `""` because the empty root prefix and an empty key are conflated by
the `if (prefix.isEmpty)` branch (`JsonFlattener.scala:70`) — a `.`-joined `"."` might be more
literal, but it is deterministic and identical on both sides. And the `unicode` case's two `café`
entries are genuinely distinct strings (precomposed vs decomposed NFD), not a duplicate — both
projections carry both, so the invariant holds.

#### CR2 — depth-bound test: **genuinely closed**

The test no longer asserts non-emptiness. It now pins `result should have size 1`,
`path.split("\\.").toVector shouldBe Vector.fill(MaxDepth)("n")` (so it fails for any other bound),
`leafValue shouldBe JsObject("leafField" -> JsNumber(1))` (the untouched subtree, proving no
truncation and no further descent), the row value being a `String` containing `"leafField":1`, and
`fromJson` typing it `StringType`. My own probe independently measured
`path=n.n.n.n.n.n.n.n.n.n segs=10 leafIsObj=true` on input nested `MaxDepth + 5` deep, and
confirmed schema/row key-set agreement at the bound.

#### No collateral damage (D2 / D3 / D8, and ordinary input)

- **Ordinary non-colliding input unchanged.** On a flat object the `ListMap` fold is the identity
  (no path repeats), so the returned `Seq` is byte-identical to round 1's. `ordinary-nested` and
  `array-of-objects` probes confirm the expected dotted set and values.
- **D2 (arrays are leaves)** — `tags -> [1,2]`, `a -> [{"x":1}]` both land as single leaves at their
  own path; array-of-scalars and array-of-objects treated identically. Unchanged.
- **D3 (depth bound 10)** — measured above.
- **D8 (`mergeObjects`, HEL-858's territory)** — `git diff main...HEAD` on
  `SchemaInferenceEngine.scala` touches only `flattenObject`; `mergeObjects` is byte-unchanged. I
  reproduced both disclosed residuals live: `[{"id":1,"stats":{"a":1}},{"id":2,"stats":{"a":1,"b":2}}]`
  → `[id, stats.a]` (later-row-only `stats.b` still not advertised), and
  `[{"id":1,"stats":null},{"id":2,"stats":{"a":1}}]` → `[id, stats]`. Exactly the first-non-null-wins
  behaviour design D8 names and leaves to HEL-858. The dedup did not perturb it.

#### Gates re-run by me

- `sbt -batch test` (worktree, after deleting my probe spec) →
  `Total number of tests run: 3651 / Tests: succeeded 3651, failed 0` (204 s). Independently
  reproduces the commit message's 3651 claim; +2 over round 1's 3649, matching the two added tests.
- `node scripts/check-scala-quality.mjs` → `clean (140 soft warning(s))`.
- `node scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`.
- `node scripts/check-spec-structure.mjs` → `passed (340 canonical specs, 0 issues)`.
- Frontend gates N/A — zero frontend files in the diff.
- `git status --porcelain` empty after cleanup; I left the worktree exactly as I found it.

#### Round-1 ACs re-checked, not re-inherited

I did not re-derive AC1's live-endpoint check from scratch (round 1 verified the fixture byte-equal
to live rows, and the fixture is committed and frozen), but I did re-confirm the fixture is
genuinely nested — `sleeper-wr-projections-slice.json` carries `stats` as a multi-key object and
`player.metadata` as a real third level — so the ticket's named "flat fixture fakes it" trap is not
live. The spec requirement at `specs/nested-json-flattening/spec.md:99-102` ("exactly one `a.b`
column exists, the inferred schema and the materialised row select the same one of the two values,
stable across repeated runs") is now **true as written** on all three counts, which was precisely
what CR1 said it was not.

### Verdict: CONFIRM

Both change requests are genuinely closed, and closed in the right place — CR1 in the shared
traversal so the guarantee holds by construction rather than by every caller remembering to fold.
The invariant that actually matters (schema projection and row projection agreeing exactly) held on
every adversarial input I could construct, including several classes round 1 never reached:
multi-dot keys, empty and unicode keys, leading/trailing dots, a literal key colliding with a
*deeper* generated path, duplicate paths arising at three different nesting depths, and mixed
array/object kinds at a collision site. No duplicate field name was emitted anywhere. Ships.

### Non-blocking notes

- **`design.md` Decision 4 is now stale in a way that could mislead HEL-858.** It still reads
  "Both projections build a `Map`, so the last pair wins" (`design.md:77-78`) — which is exactly
  the premise round 1 refuted and this commit repaired. The `JsonFlattener` scaladoc immediately
  above the code is thorough and correct (it explicitly narrates the round-1 finding and warns
  against the caller-side-fold approach), and the two new tests would go red if the dedup were
  removed, so this is documentation lag, not a live hazard. But HEL-858 is delivered next and
  touches this exact traversal; a one-sentence correction of D4 to say the dedup lives in `leaves`
  is worth folding into that ticket if not into this one.
- `scripts/concertino/` in this worktree still lacks `next-report-number.sh` and
  `persist-evidence.sh` (same stale script set round 1 flagged); I used the main-tree copies.
  Environmental, not this ticket's.
