import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import "./AddSourceModal.css";
import { fetchDataTypes } from "../features/dataTypes/dataTypesSlice";
import { fetchSources } from "../features/sources/sourcesSlice";
import { useAppDispatch } from "../hooks/reduxHooks";
import type { InferredField } from "../types/models";
import {
  createCsvSource,
  createRestSource,
  inferFromCsv,
  inferFromJson,
} from "../services/dataSourceService";

type SourceType = "rest_api" | "csv";
type Step = "configure" | "preview";

interface EditableField extends InferredField {
  displayName: string;
  dataType: string;
}

interface AddSourceModalProps {
  onClose: () => void;
}

export function AddSourceModal({ onClose }: AddSourceModalProps) {
  const dispatch = useAppDispatch();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [step, setStep] = useState<Step>("configure");
  const [sourceType, setSourceType] = useState<SourceType>("rest_api");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [jsonPath, setJsonPath] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [fields, setFields] = useState<EditableField[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function handleClose() {
    dialogRef.current?.close();
    onClose();
  }

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
      handleClose();
    } catch {
      setError("Failed to create source.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleFieldChange(index: number, key: keyof EditableField, value: string | boolean) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, [key]: value } : f)));
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setCsvFile(file);
  }

  return (
    <dialog
      ref={dialogRef}
      className="add-source-modal"
      aria-label="Add data source"
      onClose={onClose}
    >
      <div className="add-source-modal__inner">
        <header className="add-source-modal__header">
          <h2 className="add-source-modal__title">
            {step === "configure" ? "Add Data Source" : "Preview Schema"}
          </h2>
          <button
            type="button"
            className="add-source-modal__close"
            aria-label="Close modal"
            onClick={handleClose}
          >
            ✕
          </button>
        </header>

        {step === "configure" ? (
          <form className="add-source-modal__form" onSubmit={(e) => void handlePreview(e)}>
            <div className="add-source-modal__field">
              <label className="add-source-modal__label" htmlFor="source-name">
                Source name
              </label>
              <input
                id="source-name"
                type="text"
                className="add-source-modal__input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sales API"
              />
            </div>

            <div className="add-source-modal__field">
              <span className="add-source-modal__label">Source type</span>
              <div className="add-source-modal__type-toggle" role="group" aria-label="Source type">
                <button
                  type="button"
                  className={
                    sourceType === "rest_api"
                      ? "add-source-modal__type-btn add-source-modal__type-btn--active"
                      : "add-source-modal__type-btn"
                  }
                  onClick={() => setSourceType("rest_api")}
                >
                  REST API
                </button>
                <button
                  type="button"
                  className={
                    sourceType === "csv"
                      ? "add-source-modal__type-btn add-source-modal__type-btn--active"
                      : "add-source-modal__type-btn"
                  }
                  onClick={() => setSourceType("csv")}
                >
                  CSV File
                </button>
              </div>
            </div>

            {sourceType === "rest_api" ? (
              <>
                <div className="add-source-modal__field">
                  <label className="add-source-modal__label" htmlFor="source-url">
                    URL
                  </label>
                  <input
                    id="source-url"
                    type="url"
                    className="add-source-modal__input"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://api.example.com/data"
                  />
                </div>
                <div className="add-source-modal__field">
                  <label className="add-source-modal__label" htmlFor="source-json-path">
                    JSON path <span className="add-source-modal__optional">(optional)</span>
                  </label>
                  <input
                    id="source-json-path"
                    type="text"
                    className="add-source-modal__input"
                    value={jsonPath}
                    onChange={(e) => setJsonPath(e.target.value)}
                    placeholder="e.g. data.items"
                  />
                </div>
              </>
            ) : (
              <div className="add-source-modal__field">
                <label className="add-source-modal__label" htmlFor="source-csv-file">
                  CSV file
                </label>
                <input
                  id="source-csv-file"
                  type="file"
                  className="add-source-modal__input"
                  accept=".csv,text/csv"
                  onChange={handleFileChange}
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
                onClick={handleClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="add-source-modal__btn add-source-modal__btn--primary"
                disabled={isLoading}
              >
                {isLoading ? "Loading…" : "Preview schema"}
              </button>
            </div>
          </form>
        ) : (
          <form className="add-source-modal__form" onSubmit={(e) => void handleCreate(e)}>
            <p className="add-source-modal__preview-hint">
              Review the inferred fields. You can edit display names and data types before creating.
            </p>

            {fields.length === 0 ? (
              <p className="add-source-modal__empty">No fields were detected.</p>
            ) : (
              <table className="add-source-modal__fields-table" aria-label="Inferred fields">
                <thead>
                  <tr>
                    <th>Field name</th>
                    <th>Display name</th>
                    <th>Data type</th>
                    <th>Nullable</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field, index) => (
                    <tr key={field.name}>
                      <td className="add-source-modal__field-name">{field.name}</td>
                      <td>
                        <input
                          type="text"
                          className="add-source-modal__cell-input"
                          aria-label={`Display name for ${field.name}`}
                          value={field.displayName}
                          onChange={(e) => handleFieldChange(index, "displayName", e.target.value)}
                        />
                      </td>
                      <td>
                        <select
                          className="add-source-modal__cell-select"
                          aria-label={`Data type for ${field.name}`}
                          value={field.dataType}
                          onChange={(e) => handleFieldChange(index, "dataType", e.target.value)}
                        >
                          <option value="string">string</option>
                          <option value="integer">integer</option>
                          <option value="float">float</option>
                          <option value="boolean">boolean</option>
                          <option value="timestamp">timestamp</option>
                        </select>
                      </td>
                      <td className="add-source-modal__nullable-cell">
                        <input
                          type="checkbox"
                          aria-label={`Nullable for ${field.name}`}
                          checked={field.nullable}
                          onChange={(e) => handleFieldChange(index, "nullable", e.target.checked)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                onClick={() => {
                  setStep("configure");
                  setError(null);
                }}
              >
                Back
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
        )}
      </div>
    </dialog>
  );
}
