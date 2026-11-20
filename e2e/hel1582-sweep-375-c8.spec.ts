import { SIZES, registerC8Sweep } from "./support/hel1582Phone";

// HEL-1582: the every-step-kind C8 hit-area sweep at 375px. One of the two `hel1582-sweep-375-*.spec.ts` files (HEL-1789
// split the former single 375 file so CI's file-level sharding can place the two sweeps apart); the bodies live in
// `support/hel1582Phone.ts`, shared with the 390 and 768 files through `registerHeavySweeps`.
registerC8Sweep(SIZES.find((size) => size.width === 375)!);
