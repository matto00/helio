# HEL-554: Guided first-dashboard onboarding (first-run)

## Description

A brand-new user lands in an empty app with no guidance on the source→pipeline→type→panel model, so the path to a first working dashboard is unclear. There is no first-run/onboarding experience today (no onboarding component exists in the codebase). This ticket adds a lightweight guided first-run that gets a new user to their first dashboard/panel.

This is the **final leaf of epic HEL-349**. Four sibling leaves merged on 2026-08-21 and this ticket builds directly on them — see "Inherited constraints" below.

## Scope

* Detect first-run for the signed-in user (no dashboards / no data sources — derive from the already-fetched Redux slices; persist "onboarding dismissed/completed" to `localStorage` per user, mirroring `ThemeProvider` persistence). Do not show it to returning users with content.
* Build a guided onboarding surface (new `features/onboarding/`): a short, dismissible sequence that explains the model and links each step to the real action — Add a data source → Create a pipeline (producing a type) → Create a dashboard → Add a panel. Steps reflect actual completion state (check off as the user creates each resource) and deep-link to the relevant section/modal (reuse the same flows as the empty-state CTAs and, if present, the HEL-348 quick-create actions).
* Present it as a welcome panel/checklist on the empty dashboard view (not a blocking modal), styled with `EmptyState`/`Modal` conventions, Fraunces title (§6), tokens, one entrance animation (§3). Fully dismissible and re-openable from a Help/Getting-started affordance.
* Respect `prefers-reduced-motion`; keyboard-navigable; each step has an accessible name/state (§8).

## Acceptance criteria

* A new user (no content) sees the onboarding checklist on first load; a user with existing content does not.
* Steps reflect real completion (creating a source/pipeline/dashboard/panel checks the step) and each step's CTA opens the correct flow.
* Dismiss persists per user across reloads; a Getting-started affordance re-opens it. No blocking of normal use.
* Uses tokens/Fraunces title/one entrance; correct in light/dark; keyboard + a11y correct. Tests cover first-run detection, step-completion derivation, and persistence; `npm run lint` / `npm test` pass, zero new warnings.

## Out of scope

* Template-based dashboard creation (HEL-421) — link to it if present, don't build it here.
* In-app natural-language authoring (HEL-341) — a future onboarding path, out of scope now.
* Backend onboarding state (client/localStorage only).
* Redesigning the HEL-548 empty-state CTAs. Consume the seam; do not modify it.

## Inherited constraints (binding — from the four HEL-349 leaves merged 2026-08-21)

* **HEL-548 (`09a7a65c`) built the create-action seam for this ticket.** Four per-feature hooks return a uniform `{cta, error, isPending}`. Consume them; do not re-derive each flow. **The seam is read-only for this ticket** — HEL-773 is consuming it concurrently, so a believed-necessary change to it is an escalation, not an edit.
* **HEL-548 D5b records a reach constraint that is binding here**: `useCreatePipelineAction()` works from any route (shell-mounted modal); `useCreateDashboardAction()` dispatches a thunk with no modal; but `useAddSourceAction()` and `useCreatePanelAction()` set a Redux flag read only by `SourcesPage` / `PanelList` respectively. An onboarding CTA that sets one of those flags from a surface where the modal is not mounted reproduces the set-flag-nothing-mounted bug F-045 fixed. Design around this; do not hoist a modal.
* **HEL-528 (`d7815d15`) task 2.4b deliberately did NOT widen `PanelList`'s skeleton gate to `idle`**, because doing so parks a permanent skeleton over the zero-dashboard "New dashboard" CTA — the exact surface this ticket builds on, and named in HEL-528's design as this ticket's reason. Do not undo it.
* **HEL-548 closed the D11 gap on that surface with a `staleDashboardId` discriminator in `panelsSlice`**, distinguishing the post-delete terminal state from the pre-dispatch frame. First-run detection must not fight it.
* **HEL-539 (`3d93e82a`) is the canonical error pattern; HEL-535 (`2eaf1d26`) the toast policy.** Loading, empty and error are three branches of one ladder on the surfaces this ticket touches. Add a fourth thing on top of that ladder; do not restructure it.
* **HEL-774 (`82186dd7`) made the mobile bottom nav icon-only**, dropping the Sources / Pipelines / Types / Metrics labels. Its recorded justification names *this ticket* as the mitigation that teaches that vocabulary. This onboarding is therefore the primary place the source→pipeline→type→panel vocabulary is taught, which raises the bar on the copy.

## Fences (concurrent run HEL-773)

HEL-773 owns `MobileNavSheet.tsx` / `MobileNavSheet.css` and the control that opens the sheet. This ticket owns `features/onboarding/`, the zero-dashboard surface, and the Getting-started affordance. If the work appears to need one of HEL-773's files, escalate rather than editing.

## UI/UX standard (binding)

* `DESIGN.md` is binding and was amended on 2026-08-21 by HEL-774. Read the current file; do not cite a section, rule or exception without confirming it exists in the file as it stands.
* Token discipline is absolute — zero hardcoded colors, spacing or type. §6 governs the Fraunces title, §5 the button recipes (including "one primary per view/section"), §3 the single entrance animation and motion tokens, §7 the loading/empty/error ladder, §8 accessibility.
* **The copy is the deliverable.** This surface teaches a beta user the model. It must convey that types exist only as pipeline output — the Type Registry has no valid "create type" path — and do it in a few words, not a wall of text. Generic encouragement is a defect.
* Steps must reflect real completion state derived from real application state, and each CTA must open the actual flow. A checklist that lies about what the user has done is worse than no checklist.
* Not a blocking modal. Dismissible, persisted per user in `localStorage` mirroring `ThemeProvider`, re-openable from a Getting-started affordance. A returning user with content must never see it.
* **The ≥44px touch floor is non-negotiable** (§3 control metrics, mobile-only at the 430/768 breakpoints). Verify with `getComputedStyle` on the running app at 430 and 768 — never by reading the CSS. This repo has regressed that floor six times and the last two hid behind source-reading.
* Verify by reaching the state through the real application path — an actually-empty account — not by forcing props in a test.

## Verification standard (binding)

* **Reproduce each defect on the unfixed build first**, proving the probe detects it, then prove it gone. Green unit tests have repeatedly certified defects as fixed in this repo that only a computed measurement of the running app could see (a CSS source-order bug that made the 44px floor dead code while a text-matching assertion passed; an implicit `aria-atomic` that made an `outerHTML` grep read as resolved).
* **A test that cannot fail is worse than no test.** Prove each new guard goes red against a deliberately broken variant before trusting it green.
