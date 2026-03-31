# Honeybee

Honeybee is an integrated visualization and diagnosis tool for robotics, available in the browser and as a desktop app on Linux, Windows, and macOS.

It helps robotics teams visualize, debug, and analyze logs and live telemetry through a rich set of panels and tools.

![Honeybee](./resources/play-nuScene.gif)

## Availability and Access

- The source code of Honeybee is publicly available.
- Running the app from source requires access to private npm packages, so it does not work out-of-the-box outside our organization.
- To try Honeybee, visit our hosted version at [coscene.cn](https://coscene.cn/), or download the desktop app
  - [Linux ARM64](https://download.coscene.cn/coStudio/packages/latest/coStudio_latest-linux_arm64.deb)
  - [Linux AMD64](https://download.coscene.cn/coStudio/packages/latest/coStudio_latest-linux_amd64.deb)
  - [Windows ARM64](https://download.coscene.cn/coStudio/packages/latest/coStudio_latest-win_arm64.exe)
  - [Windows AMD64](https://download.coscene.cn/coStudio/packages/latest/coStudio_latest-win_x64.exe)
  - [Mac Universal](https://download.coscene.cn/coStudio/packages/latest/coStudio_latest-mac_universal.dmg)
- Internal contributors can follow the setup section below to prepare a development environment.

**Supported development environments:** Linux, Windows, macOS

**Prerequisites:**

- [Node.js](https://nodejs.org/en/) v22 recommended (`package.json` currently allows `>=20`)
- [Corepack](https://nodejs.org/api/corepack.html) enabled, to use the repo-pinned Yarn version
- Access to the private `@coscene-io/*` packages, typically via `GH_PACKAGES_ORG_TOKEN`
- [Cursor](https://www.cursor.com/) or [Visual Studio Code](https://code.visualstudio.com/) is recommended

## Setup

1. Clone the repository.
2. Enable Corepack and install dependencies:

```sh
corepack enable
yarn install
```

3. Start the target you want to work on:

```sh
# Web app
yarn web:serve

# Desktop app (run in two terminals)
yarn desktop:serve
yarn desktop:start

# Storybook
yarn storybook
```

For advanced desktop debugging across different machines or VMs on the same network:

```sh
yarn desktop:serve --host 192.168.xxx.yyy
yarn dlx electron@13.0.0-beta.13 .webpack
```

## Common commands

```sh
yarn run            # list available commands
yarn build:packages # build TypeScript packages
yarn lint           # lint and auto-fix
yarn lint:ci        # CI-style linting without auto-fix
yarn test           # run all tests
yarn test:watch     # run tests in watch mode
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution and localization guidelines.

## :star: Credits

Honeybee originally began as a fork of [Foxglove Studio](https://github.com/foxglove/studio), an open-source project developed by [Foxglove](https://foxglove.dev/).
