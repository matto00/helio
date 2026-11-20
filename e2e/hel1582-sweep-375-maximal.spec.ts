import { SIZES, registerMaximalSweep } from "./support/hel1582Phone";

// HEL-1582: the MAXIMAL sweep at 375px. One of the two `hel1582-sweep-375-*.spec.ts` files (HEL-1789 split the former
// single 375 file so CI's file-level sharding can place the two sweeps apart); the body lives in
// `support/hel1582Phone.ts`, shared with the 390 and 768 files through `registerHeavySweeps`. This width is the only
// MAXIMAL sweep that runs in PR CI (390 and 768 are gated behind HELIO_E2E_SLOW=1, owner ruling). It is one test of
// about 280 s, which cannot be split further.
registerMaximalSweep(SIZES.find((size) => size.width === 375)!);
