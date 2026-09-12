import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";

import "./FieldDeclarationTable.css";
import { CANONICAL_FIELD_TYPES, type DatasetFieldType } from "../types/dataSource";
import { getEditorKind } from "../hooks/useDatasetFieldEditor";
import { Select, TextField } from "../../../shared/ui/index";
import { ICON_SIZE } from "../../../shared/ui/iconSize";

/** One declared field row, shared by the create-flow editor and the schema-edit editor.
 *  `id` is a stable React key independent of `name` -- a rename must not remount the row (and
 *  therefore must not lose focus/in-progress state). `default` is kept as the raw editor string
 *  (never a typed value) -- callers serialize it per `useDatasetFieldEditor`'s conventions at
 *  submit time, same as `DatasetRowGrid`'s cell/draft-row editors. */
export interface FieldDeclarationRow {
  id: string;
  name: string;
  type: DatasetFieldType;
  required: boolean;
  default: string;
  /** HEL-1079 schema-edit only: the field's name at load time, present only when this row was
   *  pre-populated from an existing declared schema (never set by the create flow) -- lets the
   *  edit surface distinguish a rename from an added field when building the PATCH payload. */
  previousName?: string;
}

let nextRowId = 0;
/** Generates a stable id for a newly-added row -- monotonic counter is sufficient since rows
 *  never persist across a page reload and never need to be globally unique. */
export function newFieldDeclarationRowId(): string {
  nextRowId += 1;
  return `field-${nextRowId}`;
}

export function emptyFieldDeclarationRow(): FieldDeclarationRow {
  return { id: newFieldDeclarationRowId(), name: "", type: "string", required: false, default: "" };
}

const TYPE_OPTIONS = CANONICAL_FIELD_TYPES.map((t) => ({ value: t, label: t }));

interface FieldDeclarationTableProps {
  rows: FieldDeclarationRow[];
  onChange: (rows: FieldDeclarationRow[]) => void;
  /** Forwarded so a caller (create flow, schema-edit editor) can move focus to "Add field" when
   *  the last field is removed (design.md Decision 6). */
  addFieldButtonRef?: RefObject<HTMLButtonElement | null>;
  idPrefix: string;
  /** Schema-edit only: intercepts a remove BEFORE it is applied — the schema-edit surface uses
   *  this to show a drop-confirmation dialog for a field with existing dataset rows (design.md
   *  Decision 3a) instead of removing it immediately. Returning `false` cancels the removal (the
   *  row is left exactly as it was, including focus); the caller is responsible for its own
   *  focus-return per Decision 6. Omitted entirely by the create flow, where no field being
   *  removed can ever hold committed data. */
  onBeforeRemove?: (row: FieldDeclarationRow) => boolean;
}

/** design.md Decision 1/2/6, tasks.md 1.2/1.3: name/type/required/default/reorder/remove field
 *  editor, shared by the create-flow "columns" step and the schema-edit panel. Reorder is
 *  up/down icon buttons (never drag-and-drop -- keyboard-operable by construction). Focus and a
 *  visually-hidden live-region announcement are managed internally per Decision 6: a reorder
 *  moves focus to the MOVED row's own name input (never a button that can become disabled); a
 *  remove moves focus to the next remaining row's name input, or the "Add field" control if none
 *  remain. */
export function FieldDeclarationTable({
  rows,
  onChange,
  addFieldButtonRef,
  idPrefix,
  onBeforeRemove,
}: FieldDeclarationTableProps) {
  const [announcement, setAnnouncement] = useState("");
  const nameInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  // A focus request set by an action handler and applied in a `useEffect` once the DOM has
  // re-rendered with the new `rows` -- setting `.focus()` synchronously inside the click handler
  // would target a row that either doesn't exist yet (a still-disabled button, HEL-1080's
  // still-disabled-`.focus()` lesson) or hasn't been laid out under its final key yet.
  const pendingFocusRowIdRef = useRef<string | null>(null);
  const pendingFocusAddButtonRef = useRef(false);

  useEffect(() => {
    if (pendingFocusRowIdRef.current) {
      const el = nameInputRefs.current.get(pendingFocusRowIdRef.current);
      pendingFocusRowIdRef.current = null;
      el?.focus();
    } else if (pendingFocusAddButtonRef.current) {
      pendingFocusAddButtonRef.current = false;
      addFieldButtonRef?.current?.focus();
    }
  }, [rows, addFieldButtonRef]);

  function updateRow(id: string, patch: Partial<FieldDeclarationRow>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function moveRow(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= rows.length) return;
    const next = rows.slice();
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    onChange(next);
    pendingFocusRowIdRef.current = moved.id;
    setAnnouncement(
      `${moved.name || "Field"} moved to position ${targetIndex + 1} of ${next.length}.`,
    );
  }

  function removeRow(index: number) {
    const removed = rows[index];
    if (onBeforeRemove && !onBeforeRemove(removed)) return;
    const next = rows.filter((_, i) => i !== index);
    onChange(next);
    if (next.length > 0) {
      const focusIndex = Math.min(index, next.length - 1);
      pendingFocusRowIdRef.current = next[focusIndex].id;
    } else {
      pendingFocusAddButtonRef.current = true;
    }
    setAnnouncement(`${removed.name || "Field"} removed.`);
  }

  return (
    <div className="field-declaration-table">
      <table className="add-source-modal__fields-table" aria-label="Field declarations">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Required</th>
            <th>Default</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const editorKind = getEditorKind(row.type);
            const showDefault = editorKind !== "readonly";
            return (
              <tr key={row.id}>
                <td>
                  <TextField
                    ref={(el) => {
                      if (el) nameInputRefs.current.set(row.id, el);
                      else nameInputRefs.current.delete(row.id);
                    }}
                    type="text"
                    aria-label={`Field ${index + 1} name`}
                    value={row.name}
                    onChange={(e) => updateRow(row.id, { name: e.target.value })}
                    placeholder="field_name"
                  />
                </td>
                <td>
                  <Select
                    ariaLabel={`Field ${index + 1} type`}
                    value={row.type}
                    onChange={(v) => updateRow(row.id, { type: v as DatasetFieldType })}
                    options={TYPE_OPTIONS}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Field ${index + 1} required`}
                    checked={row.required}
                    onChange={(e) => updateRow(row.id, { required: e.target.checked })}
                  />
                </td>
                <td>
                  {/* design.md Decision 5: `binary-ref` stores a JSON object reference, not an
                      editable scalar -- no default input is offered for it. */}
                  {showDefault ? (
                    <TextField
                      type="text"
                      aria-label={`Field ${index + 1} default value`}
                      value={row.default}
                      onChange={(e) => updateRow(row.id, { default: e.target.value })}
                      placeholder="(none)"
                    />
                  ) : (
                    <span className="add-source-modal__optional">not applicable</span>
                  )}
                </td>
                <td className="field-declaration-table__actions">
                  <button
                    type="button"
                    className="add-source-modal__action-link"
                    aria-label={`Move field ${index + 1} up`}
                    onClick={() => moveRow(index, -1)}
                    disabled={index === 0}
                  >
                    <ArrowUp size={ICON_SIZE.sm} />
                  </button>
                  <button
                    type="button"
                    className="add-source-modal__action-link"
                    aria-label={`Move field ${index + 1} down`}
                    onClick={() => moveRow(index, 1)}
                    disabled={index === rows.length - 1}
                  >
                    <ArrowDown size={ICON_SIZE.sm} />
                  </button>
                  <button
                    type="button"
                    className="add-source-modal__action-link"
                    aria-label={`Remove field ${index + 1}`}
                    data-field-remove-for={row.id}
                    onClick={() => removeRow(index)}
                  >
                    <X size={ICON_SIZE.sm} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        ref={addFieldButtonRef}
        type="button"
        id={`${idPrefix}-add-field`}
        className="add-source-modal__btn add-source-modal__btn--secondary add-source-modal__btn--align-start"
        onClick={() => onChange([...rows, emptyFieldDeclarationRow()])}
      >
        + Add field
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
