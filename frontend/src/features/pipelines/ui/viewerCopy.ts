// HEL-1794 (design.md D3, copy table): every string on the pipeline detail page that invites the reader to edit or run has a
// viewer variant. An owner and an editor keep today's string; a viewer (and a role not yet known) reads the `viewer` one.

export interface ViewerCopy {
  readonly edit: string;
  readonly viewer: string;
}

/** The copy for the page's capability: `canEdit` is `page.canEdit` (`canEditFromUi(runRole)`). */
export const copyFor = (entry: ViewerCopy, canEdit: boolean): string =>
  canEdit ? entry.edit : entry.viewer;

export const VIEWER_COPY = {
  spineNoSteps: {
    edit: "Add your first transformation step to start shaping this pipeline's output.",
    viewer: "No transformation steps yet.",
  },
  spineRootEmpty: {
    edit: "No steps yet \u2014 join this source into another lane's step to use it.",
    viewer: "No steps use this source yet.",
  },
  editorEmptyTitle: { edit: "Nothing to edit yet", viewer: "No steps yet" },
  editorEmptyDescription: {
    edit: "Add a step on the left, then edit it here and see the rows it produces.",
    viewer: "This pipeline has no steps.",
  },
  editorPickDescription: {
    edit: "Pick a step on the left to edit it and see the rows it produces.",
    viewer: "Pick a step on the left to see its configuration and the rows it produces.",
  },
  editorRegionLabel: { edit: "Step editor and preview", viewer: "Step details and preview" },
  previewNoSteps: {
    edit: "Add a step on the Steps tab to see the rows it produces.",
    viewer: "This pipeline has no steps yet.",
  },
  liveNoOutput: {
    edit: "No Output yet. Add one from the spine.",
    viewer: "No Output yet.",
  },
  sheetTitle: { edit: "Edit step", viewer: "Step" },
  sheetAriaLabel: { edit: "Step editor", viewer: "Step details" },
  outputNeverRun: {
    edit: "This output hasn\u2019t been included in a saved run yet, so any dashboard panel bound to it currently shows \u201cNo data available.\u201d Run the pipeline to populate it.",
    viewer: "This Output has no rows yet. It fills in after the pipeline's next run.",
  },
  historyEmpty: {
    edit: "Run the pipeline to start recording this Output's history.",
    viewer: "No history recorded yet.",
  },
} as const satisfies Record<string, ViewerCopy>;
