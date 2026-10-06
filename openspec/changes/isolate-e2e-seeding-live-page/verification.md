# HEL-1300 verification

All runs: `DEV_PORT=6732 BACKEND_PORT=9639 nice -n 19 npx playwright test ... --workers 2`, headless, one invocation at a time,
against this worktree's own servers. Servers started with `scripts/concertino/start-servers.sh` and left running:
**frontend (node) PID 564949 on 6732, backend (java) PID 564372 on 9639**.

`FirstRunRoutesSpec` timeouts / `Java heap space` seen: **none** (grep over the three run logs: 0 matches each).

## Runs

| Run | Command (specs) | Result |
|---|---|---|
| probe1 (unmodified specs, exposure) | 24 files incl. hel519-recent and hel910 read-only, `--trace on --repeat-each 3` | 375 passed (16.4m) |
| post1 (modified, isolation + repeat) | 23 touched runnable files, `--trace on --repeat-each 10` | 1099 passed, 51 failed: 50 = hel773 (my first edit put the isolate inside `registerAndLogin`, so 5 tests that `page.evaluate(localStorage)` before their first goto ran it on `about:blank`: SecurityError, 50/50), 1 = hel1065 timeout |
| post2 (re-edit and re-run) | hel773 + hel1065, `--trace on --repeat-each 10` | 160 passed (5.6m) |

Root cause of the post1 hel773 failures (probe-confirmed from the error message and the C3 hazard): `page.evaluate` on
`about:blank` throws `SecurityError: Failed to read the 'localStorage' property`. Fix: matrix tests isolate after the theme step;
`iconsize` (cycle 2, evaluation CR1): isolate, seed, `page.goto("/")`, then the existing theme loop.

The one hel1065 timeout (`issue 1 ... (dark)`, repeat8) hung in `page.goto("/login")` for the full 30 s, before any code this
change touches (trace: the `goto` action never completed; no isolate call ran). It is a dev-server stall under load, not caused by
the change. hel1065 then passed 50/50 in post2 and 49/50 in post1.

## Per-file counts (post1; hel773 and hel1065 from post2), passes / runs

auth-cookie-migration 80/80; hel1023 50/50; hel1028 130/130; hel1065 50/50 (post2; post1 49/50, the stall above); hel1079 50/50;
hel1080 40/40; hel1085 10/10; hel1087 40/40; hel1088 10/10; hel1090 50/50; hel1094 10/10; hel1095 40/40; hel1096 20/20;
hel1169 40/40; hel1189 20/20; hel1230 10/10; hel503 60/60; hel516-palette-quick-create 100/100; hel519-screenshots 20/20;
hel572 30/30; hel588 40/40; hel773 110/110 (post2); hel813-floor 140/140.
Every failure was triaged (above); none was retried silently.

## Isolation (3.1)

0 page-frame `/api/` requests inside any fixed test's post-isolation seed window across 1,000+ fixed-test windows (details and
the method in inventory.md, 3.1). Frame-attribution spot check (page-frame vs `APIRequestContext` listing) in inventory.md 1.4.

## Not run

- Quarantined or opt-in specs (hel666, hel716, hel909, hel968, hel520-regression Case B, hel813-regression Case B): fixed, **verified by code reading only** (C9).
- hel519-recent-navigation, hel910: not edited (C8). The two guards: not edited (C1, owner ruling).

## Sharding (HEL-1288 / #774)

No `beforeAll`/`afterAll`, no cross-test state, no `describe.configure` change; `isolateLivePage` is per-test and per-page.
`playwright.config.ts` and `.github/workflows/ci.yml` untouched. CI on this branch uses main's current config.

## Static gates

See the commit: lint, format check, typecheck and the pre-commit hooks (below).

## Residue

Every user any run created is in `residue-users.txt` (1725 rows: email and id, looked up by exact email). Nothing was deleted.
Specs delete their own dashboards/sources/pipelines by exact id in `finally`; tests that do not (for example hel1065, hel503,
hel519-screenshots, hel773) leave rows owned by those users. HEL-1301 owns cleanup. The first one-off probe (a single hel1085
run) is included (`hel1085-keyboard-1791263911303-760@example.test`).

## Cycle 2 (evaluation CR1, hel773 `iconsize`)

`--trace on --repeat-each 10 --workers 2` on that test: 10/10 passed (30s); isolation trace: 10 isolated, 0 leaks. 10 new users (in `residue-users.txt`, appended, ids by exact email). No FirstRunRoutesSpec timeout / Java heap space. Servers still PIDs 564949 / 564372.
