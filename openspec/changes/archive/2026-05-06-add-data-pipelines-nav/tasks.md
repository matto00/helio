## 1. Frontend

- [ ] 1.1 Create `frontend/src/components/PipelinesPage.tsx` with a placeholder empty-state component
- [ ] 1.2 Add `<Route path="/pipelines" element={<PipelinesPage />} />` inside the protected `AppShell` route in `App.tsx`
- [ ] 1.3 Add a "Data Pipelines" `NavLink` to `/pipelines` in the sidebar nav, after the "Data Sources" link
- [ ] 1.4 Replace the binary breadcrumb label logic with a pathname-to-label map covering `/`, `/sources`, and `/pipelines`

## 2. Tests

- [ ] 2.1 Update `App.test.tsx` to verify the "Data Pipelines" nav link is rendered and navigates to `/pipelines`
- [ ] 2.2 Add a test verifying the breadcrumb reads "Data Pipelines" when the route is `/pipelines`
- [ ] 2.3 Add a test verifying an unauthenticated user navigating to `/pipelines` is redirected to `/login`
