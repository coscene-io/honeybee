# @foxglove/studio-base &nbsp; [![npm version](https://img.shields.io/npm/v/@foxglove/studio-base.svg?style=flat)](https://www.npmjs.com/package/@foxglove/studio-base)

This package contains core components used in [Foxglove Studio](https://github.com/foxglove/studio).

## Quick start

When contributing to the [Foxglove Studio](https://github.com/foxglove/studio) codebase, you can import from `@foxglove/studio-base` at its top-level or from lower in its directory:

```
import { ExtensionInfo, ExtensionLoaderContext, ExtensionLoader } from "@foxglove/studio-base";
import fuzzyFilter from "@foxglove/studio-base/util/fuzzyFilter";
```

For a full list of the package's exports, reference its [`index.ts` file](https://github.com/foxglove/studio/blob/main/packages/studio-base/src/index.ts).

## Stay in touch

Join us in [Slack](https://foxglove.dev/slack) to ask questions, share feedback, and stay up to date on what our team is working on.

## Legacy authentication configuration

`DOMAIN_CONFIG.*.authStatusCookieName` is optional and unused. Existing deployment
values remain accepted; built-in defaults omit it. Domain selection for browser
and desktop remote configuration is unchanged. `authStatusCookieDomain` remains
in the compatibility contract. This cleanup does not change SuperTokens cookies.
