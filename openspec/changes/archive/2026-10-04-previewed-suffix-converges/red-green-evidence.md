# HEL-1154 red/green/mutation evidence

## RED (unmodified regex, new tests)
```
    Expected: "Revenue"
    Expected: "Revenue (previewed)"
FAIL src/features/patchSets/ui/PatchSetReviewPage.demoFixture.test.tsx
FAIL src/features/patchSets/ui/PatchSetReviewPage.test.tsx
  ● PatchSetReviewPage › baseTitle (F-002 idempotency) › re-appending one marker to a title with 2 markers yields exactly one
  ● PatchSetReviewPage › baseTitle (F-002 idempotency) › re-appending one marker to a title with 3 markers yields exactly one
  ● PatchSetReviewPage › baseTitle (F-002 idempotency) › re-appending one marker to a title with 4 markers yields exactly one
  ● PatchSetReviewPage › baseTitle (F-002 idempotency) › re-appending one marker to a title with 5 markers yields exactly one
  ● PatchSetReviewPage › baseTitle (F-002 idempotency) › strips the whole trailing run of markers (HEL-1154)
  ● PatchSetReviewPage demo fixture — '(previewed)' suffix convergence (HEL-1154) › a first-panel title already carrying 3 markers yields exactly one marker in the patch set
  ● PatchSetReviewPage demo fixture — '(previewed)' suffix convergence (HEL-1154) › a first-panel title already carrying 5 markers yields exactly one marker in the patch set
    Received: "Revenue (previewed)"
    Received: "Revenue (previewed) (previewed)"
    Received: "Revenue (previewed) (previewed) (previewed)"
    Received: "Revenue (previewed) (previewed) (previewed) (previewed)"
    Received: "Revenue (previewed) (previewed) (previewed) (previewed) (previewed)"
Tests:       7 failed, 18 passed, 25 total
Test Suites: 2 failed, 2 total
```

## GREEN (fix applied)
```
Tests:       25 passed, 25 total
Test Suites: 2 passed, 2 total
```

## MUTATION RED (regex reverted to / \(previewed\)$/)
```
    Expected: "Revenue"
    Expected: "Revenue (previewed)"
FAIL src/features/patchSets/ui/PatchSetReviewPage.demoFixture.test.tsx
FAIL src/features/patchSets/ui/PatchSetReviewPage.test.tsx
  ● PatchSetReviewPage › baseTitle (F-002 idempotency) › re-appending one marker to a title with 2 markers yields exactly one
  ● PatchSetReviewPage › baseTitle (F-002 idempotency) › re-appending one marker to a title with 3 markers yields exactly one
  ● PatchSetReviewPage › baseTitle (F-002 idempotency) › re-appending one marker to a title with 4 markers yields exactly one
  ● PatchSetReviewPage › baseTitle (F-002 idempotency) › re-appending one marker to a title with 5 markers yields exactly one
  ● PatchSetReviewPage › baseTitle (F-002 idempotency) › strips the whole trailing run of markers (HEL-1154)
  ● PatchSetReviewPage demo fixture — '(previewed)' suffix convergence (HEL-1154) › a first-panel title already carrying 3 markers yields exactly one marker in the patch set
  ● PatchSetReviewPage demo fixture — '(previewed)' suffix convergence (HEL-1154) › a first-panel title already carrying 5 markers yields exactly one marker in the patch set
    Received: "Revenue (previewed)"
    Received: "Revenue (previewed) (previewed)"
    Received: "Revenue (previewed) (previewed) (previewed)"
    Received: "Revenue (previewed) (previewed) (previewed) (previewed)"
    Received: "Revenue (previewed) (previewed) (previewed) (previewed) (previewed)"
Tests:       7 failed, 18 passed, 25 total
Test Suites: 2 failed, 2 total
```

## GREEN again (fix restored)
```
Tests:       25 passed, 25 total
Test Suites: 2 passed, 2 total
```

