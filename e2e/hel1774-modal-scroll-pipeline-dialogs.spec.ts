import { registerModalScrollSuite } from "./support/modalScrollExtent";

// HEL-1774: modal group "pipeline-dialogs" of the modal scroll-extent guard (see support/modalScrollExtent.ts).
registerModalScrollSuite(
  "pipeline-dialogs",
  ["run-history", "pipeline-share", "pipeline-schedule", "mobile-step-sheet"],
  true,
);
