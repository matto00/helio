import { ACTIONS, describeMode } from "./support/hel1733-draft-outputs-shapes";

// HEL-1733: Output create, edit and delete, shapes and the aggregate tail are DRAFT entries while a pipeline draft is
// open. Each of the eight actions, with a draft already open: is enabled; sends no Output/step write and no request that
// names a client id (`draft-...`); shows the change in the spine's Outputs section; and Save & run then sends ONE
// `draft/save` whose body carries it. After a reload the saved Outputs equal what the draft showed. Desktop runs in
// light, the 375px phone in dark; one desktop-dark and one phone-light smoke cover the other pairs. Every wait is a
// readiness signal (an aria-current row, a loaded row count, the sheet's populated field picker).
// Part of HEL-1733 split by HEL-1778 (hel1733-draft-outputs-shapes.spec.ts): the phone part; shared code in support/hel1733-draft-outputs-shapes.ts.

describeMode("phone", "dark", ACTIONS);
describeMode("phone", "light", [ACTIONS[0]]);
