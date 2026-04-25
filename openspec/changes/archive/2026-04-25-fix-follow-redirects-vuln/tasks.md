## 1. Frontend Dependency Patch

- [ ] 1.1 Add `overrides` block to `frontend/package.json` pinning `follow-redirects` to `>=1.16.0`
- [ ] 1.2 Run `npm install` in `frontend/` to regenerate `package-lock.json` with the patched resolution

## 2. Verification

- [ ] 2.1 Run `npm audit` in `frontend/` and confirm no findings for `follow-redirects`
- [ ] 2.2 Run `npm test` in `frontend/` and confirm all tests pass
- [ ] 2.3 Run `npm run lint` in `frontend/` and confirm zero warnings
- [ ] 2.4 Commit `frontend/package.json` and `frontend/package-lock.json`
