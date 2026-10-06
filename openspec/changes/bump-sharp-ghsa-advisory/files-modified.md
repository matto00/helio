- `frontend/package.json` — override `@vite-pwa/assets-generator`.sharp `^0.35.4` -> `^0.35.5` (one line)
- `frontend/package-lock.json` — lock-only regen (npm 10.9.8, Node v22.23.2). Mechanically derived from the `packages` map, base b16bfa1b3 vs HEAD: 27 keys changed (1 sharp + 16 platform + 10 libvips), none added/removed, no nested @emnapi/runtime move:
### node_modules/sharp
- `node_modules/sharp 0.35.4 -> 0.35.5`
### 16 platform packages
- `node_modules/@img/sharp-darwin-arm64 0.35.4 -> 0.35.5`
- `node_modules/@img/sharp-darwin-x64 0.35.4 -> 0.35.5`
- `node_modules/@img/sharp-freebsd-wasm32 0.35.4 -> 0.35.5`
- `node_modules/@img/sharp-linux-arm 0.35.4 -> 0.35.5`
- `node_modules/@img/sharp-linux-arm64 0.35.4 -> 0.35.5`
- `node_modules/@img/sharp-linux-ppc64 0.35.4 -> 0.35.5`
- `node_modules/@img/sharp-linux-riscv64 0.35.4 -> 0.35.5`
- `node_modules/@img/sharp-linux-s390x 0.35.4 -> 0.35.5`
- `node_modules/@img/sharp-linux-x64 0.35.4 -> 0.35.5`
- `node_modules/@img/sharp-linuxmusl-arm64 0.35.4 -> 0.35.5`
- `node_modules/@img/sharp-linuxmusl-x64 0.35.4 -> 0.35.5`
- `node_modules/@img/sharp-wasm32 0.35.4 -> 0.35.5`
- `node_modules/@img/sharp-webcontainers-wasm32 0.35.4 -> 0.35.5`
- `node_modules/@img/sharp-win32-arm64 0.35.4 -> 0.35.5`
- `node_modules/@img/sharp-win32-ia32 0.35.4 -> 0.35.5`
- `node_modules/@img/sharp-win32-x64 0.35.4 -> 0.35.5`
### 10 libvips packages
- `node_modules/@img/sharp-libvips-darwin-arm64 1.3.3 -> 1.3.4`
- `node_modules/@img/sharp-libvips-darwin-x64 1.3.3 -> 1.3.4`
- `node_modules/@img/sharp-libvips-linux-arm 1.3.3 -> 1.3.4`
- `node_modules/@img/sharp-libvips-linux-arm64 1.3.3 -> 1.3.4`
- `node_modules/@img/sharp-libvips-linux-ppc64 1.3.3 -> 1.3.4`
- `node_modules/@img/sharp-libvips-linux-riscv64 1.3.3 -> 1.3.4`
- `node_modules/@img/sharp-libvips-linux-s390x 1.3.3 -> 1.3.4`
- `node_modules/@img/sharp-libvips-linux-x64 1.3.3 -> 1.3.4`
- `node_modules/@img/sharp-libvips-linuxmusl-arm64 1.3.3 -> 1.3.4`
- `node_modules/@img/sharp-libvips-linuxmusl-x64 1.3.3 -> 1.3.4`

Dependency path: sharp's dependents are @vite-pwa/assets-generator (1.0.2) and sharp-ico (0.1.5), both inside the scoped override subtree.

Evidence (scratchpad, not committed):
- Base red audit (exit 1, GHSA-wq5f-xc86-pv6w): /tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/hel1346-base-red-audit.txt
- Branch green audit (exit 0): /tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/hel1346-branch-green-audit.txt
- Changed key list: /tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/hel1346-changed-keys.txt
- Gates: build/lint/typecheck/format:check/test all exit 0 (4581 tests); logs hel1346-gate-*.txt; generate-pwa-assets exit 0 (hel1346-pwa.txt), regenerated PNGs identical to tracked, untracked favicon.ico removed by exact path.
- npm ls sharp: 0.35.5 (overridden/deduped); runtime sharp.versions.sharp 0.35.5, rsvg 2.63.2.
- Root and helio-mcp lockfiles: 0 occurrences of sharp, unmodified.
