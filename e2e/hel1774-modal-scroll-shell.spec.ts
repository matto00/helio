import { registerModalScrollSuite } from "./support/modalScrollExtent";

// HEL-1774: modal group "shell" of the modal scroll-extent guard (see support/modalScrollExtent.ts).
registerModalScrollSuite("shell", [
  "create-pipeline",
  "add-source",
  "help-overlay",
  "command-palette",
  "quick-launcher",
  "create-connector",
  "mfa-enroll",
]);
