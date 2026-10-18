import { SIZES, registerHeavySweeps } from "./support/hel1582Phone";

// HEL-1582: the heavy phone sweeps at 375px (the every-step-kind C8 hit-area sweep and the MAXIMAL sweep), one spec file
// per viewport so CI's file-level sharding can place them on different shards. The bodies live in
// `support/hel1582Phone.ts`. This width is the only MAXIMAL sweep that runs in PR CI (390 and 768 are gated behind
// HELIO_E2E_SLOW=1, owner ruling).
registerHeavySweeps(SIZES.find((size) => size.width === 375)!);
