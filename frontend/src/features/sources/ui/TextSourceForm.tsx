// Text/Markdown source configuration fields (HEL-215) — supports both a
// file-picker sub-mode and a URL-entry sub-mode, mirroring CsvForm.tsx /
// RestApiForm.tsx respectively. Self-contained submit like StaticSourceForm /
// SqlTab since text sources have a fixed schema ({content, filename,
// sizeBytes}) and skip the configure -> preview schema-inference step.

import { type ChangeEvent, type FormEvent, useState } from "react";

import { TextField } from "../../../shared/ui/index";

export type TextIngestMode = "upload" | "url";

export interface TextSourceFormProps {
  onSubmit: (mode: TextIngestMode, file: File | null, url: string) => void;
  isLoading: boolean;
  error: string | null;
  onCancel: () => void;
}

export function TextSourceForm({ onSubmit, isLoading, error, onCancel }: TextSourceFormProps) {
  const [mode, setMode] = useState<TextIngestMode>("upload");
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
          aria-label="Text ingestion method"
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
          <label className="add-source-modal__label" htmlFor="source-text-file">
            Text/Markdown file
          </label>
          <input
            id="source-text-file"
            type="file"
            className="add-source-modal__input"
            accept=".txt,.md,text/plain,text/markdown"
            onChange={handleFileChange}
          />
        </div>
      ) : (
        <div className="add-source-modal__field">
          <label className="add-source-modal__label" htmlFor="source-text-url">
            URL
          </label>
          <TextField
            id="source-text-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/notes.md"
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
