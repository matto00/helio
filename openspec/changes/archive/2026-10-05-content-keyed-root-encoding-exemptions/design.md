## Context

See proposal.md for motivation. The guard exists because of HEL-913's multi-root remodel (design.md R12): under multiple roots, `node_step_id IS NULL` with no `root_id` qualifier matches *every* root's rows, so a read silently mixes roots and a delete silently wipes sibling roots (V98's `(node_step_id IS NULL) <> (root_id IS NULL)` CHECK only guarantees each row carries a root id, not that queries filter on it). The guard is a per-line text scan of three Scala repositories (and, in the `.ts` sibling, `helio-mcp/src`). Six Scala sites are deliberately exempt: the `(None, None)` single-root arms in `NodeSnapshotRepository` (`overwriteRowsAction`, `listRows`, `nodeFilterFragment`) and `BinaryRefRepository` (`overwriteForNode`, `findByNodeAndRow`, `selectQuery`), proven production-unreachable in the script's own comment block. One TS site (`context.ts`, `buildOutputSummariesByPipeline`'s `nodeStepId: o.nodeStepId ?? null,`, root-qualified on the next line) is exempt in the sibling.

Today each exemption is a `file:line` string. Hazard that shapes the design: two of the Scala exempt lines are textually identical modulo whitespace (`case (None, None) => sql" AND node_step_id IS NULL"`, in `listRows` and `nodeFilterFragment`). A naive "exempt any line whose text equals X" would exempt every future copy of that line anywhere.

## Goals / Non-Goals

**Goals:**
- Exemptions survive edits that do not touch the exempt line itself (or its enclosing declaration's name).
- A NEW unsafe line cannot be silently exempted by resembling an exempt one.
- Whole-file scan of `main` reports the same hit set before and after (6 Scala hits all exempt, 1 TS hit exempt, 0 violations).

**Non-Goals:**
- Changing the detection regexes, the scanned file set, or the type-level TS interface check (`KNOWN_TYPE_EXEMPT_INTERFACES` is already keyed by name, not line).
- Fixing or removing any exempt site (backend logic is out of scope; HEL-1276 owns that file next).
- Making the guard type-aware.

## Decisions

### D1. Normalised-text keying, not inline markers
An exemption entry is `{ file, scope, arm, text, count, reason }`:
- `file`: repo-relative path (unchanged from today).
- `scope`: name of the nearest preceding non-comment declaration (Scala `def <name>`, TS `function <name>`), computed by the scanner while walking lines.
- `arm`: the governing match arm -- the whitespace-normalised text of the nearest preceding (or same) non-comment line within the same scope that matches `^\s*case\b.*=>`, or the literal `<none>` when the scope has no such line (the TS site). For the three multi-line Scala sites (NodeSnapshotRepository `overwriteRowsAction`, BinaryRefRepository `findByNodeAndRow`/`selectQuery`) this is `case (None, None) =>`; for the three single-line sites it is the hit line itself, which already contains `case (None, None)`. This field exists because the exemption proof is *about the arm* ("this is the single-root `(None, None)` fallback"), and for multi-line sites the hit line alone does not carry that fact (skeptic design round 1, CR1).
- `text`: the line with leading/trailing whitespace trimmed and internal whitespace runs collapsed to one space.
- `count`: exact number of occurrences this entry covers (1 for every current entry).

Why text over markers (`// root-encoding-exempt: <id>`):
- **Source untouched.** No Scala or TS file changes, so no backend diff, no `sbt testFull` dependency, no merge-conflict surface with HEL-1276 / parallel lanes in exactly the file this ticket protects.
- **Markers do not buy safety.** The realistic way to create a new unsafe line is to copy an exempt one; a trailing marker is copied with it, so markers alone resemble-exempt just as text does. Both need the count bound (D2). With unique marker ids the guard could reject a duplicated id, but that is the same protection D2 gives text keys.
- **Reformatting.** Markers survive any reformat; normalised text survives whitespace-only reformatting (scalafmt alignment of `=>` is exactly the difference between the two `case (None, None)` lines today). A reformat that changes tokens or splits the line changes the hit itself and *should* force a re-review. Accepted trade-off.

Alternative rejected: keying on a neighbouring-line fingerprint (hash of N lines of context) — breaks on unrelated edits next to the site, which reproduces the original problem at smaller radius.

### D2. Exact count, enforced in both directions — the anti-resemblance mechanism
Hits are grouped by `(file, scope, arm, normalised text)`. For each group with a matching exemption:
- `hits > count` → **every** hit in the group is reported as a violation (the guard cannot know which occurrence is the reviewed one, so it refuses to guess; the message says "N occurrences, exemption covers M").
- `hits < count` → the exemption is reported as **stale** and the guard fails (forces the list to shrink when a site is fixed/deleted, so a dangling entry cannot later absorb a new line).
- `hits == count` → exempt.

This is how a new unsafe line resembling an exempt one goes red:
- same text, same declaration → surplus count → red;
- same text, different declaration (e.g. pasted into a new method) → no matching `(file, scope, arm, text)` key → red;
- same text, different file → key includes file → red;
- different text → no key → red;
- the governing arm is widened or rewritten (e.g. `case (None, None) =>` → `case (None, _) =>`, with the `(None, Some(rid))` arm deleted, so every root-bound call runs the bare predicate -- skeptic round 1's counterexample) → the hit's `arm` no longer matches → unmatched hit red AND the entry is stale → red. Today's line-keyed guard catches this only incidentally (via the line shift); arm keying catches it by construction.

Residual risk, stated: an edit that *deletes* an exempt site and adds an identical line in the *same* declaration in the same change keeps the count equal and stays green. That change necessarily rewrites code under the nearest preceding `def` (the scope as computed -- not true lexical enclosure; a `val`/`object` member added after an exempt method with no `def` of its own falls into that method's scope), so it is visible in review of that region; the swapped-in line is also, by construction, the same single-root arm the proof covers. Second residual, also stated: a proof-invalidating edit that touches neither the hit line nor its governing arm is not caught by this guard -- e.g. rewriting or shadowing the match scrutinee (a new `val explicitRootId: Option[String] = None` above the match) or a caller passing `None`. Today's line-keyed guard catches the line-adding forms of this only incidentally (via the line shift) and misses the in-place forms entirely; catching them would mean keeping exactly the line-shift false positives this ticket removes. The guard remains a text-level net under the HEL-913 proof, whose load-bearing fact is structural ("a caller must now say `None` out loud" -- `explicitRootId` has no default), not this guard. Third residual, also stated: `SCOPE_RE` is applied to the raw non-comment line, so a `def <name>` inside a trailing `//` comment or string literal re-scopes the lines after it; a fix-plus-swap that also plants such a spoof can place the swapped-in line outside the real declaration (so residual 1 is wider than "same declaration"). It needs a deliberate simultaneous deletion and spoof, and remains visible in review. A nested `def` inserted above an exempt site inside its own method likewise re-scopes the site (red, fail-closed): update the entry's `scope`. Renaming the enclosing method makes the exemption stale (red) — acceptable, because the rename touches the exempted code itself.

### D3. Scope and arm detection
Scala scope regex: `\bdef\s+(\w+)` on a non-comment line; TS: `\bfunction\s+(\w+)` on a non-comment line. Scope is "the most recent such line above", reset per file. The current arm resets to `<none>` whenever scope changes and is updated by every non-comment line matching `^\s*case\b.*=>` (the line's own text counts, so a single-line arm is its own arm). The TS guard computes `arm` the same way (no `case` arms exist in its exempt scope, so it is `<none>`). Comment lines -- trimmed starts with `//` or `*`, exactly today's rule in both scripts (a line starting `/*` is NOT treated as a comment, so `/* note */ sqlu"... node_step_id IS NULL"` is still a hit) -- never set scope or arm and are never hits (unchanged behaviour). A hit before any declaration has scope `<top>`.

### D4. Shared implementation shape, separate files; how failures surface
Each guard keeps its own exemption table and its own scope regex; the grouping/count logic is small enough to live in each script rather than introduce a shared module (keeps each guard independently runnable and the owned file set unchanged). `scanTextForViolations(relPath, text, exemptions?)` keeps its current signature; an optional third argument lets the selftest inject exemption tables, so proofs (c) and stale-entry do not depend on editing the shipped table. With no third argument the shipped table is used.

Stale-exemption failures are returned **in the same array** as violations (so the entry point's existing "non-empty → exit 1" path covers them), as messages prefixed `stale exemption:`; `scanTextForViolations` reports only entries whose `file === relPath`. A missing TARGET_FILE (ENOENT) is no longer silently skipped when it still has exemption entries: the entry point calls `scanTextForViolations(relPath, "")`, which reports every entry for that file as stale, so renaming/deleting an exempt file forces the table to be updated. A missing file with no entries is still skipped (unchanged). The TS entry point has no fixed TARGET_FILES list (it scans whatever `listTsFiles` finds under `helio-mcp/src`), so after its scan it evaluates every table entry whose `file` was not among the scanned files by calling `scanTextForViolations(file, "")`, reporting those entries stale -- the same outcome for a renamed/deleted `context.ts`.

### D5. Selftest proofs
Selftests drive the real shipped exemption table against the real target file text read from disk (plus in-memory mutations of it), not only synthetic fixtures:
- (baseline) real file text → 0 violations;
- (a) real file with 40 blank/comment lines inserted at the top and in the middle above the exempt sites → 0 violations;
- (b) real file plus one new standalone `node_step_id IS NULL` line in a new method → exactly 1 violation naming it;
- (b') real file plus a verbatim copy of an exempt line in the same method → violations for that group;
- (b'') verbatim copy of an exempt line in a different method → 1 violation;
- (c) shipped table minus one entry → that site reported;
- (stale) shipped table, real file with an exempt line deleted → stale-exemption failure;
- (whitespace) an exempt line re-indented / re-aligned → still exempt;
- (arm) at BinaryRefRepository `selectQuery` and at NodeSnapshotRepository `overwriteRowsAction`: delete the `(None, Some(rid))` arm and widen `case (None, None) =>` to `case (None, _) =>` → red (unmatched hit + stale entry);
- (missing file) entry point behaviour for a file with entries that is absent → stale reported (driven via `scanTextForViolations(relPath, "")`).
The new-method case (b) inserts its method *after* all exempt sites' scopes end in a way that does not split an exempt scope (e.g. appended at end of file), so its assertion is exactly one violation and no stale entries.

**Mutation proof of the selftest (task 3.2)** -- each scanner mutation is applied, the selftest run, the named cases must FAIL, then the script restored with exact-path `git checkout -- scripts/check-node-root-encoding.mjs`:

| Scanner mutation | Selftest cases that must turn FAIL |
| --- | --- |
| key by line number instead of content | (a) line-shift (also observed: (b'), (stale)) |
| whitespace normalisation dropped (raw/trimmed text in the key) | (whitespace) |
| count bound disabled (exempt on any key match) | (b') same-scope duplicate |
| scope dropped from the key | (b'') other-scope duplicate |
| stale check disabled | (stale), (missing file) |
| arm dropped from the key | (arm) |
| text dropped from the key (`[file, scope, arm]`) | (text) |
| arm not reset on scope change (`arm = NO_ARM;` deleted) | (arm-reset) (Scala); (d2) (TS: a `case ... =>` line in an earlier function must not leak into the exempt function's arm) |

Additional selftest case (both guards): a code line with a leading `/* ... */` comment followed by a hit → red (pins today's comment rule).

TS selftest: cases line-shift green, duplicate red, removed-exemption red, stale red, missing-file stale (via `scanTextForViolations(file, "")` and via the entry point's post-scan evaluation of unscanned entry files); mutations: line-number keying, count bound off, stale check off, text dropped from the key (case (text): in-place `?? null` -> `|| null`), arm not reset (case (d2)), post-scan pass off (case (g1)) -- same procedure.
Existing synthetic regex cases (raw SQL, Slick forms, root-qualified same-line) are kept. The TS selftest gets the same shape for its one entry.

### D6. Before/after hit parity
Prove with a throwaway comparison: run the pre-change detector and the post-change detector over the three Scala files and `helio-mcp/src` on the same tree, list raw hits (pre-exemption) and violations; they must be identical (raw hits: 6 Scala / 1 TS; violations: 0). Recorded as evidence in the evaluator report; any scratch file removed by exact path.

## Gate-Chain Implications Checklist

Not a gate-chain change: `.husky/pre-commit` does not invoke these scripts (verified by grep); they run only in CI (`.github/workflows/ci.yml` lines 40–43) and via `npm run`.
- **What does it execute?** `node` on the four `scripts/check-node-root-encoding*.mjs` files; read-only.
- **What environment does it inherit, and from where?** CI's checkout / the developer's shell; no env vars read.
- **Does it write anything outside its own sandbox?** No; read-only file access, stdout/stderr only.
- **Does it behave differently from a linked worktree than from a main checkout?** No; paths resolve from the script's own location.
- **What happens on its first run?** Same as every run.

## Risks / Trade-offs

- [Same-declaration swap stays green] → Documented in D2; visible in review of the exempted method itself.
- [Scope regex misattributes (e.g. a `def` inside a string)] → Only affects which group a hit falls in; a misattribution makes an exempt site *unmatched* (red), never silently exempts a different one. Selftest pins current scopes.
- [Stale-entry failure annoys a future fixer] → Intended; the message tells them to delete the entry.

## Migration Plan

Script-only; revert the four files to roll back.
