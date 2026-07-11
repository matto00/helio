// PDF source configuration fields (HEL-214) — supports both a file-picker
// sub-mode and a URL-entry sub-mode, mirroring TextSourceForm.tsx. Self
// contained submit like StaticSourceForm/TextSourceForm since PDF sources
// have a fixed schema ({content, filename, sizeBytes, pageNumber, pageCount,
// characterCount}) and skip the configure -> preview schema-inference step.

import { type ChangeEvent, type FormEvent, useState } from "react";

import { TextField } from "../../../shared/ui/index";

export type PdfIngestMode = "upload" | "url";

export interface PdfSourceFormProps {
  onSubmit: (mode: PdfIngestMode, file: File | null, url: string) => void;
  isLoading: boolean;
  error: string | null;
  onCancel: () => void;
}

export function PdfSourceForm({ onSubmit, isLoading, error, onCancel }: PdfSourceFormProps) {
  const [mode, setMode] = useState<PdfIngestMode>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(mode, file, url);
  }

  return (
    <form className="add-source-modal__form" onSubmit={handleSubmit}>
      <div className="add-source-modal__field">
        <span className="add-source-modal__label">Ingestion method</span>
        <div
          className="add-source-modal__type-toggle"
          role="group"
          aria-label="PDF ingestion method"
        >
          <button
            type="button"
            className={
              mode === "upload"
                ? "add-source-modal__type-btn add-source-modal__type-btn--active"
                : "add-source-modal__type-btn"
            }
            onClick={() => setMode("upload")}
          >
            Upload file
          </button>
          <button
            type="button"
            className={
              mode === "url"
                ? "add-source-modal__type-btn add-source-modal__type-btn--active"
                : "add-source-modal__type-btn"
            }
            onClick={() => setMode("url")}
          >
            From URL
          </button>
        </div>
      </div>

      {mode === "upload" ? (
        <div className="add-source-modal__field">
          <label className="add-source-modal__label" htmlFor="source-pdf-file">
            PDF file
          </label>
          <input
            id="source-pdf-file"
            type="file"
            className="add-source-modal__input"
            accept=".pdf,application/pdf"
            onChange={handleFileChange}
          />
        </div>
      ) : (
        <div className="add-source-modal__field">
          <label className="add-source-modal__label" htmlFor="source-pdf-url">
            URL
          </label>
          <TextField
            id="source-pdf-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/report.pdf"
            aria-label="URL"
          />
        </div>
      )}

      {error && (
        <p className="add-source-modal__error" role="alert">
          {error}
        </p>
      )}

      <div className="add-source-modal__actions">
        <button
          type="button"
          className="add-source-modal__btn add-source-modal__btn--secondary"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="add-source-modal__btn add-source-modal__btn--primary"
          disabled={isLoading}
        >
          {isLoading ? "Creating…" : "Create source"}
        </button>
      </div>
    </form>
  );
}
