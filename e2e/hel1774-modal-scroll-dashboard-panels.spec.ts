import { registerModalScrollSuite } from "./support/modalScrollExtent";

// HEL-1774: modal group "dashboard-panels" of the modal scroll-extent guard (see support/modalScrollExtent.ts).
registerModalScrollSuite("dashboard-panels", [
  "panel-detail-edit",
  "dashboard-share",
  "panel-fullscreen",
]);
