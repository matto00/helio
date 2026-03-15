## 1. StatusMessage component

- [x] 1.1 Create `frontend/src/components/StatusMessage.tsx` — accepts `status: "idle" | "loading" | "succeeded" | "failed"` and `message?: string`; renders nothing unless status is `"loading"` or `"failed"`
- [x] 1.2 Create `frontend/src/components/StatusMessage.css` — extract loading and error block styles from `DashboardList.css` as the reference baseline

## 2. InlineError component

- [x] 2.1 Create `frontend/src/components/InlineError.tsx` — accepts `error: string | null | undefined`; renders nothing when falsy
- [x] 2.2 Create `frontend/src/components/InlineError.css` — extract inline error text styles from `DashboardList.css` as the reference baseline

## 3. Wire up DashboardList

- [x] 3.1 Replace inline loading/error `<p>` block with `<StatusMessage>` in `DashboardList.tsx`
- [x] 3.2 Replace inline create error `<p>` with `<InlineError>` in `DashboardList.tsx`
- [x] 3.3 Remove the now-unused `.dashboard-list__status`, `.dashboard-list__status--error`, and `.dashboard-list__create-error` rules from `DashboardList.css`

## 4. Wire up PanelList

- [x] 4.1 Replace inline loading/error `<p>` block with `<StatusMessage>` in `PanelList.tsx`
- [x] 4.2 Replace inline create error `<p>` with `<InlineError>` in `PanelList.tsx`
- [x] 4.3 Remove the now-unused `.panel-list__state`, `.panel-list__state--error`, and `.panel-list__create-error` rules from `PanelList.css`

## 5. Wire up appearance editors

- [x] 5.1 Replace inline error `<p>` with `<InlineError>` in `DashboardAppearanceEditor.tsx`
- [x] 5.2 Remove the now-unused `.dashboard-appearance-editor__error` rule from `DashboardAppearanceEditor.css`
- [x] 5.3 Replace inline error `<p>` with `<InlineError>` in `PanelAppearanceEditor.tsx`
- [x] 5.4 Remove the now-unused `.panel-appearance-editor__error` rule from `PanelAppearanceEditor.css`

## 6. Verification

- [x] 6.1 Run `npm test` — all frontend tests pass
- [x] 6.2 Run `npm run lint` and `npm run format:check` — clean
- [x] 6.3 Visual check: loading, error, and form error states render correctly in the UI
