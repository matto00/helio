## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold spawn. Every conclusion below is derived from the running app, the actual diff, or a command I ran
myself. The executor's and evaluator's reports were read as claims to verify, not as facts.

### What I verified (with evidence)

#### 0. Ground truth of the diff

`git diff --name-only 36a9c1cc..HEAD -- frontend/ DESIGN.md` returns exactly six files:
`DESIGN.md`, `auth.css`, `PipelineDetailPage.css`, `Spinner.css`, `motionTokenGuard.css.test.ts`, `theme.css`.

I independently confirmed **UNTOUCHED** (per-file `git diff` vs base): `PanelGrid.css`, `toast.css`,
`toast.css.test.ts`, `MobileNavSheet.css`, `RefinementChatDrawer.css`, `Modal.css`, `Popover.css`, and
`tokenAuditSweep.css.test.ts`. No test was changed in shape to pass — the two pre-existing guards that
could have been edited into compliance are byte-identical to base and green.

#### 1. The guard — all mutation arms re-run by me, not read from a transcript

Baseline: `npx jest src/theme/motionTokenGuard.css.test.ts` → 5 passed. Then, each mutation applied and
reverted (`git status --porcelain src/` clean after every arm):

| arm | mutation | result |
| -- | -- | -- |
| 1 — new ad-hoc duration | `DataGrid.css:106` → `transition: background 0.33s ease;` | **RED** — `shared/ui/DataGrid.css:106 literal="0.33s"`. 1 failed / 4 passed |
| 2a — removed exception (loop) | deleted `pipeline-run-pulse` from `LOOP_ALLOWLIST` | **RED** — `PipelineDetailPage.css:979 literal="1.2s"`. 1 failed / 4 passed |
| 2b — removed exception (c) | repointed `PANEL_GRID_EXCEPTION` at a nonexistent file, emptied `literals` | **RED** — 3 hits + pin-count test. 2 failed / 3 passed |
| 3a — STALE keyframe entry | added `ghost-keyframe-that-does-not-exist 3.3s` to the allowlist | **RED** — staleness test, `Expected: true / Received: false` |
| 3b — **STALE shorthand** (load-bearing) | simulated HEL-1032: replaced all three `180ms ease` in `PanelGrid.css` with `var(--app-transition)` | **RED** — `Expected: 3 / Received: 0` on BOTH the pin-count and staleness tests |

I also ran a partial version of 3b (2 of 3 literals removed) and it went RED at `Received: 1` — the
exception is pinned to an exact count, not merely to "at least one match". **Exception (c) genuinely
expires** when HEL-1032 lands; it is not a permanent hole.

**Multi-line parsing confirmed, not assumed.** `PanelGrid.css:9-13` wraps its declaration across four
lines. The guard's own failure output reconstructed it as a single declaration:
`transition: transform 180ms ease, width 180ms ease, height 180ms ease;` — three literals from one
multi-line declaration. A line-oriented grep could not have produced that.

**The guard is actually in the default run**, not just runnable by path: `npx jest --listTests` (280
entries) contains `motionTokenGuard.css.test.ts`. It will protect in CI.

#### 2. Literal inventory audited against ground truth, not against whatever is green

`files-modified.md`'s task-4.3a table matches the tree. Independently:
- Only `cubic-bezier` literal anywhere in `frontend/src` is `theme.css:65`, the token definition itself.
- Remaining live literals: `PanelGrid.css` 180ms ×3 (exception c), `StreamingText.css:16` 1s,
  `PipelineDetailPage.css:979` 1.2s (exception b), `theme.css` 0.01ms ×2 (exception a, reduced-motion).

**D1's rule applied honestly.** I counted consumers per keyframe: `streaming-text-blink` → 1 consumer,
`pipeline-run-pulse` → 1 consumer (both legitimately "single-use, may keep a literal"), while the spin
role has **2** consumers (`ui-spinner-spin`, `pipeline-run-spin`) → tokenized. The allowlist is not
licensing a rule violation.

#### 3. Evidence-integrity incident — cleanly resolved

`md5sum` over `.concertino/runs/HEL-441/evidence/*.png`: **12 files, 12 distinct hashes**, zero
duplicates. No `before-*`/`after-*` PNG remains. A grep across the change dir finds the deleted PNGs
referenced only in the two places that *document the incident* (`evaluation-1.md:224-227` and
`files-modified.md`'s withdrawal). **No verdict anywhere rests on them.**

One claim I chased because it looked like fabrication and was not: HEL-1034 cites "957ms and 941ms
across 56 canvas repaints" while `files-modified.md` says the chart was not re-measured this session.
Both are true — the measurement was taken by the design-gate skeptic (`skeptic-design-3.md:52-55`) and
is carried forward. Grounded, not invented.

#### 4. Running-app judgment — my own browser, both themes

The shared Playwright MCP session was being hijacked mid-call by a concurrent agent (my page was
redirected to port **5883**, another worktree's dev server, twice). Rather than report contaminated
readings, I drove an **isolated Chromium context** from this worktree's own `playwright`. All findings
below come from that isolated driver against `localhost:5873`.

**D3 — auth card 0.45s → 0.28s. CONFIRMED, and I reproduce the evaluator's numbers exactly.**
Computed style in both themes: `auth-card-in`, `0.28s`, `cubic-bezier(0.3, 0.9, 0.4, 1)`, `both`.
Paused-animation sampling of the real entrance:

| t (ms) | 0 | 40 | 80 | 120 | 160 | 200 | 240 | 280 |
| -- | -- | -- | -- | -- | -- | -- | -- | -- |
| opacity | 0 | .40 | .70 | **.874** | .95 | .985 | .997 | 1 |
| translateY (px) | 10 | 5.97 | 2.95 | **1.26** | 0.48 | 0.15 | 0.03 | 0 |

Identical in light and dark. The curve is heavily front-loaded — 70% opaque and within 3px of rest by
80ms; the final 120ms is an imperceptible settle. The card therefore *perceptually arrives* at roughly
the same moment as before; shortening 0.45s→0.28s trims the tail rather than playing the gesture 38%
faster. **It does not read as abrupt.** This is judgment, not just a number: the visible event is the
first ~150ms, and that part is unchanged in character.

**D2 — pipeline spinner 0.8s → 0.7s. CONFIRMED LIVE, closing the executor's admitted gap.**
The executor could not reach the transient running state and honestly said so. I resolved it by
applying `pipeline-detail-page__run-status--running` under the real cascade on a loaded pipeline-detail
page and reading the `::before` pseudo-element:

- light: `pipeline-run-spin`, **0.7s**, linear, infinite
- dark: `pipeline-run-spin`, **0.7s**, linear, infinite
- `Spinner` primitive (`.ui-spinner`): `ui-spinner-spin`, **0.7s**, linear, infinite — both themes

Two authorities that previously disagreed (0.7 vs 0.8) now resolve to one value at runtime, not just in
source. A 12.5% speed-up onto the app's own shipped primitive speed is the right direction; the pipeline
spinner is a 0.6em glyph where the change is imperceptible in isolation and correct in aggregate.

**AC3 — reduced motion. VERIFIED, not assumed.** Under `reducedMotion: 'reduce'`:
`.auth-card` → `animationDuration: 1e-05s`, `transitionDuration: 1e-05s`; `.ui-spinner` →
`1e-05s` **and `animationIterationCount: 1`** (the loop is genuinely stopped, not merely sped up).
Every touched surface is suppressed. I did not extend the global rule (HEL-538 owns it).

**AC2 — one entrance per overlay surface.** Traced each surface named in the AC:
`Modal.css:19` one entrance (`--transition-slow`); `Popover.css:39` one entrance (`--app-transition`);
`toast.css:53` one entrance (`--transition-slow`) plus a separate *exit*; auth card one entrance, now
tokenized. `MobileNavSheet`/`RefinementChatDrawer` are backdrop+panel pairs, ruled ONE entrance by D7.
No surface plays two entrances. I independently confirmed `.ui-modal::backdrop` (`Modal.css:58-61`) has
**no** animation at all — HEL-1035's finding is real, and correctly *not* absorbed, since adding an
entrance where none exists is new choreography, explicitly out of scope in `ticket.md`.

**Light/dark parity + regression check.** Auth card screenshotted in both themes: consistent surface,
border, shadow and accent treatment; no token gaps. Dashboard verified in both themes after a real login
(`data-theme` and body background flip correctly: `rgb(244,242,237)` / `rgb(18,17,16)`).
**Zero console errors** in either theme (excluding expected pre-auth 401s on the logged-out login page).

#### 5. Gates — re-run by me from `frontend/`, not root

- `npx jest` → **280 suites / 2844 tests, all passing**, 1 snapshot. Matches the claim exactly.
- `npm run lint` (`eslint src --max-warnings=0`) → clean, zero output.
- `npm run typecheck` (`tsc --noEmit`) → clean.
- `npm run format:check` → all files match Prettier.
- `scripts/concertino/assert-phase.sh servers` → `PASS servers`.

#### 6. Spinoffs — each read in full, verified to cover its deferral

| ticket | covers | absorbed here? |
| -- | -- | -- |
| HEL-1032 | PanelGrid 180ms + vendor 100/200ms spread; names HEL-1023 coordination | No — `PanelGrid.css` byte-identical to base |
| HEL-1034 | echarts 1000ms default + `notMerge` replay | No — no `animation*` echarts option anywhere in `frontend/src` |
| HEL-1035 | `.ui-modal::backdrop` absent entrance | No — no `::backdrop` animation added |

All three are filed, in the correct project, and each states *why* HEL-441 did not fix it in terms of
this ticket's own out-of-scope clause. None is a parking-lot deferral.

---

---

### Port & build provenance for every visual observation (added after a batch-wide warning)

A batch-wide warning arrived mid-review: Playwright can silently land on a neighbouring lane's dev
server, and lane A had wrongly landed on **5873 — this lane's port**. I had already independently
detected the mirror-image of that collision (my shared-MCP page was redirected to **5883**), discarded
every MCP-derived reading, and switched to an isolated driver. But "I asserted the port" is weaker than
"I proved what is served there," so I closed it by provenance rather than by reasoning that it was
probably fine.

**Process provenance** (`ss -lptn` + `/proc/<pid>/cwd`):

| port | pid | listener cwd |
| -- | -- | -- |
| **5873** (frontend) | 3201208 (`node .../vite`) | `.../worktrees/feature/motion-transition-token-system/HEL-441/frontend` ✅ **this worktree** |
| **8780** (backend) | 3200849 (`java`) | `.../worktrees/feature/motion-transition-token-system/HEL-441/backend` ✅ **this worktree** |
| 5883 (neighbour) | 3277051 | `.../worktrees/feature/in-panel-column-filtering/HEL-451/frontend` — the lane that hijacked my MCP session |

**Content self-authentication** — the decisive check, because this branch contains two strings that do
not exist on `main`. `curl` against **5873** returns, in the served modules:

- `/src/theme/theme.css` → `--app-spin-duration: 0.7s;` preceded by its `HEL-441 D1/D2` comment.
  This token **does not exist on `main`**, so no neighbour lane could serve it.
- `/src/features/auth/ui/auth.css` → `animation: auth-card-in var(--transition-slow) both;` preceded by
  its `HEL-441 D3` comment. `main` carries the `0.45s cubic-bezier(...)` literal here instead.

Worktree `HEAD` = `381f5f5fa19a0a1c151309f4261422f296df0688`, the commit under review, with no source
modifications pending (`git status --porcelain` shows only this report and the change-dir docs).

**Conclusion: no observation needs retaking.** Every measurement in section 4 above — the D3 opacity/
translateY table, both spinners at 0.7s, the reduced-motion collapse, the light/dark parity shots and
the zero-console-error result — was taken by the isolated driver against `http://localhost:5873`, whose
serving process is this worktree and whose served bytes are provably this commit's. Probe 1 asserted
`location.href` in-page and returned `http://localhost:5873/login`; probe 4 asserted `page.url()`
likewise. The only observations ever taken against the wrong app were the two aborted MCP calls, which
produced **no recorded finding** — I detected the redirect from the returned `location.href` and the
page title before drawing any conclusion from them.

### The question I was asked to press hardest: is this vacuous?

**No — but the honest framing is worth stating plainly, and it is not the framing the ticket title
implies.**

The ticket's premise ("components declare ad-hoc durations, motion feels inconsistent") was **already
largely false when the ticket was picked up** — the Planning-phase audit measured 51/136 transitions
already tokenized and only three files carrying any literal, two of them legitimate reduced-motion
overrides. That is a premise-validation finding, *not* a narrowing by the review gates. The three design
REFUTEs did not shrink real work; they removed a change (D4) that measurement showed would have *widened*
the layout-motion spread while appearing to tokenize it, and they refused to invent an exit token with
one consumer.

What actually ships is therefore small but not empty, and the durable value is not the token:

1. **The guard is the deliverable.** Task 1.3 established that before this diff *nothing* caught a new
   ad-hoc duration. The already-good state was unprotected; it is now non-regressable, with an exception
   set that is pinned, counted, and provably expiring. I broke it five ways and it went red every time.
2. **DESIGN.md's governing rule is the second deliverable.** "Single-use loop may keep a literal; a loop
   role with 2+ surfaces needs a token" is what makes the remaining literals *principled* rather than
   *leftover*. Without it, AC1's "where a motion token applies" is unfalsifiable.
3. **Two genuine cohesion fixes** — the last unconverted spinner copy, and the one entrance still on a
   literal curve that duplicated an existing token byte-for-byte.

Against `ticket.md`'s ACs specifically: AC1 is met (no literal remains where a token applies, under a
now-stated and machine-enforced rule); AC2 is met and I verified it surface by surface; AC3 is verified
by measurement in both directions; AC4 is met (new token documented, all gates green, zero new warnings).

The owner's mandate was "don't create more UI/UX gaps that would need to be filled." This diff creates
none — it touches three declarations, all measured, and it *documents three gaps that already existed*
and hands each to a real ticket. That is the mandate being honoured rather than evaded.

### Verdict: CONFIRM

Ships. No change requests.

### Non-blocking notes

1. **The guard is shorthand-only.** Its regex matches `transition:`/`animation:` but not the longhands
   `animation-duration` / `transition-duration` / `*-delay`. I checked: today the only longhand
   occurrences are inside the reduced-motion block (`theme.css:312,314`) and in comments, so there is no
   live hole — but a future `animation-duration: 0.5s` would slip through. Worth widening whenever the
   guard is next touched (natural fit for HEL-1032, which must edit the exception anyway).
2. **`tokenAuditSweep.css.test.ts`'s line-number-pinned baselines are fragile.** They forced the D2
   comment in `PipelineDetailPage.css:996` to be collapsed onto the declaration line for net-zero line
   count. The executor handled it correctly (rather than editing the unrelated baseline), but the
   pinning mechanism will keep imposing this on unrelated tickets.
3. **The retained evidence set is light-heavy** — of `eval-01..11`, only 03/04/05 are dark. Not a defect
   in the work (I verified both themes myself this round), just a note that the archived artifact
   under-represents dark.
4. **DESIGN.md's addition is one dense ~20-line bullet** carrying four distinct normative rules. Every
   rule a HEL-442/444 reviewer needs *is* stated explicitly, with `**[judgment]**` tags, ticket refs, and
   named reference implementations — D7's "do not 'fix' that by removing the backdrop fade" is
   unambiguous, which was the specific risk. Purely editorial: it would read better as sub-bullets, and
   it is consistent with the density of its sibling entries as-is.
5. **Environmental, not a defect in this work:** the shared Playwright MCP browser was hijacked by a
   concurrent worktree (port 5883) mid-session. This is the known parallel-run hazard. Any reviewer
   doing visual work in a parallel fleet should drive an isolated context rather than trust the shared
   session — a contaminated reading here would have looked exactly like a real failure.
