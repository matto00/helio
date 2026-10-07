# Audit proof (HEL-1320)

All commands run in frontend/. Base = 5f3990f8e lockfile.

### Red: base lockfile + new (moderate) config
NPM audit report results:
{
}
Found vulnerable advisory paths:
GHSA-hp3w-g68c-fv3c|@jest/expect>jest-snapshot>@jest/transform>babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js>
GHSA-hp3w-g68c-fv3c|@jest/globals>@jest/expect>jest-snapshot>@jest/transform>babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js>
GHSA-hp3w-g68c-fv3c|@jest/reporters>@jest/transform>babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js
GHSA-hp3w-g68c-fv3c|@jest/transform>babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js>
GHSA-hp3w-g68c-fv3c|babel-jest>babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js>
GHSA-hp3w-g68c-fv3c|jest-circus>jest-runtime>@jest/transform>babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js>
GHSA-hp3w-g68c-fv3c|jest-cli>@jest/core>@jest/transform>babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js
GHSA-hp3w-g68c-fv3c|jest-config>jest-runner>@jest/transform>babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js
GHSA-hp3w-g68c-fv3c|jest-resolve-dependencies>jest-snapshot>@jest/transform>babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js
GHSA-hp3w-g68c-fv3c|jest-runtime>@jest/transform>babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js>
GHSA-hp3w-g68c-fv3c|jest-snapshot>@jest/transform>babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js>
GHSA-hp3w-g68c-fv3c|ts-jest>jest>@jest/core>@jest/transform>babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js
Failed security audit due to moderate vulnerabilities.
Vulnerable advisories are:
https://github.com/advisories/GHSA-hp3w-g68c-fv3c
Exiting...
rc=1
### Old threshold (high) on base lockfile
  }
}
Passed npm security audit.
rc=0

### New lockfile + new config (.audit-ci.jsonc, moderate)
```
    }
  }
}
Passed npm security audit.
rc=0
npm audit vulnerabilities: {"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}
helio-frontend@0.0.0 /home/matt/Development/helio/.claude/worktrees/task/frontend-moderate-npm-advisories/hel-1320/frontend
└─┬ ts-jest@29.4.9
  └─┬ @jest/transform@30.3.0
    └─┬ babel-plugin-istanbul@7.0.1
      └─┬ @istanbuljs/load-nyc-config@1.1.0 overridden
        └─┬ js-yaml@4.3.2 overridden
          └── argparse@2.0.1

```

### Lockfile delta (.packages name/version, base -> new; produced by script, not hand-edited)
```
node_modules/argparse 1.0.10 -> 2.0.1
node_modules/esprima 4.0.1 -> -
node_modules/js-yaml 3.15.2 -> 4.3.2
node_modules/sprintf-js 1.0.3 -> -
```

package-lock.json diff: 19 insertions, 34 deletions; package.json: 1 line (override js-yaml ^3.15.2 -> ^4.1.1).

### Gates
- `npx jest --maxWorkers=3` (full): 456 suites / 4807 tests passed, rc=0
- `jest --coverage src/app/App.css.test.ts`: 12 passed, rc=0
- load-nyc-config `.nycrc.yaml` branch (temp file in frontend/, removed): parsed `{"all":true,"reporter":["text"],"checkCoverage":false}` with js-yaml 4.3.2, rc=0

### Base advisory triage
See design.md (regenerated table).
