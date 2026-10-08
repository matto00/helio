## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 24f6de4cf290c216c8ba94359f82d1d35ae88f2a. The change dir is untracked. Artifacts read: ticket.md,
proposal.md, design.md, tasks.md, workflow-state.md and skeptic-design-2.md. I checked each claim against the live tree
(Scala 2.13.15, per `backend/build.sbt:4`).

### What I verified (with evidence)

**Round-2 CR1 (javap allowed additions for `OutputConfigValidation`): addressed.** D5b(b) now says
`OutputConfigValidation`/`OutputConfigValidation$` may only ADD these, and every pre-existing member must stay identical:
- the three moved public methods;
- `validateConfig$default$4()`;
- the static forwarders the mirror class emits for those four;
- `$anonfun$` synthetics.

It also requires `OutputService`/`OutputService$` to keep `validateConfig$default$4()`. The live companion confirms this
is coherent. `validateConfig` (OutputService.scala:483-498) has the default `policy: OutputConfigWritePolicy =
OutputConfigWritePolicy.ValidateWrite`, so the forwarder (D3: "same parameter names and the `policy` default") keeps
that default method. C2 in design.md, tasks.md and workflow-state.md defers to "classified per D5b(b)", so it is
consistent by reference. The "added `$$` fails" rule is unchanged.

**Round-2 CR2 (header doc amendment): addressed.**
- D3 permits one scoped amendment of at most two lines to the header doc at OutputConfigValidation.scala:6-11. I read
  those lines live: "only what a write introduces or changes is judged".
- The amendment's content is specified: the object also holds the moved whole-config write validators, which judge the
  MERGED config's `fieldMapping`/`compare`/`historyPayloads` outside the tolerance rule.
- D5 lists "the D3 header amendment" as an allowed category.

**Round-2 non-blocking notes absorbed.**
- D5 positional words now include "THIS class".
- "Removal of imports left unused by the move" is a permitted category.
- The `"OutputService: no OutputBindingSpec ..."` text stays verbatim and is a follow-up candidate (Planner Notes).

**New-breakage check (nothing found).**
- **Line anchors:** OutputService `requireUnambiguousRootWhenNeither` at :181 (doc from :170), `resolveExplicitRootId`
  at :204, `materializedFor` ending at :449, companion at :452, validators at :457-502. NodeSnapshotRepository's
  fragment builders run :205-311. These match the design.
- **Moved validator body resolves in its new home.**
  - `OutputBindingSpec.validateFieldMapping`, `OutputCompare.validateConfig`, `PayloadOptIn.validateConfig` and
    `OutputConfigValidation.validate` are all qualified, so the new same-named members cannot shadow them.
  - The bare `mergeConfig`/`validateFieldMapping` calls hit the moved members.
  - `JsObject`/`JsString` are already imported in OutputConfigValidation.scala:4. `ServiceError`, `OutputBindingSpec`,
    `OutputCompare` and `PayloadOptIn` imports fall under the "package/imports" category.
- **`rootResolution` cannot leak a `$$` accessor through closures.**
  - Its only callers in `create` (:140, :143) sit inside `flatMap { case ... }` Function1 lambdas, not
    PartialFunction anonymous classes.
  - The current `private def`s are already called from those same lambdas, and round-2's javap of the base showed no
    `$$` member on `OutputService`. Swapping in a `private val` in the same position adds none.
  - If it did, D5b(b) fails loudly rather than silently.

### Verdict: CONFIRM

### Non-blocking notes
- "Amendment of at most two lines" does not say whether the two lines are edited or appended. Either way, the D5b(a)
  reverse checker must claim the amended or added lines as the allow-listed D3 line, not as "kept" base text. The
  executor should name the exact lines in move-evidence.md.
- C2's text in tasks.md and workflow-state.md names only `OutputService` and `NodeSnapshotRepository`. The
  `OutputConfigValidation` rules live only in D5b(b). That is fine by reference, but the final-gate reviewer should
  check `OutputConfigValidation`'s javap diff explicitly.
- tasks.md still lists C5 before C4. This is cosmetic.
