# Layout Types

This document describes every **layout type** currently supported by honeybee (coScene Studio / bombus). A *layout* is a named, persistable arrangement of panels, panel configs, global variables, and user scripts used when visualizing data.

For the inventory of **data viewing methods** (panels) and how layouts support them, see [`docs/data-viewing-and-layouts.md`](./data-viewing-and-layouts.md).

Primary code references:

| Area | Path |
| --- | --- |
| Permission model | `packages/studio-base/src/services/CoSceneILayoutStorage.ts` |
| Layout manager API | `packages/studio-base/src/services/CoSceneILayoutManager.ts` |
| Layout data shape | `packages/studio-base/src/context/CurrentLayoutContext/actions.ts` |
| Mosaic / tab types | `packages/studio-base/src/types/layouts.ts` |
| Create-layout UI | `packages/studio-base/src/components/CoSceneLayout/createLayout/` |
| Layout browser UI | `packages/studio-base/src/components/CoSceneLayout/` |
| Backend resource | `@coscene-io/cosceneapis-es-v2` → `Layout` + `LayoutScope` |

---

## 1. Core types by ownership / permission

The product type system is `LayoutPermission`:

```ts
type LayoutPermission = "PERSONAL_WRITE" | "PROJECT_READ" | "PROJECT_WRITE";
```

This maps to the backend `LayoutScope`:

| Frontend permission | Backend scope | Resource name pattern | Who can edit |
| --- | --- | --- | --- |
| `PERSONAL_WRITE` | `LAYOUT_SCOPE_PERSONAL` | `users/{user}/layouts/{layout}` | Owning user |
| `PROJECT_WRITE` | `LAYOUT_SCOPE_PROJECT` | `warehouses/{wh}/projects/{project}/layouts/{layout}` | Project members with write permission |
| `PROJECT_READ` | (project scope, read-only client flag) | project layout name pattern | The current layout UI hides or disables editing |

### 1.1 Personal layout (`PERSONAL_WRITE`)

- Owned by a single user.
- Default type when creating a blank layout, importing a file, or duplicating into personal space.
- When a user is loaded, stored under the user parent (`users/{userId}`).
- Can be created while offline (queued as `syncInfo.status = "new"` and synced later when online). If no user is loaded yet, the local record has an empty parent and an id such as `/layouts/{layout}` until synchronization assigns its remote user parent.
- Shown under the **Personal** sidebar category in the layout drawer.
- Icon: person.

### 1.2 Project layout (`PROJECT_WRITE`)

- Shared with all members of a project.
- Requires remote layout storage (`supportsSharing`) and an online connection to create/share.
- Creating/updating project layouts requires the corresponding Console API permission (`createProjectLayout` / `updateProjectLayout` / `deleteProjectLayout`).
- Renames and folder moves for project layouts go directly to the server.
- Shown under the **Project** sidebar category.
- Icon: business / briefcase.

### 1.3 Read-only project layout (`PROJECT_READ`)

- Still part of the client type union.
- Treated as project-scoped via `layoutIsProject()`. Current layout UI call sites use `layoutIsRead()` to disable rename, move, delete, and save-overwrite actions.
- `CoSceneLayoutManager.overwriteLayout()` does not itself reject `PROJECT_READ`; callers outside those UI paths must enforce the read-only permission before invoking manager mutations.
- Not offered as a create option in the current create/copy dialogs (only `PERSONAL_WRITE` and `PROJECT_WRITE` appear in the **Type** selector).
- Kept for compatibility with older shared/read layouts and permission checks.

**Create-UI “Type” field (user-facing):**

| Label | Value |
| --- | --- |
| Personal layout | `PERSONAL_WRITE` |
| Project layout | `PROJECT_WRITE` (disabled when `supportsProjectWrite` is false) |

---

## 2. UI categories in the layout browser

The layout drawer (`CoSceneLayoutContent`) filters by category, independent of folders:

| Category | Filter | Notes |
| --- | --- | --- |
| **All layouts** | no permission filter | Default browse view |
| **Personal** | `permission === "PERSONAL_WRITE"` | Includes personal folders |
| **Project** | `layoutIsProject(layout)` | Includes both `PROJECT_WRITE` and `PROJECT_READ` |

Older app-bar menu code also had sections for:

| Section (i18n) | Meaning |
| --- | --- |
| Personal | User layouts |
| Organization | Shared/org layouts when `supportsSharing` |
| Public layouts | Shown for `AUTHENTICATED_USER` project role |

> Note: logic that split **project preferred / record preferred** into a separate “public” list is currently commented out, but the i18n strings remain.

---

## 3. Preferred / recommended layout designations

These are product concepts for *which* layout should open by default in a context. Strings exist in i18n:

| i18n key | EN | ZH |
| --- | --- | --- |
| `projectRecommandedLayout` | Project preferred | 项目推荐布局 |
| `recordDefaultLayout` | Record preferred | 记录推荐布局 |

Behavior notes from the layout manager:

- **Record preferred** layouts may be ephemeral: when the user opens another record, the layout can disappear from local storage. Updates that miss the layout in that window are expected (`// if this layout is record recommended layout, this error is expected`).
- Historical UI priority (commented): record recommended weight `2`, project recommended weight `1`.

They are designations / selection rules, not separate `LayoutPermission` values. The underlying layout is still personal or project-scoped.

---

## 4. Creation sources (how a layout enters the system)

Supported ways to create or load a layout:

| Source | Description | Typical permission |
| --- | --- | --- |
| **Create blank layout** | Empty `configById` / no panels | Personal (or project if allowed) |
| **Copy from project** | Clone another project’s layout into personal or project | Chosen in dialog |
| **Copy / duplicate existing** | Copy dialog or “make a personal copy” of a shared layout | Personal or project |
| **Import from file** | Load a `.json` layout export | Personal or project |
| **Export to file** | Download layout JSON (inverse of import) | n/a |
| **Built-in default** | `defaultLayout` (and brand variants such as Keenon / Gaussian) when nothing is selected | Not a saved remote layout |
| **Sample data layout** | Data source factories may ship a `sampleLayout` (e.g. NuScenes) | Applied as current layout data |
| **Share-manifest layout** | Transient layout from a share link / manifest (`share-manifest-layout`) | Transient, not persisted as personal/project |
| **URL `layoutId`** | Deep link selects an existing layout by id | Existing personal/project layout |
| **Layout history** | Last-used layout restored via local history (`getHistory` / `putHistory`) | Previous selection |

### 4.1 Transient layouts

Some layouts are applied as the *current* layout without becoming a normal managed personal/project entry:

- **Share-manifest** layouts (`ShareManifestLayoutSyncAdapter`) use a fixed id `share-manifest-layout`, `transient: true`.
- If the share manifest has no layout URL, a blank shared layout is still applied so the viewer is not empty.

---

## 5. Layout data model (what a layout *contains*)

Regardless of ownership type, the serializable payload is `LayoutData`:

```ts
type LayoutData = {
  configById: SavedProps;          // panel id → panel config
  layout?: MosaicNode<string>;     // panel tree (react-mosaic)
  globalVariables: GlobalVariables;
  userNodes: UserScripts;          // user scripts / Node Playground
  version?: number;                // reject older clients if too new
};
```

### 5.1 Mosaic arrangement types

The spatial tree (`layout`) supports:

| Arrangement | Description |
| --- | --- |
| **Single panel** | Leaf node: one panel id string |
| **Row split** | `direction: "row"` with `first` / `second` and `splitPercentage` |
| **Column split** | `direction: "column"` with the same structure |
| **Nested splits** | Arbitrary nesting of row/column branches |
| **Tab panel** | Panel type `Tab` holding multiple named tabs, each with its own nested mosaic |

Tab-related types (`TabConfig`, `TabPanelConfig`, `TabLocation`) live in `types/layouts.ts`.

### 5.2 Baseline vs working copy

Every managed `Layout` record has:

| Field | Meaning |
| --- | --- |
| `baseline` | Last explicitly saved version (plus modifier metadata) |
| `working` | Unsaved local edits since last save; `undefined` when clean |

Unsaved layouts show a working indicator in the UI and offer **Save** / **Revert**.

### 5.3 Sync status

When remote storage is present, `syncInfo.status` can be:

| Status | Meaning |
| --- | --- |
| `new` | Created locally, not yet uploaded |
| `updated` | Local changes pending remote overwrite |
| `tracked` | In sync with remote baseline |
| `locally-deleted` | Marked deleted locally; remote delete pending |
| `remotely-deleted` | Deleted on server; local copy may still show if working edits exist |

---

## 6. Folders

Layouts of either personal or project type can live in a **folder** string:

- Empty string = root of that category.
- Folders are per-category (personal folders vs project folders).
- Users can create a new folder name when saving, or **Move to folder** later.
- Folders are organization metadata only; they do not change permission.

---

## 7. Permissions and capability matrix (summary)

| Action | Personal write | Project write | Project read |
| --- | --- | --- | --- |
| Select / use | ✅ | ✅ | ✅ |
| Edit panels (working copy) | ✅ | ✅ | ✅ (local working only; save blocked) |
| Save / overwrite baseline | ✅ | ✅ (needs API + online) | ❌ |
| Revert working | ✅ | ✅ | ✅ |
| Rename | ✅ | ✅ (needs API) | ❌ |
| Move folder | ✅ | ✅ (needs API) | ❌ |
| Delete | ✅ | ✅ (needs API) | ❌ |
| Export JSON | ✅ | ✅ | ✅ |
| Copy to personal / project | ✅ | ✅ | ✅ |
| Create offline | ✅ | ❌ | ❌ |

Exact project write/delete availability is gated by Console API permission helpers and login/project context (`supportsProjectWrite`, role checks).

---

## 8. Brand / product default layout variants

Built-in fallbacks used when no layout is selected (not user-managed types, but supported shipped layouts):

| Module | Use |
| --- | --- |
| `defaultLayout.ts` | Default 3D + Image + Raw Messages arrangement |
| `defaultLayoutKeenon.ts` | Keenon brand default |
| `defaultLayoutGaussian.ts` | Gaussian brand default |

---

## 9. Quick glossary

| Term | Definition |
| --- | --- |
| **Layout** | Named panel arrangement + configs + variables + scripts |
| **Panel** | One visualization widget inside a layout (3D, Plot, Image, …) |
| **Permission / scope** | Personal vs project ownership model |
| **Folder** | Optional grouping within personal or project |
| **Baseline** | Last saved remote/local version |
| **Working** | Unsaved edits |
| **Preferred (project/record)** | Default-selection designation for a project or a record |
| **Transient layout** | Applied for a session/share without normal persistence |
| **Mosaic** | Tree that describes row/column panel splits |

---

## 10. What is *not* a separate layout type

These are easy to confuse with layout types but are different concepts:

- **Panel types** (3D, Plot, Log, Tab, Map, …) — contents of a layout, not ownership types.
- **Data sources** (file, connection, sample, persistent-cache) — how data is loaded, not layouts.
- **Layout view** (`BASIC` vs `FULL` in the backend API) — whether metadata-only or full data is returned; not a user-facing layout kind.

---

## Changelog notes for maintainers

When adding a new layout type, update:

1. `LayoutPermission` (and helpers) if ownership semantics change.
2. Backend `LayoutScope` mapping in `CoSceneConsoleApiRemoteLayoutStorage`.
3. Create/copy dialogs **Type** selectors.
4. Layout browser filters and icons.
5. i18n keys under `layout` namespace (`en` / `zh` / `ja` as applicable).
6. This document.
