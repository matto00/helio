# Cycle 2: T1 dashboard tab failure in CI (probe-confirmed root cause)

Probe (6 loads of /dashboards/<b> on the 1024x768 touch context, two dashboards): 5 of 6 render one tab (the route's,
active); 1 of 6 renders two tabs with the INACTIVE one first (`zz-a` muted rgb(100,94,86), active `zz-b` rgb(33,29,25)).
T1 used `.dashboard-tab__button` `.first()`, so on that load the tap ACTIVATED the first tab: its colour, border and outline
moved from the muted rest value to the active value, which is the CI diff exactly (100,94,86 -> 33,29,25). A state change
by the tap, not a stuck hover the gating missed. Fix: T1 targets `.dashboard-tab--active .dashboard-tab__button`, whose
state is the same before and after a tap. Re-recorded on unchanged CSS: still red (e2e-red-run-main-css-cycle2.txt, T
dark and light, 4 asserted T instances red). Desktop fixture re-recorded from unchanged CSS (the active tab's hover paint).
Stability: e2e-repeat10-cycle2.txt (100 passed, --repeat-each=10, workers 2).
