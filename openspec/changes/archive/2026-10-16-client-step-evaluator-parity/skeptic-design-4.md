## Skeptic Report — design gate (round 4, skeptic-design-4.md)

I reviewed `ticket.md`, `proposal.md`, `design.md`, `tasks.md` and `specs/pipeline-client-evaluator/spec.md` in the worktree at HEAD `83cbfc0223ec64a1ea060cbe5110ca03e9b0d617`. The change directory is untracked. I checked them against `skeptic-design-3.md`.

I probed the regex claims in the real engines: JDK 21.0.12 `java.util.regex` and Node v22.23.2 `RegExp` with the `u` flag, using the design's own translations. I ran the probe twice. The two outputs are byte-identical: `cmp` reported no difference.

Durable evidence is in `/home/matt/Development/helio/.concertino/runs/HEL-1581/evidence/skeptic-design-4/`:
- `probes-output.txt` (sha256 `1d65d71e5535901523bb484d285f7fbae94ef4244ee23d079fc6b72efe648140`);
- the probe sources: `P.java`, `p.mjs` and `cases4.json`.

No mtime-ordering claim is relied on anywhere in this report.

### What I verified (with evidence)

**Round-3 change requests**

| CR | Status | Ground truth |
| --- | --- | --- |
| 1: decline `\b` / `\B` | Resolved | `\b`/`\B` are gone from the translation table (design.md:111-124). They are now declined everywhere (:151), with the round-3 probe given as the reason. The decline vectors `(\w+)\b` and `(a\b)` are at :178, under "Scala's outcome recorded" (:172). The moot "quantified `\b`" wording is gone. |
| 2: bounds above `Integer.MAX_VALUE` | Resolved | The quantifier row (:124) caps every bound at 2147483647, and :152 declines anything above it. The Java-invalid vector `(a{0,99999999999})` is at :179. Re-probe: `(a{2147483647})` and `(a{00000000002147483647})` agree (`nomatch`, cases 0-1). `(a{0000000000002147483648})` is a Java COMPILE ERROR, while JS accepts it (case 2). A value-based cap, which is what :124/:152 state, declines it. |
| 3: proposal spec path | Resolved | proposal.md:71 now says `backend/src/test/scala/com/helio/domain/engine/`. That matches design.md:268 and task 1.2. |

**No regression.** The `$` and `.` translations still contain literal U+2028/U+2029 (byte check with `od` on design.md:119/:121). Round-2 resolutions are still in place:
- the `\-` literal (:115);
- the class rules (:131-146);
- quantified groups declined (:150);
- the safety net (:99);
- `laneError` + `framesWithout` (:262-266, :286);
- one failing step per vector (:263).

The spec still says "error or decline". Tasks 1.2-1.4 and 3.2 still map to the decisions, and C1-C5 are intact. Scope is still piece (a) only: every AC maps to a task, and there is no API, schema or migration delta.

**Allowlist adversarial sweep.** I ran 47 new cases.

Constructs the allowlist accepts all agree between Java and JS, and Java compiles every one of them:
- class edge cases: `[a^-z]`, `[^-a]`, `[--a]`, `[a-c-e]`, `[a-]`, `[\[-\]]`, `[\$-\.]`, `[\/]`, `[}{)(|.*+?$]`, and an astral range `[😀-😂]`;
- quantifiers: `{n}?`, `{0}`, `{3,}?`, `[😀]{2}?`;
- empty alternatives and an empty group: `(a|)`, `(|a)`, `()`;
- nested and non-participating groups;
- escapes: `\/`, `\}`, `\^`, `\\`, `\-`, `\f\t`;
- `\d` against Arabic-Indic digits, `\w`/`\W` against é and an astral character;
- the translated `.` against U+2029, the translated `\s` against VT/U+001C, and the translated `$` against U+2028/U+0085/`"\n"`/`""`.

Divergences found:
- **Java accepts, JS `u` rejects:** `(a{2}{3})` (Java gives `"aa"`), `(a?+)`, `(a{1}+)` and `(a])`. The allowlist declines all four, and the safety net also catches them. The only cost is that these patterns are not previewed client-side.
- **Both engines reject:** `(a{,3})` and `(a**)`.
- **Java rejects, JS accepts:** the leading-zero over-max bound in case 2. The value-based cap covers it.

I could not construct any allowlist-accepted pattern that is Java-invalid, or that gives a different group 1 in the two engines.

### Verdict: CONFIRM

All three round-3 change requests are resolved, and nothing regressed. As written, the allowlist admits no Java/JS divergence and no Java-invalid pattern I could construct, across rounds 2-4 of probing.

### Non-blocking notes

- **Value-based bound check.** Implement the 2147483647 cap by numeric value, not by digit count. A bound with leading zeros, such as `{0000000000002147483648}`, is Java-invalid, while `{00000000002147483647}` is valid (cases 1-2). Consider adding the leading-zero over-max form as a second decline vector.
- **Regex over a double field.** This is carried from round 3. `extractRegex` matches against `v.toString`, so one vector over a double field (`3.0`) would pin obligation 3 for regex.
- **Synchronous backtracking.** Allowlisted patterns such as `.*.*.*.*x` are polynomial-time on 1,000-row frames, and the evaluator is synchronous. This is not a parity issue, because Scala backtracks the same way. It is a latency risk for HEL-1631, which wires the evaluator to keystrokes. Consider noting it there.
- **Gate-defect check:** no report under review disclosed unsound mtimes, and this gate accepts no mtime-ordering claim.
