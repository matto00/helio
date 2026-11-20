import { registerModalScrollSuite } from "./support/modalScrollExtent";

// HEL-1774: modal group "pipeline-editor" of the modal scroll-extent guard (see support/modalScrollExtent.ts).
registerModalScrollSuite("pipeline-editor", ["output-editor", "output-history"]);
