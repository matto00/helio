// Image source configuration fields (HEL-216) — supports both a file-picker
// sub-mode and a URL-entry sub-mode, mirroring TextSourceForm.tsx. Self-
// contained submit since image sources have a fixed schema ({content,
// filename, sizeBytes, mimeType, width, height}) and skip the configure ->
// preview schema-inference step.
//
// Thin wrapper around the shared UnstructuredSourceForm (HEL-720) — supplies
// this source type's config; the toggle/file/URL/error/actions structure
// lives in UnstructuredSourceForm.tsx.

import {
  type UnstructuredSourceFormConfig,
  UnstructuredSourceForm,
} from "./UnstructuredSourceForm";

export type ImageIngestMode = "upload" | "url";

export interface ImageSourceFormProps {
  onSubmit: (mode: ImageIngestMode, file: File | null, url: string) => void;
  isLoading: boolean;
  error: string | null;
  onCancel: () => void;
}

const IMAGE_CONFIG: UnstructuredSourceFormConfig = {
  idPrefix: "source-image",
  groupAriaLabel: "Image ingestion method",
  fileLabel: "Image file",
  accept: ".png,.jpg,.jpeg,.gif,.webp,.bmp,image/*",
  urlPlaceholder: "https://example.com/photo.png",
};

export function ImageSourceForm({ onSubmit, isLoading, error, onCancel }: ImageSourceFormProps) {
  return (
    <UnstructuredSourceForm
      onSubmit={onSubmit}
      isLoading={isLoading}
      error={error}
      onCancel={onCancel}
      config={IMAGE_CONFIG}
    />
  );
}
