// HEL-1189 design.md D6/D7 — the "Controls" section for an `output` panel's config surface:
// add/auto-bind/rebind/remove date-range/dropdown/numeric-range/text controls. Sibling to
// `OutputPanelSection` (both rendered by `PanelDetailModal.tsx`), mounted only in edit mode. Row rendering lives
// in `OutputControlRow.tsx` (CONTRIBUTING.md file-size budget, mirrors FormEditor/FormFieldRow).

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

import "./OutputControlsEditor.css";
import { FormField, Select } from "../../../../shared/ui/index";
import { InlineError } from "../../../../shared/chrome/InlineError";
import { useAppDispatch } from "../../../../hooks/reduxHooks";
import { useOutputMeta } from "../../hooks/useOutputMeta";
import { getFilterCapabilities } from "../../../pipelines/services/outputService";
import { kindsFor, type FilterOperator } from "../../state/outputControlEligibility";
import { updatePanelOutputControls } from "../../state/panelThunks";
import { KIND_LABELS, OutputControlRow } from "./OutputControlRow";
import { firstEligibleColumn, useOutputControlsEditorState } from "./useOutputControlsEditorState";
import type { OutputControlKind, OutputControlSpec, OutputPanel } from "../../types/panel";
import type { DirtyChangeCallback, PanelEditorHandle } from "./editorTypes";

interface OutputControlsEditorProps {
  panel: OutputPanel;
  onDirtyChange: DirtyChangeCallback;
}

const KIND_ORDER: OutputControlKind[] = ["date-range", "dropdown", "numeric-range", "text"];

/** Generates a control's client-side id (design.md D2 — the server never mints or rewrites it).
 *  `crypto.randomUUID()` is available in every browser this app targets (secure-context, modern
 *  Chromium/Firefox/Safari); no fallback is needed. */
function generateControlId(): string {
  return crypto.randomUUID();
}

export const OutputControlsEditor = forwardRef<PanelEditorHandle, OutputControlsEditorProps>(
  function OutputControlsEditor({ panel, onDirtyChange }, ref) {
    const dispatch = useAppDispatch();
    const { output } = useOutputMeta(panel.config.outputId || null);
    const [capabilities, setCapabilities] = useState<Map<string, FilterOperator[]> | null>(null);
    const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [announcement, setAnnouncement] = useState("");

    const editor = useOutputControlsEditorState(panel.config.controls);

    useEffect(() => {
      onDirtyChange(editor.dirty);
    }, [editor.dirty, onDirtyChange]);

    // Fetched once per editor mount (design.md D6's stated cost model: "called once per panel
    // load/config-open, not the hot path") — combined with `output.schema` (already fetched via
    // `useOutputMeta`) to compute offered kinds/columns and each control's live orphan status.
    useEffect(() => {
      if (!panel.config.outputId) return;
      let cancelled = false;
      void getFilterCapabilities(panel.config.outputId)
        .then((response) => {
          if (cancelled) return;
          setCapabilities(new Map(response.columns.map((c) => [c.column, c.operators])));
          setCapabilitiesError(null);
        })
        .catch(() => {
          if (!cancelled) setCapabilitiesError("Failed to load this Output's filter capabilities.");
        });
      return () => {
        cancelled = true;
      };
    }, [panel.config.outputId]);

    useImperativeHandle(
      ref,
      () => ({
        reset: () => {
          editor.reset();
          setSaveError(null);
        },
        save: async () => {
          if (!editor.dirty) return { ok: true };
          try {
            await dispatch(
              updatePanelOutputControls({ panelId: panel.id, controls: editor.controls }),
            ).unwrap();
            return { ok: true };
          } catch {
            const message = "Failed to save control settings.";
            setSaveError(message);
            return { ok: false, error: message };
          }
        },
      }),
      [editor, dispatch, panel.id],
    );

    if (!output || !capabilities) {
      return (
        <div className="output-controls-editor">
          <h3 className="panel-detail-modal__edit-section-heading">Controls</h3>
          {capabilitiesError ? (
            <InlineError
              error={capabilitiesError}
              variant="banner"
              onRetry={() => {
                setCapabilitiesError(null);
                setCapabilities(null);
              }}
            />
          ) : (
            <p className="output-controls-editor__loading">Loading…</p>
          )}
        </div>
      );
    }

    const schemaColumnOrder = output.schema.map((f) => f.name);
    const schemaTypeByColumn = new Map(output.schema.map((f) => [f.name, f.type]));

    function isColumnEligibleForKind(column: string, kind: OutputControlKind): boolean {
      const operators = capabilities?.get(column) ?? [];
      const fieldType = schemaTypeByColumn.get(column) ?? "";
      return kindsFor(operators, fieldType).includes(kind);
    }

    function eligibleColumnsForKind(kind: OutputControlKind): string[] {
      return schemaColumnOrder.filter((column) => isColumnEligibleForKind(column, kind));
    }

    const offeredKinds = KIND_ORDER.filter((kind) => eligibleColumnsForKind(kind).length > 0);

    function handleAddControl(kind: OutputControlKind) {
      const column = firstEligibleColumn(schemaColumnOrder, (c) =>
        isColumnEligibleForKind(c, kind),
      );
      if (!column) return; // Defensive — offeredKinds already guarantees >=1 eligible column.
      const control: OutputControlSpec = {
        id: generateControlId(),
        kind,
        column,
        label: KIND_LABELS[kind],
      };
      editor.add(control);
      setAnnouncement(`${KIND_LABELS[kind]} control added, bound to ${column}.`);
    }

    function handleRemove(index: number) {
      const removed = editor.controls[index];
      editor.remove(index);
      setAnnouncement(`${KIND_LABELS[removed.kind]} control removed.`);
    }

    return (
      <div className="output-controls-editor">
        <h3 className="panel-detail-modal__edit-section-heading">Controls</h3>
        <div className="sr-only" role="status" aria-live="polite">
          {announcement}
        </div>

        {editor.controls.length === 0 ? (
          <p className="output-controls-editor__empty">No controls yet.</p>
        ) : (
          <div className="output-controls-editor__list">
            {editor.controls.map((control, index) => (
              <OutputControlRow
                key={control.id}
                control={control}
                orphaned={!isColumnEligibleForKind(control.column, control.kind)}
                eligibleColumns={eligibleColumnsForKind(control.kind)}
                onRebind={(column) => editor.rebind(index, column)}
                onLabelChange={(label) => editor.setLabel(index, label)}
                onDefaultValueChange={(value) => editor.setDefaultValue(index, value)}
                onRemove={() => handleRemove(index)}
              />
            ))}
          </div>
        )}

        <FormField label="Add control">
          <Select
            ariaLabel="Add control"
            value=""
            onChange={(kind) => handleAddControl(kind as OutputControlKind)}
            options={offeredKinds.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }))}
            placeholder="Add control"
            disabled={offeredKinds.length === 0}
          />
        </FormField>

        <InlineError error={saveError} />
      </div>
    );
  },
);
