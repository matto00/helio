## Why

HEL-1289 proved that an e2e spec which logs in through the UI and then seeds through the API while the post-login `/`
page is still live races the app's own mount effects (auto-select, `fetchPanels`, `PanelGrid` effects such as the owner
layout repair, the recent-visit recorder). Whether the page observes the seed is timing-dependent, so a spec can flake, or
pass vacuously, for reasons unrelated to what it asserts. 34 e2e files carry their own `registerAndLogin`; only one
(hel1260) has been isolated.

## What Changes

- Audit every e2e spec with a UI login (34 files on main, plus `hel516-palette-quick-create`'s inline login) and record,
  per test, whether API seeding happens while `/` is live and whether the live page can read/act on that seed before
  the spec's own next document load. Committed as `inventory.md` in this change.
- Add a shared helper under `e2e/support/` (`isolateLivePage` / `loginThenIsolate`) that idles the page on
  `about:blank`, documented with the race and its reload hazard, so new specs get isolation by default.
- Fix each affected test: idle the page before seeding, or, where the spec's next load is a `page.reload()` / an
  in-page step that needs the app origin, an equivalent the inventory justifies. No assertion or timeout changes, no
  quarantine.
- Log each touched spec's throwaway user email so run residue is recorded by exact id (HEL-1301 owns cleanup).
- Record, with evidence, whether the race explains HEL-1298 (hel519:90, hel910:90) and HEL-1294 (hel958).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Test-only change; product behaviour is unchanged (`skip_specs: true`).

## Impact

- `e2e/*.spec.ts` (affected specs only, per `inventory.md`), new `e2e/support/isolateLivePage.ts`.
- Not touched: `playwright.config.ts`, `.github/workflows/ci.yml` (HEL-1288), `e2e/hel1275-*` (HEL-1275), product code.
