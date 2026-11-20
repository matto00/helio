/**
 * HEL-1634 D5 -- what the sign-out reset deliberately does and does not touch, with a reason per
 * entry. `sessionResetGuard.test.ts` fails when browser storage or module-level state exists that
 * is in none of these lists nor registered with `sessionReset.ts`.
 */
export interface StorageKeyEntry {
  /** The literal, or the prefix when it ends in `.` or `-` (the real key appends an id). */
  key: string;
  store: "local" | "session" | "indexeddb";
  reason: string;
  /** For cleared keys: the registered session-reset hook that removes it. */
  clearedBy?: string;
}

/** Keys that legitimately survive a sign-out. */
export const STORAGE_KEYS_KEPT: readonly StorageKeyEntry[] = [
  {
    key: "helio-theme",
    store: "local",
    reason: "Device preference (light or dark); not user data, and the login page needs it.",
  },
  {
    key: "helio-accent",
    store: "local",
    reason:
      "Device preference; the next user's server accent overwrites it on login (ThemeProvider adopts it).",
  },
  {
    key: "helio-appearance",
    store: "local",
    reason:
      "Device pre-paint cache of the appearance prefs; useAppearanceState clears it while signed out, so the reset must not.",
  },
  {
    key: "helio.sidebarCollapsed",
    store: "local",
    reason:
      "Retired legacy flag, read once and removed by useContextListLayout; nothing writes it.",
  },
  {
    key: "helio.auth.returnTo",
    store: "session",
    reason:
      "Session mechanics: the pre-login path that must survive the OAuth redirect; consumed on read.",
  },
  {
    key: "helio.telemetry.queue.v1",
    store: "local",
    reason:
      "User-keyed by design: each event carries its userId and flush drops other users' events; clearing would lose undelivered events.",
  },
  {
    key: "helio.telemetry.firstDashboardRendered.",
    store: "local",
    reason:
      "User-keyed by design (suffix is the user id); holds a delivered-once flag, no user content.",
  },
  {
    key: "helio-onboarding-dismissed-",
    store: "local",
    reason:
      "User-keyed by design (suffix is the user id); holds a dismissed flag, no user content.",
  },
];

/** Keys a registered hook removes on sign-out. */
export const STORAGE_KEYS_CLEARED_BY_HOOK: readonly StorageKeyEntry[] = [
  {
    key: "helio.signedIn",
    store: "local",
    reason: "Session mechanics: the landing-page hint, removed by its own auth.status listener.",
    clearedBy: "signedInHintListener",
  },
  {
    key: "helio.recentVisits",
    store: "local",
    reason:
      "Recent dashboards, sources and pipelines with their titles belong to the signed-out user.",
    clearedBy: "recentHistory",
  },
  {
    key: "helio.dashboardSeen",
    store: "local",
    reason:
      "Per-dashboard view stamps feed the Home dot and the Home summary request's viewed ids.",
    clearedBy: "dashboardSeen",
  },
  {
    key: "helio.refinement.conversationId.",
    store: "session",
    reason: "A refinement conversation id of the signed-out user, keyed by dashboard id.",
    clearedBy: "refinementConversationIds",
  },
  {
    key: "helio.pipelineDraft.",
    store: "session",
    reason: "A kept unsaved pipeline draft of the signed-out user, keyed by pipeline id.",
    clearedBy: "keptDrafts",
  },
  {
    key: "helio-warm",
    store: "indexeddb",
    reason:
      "Warm copies of the signed-out user's dashboards (HEL-1575); deleted with the warm cache.",
    clearedBy: "clearWarm",
  },
];

/** `file#identifier` module state that holds no user data, each with the reason it is not reset. */
export const MODULE_STATE_NOT_USER_DATA: readonly { id: string; reason: string }[] = [
  {
    id: "app/dashboardMeta/DashboardMetaRow.tsx#NO_PANELS",
    reason:
      "Shared empty-array constant for referential stability; never mutated and holds no data.",
  },
  {
    id: "app/dashboardMeta/DashboardRefreshLine.tsx#NO_PANELS",
    reason:
      "Shared empty-array constant for referential stability; never mutated and holds no data.",
  },
  {
    id: "app/shell/contextListLayout.ts#pendingFocus",
    reason: "One-shot focus target for the context list (a DOM focus hint); holds no user data.",
  },
  {
    id: "features/ask/ui/AskAnswerCard.tsx#NO_PANELS",
    reason:
      "Shared empty-array constant for referential stability; never mutated and holds no data.",
  },
  {
    id: "features/dashboards/state/dashboardFoldersSlice.ts#previousFilings",
    reason:
      "Per-request bookkeeping for a folder move, emptied by the slice's own settle and by the root reducer reset; holds only ids between a move's pending and settle.",
  },
  {
    id: "features/dashboards/tabs/warm/clearWarmHook.ts#hook",
    reason: "Function pointer registered by the warm cache; holds no user data.",
  },
  {
    id: "features/dashboards/ui/DashboardChipRow.tsx#sessionOrder",
    reason:
      "User-keyed by design: the stored order carries its userId and is ignored for any other user.",
  },
  {
    id: "features/dashboards/ui/ProposalReview.tsx#DATA_PANEL_TYPES",
    reason: "Constant lookup table, never mutated after load; holds no user data.",
  },
  {
    id: "features/panels/history/metricComparisonStore.ts#listeners",
    reason:
      "Subscriber set kept across sign-out on purpose (design D3): a mounted consumer must still receive the next user's loads.",
  },
  {
    id: "features/panels/history/outputHistoryCache.ts#listeners",
    reason:
      "Subscriber set kept across sign-out on purpose (design D3): a mounted consumer must still receive the next user's loads.",
  },
  {
    id: "features/panels/hooks/useCrossFilterServerOps.ts#NO_CONTROLS",
    reason:
      "Shared empty-array constant for referential stability; never mutated and holds no data.",
  },
  {
    id: "features/panels/insight/insightChromeStore.ts#listeners",
    reason:
      "Subscriber set kept across sign-out on purpose (design D3): a mounted consumer must still receive the next user's loads.",
  },
  {
    id: "features/panels/provenance/provenanceCache.ts#invalidationListeners",
    reason:
      "Subscriber set kept across sign-out on purpose (design D3): a mounted consumer must still receive the next user's loads.",
  },
  {
    id: "features/panels/provenance/provenanceCache.ts#listeners",
    reason:
      "Subscriber set kept across sign-out on purpose (design D3): a mounted consumer must still receive the next user's loads.",
  },
  {
    id: "features/panels/services/pipelineRunFanout.ts#TERMINAL_STATUSES",
    reason: "Constant lookup table, never mutated after load; holds no user data.",
  },
  {
    id: "features/panels/services/pipelineRunFanout.ts#entries",
    reason:
      "Live SSE subscriptions ref-counted by mounted cards and closed on unmount; holds connections, not cached data.",
  },
  {
    id: "features/panels/state/filterCapabilitiesStore.ts#listeners",
    reason:
      "Subscriber set kept across sign-out on purpose (design D3): a mounted consumer must still receive the next user's loads.",
  },
  {
    id: "features/panels/state/formUploadConfig.ts#ALLOWED_EXTENSIONS",
    reason: "Constant lookup table, never mutated after load; holds no user data.",
  },
  {
    id: "features/panels/state/outputFreshness.ts#resetHooks",
    reason: "Function pointers of the freshness subscribers; holds no user data.",
  },
  {
    id: "features/panels/state/panelStatusStore.ts#visibilityHooked",
    reason: "Flag for a document visibility listener; holds no user data.",
  },
  {
    id: "features/panels/state/restoreMarkers.ts#serial",
    reason: "Monotonic id or epoch counter; holds no user data.",
  },
  {
    id: "features/panels/ui/PanelCardBody.tsx#EMPTY_CONTROLS",
    reason:
      "Shared empty-array constant for referential stability; never mutated and holds no data.",
  },
  {
    id: "features/panels/ui/PanelFullscreenOverlay.tsx#EMPTY_CONTROLS",
    reason:
      "Shared empty-array constant for referential stability; never mutated and holds no data.",
  },
  {
    id: "features/panels/ui/detailModal/usePanelDetailData.ts#EMPTY_CONTROLS",
    reason:
      "Shared empty-array constant for referential stability; never mutated and holds no data.",
  },
  {
    id: "features/panels/ui/editors/useFormEditorState.ts#nextRowIdCounter",
    reason: "Monotonic id or epoch counter; holds no user data.",
  },
  {
    id: "features/panels/ui/renderers/chartPanelModule.ts#pending",
    reason: "Promise of the lazily loaded chart code chunk; holds no user data.",
  },
  {
    id: "features/pipelines/evaluator/evaluatePipeline.ts#LIST_PRODUCERS",
    reason: "Constant lookup table, never mutated after load; holds no user data.",
  },
  {
    id: "features/pipelines/evaluator/expression/compile.ts#cache",
    reason: "Memo of parsed expressions keyed by expression text; holds no row data.",
  },
  {
    id: "features/pipelines/evaluator/expression/interpreter.ts#TEXT_ARG_FUNCTIONS",
    reason: "Constant lookup table, never mutated after load; holds no user data.",
  },
  {
    id: "features/pipelines/evaluator/expression/parser.ts#KEYWORDS",
    reason: "Constant lookup table, never mutated after load; holds no user data.",
  },
  {
    id: "features/pipelines/evaluator/javaRegex.ts#ESCAPED_META",
    reason: "Constant lookup table, never mutated after load; holds no user data.",
  },
  {
    id: "features/pipelines/evaluator/javaRegex.ts#SIMPLE_ESCAPES",
    reason: "Constant lookup table, never mutated after load; holds no user data.",
  },
  {
    id: "features/pipelines/evaluator/javaRegex.ts#cache",
    reason: "Memo of translated regular expressions keyed by pattern text; holds no row data.",
  },
  {
    id: "features/pipelines/evaluator/scalaGroup.ts#f32",
    reason: "Scratch buffer for number bit-casting; holds no user data.",
  },
  {
    id: "features/pipelines/evaluator/scalaGroup.ts#f64",
    reason: "Scratch buffer for number bit-casting; holds no user data.",
  },
  {
    id: "features/pipelines/evaluator/scalaGroup.ts#i32of32",
    reason: "Scratch buffer for number bit-casting; holds no user data.",
  },
  {
    id: "features/pipelines/evaluator/scalaGroup.ts#u32of64",
    reason: "Scratch buffer for number bit-casting; holds no user data.",
  },
  {
    id: "features/pipelines/evaluator/steps/exactSum.ts#bits",
    reason: "Scratch buffer for number bit-casting; holds no user data.",
  },
  {
    id: "features/pipelines/evaluator/steps/exactSum.ts#f64",
    reason: "Scratch buffer for number bit-casting; holds no user data.",
  },
  {
    id: "features/pipelines/evaluator/steps/window.ts#FIELD_REQUIRED",
    reason: "Constant lookup table, never mutated after load; holds no user data.",
  },
  {
    id: "features/pipelines/hooks/usePipelineAnalyzeLookups.ts#EMPTY_ANALYZE_COLUMNS",
    reason:
      "Shared empty-array constant for referential stability; never mutated and holds no data.",
  },
  {
    id: "features/pipelines/hooks/usePipelineAnalyzeLookups.ts#EMPTY_ANALYZE_SCHEMA",
    reason:
      "Shared empty-array constant for referential stability; never mutated and holds no data.",
  },
  {
    id: "features/pipelines/hooks/usePipelineAnalyzeLookups.ts#EMPTY_ANALYZE_WARNINGS",
    reason:
      "Shared empty-array constant for referential stability; never mutated and holds no data.",
  },
  {
    id: "features/pipelines/hooks/usePipelineDetailPage.ts#EMPTY_ROOTS",
    reason:
      "Shared empty-array constant for referential stability; never mutated and holds no data.",
  },
  {
    id: "features/pipelines/hooks/usePipelineDraftFrames.ts#NO_SOURCES",
    reason:
      "Shared empty-array constant for referential stability; never mutated and holds no data.",
  },
  {
    id: "features/pipelines/hooks/usePipelineRunEvents.ts#TERMINAL_STATUSES",
    reason: "Constant lookup table, never mutated after load; holds no user data.",
  },
  {
    id: "features/pipelines/hooks/useRunHistory.ts#NO_RUNS",
    reason:
      "Shared empty-array constant for referential stability; never mutated and holds no data.",
  },
  {
    id: "features/pipelines/hooks/useRunHistory.ts#openTokenCounter",
    reason: "Monotonic id or epoch counter; holds no user data.",
  },
  {
    id: "features/pipelines/hooks/useSavedOutputRows.ts#listeners",
    reason:
      "Subscriber set kept across sign-out on purpose (design D3): a mounted consumer must still receive the next user's loads.",
  },
  {
    id: "features/pipelines/services/draftPreviewCaps.ts#encoder",
    reason: "Stateless TextEncoder used to measure request size; holds no user data.",
  },
  {
    id: "features/pipelines/services/draftPreviewTestSupport.ts#encoder",
    reason: "Stateless TextEncoder in test support code; holds no user data.",
  },
  {
    id: "features/pipelines/state/draftEvaluation.ts#columnTypeCache",
    reason:
      "WeakMap memo keyed by frame object identity; unreachable once the reset slice state drops the frames.",
  },
  {
    id: "features/pipelines/state/draftPreviewRequest.ts#encoded",
    reason:
      "WeakMap memo keyed by frame object identity; unreachable once the reset slice state drops the frames.",
  },
  {
    id: "features/pipelines/state/draftPreviewRequest.ts#frameIds",
    reason:
      "WeakMap memo keyed by frame object identity; unreachable once the reset slice state drops the frames.",
  },
  {
    id: "features/pipelines/state/draftPreviewRequest.ts#nextFrameId",
    reason: "Monotonic id or epoch counter; holds no user data.",
  },
  {
    id: "features/pipelines/state/outputsSlice.ts#EMPTY_OUTPUTS",
    reason:
      "Shared empty-array constant for referential stability; never mutated and holds no data.",
  },
  {
    id: "features/pipelines/state/stepNarrowing.ts#AI_STEP_KINDS",
    reason: "Constant lookup table, never mutated after load; holds no user data.",
  },
  {
    id: "features/pipelines/state/stepNarrowing.ts#stepCounter",
    reason: "Monotonic id or epoch counter; holds no user data.",
  },
  {
    id: "features/pipelines/ui/StepCardFocused.tsx#EMPTY_ALL_STEPS",
    reason:
      "Shared empty-array constant for referential stability; never mutated and holds no data.",
  },
  {
    id: "features/pipelines/ui/StepOpEditor.tsx#EMPTY_ALL_STEPS",
    reason:
      "Shared empty-array constant for referential stability; never mutated and holds no data.",
  },
  {
    id: "features/pipelines/ui/outputEditor/useOutputKindState.ts#NO_IDS",
    reason:
      "Shared empty-array constant for referential stability; never mutated and holds no data.",
  },
  {
    id: "features/pipelines/ui/stepConfigs/AggregateConfig.tsx#NUMERIC_TYPES",
    reason: "Constant lookup table, never mutated after load; holds no user data.",
  },
  {
    id: "features/pipelines/ui/stepConfigs/FilterConfig.tsx#NUMERIC_TYPES",
    reason: "Constant lookup table, never mutated after load; holds no user data.",
  },
  {
    id: "features/pipelines/ui/stepConfigs/FilterConfig.tsx#UNARY_OPERATORS",
    reason: "Constant lookup table, never mutated after load; holds no user data.",
  },
  {
    id: "features/proposals/ui/CombinedProposalReview.tsx#DATA_PANEL_TYPES",
    reason: "Constant lookup table, never mutated after load; holds no user data.",
  },
  {
    id: "features/settings/ui/PreferencesEditor.tsx#rowIdCounter",
    reason: "Monotonic id or epoch counter; holds no user data.",
  },
  {
    id: "features/sources/hooks/useRestSourceForm.ts#BODIED_METHODS",
    reason: "Constant lookup table, never mutated after load; holds no user data.",
  },
  {
    id: "features/sources/state/sourceSamplesSlice.ts#decoded",
    reason:
      "WeakMap memo keyed by frame object identity; unreachable once the reset slice state drops the frames.",
  },
  {
    id: "features/sources/ui/FieldDeclarationTable.tsx#nextRowId",
    reason: "Monotonic id or epoch counter; holds no user data.",
  },
  {
    id: "features/sources/utils/csvSourceCreate.ts#csvLimitsPromise",
    reason: "The backend's CSV caps (server configuration, not tier- or user-dependent).",
  },
  {
    id: "features/telemetry/firstDashboardFlag.ts#pending",
    reason: "User-keyed by design: a set of user ids with an undelivered first-dashboard event.",
  },
  {
    id: "features/telemetry/track.ts#currentUserId",
    reason:
      "User-keyed by design: queued events carry their userId and flush drops other users' events, so clearing would lose undelivered events.",
  },
  {
    id: "features/telemetry/track.ts#flushTimer",
    reason:
      "User-keyed by design: queued events carry their userId and flush drops other users' events, so clearing would lose undelivered events.",
  },
  {
    id: "features/telemetry/track.ts#flushing",
    reason:
      "User-keyed by design: queued events carry their userId and flush drops other users' events, so clearing would lose undelivered events.",
  },
  {
    id: "features/telemetry/track.ts#listenersInstalled",
    reason:
      "User-keyed by design: queued events carry their userId and flush drops other users' events, so clearing would lose undelivered events.",
  },
  {
    id: "features/telemetry/track.ts#queue",
    reason:
      "User-keyed by design: queued events carry their userId and flush drops other users' events, so clearing would lose undelivered events.",
  },
  {
    id: "features/telemetry/track.ts#rejectionLogged",
    reason:
      "User-keyed by design: queued events carry their userId and flush drops other users' events, so clearing would lose undelivered events.",
  },
  {
    id: "features/telemetry/track.ts#warned",
    reason:
      "User-keyed by design: queued events carry their userId and flush drops other users' events, so clearing would lose undelivered events.",
  },
  {
    id: "features/toasts/state/toastsSlice.ts#nextId",
    reason: "Monotonic id or epoch counter; holds no user data.",
  },
  {
    id: "hooks/useNow.ts#tickers",
    reason: "Shared interval tickers keyed by period; hold timers, not user data.",
  },
  {
    id: "shared/chrome/rowDeleteFocus.ts#mode",
    reason:
      "Focus bookkeeping for the row-delete gesture (DOM nodes and timers); holds no user data.",
  },
  {
    id: "shared/chrome/rowDeleteFocus.ts#mounted",
    reason:
      "Focus bookkeeping for the row-delete gesture (DOM nodes and timers); holds no user data.",
  },
  {
    id: "shared/chrome/rowDeleteFocus.ts#pin",
    reason:
      "Focus bookkeeping for the row-delete gesture (DOM nodes and timers); holds no user data.",
  },
  {
    id: "shared/chrome/rowDeleteFocus.ts#pinFrame",
    reason:
      "Focus bookkeeping for the row-delete gesture (DOM nodes and timers); holds no user data.",
  },
  {
    id: "shared/chrome/rowDeleteFocus.ts#timer",
    reason:
      "Focus bookkeeping for the row-delete gesture (DOM nodes and timers); holds no user data.",
  },
  {
    id: "shared/chrome/shortcuts.ts#TEXT_ENTRY_TAGS",
    reason: "Constant lookup table, never mutated after load; holds no user data.",
  },
  {
    id: "shared/chrome/useShortcut.ts#listenerAttached",
    reason: "Flag for the one document keydown listener; holds no user data.",
  },
  {
    id: "shared/chrome/useShortcut.ts#registry",
    reason:
      "Keyboard shortcut registrations owned by mounted components; holds handlers, not user data.",
  },
  {
    id: "shared/motion/useFirstMountForToken.ts#seen",
    reason:
      "Entrance-animation gate keyed by opaque scope and token strings; at worst it skips one animation.",
  },
  {
    id: "shared/session/sessionEpoch.ts#epoch",
    reason: "Monotonic id or epoch counter; holds no user data.",
  },
  {
    id: "shared/session/sessionReset.ts#declared",
    reason: "The coverage declarations themselves: file and identifier names, no user data.",
  },
  {
    id: "shared/session/sessionReset.ts#hooks",
    reason: "The registry itself: function pointers, no user data.",
  },
  {
    id: "shared/ui/Toast.tsx#toastLife",
    reason:
      "Display timers of mounted toasts; the toast data lives in the slice, which the root reducer resets.",
  },
  {
    id: "shared/ui/modalDialogRegistry.ts#listeners",
    reason:
      "Subscriber set kept across sign-out on purpose (design D3): a mounted consumer must still receive the next user's loads.",
  },
  {
    id: "shared/ui/modalDialogRegistry.ts#open",
    reason:
      "Open modal dialog elements owned by mounted components; holds DOM nodes, not user data.",
  },
  {
    id: "shared/ui/modalDialogRegistry.ts#top",
    reason: "The top open modal dialog element; holds a DOM node, not user data.",
  },
  {
    id: "shared/ui/panelFit.ts#safeAreaProbe",
    reason: "A hidden DOM element used to measure the safe area; holds no user data.",
  },
];
