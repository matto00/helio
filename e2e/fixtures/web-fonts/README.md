# Local web-fonts fixture (HEL-1757)

Every e2e browser gets the app's Google Fonts from a local copy, so a stalled
`fonts.googleapis.com` / `fonts.gstatic.com` request can never hold a
`page.goto` (`load`) open, and the real web faces (Fraunces, Schibsted
Grotesk, JetBrains Mono) still render.

## How it works

- `playwright.config.ts` adds two Chromium switches to the top-level
  `use.launchOptions.args` (built by `e2e/support/webFontsHost.ts`):
  `--host-rules=MAP fonts.googleapis.com 127.0.0.1:<P>,MAP fonts.gstatic.com 127.0.0.1:<P>` and
  `--ignore-certificate-errors-spki-list=<SPKI sha256 of test-cert.pem>`. Every
  browser, every context (including `browser.newContext()`) and every page
  route that `continue()`s a fonts request reaches the server. There is no
  Playwright route, so no Fetch interception and the HTTP cache is untouched.
- `server.mjs` is started by the config's `webServer` and serves the committed
  copy: the exact CSS responses for the two `css2` URLs in
  `frontend/app.html` and `frontend/index.html`, and every `.woff2` they
  reference (`files/`, mapped by `manifest.json`), with the content type, CORS
  and `cache-control` Google sent.
- Port `<P>` is `HELIO_E2E_WEB_FONTS_PORT`, else `DEV_PORT + 20000` (25173 in CI).
- An unknown fonts URL gets an immediate 404; the fonts global teardown then
  fails the run naming it. The teardown also fails if the server died or was
  replaced. `e2e/hel1757-web-fonts-local.spec.ts` fails when an app font URL
  or a font file a committed stylesheet references has no committed copy.
- Concurrent Playwright runs in one worktree are unsupported: the launching run
  stops the server when it ends, and the other run's teardown then fails.

## The committed private key is test-only

`test-key.pem` / `test-cert.pem` are a throwaway key pair (SANs `fonts.googleapis.com`,
`fonts.gstatic.com`, valid 100 years). The private key is committed on purpose and
protects nothing. Chromium trusts it only through the SPKI pin, and only the two fonts
hosts are mapped to the server that holds it, so it grants nothing anywhere else.

## Refreshing the copy

`node e2e/fixtures/web-fonts/refresh.mjs` recaptures from Google with the user
agent of the Playwright Chromium the suite runs (the pin otherwise stays until
re-run). Never hand-edit `files/`; `.prettierignore` keeps the verbatim CSS unformatted.

## Diagnostic switch

`HELIO_E2E_WEB_FONTS_LOCAL=0` drops the switches, the `webServer` and the fonts
setup/teardown together (read only in `playwright.config.ts`). It exists to
reproduce the original hang; do not use it for normal runs.

## Licences

Fraunces, Schibsted Grotesk and JetBrains Mono are SIL Open Font License 1.1;
the texts are `OFL-*.txt` here.
