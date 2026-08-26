## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

**Round-2 CR3 — archive rehearsal (VERIFIED FIXED).** Ran my own rehearsal twice, each against a
fresh throwaway copy, not the executor's:
```
rm -rf /tmp/skep3-check && mkdir -p /tmp/skep3-check && cp -r openspec /tmp/skep3-check/openspec
cd /tmp/skep3-check && openspec archive rename-connector-spi-resolve-api -y --json
-> "specsUpdated": true, "totals": {"added":0,"modified":21,"removed":0,"renamed":6}, EXIT=0
```
Non-null `archive` key, no `archive_spec_update_failed`. Reproduced identically on a second fresh
copy (`/tmp/skep3-check2`). `openspec validate ... --type change` also passes. Task 4.1's rehearsal
recipe is real and does what round 2 demanded; task 4.3 (real archive) is correctly added.

**Round-2 CR1 — RENAMED sections (VERIFIED FIXED).** Delta headers confirmed by direct grep of the
7 delta files: `connector-spi` has 3 FROM/TO pairs, `connector-registry` 2, `fetch-error-envelope` 1
= 6 total, exactly matching the tool's reported `"renamed": 6`. Syntax is the supported
`## RENAMED Requirements` + `- FROM:` / `- TO:` form, placed ahead of `## MODIFIED Requirements`.
Every `## MODIFIED Requirements` `### Requirement:` header references the NEW (post-rename) title
(e.g. `### Requirement: Shared ConnectorDriver lifecycle trait`), as the tool requires.

**Round-2 CR2 — no scenario titles renamed (VERIFIED FIXED).** Compared the sorted `#### Scenario:`
title sets of all 7 canonical specs before vs. after the rehearsal archive: **identical for all 7**.
Zero scenario titles change anywhere. Requirement-title sets differ in exactly the 6 renamed
headers and nowhere else. Decision 5a is applied consistently.

**Behavior preservation (VERIFIED).** For each of the 7 specs I reverse-applied the rename map
(`ConnectorDriver`->`Connector`, `/api/connector-types`->`/api/connectors`,
`list_connector_types`->`list_connectors`) to the post-archive file and diffed word-multisets
against the pre-change canonical. Five specs are word-identical. `connector-spi` differs only by
line-rewrap plus one clarifying parenthetical ("under their pre-change names") — semantically
correct. `connector-registry` differs only by the two deliberate migration-note sentences. **No
deletions in any spec** — nothing lost. This is a genuine name-only change.

**Task numbering (VERIFIED consistent).** No orphaned references to an old 4.2 numbering; 4.1
forward-references 4.3 and 4.2 forward-references 4.3, both explicitly. Minor ordering oddity noted
below as non-blocking.

**Round-2 CR4 — archive exclusion (VERIFIED PRESENT, but incomplete — see CR2 below).** Both tasks
3.5 and 5.3 now explicitly exclude `openspec/changes/archive/**`.

### Verdict: REFUTE

Two new, reproduced defects that rounds 1 and 2 did not surface. Both are the *same class* the
prior rounds kept finding (an enumeration asserted as exhaustive that isn't, and a zero-match
assertion that cannot be achieved), recurring in new form. Neither is a re-litigation of a
previously-resolved point.

### Change Requests

**1. An eighth capability names the renamed trait and has no delta planned:
`openspec/specs/assistant-conversation-loop/spec.md:167`.**

design.md:23 asserts the seven enumerated capabilities "are exactly the set whose requirements name
`Connector[Config]`/`SqlConnector`/`RestApiConnector`/`/api/connectors`/`list_connectors` by name
(verified by grep across all of `openspec/specs/`)". That claim is false. Reproduced twice:
```
grep -rlE '\bSqlConnector\b|\bRestApiConnector\b|Connector\[|\bConnector\.testConnection\b|/api/connectors\b|\blist_connectors\b' openspec/specs/
-> assistant-conversation-loop, connection-test-endpoint, connector-registry, connector-spi,
   fetch-error-envelope, pipeline-run-execution, rest-api-connector, schema-inference-facade   (8, not 7)
```
`assistant-conversation-loop/spec.md:167` is inside a **requirement body** (Requirement: "An inline
REST/SQL source must be connection-tested before its proposal finalizes"):
```
`SourceService.testRest`/`testSql` (backed by `Connector.testConnection`/`ConnectionTest.run`) for
```
This is stale-after-rename drift in a requirement — exactly what AC 4 forbids and exactly the
HEL-804 pattern this change exists to avoid repeating. It is **not** excusable as out-of-pattern:
the `Connector.testConnection` form is *already treated as in-scope by this very change* —
`specs/connection-test-endpoint/spec.md` renames it to `ConnectorDriver.testConnection` at lines 9
and 35. Renaming that string in one capability while leaving it stale in another is incoherent.

Required: add an 8th name-only MODIFIED delta at
`specs/assistant-conversation-loop/spec.md` covering that requirement, and update the enumerated
capability set (7 -> 8) in proposal.md (Modified Capabilities + Impact), design.md Non-Goals, and
tasks.md 4.1. Then re-run the archive rehearsal — the 8th delta must also pass it. (Note the design's
grep pattern was too narrow: it omitted the `Connector.testConnection` form. Widen the recorded
pattern so the re-derivation during Execution can't miss it again.)

**2. Task 5.3's zero-match assertion is still unachievable — decision 5a and task 5.3 contradict
each other.**

Task 5.3 requires "zero remaining matches" for `Connector\[`, `\bSqlConnector\b`,
`\bRestApiConnector\b` across `openspec/specs`, excluding only (a) `openspec/changes/archive/**` and
(b) the two migration-note sentences. But decision 5a *deliberately* leaves scenario titles carrying
the old names, and those titles land in `openspec/specs/` at archive time. Confirmed post-rehearsal —
8 scenario titles retain old names by design:
```
connector-spi:76  #### Scenario: SqlConnector is reachable as a Connector
connector-spi:81  #### Scenario: RestApiConnector is reachable as a Connector
connector-spi:86  #### Scenario: Existing SqlConnector/RestApiConnector behavior unchanged
connector-spi:99  #### Scenario: SqlConnector exposes metadata
connector-spi:104 #### Scenario: RestApiConnector exposes metadata
fetch-error-envelope:18 #### Scenario: Helper compiles against any Connector[Config] implementation
schema-inference-facade:24 #### Scenario: SqlConnector routes through the facade unchanged
schema-inference-facade:29 #### Scenario: RestApiConnector routes through the facade unchanged
```
Round 3 fixed the archive-exclusion half of round 2's CR4 but introduced decision 5a in the same
round without propagating it into 5.3's exclusion list. As written, 5.3 can never be marked done —
the same failure mode round 2 refuted on.

Required: add a third explicit exclusion to task 5.3 for `#### Scenario:` **title lines** (per
decision 5a, scenario titles are intentionally never renamed), and state the expected non-zero count
so the check is falsifiable rather than aspirational.

**3. Three `## Purpose` paragraphs naming the old trait are left stale — task 4.2 covers only two of
them.**

Task 4.2 directly edits the `## Purpose` of `connector-spi` and `connector-registry` only. Confirmed
against the post-rehearsal canonical specs, three further Purpose paragraphs still carry old names
after the full plan executes, and no task covers them:
```
schema-inference-facade/spec.md:4   ...every `Connector[Config]` implementation
fetch-error-envelope/spec.md:4      ...keyed off `Connector[Config].inferSchema`...
connection-test-endpoint/spec.md:5  ...(backed by the `Connector.testConnection` SPI)...
```
Design decision 6 correctly establishes that a MODIFIED delta cannot reach `## Purpose` text (I
verified this — `connector-spi`'s Purpose is untouched by the rehearsal archive), but it applied
that reasoning to only two of the five capabilities whose Purpose actually needs it. Same AC-4 drift
as CR1.

Required: extend task 4.2's file list to include `schema-inference-facade/spec.md`,
`fetch-error-envelope/spec.md`, and `connection-test-endpoint/spec.md` (and
`assistant-conversation-loop/spec.md` if CR1's audit finds its Purpose affected — it does not
currently), and extend 4.2's verification grep to cover all of them.

### Non-blocking notes

- Task 4.2 is listed before 4.3 but its body instructs "After the real archive (task 4.3)". Intent is
  unambiguous, but renumbering so execution order matches list order would remove a foot-gun.
- `scripts/concertino/next-report-number.sh` does not exist in this worktree's `scripts/concertino/`
  (which has only assert-phase/cleanup/setup-worktree/start-servers); I used the main checkout's
  copy. Not blocking this gate, but the worktree's script set looks stale relative to main.
