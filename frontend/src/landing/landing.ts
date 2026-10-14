// Entry for the static landing page (`index.html`). Deliberately imports nothing from the app (React, Redux,
// axios): `scripts/check-landing-build.mjs` asserts no chunk reachable from the landing HTML contains them.
import "../theme/theme.css";
import "../shared/ui/tapTarget.css";
import "./landing.css";
import { initBeta } from "./betaWiring";
import { initBuild } from "./build";
import { initReel } from "./reel";

initReel();
initBuild();
initBeta();
