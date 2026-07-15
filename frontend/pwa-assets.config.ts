import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

// PWA icon generation (HEL-300 / notes/mobile-pwa-handoff.md W1).
//
// Source: public/orbit-mark.svg (transparent background, accent-coloured mark).
//
// Background note: standard (192/512) and maskable icons keep the preset default
// (transparent / white respectively) because manifest icons render against the
// manifest's own background_color. Apple touch icons are the one exception —
// iOS composites transparent PNGs onto solid black, which would clip the
// OrbitMark's stroke against a black square. We override the apple background to
// the light-theme `--app-bg` (#f4f2ed, see theme.css) rather than the preset's
// generic white, so the touch icon matches the manifest's chosen splash colour
// (decision 5 in design.md — light is the splash default).
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    transparent: {
      ...minimal2023Preset.transparent,
      // The preset's default 64px icon is referenced by nothing (the manifest
      // uses 192/512 only) but would land in the SW precache via the png glob.
      sizes: [192, 512],
    },
    apple: {
      ...minimal2023Preset.apple,
      resizeOptions: {
        fit: "contain",
        background: "#f4f2ed",
      },
    },
  },
  images: ["public/orbit-mark.svg"],
});
