# React 19 extension and application acceptance

The fixture uses `create-coscene-extension` commit
`067f303469454c7a192f231e1e3455f531e55722` (version 1.1.0). Build its tarball from that
revision, not from npm's currently published CLI. The builder verifies all archive
paths and file bytes using the canonical payload SHA-256
`299a4cb466358d5478e356afad731a5b1219c7ebacf9be22cb4d0eb06daa6415`.
Tar/gzip metadata and executable-bit differences do not alter that identity;
the actual archive SHA-256 is separately recorded in provenance. Only regular
files and directories are accepted. The builder uses the system `tar` on macOS/Linux.

```sh
git -C ../create-coscene-extension checkout 067f303469454c7a192f231e1e3455f531e55722
(cd ../create-coscene-extension && yarn install --immutable && yarn build && yarn pack --out /tmp/create-coscene-extension-react19.tgz)
node ci/react19/build-extension-fixture.cjs /tmp/create-coscene-extension-react19.tgz
```

The builder instantiates the pinned generator's template, installs the committed
`fixture/package-lock.json` with `npm ci`, and invokes its real `build` and `package`
commands. It replaces the sample panel with `ExamplePanel.tsx.fixture` to expose lifecycle
observations. The generator's `create` command and example packages are validated in
the generator repository; the host regression does not resolve fresh npm ranges.
React 19 is bundled by the generator; tests do not inject React or add host `require`
mappings. The generated `.coe` and provenance are written under
ignored `temp/react19-extension/`. The generator tarball entry deliberately omits
npm's archive integrity: tar/gzip metadata varies by platform, so the builder verifies
the canonical payload hash before installation. Registry packages retain their locked
versions and integrity hashes. To refresh dependencies, copy the fixture manifests
into an ignored temporary directory beside a verified `generator.tgz`, update the
lock there, and review/copy both manifests back to `fixture/`.

CI builds this fixture once and shares the exact `.coe`, lock, and provenance across
Web `/viz/`, Web `/`, and Desktop. The standalone browser dependency checks run only
in the `/viz/` job because their page does not use the application's public path.
Desktop also runs built-in panel smoke and the resource regression, and uploads its
resource JSON even if a test fails. Its controlled fixtures opt into SwiftShader with
`HONEYBEE_TEST_SOFTWARE_GL=1` on GPU-less CI runners; this is not a GPU performance test.
These jobs and static/unit checks feed the existing
required `lint` check; a failed or skipped prerequisite cannot produce a passing gate.
Draft PRs skip validation; newer commits cancel earlier runs of the same PR or branch.
Main-branch pushes call CD only after the gate passes, using the same commit context.
CD retains manual/release triggers and uses a distinct concurrency group so it cannot
cancel its calling CI workflow. Generator examples remain an explicit acceptance
command below, and paired performance sampling
remains a same-machine acceptance task rather than a shared-runner timing gate.

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

The production resource regression and built-in root smoke checks use the same artifacts:

```sh
INTEGRATION_SKIP_BUILD=1 yarn jest --config desktop/integration-test/jest.config.json desktop/integration-test/react19Resources.test.ts desktop/integration-test/react19Builtins.test.ts --runInBand
```

The resource check warms up twice, then closes and reopens twelve panels. It checks paired lifecycle
events and garbage collection of removed extension/root/host-panel DOM through weak references.
Set `HONEYBEE_REACT_RESOURCE_OUTPUT` to choose the JSON output path. An optional
`HONEYBEE_REACT_RESOURCE_HEAP_SNAPSHOT` captures a local diagnostic heap snapshot; do not publish
heap snapshots from profiles containing real user data.

After running the generator's `yarn test:e2e package.tgz --examples`, use its printed artifact
directory to check all five React examples and the native Worker example in the real host:

```sh
INTEGRATION_SKIP_BUILD=1 HONEYBEE_REACT19_EXAMPLES_DIR=/path/to/verification-artifacts yarn jest --config desktop/integration-test/jest.config.json desktop/integration-test/react19Examples.test.ts --runInBand
```

The committed [validation record](../../docs/react-19-validation.md) distinguishes production smoke
coverage from live device/media behavior and includes the measured resource/performance results.

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
