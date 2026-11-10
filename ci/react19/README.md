# React 19 extension and application acceptance

The fixture uses `create-coscene-extension` commit
`ffba92ab9ee50044a11206ac91de2505f35b320d` (version 1.1.0). Build its tarball from that
revision, not from npm's currently published CLI. The builder verifies the tarball
SHA-256 (`9a4464b63bb111db2b9b35770c19957902074bda2c42dcd4e6d2662649cfcba3`):

```sh
git -C ../create-coscene-extension checkout ffba92ab9ee50044a11206ac91de2505f35b320d
(cd ../create-coscene-extension && yarn install --immutable && yarn build && yarn pack --out /tmp/create-coscene-extension-react19.tgz)
node ci/react19/build-extension-fixture.cjs /tmp/create-coscene-extension-react19.tgz
```

The builder invokes the generator's real `create`, `build`, and `package` commands.
It replaces the sample panel with `ExamplePanel.tsx.fixture` to expose lifecycle
observations. React 19 is bundled by the generator; tests do not inject React or
add host `require` mappings. The generated `.coe` and provenance are written under
ignored `temp/react19-extension/`.

With the corresponding production artifacts built:

```sh
INTEGRATION_SKIP_BUILD=1 yarn jest --config web/integration-test/jest.config.json web/integration-test/reactUpgradeExtension.test.ts --runInBand
INTEGRATION_SKIP_BUILD=1 yarn jest --config desktop/integration-test/jest.config.json desktop/integration-test/open-extension.test.ts --runInBand
```

Run Web once with each artifact (`/viz/` and standalone `/`). Set
`HONEYBEE_REACT_BENCHMARK_APP_DIR` to its output directory and
`HONEYBEE_WEB_PUBLIC_PATH=/` for standalone. The lifecycle scenario saves panel state, reloads the page, verifies the installed
extension and state are restored, then checks two remove/re-add cycles with fresh
state. The Desktop harness isolates both
Electron user data and extension storage in temporary directories.

For performance, use the _same generated `.coe`_ with baseline and upgraded
Desktop artifacts. Run them sequentially on the same machine without a build or
other benchmark competing for resources:

```sh
INTEGRATION_SKIP_BUILD=1 HONEYBEE_REACT_BENCHMARK_APP_DIR=/path/to/desktop/.webpack HONEYBEE_REACT_BENCHMARK_LABEL=react18 HONEYBEE_REACT_BENCHMARK_OUTPUT=/tmp/react18.json yarn jest --config desktop/integration-test/jest.config.json desktop/integration-test/reactUpgradeBenchmark.test.ts --runInBand
```

Repeat with the React 19 artifact and a different label/output. Each run creates a
fresh profile and fixed 1280×900 one-panel layout, opens the tracked `example.bag`,
measures time to its first committed message, seeks three positions, and counts
committed playback-time updates during five seconds of playback. It repeats this three times.
Compare the distributions; a single cold run is not a release gate. The commit
rate measures this extension's host-driven data path, not every built-in panel or
GPU rendering throughput. The unchanged React 19 extension on both hosts keeps
its own rendering runtime constant. Playback commits may contain no new messages; the
first-message metric separately requires a committed frame with messages.

`firstDataMs` retains the original measurement beginning before Playwright calls
`setInputFiles`. `fileSelectionOverheadMs` ends at the file input's captured DOM
`change` event, and `inputToFirstDataMs` measures from that event to the first
committed message. Report all three; the additional breakdown must not replace
the original metric simply because it produces a better comparison. For a new
regression investigation, repeat baseline and upgraded samples close together
after all other browser tests finish.
