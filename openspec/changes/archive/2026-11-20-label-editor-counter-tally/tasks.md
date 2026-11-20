## Standing Constraints

## 1. Tests (red first)

### Tests
- [x] 1.1 Add jest tests (FormPanelView.nonOwner.test.tsx, FormFieldControl.test.tsx) per design.md D6
- [x] 1.2 Extend e2e/hel1784-editor-form-submit.spec.ts: editor caption visible + accessible description; owner none
- [x] 1.3 Run them, record the red run in .concertino/runs/HEL-1788/evidence/, commit before implementation

## 2. Frontend

### Frontend
- [x] 2.1 FormFieldControl: optional `tallyCaption` prop; caption <p> after CounterControl; append id to describedby
- [x] 2.2 FormPanelView compact branch: pass the caption constant iff !isFormOwner
- [x] 2.2a Non-owner compact counter seeds at 0 (strip initialValue, re-seed on ownership change) per D3a
- [x] 2.3 CounterControl.css: `.counter-control__caption` rule (tokens only, per D5)

## 3. Verification

### Tests
- [x] 3.1 Green: jest form folder, full hel1784 e2e spec, plus hel1088/hel1090/hel1087 e2e specs
- [x] 3.2 Mutation probes per D6 go red, then restored
- [x] 3.3 Screenshots desktop + phone, light + dark, editor and owner, into evidence (evaluation-1.md, skeptic-final-1.md)
