# Spec tolerance-language enumeration (HEL-814, design gate round 6)

**Method.** Grep, not inspection, over all 21 `openspec/specs/pipeline-*-op/spec.md`:
`SHALL NOT throw|MUST NOT throw|tolerant|defaults? to|any value other than|falls back|ignored`.

**Independently derived; matches the coordinator's coarse pass exactly** — same 14 files, same hit counts.
7 of the 21 have zero hits: `aggregate`, `date-bucket`, `fillnull`, `limit`, `pivot`, `sort`, `string-ops`.

**The load-bearing distinction.** This change alters *config-decode* tolerance. It does not touch *row-data*
tolerance. Most hits are the latter — "a field missing from a row is ignored" — and are unaffected. Classifying
by which kind of tolerance the language describes is what makes this enumeration decidable rather than a
judgement call.

| Spec | Hits | Language found | Verdict |
| --- | --- | --- | --- |
| `pipeline-assert-op` | 1 | "decode SHALL NOT throw for **any** input", incl. malformed fields | **has a delta** — narrowed to absence + open `params` contents |
| `pipeline-dedupe-op` | 2 | `keep` defaults to `first` for "any value other than the literal `last`" | **has a delta** — case-insensitive match, unknown rejected |
| `pipeline-chunk-by-token-count-op` | 6 | `encoding` "falls back to `o200k_base` for any other value" + a named scenario | **has a delta** — decode preserves, analyze/run reject |
| `pipeline-compute-op` | 3 | :14 wire `type` "tolerated but ignored"; :111/:125 legacy-expression tolerance | **NEEDS a delta — added this round.** The three hits are benign (an ignored wire key; expression-grammar fallback — neither is config-shape decode, and D1 adds no unknown-key rejection). The conflict is elsewhere in the same requirement: "SHALL append a new field named `column` to every row" is unconditional, and D3 makes an empty `column` fail instead. This is the production case the measurement found. |
| `pipeline-extract-headings-op` | 2 | `indexField`/`levelField` "defaults to" | unaffected — omission-only defaults, which D1 preserves. Says nothing about a wrong-typed value. |
| `pipeline-split-text-op` | 2 | `headingLevel`/`indexField` "defaults to" | unaffected — same omission-only shape. Note `mode` IS in D4's enum list, but this spec never blesses a fallback for an unknown `mode` (it states `"paragraph"` or `"heading"` and stops), so D4 adds a rejection the spec never contradicted. The code's silent default to `"paragraph"` is unspecced behavior being removed, not a spec reversal. |
| `pipeline-rename-op` | 2 | a mapping whose source field is absent **from a row** is silently ignored | unaffected — row data |
| `pipeline-cast-op` | 1 | "Field missing from row is silently ignored" | unaffected — row data |
| `pipeline-select-op` | 1 | "Field not present in row is ignored" | unaffected — row data |
| `pipeline-unpivot-op` | 1 | a missing field in a source **row** yields `null` rather than dropping it | unaffected — row data |
| `pipeline-filter-op` | 1 | unary operators ignore the condition's `value` field | unaffected — operator semantics, not decode |
| `pipeline-window-op` | 1 | `field` "ignored by the rank family" | unaffected — per-function semantics. `window.function` is already validated at analyze by the shipped `pipeline-step-config-validation` requirement. |
| `pipeline-lookup-op` | 1 | run fails for a reference id that is "the tolerant-decode default of an empty string" | unaffected — **already aligned with D3**, and cited in the `pipeline-step-config-runtime-completeness` delta as in-repo precedent |
| `pipeline-union-op` | 1 | same wording as `lookup` | unaffected — already aligned with D3 |

## Second pass — the 7 zero-hit specs only (design gate round 6)

The first pass equated "zero grep hits" with "no tolerance guarantee". That was wrong: the 7-phrase pattern has
a recall failure, because a spec can state config tolerance as **behaviour** rather than in that vocabulary.
Second grep over the 7 zero-hit specs for `no-op|silently|treated as|SHALL return all|SHALL be ignored|left
unchanged`:

| Spec | Found | Verdict |
| --- | --- | --- |
| `pipeline-limit-op` | :9 "When `count` is missing, zero, or negative, the engine SHALL return all rows (safe no-op)" + named scenario :19 | **config tolerance — real.** Resolved in design.md D8: `limit.count` is optional-with-legitimate-default, D4 rejects only an unrepresentable value, so the guarantee is preserved and **no delta is needed**. |
| `pipeline-sort-op` | :10 "An empty `sortBy` array SHALL be treated as a no-op" + named scenario :24 | **config tolerance — real.** Resolved in D8: `sort.sortBy` is optional-with-legitimate-default. Task 2.3's item-level strictness is unaffected — a malformed *element* still fails, an *empty array* is still a no-op. **No delta needed.** |
| `pipeline-fillnull-op` | :21 "Missing key is treated as null" | unaffected — row data |
| `pipeline-aggregate-op`, `pipeline-date-bucket-op`, `pipeline-pivot-op`, `pipeline-string-ops-op` | nothing | unaffected |

## Third pass — all 21 specs (design gate round 7)

Pass 2 was scoped to the 7 zero-hit specs. That was itself a boundary error, the same shape as pass 1's: it left
the 14 classified from their pass-1 hits alone, so a *second* guarantee inside an already-classified spec stayed
invisible. Pass 3 runs `empty [^ ]* ?(list|array|map|object)|produces empty|is a no-op` over **all 21**:

| Spec | Found | Verdict |
| --- | --- | --- |
| `pipeline-cast-op` | :35 "Empty casts map is a no-op" | **config tolerance — real.** `cast.casts` pinned optional in D8. No delta. |
| `pipeline-rename-op` | :25 "Empty renames map is a no-op" | **config tolerance — real.** `rename.renames` pinned optional in D8. No delta. |
| `pipeline-select-op` | :24 "Select with empty fields list produces empty rows" (+ :20 "Select all fields is a no-op") | **config tolerance — real, and behaviour-defining rather than a no-op.** `select.fields` pinned optional in D8. No delta. |
| `pipeline-filter-op` | :11 requirement text "An empty `conditions` array SHALL pass all rows" | **config tolerance — real.** `filter.conditions` pinned optional in D8. No delta. |
| `pipeline-sort-op` | :10, :24 | already caught by pass 2 |

These four sit in specs pass 1 had already classified — `cast`/`rename`/`select` as row-data tolerance and
`filter` as operator semantics. Those pass-1 verdicts were correct **about the lines pass 1 matched**; each spec
simply carries a second, config-level guarantee elsewhere in the file. The pass-1 table rows for those four are
therefore incomplete rather than wrong, and are corrected by this pass.

**Result across all 21 specs: 4 need a delta (all have one); 6 state a real config guarantee the design now
preserves explicitly by pinning the field optional (D8 — `limit.count`, `sort.sortBy`, `cast.casts`,
`rename.renames`, `select.fields`, `filter.conditions`), no delta needed; 11 unaffected.**

## Fourth pass — absence/optionality vocabulary, all 21 specs (design gate round 8)

Pass 3 matched *emptiness* phrasing with the adjective before the noun (`empty casts map`). Pass 4 targets the
inverted and absence-oriented forms (`when X is empty`, `leaving ... empty`, `valid configuration`, `optional`).

| Spec | Found | Verdict |
| --- | --- | --- |
| `pipeline-dedupe-op` | :9 "When `keys` is empty, rows are compared as whole rows"; :52 "Leaving the key multi-select empty SHALL be a valid configuration (whole-row distinct)"; named scenarios :59 and "Whole-row distinct" | **config tolerance — real, and behaviour-defining.** `dedupe.keys` pinned optional in D8. No delta. |
| `pipeline-unpivot-op` | `varName`/`valueName` declared optional in the field declaration | known-optional, citation in hand; 1.2b confirms rather than rediscovers |
| `pipeline-window-op` | `offset` optional; `field` **conditionally** required (`:14-15`, scenario `:49-50`) | not a tolerance guarantee, but drives task 4.1's conditional-requiredness requirement |
| `pipeline-date-bucket-op` | `outputColumn` declared optional | known-optional, citation in hand |

**Why pass 3 missed `dedupe.keys`:** its pattern required the adjective before the noun (`empty ... map/array`),
and the spec writes "when `keys` **is** empty". A word-order variant defeated it. Note also that this was the
first finding inside a spec **this change is already modifying** — our own `pipeline-dedupe-op` delta restates
the sentence verbatim at its line 5 — so re-reading the change's own deltas, not only `openspec/specs/`, is part
of closing this class.

**Running total: 7 fields pinned optional in D8.**

**Saturation is NOT demonstrated, and this artifact no longer claims it.** After pass 2 this document asserted
"both known [patterns] are exhausted" and "coverage is now 21 of 21". A third pattern falsified that in minutes,
finding four more real guarantees — after pass 2 had already been added for exactly this reason. Twice is a
pattern: each pass has found what the previous pass's boundary hid, and there is no principled reason to expect
pass 3 to be the last vocabulary in which a spec can express "the empty case is fine".

**So the enumeration is not the guarantee, and should not be read as one.** Its value is that it found 4 real
delta-requiring contradictions and 6 fields that must be pinned optional — findings that stand on their own,
each checkable against a cited line. Its completeness does not.

A fourth vocabulary found a seventh field, which is further confirmation that retracting the exhaustion claim
after pass 3 was the honest call rather than excessive caution. Four passes, four new findings, no diminishing
returns yet visible.

**The guarantee is structural: task 1.2b.** Every field the executor marks `required` must be checked against its
op spec's requirement text, per field, with the file and line recorded in `enumeration.md`. That closes the class
regardless of which vocabulary a spec happens to use, because it starts from the field and looks for the spec,
rather than starting from a pattern and hoping it matches. A field this enumeration mis-classified is caught
during execution rather than shipped.

**Saturation argument.** The 4 affected specs are exactly those whose language describes *config-decode* or
*config-value* tolerance. The 10 unaffected divide cleanly into row-data tolerance (6), operator/per-function
semantics (2), and specs already aligned with D3 (2). The classification is mechanical and checkable, so this is
falsifiable: overturning it means naming a row-data hit this change actually reaches, or a config hit missed.

**Widening beyond step-ops — bounded, not reflexive.** 53 specs repo-wide match the coarse pattern. The walk does
not suggest widening: every one of the 4 real hits was in a `pipeline-*-op` spec describing a step's own config
decode, which is the only surface this change modifies. The non-step-op specs describe panels, dashboards, auth,
alerts and MCP surfaces, none of which decode pipeline step configs. The two adjacent capabilities that DO
(`pipeline-step-config-validation`, `pipeline-step-config-rejection`) were already carrying deltas before this
round. Checking the remaining ~32 would be checking specs for a surface they do not touch.
