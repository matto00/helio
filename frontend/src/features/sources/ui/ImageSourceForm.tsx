// Image source configuration fields (HEL-216) — supports both a file-picker
// sub-mode and a URL-entry sub-mode, mirroring TextSourceForm.tsx. Self-
// contained submit since image sources have a fixed schema ({content,
// filename, sizeBytes, mimeType, width, height}) and skip the configure ->
// preview schema-inference step.

import { type ChangeEvent, type FormEvent, useState } from "react";

import { TextField } from "../../../shared/ui/index";

export type ImageIngestMode = "upload" | "url";

export interface ImageSourceFormProps {
  onSubmit: (mode: ImageIngestMode, file: File | null, url: string) => void;
  isLoading: boolean;
  error: string | null;
  onCancel: () => void;
}

export function ImageSourceForm({ onSubmit, isLoading, error, onCancel }: ImageSourceFormProps) {
  const [mode, setMode] = useState<ImageIngestMode>("upload");
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
          aria-label="Image ingestion method"
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
          <label className="add-source-modal__label" htmlFor="source-image-file">
            Image file
          </label>
          <input
            id="source-image-file"
            type="file"
            className="add-source-modal__input"
            accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,image/*"
            onChange={handleFileChange}
          />
        </div>
      ) : (
        <div className="add-source-modal__field">
          <label className="add-source-modal__label" htmlFor="source-image-url">
            URL
          </label>
          <TextField
            id="source-image-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/photo.png"
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
