## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### What I verified (with evidence)

1. **`openspec validate` + fresh archive rehearsal (independent, throwaway copy `/tmp/hel825-sk5`).**
   `openspec 1.10.0`; `Change 'rename-connector-spi-resolve-api' is valid` (exit 0);
   `openspec archive ... -y --json` -> `"specsUpdated": true`, `"totals": {"added":0,"modified":23,"removed":0,"renamed":7}`,
   no `archive_spec_update_failed`. **Matches the claimed 23/7 exactly.**

2. **Byte-for-byte delta/canonical check (script, all 9 capabilities).** For every delta I parsed the
   `RENAMED` FROM/TO pairs and every `## MODIFIED` requirement, located its canonical counterpart, applied
   the rename map, and diffed. Result: every `RENAMED FROM` header is byte-exact against the canonical
   spec's current header (including `connector-secret-redaction`'s
   `### Requirement: Connector.scala documents the redaction contract`); every MODIFIED block reproduces
   the canonical requirement including all its scenarios (no dropped scenarios). All remaining diffs are
   benign and intentional: prose re-wrapping, the two deliberate migration-note sentences in
   `connector-registry`, and the deliberately-unrenamed scenario titles (decision 5a).
   `connector-secret-redaction` specifically: 1 canonical scenario, 1 scenario in the MODIFIED block,
   body identical modulo the intended `Connector.scala` -> `ConnectorDriver.scala` rename. Correct.

3. **Decision 5a's premise tested empirically (not taken on faith).** I renamed one scenario title in the
   `schema-inference-facade` delta on a second throwaway copy and re-archived:
   `archive: null`, `code: "archive_spec_update_failed"`, "current spec contains scenario(s) not present
   in the modified block". Decision 5a is factually correct; the 8 stale scenario titles are a genuine
   tool constraint, enumerated and falsifiable in task 5.3. (Minor factual nit, non-blocking: `openspec
   validate` *did* flag this case, contrary to design.md 5a's "validate does not catch either failure
   mode". The rehearsal is still the right gate.)

4. **Post-archive canonical sweep.** In the archived `/tmp` copy, the only old-name matches under
   `openspec/specs/` are exactly: 5 `## Purpose` lines (the 5 files task 4.3 owns), the 8 scenario titles
   task 5.3 enumerates, and the 2 deliberate migration notes. The 9-capability spec enumeration is
   genuinely exhaustive and the post-state is exactly as planned.

5. **openspec tooling surfaces beyond `specs/*/spec.md`.** `find openspec -maxdepth 2 -type f` outside
   `changes/`/`specs/` returns only `openspec/config.yaml` and `openspec/workflow-state.md`; there are no
   per-capability `.openspec.yaml` files and no `openspec/README.md` (`find openspec/specs -type f -not
   -name spec.md` == empty). `openspec/config.yaml`'s embedded `context:` block does **not** name
   `/api/connectors`, `list_connectors`, or any renamed identifier. Nothing here needs a delta.

6. **My own additional grep variant (the defect below).** Beyond the described sweeps, I ran a
   maximally-broad *code-side* token census (not anchored to the plan's pattern):
   `grep -rnoE '\b[A-Za-z]*Connector[A-Za-z]*(\.[A-Za-z_]+)?' --include=*.scala --include=*.ts --include=*.tsx --include=*.md backend frontend helio-mcp docs schemas scripts | sed ... | sort | uniq -c`
   This surfaced `Connector.scala` appearing **6 times in code files** — a form the round-4 widening
   applied only to the `openspec/specs/` pattern, never to the code-side task enumerations.

### Verdict: REFUTE

The round-4 fix widened the pattern for `openspec/specs/` (adding `\bConnector\.scala\b`) but tasks 1.4,
1.5 and 2.1 — the code-side enumerations and their "verify by grep" acceptance checks — still use the
pre-widened `\bSqlConnector\b|\bRestApiConnector\b|Connector\[`. Under that narrower pattern **two files
carrying a `Connector.scala` doc-comment reference are enumerated nowhere in tasks.md**, and the task's
own verification grep would report clean while the stale reference survives:

```
$ P='\bSqlConnector\b|\bRestApiConnector\b|Connector\[|\bConnector\.scala\b|\bConnector\.testConnection\b'
$ comm -13 <(grep -rlE '<narrow>' --include=*.scala backend/src/main|sort) <(grep -rlE "$P" ... |sort)
backend/src/main/scala/com/helio/services/auth/SecretField.scala
$ comm -13 <(... backend/src/test ...)
backend/src/test/scala/com/helio/domain/engine/SchemaInferenceEngineSpec.scala

$ grep -n ... backend/src/main/scala/com/helio/services/auth/SecretField.scala
37: *  see `Connector.scala`'s `'''Secret redaction'''` doc block. */
$ grep -n ... backend/src/test/scala/com/helio/domain/engine/SchemaInferenceEngineSpec.scala
117:      // Connector.scala's '''Schema inference''' doc block.

$ grep -rlE "$P" --include=*.scala backend/src/main | wc -l   ->  19   (tasks.md/ticket.md say 18)
$ grep -rlE "$P" --include=*.scala backend/src/test | wc -l   ->  27   (tasks.md/ticket.md say 26)
```

Both are compiler-invisible doc comments naming a file this change deletes (`Connector.scala` ->
`ConnectorDriver.scala`), so the build/test suite cannot catch them — exactly the AC-2/AC-4 drift, and
exactly the failure mode task 1.5 exists to prevent. `SecretField.scala:37` is doubly notable: it is the
code-side counterpart of the very requirement round 4 added the 9th delta for
(`connector-secret-redaction`) — the spec would be updated while the code it describes keeps pointing at
the deleted file name. Task 5.3's repo-wide check does include `Connector\.scala\b` and would surface
these at the very end, but as an unowned, unexplained failure outside all three of its stated exclusions,
with no task assigned to fix them; that is a broken plan, not a safety net.

### Change Requests

1. **tasks.md 1.5** — widen the enumeration and its acceptance grep to the fully-widened pattern
   `\bSqlConnector\b|\bRestApiConnector\b|Connector\[|\bConnector\.scala\b|\bConnector\.testConnection\b`,
   and add the missing file **`backend/src/main/scala/com/helio/services/auth/SecretField.scala`** (line 37,
   doc comment: ``see `Connector.scala`'s `'''Secret redaction'''` doc block``) to the explicit
   doc-comment-only file list. Update the verification command in 1.5 to the widened pattern (the current
   narrow one returns empty while the reference is still stale).
2. **tasks.md 2.1** — widen the same pattern in the file-selection grep and add
   **`backend/src/test/scala/com/helio/domain/engine/SchemaInferenceEngineSpec.scala`** (line 117,
   comment: `// Connector.scala's '''Schema inference''' doc block.`) to the enumerated test-file list.
   Update the stated count **26 -> 27**.
3. **tasks.md 1.4/1.5 preamble and ticket.md's consumer enumeration** — update the backend Scala file
   totals from **"44 backend Scala files total (18 main + 26 test)"** to **46 (19 main + 27 test)**, and
   change the quoted re-derivation command in ticket.md from
   `grep -rlE '\bSqlConnector\b|\bRestApiConnector\b|Connector\[' --include=*.scala backend/src` to the
   fully-widened pattern, so the ticket's own recipe reproduces the number it claims.
4. **design.md Risks section** — the mitigation bullet lists the bidirectional sweep patterns as
   `Connector\[`, `SqlConnector\b`, `RestApiConnector\b`, `/api/connectors`, `list_connectors`; add
   `Connector\.scala\b` and `Connector\.testConnection\b` so the design's stated mitigation matches the
   pattern tasks 4.1/5.3 actually use. A single canonical pattern string quoted identically in ticket.md,
   proposal.md, design.md, tasks.md 1.5/2.1/4.1/5.3 would end this recurring class of defect (5 rounds,
   5 findings, all from the same root cause: multiple divergent copies of the pattern).

### Non-blocking notes

- design.md decision 5a states `openspec validate` catches neither archive failure mode; my experiment
  shows it does catch the dropped-scenario mode (it did not catch the header mode, untested here). The
  archive rehearsal remains the correct gate — no change required, just an inaccurate parenthetical.
- The 8 deliberately-stale `#### Scenario:` titles are a real, tool-imposed residue. Task 5.3 enumerates
  them precisely and I confirmed the post-archive count is exactly 8, no more. Acceptable; worth a
  one-line note in the PR body so a reader does not read them as an oversight.
