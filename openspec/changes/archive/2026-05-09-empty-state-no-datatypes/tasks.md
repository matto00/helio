## 1. Frontend

- [ ] 1.1 Add `Link` import from `react-router-dom` to `PanelCreationModal.tsx` if not already present
- [ ] 1.2 Guard the DataType step render: only show empty state when both `pipelines.status` and
      `dataTypes.status` are `"succeeded"`; show a loading indicator while either is `"loading"` or
      `"idle"`
- [ ] 1.3 Add `data-testid="datatype-empty-pipeline-link"` to the pipeline link in the empty state
      `div`, implemented as a `<Link to="/pipelines">` that closes the modal on navigation
- [ ] 1.4 Update the empty state copy to be actionable (e.g. "No data types are registered yet."
      followed by a linked CTA "Go to Pipelines to create one.")
- [ ] 1.5 Add CSS for `.panel-creation-modal__datatype-empty__link` (or equivalent BEM class) to
      style the link as a muted inline anchor consistent with the modal's existing secondary style

## 2. Tests

- [ ] 2.1 Add test: DataType step shows empty state (with `data-testid="datatype-empty-state"`) when
      `registryDataTypes` is empty and both slices are `"succeeded"`
- [ ] 2.2 Add test: empty state contains a link with `data-testid="datatype-empty-pipeline-link"`
      pointing to `/pipelines`
- [ ] 2.3 Add test: empty state is NOT shown while `pipelines.status === "loading"`
- [ ] 2.4 Add test: DataType list is shown (and empty state is absent) when at least one
      pipeline-referenced DataType exists
- [ ] 2.5 Run full test suite and confirm all tests pass
