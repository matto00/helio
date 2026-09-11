import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import "./DatasetRowGrid.css";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { ConfirmInline } from "../../../shared/ui/ConfirmInline";
import { DataGrid, type ColumnDef } from "../../../shared/ui/DataGrid";
import { InlineError } from "../../../shared/chrome/InlineError";
import {
  appendDatasetRow,
  clearConflict,
  deleteDatasetRow,
  fetchDatasetRowsPage,
  fetchDatasetSchemaThunk,
  markRowDeleted,
  patchDatasetRow,
  popCursorStack,
  pushCursorStack,
  refetchConflict,
  type DatasetRowConflict,
  type RowMutationRejection,
} from "../state/datasetRowsSlice";
import {
  canEmptyField,
  getEditorKind,
  isEmptyEditorValue,
  serializeEditorValue,
  toEditorRawValue,
} from "../hooks/useDatasetFieldEditor";
import { parseDatasetRowValidationError } from "../utils/parseDatasetRowValidationError";
import type { DatasetFieldResponse, RowResponseRow } from "../types/dataSource";

interface DatasetRowGridProps {
  sourceId: string;
}

interface ActiveCell {
  rowId: string;
  columnKey: string;
}

/** Row key used internally to smuggle a row's identity through `DataGrid`'s plain
 *  `Record<string, unknown>` row shape without colliding with a declared field named `__rowId`. */
const ROW_ID_KEY = "__datasetRowId";

function cellKey(rowId: string, columnKey: string): string {
  return `${rowId}:${columnKey}`;
}

// design.md Decision 0 / tasks.md 4.2a: mirrors `Modal.tsx`'s own `FOCUSABLE_SELECTORS` — the
// active cell's enclosing `<td>` unconditionally carries `tabIndex={0}` during edit mode
// (`DataGrid` has no edit-mode concept of its own), so the browser's NATIVE Tab/Shift+Tab
// traversal from inside the editor would resolve back onto that same `<td>` rather than leaving
// the grid. This selector is used to find the real next/previous focusable element in the
// document, outside the grid, that a native Tab press would otherwise have to skip past.
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Programmatically resolves and focuses the next (`"forward"`) or previous (`"backward"`)
 *  focusable element in the document that lies OUTSIDE `container`, in document order — the
 *  `.focus()` this file's Tab/Shift+Tab handler performs instead of relying on the browser's
 *  default traversal (design.md Decision 0). Falls back to the browser's default tab order
 *  (`tasks.md` 4.3b) when there is no such element (e.g. Tab from the grid's last focusable page
 *  element) by simply doing nothing — the browser's own default Tab handling still runs since
 *  this function's caller only calls `preventDefault()` once a target is actually found. */
function focusOutsideGrid(container: HTMLElement, direction: "forward" | "backward"): boolean {
  const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  const outside = all.filter((el) => !container.contains(el));
  if (direction === "forward") {
    const target = outside.find(
      (el) => (container.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    );
    if (!target) return false;
    target.focus();
    return true;
  }
  const candidates = outside.filter(
    (el) => (container.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) !== 0,
  );
  const target = candidates[candidates.length - 1];
  if (!target) return false;
  target.focus();
  return true;
}

/**
 * HEL-1080 design.md Decisions 0/0a/3/3a/4/6/7/8 — the editable, paged, keyboard-navigable grid
 * over a dataset source's rows. Always renders `DataGrid` with `variant="preview"` (never
 * `"full"` — task 5.8's regression guard) and `gridMode` enabled.
 */
export function DatasetRowGrid({ sourceId }: DatasetRowGridProps) {
  const dispatch = useAppDispatch();
  const state = useAppSelector((s) => s.datasetRows.bySource[sourceId]);

  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
  const [editingCell, setEditingCell] = useState<ActiveCell | null>(null);
  const [editValue, setEditValue] = useState("");
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [confirmDeleteRowId, setConfirmDeleteRowId] = useState<string | null>(null);
  // skeptic-final-2.md CR-B: add-row is a draft form (raw per-field editor strings, keyed by
  // field name), not an immediate all-`null` append -- the real backend 400s an all-`null`
  // append whenever any field is `required` with no declared default (`DatasetRowValidator`),
  // so the user must be able to fill those fields BEFORE submission.
  const [isAddingRow, setIsAddingRow] = useState(false);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [isAddRowSubmitting, setIsAddRowSubmitting] = useState(false);
  // HEL-1080 tasks.md 4.3a (skeptic round-5, REQUIRED): guards against a Tab-triggered
  // programmatic `.focus()` also firing the editor's own `blur` handler, which would otherwise
  // commit the SAME edit a second time. Cleared synchronously on the FIRST commit/cancel; every
  // later commit path for that edit no-ops.
  const editEndedRef = useRef(false);
  // design.md Decision 0 / tasks.md 4.2a: the grid's own DOM boundary, used to resolve the real
  // next/previous focusable element OUTSIDE the grid on Tab/Shift+Tab from inside an editor.
  const gridContainerRef = useRef<HTMLDivElement>(null);
  // HEL-1080 skeptic-final-1.md CR3: the editor `<input>`/`<textarea>` unmounts on every
  // commit/cancel, which drops real DOM focus to `<body>` (an unmounted element cannot remain
  // "focused"). Set to `true` exactly when the edit ended via Escape or a non-textarea Enter
  // (the two paths where there is a well-defined cell to return focus to); left `false` for a
  // blur triggered by the user clicking/tabbing somewhere else on purpose (returning focus there
  // would fight the click) and for the "no outside target" Tab fallback (design.md 4.3b: leave
  // the browser's own default traversal alone rather than yanking focus back).
  const pendingFocusReturnRef = useRef(false);
  // Tracks the PREVIOUS `editingCell` so the focus-return effect below only fires on an actual
  // editing->not-editing transition, never on first mount (where `editingCell` is already `null`
  // and there is nothing to "return" focus from).
  const prevEditingCellRef = useRef<ActiveCell | null>(null);
  // skeptic-final-2.md CR-D: named per-path focus-loss fixes -- refs to the Prev/Next buttons
  // (so the OTHER one can take focus when the pressed one becomes disabled) and to the
  // delete-confirm's own container (so its Cancel button can be autofocused on appearance).
  const prevButtonRef = useRef<HTMLButtonElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const confirmContainerRef = useRef<HTMLDivElement>(null);
  // skeptic-final-3.md CR-H: the add-row draft form's own two named focus-loss paths -- opening
  // it must move focus INTO the form (first field), and a successful Save must leave focus on a
  // deliberate target (the "Add row" button, once the form has unmounted) rather than nowhere.
  const draftContainerRef = useRef<HTMLDivElement>(null);
  const addRowButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void dispatch(fetchDatasetSchemaThunk({ sourceId }));
    void dispatch(fetchDatasetRowsPage({ sourceId }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId]);

  const schema = state?.schema ?? null;
  const rows = useMemo(() => state?.rows ?? [], [state?.rows]);
  const fields: DatasetFieldResponse[] = useMemo(() => schema?.fields ?? [], [schema]);
  const fieldsByName = useMemo(() => {
    const map = new Map<string, DatasetFieldResponse>();
    fields.forEach((f) => map.set(f.name, f));
    return map;
  }, [fields]);

  // HEL-1080 skeptic-final-1.md CR1: `activeCell` starting `null` (and staying `null` forever,
  // since nothing ever defaulted it) meant NO cell ever carried `tabIndex=0` — Tab from the
  // toolbar skipped the grid entirely. Defaults to the first row's first column once rows/fields
  // load, and RE-defaults whenever the currently active row or column disappears (e.g. Prev/Next
  // loaded a different page, or the active row was deleted) — never leaves `activeCell` pointing
  // at something no longer rendered.
  useEffect(() => {
    if (rows.length === 0 || fields.length === 0) {
      setActiveCell(null);
      return;
    }
    setActiveCell((prev) => {
      if (prev) {
        const rowStillExists = rows.some((r) => r.id === prev.rowId);
        const colStillExists = fields.some((f) => f.name === prev.columnKey);
        if (rowStillExists && colStillExists) return prev;
      }
      return { rowId: rows[0].id, columnKey: fields[0].name };
    });
  }, [rows, fields]);

  const gridRows = useMemo(
    () =>
      rows.map((row) => {
        const record: Record<string, unknown> = { [ROW_ID_KEY]: row.id };
        fields.forEach((field, i) => {
          record[field.name] = row.data[i];
        });
        return record;
      }),
    [rows, fields],
  );

  const endEdit = useCallback(() => {
    editEndedRef.current = true;
    setEditingCell(null);
  }, []);

  const cancelEdit = useCallback(() => {
    if (editEndedRef.current) return; // Escape never commits, and never double-fires either.
    endEdit();
  }, [endEdit]);

  const startEdit = useCallback((rowId: string, columnKey: string, initial: string) => {
    editEndedRef.current = false;
    setEditingCell({ rowId, columnKey });
    setEditValue(initial);
  }, []);

  // HEL-1080 skeptic-final-1.md CR3: returns real DOM focus to the active cell once the editor
  // unmounts (see `pendingFocusReturnRef`'s own doc comment for exactly which paths set the flag).
  useEffect(() => {
    if (prevEditingCellRef.current !== null && editingCell === null) {
      if (pendingFocusReturnRef.current) {
        pendingFocusReturnRef.current = false;
        const td = gridContainerRef.current?.querySelector<HTMLElement>('td[tabindex="0"]');
        td?.focus();
      }
    }
    prevEditingCellRef.current = editingCell;
  }, [editingCell]);

  // skeptic-final-2.md CR-D: the shared "return focus to the grid" primitive for every OTHER
  // focus-loss path this cycle names (delete-confirm/-cancel, conflict retry/discard/delete-
  // anyway) -- deferred one frame so it runs AFTER the triggering element (a `ConfirmInline`
  // button, a conflict banner button) has already unmounted and the grid has re-rendered with
  // its current `activeCell`.
  const focusActiveCell = useCallback(() => {
    requestAnimationFrame(() => {
      const td = gridContainerRef.current?.querySelector<HTMLElement>('td[tabindex="0"]');
      td?.focus();
    });
  }, []);

  // skeptic-final-2.md CR-D: autofocus the delete-confirm's Cancel button the moment it appears
  // -- `ConfirmInline` itself takes no `autoFocus` prop (a shared primitive with other
  // consumers), so this is scoped locally via the wrapping container's ref.
  useEffect(() => {
    if (!confirmDeleteRowId) return;
    confirmContainerRef.current
      ?.querySelector<HTMLElement>(".ui-confirm-inline__cancel-btn")
      ?.focus();
  }, [confirmDeleteRowId]);

  // skeptic-final-3.md CR-H: autofocus the draft form's first editable field the moment it opens
  // -- previously nothing moved focus into the form at all (Enter on "Add row" left focus on
  // `<body>` once the button itself became disabled), so a keyboard/screen-reader user had no
  // indication the "New row" group had opened, and the next Tab landed on Refresh instead.
  useEffect(() => {
    if (!isAddingRow) return;
    draftContainerRef.current?.querySelector<HTMLElement>("input, textarea")?.focus();
  }, [isAddingRow]);

  const submitPatch = useCallback(
    (row: RowResponseRow, fieldIndex: number, value: unknown) => {
      const nextData = row.data.slice();
      nextData[fieldIndex] = value;
      dispatch(
        patchDatasetRow({ sourceId, rowId: row.id, updatedAt: row.updatedAt, data: nextData }),
      )
        .unwrap()
        .catch((rejected: RowMutationRejection | undefined) => {
          if (!rejected) return;
          if (rejected.notFound) {
            // skeptic-final-2.md CR-A: HEL-1078 D5 -- `RowMutationFailure.RowNotFound` -> 404,
            // a DIFFERENT case from a 409 stale-value conflict. The row is genuinely gone, so
            // there is nothing to re-fetch or retry against; record it synchronously.
            dispatch(markRowDeleted({ sourceId, rowId: row.id, action: "edit" }));
            return;
          }
          if (rejected.conflict) {
            // skeptic-final-1.md CR4: carry the user's ORIGINAL edit (which field, what value)
            // through to the conflict record so Retry can reapply exactly this edit on top of
            // the freshly re-fetched row, per design.md Decision 3.
            void dispatch(
              refetchConflict({
                sourceId,
                rowId: row.id,
                action: "edit",
                editedFieldIndex: fieldIndex,
                editedValue: value,
              }),
            );
            return;
          }
          // design.md Decision 3a: parse the 400 message into per-field errors where possible;
          // fall back to a grid-level banner for a row-length mismatch or an unparseable message
          // (tasks.md 5.9 — tracked, not silent, degradation).
          const parsed = parseDatasetRowValidationError(rejected.message);
          const attached = parsed.filter((p) => p.fieldName !== null);
          const unattached = parsed.filter((p) => p.fieldName === null);
          if (attached.length > 0) {
            setCellErrors((prev) => {
              const next = { ...prev };
              attached.forEach((p) => {
                next[cellKey(row.id, p.fieldName as string)] = p.message;
              });
              return next;
            });
          }
          if (unattached.length > 0 || attached.length === 0) {
            setBannerError(rejected.message);
          }
        });
    },
    [dispatch, sourceId],
  );

  const commitEdit = useCallback(
    (rowId: string, columnKey: string, rawValue: string) => {
      if (editEndedRef.current) return; // 4.3a: already committed/cancelled once.
      endEdit();

      const field = fieldsByName.get(columnKey);
      const row = rows.find((r) => r.id === rowId);
      if (!field || !row) return;

      const fieldIndex = fields.findIndex((f) => f.name === columnKey);
      if (fieldIndex === -1) return;
      const kind = getEditorKind(field.type);
      const key = cellKey(rowId, columnKey);

      const previousRaw = toEditorRawValue(row.data[fieldIndex]);
      // 4.3b: unchanged value is a no-op — never raises "cannot be emptied" for a field whose
      // stored value already needs no submission.
      if (rawValue === previousRaw) return;

      if (isEmptyEditorValue(kind, rawValue)) {
        if (!canEmptyField(field)) {
          setCellErrors((prev) => ({
            ...prev,
            [key]: `${field.name} is required and has no default — it cannot be emptied.`,
          }));
          return;
        }
        setCellErrors((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        submitPatch(row, fieldIndex, null);
        return;
      }

      const serialized = serializeEditorValue(kind, rawValue);
      if (serialized === undefined) {
        setCellErrors((prev) => ({
          ...prev,
          [key]: `${field.name} must be a valid ${field.type}.`,
        }));
        return;
      }
      setCellErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      submitPatch(row, fieldIndex, serialized);
    },
    [endEdit, fieldsByName, fields, rows, submitPatch],
  );

  // design.md Decision 0 ("Enter (while editing) commits and moves the active cell down one
  // row") — clamped at the last row of the current page, no wrap, no cross-page navigation
  // (matching the arrow-key boundary behavior).
  const moveActiveCellDown = useCallback(
    (rowId: string, columnKey: string) => {
      const idx = rows.findIndex((r) => r.id === rowId);
      if (idx === -1) return;
      const nextIdx = Math.min(rows.length - 1, idx + 1);
      setActiveCell({ rowId: rows[nextIdx].id, columnKey });
    },
    [rows],
  );

  const currentPage = state?.cursorStack.length ?? 1;

  const columns: ColumnDef[] = useMemo(() => {
    return fields.map((field) => ({
      key: field.name,
      header: field.name,
      render: (row: Record<string, unknown>) => {
        const rowId = row[ROW_ID_KEY] as string;
        const isEditing = editingCell?.rowId === rowId && editingCell.columnKey === field.name;
        const error = cellErrors[cellKey(rowId, field.name)];
        const kind = getEditorKind(field.type);

        if (isEditing) {
          const commonProps = {
            autoFocus: true,
            onKeyDown: (e: ReactKeyboardEvent) => {
              if (e.key === "Escape") {
                e.preventDefault();
                pendingFocusReturnRef.current = true;
                cancelEdit();
              } else if (e.key === "Enter" && kind !== "textarea") {
                e.preventDefault();
                pendingFocusReturnRef.current = true;
                commitEdit(rowId, field.name, editValue);
                moveActiveCellDown(rowId, field.name);
              } else if (e.key === "Tab") {
                // tasks.md 4.2a / design.md Decision 0: the active cell's enclosing `<td>`
                // unconditionally keeps `tabIndex={0}` during edit mode (`DataGrid` has no
                // edit-mode concept), so the browser's OWN Tab traversal from inside this editor
                // would land back on that same `<td>`, not outside the grid. Commit first, then
                // resolve and focus the real next/previous focusable element ourselves —
                // `preventDefault()` only once a target is actually found, so a genuinely absent
                // target (4.3b: Tab from the grid's last focusable page element) falls back to
                // the browser's own default traversal instead of doing nothing.
                commitEdit(rowId, field.name, editValue);
                const container = gridContainerRef.current;
                if (container && focusOutsideGrid(container, e.shiftKey ? "backward" : "forward")) {
                  e.preventDefault();
                }
              }
            },
            onBlur: () => commitEdit(rowId, field.name, editValue),
          };

          if (kind === "checkbox") {
            return (
              <input
                type="checkbox"
                checked={editValue === "true"}
                onChange={(e) => setEditValue(String(e.target.checked))}
                {...commonProps}
              />
            );
          }
          if (kind === "textarea") {
            return (
              <textarea
                className="dataset-row-grid__editor"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                {...commonProps}
              />
            );
          }
          return (
            <input
              type={kind === "number" ? "number" : kind === "datetime" ? "datetime-local" : "text"}
              className="dataset-row-grid__editor"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              {...commonProps}
            />
          );
        }

        const value = row[field.name];
        // design.md Decision 4 (amended, skeptic-final-1.md CR6): edits, delete, and add-row are
        // ALL pessimistic -- this is the visible, testable evidence of that: the cell whose row
        // has an in-flight patch renders a "Saving…" indicator rather than silently changing
        // once the server responds.
        const isPending = Boolean(state?.pending[rowId]);
        return (
          <div
            className="dataset-row-grid__cell"
            onClick={() => setActiveCell({ rowId, columnKey: field.name })}
          >
            <span>{value == null ? "—" : String(value)}</span>
            {isPending && <span className="dataset-row-grid__cell-pending">Saving…</span>}
            {error && (
              <span className="dataset-row-grid__cell-error" role="alert" aria-live="assertive">
                {error}
              </span>
            )}
          </div>
        );
      },
    }));
  }, [
    fields,
    editingCell,
    editValue,
    cellErrors,
    cancelEdit,
    commitEdit,
    moveActiveCellDown,
    state?.pending,
  ]);

  const handleActiveCellChange = useCallback((next: ActiveCell | null) => {
    setActiveCell(next);
  }, []);

  const handleGridKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (!activeCell || editingCell) return;
      const field = fieldsByName.get(activeCell.columnKey);
      const row = rows.find((r) => r.id === activeCell.rowId);
      if (!field || !row) return;

      if (e.key === "Enter" || e.key === "F2") {
        if (getEditorKind(field.type) === "readonly") return;
        e.preventDefault();
        const fieldIndex = fields.findIndex((f) => f.name === field.name);
        const initial =
          getEditorKind(field.type) === "checkbox"
            ? String(Boolean(row.data[fieldIndex]))
            : toEditorRawValue(row.data[fieldIndex]);
        startEdit(activeCell.rowId, activeCell.columnKey, initial);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        setConfirmDeleteRowId(activeCell.rowId);
      }
    },
    [activeCell, editingCell, fieldsByName, fields, rows, startEdit],
  );

  const handleRefresh = useCallback(() => {
    const cursor = state?.cursorStack[state.cursorStack.length - 1];
    void dispatch(fetchDatasetRowsPage({ sourceId, cursor }));
    void dispatch(fetchDatasetSchemaThunk({ sourceId }));
    setBannerError(null);
  }, [dispatch, sourceId, state?.cursorStack]);

  const handlePrev = useCallback(() => {
    const stack = state?.cursorStack ?? [undefined];
    if (stack.length <= 1) return;
    const targetCursor = stack[stack.length - 2];
    // skeptic-final-2.md CR-D: "when Prev becomes disabled as a result of its own press, move
    // focus to the other pager button [Next] or to the grid's active cell".
    const willDisablePrev = stack.length - 1 <= 1;
    // skeptic-final-3.md now-required: `popCursorStack` used to fire BEFORE the fetch (the same
    // class of bug as `handleNext`'s push) -- the page label could decrement even though the
    // fetch that was supposed to back it up failed. Now popped only once the fetch succeeds.
    void dispatch(fetchDatasetRowsPage({ sourceId, cursor: targetCursor }))
      .unwrap()
      .then(() => {
        dispatch(popCursorStack({ sourceId }));
        // skeptic-final-4.md non-blocking note: a stale error banner from an EARLIER failed
        // page fetch must not linger once a later one succeeds.
        setBannerError(null);
        if (willDisablePrev) {
          if (state?.nextCursor !== undefined) nextButtonRef.current?.focus();
          else focusActiveCell();
        }
      })
      .catch((rejected: { message?: string } | undefined) => {
        setBannerError(rejected?.message ?? "Failed to load the previous page.");
      });
  }, [dispatch, sourceId, state?.cursorStack, state?.nextCursor, focusActiveCell]);

  // Uses the CURRENT page's already-known `nextCursor` (set by the last `fetchDatasetRowsPage`)
  // directly, rather than re-fetching the page already on screen just to learn it again.
  const handleNext = useCallback(() => {
    const nextCursor = state?.nextCursor;
    if (nextCursor === undefined) return;
    // skeptic-final-3.md now-required: `pushCursorStack` used to fire BEFORE the fetch, so a
    // failed fetch (a 429 from the rate limiter, a dropped connection) left the "Page N" label
    // advanced while the OLD page's rows stayed on screen -- the counter and the actual rendered
    // page disagreed. Now pushed only once the fetch has actually succeeded.
    void dispatch(fetchDatasetRowsPage({ sourceId, cursor: nextCursor }))
      .unwrap()
      .then((result) => {
        dispatch(pushCursorStack({ sourceId, cursor: nextCursor }));
        // skeptic-final-4.md non-blocking note: a stale error banner from an EARLIER failed
        // page fetch must not linger once a later one succeeds.
        setBannerError(null);
        // skeptic-final-2.md CR-D: Next itself only becomes disabled once the NEW page's own
        // `nextCursor` is known -- unlike Prev's page-1 boundary, this isn't knowable until the
        // fetch resolves, so the focus decision is made here rather than synchronously above.
        // Deferred: the `pushCursorStack` dispatch just above still needs a React re-render
        // (batched, asynchronous) before Prev's `disabled` attribute actually clears in the DOM
        // -- calling `.focus()` on a still-disabled button synchronously here would silently
        // no-op. `requestAnimationFrame` runs after that commit.
        if (result.page.nextCursor === undefined) {
          requestAnimationFrame(() => prevButtonRef.current?.focus());
        }
      })
      .catch((rejected: { message?: string } | undefined) => {
        // skeptic-final-3.md now-required: this `.catch` was missing entirely, producing an
        // uncaught promise rejection on any fetch failure (observed live under real rate-limit
        // pressure) -- the page label correctly stays put now that the push above never ran.
        setBannerError(rejected?.message ?? "Failed to load the next page.");
      });
  }, [dispatch, sourceId, state?.nextCursor]);

  const handleDeleteConfirmed = useCallback(
    (rowId: string) => {
      const row = rows.find((r) => r.id === rowId);
      setConfirmDeleteRowId(null);
      if (!row) {
        focusActiveCell();
        return;
      }
      dispatch(deleteDatasetRow({ sourceId, rowId, updatedAt: row.updatedAt }))
        .unwrap()
        .catch((rejected: RowMutationRejection | undefined) => {
          if (rejected?.notFound) {
            dispatch(markRowDeleted({ sourceId, rowId, action: "delete" }));
          } else if (rejected?.conflict) {
            void dispatch(refetchConflict({ sourceId, rowId, action: "delete" }));
          } else if (rejected) {
            setBannerError(rejected.message);
          }
        })
        // skeptic-final-2.md CR-D: "after a delete is confirmed" -- regardless of outcome
        // (success, conflict, 404, or a genuine error), focus never stays on the now-unmounted
        // ConfirmInline.
        .finally(focusActiveCell);
    },
    [dispatch, sourceId, rows, focusActiveCell],
  );

  const handleDeleteCancelled = useCallback(() => {
    setConfirmDeleteRowId(null);
    focusActiveCell();
  }, [focusActiveCell]);

  // skeptic-final-1.md CR4: Retry re-applies ONLY the user's originally-edited cell on top of
  // the freshly re-fetched `conflict.current` row (design.md Decision 3) -- never the user's full
  // stale row, so a retry can never silently clobber a different cell someone else changed in the
  // same row. A second 409 (someone edited again in the meantime) re-enters this same flow.
  const handleRetryConflict = useCallback(
    (conflict: DatasetRowConflict) => {
      if (!conflict.current || conflict.editedFieldIndex === undefined) return;
      const nextData = conflict.current.data.slice();
      nextData[conflict.editedFieldIndex] = conflict.editedValue;
      dispatch(
        patchDatasetRow({
          sourceId,
          rowId: conflict.rowId,
          updatedAt: conflict.current.updatedAt,
          data: nextData,
        }),
      )
        .unwrap()
        .catch((rejected: RowMutationRejection | undefined) => {
          if (!rejected) return;
          if (rejected.notFound) {
            dispatch(markRowDeleted({ sourceId, rowId: conflict.rowId, action: "edit" }));
          } else if (rejected.conflict) {
            void dispatch(
              refetchConflict({
                sourceId,
                rowId: conflict.rowId,
                action: "edit",
                editedFieldIndex: conflict.editedFieldIndex,
                editedValue: conflict.editedValue,
              }),
            );
          } else {
            setBannerError(rejected.message);
          }
        })
        // skeptic-final-2.md CR-D: "after conflict retry" -- the banner unmounts once the
        // conflict clears (success) or stays/changes shape (a new conflict) either way focus
        // must not be left on the now-gone Retry button.
        .finally(focusActiveCell);
    },
    [dispatch, sourceId, focusActiveCell],
  );

  const handleDiscardConflict = useCallback(
    (rowId: string) => {
      dispatch(clearConflict({ sourceId, rowId }));
      // skeptic-final-2.md CR-D: "after conflict discard" -- the banner unmounts synchronously.
      focusActiveCell();
    },
    [dispatch, sourceId, focusActiveCell],
  );

  // "Delete anyway" for a delete-path conflict where the row still exists (re-fetched into
  // `conflict.current`) -- retries the delete with the FRESH `updatedAt` as the new precondition.
  const handleDeleteAnyway = useCallback(
    (rowId: string, updatedAt: string) => {
      dispatch(deleteDatasetRow({ sourceId, rowId, updatedAt }))
        .unwrap()
        .catch((rejected: RowMutationRejection | undefined) => {
          if (rejected?.notFound) {
            dispatch(markRowDeleted({ sourceId, rowId, action: "delete" }));
          } else if (rejected?.conflict) {
            void dispatch(refetchConflict({ sourceId, rowId, action: "delete" }));
          } else if (rejected) {
            setBannerError(rejected.message);
          }
        })
        .finally(focusActiveCell);
    },
    [dispatch, sourceId, focusActiveCell],
  );

  // skeptic-final-2.md CR-B: opens the draft form, seeded from each field's declared default (or
  // "" for a field with none) -- the SAME raw-editor-string convention `editValue` uses for
  // in-grid cell editing.
  const handleAddRowClick = useCallback(() => {
    // skeptic-final-4.md CR-J: the "Add row" button below now uses `aria-disabled`, not the
    // native `disabled` attribute (see that button's own comment for why) -- this guard is what
    // actually prevents re-opening/resetting an already-open or in-flight draft, since
    // `aria-disabled` alone does not stop a click.
    if (!schema || isAddingRow || isAddRowSubmitting) return;
    const initial: Record<string, string> = {};
    schema.fields.forEach((f) => {
      initial[f.name] = f.default !== undefined && f.default !== null ? String(f.default) : "";
    });
    setDraftValues(initial);
    setDraftErrors({});
    setIsAddingRow(true);
  }, [schema, isAddingRow, isAddRowSubmitting]);

  const handleAddRowCancel = useCallback(() => {
    setIsAddingRow(false);
    setDraftValues({});
    setDraftErrors({});
    focusActiveCell();
  }, [focusActiveCell]);

  // skeptic-final-2.md CR-B: validates every field client-side BEFORE submission -- a required
  // field with no usable default (design.md Decision 3a/4.3b: a literal `default: null` counts
  // as "no usable default") blocks submission with a per-field error instead of posting `null`
  // and letting the server 400. Fields with a real default, or non-required fields, submit
  // `null` when left blank -- same "empty means JSON null, never `\"\"`" rule cell editing uses.
  const handleAddRowSave = useCallback(() => {
    if (!schema || isAddRowSubmitting) return; // guards the double-submit `aria-disabled` alone can't prevent.
    const errors: Record<string, string> = {};
    const data: unknown[] = schema.fields.map((field) => {
      const kind = getEditorKind(field.type);
      const raw = draftValues[field.name] ?? "";
      if (kind === "readonly") return null; // BinaryRefType is never editable (design.md D6).
      if (isEmptyEditorValue(kind, raw)) {
        if (!canEmptyField(field)) {
          errors[field.name] = `${field.name} is required and has no default.`;
          return null;
        }
        return null;
      }
      const serialized = serializeEditorValue(kind, raw);
      if (serialized === undefined) {
        errors[field.name] = `${field.name} must be a valid ${field.type}.`;
        return null;
      }
      return serialized;
    });

    if (Object.keys(errors).length > 0) {
      setDraftErrors(errors);
      return;
    }
    setDraftErrors({});
    setIsAddRowSubmitting(true);
    dispatch(appendDatasetRow({ sourceId, data }))
      .unwrap()
      .then(() => {
        setIsAddingRow(false);
        setDraftValues({});
        // skeptic-final-3.md CR-H: the form unmounts on success -- return focus to a deliberate
        // target (the "Add row" button that reopens it) rather than leaving it nowhere.
        requestAnimationFrame(() => addRowButtonRef.current?.focus());
      })
      .catch((rejected: { message: string } | undefined) => {
        if (!rejected) return;
        // Mirrors `submitPatch`'s Decision 3a parsing -- a per-field 400 attaches to that
        // field's draft input; an unparseable/row-length message falls back to the banner.
        const parsed = parseDatasetRowValidationError(rejected.message);
        const attached = parsed.filter((p) => p.fieldName !== null);
        if (attached.length > 0) {
          const next: Record<string, string> = {};
          attached.forEach((p) => {
            next[p.fieldName as string] = p.message;
          });
          setDraftErrors(next);
          // skeptic-final-3.md CR-H: on a server-side 400, keep focus IN the form, on the first
          // field with an error -- the form stays open (nothing unmounts here), so this is a
          // deliberate re-focus rather than a fight against a real navigation.
          const firstField = attached[0].fieldName;
          requestAnimationFrame(() =>
            document.getElementById(`dataset-row-grid__draft-${firstField}`)?.focus(),
          );
        } else {
          setBannerError(rejected.message);
        }
      })
      .finally(() => setIsAddRowSubmitting(false));
  }, [dispatch, sourceId, schema, draftValues, isAddRowSubmitting]);

  // HEL-1080 skeptic-final-1.md CR3: the FULL-unmount early return here used to fire on EVERY
  // `rowsStatus === "loading"` — including a Refresh/Prev/Next-triggered refetch of a page that
  // already has rows on screen — which destroyed the toolbar and grid DOM (the very button just
  // pressed included) and dropped focus to `<body>`. Now only gates the true initial load (no
  // rows yet); a refetch of an already-populated page keeps the whole tree mounted (old rows stay
  // visible, and — since `DataGrid`'s body rows are keyed by array INDEX, not row id — the same
  // `<td>` DOM nodes are reused across the refetch, which is what lets focus survive a Refresh or
  // a Prev/Next page change without any extra code here).
  if (!schema || (rows.length === 0 && state?.rowsStatus === "loading")) {
    return <p className="dataset-row-grid__loading">Loading…</p>;
  }

  return (
    <div className="dataset-row-grid">
      {/* skeptic-final-2.md CR-E: ONE banner per error -- `bannerError` (component state) is now
          the sole render path. Every mutation-failure catch handler sets it locally; the slice's
          own `state.error` still exists (other callers/future consumers may read it) but is
          deliberately not ALSO rendered here, which is what produced the duplicate. */}
      <InlineError error={bannerError} variant="banner" kind="error" onRetry={handleRefresh} />
      <div className="dataset-row-grid__toolbar">
        {/* skeptic-final-4.md CR-J: `aria-disabled`, NOT the native `disabled` attribute --
            code elsewhere (`handleAddRowSave`'s success path) `.focus()`s THIS button once the
            form has closed. A native `disabled` button silently REFUSES focus for as long as the
            attribute is set, and `isAddRowSubmitting` only clears in a `.finally` that runs after
            the `.then()`'s `requestAnimationFrame`-deferred focus call -- under any real network
            latency (reproduced 6/6 at 300-800ms) the button was still natively disabled at the
            moment `.focus()` ran, so it silently no-op'd. `handleAddRowClick`'s own guard (not
            this attribute) is what actually prevents re-opening/resetting an in-flight draft. */}
        <button
          ref={addRowButtonRef}
          type="button"
          onClick={handleAddRowClick}
          aria-disabled={isAddingRow || isAddRowSubmitting}
        >
          Add row
        </button>
        <button type="button" onClick={handleRefresh}>
          Refresh
        </button>
        <div className="dataset-row-grid__pager">
          <button
            ref={prevButtonRef}
            type="button"
            onClick={handlePrev}
            disabled={currentPage <= 1}
          >
            Prev
          </button>
          <span>Page {currentPage}</span>
          <button
            ref={nextButtonRef}
            type="button"
            onClick={handleNext}
            disabled={state?.nextCursor === undefined}
          >
            Next
          </button>
        </div>
      </div>
      {isAddingRow && schema && (
        // skeptic-final-2.md CR-B: an inline draft-row form, NOT part of the ARIA grid (a plain
        // form, ordinary Tab order) -- filled in and validated BEFORE `appendDatasetRow` ever
        // fires, so a required-no-default field never gets an all-`null` POST the server 400s.
        <div
          ref={draftContainerRef}
          className="dataset-row-grid__draft"
          role="group"
          aria-label="New row"
        >
          {schema.fields.map((field) => {
            const kind = getEditorKind(field.type);
            if (kind === "readonly") return null; // BinaryRefType: never editable (design.md D6).
            const inputId = `dataset-row-grid__draft-${field.name}`;
            const error = draftErrors[field.name];
            const value = draftValues[field.name] ?? "";
            return (
              <div key={field.name} className="dataset-row-grid__draft-field">
                <label htmlFor={inputId}>
                  {field.name}
                  {field.required && !canEmptyField(field) ? " *" : ""}
                </label>
                {kind === "checkbox" ? (
                  <input
                    id={inputId}
                    type="checkbox"
                    className="dataset-row-grid__draft-checkbox"
                    checked={value === "true"}
                    onChange={(e) =>
                      setDraftValues((prev) => ({
                        ...prev,
                        [field.name]: String(e.target.checked),
                      }))
                    }
                  />
                ) : kind === "textarea" ? (
                  <textarea
                    id={inputId}
                    className="dataset-row-grid__editor"
                    value={value}
                    onChange={(e) =>
                      setDraftValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                    }
                  />
                ) : (
                  <input
                    id={inputId}
                    type={
                      kind === "number" ? "number" : kind === "datetime" ? "datetime-local" : "text"
                    }
                    className="dataset-row-grid__editor"
                    value={value}
                    onChange={(e) =>
                      setDraftValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                    }
                  />
                )}
                {error && (
                  <span role="alert" aria-live="assertive" className="dataset-row-grid__cell-error">
                    {error}
                  </span>
                )}
              </div>
            );
          })}
          <div className="dataset-row-grid__draft-actions">
            {/* skeptic-final-3.md CR-H: `aria-disabled`, NOT the native `disabled` attribute --
                a native `disabled` button loses real DOM focus the instant it's set (the browser
                blurs it unconditionally), which is exactly how "Enter on Save row" used to drop
                focus to `<body>` mid-submission. `handleAddRowSave`'s own `isAddRowSubmitting`
                guard is what actually prevents a double-submit; this only communicates the state
                to assistive tech without ever forcing a blur. */}
            <button
              type="button"
              className="dataset-row-grid__btn--secondary"
              onClick={handleAddRowSave}
              aria-disabled={isAddRowSubmitting}
            >
              {isAddRowSubmitting ? "Saving…" : "Save row"}
            </button>
            <button
              type="button"
              className="dataset-row-grid__btn--secondary"
              onClick={handleAddRowCancel}
              disabled={isAddRowSubmitting}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {confirmDeleteRowId && (
        <div ref={confirmContainerRef}>
          <ConfirmInline
            label="Delete this row?"
            onConfirm={() => handleDeleteConfirmed(confirmDeleteRowId)}
            onCancel={handleDeleteCancelled}
          />
        </div>
      )}
      {Object.values(state?.conflicts ?? {}).map((conflict) => (
        <div key={conflict.rowId} className="dataset-row-grid__conflict" role="alert">
          {conflict.deleted ? (
            <>
              <p>This row was already deleted by someone else.</p>
              {/* skeptic-final-1.md CR5: this used to dispatch `popCursorStack`, which corrupts
                  the pager's page stack instead of dismissing the conflict banner. */}
              <button
                type="button"
                className="dataset-row-grid__btn--secondary"
                onClick={() => handleDiscardConflict(conflict.rowId)}
              >
                Discard
              </button>
            </>
          ) : (
            <>
              <p>This row was changed concurrently. Current values:</p>
              <ul className="dataset-row-grid__conflict-values">
                {fields.map((field, i) => (
                  <li key={field.name}>
                    <strong>{field.name}:</strong>{" "}
                    {conflict.current?.data[i] == null ? "—" : String(conflict.current.data[i])}
                  </li>
                ))}
              </ul>
              {conflict.action === "edit" && conflict.current && (
                <>
                  <button
                    type="button"
                    className="dataset-row-grid__btn--secondary"
                    onClick={() => handleRetryConflict(conflict)}
                  >
                    Retry (reapply my edit)
                  </button>
                  <button
                    type="button"
                    className="dataset-row-grid__btn--secondary"
                    onClick={() => handleDiscardConflict(conflict.rowId)}
                  >
                    Discard
                  </button>
                </>
              )}
              {conflict.action === "delete" && conflict.current && (
                <>
                  <button
                    type="button"
                    className="dataset-row-grid__btn--danger"
                    onClick={() => handleDeleteAnyway(conflict.rowId, conflict.current!.updatedAt)}
                  >
                    Delete anyway
                  </button>
                  <button
                    type="button"
                    className="dataset-row-grid__btn--secondary"
                    onClick={() => handleDiscardConflict(conflict.rowId)}
                  >
                    Discard
                  </button>
                </>
              )}
            </>
          )}
        </div>
      ))}
      <div ref={gridContainerRef} onKeyDownCapture={handleGridKeyDown}>
        <DataGrid
          variant="preview"
          rows={gridRows}
          columns={columns}
          gridMode
          rowId={(row) => row[ROW_ID_KEY] as string}
          activeCell={activeCell}
          onActiveCellChange={handleActiveCellChange}
          emptyText="This dataset has no rows yet."
        />
      </div>
    </div>
  );
}
