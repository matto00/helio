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
    </li>
  );
}
