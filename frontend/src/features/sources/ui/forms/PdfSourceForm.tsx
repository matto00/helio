// PDF source configuration fields (HEL-214) — supports both a file-picker
// sub-mode and a URL-entry sub-mode, mirroring TextSourceForm.tsx. Self
// contained submit like StaticSourceForm/TextSourceForm since PDF sources
// have a fixed schema ({content, filename, sizeBytes, pageNumber, pageCount,
// characterCount}) and skip the configure -> preview schema-inference step.
//
// Thin wrapper around the shared UnstructuredSourceForm (HEL-720) — supplies
// this source type's config; the toggle/file/URL/error/actions structure
// lives in UnstructuredSourceForm.tsx.

import {
  type UnstructuredSourceFormConfig,
  UnstructuredSourceForm,
} from "./UnstructuredSourceForm";

export type PdfIngestMode = "upload" | "url";

export interface PdfSourceFormProps {
  onSubmit: (mode: PdfIngestMode, file: File | null, url: string) => void;
  isLoading: boolean;
  error: string | null;
  onCancel: () => void;
}

const PDF_CONFIG: UnstructuredSourceFormConfig = {
  idPrefix: "source-pdf",
  groupAriaLabel: "PDF ingestion method",
  fileLabel: "PDF file",
  accept: ".pdf,application/pdf",
  urlPlaceholder: "https://example.com/report.pdf",
};

export function PdfSourceForm({ onSubmit, isLoading, error, onCancel }: PdfSourceFormProps) {
  return (
    <UnstructuredSourceForm
      onSubmit={onSubmit}
      isLoading={isLoading}
      error={error}
      onCancel={onCancel}
      config={PDF_CONFIG}
    />
  );
}
