# React 19 validation — 2026-11-10

The implementation is split into [lifecycle PR #1562](https://github.com/coscene-io/honeybee/pull/1562),
[React 19 PR #1563](https://github.com/coscene-io/honeybee/pull/1563), and
[generator PR #8](https://github.com/coscene-io/create-coscene-extension/pull/8).
No merge, npm publication or deployment is part of these changes.

## Application and extension checks

- React 19 full unit run: **368 suites, 3836 tests, 38 snapshots passed**; one existing test is skipped.
- Repository types, strict imported dependency declarations, additional Desktop/Quicklook/benchmark
  and integration entrypoint types, and repository lint passed.
- Production Web builds at both `/viz/` and `/`, Desktop and Quicklook passed. Existing bundle-size
  warnings remain.
- Real generated `.coe` installation, saved state, reload restoration, render acknowledgments,
  removal and reopening passed in Web at both public paths and Desktop. CI recreates the artifact
  from the pinned generator commit rather than injecting host React into a fake plugin.
- 3D, Image, Map, Gauge, Indicator, Service Call and Teleop production roots each completed two
  mount/seek/close cycles. Anonymous DataCollection intentionally has no content root; its real
  content and provider were separately exercised twice with a fake user/API and real React roots.
- All five React examples and the native Worker example passed two real Desktop panel lifecycles.
  Monaco editing and TypeScript worker diagnostics worked without CDN requests or changes to the
  host's Monaco globals. Its shared language worker remains bounded across reopening; the native
  Worker example terminates its worker on each removal. Converter output and topic alias callbacks
  are checked by the generator's package verification script.

The full unit runner can still emit a worker-exit warning. All 17 affected suites (90 tests), including
lifecycle, refs, hooks, translation, layout, Sentry, MUI and DataCollection, were also checked with
`--detectOpenHandles` and exited without reported handles; do not interpret
successful test assertions as proof that every unrelated test in the repository has perfect teardown.
An unchanged IndexedDB maintenance test also exhibited a background-janitor race while builds ran
concurrently; its isolated rerun and the subsequent full run passed without suppressing warnings.

## Performance

Apple M4 Pro, 48 GiB, macOS arm64; fixed `example.bag`, 1280×900, one self-contained React 19 panel
on both hosts. The React 18 baseline is `68cf3381eca61d8aaec4b69bcd281328af165e60`.
Both versions ran three times sequentially in the same idle measurement window.

| Median                                      | React 18.3.1 | React 19.3.1 | Change |
| ------------------------------------------- | -----------: | -----------: | -----: |
| First committed message, original metric    |     196.0 ms |     210.7 ms | +7.50% |
| File change event → first committed message |     192.0 ms |     207.0 ms | +7.81% |
| Seek, nine samples                          |      21.9 ms |      21.5 ms | −1.83% |
| Committed playback-time updates             |     57.786/s |     57.925/s | +0.24% |

The roughly 15 ms first-message increase is real in this sample; it is below the agreed 10%
regression gate. An earlier comparison against a baseline measured at a different time showed
10.6%; it was not reproduced in the final paired comparison. The original metric was retained,
and the added file-selection breakdown did not replace it to obtain a passing result.
No five-second stall occurred. This small workload does not establish GPU frame rate or performance
for every panel and dataset. The [raw runs](../ci/react19/results/2026-11-10-performance.json)
preserve every sample, hardware information and artifact hashes.

## Resource regression found and fixed

Two warm-up cycles followed by twelve close/reopen cycles initially retained **3201 DOM nodes and
417 listeners** on both the React 18 baseline and the upgraded host. Heap retainers identified MUI
ButtonBase's unresolved disabled-ripple promise holding synthetic events and `relatedTarget` DOM.
The MUI patch prevents that queue, settles pending work on disable/unmount, and prevents cancelled
events from replaying after re-enabling. Enabled pointer/focus animations and user callbacks remain
covered by regression tests.

After the fix, final samples at 0/4/8/12 measured cycles were **939/939/939/924 DOM nodes** and
**544/544/542/541 listeners**; heap usage decreased by approximately 2.91 MiB. Extension containers,
content roots and removed host panels were collected. At most one latest popover per menu remained
visible to the sampler; the add menu is held by MUI's modal reference. These counts stay bounded
rather than growing with each panel.
The production resource regression test checks node identities with weak references, not an
arbitrary heap-byte threshold, and rejects the unpatched React 18 artifact.

## Reproduction and remaining limits

Use [the acceptance commands](../ci/react19/README.md) and the exact pinned generator commit.
The final generator is `067f303469454c7a192f231e1e3455f531e55722`; its regenerated fixture's
production JavaScript is byte-identical to the fixture used for performance measurements.

Live robot service calls, Teleop publishing to hardware, authenticated real-time collection,
GPS map correctness, image pixel correctness, and high-volume 3D/video GPU workloads are not
established by these smoke checks. Tests requiring additional media samples remain unverified.
Monaco retains its existing 0.33.0 editor/sanitizer baseline; this React upgrade is not an editor
security upgrade. Release only after both repositories' checks and the pinned cross-repository
integration jobs are green; publish the host before generator 1.1.0.
