import { useRef, useState, type ChangeEvent, type FormEvent } from "react";

import "./AddSourceModal.css";
import { fetchDataTypes } from "../../dataTypes/state/dataTypesSlice";
import {
  createStaticSource,
  createSqlSource,
  fetchSources,
  setSelectedSourceId,
} from "../state/sourcesSlice";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { useToast } from "../../toasts/hooks/useToast";
import type { InferredField, StaticColumn } from "../types/dataSource";
import {
  createCsvSource,
  createImageSourceUpload,
  createImageSourceUrl,
  createRestSource,
  createTextSourceUpload,
  createTextSourceUrl,
  createPdfSourceUpload,
  createPdfSourceUrl,
  inferFromCsv,
  inferFromJson,
  type SqlSourceConfig,
} from "../services/dataSourceService";
import { CsvForm } from "./forms/CsvForm";
import { ImageSourceForm, type ImageIngestMode } from "./forms/ImageSourceForm";
import { InferredFieldsTable } from "./InferredFieldsTable";
import type { EditableField } from "./InferredFieldsTable";
import { PdfSourceForm, type PdfIngestMode } from "./forms/PdfSourceForm";
import { RestApiForm } from "./forms/RestApiForm";
import { SourceTypeToggle } from "./SourceTypeToggle";
import { StaticSourceForm } from "./forms/StaticSourceForm";
import { SqlTab } from "./forms/SqlTab";
import { TextSourceForm, type TextIngestMode } from "./forms/TextSourceForm";
import { InlineError } from "../../../shared/chrome/InlineError";
import { Modal } from "../../../shared/ui/Modal";
import { TextField } from "../../../shared/ui/TextField";
import { useRestSourceForm } from "../hooks/useRestSourceForm";

type SourceType = "rest_api" | "csv" | "static" | "sql" | "text" | "pdf" | "image";
type Step = "configure" | "preview";

interface AddSourceModalProps {
  onClose: () => void;
}

export function AddSourceModal({ onClose }: AddSourceModalProps) {
  const dispatch = useAppDispatch();
  const { push: pushToast } = useToast();

  const [step, setStep] = useState<Step>("configure");
  const [sourceType, setSourceType] = useState<SourceType>("rest_api");
  const [name, setName] = useState("");
  const restForm = useRestSourceForm();
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [fields, setFields] = useState<EditableField[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // F-052: only one of the per-source-type "Source name" fields below is ever
  // mounted at once (they're mutually exclusive on `sourceType`), so a single
  // ref/invalid pair can serve all of them.
  const [nameInvalid, setNameInvalid] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  function handleNameChange(event: ChangeEvent<HTMLInputElement>) {
    setName(event.target.value);
    if (nameInvalid) setNameInvalid(false);
  }

  function flagNameInvalid(message: string) {
    setError(message);
    setNameInvalid(true);
    nameInputRef.current?.focus();
  }

  // F-008: every create handler ends the same way once the source exists —
  // refetch the list, select the new source so it's not silently buried, and
  // toast. Centralized here so none of the 7 call sites can drift again.
  //
  // HEL-535 D6 — the two thunk-dispatched paths (createStaticSource,
  // createSqlSource) already get a success toast from toastListeners.ts's
  // `.fulfilled` entry; without `{ toast: false }` those two would toast
  // twice per create (this function's own push, plus the listener's) while
  // the other five (direct service calls, no thunk, no listener) would only
  // ever get this one. Wording matches the listener's exactly ('created.'),
  // so the five direct-service paths and the two thunk paths read identically.
  function finishCreate(created: { id: string }, options: { toast?: boolean } = {}) {
    void dispatch(fetchSources());
    void dispatch(fetchDataTypes());
    dispatch(setSelectedSourceId(created.id));
    if (options.toast !== false) {
      pushToast({ variant: "success", message: `Data source "${name.trim()}" created.` });
    }
    onClose();
  }

  async function handlePreview(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      flagNameInvalid("Name is required.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      let inferred: InferredField[];
      if (sourceType === "rest_api") {
        // HEL-827: a Connector is required before save/test is enabled — the
        // UI never emits a create/preview request carrying a bare `url` with
        // no `connectorId` (retirement of the dual-support bare-url path).
        if (!restForm.connector) {
          setError("A Connector is required.");
          setIsLoading(false);
          return;
        }
        if (!restForm.endpoint.trim()) {
          setError("Endpoint path is required.");
          setIsLoading(false);
          return;
        }
        inferred = await inferFromJson(restForm.buildRestSourceConfig());
      } else {
        if (!csvFile) {
          setError("CSV file is required.");
          setIsLoading(false);
          return;
        }
        inferred = await inferFromCsv(csvFile);
      }

      setFields(inferred.map((f) => ({ ...f })));
      setStep("preview");
    } catch {
      setError("Failed to infer schema. Check the source configuration and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      if (sourceType === "rest_api") {
        const { source } = await createRestSource(
          name.trim(),
          restForm.buildRestSourceConfig(),
          fields,
        );
        finishCreate(source);
      } else {
        const created = await createCsvSource(name.trim(), csvFile!, fields);
        finishCreate(created);
      }
    } catch {
      setError("Failed to create source.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateStatic(columns: StaticColumn[], rows: unknown[][]) {
    if (!name.trim()) {
      flagNameInvalid("Name is required.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const created = await dispatch(
        createStaticSource({ name: name.trim(), columns, rows }),
      ).unwrap();
      finishCreate(created, { toast: false });
    } catch {
      setError("Failed to create static source.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSqlSave(
    sourceName: string,
    config: SqlSourceConfig,
    _inferredFields: InferredField[],
  ) {
    setIsLoading(true);
    setError(null);
    try {
      const created = await dispatch(createSqlSource({ name: sourceName, config })).unwrap();
      finishCreate(created, { toast: false });
    } catch (err: unknown) {
      const msg =
        typeof err === "string" && err
          ? err
          : err instanceof Error
            ? err.message
            : "Failed to create SQL source.";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateText(mode: TextIngestMode, file: File | null, textUrl: string) {
    if (!name.trim()) {
      flagNameInvalid("Name is required.");
      return;
    }
    if (mode === "upload" && !file) {
      setError("A .txt or .md file is required.");
      return;
    }
    if (mode === "url" && !textUrl.trim()) {
      setError("URL is required.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const created =
        mode === "upload"
          ? await createTextSourceUpload(name.trim(), file!)
          : await createTextSourceUrl(name.trim(), textUrl.trim());
      finishCreate(created);
    } catch {
      setError("Failed to create text source.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreatePdf(mode: PdfIngestMode, file: File | null, pdfUrl: string) {
    if (!name.trim()) {
      flagNameInvalid("Name is required.");
      return;
    }
    if (mode === "upload" && !file) {
      setError("A .pdf file is required.");
      return;
    }
    if (mode === "url" && !pdfUrl.trim()) {
      setError("URL is required.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const created =
        mode === "upload"
          ? await createPdfSourceUpload(name.trim(), file!)
          : await createPdfSourceUrl(name.trim(), pdfUrl.trim());
      finishCreate(created);
    } catch {
      setError("Failed to create PDF source.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateImage(mode: ImageIngestMode, file: File | null, imageUrl: string) {
    if (!name.trim()) {
      flagNameInvalid("Name is required.");
      return;
    }
    if (mode === "upload" && !file) {
      setError("An image file is required.");
      return;
    }
    if (mode === "url" && !imageUrl.trim()) {
      setError("URL is required.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const created =
        mode === "upload"
          ? await createImageSourceUpload(name.trim(), file!)
          : await createImageSourceUrl(name.trim(), imageUrl.trim());
      finishCreate(created);
    } catch {
      setError("Failed to create image source.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleFieldChange(index: number, key: keyof EditableField, value: string | boolean) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, [key]: value } : f)));
  }

  const title = step === "configure" ? "Add data source" : "Preview schema";

  // Footer for the configure step (non-static, non-SQL, non-text, non-pdf,
  // non-image — those render their own self-contained form + footer since
  // they skip the configure -> preview schema-inference step).
  const configureFooter =
    step === "configure" &&
    sourceType !== "static" &&
    sourceType !== "sql" &&
    sourceType !== "text" &&
    sourceType !== "pdf" &&
    sourceType !== "image" ? (
      <>
        <button type="button" className="ui-modal-btn ui-modal-btn--secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="submit"
          form="add-source-configure-form"
          className="ui-modal-btn ui-modal-btn--primary"
          disabled={isLoading || (sourceType === "rest_api" && !restForm.connector)}
        >
          {isLoading ? "Loading…" : "Preview schema"}
        </button>
      </>
    ) : null;

  const previewFooter =
    step === "preview" ? (
      <>
        <button
          type="button"
          className="ui-modal-btn ui-modal-btn--secondary"
          onClick={() => {
            setStep("configure");
            setError(null);
          }}
        >
          Back
        </button>
        <button
          type="submit"
          form="add-source-preview-form"
          className="ui-modal-btn ui-modal-btn--primary"
          disabled={isLoading}
        >
          {isLoading ? "Creating…" : "Create source"}
        </button>
      </>
    ) : null;

  const footer = configureFooter ?? previewFooter ?? undefined;

  return (
    <Modal
      open
      title={title}
      size="md"
      ariaLabel="Add data source"
      onClose={onClose}
      footer={footer}
    >
      {step === "configure" && sourceType === "static" ? (
        <>
          <div className="add-source-modal__field">
            <label className="add-source-modal__label" htmlFor="source-name-static">
              Source name
            </label>
            <TextField
              ref={nameInputRef}
              id="source-name-static"
              value={name}
              onChange={handleNameChange}
              placeholder="e.g. Reference table"
              aria-label="Source name"
              aria-invalid={nameInvalid}
            />
          </div>
          <SourceTypeToggle active={sourceType} onChange={setSourceType} />
          <StaticSourceForm
            name={name}
            onSubmit={(columns, rows) => void handleCreateStatic(columns, rows)}
            isLoading={isLoading}
            error={error}
            onCancel={onClose}
          />
        </>
      ) : step === "configure" && sourceType === "text" ? (
        <>
          <div className="add-source-modal__field">
            <label className="add-source-modal__label" htmlFor="source-name-text">
              Source name
            </label>
            <TextField
              ref={nameInputRef}
              id="source-name-text"
              value={name}
              onChange={handleNameChange}
              placeholder="e.g. Release notes"
              aria-label="Source name"
              aria-invalid={nameInvalid}
            />
          </div>
          <SourceTypeToggle active={sourceType} onChange={setSourceType} />
          <TextSourceForm
            onSubmit={(mode, file, textUrl) => void handleCreateText(mode, file, textUrl)}
            isLoading={isLoading}
            error={error}
            onCancel={onClose}
          />
        </>
      ) : step === "configure" && sourceType === "pdf" ? (
        <>
          <div className="add-source-modal__field">
            <label className="add-source-modal__label" htmlFor="source-name-pdf">
              Source name
            </label>
            <TextField
              ref={nameInputRef}
              id="source-name-pdf"
              value={name}
              onChange={handleNameChange}
              placeholder="e.g. Quarterly report"
              aria-label="Source name"
              aria-invalid={nameInvalid}
            />
          </div>
          <SourceTypeToggle active={sourceType} onChange={setSourceType} />
          <PdfSourceForm
            onSubmit={(mode, file, pdfUrl) => void handleCreatePdf(mode, file, pdfUrl)}
            isLoading={isLoading}
            error={error}
            onCancel={onClose}
          />
        </>
      ) : step === "configure" && sourceType === "image" ? (
        <>
          <div className="add-source-modal__field">
            <label className="add-source-modal__label" htmlFor="source-name-image">
              Source name
            </label>
            <TextField
              ref={nameInputRef}
              id="source-name-image"
              value={name}
              onChange={handleNameChange}
              placeholder="e.g. Product photo"
              aria-label="Source name"
              aria-invalid={nameInvalid}
            />
          </div>
          <SourceTypeToggle active={sourceType} onChange={setSourceType} />
          <ImageSourceForm
            onSubmit={(mode, file, imageUrl) => void handleCreateImage(mode, file, imageUrl)}
            isLoading={isLoading}
            error={error}
            onCancel={onClose}
          />
        </>
      ) : step === "configure" ? (
        <form
          id="add-source-configure-form"
          className="add-source-modal__form"
          onSubmit={(e) => void handlePreview(e)}
        >
          <div className="add-source-modal__field">
            <label className="add-source-modal__label" htmlFor="source-name">
              Source name
            </label>
            <TextField
              ref={nameInputRef}
              id="source-name"
              value={name}
              onChange={handleNameChange}
              placeholder="e.g. Sales API"
              aria-label="Source name"
              aria-invalid={nameInvalid}
            />
          </div>

          <SourceTypeToggle active={sourceType} onChange={setSourceType} />

          {sourceType === "sql" ? (
            <SqlTab
              name={name.trim()}
              onSave={(n, cfg, inferred) => void handleSqlSave(n, cfg, inferred)}
              isSaving={isLoading}
            />
          ) : sourceType === "rest_api" ? (
            <RestApiForm form={restForm} />
          ) : (
            <CsvForm onFileChange={(e) => setCsvFile(e.target.files?.[0] ?? null)} />
          )}

          <InlineError error={error} />
        </form>
      ) : (
        <form
          id="add-source-preview-form"
          className="add-source-modal__form"
          onSubmit={(e) => void handleCreate(e)}
        >
          <p className="add-source-modal__preview-hint">
            Review the inferred fields. You can edit display names and data types before creating.
          </p>

          <InferredFieldsTable fields={fields} onFieldChange={handleFieldChange} />

          <InlineError error={error} />
        </form>
      )}
    </Modal>
  );
}
