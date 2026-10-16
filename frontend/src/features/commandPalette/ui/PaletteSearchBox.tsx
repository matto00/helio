import { Search } from "lucide-react";

import "./PaletteSearchBox.css";
import { ICON_SIZE } from "../../../shared/ui/iconSize";
import { KeyCap } from "../../../shared/ui/KeyCap";
import { formatCombo, isMacPlatform, shortcuts } from "../../../shared/chrome/shortcuts";
import { useCommandPalette } from "../hooks";

const PALETTE_COMBO = shortcuts.find((s) => s.id === "command-palette")!.combo;
const BOX_LABEL = "Search, jump, or ask";

/** HEL-1575 D9: the "Search, jump, or ask" box that opens the command palette. A button, not an input: the
 *  palette owns the text field. Shows the platform's shortcut (⌘K / Ctrl+K) from the single declaration in
 *  `shortcuts.ts` and exposes it via `aria-keyshortcuts`. Below the host's container width the label hides
 *  (CSS) and the icon + shortcut remain; the accessible name never changes. Reusable by HEL-1578's Home. */
export function PaletteSearchBox() {
  const { open } = useCommandPalette();
  const mac = isMacPlatform();
  const tokens = formatCombo(PALETTE_COMBO, { mac });
  return (
    <button
      type="button"
      className="palette-search-box"
      aria-label={BOX_LABEL}
      aria-keyshortcuts={`${mac ? "Meta" : "Control"}+${PALETTE_COMBO.key.toUpperCase()}`}
      onClick={() => open()}
    >
      <Search size={ICON_SIZE.md} aria-hidden="true" className="palette-search-box__icon" />
      <span className="palette-search-box__label">{BOX_LABEL}</span>
      <span className="palette-search-box__keys" aria-hidden="true">
        {tokens.map((token, index) => (
          <KeyCap key={index}>{token}</KeyCap>
        ))}
      </span>
    </button>
  );
}
