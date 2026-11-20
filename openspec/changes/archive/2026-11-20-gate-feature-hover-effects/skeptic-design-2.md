## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 894a72c565e06afc90bde4c4fd0f56cf86b31164. The change dir is untracked, so I read the artifacts from the worktree.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/gate-feature-hover-effects/HEL-1735`.
- **Inventory reproduces.** I re-ran `.concertino/scratch/HEL-1735/enum.mjs` against the worktree. Its output is
  byte-identical to `inventory-main.txt` (`diff -q` was silent) and ends with `files=63 rules=180 selectors=205`. That
  matches design.md's Context section, including the corrected "12 in scope" mixed count.
- **No stylesheets outside the walk.** `git ls-files '*.css' '*.scss'` outside `frontend/src/` returns only e2e
  web-font fixtures and one archived evidence file. Jest `testMatch` is `<rootDir>/src/**/*.test.ts`, and
  `src/pwaConfig.test.ts` already sits at the root. So `frontend/src/featureHoverGating.css.test.ts` will run.
- **CR1 (D5(a) normalization): resolved.** D5(a) now states the merge rule and gives the cascade-equivalence argument.
  It adds mutations (ii) order change and (iii) a rule inserted between split halves. I checked the asymmetry risk:
  before-entries are taken one per source rule, while adjacent after-entries are merged. For that to cause a false
  failure, two adjacent before-rules would need the same chain (minus the hover media) and byte-equal declarations,
  with at least one of them a hover rule. My scratch scan of every non-shared stylesheet found exactly six such pairs.
  - `InsightPanel.css` is not in the inventory, so it is not touched.
  - `OutputSchemaDisclosure.css` and the `PipelineSpine*.css` files are on the pipeline guard's list, so they are not
    touched.
  - None of the six is in a file this change edits.

  A mixed rule whose neighbour has identical declarations would have shown up in the same scan, and none did. The
  normalization therefore works on the real tree.
- **CR2 (HEL-1790 settle helpers): resolved.** This is D5(b) and C5. `e2e/support/hel1790Rest.ts` exports
  `trackPointer` (line 14), `settleToRest` (83) and `settleToHover` (84).
- **CR3 (touch contexts): resolved.** D6 names context P (390x844) and context T (1024x768), and gives each candidate
  a context and a stylesheet:selector. I checked each candidate against the inventory. Each one's own rule sets a
  visible paint:
  - `HomePage.css` `a.home-card:hover` / `.home-upnext__row:hover`
  - `SourceListTable.css` `.source-list-table__row:hover`
  - `PreferencesEditor.css` `.preferences-editor__add-btn:hover`
  - `App.css` `.app-command-bar__logo:hover` (background). `CommandBar` is rendered unconditionally in `App.tsx`; the
    logo is at `CommandBar.tsx:141`.
  - `DashboardTabBar.css` `.dashboard-tab__button:hover`
  - `DashboardList.css` `.dashboard-list__button:hover`

  The escalation threshold is recomputed: four of six, with at least two in context T.
- **CR4 (path base): resolved.** D4 picks option (a), re-relativizing the paths so the allowlist stays byte-identical.
  Option (a) is consistent with the guard's code: the pipeline guard reads `path.join(__dirname, file)`
  (`pipelineHoverGating.css.test.ts:53-56`) and matches `a.file === file` (line 73). D4 also drops the tautological
  "exactly one guard" check as evidence and keeps the existence check.
- **CR5 (two render sites): resolved.** The D3 allowlist reason names both `DashboardList` and `SidebarItemList`. Task
  1.5 and task 2.4 probe both on context T, and C4 escalates per render site. The reveal rule at
  `DashboardList.css:273-284` matches D3's description: it is mixed with `:focus-within` and `:has(...)`, and its
  declarations undo the visually-hidden recipe.
- **Red-first ordering.** Tasks are now ordered 1.3 (guard red, committed), then 1.4 (e2e red and desktop fixture),
  then 1.5 (reveal probe), then 1.6 (stylesheet edits). The order is visible without reading a parenthetical.
- **DESIGN.md.** Line 520 still says "Other feature stylesheets are not yet covered", which is the text D8 says it
  will drop.
- **AC coverage.**
  - "Gated or named as a reveal in a guard allowlist": D1, D2, D3 and tasks 1.6 and 1.1.
  - "Guard covers them": D4, the walk, the new-file mutation and task 2.1.
  - "Desktop hover unchanged": D5(a), D5(b) and tasks 2.2 and 2.3.

  The spec scenarios match the design. I found no placeholders or TBDs, and no contract or schema delta is needed
  because the change is CSS plus a test.

### Verdict: CONFIRM

### Non-blocking notes

- D5(a) applies the adjacent-merge only to the after side. On today's tree that is safe: no adjacent before-rules with
  identical declarations exist in an edited file. If the executor does hit such a pair, applying the same
  maximal-adjacent merge to the before side is the cascade-equivalent fix, and it keeps mutations (i)-(iii) meaningful.
  It is not a weakening. If that happens, record it in evidence.
- D6 candidate 4 is "P or T". The command bar mounts in both contexts, so either works. Name the one chosen in the
  spec.
- `App.css:203-209` has the border-color reset list, with hover members interleaved. When D2 splits it, the gated
  `.app-command-bar … :hover` members must stay immediately after the ungated base members. D5(a)'s adjacency check
  will catch it if they do not.
