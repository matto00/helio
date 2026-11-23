## 1. Tests (red first)

- [x] 1.1 Write `e2e/hel1822-auto-run-trigger-badge.spec.ts` per design D2; run it before any CSS change and commit the red run (both themes fail (b): one test per theme or expect.soft, so each theme shows its own failure); verify by the committed red transcript
- [x] 1.2 Tighten `runHistory.contract.test.ts` to assert the sorted mapped labels equal the literal four (D3); verify by recording the `KNOWN_LABELS["auto-run"] = "Unknown"` mutation passing the old test and failing the new one (`npm --prefix frontend test -- --testPathPatterns=runHistory.contract`), then revert

### Backend

- [x] 2.1 Update the `TriggerSourceMigrationSpec.scala` doc comment (V63 three values, V110 adds `auto-run`); verify comment-only diff

### Frontend

- [x] 3.1 Add `.run-history-modal__trigger--auto-run` (neutral-filled, D1) to `RunHistoryModal.css`; verify the 1.1 spec goes green in both themes with measured numbers recorded to evidence
- [x] 3.2 Run D2 mutation probes (rule removed, fill transparent, muted text) and record each result; verify by evidence transcript

### Tests

- [x] 4.1 Run full spec files: `RunHistoryModal.test.tsx`, `RunHistoryModal.viewer.test.tsx`, `runHistory.contract.test.ts`, `triggerSourceLabel.test.ts`, the new e2e spec and `hel1774-modal-scroll-pipeline-dialogs.spec.ts`; plus lint, typecheck, format:check; verify all green
