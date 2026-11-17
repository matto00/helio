## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD: ea991704703b1ea9d6edc12ae683ea77a820732e. The cycle-3 delta (1632c5564..ea9917047) contains only evidence text and the committed evaluation-1/2 reports. It changes no code and does not touch `.github/dependabot.yml`.

### Phase 1: Spec Review — PASS

The two evaluation-2 change requests are addressed. I checked each claim against the committed files and the raw scratch JSON.

**1. Mechanism wording**

`upstream-issue-draft.md:5`, `running-app-check.md:21` and `minimal-repro.md:17` now describe two mechanisms:
- **Bare grid:** a half-step lag, then a jump (52 px).
- **App:** a collision-blocked, stuck item, because of `x:0 w:3` next to an `x:3` neighbour under `noCompactor` + `preventCollision`. This gives about 397 px, and 410 px on the control row.

The "wide cells" claim is gone from all three files. The 349 px / 300 px figures match the raw data:
- `.concertino/scratch/HEL-1728/min-9b01a614-collide/min-result-inline=1&collide=1.json` (2.3.0) has drag 349, control 367 and resize 300, 0/3 on every row.

**2. 1468c0f coverage**

The table in `minimal-repro.md` matches the raw data:
- `min-6ec45c62-collide` (2.2.4): 3/3 on every row, 0 px.
- `min-9b01a614-collide` (2.3.0): 0/3 on every row.
- `min-1468c0fc-collide` (the fix): 3/3 on every row, 0 px.

The react-resizable 3.1.3 install caveat is still stated. The removal gate stays hel1573:275 20/20 on the real release.

**3. pos=1 caveat**

The claim is that pos=1 is not a valid pass/fail row because `createScaledStrategy(1.5)` shifts the item by about 133 px even on 2.2.4. The data confirms it:
- `min-2.2.4-var` (2.2.4): drag 131, control 138, resize 120, 0/5.
- `min-1468c0fc-var` (the fix): drag 137, control 143, resize 120.
- `min-2.3.0-var` (2.3.0): 349.

So on pos=1, 1468c0f is at parity with 2.2.4, as stated. The earlier 2.3.0 pos=1 rows in `minimal-repro.md:14` are left in place, and the new caveat paragraph qualifies them.

**4. Committed reports, persistence and scope**

- evaluation-1.md and evaluation-2.md are committed.
- The persisted copies of `minimal-repro.md`, `running-app-check.md` and `upstream-issue-draft.md` match the worktree (`diff -q` clean).
- The only file outside the change directory in the whole branch diff is `.github/dependabot.yml`.

All ACs are met:
- **AC1:** bisected to eb35b82c, with its parent clean.
- **AC2:** the pin and ignore rule, with a reason that links upstream #2303/#2304/1468c0f and a removal condition tied to a release.
- **AC3:** hel1573:275 20/20 on 2.2.4 (my cycle-1 run).

All CONSTRAINTS entries C1–C7 are honoured.

### Phase 2: Code Review — PASS

No `frontend/**` or `backend/**` file changed, so no project gate triggers. I re-ran:
- `check:openspec`: clean.
- `check:dependabot`: OK.

The install is pristine 2.2.4 after the 1468c0f overlay:
- `frontend/node_modules/react-grid-layout/dist` and its `package.json` are byte-identical to the 2.2.4 tarball.
- react-resizable is 3.1.3.
- The `.vite` deps are cleared, so the next dev start rebuilds from the pristine dist.

No code has changed since cycle 1 and the install is verified unchanged, so my cycle-1 run of hel1573:275 (`--repeat-each 20 --workers 2`, 20 passed) still stands.

From the earlier cycles, still true: the scratch specs under `openspec/` are excluded from jest, tsc, eslint, prettier and Playwright.

### Phase 3: UI Review — N/A

No trigger paths changed.

### Overall: PASS

### Non-blocking Suggestions

- **`minimal-repro.md:14`:** the original toggle paragraph still lists `inline=1&collide=1&pos=1` 0/3 as plain red. Consider adding "(see the pos=1 caveat below)" inline, so a reader who stops at line 14 is not misled.
- **`running-app-check.md:18`:** "(the item does not follow the pointer at all)" is now accurate for the app (stuck item). No change is needed.
