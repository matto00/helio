- `frontend/src/app/dashboardMeta/DashboardMetaRow.tsx` — Ask button and kebab item for any selected dashboard; Share stays owner-only (D1)
- `frontend/src/app/CommandBar.tsx` — Ask kebab item for any selected dashboard (D1)
- `frontend/src/features/ask/ui/AskAnswerCard.tsx` — non-owner dashboard scope: chips use the per-panel provenance route with the mapped panel id; unmatched citation is plain ordinal (D2)
- `frontend/src/app/dashboardMeta/DashboardMetaRow.roles.test.tsx`, `frontend/src/app/CommandBar.test.tsx` — updated old "Ask hidden" expectations, added narrow-kebab case
- `frontend/src/features/ask/ui/AskAnswerCard.grantee.test.tsx` — new: grantee chips, unmatched, no pin, free upsell, owner unchanged
- `backend/src/test/scala/com/helio/api/protocols/AskSeamSpec.scala` — editor-without-pipeline-grant no-pin guard (D3b), proven by mutation
- `backend/src/test/scala/com/helio/services/ask/AskGranteeRlsSpec.scala` — new RLS guard (D4); uses AskApiHarness's NOBYPASSRLS role (helio_app_test_output_history), not TwoUserRlsApiFixture
- `e2e/hel1781-ask-shared-dashboard.spec.ts` — new e2e; `e2e/hel1773-viewer-grantee-dashboard.spec.ts` — Ask no longer asserted absent for grantees

Cycle 2: `AskAnswerCard.tsx` panel lookup now a `useMemo` over stable selectors (unit test asserts no react-redux unstable-selector warning); `AskGranteeRlsSpec.scala` answers cite data so the pin builder runs (owner control pins, viewer does not) and asserts seeded history values 100/110; e2e watch adds a console-error listener.

Persisted evidence (`/home/matt/Development/helio/.concertino/runs/HEL-1781/evidence/.concertino/scratch/HEL-1781/`): rls-ask.txt, mutation-M1.txt, mutation-M2.txt, mutation-RLS-A.txt, mutation-RLS-B.txt (green), mutation-RLS-C.txt, e2e-green.txt, e2e-mutation-a.txt, e2e-mutation-b.txt, red.txt, red-cr1.txt.

Cycle 3: mutation-RLS-D.txt (grant check and `payloadRows` RLS lookup both removed -> payload-refusal case red) persisted at the same evidence directory; AskGranteeRlsSpec doc comment now matches the transcripts.
