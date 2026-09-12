import { useEffect, useMemo, useRef, useState } from "react";

import "./DatasetSchemaEditor.css";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { fetchDatasetSchemaThunk, fetchDatasetRowsPage } from "../state/datasetRowsSlice";
import { updateDatasetSchema } from "../services/dataSourceService";
import { useToast } from "../../toasts/hooks/useToast";
import { InlineError } from "../../../shared/chrome/InlineError";
import { ConfirmInline } from "../../../shared/ui/ConfirmInline";
import { FieldDeclarationTable, type FieldDeclarationRow } from "./FieldDeclarationTable";
import { parseSchemaUpdateError } from "../utils/parseSchemaUpdateError";
import type { DatasetFieldDeclarationPayload, DatasetFieldResponse } from "../types/dataSource";

/** Builds the editable row shape from a declared-schema field list -- shared by the initial
 *  seeding effect and a successful PATCH's response, so both sources of truth (a fresh GET and a
 *  fresh PATCH response) construct rows identically. */
function schemaFieldsToRows(fields: DatasetFieldResponse[]): FieldDeclarationRow[] {
  return fields.map((f) => ({
    id: `existing-${f.name}`,
    name: f.name,
    previousName: f.name,
    type: f.type,
    required: f.required,
    default: f.default !== undefined && f.default !== null ? String(f.default) : "",
  }));
}

interface DatasetSchemaEditorProps {
  sourceId: string;
}

/** Converts a `FieldDeclarationRow`'s raw editor `default` string into the value the PATCH
 *  request's `default` key should carry, or `undefined` (key omitted entirely, per
 *  `UpdateDatasetSchemaRequest`'s `Option[Option[JsValue]]` wire idiom) when the row's default
 *  input is blank. */
function parseDefault(row: FieldDeclarationRow): unknown {
  if (row.default.trim() === "") return undefined;
  if (row.type === "integer") {
    const n = parseInt(row.default, 10);
    return Number.isNaN(n) ? row.default : n;
  }
  if (row.type === "float") {
    const n = parseFloat(row.default);
    return Number.isNaN(n) ? row.default : n;
  }
  if (row.type === "boolean") return row.default === "true";
  return row.default;
}

function rowsToPayload(rows: FieldDeclarationRow[]): DatasetFieldDeclarationPayload[] {
  return rows.map((r) => {
    const parsedDefault = parseDefault(r);
    const isRename = r.previousName !== undefined && r.previousName !== r.name.trim();
    return {
      name: r.name.trim(),
      ...(isRename ? { previousName: r.previousName } : {}),
      type: r.type,
      required: r.required,
      ...(parsedDefault !== undefined ? { default: parsedDefault } : {}),
    };
  });
}

/**
 * HEL-1079 design.md Decision 3/3a/6, tasks.md 2.1-2.5: the schema-edit panel mounted alongside
 * `DatasetRowGrid` on `/sources/:id`. Two rejection cases are predicted and blocked/confirmed
 * client-side, fully determined by the dataset's own row count (`datasetRowsSlice`'s `total`,
 * already fetched for the row grid):
 *
 * - Adding a required field with no default to a non-empty dataset: the "Save schema" button is
 *   disabled with an inline reason before any request is ever sent.
 * - Removing any field from a non-empty dataset: intercepted the moment "Remove" is clicked
 *   (`FieldDeclarationTable`'s `onBeforeRemove`) with an explicit confirm dialog; confirming
 *   applies the removal and immediately submits with `confirmDrop: true` (task 2.3's "on
 *   confirm, submit"), so a drop is never silently batched into some later, unrelated edit.
 *
 * The other two rejection cases (retype, tighten-to-required) cannot be predicted client-side --
 * "Save schema" submits directly and the API's response (200/409/400) is rendered inline in this
 * same editor without losing the in-progress edit.
 */
export function DatasetSchemaEditor({ sourceId }: DatasetSchemaEditorProps) {
  const dispatch = useAppDispatch();
  const { push: pushToast } = useToast();
  const state = useAppSelector((s) => s.datasetRows.bySource[sourceId]);
  const schema = state?.schema ?? null;
  const totalRows = state?.total ?? 0;

  const [rows, setRows] = useState<FieldDeclarationRow[] | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [structuralError, setStructuralError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dropConfirm, setDropConfirm] = useState<{
    row: FieldDeclarationRow;
    nextRows: FieldDeclarationRow[];
  } | null>(null);
  const addFieldButtonRef = useRef<HTMLButtonElement>(null);
  const confirmContainerRef = useRef<HTMLDivElement>(null);
  // design.md Decision 6, on-confirm target: the next remaining field's name input (by its
  // 1-based position once the drop has been applied), or "Add field" if none remain. Set by
  // `handleConfirmDrop` and applied once `rows` has actually re-rendered with the field removed
  // -- `onBeforeRemove` intercepts the removal for the confirm-drop path, so
  // `FieldDeclarationTable`'s own equivalent internal targeting (`removeRow`) never runs here;
  // this replicates it for this one path.
  const pendingConfirmFocusRef = useRef<{ position: number } | "add-button" | null>(null);

  useEffect(() => {
    const pending = pendingConfirmFocusRef.current;
    if (!pending) return;
    pendingConfirmFocusRef.current = null;
    if (pending === "add-button") {
      addFieldButtonRef.current?.focus();
    } else {
      document
        .querySelector<HTMLElement>(`[aria-label="Field ${pending.position + 1} name"]`)
        ?.focus();
    }
  }, [rows]);

  useEffect(() => {
    void dispatch(fetchDatasetSchemaThunk({ sourceId }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId]);

  // Seed the editable rows from the loaded schema exactly once per fetch — an in-progress edit
  // must never be silently clobbered by a background refetch (e.g. DatasetRowGrid's own refetch
  // of the same cached schema after an unrelated row edit).
  const seededSchemaRef = useRef<typeof schema>(null);
  useEffect(() => {
    if (schema && schema !== seededSchemaRef.current && rows === null) {
      seededSchemaRef.current = schema;
      setRows(schemaFieldsToRows(schema.fields));
    }
  }, [schema, rows]);

  useEffect(() => {
    if (dropConfirm) {
      confirmContainerRef.current
        ?.querySelector<HTMLElement>(".ui-confirm-inline__cancel-btn")
        ?.focus();
    }
  }, [dropConfirm]);

  // design.md Decision 3: fully determined by the dataset's own row count -- a newly added
  // (no `previousName`) required field with no default, on a non-empty dataset, is blocked
  // before any request is ever sent.
  const blockingRow = useMemo(() => {
    if (!rows || totalRows === 0) return null;
    return (
      rows.find((r) => r.previousName === undefined && r.required && r.default.trim() === "") ??
      null
    );
  }, [rows, totalRows]);

  /** Returns whether the PATCH succeeded. Per design.md Decision 3a/spec.md's "a rejected
   *  multi-field edit applies nothing": this function is the ONLY place `rows` is ever advanced
   *  to reflect an edit that has left the client -- every caller (plain save, confirmed drop)
   *  submits `nextRows` while leaving the DISPLAYED `rows` untouched until a `200` is confirmed
   *  here. Fixed skeptic-final-1.md CR1: the previous confirmed-drop path advanced `rows` to
   *  `nextRows` in the CALLER (`handleConfirmDrop`) before this ever ran, so a 409/400 left the
   *  drop visually applied on screen (and unrecoverable -- the field's row, and its Remove
   *  button, no longer existed to re-trigger the confirm dialog) even though the server had
   *  rejected it and kept both fields. There is now no path that advances `rows` before a `200`. */
  async function submitSchema(
    nextRows: FieldDeclarationRow[],
    confirmDrop: boolean,
    /** Confirm-drop only (design.md Decision 6): where to move focus once `setRows` below has
     *  actually applied, computed by the caller from the PRE-drop `rows` (the row being dropped
     *  still exists at that point). Set on the ref in the SAME synchronous turn as `setRows` --
     *  not via a `.then()` on this function's returned promise -- so there is no ordering
     *  question between "the ref is set" and "the `[rows]`-keyed effect examines it". */
    onSuccessFocus?: { position: number } | "add-button",
  ): Promise<boolean> {
    setIsSubmitting(true);
    setStructuralError(null);
    setFieldErrors({});
    try {
      const response = await updateDatasetSchema(sourceId, {
        fields: rowsToPayload(nextRows),
        ...(confirmDrop ? { confirmDrop: true } : {}),
      });
      pushToast({
        variant: "success",
        message:
          response.rowsMigrated === 0
            ? "Schema updated. No rows affected."
            : `Schema updated. ${response.rowsMigrated} rows updated.`,
      });
      // Root cause (evaluation-1.md CR1, confirmed via probe): the OLD code reset
      // `seededSchemaRef`/`rows` to null here and relied on the seeding `useEffect` above to
      // re-populate `rows` once `fetchDatasetSchemaThunk` resolved. But that dispatch is
      // fire-and-forget -- on the VERY NEXT render (before the thunk's promise settles), `schema`
      // in Redux was still the STALE pre-drop object, which already satisfied the effect's
      // `schema !== seededSchemaRef.current && rows === null` guard and re-seeded `rows` from the
      // stale data. That guard only fires once per null-window, so once the thunk's fresh
      // `schema` actually arrived, `rows` was no longer null and the effect never re-seeded --
      // the dropped field stayed on screen until a hard reload re-ran the whole mount sequence.
      // Fixed by building `rows` directly from THIS response's authoritative post-write field
      // list -- no race with a separate, later-resolving fetch is possible, because nothing here
      // waits on Redux state at all.
      if (onSuccessFocus !== undefined) pendingConfirmFocusRef.current = onSuccessFocus;
      setRows(schemaFieldsToRows(response.fields));
      void dispatch(fetchDatasetSchemaThunk({ sourceId }));
      void dispatch(fetchDatasetRowsPage({ sourceId }));
      return true;
    } catch (err) {
      const parsed = parseSchemaUpdateError(err);
      if (parsed.kind === "conflict") {
        const next: Record<string, string> = {};
        parsed.rejectedFields.forEach((r) => {
          const key = nextRows.find((row) => row.name === r.name)?.id ?? r.name;
          next[key] = r.reason;
        });
        setFieldErrors(next);
        // A rejected edit (409/400) leaves `rows` exactly as it was BEFORE this call -- this
        // function never advances `rows` until the response above confirms a `200`.
      } else {
        setStructuralError(parsed.message);
      }
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleBeforeRemove(row: FieldDeclarationRow): boolean {
    if (row.previousName === undefined || totalRows === 0) return true; // no confirm needed.
    if (!rows) return false;
    const nextRows = rows.filter((r) => r.id !== row.id);
    setDropConfirm({ row, nextRows });
    return false; // FieldDeclarationTable must not apply the removal yet.
  }

  function handleConfirmDrop() {
    if (!dropConfirm) return;
    const { row, nextRows } = dropConfirm;
    // Captured BEFORE the drop is applied to `rows` (which now only happens on a confirmed
    // `200`, per `submitSchema`'s own doc comment / CR1 fix) -- the row being dropped still
    // exists in `rows` at this point, so its index is well-defined either way.
    const removedIndex = rows?.findIndex((r) => r.id === row.id) ?? -1;
    const successFocusTarget: { position: number } | "add-button" =
      nextRows.length > 0
        ? { position: Math.min(Math.max(removedIndex, 0), nextRows.length - 1) }
        : "add-button";
    setDropConfirm(null);
    void submitSchema(nextRows, true, successFocusTarget).then((succeeded) => {
      if (succeeded) return; // Focus already handled inside `submitSchema` (see its own doc).
      // skeptic-final-1.md CR1: a rejected confirmed drop must leave the field UNDROPPED and
      // recoverable -- `rows` was never advanced, so the field and its own Remove button are
      // still on screen; return focus there (the same target `handleCancelDrop` uses), never to
      // the now-unmounted confirm dialog.
      document.querySelector<HTMLElement>(`[data-field-remove-for="${row.id}"]`)?.focus();
    });
  }

  function handleCancelDrop() {
    if (!dropConfirm) return;
    const { row } = dropConfirm;
    setDropConfirm(null);
    // design.md Decision 6: on cancel, focus returns to the remove button that triggered it --
    // the row still exists since nothing was applied or submitted.
    document.querySelector<HTMLElement>(`[data-field-remove-for="${row.id}"]`)?.focus();
  }

  function handleSaveClick() {
    if (!rows || blockingRow || isSubmitting) return;
    void submitSchema(rows, false);
  }

  if (!schema || rows === null) {
    return <p className="dataset-schema-editor__loading">Loading schema…</p>;
  }

  return (
    <div className="dataset-schema-editor">
      <InlineError error={structuralError} variant="banner" kind="error" />
      <FieldDeclarationTable
        rows={rows}
        onChange={setRows}
        addFieldButtonRef={addFieldButtonRef}
        idPrefix="dataset-schema-edit"
        onBeforeRemove={handleBeforeRemove}
      />
      {Object.entries(fieldErrors).map(([rowKey, reason]) => {
        const row = rows.find((r) => r.id === rowKey || r.name === rowKey);
        return (
          <InlineError
            key={rowKey}
            error={`${row?.name ?? rowKey}: ${reason}`}
            variant="banner"
            kind="error"
          />
        );
      })}
      {blockingRow && (
        <InlineError
          error={`"${blockingRow.name}" is required with no default value, and this dataset already has ${totalRows} row${totalRows === 1 ? "" : "s"}. Supply a default before saving.`}
          variant="banner"
          kind="error"
        />
      )}
      {dropConfirm && (
        <div ref={confirmContainerRef}>
          <ConfirmInline
            label={`This will permanently delete "${dropConfirm.row.name}"'s data from ${totalRows} row${totalRows === 1 ? "" : "s"}.`}
            confirmLabel="Delete field data"
            onConfirm={handleConfirmDrop}
            onCancel={handleCancelDrop}
          />
        </div>
      )}
      <div className="dataset-schema-editor__actions">
        <button
          type="button"
          className="add-source-modal__btn add-source-modal__btn--primary"
          onClick={handleSaveClick}
          disabled={Boolean(blockingRow) || isSubmitting || Boolean(dropConfirm)}
        >
          {isSubmitting ? "Saving…" : "Save schema"}
        </button>
      </div>
    </div>
  );
}
