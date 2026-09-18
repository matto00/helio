// HEL-1084 design.md D6 — the Form entry's second step: choose a `dataset`-kind
// source to bind the new form panel to. Same listbox/card pattern and arrow-key
// nav as `OutputPicker`'s Output list; kept as its own component to respect
// CONTRIBUTING's ~400-line split rule on `OutputPicker.tsx`.

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Database, Search } from "lucide-react";

import { IconButton } from "../../../shared/ui/IconButton";
import { TextField } from "../../../shared/ui/TextField";
import { Spinner } from "../../../shared/ui/Spinner";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { ICON_SIZE } from "../../../shared/ui/iconSize";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { fetchSources } from "../../sources/state/sourcesSlice";
import { createPanel } from "../state/panelThunks";
import type { DataSource } from "../../sources/types/dataSource";

const OPTION_ID_PREFIX = "dataset-step-option-";

interface DatasetStepProps {
  dashboardId: string;
  onBack: () => void;
  onClose: () => void;
}

export function DatasetStep({ dashboardId, onBack, onClose }: DatasetStepProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const sources = useAppSelector((s) => s.sources.items);
  const sourcesStatus = useAppSelector((s) => s.sources.status);
  const isLoading = sourcesStatus === "idle" || sourcesStatus === "loading";

  const [query, setQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (sourcesStatus === "idle") dispatch(fetchSources());
  }, [sourcesStatus, dispatch]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const datasetSources = useMemo(
    () => sources.filter((s): s is DataSource & { type: "dataset" } => s.type === "dataset"),
    [sources],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return datasetSources;
    return datasetSources.filter((s) => s.name.toLowerCase().includes(q));
  }, [datasetSources, query]);

  async function choose(dataSource: DataSource) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await dispatch(
        createPanel({
          dashboardId,
          type: "form",
          title: dataSource.name,
          config: {
            dataSourceId: dataSource.id,
            fields: [],
            submit: { writeMode: "append" },
          },
        }),
      ).unwrap();
      onClose();
    } catch {
      setIsSubmitting(false);
      setSubmitError("Failed to add panel. Please try again.");
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (filtered.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      setFocusedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      setFocusedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = filtered[focusedIndex];
      if (entry) void choose(entry);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onBack();
    }
  }

  const activeDescendantId = filtered.length > 0 ? `${OPTION_ID_PREFIX}${focusedIndex}` : undefined;

  return (
    <div className="output-picker__inner" onKeyDown={handleKeyDown}>
      <div className="output-picker__dataset-step-header">
        <IconButton
          icon={<ArrowLeft size={16} />}
          aria-label="Back"
          onClick={onBack}
          variant="ghost"
        />
        <TextField
          ref={searchRef}
          type="search"
          className="output-picker__search"
          placeholder="Search datasets…"
          aria-label="Search datasets"
          aria-controls="dataset-step-listbox"
          aria-activedescendant={activeDescendantId}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setFocusedIndex(0);
          }}
        />
      </div>

      {submitError ? (
        <p className="output-picker__status output-picker__status--error" role="alert">
          {submitError}
        </p>
      ) : null}

      {isLoading ? (
        <p className="output-picker__status" role="status">
          <Spinner size="md" /> Loading datasets…
        </p>
      ) : datasetSources.length === 0 ? (
        <EmptyState
          icon={<Database size={ICON_SIZE.lg} />}
          title="No dataset yet"
          description="A form writes rows into a dataset — create one to bind this form to."
          cta={{ label: "New dataset", onClick: () => navigate("/sources") }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search size={ICON_SIZE.lg} />}
          title="No dataset matches"
          description="Try a different search."
        />
      ) : (
        <div
          className="output-picker__cards"
          role="listbox"
          id="dataset-step-listbox"
          aria-label="Datasets"
        >
          {filtered.map((source, index) => (
            <button
              key={source.id}
              id={`${OPTION_ID_PREFIX}${index}`}
              type="button"
              role="option"
              aria-selected={index === focusedIndex}
              className={`output-picker__card${
                index === focusedIndex ? " output-picker__card--focused" : ""
              }`}
              aria-label={source.name}
              onClick={() => void choose(source)}
              tabIndex={-1}
              disabled={isSubmitting}
            >
              <span className="output-picker__card-name">{source.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
