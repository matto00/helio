# HEL-1585 offenders

None. On unmodified main, `document.documentElement.scrollHeight === innerHeight` and `scrollY === 0` on all 17 route
visits at 1440x900 and 1280x800 (evidence/red-run-main.txt). The report did not reproduce in non-emulated Chromium.
No shell-level or page-local fix was needed or made.
