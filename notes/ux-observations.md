# Helio — UX Observations

**Last updated:** 2026-03-20
**Source:** Playwright exploration of the live app at http://localhost:5173

---

## What's Working Well

- **Clean visual design.** Both dark and light themes feel polished and purposeful. The dark navy palette is distinctive; the light lavender-grey is calm and professional.
- **Consistent affordances.** Three-dot menus, color chips, and badge counts behave predictably throughout.
- **Instant theme switch.** Toggling dark/light is immediate with no flash or layout shift.
- **Sidebar navigation.** ACTIVE / VIEW chips make dashboard state legible at a glance. Collapsing the sidebar frees up space efficiently.
- **Timestamps everywhere.** "UPDATED 3/20/2026" on every item sets expectations for freshness.

---

## Issues Found

### 1. Panels have no real content

**Severity: Critical (product gap)**

Every panel currently shows the same placeholder paragraph:

> "Starter grid placement is live now so future tickets can add richer panel content..."

This text is seeded from `DemoData`. To a new user, it's confusing — they can't tell whether Helio is a tool for displaying data or just for organizing titled boxes.

**Recommendation:** Remove the placeholder text from demo panels; replace with a visual "connect a data source" prompt or type-specific skeleton UI. Even before data binding is implemented, panels should telegraph what they're for.

---

### 2. Popovers don't dismiss each other (and don't close on Escape)

**Severity: High**

Opening the "Customize dashboard" popover while a panel actions menu is open leaves both visible simultaneously (see `screenshots/05-customize-dashboard.png`). There is no global click-outside or Escape handler coordinating the two.

Additionally, the customize popover itself does not respond to Escape — users have to click elsewhere or close the browser overlay manually.

**Recommendation:**

- Implement a single global popover/overlay manager (or use a Radix UI primitive like `Popover` or `DropdownMenu` that handles this by default)
- Ensure any new popover/menu dismisses all others on open
- Add Escape key handler to all floating UI

---

### 3. Dashboard duplication is disabled with no explanation

**Severity: Medium**

The dashboard three-dot menu shows a greyed-out "Duplicate" option with no tooltip or explanation. Users don't know whether this is a permission issue, a paid feature, or simply not yet built.

**Recommendation:** Either implement it (it mirrors the panel duplicate flow, which already works) or hide the option entirely until ready. A disabled state with no explanation erodes trust.

---

### 4. Empty dashboard has no onboarding guidance

**Severity: Medium**

When switching to the "Q1 Sales Report" dashboard (0 panels), the panel area shows "No panels yet." with no call to action beyond the small `+` button in the header.

**Recommendation:** Add an empty state illustration or prompt: "Add your first panel →" with a prominent button. Consider a quick-start flow: pick a panel type → connect a data source → done.

---

### 5. Panel grid only shows one panel per row (layout issue)

**Severity: Low-Medium**

The Production dashboard has 3 panels but only one is visible per scroll. The React Grid Layout is set to prevent automatic compaction (`noCompactor`), which is intentional, but the default placement stacks panels vertically with large gaps. New users won't know to drag panels to fill the horizontal space.

**Recommendation:** Set smarter default grid positions for newly created panels — e.g., fill left-to-right before moving to a new row. Also surface a "reset layout" option for when things get messy.

---

### 6. No search or filter for dashboards or panels

**Severity: Low (for now)**

With only 2 dashboards and 3 panels in the demo, discovery isn't a problem. But as users build out more dashboards, a search bar will become essential.

**Recommendation:** Add to Phase 4 backlog. A simple text filter on the sidebar dashboard list is sufficient initially.

---

### 7. The app title "Helio Dashboard" is hardcoded

**Severity: Low**

The page heading always reads "Helio Dashboard" with the subtitle "A polished control surface for tracking the dashboards that matter most." This doesn't change when switching between dashboards.

In a multi-user SaaS context, the workspace or org name should appear here instead. Consider making the header branding context-aware (e.g., "Acme Corp — Helio" or just the workspace name).

---

## Quick Wins (low effort, high impact)

| Fix                                       | Effort | Impact |
| ----------------------------------------- | ------ | ------ |
| Escape key closes all popovers            | 1–2h   | High   |
| Click-outside dismisses all popovers      | 1–2h   | High   |
| Remove demo placeholder text from panels  | 30m    | High   |
| Empty state with CTA for new dashboards   | 2–3h   | Medium |
| Smarter default panel grid positions      | 2h     | Medium |
| Remove or implement dashboard duplication | 1–3h   | Medium |
