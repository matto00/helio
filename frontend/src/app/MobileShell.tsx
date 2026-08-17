import { useLocation } from "react-router-dom";

import { BottomNav } from "../shared/chrome/BottomNav";
import { MobileNavSheet } from "../shared/chrome/MobileNavSheet";
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
        emptyMessage={pickerSelection.emptyMessage}
      />
    </>
  );
}
