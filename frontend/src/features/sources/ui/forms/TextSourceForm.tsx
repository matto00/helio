// Text/Markdown source configuration fields (HEL-215) — supports both a
// file-picker sub-mode and a URL-entry sub-mode, mirroring CsvForm.tsx /
// RestApiForm.tsx respectively. Self-contained submit like StaticSourceForm /
// SqlTab since text sources have a fixed schema ({content, filename,
// sizeBytes}) and skip the configure -> preview schema-inference step.
//
// Thin wrapper around the shared UnstructuredSourceForm (HEL-720) — supplies
// this source type's config; the toggle/file/URL/error/actions structure
// lives in UnstructuredSourceForm.tsx.

import {
  type UnstructuredSourceFormConfig,
  UnstructuredSourceForm,
} from "./UnstructuredSourceForm";

export type TextIngestMode = "upload" | "url";

export interface TextSourceFormProps {
  onSubmit: (mode: TextIngestMode, file: File | null, url: string) => void;
  isLoading: boolean;
  error: string | null;
  onCancel: () => void;
}

const TEXT_CONFIG: UnstructuredSourceFormConfig = {
  idPrefix: "source-text",
  groupAriaLabel: "Text ingestion method",
  fileLabel: "Text/Markdown file",
  accept: ".txt,.md,text/plain,text/markdown",
  urlPlaceholder: "https://example.com/notes.md",
};

export function TextSourceForm({ onSubmit, isLoading, error, onCancel }: TextSourceFormProps) {
  return (
    <UnstructuredSourceForm
      onSubmit={onSubmit}
      isLoading={isLoading}
      error={error}
      onCancel={onCancel}
      config={TEXT_CONFIG}
    />
  );
}
