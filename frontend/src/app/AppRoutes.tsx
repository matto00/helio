import { lazy, Suspense } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { faCompass } from "@fortawesome/free-solid-svg-icons";

import { ChatPage } from "../features/assistant/ui/ChatPage";
import { ProtectedRoute } from "../features/auth/ui/ProtectedRoute";
import { ConnectorsPage } from "../features/connectors/ui/ConnectorsPage";
import { PublicOnlyRoute } from "../features/auth/ui/PublicOnlyRoute";
import { LoginPage } from "../features/auth/ui/LoginPage";
import { MfaVerifyPage } from "../features/auth/ui/MfaVerifyPage";
import { OAuthCallbackPage } from "../features/auth/ui/OAuthCallbackPage";
import { RegisterPage } from "../features/auth/ui/RegisterPage";
import { MetricDetailPage } from "../features/metrics/ui/MetricDetailPage";
import { MetricsPage } from "../features/metrics/ui/MetricsPage";
import { PipelineDetailPage } from "../features/pipelines/ui/PipelineDetailPage";
import { PipelinesPage } from "../features/pipelines/ui/PipelinesPage";
import { SettingsPage } from "../features/settings/ui/SettingsPage";
import { SourceDetailPage } from "../features/sources/ui/SourceDetailPage";
import { SourcesPage } from "../features/sources/ui/SourcesPage";
import { TypeDetailPage } from "../features/dataTypes/ui/TypeDetailPage";
import { TypeRegistryPage } from "../features/dataTypes/ui/TypeRegistryPage";
import { PatchSetReviewPage } from "../features/patchSets/ui/PatchSetReviewPage";
import { PanelList } from "../features/panels/ui/PanelList";
import { EmptyState } from "../shared/ui/EmptyState";
import { PageSuspenseFallback } from "../shared/ui/SuspenseFallback";
import { AppShell } from "./App";

// HEL-512 — reached only from NL-authoring's "review proposal" hand-off, not on the critical
// path of any other route; loaded via a dynamic `import()` so its module graph doesn't ship on
// every other route's initial navigation. `ProposalReviewPage` is a named export (not default),
// so `React.lazy` — which requires a promise resolving to a `{ default }` shape — needs this
// adapter.
const ProposalReviewPage = lazy(() =>
  import("../features/dashboards/ui/ProposalReviewPage").then((m) => ({
    default: m.ProposalReviewPage,
  })),
);

// HEL-739 — same rationale as `ProposalReviewPage` above: reached only from `ProposalHandoff`'s
// "Review proposal" hand-off, not on any other route's critical path.
const PipelineProposalReviewPage = lazy(() =>
  import("../features/pipelines/ui/proposalReview/PipelineProposalReviewPage").then((m) => ({
    default: m.PipelineProposalReviewPage,
  })),
);
const CombinedProposalReviewPage = lazy(() =>
  import("../features/proposals/ui/CombinedProposalReviewPage").then((m) => ({
    default: m.CombinedProposalReviewPage,
  })),
);

/** Rendered for any route that doesn't match a real page — including while
 * unauthenticated, so it never depends on `AppShell`/auth context (design.md
 * D-shell). Replaces the previous silent `<Navigate to="/" />` redirect
 * (F-188): a genuinely unknown URL now says so instead of pretending nothing
 * happened. */
function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="app-not-found">
      <EmptyState
        icon={faCompass}
        title="Page not found"
        description="That page doesn't exist or may have moved."
        cta={{ label: "Back to dashboards", onClick: () => navigate("/") }}
      />
    </div>
  );
}

/** The app's entire route table, split out of `App.tsx` (HEL-724) — a clean
 * boundary between routing and shell chrome. `App()` renders this directly;
 * `AppShell` (still in `App.tsx`) is the layout route every protected page
 * renders inside. */
export function AppRoutes() {
  return (
    <Routes>
      {/* Public-only routes (redirect to / when already authenticated) */}
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/login/verify" element={<MfaVerifyPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      {/* Public route: OAuth callback - must be outside ProtectedRoute and PublicOnlyRoute */}
      <Route path="/auth/callback" element={<OAuthCallbackPage />} />

      {/* Protected routes (redirect to /login when unauthenticated) */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<PanelList />} />
          <Route path="/sources" element={<SourcesPage />} />
          <Route path="/sources/:id" element={<SourceDetailPage />} />
          <Route path="/pipelines" element={<PipelinesPage />} />
          <Route path="/pipelines/:id" element={<PipelineDetailPage />} />
          <Route path="/connectors" element={<ConnectorsPage />} />
          <Route path="/registry" element={<TypeRegistryPage />} />
          <Route path="/registry/:id" element={<TypeDetailPage />} />
          <Route path="/metrics" element={<MetricsPage />} />
          <Route path="/metrics/:id" element={<MetricDetailPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route
            path="/proposals/review"
            element={
              <Suspense fallback={<PageSuspenseFallback />}>
                <ProposalReviewPage />
              </Suspense>
            }
          />
          <Route path="/patch-sets/review" element={<PatchSetReviewPage />} />
          <Route
            path="/pipeline-proposals/review"
            element={
              <Suspense fallback={<PageSuspenseFallback />}>
                <PipelineProposalReviewPage />
              </Suspense>
            }
          />
          <Route
            path="/combined-proposals/review"
            element={
              <Suspense fallback={<PageSuspenseFallback />}>
                <CombinedProposalReviewPage />
              </Suspense>
            }
          />
        </Route>
      </Route>

      {/* Fallback — F-188: a real "not found" page instead of a silent redirect. */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
