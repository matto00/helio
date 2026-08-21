import { useLocation } from "react-router-dom";

import { BottomNav } from "../shared/chrome/BottomNav";
import { MobileNavSheet } from "../shared/chrome/MobileNavSheet";
import { PICKER_EMPTY_STATE } from "../shared/chrome/pickerEmptyState";
import { pickerIdForPathname } from "../shared/chrome/sections";
import { usePickerSelection } from "../shared/chrome/usePickerSelection";

interface MobileShellProps {
  isMobileNavSheetOpen: boolean;
  onClose: () => void;
}

/** Phone-only chrome: the bottom tab bar (hidden >=768px via CSS) and the
 * section-item sheet, both driven by `usePickerSelection`. The sheet's open
 * state stays owned by `AppShell` (its trigger button lives in
 * `CommandBar`); this component only reads it and reports close. */
export function MobileShell({ isMobileNavSheetOpen, onClose }: MobileShellProps) {
  const location = useLocation();
  const pickerSelection = usePickerSelection(location.pathname);
  // Mirrors `CommandBar.tsx`'s existing sibling call to the same resolver
  // (design.md D8 — three call sites, all inert) — used only to key into the
  // shared empty-state copy table (HEL-773 design.md D11).
  const pickerId = pickerIdForPathname(location.pathname);

  return (
    <>
      {/* Phone-only section nav — hidden >=768px via BottomNav.css; every
          protected route renders it so no route is a navigation trap
          (notes/mobile-pwa-handoff.md §W3.3). */}
      <BottomNav />
      <MobileNavSheet
        open={isMobileNavSheetOpen}
        onClose={onClose}
        title={pickerSelection.heading}
        items={pickerSelection.items}
        onSelect={pickerSelection.onSelect}
        emptyState={PICKER_EMPTY_STATE[pickerId]}
        createAction={pickerSelection.createAction}
        emptyCreateAction={pickerSelection.emptyCreateAction}
      />
    </>
  );
}
