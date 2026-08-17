import { Modal } from "../../../shared/ui/Modal";
import { InlineError } from "../../../shared/chrome/InlineError";
import type { EditPreview, PatchSetPreviewResponse } from "../types/patchSet";
import "./PatchSetReview.css";

interface PatchSetReviewProps {
  preview: PatchSetPreviewResponse;
  applying: boolean;
  error?: string | null;
  /** Called on accept — the caller applies the SAME patch set that was
   *  previewed (HEL-406's existing apply endpoint). Nothing is written
   *  until this fires. */
  onAccept: () => void;
  /** Called on reject / close — nothing is written. */
  onReject: () => void;
}

function jsonBlock(value: Record<string, unknown> | null | undefined): string {
  if (value == null) return "—";
  return JSON.stringify(value, null, 2);
}

interface ChangedField {
  key: string;
  before: unknown;
  after: unknown;
}

/** F-067 — the shallow set of top-level keys whose value actually differs between `before` and
 *  `after` (by value, not reference — `JSON.stringify` comparison), including keys present on only
 *  one side. This is what makes the changed field(s) findable without scrolling past unrelated,
 *  unchanged JSON (design.md D7 still rules out a full per-kind diff widget — this is a flat,
 *  leaves-only diff, not a structural one). */
function changedFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): ChangedField[] {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: ChangedField[] = [];
  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changed.push({ key, before: before[key], after: after[key] });
    }
  }
  return changed;
}

function formatFieldValue(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** Patch Set Review UI (HEL-408) — the mutation analogue of `ProposalReview`.
 *  Lists each edit's kind/op/impact plus its raw before/after JSON
 *  (design.md D7 — no bespoke per-kind diff widget; a true per-kind visual
 *  diff across six resource kinds is separate UI scope). Nothing is written
 *  until Accept, which the caller wires to the patch-set apply endpoint. */
export function PatchSetReview({
  preview,
  applying,
  error,
  onAccept,
  onReject,
}: PatchSetReviewProps) {
  const edits = preview.edits;

  const footer = (
    <>
      <button
        type="button"
        className="ui-modal-btn ui-modal-btn--secondary"
        onClick={onReject}
        disabled={applying}
      >
        Reject
      </button>
      <button
        type="button"
        className="ui-modal-btn ui-modal-btn--primary"
        onClick={onAccept}
        disabled={applying || edits.length === 0}
      >
        {applying ? "Applying…" : "Accept & apply"}
      </button>
    </>
  );

  return (
    <Modal
      open
      onClose={onReject}
      size="lg"
      title="Review patch set"
      description="Nothing is applied until you accept."
      footer={footer}
      className="patch-set-review"
    >
      <div className="patch-set-review__body">
        <p className="eyebrow patch-set-review__section-label">
          {edits.length} edit{edits.length === 1 ? "" : "s"}
        </p>
        {edits.length === 0 ? (
          <p className="patch-set-review__empty">This patch set has no edits.</p>
        ) : (
          <ul className="patch-set-review__edits">
            {edits.map((edit) => (
              <PatchSetEditRow key={edit.index} edit={edit} />
            ))}
          </ul>
        )}

        <InlineError error={error} />
      </div>
    </Modal>
  );
}

function PatchSetEditRow({ edit }: { edit: EditPreview }) {
  // F-067 — an `update` edit's `before`/`after` are the FULL existing/resulting resource state
  // (design.md D7), most of which is unrelated to what the edit actually changed; a "rename" edit
  // could bury its one changed field below a screen of untouched JSON. `create`/`delete` edits have
  // nothing to diff against (one side is entirely absent), so they keep the raw before/after panes.
  const changed = edit.op === "update" ? changedFields(edit.before, edit.after) : [];
  const showChangedFields = changed.length > 0;

  return (
    <li className="patch-set-review__edit">
      <div className="patch-set-review__edit-head">
        <span className="patch-set-review__kind">{edit.kind}</span>
        <span className="patch-set-review__op">{edit.op}</span>
      </div>

      {edit.impact.length > 0 && (
        <ul className="patch-set-review__impact" aria-label={`Impact for edit ${edit.index + 1}`}>
          {edit.impact.map((hint, i) => (
            <li key={i} className="patch-set-review__impact-item" role="status">
              {hint}
            </li>
          ))}
        </ul>
      )}

      {showChangedFields ? (
        <dl
          className="patch-set-review__changes"
          aria-label={`Changed fields for edit ${edit.index + 1}`}
        >
          {changed.map(({ key, before, after }) => (
            <div key={key} className="patch-set-review__change-row">
              <dt className="patch-set-review__change-key mono">{key}</dt>
              <dd className="patch-set-review__change-values">
                <span className="patch-set-review__change-before mono">
                  {formatFieldValue(before)}
                </span>
                <span className="patch-set-review__change-arrow" aria-hidden="true">
                  →
                </span>
                <span className="patch-set-review__change-after mono">
                  {formatFieldValue(after)}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="patch-set-review__diff">
          <div className="patch-set-review__diff-col">
            <p className="patch-set-review__diff-label">Before</p>
            <pre className="patch-set-review__json mono">{jsonBlock(edit.before)}</pre>
          </div>
          <div className="patch-set-review__diff-col">
            <p className="patch-set-review__diff-label">After</p>
            <pre className="patch-set-review__json mono">{jsonBlock(edit.after)}</pre>
          </div>
        </div>
      )}
    </li>
  );
}
