# Honeybee

Honeybee is an integrated visualization and diagnosis tool for robotics, available in browser or as a desktop app on Linux, Windows, and macOS.

**Supported development environments:** Linux, Windows, macOS

**Dependencies:**

- [Node.js](https://nodejs.org/en/) v20.0.0+
- [Git LFS](https://git-lfs.github.com/)
- [Visual Studio Code](https://code.visualstudio.com/) – Recommended

## Initialization

> Note: Make sure that all the dependencies are set (specially the [Git LFS](https://git-lfs.github.com/)).

1. Clone repository.
2. Run the follow commands: `corepack enable` and `yarn install`.
3. Launch the development environment:

   ```sh
   # To launch the desktop app (run both scripts concurrently):
   $ yarn desktop:serve        # start webpack
   $ yarn desktop:start        # launch electron

   # To launch the browser app:
   $ yarn web:serve

   # To launch the browser app using a local instance of the backend server:
   $ yarn web:serve:local

   # To launch the storybook:
   $ yarn storybook

   # Advanced usage: running webpack and electron on different computers (or VMs) on the same network
   $ yarn desktop:serve --host 192.168.xxx.yyy         # the address where electron can reach the webpack dev server
   $ yarn dlx electron@13.0.0-beta.13 .webpack # launch the version of electron for the current computer's platform

   # To launch the desktop app using production API endpoints
   $ yarn desktop:serve
   $ yarn desktop:start

   # NOTE: yarn web:serve does not support connecting to the production endpoints
   ```

A [Dockerfile](/Dockerfile) to self-host the browser app is also available.

**Other useful commands:**

    ```sh
    $ yarn run          # list available commands
    $ yarn lint         # lint all files
    $ yarn test         # run all tests
    $ yarn test:watch   # run tests on changed files
    ```

## :star: Credits

Honeybee originally began as a fork of [Foxglove Studio](https://github.com/foxglove/studio), an open-source project developed by [Foxglove](https://foxglove.dev/).
