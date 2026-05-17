import { useState, type FormEvent } from "react";

import "./AddSourceModal.css";
import { fetchDataTypes } from "../../dataTypes/state/dataTypesSlice";
import { createStaticSource, createSqlSource, fetchSources } from "../state/sourcesSlice";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import type { InferredField, StaticColumn } from "../../../types/models";
import {
  createCsvSource,
  createRestSource,
  inferFromCsv,
  inferFromJson,
  type SqlSourceConfig,
} from "../services/dataSourceService";
import { CsvForm } from "./CsvForm";
import { InferredFieldsTable } from "./InferredFieldsTable";
import type { EditableField } from "./InferredFieldsTable";
import { RestApiForm } from "./RestApiForm";
import { SourceTypeToggle } from "./SourceTypeToggle";
import { StaticSourceForm } from "./StaticSourceForm";
import { SqlTab } from "./SqlTab";
import { Modal } from "../../../shared/ui/Modal";
import { TextField } from "../../../shared/ui/TextField";

type SourceType = "rest_api" | "csv" | "static" | "sql";
type Step = "configure" | "preview";

interface AddSourceModalProps {
  onClose: () => void;
}

export function AddSourceModal({ onClose }: AddSourceModalProps) {
  const dispatch = useAppDispatch();

  const [step, setStep] = useState<Step>("configure");
  const [sourceType, setSourceType] = useState<SourceType>("rest_api");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [jsonPath, setJsonPath] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [fields, setFields] = useState<EditableField[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePreview(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      let inferred: InferredField[];
      if (sourceType === "rest_api") {
        if (!url.trim()) {
          setError("URL is required.");
          setIsLoading(false);
          return;
        }
        const config = {
          url: url.trim(),
          method: "GET",
          ...(jsonPath.trim() ? { jsonPath: jsonPath.trim() } : {}),
        };
        inferred = await inferFromJson(config);
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
        const config = {
          url: url.trim(),
          method: "GET",
          ...(jsonPath.trim() ? { jsonPath: jsonPath.trim() } : {}),
        };
        await createRestSource(name.trim(), config, fields);
      } else {
        await createCsvSource(name.trim(), csvFile!, fields);
      }
      void dispatch(fetchSources());
      void dispatch(fetchDataTypes());
      onClose();
    } catch {
      setError("Failed to create source.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateStatic(columns: StaticColumn[], rows: unknown[][]) {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await dispatch(createStaticSource({ name: name.trim(), columns, rows })).unwrap();
      void dispatch(fetchDataTypes());
      onClose();
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
      await dispatch(createSqlSource({ name: sourceName, config })).unwrap();
      void dispatch(fetchDataTypes());
      onClose();
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

  function handleFieldChange(index: number, key: keyof EditableField, value: string | boolean) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, [key]: value } : f)));
  }

  const title = step === "configure" ? "Add Data Source" : "Preview Schema";

  // Footer for the configure step (non-static, non-SQL)
  const configureFooter =
    step === "configure" && sourceType !== "static" && sourceType !== "sql" ? (
      <>
        <button type="button" className="ui-modal-btn ui-modal-btn--secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="submit"
          form="add-source-configure-form"
          className="ui-modal-btn ui-modal-btn--primary"
          disabled={isLoading}
        >
          {isLoading ? "Loading…" : "Preview schema"}
        </button>
      </>
    ) : null;

  // Footer for preview step
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
              id="source-name-static"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Reference table"
              aria-label="Source name"
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
              id="source-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sales API"
              aria-label="Source name"
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
            <RestApiForm
              url={url}
              jsonPath={jsonPath}
              onUrlChange={setUrl}
              onJsonPathChange={setJsonPath}
            />
          ) : (
            <CsvForm onFileChange={(e) => setCsvFile(e.target.files?.[0] ?? null)} />
          )}

          {error && (
            <p className="add-source-modal__error" role="alert">
              {error}
            </p>
          )}
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

          {error && (
            <p className="add-source-modal__error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </Modal>
  );
}
