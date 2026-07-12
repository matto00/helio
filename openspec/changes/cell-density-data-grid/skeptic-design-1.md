## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **`density` prop is already fully implemented on `DataGrid`** — read
   `frontend/src/shared/ui/DataGrid.tsx` directly. Confirmed: `DataGridDensity = "condensed" |
   "normal" | "spacious"`, `DEFAULT_DENSITY` map (`preview` → `condensed`, `full` → `normal`),
   `resolvedDensity = density ?? DEFAULT_DENSITY[variant]`, applied as
   `ui-data-grid--${resolvedDensity}` class. Matches design.md's claim exactly.

2. **CSS already implements all three density modes with design tokens, not hardcoded pixels** —
   read `DataGrid.css` lines 52-70. `.ui-data-grid--condensed/normal/spacious` each set `padding`
   via `var(--space-1/2/3/4)` combinations and `font-size` via `var(--text-xs/sm/base)`. No literal
   px values in the density rules. Cross-checked these token names against `DESIGN.md`'s actual
   spacing scale (`--space-1` 4px … `--space-10` 64px) and type scale (`--text-xs` 12px, `--text-sm`
   14px, `--text-base` 16px) — both `--space-*` and `--text-*` names used are real, in-scale tokens,
   not invented ad hoc. Design.md's token-usage claim holds up against ground truth.

3. **`openspec/specs/data-grid/spec.md` already documents variant-based density defaults** — read
   the file. "DataGrid supports full and preview variants" requirement (lines 40-56) already
   contains the condensed/normal-default and explicit-override scenarios. Confirms the base spec
   already covers the primitive-level contract, so the new delta's consumer-contract requirement is
   additive, not duplicative (it operates at a different level: named real consumers, not the
   primitive API).

4. **`DataGrid.test.tsx` already has a density describe block** — read lines 44-71. Covers: full
   variant default (normal), preview variant default (condensed), explicit override
   (preview+spacious). Confirms design.md's claim. Also confirms tasks.md's framing that this is
   "review/close gaps" work, not "write from scratch" — e.g. there's no test for an explicit
   override on the `full` variant or for `condensed` as an explicit (non-default) value, so task
   4.1's "add missing assertions" has real, identifiable work left.

5. **All six named consumers exist and match the described call sites, exhaustively** —
   `grep -rln "<DataGrid" frontend/src --include="*.tsx"` returns exactly the primitive itself, its
   test file, and the six named consumers — no untracked 7th consumer. Read each call site:
   - `TypeDetailPanel.tsx:195` — `variant="preview"`, no `density` prop.
   - `SourceDetailPanel.tsx:129` — `variant="preview"`, no `density` prop.
   - `PipelinePreviewModal.tsx:41` — `variant="preview"`, no `density` prop.
   - `StepCard.tsx:236` — `variant="preview"`, no `density` prop.
   - `SqlTab.tsx:217` — `variant="preview"`, no `density` prop.
   - `TableRenderer.tsx:26,59` (both pagination-rows and raw-rows branches) — `variant="full"`, no
     `density` prop.
   All six inherit the variant default exactly as design.md/proposal.md claim. Nothing diverges.

6. **Descoping to HEL-255 is justified, not just asserted** — fetched HEL-255 via Linear
   (`mcp__linear__get_issue`). Its own ticket description (created 2026-05-12, independent of this
   planning cycle) already lists "Cell density dropdown (condensed / normal / spacious)" as a config
   surface item and its DoD requires "default density = normal" migration behavior for existing
   Table panels. This independently corroborates that HEL-255 structurally already owns the exact
   deliverable being deferred — the deferral isn't inventing new scope for HEL-255, it's recognizing
   scope HEL-255 already had. I could not verify via available tooling whether a Linear *comment*
   was actually posted to HEL-255 recording this decision (no comment-read tool available) — this is
   a minor, non-blocking gap in my verification, not a soundness problem, since the ticket's own
   pre-existing scope is sufficient corroboration independent of any comment.

7. **Spec delta is well-formed and testable** — read
   `openspec/changes/cell-density-data-grid/specs/data-grid/spec.md`. Two ADDED requirements, both
   with SHALL language and concrete WHEN/THEN scenarios naming real components and real CSS classes
   (`ui-data-grid--condensed`, etc.) — directly verifiable by an automated test. Non-redundant with
   the base spec (verified in #3 above).

8. **tasks.md is complete for the descoped scope** — covers: primitive re-verification (1.1-1.2),
   all six consumers individually (2.1-2.6) plus a catch-all fix/document step (2.7), documentation
   (3.1), and test-matrix closure + full-suite verification (4.1-4.3). No DoD item from the (now
   descoped) Linear ticket text is silently unaddressed — the Table-config dropdown is explicitly
   carved out in Non-goals, not just dropped.

9. **No contradictions** — ticket.md, proposal.md, design.md, and tasks.md agree consistently on
   the descoping story; git status confirms this is genuinely pre-implementation (only the
   `openspec/changes/cell-density-data-grid/` planning dir is untracked, no code changes yet).

10. **Minor pre-existing gap, non-blocking**: `DESIGN.md` section 6 ("Shared components — reuse,
    don't reinvent") does not currently list `DataGrid` among the canonical primitives, even though
    it landed in HEL-251/HEL-254. Task 3.1 ("add a short 'Cell density' note to DESIGN.md, or expand
    the existing DataGrid section if present") handles the "if present" case but there IS no
    existing DataGrid section — worth having the executor fold `DataGrid` into section 6's list
    while they're there, not just add an orphaned density note. Not blocking; flagging as a
    non-blocking note below.

### Verdict: CONFIRM

The planning package is sound. Every factual claim in proposal.md/design.md about the current state
of `DataGrid` (primitive, CSS, spec, tests, six consumers) checks out against the actual code I read
myself. The descoping to HEL-255 is well-justified and independently corroborated by HEL-255's own
pre-existing ticket scope, not just asserted. The spec delta is well-formed, non-redundant, and
testable. tasks.md is complete enough to close out the (now correctly thin) scope, with genuine
remaining work identified in the test matrix and consumer verification rather than trivially
short-circuited "already done" claims.

### Non-blocking notes

- When executing task 3.1, also add `DataGrid` to `DESIGN.md` section 6's list of canonical shared
  primitives (it's currently entirely absent from that list despite existing since HEL-251) — fold
  the density note in there rather than creating a disconnected mention elsewhere in the doc.
- I could not independently verify the claimed Linear comment on HEL-255 (no comment-read tool
  available in this session); the executor/evaluator should not treat that specific claim as
  re-verified by this gate — though it is not load-bearing for design soundness given HEL-255's own
  independent scope.
