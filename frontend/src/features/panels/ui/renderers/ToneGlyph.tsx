import { CircleCheck, CircleX, TriangleAlert } from "lucide-react";

import { ICON_SIZE } from "../../../../shared/ui/iconSize";
import type { ConditionalFormatRule, ConditionalTone } from "./conditionalFormatting";
import { ruleName } from "./conditionalFormatting";

const GLYPHS = { success: CircleCheck, warning: TriangleAlert, error: CircleX } as const;

interface ToneGlyphProps {
  tone: ConditionalTone;
  /** `lg` (20px) beside the metric figure; `sm` (14px) inside a table cell. */
  size?: keyof typeof ICON_SIZE;
}

/** HEL-1307 owner ruling 4 -- the non-colour signal: one shape per tone (check-circle / triangle / x-circle),
 *  all different from the metric delta's text glyphs. Purely decorative: the accessible name is the sibling
 *  `ToneSrText`. Colour is `currentColor`, so it follows the toned element. */
export function ToneGlyph({ tone, size = "md" }: ToneGlyphProps) {
  const Icon = GLYPHS[tone];
  return <Icon size={ICON_SIZE[size]} aria-hidden="true" className="tone-glyph" />;
}

/** The rule's label (else the tone word) as visually hidden text read with the value. */
export function ToneSrText({ rule }: { rule: ConditionalFormatRule }) {
  return <span className="sr-only">{ruleName(rule)}</span>;
}
