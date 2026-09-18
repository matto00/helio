// HEL-1084 design.md D5/D7 — the form builder container: dataset picker, schema fetch,
// field list, issue summary, save. Mounted from `PanelDetailModal`'s two if-chains.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import "./FormEditor.css";
import { IconButton, Select, Skeleton } from "../../../../shared/ui/index";
import { InlineError } from "../../../../shared/chrome/InlineError";
import { Plus } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../../../hooks/reduxHooks";
import { fetchSources } from "../../../sources/state/sourcesSlice";
import { fetchDatasetSchema } from "../../../sources/services/dataSourceService";
import { updatePanelForm } from "../../state/panelsSlice";
import { computeFormIssues } from "../../state/formConfigValidation";
import {
  firstUnusedDeclaredField,
  focusTargetIndexAfterRemove,
  useFormEditorState,
} from "./useFormEditorState";
import { FormFieldRow } from "./FormFieldRow";
import type { DatasetFieldResponse } from "../../../sources/types/dataSource";
import type { FormPanel } from "../../types/panel";
import type { DirtyChangeCallback, PanelEditorHandle } from "./editorTypes";

interface FormEditorProps {
  panel: FormPanel;
  onDirtyChange: DirtyChangeCallback;
}

/** Pinned so the stale-message-clearing effect (evaluation-1.md non-blocking
 *  suggestion) can recognize exactly this message without also silently
 *  swallowing an unrelated server-failure message. */
const BLOCKING_ISSUES_MESSAGE = "Fix every field error before saving.";

export const FormEditor = forwardRef<PanelEditorHandle, FormEditorProps>(function FormEditor(
  { panel, onDirtyChange },
  ref,
) {
  const dispatch = useAppDispatch();
  const sources = useAppSelector((s) => s.sources.items);
  const sourcesStatus = useAppSelector((s) => s.sources.status);
  const datasetSources = sources.filter((s) => s.type === "dataset");

  const editor = useFormEditorState(panel.config);
  const [schema, setSchema] = useState<DatasetFieldResponse[] | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const newRowContainerRef = useRef<HTMLDivElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const fieldsContainerRef = useRef<HTMLDivElement | null>(null);
  const [focusNewRow, setFocusNewRow] = useState(false);
  // evaluation-1.md CR1 — explicit focus target after Remove: the index (in
  // the POST-removal list) of the row that should receive focus, or `null`
  // when the Add button should instead (handled inline in onRemove below).
  const [pendingFocusRowIndex, setPendingFocusRowIndex] = useState<number | null>(null);

  const issues = schema ? computeFormIssues(editor.config, schema) : [];
  const issuesByField = new Map(issues.map((i) => [i.field, i.message]));
  const canAdd = schema
    ? firstUnusedDeclaredField(schema, editor.config.fields) !== undefined
    : false;

  useEffect(() => {
    if (sourcesStatus === "idle") dispatch(fetchSources());
  }, [sourcesStatus, dispatch]);

  // Retry / post-save re-fetch (called from event handlers, never directly
  // from an effect body — its synchronous setState calls are fine there).
  const loadSchema = async (dataSourceId: string) => {
    setSchemaError(null);
    setSchema(null);
    try {
      const response = await fetchDatasetSchema(dataSourceId);
      setSchema(response.fields);
    } catch {
      setSchemaError("Failed to load the dataset's declared schema.");
    }
  };

  // Re-fetch on mount and every dataset switch. Deferred via a resolved
  // microtask (mirrors `useOutputMeta`'s pattern) so the reset itself is
  // never a synchronous setState call inside the effect body.
  useEffect(() => {
    const dataSourceId = editor.config.dataSourceId;
    if (!dataSourceId) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        setSchemaError(null);
        setSchema(null);
      }
    });
    void fetchDatasetSchema(dataSourceId)
      .then((response) => {
        if (!cancelled) setSchema(response.fields);
      })
      .catch(() => {
        if (!cancelled) setSchemaError("Failed to load the dataset's declared schema.");
      });
    return () => {
      cancelled = true;
    };
  }, [editor.config.dataSourceId]);

  useEffect(() => {
    if (!focusNewRow || !newRowContainerRef.current) return;
    const focusable =
      newRowContainerRef.current.querySelector<HTMLElement>("button, input, select");
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      focusable?.focus();
      setFocusNewRow(false);
    });
    return () => {
      cancelled = true;
    };
  }, [focusNewRow, editor.config.fields.length]);

  // evaluation-1.md CR1 — explicit focus after Remove, matching Add's own
  // pattern above: focus the row that now occupies the removed row's
  // position (or the new last row, if the removed row was last). Without
  // this, focus fell to `document.body` whenever the LAST row of a 2+-field
  // list was removed — the only case where React has no DOM node left to
  // reconcile into that position (see `focusTargetIndexAfterRemove`'s doc).
  useEffect(() => {
    if (pendingFocusRowIndex === null || !fieldsContainerRef.current) return;
    const rows = fieldsContainerRef.current.querySelectorAll<HTMLElement>(".form-editor__row");
    const target = rows[pendingFocusRowIndex];
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const focusable = target?.querySelector<HTMLElement>("button, input, select");
      focusable?.focus();
      setPendingFocusRowIndex(null);
    });
    return () => {
      cancelled = true;
    };
  }, [pendingFocusRowIndex, editor.config.fields.length]);

  useEffect(() => {
    onDirtyChange(editor.dirty);
  }, [editor.dirty, onDirtyChange]);

  // Non-blocking suggestion (evaluation-1.md): don't leave the stale "Fix
  // every field error before saving." message visible once the underlying
  // issues are actually resolved by a further edit — only this exact
  // blocking-issues message is cleared, never a genuine server-failure
  // message, which stays until the next save attempt or a reset().
  useEffect(() => {
    if (saveError !== BLOCKING_ISSUES_MESSAGE) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) setSaveError(null);
    });
    return () => {
      cancelled = true;
    };
    // Only re-run when the issue LIST actually changes (fixing/adding an
    // issue), not on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues.length]);

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        editor.reset();
        setSaveError(null);
      },
      save: async () => {
        if (!editor.dirty) return { ok: true };
        if (issues.length > 0) {
          setSaveError(BLOCKING_ISSUES_MESSAGE);
          return { ok: false, error: BLOCKING_ISSUES_MESSAGE };
        }
        try {
          await dispatch(updatePanelForm({ panelId: panel.id, config: editor.config })).unwrap();
          return { ok: true };
        } catch {
          const message = "Failed to save form settings.";
          setSaveError(message);
          if (editor.config.dataSourceId) void loadSchema(editor.config.dataSourceId);
          return { ok: false, error: message };
        }
      },
    }),
    [editor, issues.length, dispatch, panel.id],
  );

  return (
    <>
      <h3 className="panel-detail-modal__edit-section-heading">Form</h3>
      <div className="form-editor__dataset">
        <label className="panel-detail-modal__data-label" htmlFor="form-editor-dataset">
          Dataset
        </label>
        <Select
          ariaLabel="Bound dataset"
          value={editor.config.dataSourceId}
          onChange={(v) => editor.setDataset(v)}
          options={datasetSources.map((s) => ({ value: s.id, label: s.name }))}
        />
      </div>

      {schemaError && (
        <InlineError
          error={schemaError}
          variant="banner"
          onRetry={() => void loadSchema(editor.config.dataSourceId)}
        />
      )}

      {!schema && !schemaError && editor.config.dataSourceId && (
        <div aria-label="Loading dataset schema">
          <Skeleton variant="block" height={80} />
        </div>
      )}

      {schema && (
        <div className="form-editor__fields" ref={fieldsContainerRef}>
          {editor.config.fields.map((field, index) => {
            const usedElsewhere = new Set(
              editor.config.fields.filter((_, i) => i !== index).map((f) => f.sourceField),
            );
            const availableFields = schema.filter((f) => !usedElsewhere.has(f.name));
            const declaredField = schema.find((f) => f.name === field.sourceField);
            const isLastAdded = index === editor.config.fields.length - 1;
            return (
              <FormFieldRow
                key={editor.rowKeys[index]}
                field={field}
                index={index}
                total={editor.config.fields.length}
                availableFields={availableFields}
                declaredField={declaredField}
                error={issuesByField.get(field.sourceField)}
                onSourceFieldChange={(sourceField) =>
                  editor.setSourceField(index, sourceField, schema)
                }
                onControlChange={(control) => editor.setControl(index, control)}
                onAttrChange={(attr) => editor.setAttr(index, attr)}
                onMoveUp={() => editor.moveUp(index)}
                onMoveDown={() => editor.moveDown(index)}
                onRemove={() => {
                  // evaluation-1.md CR1 — compute the explicit focus target
                  // BEFORE dispatching the removal (the post-removal length
                  // is `fields.length - 1`), then either focus the Add
                  // button directly (list now empty) or hand off to the
                  // `pendingFocusRowIndex` effect above once the DOM has
                  // re-rendered without the removed row.
                  const target = focusTargetIndexAfterRemove(
                    index,
                    editor.config.fields.length - 1,
                  );
                  editor.removeField(index);
                  if (target === null) {
                    setFocusNewRow(false);
                    addButtonRef.current?.focus();
                  } else {
                    setPendingFocusRowIndex(target);
                  }
                }}
                fieldSelectContainerRef={isLastAdded ? newRowContainerRef : undefined}
              />
            );
          })}

          {issues.length > 0 && (
            <div className="form-editor__issue-summary" role="alert">
              Fix the following before saving: {issues.map((i) => i.message).join("; ")}
            </div>
          )}

          <IconButton
            ref={addButtonRef}
            icon={<Plus size={16} />}
            aria-label="Add field"
            onClick={() => {
              editor.addField(schema);
              setFocusNewRow(true);
            }}
            disabled={!canAdd}
            variant="secondary"
          />
        </div>
      )}

      <InlineError error={saveError} />
    </>
  );
});
