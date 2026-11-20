import { registerModalScrollSuite } from "./support/modalScrollExtent";

// HEL-1774: modal group "pipeline-palettes" of the modal scroll-extent guard (see support/modalScrollExtent.ts).
registerModalScrollSuite("pipeline-palettes", ["step-palette", "shape-picker", "add-root"]);
