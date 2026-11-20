import { registerModalScrollSuite } from "./support/modalScrollExtent";

// HEL-1774: modal group "dashboard-dialogs" of the modal scroll-extent guard (see support/modalScrollExtent.ts).
registerModalScrollSuite("dashboard-dialogs", ["panel-inspect", "output-picker", "ask-drawer"]);
