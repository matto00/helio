import type React from "react";

import { isFullscreenEligible } from "../state/panelNarrowing";
import { ActionsMenu } from "../../../shared/chrome/ActionsMenu";
import { InlineError } from "../../../shared/chrome/InlineError";
import { IconButton } from "../../../shared/ui/IconButton";
import { TextField } from "../../../shared/ui/TextField";
import type { Panel } from "../types/panel";
import type { ChartInspectConfig } from "../../../utils/chartClickSelection";
import { GripVertical, Maximize2, RotateCw } from "lucide-react";
import { ICON_SIZE } from "../../../shared/ui/iconSize";
import { Spinner } from "../../../shared/ui/Spinner";

// The `panel-grid-card__top` header block of a desktop `PanelCard` (title / inline rename,
// Refresh, Fullscreen, ActionsMenu, drag handle). A plain (non-memo) component on purpose: this
// block re-rendered on every `PanelCard` render before it was extracted (HEL-1365), and must not
// start skipping renders now. Props are named exactly as the identifiers the JSX uses; every
// `useCallback` stays in `PanelCard`.
interface PanelCardHeaderProps {
  panel: Panel;
  isEditingTitle: boolean;
  editingTitle: string;
  editingTitleError: string | null;
  isConfirmingDelete: boolean;
  outputId: string | null;
  refresh: () => void;
  isRefreshing: boolean;
  isPending: (key: string) => boolean;
  chartInspectConfig: ChartInspectConfig | null;
  onCancelDelete: () => void;
  handleConfirmDelete: () => void;
  handleOpenFullscreen: () => void;
  handleRename: () => void;
  handleDetail: () => void;
  handleDuplicate: () => void;
  handleOpenInspectFromMenu: () => void;
  handleRequestDelete: () => void;
  handleTitleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleTitleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  handleTitleBlur: () => void;
}

export function PanelCardHeader({
  panel,
  isEditingTitle,
  editingTitle,
  editingTitleError,
  isConfirmingDelete,
  outputId,
  refresh,
  isRefreshing,
  isPending,
  chartInspectConfig,
  onCancelDelete,
  handleConfirmDelete,
  handleOpenFullscreen,
  handleRename,
  handleDetail,
  handleDuplicate,
  handleOpenInspectFromMenu,
  handleRequestDelete,
  handleTitleInputChange,
  handleTitleKeyDown,
  handleTitleBlur,
}: PanelCardHeaderProps) {
  return (
    <div className="panel-grid-card__top">
      <div className="panel-grid-card__title-area">
        {isEditingTitle ? (
          <>
            <TextField
              className="panel-grid-card__title-input"
              type="text"
              value={editingTitle}
              autoFocus
              aria-label="Panel title"
              onChange={handleTitleInputChange}
              onKeyDown={handleTitleKeyDown}
              onBlur={handleTitleBlur}
            />
            <InlineError error={editingTitleError} />
          </>
        ) : (
          <>
            <h3 className="panel-grid-card__title">{panel.title}</h3>
          </>
        )}
      </div>
      <div className="panel-grid-card__actions">
        {isConfirmingDelete ? (
          <>
            <button
              type="button"
              className="panel-grid-card__delete-confirm-btn"
              onClick={handleConfirmDelete}
            >
              Confirm
            </button>
            <IconButton
              icon="×"
              variant="secondary"
              size="xs"
              aria-label={`Cancel delete ${panel.title}`}
              onClick={onCancelDelete}
            />
          </>
        ) : (
          // F-128: the drag handle is only meaningful once the header
          // returns to its normal (non-delete-confirm) state — rendering it
          // alongside Confirm/× crowds the header at the exact moment the
          // user should be making a focused binary choice.
          <>
            {/* HEL-579: output-bound panels only (design.md Goals /
                  spec.md "no Refresh control for a non-output panel"). Kept
                  visible during title-editing (like the drag handle below,
                  unlike ActionsMenu) since refreshing data is unrelated to
                  renaming. `refresh` and `isRefreshing` come from the single
                  `usePanelData(panel)` call in `PanelCard` — no prop-threading
                  through `PanelCardBody` needed for this button. */}
            {outputId && (
              <IconButton
                icon={
                  isRefreshing ? (
                    <Spinner size="sm" />
                  ) : (
                    <RotateCw aria-hidden="true" size={ICON_SIZE.sm} />
                  )
                }
                variant="secondary"
                size="xs"
                className="panel-grid-card__refresh-btn"
                aria-label={`Refresh ${panel.title}`}
                disabled={isRefreshing}
                onClick={refresh}
              />
            )}
            {/* HEL-584: view-only fullscreen/focus-mode overlay, gated on
                  the eligible content kinds (design.md Decision 3 — excludes
                  `divider`/`form`). Kept visible during title-editing, like
                  the Refresh control above, since it's unrelated to
                  renaming. */}
            {isFullscreenEligible(panel) && (
              <IconButton
                icon={<Maximize2 aria-hidden="true" size={ICON_SIZE.sm} />}
                variant="secondary"
                size="xs"
                className="panel-grid-card__fullscreen-btn"
                aria-label={`Fullscreen ${panel.title}`}
                title="Fullscreen"
                onClick={handleOpenFullscreen}
              />
            )}
            {isEditingTitle ? null : (
              <ActionsMenu
                label={`${panel.title} panel actions`}
                items={[
                  { label: "Rename", onClick: handleRename },
                  { label: "Customize", onClick: handleDetail },
                  {
                    label: "Duplicate",
                    onClick: handleDuplicate,
                    disabled: isPending(panel.id),
                  },
                  // HEL-572 design.md D7 — chart-eligible panels only
                  // (`chartInspectConfig` is non-null exactly then); opens
                  // for the panel's current selection, or `PanelInspectView`'s
                  // own empty state when nothing is selected yet.
                  ...(chartInspectConfig
                    ? [{ label: "Inspect", onClick: handleOpenInspectFromMenu }]
                    : []),
                  { label: "Delete", onClick: handleRequestDelete, danger: true },
                ]}
              />
            )}
            <button
              type="button"
              className="panel-grid-card__handle"
              aria-label={`Move ${panel.title} panel`}
              title={`Move ${panel.title} panel`}
            >
              {/* F-099: a grip-vertical glyph reads as distinctly different
                    from the adjacent ActionsMenu trigger's horizontal 3-dot
                    ellipsis, instead of the old 2-dot mark that only differed
                    from it by dot count. */}
              <GripVertical aria-hidden="true" size={ICON_SIZE.sm} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
