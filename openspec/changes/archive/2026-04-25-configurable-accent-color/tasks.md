## 1. Frontend: Accent color utilities

- [x] 1.1 Add `AccentStorageKey` constant and `getInitialAccentColor()` to `frontend/src/theme/theme.ts`
- [x] 1.2 Add `ACCENT_PRESETS` array (8 colors with label and hex) to `frontend/src/theme/theme.ts`
- [x] 1.3 Add `buildAccentTokens(hex: string)` to `frontend/src/theme/appearance.ts` that returns all 6 CSS variable key/value pairs
- [x] 1.4 Add `applyAccentTokens(hex: string)` that calls `document.documentElement.style.setProperty` for each derived token

## 2. Frontend: ThemeProvider extension

- [x] 2.1 Add `accentColor` state to `ThemeProvider` initialized via `getInitialAccentColor()`
- [x] 2.2 Add `useEffect` in `ThemeProvider` to call `applyAccentTokens` whenever `accentColor` changes and persist to localStorage
- [x] 2.3 Expose `accentColor` and `setAccentColor` on `ThemeContext`
- [x] 2.4 Update `useTheme()` return type to include `accentColor` and `setAccentColor`

## 3. Frontend: AccentPicker component

- [x] 3.1 Create `frontend/src/components/AccentPicker.tsx` with a row of swatch buttons from `ACCENT_PRESETS`
- [x] 3.2 Style swatches in `frontend/src/components/AccentPicker.css`: circular, 20px, ring on selected, keyboard-focusable
- [x] 3.3 Add accessible `aria-label` and `aria-pressed` to each swatch button
- [x] 3.4 Show a visual selected indicator (ring/checkmark) on the active swatch

## 4. Frontend: UserMenu integration

- [x] 4.1 Add `accentColor` and `setAccentColor` props to `UserMenu` component interface
- [x] 4.2 Render `<AccentPicker>` inside the UserMenu popover, below the theme toggle, above sign-out
- [x] 4.3 Add a section label ("Accent color") above the picker for clarity
- [x] 4.4 Update all call sites of `UserMenu` to pass `accentColor` and `setAccentColor` from `useTheme()`

## 5. Tests

- [x] 5.1 Unit-test `buildAccentTokens` in `appearance.test.ts`: verify correct rgba values for a known hex input
- [x] 5.2 Unit-test `getInitialAccentColor` in theme tests: verify default when localStorage empty, stored value when present
- [x] 5.3 Add test to `ThemeProvider.test.tsx`: accent color is read from localStorage on mount and applied to documentElement
- [x] 5.4 Add `AccentPicker.test.tsx`: renders all presets, clicking a swatch calls `setAccentColor`, selected swatch has aria-pressed=true
