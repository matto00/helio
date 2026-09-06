# Files Modified

- `e2e/tsconfig.json` — added `"../playwright.regression.config.ts"` to `include`, beside the existing
  `"../playwright.config.ts"` entry, so `check:e2e-types` actually typechecks the regression config file.
