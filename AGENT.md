# Agent Rules

- During implementation, do not run lint, format, typecheck, or build verification repeatedly after each edit unless it is needed to diagnose a specific failure. Make the intended code changes first, then run verification once at the end.

- Before finishing a task, inspect the final changed files.

- If any `.ts` or `.tsx` file was changed, run the final fast verification block once before finishing:
  - `git diff --check`
  - `yarn run tsc --noEmit`
  - `yarn eslint --cache --cache-strategy content --cache-location .eslintcache --report-unused-disable-directives --config eslint.config.ci.cjs <changed-ts-or-tsx-files>`

- If behavior changed in a `.ts` or `.tsx` file and there is a related nearby test, run the most specific related test before finishing, for example:
  - `yarn jest path/to/related.test.tsx`
  - or `yarn test path/to/related.test.tsx --runInBand`

- If the change touches shared types, public interfaces, state machines, worker bridges, iterable/data sources, or test mock shapes, also run a representative integration-style test for the affected area.

- If no related test exists for a behavior change, mention that explicitly in the final response.

- After changing dependency files such as `package.json` or `yarn.lock`, ensure the lockfile is consistent, then run:
  - `yarn install --immutable`

- If a verification command fails, fix the issue and rerun the same command until it passes, or clearly report why it cannot be verified.

- Use `yarn run lint:ci`, `yarn run test --ci`, or `yarn format:check` only when the change has broad impact or targeted checks leave meaningful risk.
