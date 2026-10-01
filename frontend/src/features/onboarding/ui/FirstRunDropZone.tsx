import { FileUp } from "lucide-react";
import { useId, useRef, useState, type DragEvent, type FormEvent } from "react";

import "./FirstRunDropZone.css";
import { InlineError } from "../../../shared/chrome/InlineError";
import { Spinner } from "../../../shared/ui/Spinner";
import { TextField } from "../../../shared/ui/TextField";
import { FIRST_RUN_STAGE_LABEL, useFirstRunBuild } from "../hooks/useFirstRunBuild";
import { TEMPLATE_STAGE_LABEL, useFirstRunTemplate } from "../hooks/useFirstRunTemplate";
import { FirstRunTemplateChips } from "./FirstRunTemplateChips";

interface FirstRunDropZoneProps {
  /** Reveals the three-step checklist instead (the manual path). */
  onStepByStep: () => void;
}

/** The empty-workspace landing (HEL-1209): drop a CSV, choose one, or paste a link, and Helio
 *  builds, runs and opens a dashboard with no model call. Every pointer affordance has a keyboard
 *  and touch equivalent (a real "Choose a file" button and a labelled link field); progress is
 *  announced through a polite live region and failures through `role="alert"`. */
export function FirstRunDropZone({ onStepByStep }: FirstRunDropZoneProps) {
  const build = useFirstRunBuild();
  const template = useFirstRunTemplate();
  const [templateActive, setTemplateActive] = useState(false);
  const state = templateActive ? template.state : build.state;
  const retry = templateActive ? template.retry : build.retry;
  const canRetry = templateActive ? template.canRetry : build.canRetry;
  const [dragging, setDragging] = useState(false);
  const [url, setUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const urlInputId = useId();
  const working = state.status === "working";

  function submitFile(file: File) {
    setTemplateActive(false);
    build.submitFile(file);
  }

  function submitUrl(value: string) {
    setTemplateActive(false);
    build.submitUrl(value);
  }

  function chooseTemplate(slug: string) {
    setTemplateActive(true);
    template.choose(slug);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !working) submitFile(file);
  }

  function handleUrlSubmit(event: FormEvent) {
    event.preventDefault();
    if (!working) submitUrl(url);
  }

  return (
    <section className="first-run-drop" aria-labelledby="first-run-drop-title">
      <h2 id="first-run-drop-title" className="first-run-drop__title">
        Build your first dashboard
      </h2>
      <p className="first-run-drop__lede">
        Drop a CSV and Helio builds a dashboard from it in seconds. No setup, no AI needed.
      </p>
      <div
        role="group"
        aria-label="Drop a CSV file here"
        className={`first-run-drop__target${dragging ? " first-run-drop__target--active" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <FileUp aria-hidden="true" className="first-run-drop__icon" />
        <p className="first-run-drop__target-text">Drop a .csv file here</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="first-run-file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) submitFile(file);
          }}
        />
        <button
          type="button"
          className="first-run-drop__button first-run-drop__button--primary"
          disabled={working}
          onClick={() => fileInputRef.current?.click()}
        >
          Choose a file
        </button>
      </div>
      <form className="first-run-drop__url" onSubmit={handleUrlSubmit}>
        <label htmlFor={urlInputId} className="first-run-drop__url-label">
          Or paste a link to a CSV
        </label>
        <div className="first-run-drop__url-row">
          <TextField
            id={urlInputId}
            type="url"
            placeholder="https://example.com/data.csv"
            value={url}
            disabled={working}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            type="submit"
            className="first-run-drop__button first-run-drop__button--secondary"
            disabled={working || url.trim() === ""}
          >
            Build from link
          </button>
        </div>
      </form>
      <FirstRunTemplateChips disabled={working} onChoose={chooseTemplate} />
      <p className="first-run-drop__status" role="status" aria-live="polite">
        {state.status === "working" ? (
          <>
            <Spinner />
            {templateActive ? TEMPLATE_STAGE_LABEL : FIRST_RUN_STAGE_LABEL[state.stage]}
          </>
        ) : null}
      </p>
      {state.status === "error" ? (
        <InlineError
          variant="banner"
          kind="error"
          error={state.message}
          onRetry={canRetry ? retry : undefined}
        />
      ) : null}
      <button
        type="button"
        className="first-run-drop__button first-run-drop__button--ghost"
        disabled={working}
        onClick={onStepByStep}
      >
        Set up step by step
      </button>
    </section>
  );
}
