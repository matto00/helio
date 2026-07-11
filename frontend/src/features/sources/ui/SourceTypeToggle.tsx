// Source-type toggle row inside AddSourceModal — four buttons (REST API,
// CSV File, Manual, SQL Database) where one is marked active. Used by both
// the configure form and the static-source variant of the modal.
//
// Extracted from AddSourceModal.tsx in CS3 cycle 2 (behavior-preserving:
// markup and class names are unchanged from the inlined originals).

type SourceType = "rest_api" | "csv" | "static" | "sql" | "text" | "pdf" | "image";

interface SourceTypeToggleProps {
  active: SourceType;
  onChange: (next: SourceType) => void;
}

export function SourceTypeToggle({ active, onChange }: SourceTypeToggleProps) {
  return (
    <div className="add-source-modal__field">
      <span className="add-source-modal__label">Source type</span>
      <div className="add-source-modal__type-toggle" role="group" aria-label="Source type">
        <button
          type="button"
          className={
            active === "rest_api"
              ? "add-source-modal__type-btn add-source-modal__type-btn--active"
              : "add-source-modal__type-btn"
          }
          onClick={() => onChange("rest_api")}
        >
          REST API
        </button>
        <button
          type="button"
          className={
            active === "csv"
              ? "add-source-modal__type-btn add-source-modal__type-btn--active"
              : "add-source-modal__type-btn"
          }
          onClick={() => onChange("csv")}
        >
          CSV File
        </button>
        <button
          type="button"
          className={
            active === "static"
              ? "add-source-modal__type-btn add-source-modal__type-btn--active"
              : "add-source-modal__type-btn"
          }
          onClick={() => onChange("static")}
        >
          Manual
        </button>
        <button
          type="button"
          className={
            active === "sql"
              ? "add-source-modal__type-btn add-source-modal__type-btn--active"
              : "add-source-modal__type-btn"
          }
          onClick={() => onChange("sql")}
        >
          SQL Database
        </button>
        <button
          type="button"
          className={
            active === "text"
              ? "add-source-modal__type-btn add-source-modal__type-btn--active"
              : "add-source-modal__type-btn"
          }
          onClick={() => onChange("text")}
        >
          Text/Markdown
        </button>
        <button
          type="button"
          className={
            active === "pdf"
              ? "add-source-modal__type-btn add-source-modal__type-btn--active"
              : "add-source-modal__type-btn"
          }
          onClick={() => onChange("pdf")}
        >
          PDF
        </button>
        <button
          type="button"
          className={
            active === "image"
              ? "add-source-modal__type-btn add-source-modal__type-btn--active"
              : "add-source-modal__type-btn"
          }
          onClick={() => onChange("image")}
        >
          Image
        </button>
      </div>
    </div>
  );
}
