export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

// F-002: `import.meta.env.DEV` can't be referenced directly from a file under
// Jest (ts-jest compiles to CommonJS, where the bare `import.meta` syntax is
// a hard parse error — see `jest.config.cjs`'s `config/env` → `envMock.ts`
// moduleNameMapper entry, the established workaround for the exact same
// problem with `API_BASE_URL` above). Centralizing it here, alongside that
// existing export, lets any file needing a DEV-only code path go through
// this module and get mocked out to `false` in tests instead.
export const IS_DEV = import.meta.env.DEV;
