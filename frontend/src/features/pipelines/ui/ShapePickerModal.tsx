// ShapePickerModal — "Start from a shape" flow (HEL-402). Two steps in one
// dialog: pick a shape from the live `GET /api/pipeline-shapes` catalog, then
// fill a generic params form driven by that shape's `paramsSchema` (design.md
// Decision 5 — one widget per `dataType`, no per-shape hardcoding), rendered
// by the shared `ShapeParamsFields` (HEL-399 design.md Decision 6 extraction).
// Submitting calls `POST /api/pipeline-shapes/:id/expand`; a non-2xx response
// is shown inline and the modal stays open (never silently swallowed — the
// direct design-against for the HEL-336 lookup-picker defect). On a 200, the
// expansions are handed to the caller-supplied `onSeedSteps`, which owns the
// sequential per-step `createPipelineStep` loop and its own mid-loop failure
// toast (design.md Decision 6) — this component closes only after that
// resolves.

import { useEffect, useState, type FormEvent } from "react";
import { isAxiosError } from "axios";

import { Modal } from "../../../shared/ui/Modal";
import { InlineError } from "../../../shared/chrome/InlineError";
import { getPipelineShapeCatalog, expandPipelineShape } from "../services/pipelineService";
import { buildShapeParams, ShapeParamsFields } from "./ShapeParamsFields";
import type { PipelineShapeCatalogEntry, ShapeStepExpansion } from "../types/pipelineShape";

import "./ShapePickerModal.css";

interface ShapePickerModalProps {
  onClose: () => void;
  /** Performs the sequential `createPipelineStep` loop for the expanded steps
   *  (owned by the caller — `PipelineDetailPage.handleInstantiateShape` —
   *  since it already holds the pipeline id and local step state). Resolves
   *  once the loop finishes (fully or partially, see design.md Decision 6). */
  onSeedSteps: (expansions: ShapeStepExpansion[]) => Promise<void>;
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err) && typeof err.response?.data?.message === "string") {
    return err.response.data.message;
  }
  return fallback;
}

// F-229: sort the catalog by usefulness rather than backend registry order — most-generally-useful
// shapes first. Any id not in this list (a future shape the frontend hasn't been updated for yet)
// sorts after all of these, in whatever order the backend returned it.
const SHAPE_DISPLAY_ORDER = ["time-series", "top-n", "single-row", "pivot-matrix", "passthrough"];

function byShapeUsefulness(a: PipelineShapeCatalogEntry, b: PipelineShapeCatalogEntry): number {
  const aIndex = SHAPE_DISPLAY_ORDER.indexOf(a.id);
  const bIndex = SHAPE_DISPLAY_ORDER.indexOf(b.id);
  return (
    (aIndex === -1 ? SHAPE_DISPLAY_ORDER.length : aIndex) -
    (bIndex === -1 ? SHAPE_DISPLAY_ORDER.length : bIndex)
  );
}

export function ShapePickerModal({ onClose, onSeedSteps }: ShapePickerModalProps) {
  const [catalog, setCatalog] = useState<PipelineShapeCatalogEntry[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedShape, setSelectedShape] = useState<PipelineShapeCatalogEntry | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPipelineShapeCatalog()
      .then((entries) => {
        if (!cancelled) setCatalog([...entries].sort(byShapeUsefulness));
      })
      .catch((err: unknown) => {
        if (!cancelled) setCatalogError(extractErrorMessage(err, "Failed to load shape catalog."));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function selectShape(shape: PipelineShapeCatalogEntry) {
    setSelectedShape(shape);
    setParamValues({});
    setFormError(null);
  }

  function goBack() {
    setSelectedShape(null);
    setFormError(null);
  }

  function setParam(name: string, value: string) {
    setParamValues((prev) => ({ ...prev, [name]: value }));
  }

  const canSubmit =
    selectedShape !== null &&
    selectedShape.paramsSchema
      .filter((p) => p.required)
      .every((p) => (paramValues[p.name] ?? "").trim() !== "");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedShape || isSubmitting) return;

    // Client-side JSON-parse for object[] fields — a parse failure is an
    // inline error that blocks the request entirely (spec: "does not call
    // the endpoint").
    const built = buildShapeParams(selectedShape.paramsSchema, paramValues);
    if ("fieldError" in built) {
      setFormError(built.fieldError);
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    try {
      const expansions = await expandPipelineShape(selectedShape.id, built.params);
      // Expand succeeded — hand off to the caller's step-create loop, then
      // close regardless of whether that loop fully or partially succeeds
      // (design.md Decision 6: the loop's own toast reports partial failure).
      await onSeedSteps(expansions);
      onClose();
    } catch (err: unknown) {
      // Non-2xx from /expand (422 invalid params, 404 unknown shape id) is
      // shown inline; the modal stays open and no steps are created — the
      // HEL-336 defect guard this ticket exists to close.
      setFormError(extractErrorMessage(err, "Failed to expand shape."));
    } finally {
      setIsSubmitting(false);
    }
  }

  const title = selectedShape
    ? `Start from a shape — ${selectedShape.label}`
    : "Start from a shape";
  // F-158 — "shape" is internal jargon (defined only in backend code and
  // memory notes); clarify it in-context the first time it appears rather
  // than assuming the reader already knows the term. Only shown on the list
  // step — once a shape is picked, the title already names it specifically.
  const description = selectedShape
    ? undefined
    : "A ready-made pipeline template you fill in and run.";

  const footer = selectedShape ? (
    <>
      <button
        type="button"
        className="ui-modal-btn ui-modal-btn--secondary"
        onClick={goBack}
        disabled={isSubmitting}
      >
        Back
      </button>
      <button
        type="submit"
        form="shape-picker-params-form"
        className="ui-modal-btn ui-modal-btn--primary"
        disabled={!canSubmit || isSubmitting}
      >
        {isSubmitting ? "Adding steps…" : "Add steps"}
      </button>
    </>
  ) : (
    <button type="button" className="ui-modal-btn ui-modal-btn--secondary" onClick={onClose}>
      Cancel
    </button>
  );

  return (
    <Modal
      open
      title={title}
      description={description}
      size="sm"
      ariaLabel="Start from a shape"
      onClose={onClose}
      footer={footer}
    >
      {selectedShape === null ? (
        <div className="shape-picker-modal__list">
          {catalogError && <InlineError error={catalogError} />}
          {!catalogError && catalog === null && (
            <p className="shape-picker-modal__loading">Loading shapes…</p>
          )}
          {catalog?.map((shape) => (
            <button
              key={shape.id}
              type="button"
              className="shape-picker-modal__shape-card"
              onClick={() => selectShape(shape)}
            >
              <span className="shape-picker-modal__shape-label">{shape.label}</span>
              <span className="shape-picker-modal__shape-desc">{shape.description}</span>
            </button>
          ))}
        </div>
      ) : (
        <form
          id="shape-picker-params-form"
          className="shape-picker-modal__form"
          onSubmit={(e) => void handleSubmit(e)}
        >
          <ShapeParamsFields
            paramsSchema={selectedShape.paramsSchema}
            values={paramValues}
            onChange={setParam}
            idPrefix="shape-param"
          />

          <InlineError error={formError} />
        </form>
      )}
    </Modal>
  );
}
