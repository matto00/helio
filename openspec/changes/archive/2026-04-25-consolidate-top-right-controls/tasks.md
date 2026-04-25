## 1. Frontend — UserMenu Component

- [ ] 1.1 Create `frontend/src/components/UserMenu.tsx` with props: `currentUser`, `theme`, `toggleTheme`, `onLogout`
- [ ] 1.2 Implement trigger button rendering avatar image when `avatarUrl` is non-null, initials fallback otherwise
- [ ] 1.3 Implement `useState` open/closed toggle on trigger click
- [ ] 1.4 Implement click-outside dismiss using `useEffect` + `mousedown` listener on `document`
- [ ] 1.5 Implement Escape key dismiss via `onKeyDown` handler; return focus to trigger on close
- [ ] 1.6 Render popover menu with: user display name / email, theme toggle control, sign-out button
- [ ] 1.7 Ensure focus moves to first interactive menu item when popover opens

## 2. Frontend — AppShell Integration

- [ ] 2.1 Remove standalone theme toggle button from `app-command-bar__right` in `App.tsx`
- [ ] 2.2 Remove standalone `user-identity` div and sign-out button from `app-command-bar__right`
- [ ] 2.3 Import and render `<UserMenu>` in place of removed controls, passing `currentUser`, `theme`, `toggleTheme`, `onLogout`

## 3. Frontend — Styles

- [ ] 3.1 Remove `.user-identity`, `.user-avatar`, `.user-avatar--initials`, `.user-identity__name` styles from `App.css` (or scope them under UserMenu)
- [ ] 3.2 Add UserMenu styles: trigger button, popover container, menu items, positioning (absolute, top-right anchor)
- [ ] 3.3 Ensure popover uses existing theme tokens (`--app-*`) for colors and typography

## 4. Tests

- [ ] 4.1 Write `UserMenu.test.tsx`: trigger click opens popover
- [ ] 4.2 Write test: Escape key closes popover
- [ ] 4.3 Write test: click-outside closes popover
- [ ] 4.4 Write test: avatar image rendered when `avatarUrl` is non-null
- [ ] 4.5 Write test: initials fallback rendered when `avatarUrl` is null
- [ ] 4.6 Write test: display name shown in popover; email shown as fallback when displayName is null
- [ ] 4.7 Write test: theme toggle and sign-out accessible inside popover
- [ ] 4.8 Update `App.test.tsx` if it asserts on the removed standalone controls
