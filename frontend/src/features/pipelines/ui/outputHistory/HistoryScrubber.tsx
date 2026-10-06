import { ChevronLeft, ChevronRight } from "lucide-react";

import { IconButton } from "../../../../shared/ui";
import { ICON_SIZE } from "../../../../shared/ui/iconSize";
import { formatCaptureTime } from "../../../panels/history/formatCaptureTime";
import type { HistoryPoint } from "../../../panels/history/outputHistoryService";

interface HistoryScrubberProps {
  /** Newest first. */
  points: HistoryPoint[];
  /** Index into `points` (0 = newest). */
  selectedIndex: number;
  onSelect: (index: number) => void;
}

function describe(point: HistoryPoint): string {
  return `${formatCaptureTime(point.capturedAt)}, ${point.rowCount.toLocaleString()} rows`;
}

/** HEL-1277 design D4 — a native range input (oldest at the left, newest at the right) with
 *  older/newer buttons for pointer users. The input is the single keyboard-operable control:
 *  ArrowLeft/ArrowRight move one retained point, and its spoken value is the capture time. */
export function HistoryScrubber({ points, selectedIndex, onSelect }: HistoryScrubberProps) {
  const last = points.length - 1;
  const value = last - selectedIndex;
  const selected = points[selectedIndex];
  return (
    <div className="output-history__scrubber">
      <IconButton
        icon={<ChevronLeft size={ICON_SIZE.sm} />}
        aria-label="Older run"
        variant="secondary"
        size="sm"
        disabled={selectedIndex >= last}
        onClick={() => onSelect(selectedIndex + 1)}
      />
      <input
        type="range"
        className="output-history__range"
        aria-label="Recorded runs"
        min={0}
        max={last}
        step={1}
        value={value}
        aria-valuetext={selected ? describe(selected) : undefined}
        disabled={last === 0}
        onChange={(e) => onSelect(last - Number(e.target.value))}
      />
      <IconButton
        icon={<ChevronRight size={ICON_SIZE.sm} />}
        aria-label="Newer run"
        variant="secondary"
        size="sm"
        disabled={selectedIndex <= 0}
        onClick={() => onSelect(selectedIndex - 1)}
      />
    </div>
  );
}
