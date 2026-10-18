import { SIZES, registerHeavySweeps } from "./support/hel1582Phone";

// HEL-1582: the heavy phone sweeps at 768px (the every-step-kind C8 hit-area sweep and the MAXIMAL sweep), one spec file
// per viewport so CI's file-level sharding can place them on different shards. The bodies live in
// `support/hel1582Phone.ts`. The MAXIMAL sweep at this width is gated behind HELIO_E2E_SLOW=1 (CI legs time out at 18
// minutes; owner ruling, slow-lane follow-up); the every-kind C8 sweep stays in PR CI.
registerHeavySweeps(SIZES.find((size) => size.width === 768)!);
