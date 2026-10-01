import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchDashboards } from "../../dashboards/services/dashboardService";
import { dashboardUpserted, setSelectedDashboardId } from "../../dashboards/state/dashboardsSlice";
import { fetchSources } from "../../sources/state/sourcesSlice";
import {
  CSV_UPLOAD_MAX_BYTES,
  createCsvFromUrl,
  inferAndCreateCsv,
} from "../../sources/utils/csvSourceCreate";
import { track } from "../../telemetry/track";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { buildFirstRunDashboard } from "../services/firstRunService";
import {
  describeFirstRunError,
  isPayloadTooLarge,
  tooLargeMessage,
  type FirstRunStage,
} from "../state/firstRunErrors";
import {
  isHttpUrl,
  looksLikeCsv,
  sourceNameFromFile,
  sourceNameFromUrl,
} from "../state/firstRunNaming";
import { dismissOnboarding } from "../state/onboardingSlice";

export const FIRST_RUN_STAGE_LABEL: Record<FirstRunStage, string> = {
  reading: "Reading columns…",
  uploading: "Uploading file…",
  building: "Building your dashboard and running the pipeline…",
};

type Attempt = { kind: "file"; file: File } | { kind: "url"; url: string };

export type FirstRunState =
  | { status: "idle" }
  | { status: "working"; stage: FirstRunStage }
  | { status: "error"; message: string };

export interface FirstRunBuild {
  state: FirstRunState;
  submitFile: (file: File) => void;
  submitUrl: (url: string) => void;
  /** Re-runs the last attempt; reuses an already-created source instead of uploading again. */
  retry: () => void;
  /** False after a client-side rejection (wrong file type, malformed link): nothing to repeat. */
  canRetry: boolean;
}

/** Orchestrates the zero-to-dashboard first run: source create (the shared CSV infer -> create
 *  path) -> `POST /api/first-run/dashboard` -> refresh the dashboards list -> navigate to
 *  `/dashboards/:id`. A build failure keeps the created source so a retry only repeats the build. */
export function useFirstRunBuild(): FirstRunBuild {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [state, setState] = useState<FirstRunState>({ status: "idle" });
  const lastAttempt = useRef<Attempt | null>(null);
  const createdSourceId = useRef<string | null>(null);
  const inFlight = useRef(false);

  const run = useCallback(
    async (attempt: Attempt) => {
      if (inFlight.current) return;
      inFlight.current = true;
      let stage: FirstRunStage = attempt.kind === "file" ? "reading" : "uploading";
      const enter = (next: FirstRunStage) => {
        stage = next;
        setState({ status: "working", stage: next });
      };
      enter(stage);
      try {
        let sourceId = createdSourceId.current;
        if (sourceId === null) {
          const created =
            attempt.kind === "file"
              ? await inferAndCreateCsv(sourceNameFromFile(attempt.file), attempt.file, enter)
              : await createCsvFromUrl(sourceNameFromUrl(attempt.url), attempt.url);
          sourceId = created.id;
          createdSourceId.current = sourceId;
          void dispatch(fetchSources());
        }
        enter("building");
        const result = await buildFirstRunDashboard(sourceId);
        const dashboards = await fetchDashboards();
        const landed = dashboards.find((d) => d.id === result.dashboardId);
        if (landed) dispatch(dashboardUpserted(landed));
        dispatch(setSelectedDashboardId(result.dashboardId));
        dispatch(dismissOnboarding());
        track("firstrun_dashboard_created", { panelCount: result.panelCount });
        createdSourceId.current = null;
        lastAttempt.current = null;
        navigate(`/dashboards/${result.dashboardId}`, { state: { firstRun: result } });
      } catch (err) {
        if (isPayloadTooLarge(err)) lastAttempt.current = null;
        setState({ status: "error", message: describeFirstRunError(err, stage) });
      } finally {
        inFlight.current = false;
      }
    },
    [dispatch, navigate],
  );

  const start = useCallback(
    (attempt: Attempt) => {
      if (inFlight.current) return;
      createdSourceId.current = null;
      lastAttempt.current = attempt;
      track("firstrun_file_dropped", { source: attempt.kind === "url" ? "paste" : "drop" });
      void run(attempt);
    },
    [run],
  );

  const submitFile = useCallback(
    (file: File) => {
      if (!looksLikeCsv(file)) {
        lastAttempt.current = null;
        setState({
          status: "error",
          message: "That doesn't look like a CSV file. Choose a .csv file.",
        });
        return;
      }
      if (file.size > CSV_UPLOAD_MAX_BYTES) {
        lastAttempt.current = null;
        setState({ status: "error", message: tooLargeMessage });
        return;
      }
      start({ kind: "file", file });
    },
    [start],
  );

  const submitUrl = useCallback(
    (url: string) => {
      const trimmed = url.trim();
      if (!isHttpUrl(trimmed)) {
        lastAttempt.current = null;
        setState({
          status: "error",
          message: "Enter a full link to a CSV, starting with https://.",
        });
        return;
      }
      start({ kind: "url", url: trimmed });
    },
    [start],
  );

  const retry = useCallback(() => {
    if (lastAttempt.current) void run(lastAttempt.current);
  }, [run]);

  return { state, submitFile, submitUrl, retry, canRetry: lastAttempt.current !== null };
}
