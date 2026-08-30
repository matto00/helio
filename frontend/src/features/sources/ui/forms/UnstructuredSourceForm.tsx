// Shared base for the unstructured-source forms (Text/PDF/Image — HEL-720).
// TextSourceForm.tsx, PdfSourceForm.tsx, and ImageSourceForm.tsx are
// structurally identical (ingestion-method toggle, file input, URL input,
// error, actions) and differ only in labels, the `accept` filter, id/aria
// strings, and the URL placeholder. This component owns that shared
// structure; each source-type file supplies a small config object and
// re-exports its own prop-type/mode-type names for call-site compatibility.

import { type ChangeEvent, type FormEvent, useState } from "react";

import { InlineError } from "../../../../shared/chrome/InlineError";
import { TextField } from "../../../../shared/ui/index";

export type UnstructuredIngestMode = "upload" | "url";

export interface UnstructuredSourceFormConfig {
  idPrefix: string;
  groupAriaLabel: string;
  fileLabel: string;
  accept: string;
  urlPlaceholder: string;
}

export interface UnstructuredSourceFormProps {
  onSubmit: (mode: UnstructuredIngestMode, file: File | null, url: string) => void;
  isLoading: boolean;
  error: string | null;
  onCancel: () => void;
  config: UnstructuredSourceFormConfig;
}

export function UnstructuredSourceForm({
  onSubmit,
  isLoading,
  error,
  onCancel,
  config,
}: UnstructuredSourceFormProps) {
  const [mode, setMode] = useState<UnstructuredIngestMode>("upload");
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
          aria-label={config.groupAriaLabel}
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
          <label className="add-source-modal__label" htmlFor={`${config.idPrefix}-file`}>
            {config.fileLabel}
          </label>
          <input
            id={`${config.idPrefix}-file`}
            type="file"
            className="add-source-modal__input"
            accept={config.accept}
            onChange={handleFileChange}
          />
        </div>
      ) : (
        <div className="add-source-modal__field">
          <label className="add-source-modal__label" htmlFor={`${config.idPrefix}-url`}>
            URL
          </label>
          <TextField
            id={`${config.idPrefix}-url`}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={config.urlPlaceholder}
            aria-label="URL"
          />
        </div>
      )}

      <InlineError error={error} />

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
