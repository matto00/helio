## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed `ticket.md`, `proposal.md`, `design.md`, `tasks.md` and `specs/pipeline-client-evaluator/spec.md` in the worktree at HEAD `83cbfc0223ec64a1ea060cbe5110ca03e9b0d617` (the change directory is untracked), against `skeptic-design-2.md`.

Regex claims were probed in the real engines: JDK 21.0.12 `java.util.regex` (the engine `StringOpsStep.extractRegexFn` uses, `StringOpsStep.scala:157-177`) and Node 22 `RegExp` with the `u` flag, using the design's own translations. Every probe was run twice and the outputs compared byte-for-byte (`cmp` clean).

Durable evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1581/evidence/skeptic-design-3/`
- `probes-output.txt` (sha256 `7f52cffe9349ae3d61ba4bd83df2d685d0ff95f2903826c77748e0115085e7ee`);
- probe sources `P.java`, `p.mjs`, `cases.json`, `cases2.json`.

No mtime-ordering claim is relied on anywhere in this report.

### What I verified (with evidence)

**Round-2 change requests**

| CR | Status | Ground truth |
| --- | --- | --- |
| 1.1 `$` translation | Resolved | design.md:131 uses the verified form. Re-probed: `(a\r)$`/`"a\r\n"`, `(\r)$`/`"\r\n"`, `(\n)$`/`"\r\n"`, `(a)$`/`"a "`, `(a)$`/`"a\r\r"`, `()$`/`"a\r\n"`, `(.*)$`/`"ab\r\n"`, `(\s*)$`/`"a\r\n"`, `(a$\n)`/`"a\n"` all agree. Vector at :175. |
| 1.2 `\-` literal | Resolved | :124. Every listed escape at :123 compiles in `u` mode, outside and inside a class, with Java's meaning (batch 2, cases 6-7). |
| 1.3 class holes | Resolved | :151-153, :161. |
| 1.4 `\S` in class | Resolved | :154. `[^\sa]` expanded per :146 agrees on U+00A0 (batch 2, case 0). |
| 1.5 quantified group | Resolved | :160 declines every quantified group. |
| 1.6 safety net | Resolved | :108. |
| 1.7 invariant | Stated | :111-116. **But it does not hold; see CR2 below.** |
| 1.8 vectors | Resolved | :171-188. |
| 2 spec "error or decline" | Resolved | spec.md "Step failure agrees". |
| 3 `laneError` + `framesWithout` | Resolved | design.md:269, :293; tasks 1.2 and 1.4. |
| Round-2 notes | Applied | datebucket hedge removed (:90); fractional epoch (:333); source secondary doubles only (:283); one failing step per vector (:270); `" 1"` trap (:328). |

**Other allowlist probes that agree**
- Class ranges and dashes: `[a-b-c]`, `[!--]`, `[\--/]`, `[\\-a]`, `[\t-\r]`, `[\w-]`, `[-\w]`.
- Negated classes with class escapes: `[^\D]`, `[^a\W]`.
- Astral handling: `.`, `\W` and `[^a]` on 😀, `😀{2}`, a lone surrogate.
- Alternation priority: `(a|ab)(c|bcd)`.
- Quantifiers: `{01}`, a lazy `$`, `{0,2147483647}`.
- `[z-a]` and `a{3,2}`: both engines reject, so the safety net declines them, which is correct.
- `[\w-a]`: Java accepts, JavaScript rejects, so the client declines, which is safe. :153 already declines it.

**Scope.** Only piece (a). Every AC still maps to a task, with no API, schema or migration delta.

### Verdict: REFUTE

Two allowlisted constructs still produce client rows that differ from Scala. One is an outright factual error in the design (`\b`). The other contradicts the invariant the round-2 fix added. Both are stable across two runs.

### Change Requests

1. **`\b` / `\B` are not "the same" in both engines; decline them** (design.md:128, :180).
   - Java's `Pattern.Bound` treats a Unicode non-spacing mark (category Mn) that follows a letter or digit as a word character (`hasBaseCharacter`, which uses `Character.isLetterOrDigit`, a Unicode test). JavaScript `u`-mode `\b` is purely ASCII `\w`. Decomposed (NFD) text, such as macOS file names and much scraped data, hits this. Evidence (`probes-output.txt`):

     | Pattern / input | Java | JavaScript |
     | --- | --- | --- |
     | `(\w+)\b` / `"cafés"` | `"s"` | `"cafe"` |
     | `(a\b)` / `"á"` | no match → `null` | `"a"` |
     | `(a\B)` / `"á"` | `"a"` | no match → `null` |
     | `(\w\b)` / `"xá "` | no match | `"a"` |
     | `(a)\b` / `"à"` | no match | `"a"` |
     | `(é\b)` / `"é́"` | `"é"` | no match |
     | `(e\b)` / `"caf é"` | no match | `"e"` |

   - Required changes:
     - Move `\b` and `\B` from the translation table (:128) to "Declined everywhere" (:161-167).
     - Replace the `\b` entry in the required vectors (:180) with decline vectors, each recording Scala's rows and `clientDeclines: unsafeRegex`. Include at least `(\w+)\b` on `"cafés"` and `(a\b)` on `"á"`.
     - Alternatively, translate `\b`/`\B` with an exact emulation of `Bound.match` that includes `hasBaseCharacter`. If so, state the emulation precisely and add the vectors above as positive vectors. Declining is strongly preferred.
     - Drop the now-moot "quantified `\b`/`\B`" wording at :161 if `\b`/`\B` are declined outright.

2. **Quantifier bounds above `Integer.MAX_VALUE` break the stated invariant** (design.md:111, :134, :166).
   - Java computes `{n,m}` bounds with overflow-checked int arithmetic and raises "Illegal repetition range" past 2147483647. JavaScript accepts any size.
   - So the allowlist accepts a Java-invalid pattern that `new RegExp` also accepts. The safety net does not catch it, and the client returns rows where Scala fails the step. Evidence:

     | Pattern / input | Java | JavaScript |
     | --- | --- | --- |
     | `(a{0,99999999999})` / `"aaa"` | COMPILE ERROR → Scala `StepConfigError` | `"aaa"` |
     | `(a{1,99999999999}?)` / `"aaa"` | COMPILE ERROR | `"a"` |
     | `(a{2147483648})` / `"aaa"` | COMPILE ERROR | no match → `null` row |
     | `(a{0,2147483647})` | accepted | accepted (agree) |

   - Required changes:
     - Decline as `unsafeRegex` any quantifier whose `n` or `m` exceeds 2147483647. A tighter cap, such as 4 digits, is also acceptable and simpler, provided it is stated.
     - Add the vector `(a{0,99999999999})`: `scalaError`, `clientDeclines: unsafeRegex`.
     - Optionally, reword :115 to say that the corpus's Java-invalid decline vectors are the only enforcement. The invariant is a design claim, and this hole shows it needs a vector for each class of Java-only rejection.

3. **Fix the contradictory spec location in proposal.md.** proposal.md "Impact" says the new backend spec goes under `backend/src/test/scala/com/helio/domain/steps/`. design.md:275 and task 1.2 say `backend/src/test/scala/com/helio/domain/engine/`, which is correct: package `engine` is needed to reach `executeTree` and the `private[engine]` members. Make proposal.md say `domain/engine/`.

### Non-blocking notes

- `extractRegex` matches against `v.toString` (`StringOpsStep.scala:174`). A double field therefore matches the Java rendering, such as `"3.0"`. Obligation 3 covers this implicitly. Consider one vector: a regex over a double field.
- Gate-defect check: no report under review disclosed unsound mtimes, and this gate accepts no mtime-ordering claim.
