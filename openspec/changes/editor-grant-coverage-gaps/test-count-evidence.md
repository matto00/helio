# HEL-1488 per-suite test counts (base -> now; new tests are the only increase)

| Suite | Base | Now | Delta |
|---|---|---|---|
| PipelineRunServiceSpec | 87 | 91 | +4 (viewer real/dry Forbidden; editor dry/real executes) |
| AccessCheckerImplSpec | 5 | 7 | +2 (anonymous: public grant -> Viewer; none -> NotFound) |
| AclDirectiveSpec | 15 | 17 | +2 (anonymous token authorizes -> Viewer; refused -> 404) |
| EditorGrantCoverageSpec (new) | - | 12 | +12 (sites 1,2,3,8 x viewer/editor/owner) |
| ResourcePermissionRoleFallbackSpec (new) | - | 1 | +1 |

Base counts derived as (total - new tests) from the unmutated targeted runs (`s7-unmutated.log`, `s45-unmutated.log`).
Full testFull: 6826 succeeded, 0 failed, 506 suites (`final-testfull.log`).
