# HEL-1842: Flaky e2e: hel1172-multi-denial-toast:105 keyboard order fails in CI (Tab from Alpha's run never reaches Beta's link)

## Description

`e2e/hel1172-multi-denial-toast.spec.ts:105` ("one toast lists both pipelines, persists, exposes computed ARIA, and each row runs only its pipeline; focus never drops to body"), added by HEL-1172 (PR #1250), fails intermittently in CI. That blocks unrelated PRs.

- It failed on HEL-1825's PR #1252, which changes CI config only: job `e2e (7)` 138066772289, and its one rerun 138078446434 (run 45281484916). Playwright's own retry failed too.
- It passed on HEL-1172's own CI, on HEL-1727's PR (#1251) and on main at 647f1f111 and 1cdd7df90.

Failing assertion (line 146):

```
await toast.getByRole("link", { name: "HEL-1172 Alpha" }).focus();
await page.keyboard.press("Tab");
await expect(runAlpha).toBeFocused();          // passes
await page.keyboard.press("Tab");
await expect(toast.getByRole("link", { name: "HEL-1172 Beta" })).toBeFocused();  // Received: inactive
```

The spec is unweighted ("defaulted (no weight row)") in the shard planner, so it lands in different shard company per PR.

## Do

- Find the root cause with a probe, under the systematic-debugging law. Do not just add waits. Candidates: a re-render that replaces the toast's DOM between Tabs (a second toast, a status refresh, the focus hand-off from HEL-1172 D8), a focus trap or roving tabindex, or the scroll container taking focus.
- Decide whether it is a product defect (real keyboard users would see the same) or a test defect. If it is a product defect, fix the product.
- Reproduce under CI-like conditions (shard company, CPU throttle) before and after.
- Add a weight row for the spec if the planner needs one.

## Acceptance criteria

- [ ] Root cause named, with probe evidence.
- [ ] The spec passes repeatedly (for example `--repeat-each` under throttle) where it failed before, shown red first.
- [ ] No unrelated assertion weakened.
