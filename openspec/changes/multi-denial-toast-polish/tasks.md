## Standing Constraints

- Lane DB `helio_hel1840`: `DATABASE_URL=jdbc:postgresql://localhost:5432/helio_hel1840` and `DB_USER=$USER` exported in the same command as every `start-servers.sh`, Playwright run, e2e cleanup, and DB-touching jest/hook run; `ANTHROPIC_API_KEY` exported empty for any backend.
- Servers only via `scripts/concertino/start-servers.sh` / `stop-servers.sh` (ports 7272 / 10179); no pkill/pgrep/killall; never read or print any `.env` file.
- jest 3 workers, Playwright 2 workers total, `nice -n 19`; `cd frontend && nice -n 19 npm ci` before jest/e2e.
- Red first with mutations; red output committed as `.txt` before implementation.
- Scratch in `/home/matt/Development/helio/.concertino/scratch/HEL-1840/`; screenshots and evidence in `/home/matt/Development/helio/.concertino/runs/HEL-1840/evidence/`.

## 1. Red first

- [x] 1.1 Unit tests for name/id order and message byte-identity (D1, D4); run, record red, commit as `.txt` evidence before implementation.
- [x] 1.2 `ToastRowList` overflow-cue unit tests (D3); record red.
- [x] 1.3 e2e: name-order Tab order, 390px alignment criterion in both themes, overflow cue present/absent; record red on the unmodified code; take "before" screenshots at 390px in light and dark.

## 2. Implementation

- [x] 2.1 Sort `items` by name (Intl.Collator "en", numeric) then id; build `message` in the same order; update doc comment.
- [x] 2.2 Add `toast--rows` modifier in `Toast.tsx`; offset `.toast--rows .toast__icon` per D2 (tokens only), desktop and phone; check precedence (expander extent, no paint outside border, 1px criterion).
- [x] 2.3 Add `toast__list-frame` wrapper driven by the shared `useScrollEdges` hook (no hand-rolled observer), fade CSS per D3.
- [x] 2.4 Mutation checks for each new test (sort reverted, cue condition removed, alignment fix removed) — record they go red.

## 3. Verification

- [x] 3.1 lint, typecheck, format, jest (3 workers), full `e2e/hel1172-multi-denial-toast.spec.ts` green.
- [x] 3.2 "After" screenshots at 390px in light and dark (plus an overflowing list showing the fade) into `.concertino/runs/HEL-1840/evidence/`; compare against the running app in both themes.
