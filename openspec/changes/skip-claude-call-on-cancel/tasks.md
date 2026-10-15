## Standing Constraints

## 1. Backend

- [x] 1.1 Re-verify the call path facts in design.md Context against the tree; record any drift in evidence.md
- [x] 1.2 Write the D3 first-turn and continue-turn cancel tests exactly as revised D3 specifies (gated OutputRepository.findByIdOwned / AuthoringConversationRepository.findById subclasses, reached + gate Promises, test-owned EC drained to quiescence, the 7-step order); run on UNFIXED code and record the red (`1 was not equal to 0`) in evidence.md
- [x] 1.3 Apply D1 to `startStreaming` and `continueStreaming`; verify the D3 tests go green
- [x] 1.4 Document charging semantics (D2) in `DashboardAuthoringRoutes` scaladoc and `startStreaming` comment; verify by reading the diff

## 2. Tests

- [x] 2.1 Add the D4 read test (terminal result event + exactly 1 transport call); verify green
- [x] 2.2 D5: add/cite the beta admission-charge assertion for an unread stream; sweep route specs for status-only stream checks followed by transport counts and drain them; verify ClaudeRoutesChatGateSpec green
- [x] 2.3 D6 mutation proof for both paths (red then restore green), recorded in evidence.md
- [x] 2.4 Full backend gate `sbt testFull` (capped: nice -n 19, foreground) plus pre-commit hooks green; cite executed counts and own-worktree paths in evidence.md
