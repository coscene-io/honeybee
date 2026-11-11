# React 19 upgrade and extension migration

Honeybee uses React and ReactDOM **19.3.1**, React types **19.3.0**, and the automatic
JSX transform in both application builds and Jest. `create-coscene-extension`
**1.1.0** generates extensions with the same versions.

## Runtime boundary

Each built-in extension panel retains its own React root. External extensions
bundle their own React, ReactDOM and JSX runtime; only the extension SDK remains
external. The integration boundary is a DOM container and the SDK's data and
callback interfaces, rather than React elements, hooks or context objects.

There is no React-major-version gate for installed extensions. An extension that
bundles React 18 can continue to work, including its own React 18 legacy renderer.
An extension using the host's React 19, or upgrading its bundled renderer to 19,
must replace `ReactDOM.render` / `unmountComponentAtNode`. Extensions that externalize
React should migrate to the generator's self-contained bundle. The host does not
provide compatibility shims for those APIs or new
shared-React module mappings. Unrelated CLI tools can retain their own React 18;
the application bundles resolve a matched React 19 runtime.

## Rendering and cleanup contract

Every `initPanel` invocation has a separate render session. Registering `onRender`
delivers the latest state even if the child root registers it asynchronously.
Until `done` is called, new input is coalesced into one pending update. The state
builder does not consume those updates while rendering is busy. Top-level render
state objects are snapshots; message arrays and payloads remain shared immutable
references to avoid expensive copying.

Call each frame's `done` after committing the corresponding update. Repeated or
late calls are harmless. Closing, replacing or failing a panel releases its
outstanding playback barrier immediately. The existing five-second timeout
remains a fallback; this protocol does not promise to buffer all historical
frames when a panel exceeds that timeout.

The context becomes inactive immediately when a panel is removed. The adapter
revokes subscriptions, publishers, settings callbacks, range subscriptions and
playback locks synchronously. It then calls the panel's returned cleanup in a
microtask, outside the parent's React commit, and removes the container even if
cleanup throws. An old context cannot mutate a replacement panel.

Return synchronous, idempotent cleanup from `initPanel`, normally
`() => root.unmount()`. Clear `context.onRender` in the effect that registers it,
and release your own timers, workers, listeners and GPU resources. Do not add a
second delayed unmount, or depend on publishing or saving state from cleanup
after the panel has been removed. SDK function signatures and `.coe` format are
unchanged.

## Migrate an existing React extension

Install the paired runtime and types, then use `createRoot` from `react-dom/client`:

```sh
npm install --save-dev --save-exact react@19.3.1 react-dom@19.3.1 @types/react@19.3.0 @types/react-dom@19.3.0
```

Use `jsx: "react-jsx"`. Supply an initial value to `useRef`, preserve nullability in
DOM ref types, replace global `JSX` types with `React.JSX`, and make callback refs
return either nothing or an actual cleanup function. A DnD connector's returned
element is not a valid ref cleanup. Give mapped children stable keys.

Keep React-related packages bundled in custom webpack configurations. Rebuild the
extension with the new generator CLI and validate installation, first render,
message updates, saved settings, removal, and reopening. See the
[official React migration guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide)
for other removed APIs and type changes.

## Dependency decisions

| Dependency                   | Project compatibility work                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| react-json-tree 0.15.1       | Preserve the controlled expansion callbacks and layout persistence patch; fix function defaults and React JSX types. Upgrading to the latest uncontrolled expansion API would change existing behavior. |
| react-mosaic-component 6.2.0 | Fix React JSX/node declarations and keys on default toolbar controls; retain layout and drag APIs.                                                                                                      |
| react-dnd 16.0.1             | Preserve reconnect fixes, read `props.ref`, and compose callback-ref cleanup.                                                                                                                           |
| react-use 17.6.1             | Preserve project behavior patches in both ESM and CommonJS; update removed React declarations.                                                                                                          |
| react-i18next 14.0.5         | Adapt React JSX declarations and React 19 child handling without a translation-library major upgrade.                                                                                                   |
| @mui/material 7.3.11         | Prevent disabled ButtonBase ripples from retaining queued events and detached panel DOM. Cancel pending work on disable/unmount while preserving event callbacks and enabled pointer/focus ripples.     |
| Other UI packages            | react-window 1.8.11, notistack 3.0.2, use-immer 0.11.0, Fluent icons 2.0.345, react-resizable-panels 2.1.9.                                                                                             |

Some upstream peer ranges still omit React 19. These are project-tested patched
versions, not claims of upstream support. `typecheck:react19` checks real public
dependency imports with `skipLibCheck: false` and separately checks the Desktop,
Quicklook and benchmark entries. Existing whole-repository checks remain in place.

The MUI fix addresses a pre-existing leak found during the required repeated-panel
resource comparison on both React 18 and 19. An unresolved `LazyRipple.mounted`
promise retained synthetic events and their `relatedTarget` panel DOM when the
theme disabled ripples. The patch covers both module formats and invalidates
queued callbacks when disabling or unmounting a button; re-enabling still permits
new ripple animations. Keep this regression coverage when updating MUI.

## Acceptance and release

The generator and host are validated together using a real bundled `.coe`, built
from a pinned generator revision. The repeatable commands, artifact provenance,
browser paths and fixed-data performance scenario are in
[the acceptance instructions](../ci/react19/README.md).
The [validation record](react-19-validation.md) records measured results and remaining coverage limits.

Release the host after its stack and the generator PR pass their checks and joint
acceptance, then publish generator 1.1.0. Migrate existing incompatible extensions
individually. Merging, npm publication and production deployment are separate
release actions; this upgrade does not perform them automatically.
