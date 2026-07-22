# Data Viewing Methods and Layout Support

Product and engineering reference for honeybee (coScene Studio / bombus).

This document inventories **how users view robotics data** in the application and **how the layout system supports those viewing methods**. Claims are grounded in the current codebase. Upstream Foxglove documentation is lineage only, not product authority for coScene.

## Related documents

| Document | Scope |
| --- | --- |
| [`docs/layouts.md`](./layouts.md) | Layout ownership, permissions, sync lifecycle |
| `packages/studio-base/src/panels/index.ts` | Builtin panel catalog (`getBuiltin`) |
| `packages/studio-base/src/services/CoSceneILayoutStorage.ts` | `LayoutPermission` model |

---

## Summary

| Concept | Role |
| --- | --- |
| **Data viewing method** | A **panel** (or extension panel) that renders topics and messages—for example 3D, image, plot, table—or a small set of control/auxiliary panels that act on the data path |
| **Layout** | A workspace that **arranges, configures, persists, shares, and pre-selects** panels; it does **not** define a separate visualization algorithm |

Conceptual stack:

```text
Data source (file | connection | sample | persistent-cache | share-manifest)
        → topics / messages
Panels  → data viewing methods
        ↑ arrangement, config, variables, user scripts
Layout  → reusable workspace that supports those methods
```

---

## 1. Data viewing methods

### 1.1 Builtin panels

Source: `getBuiltin()` in `packages/studio-base/src/panels/index.ts`  
Display names: `packages/studio-base/src/i18n/{en,zh}/panels.ts`

There are **23** builtin panel types (including Tab for organization):

| # | Display name (EN / ZH) | Type id | Purpose |
| --- | --- | --- | --- |
| 1 | 3D / 三维 | `3D` | Markers, point clouds, meshes, URDFs, camera imagery in a 3D scene |
| 2 | Image / 图像 | `Image` | Annotated images (implemented as the 3D renderer image mode) |
| 3 | Plot / 图表 | `Plot` | Numerical series over time or another axis |
| 4 | State Transitions / 状态转换 | `StateTransitions` | Discrete value changes over time |
| 5 | Raw Messages / 原始消息 | `RawMessages` | Field-level topic message inspection |
| 6 | Table / 表格 | `Table` | Tabular message browsing |
| 7 | Log / 日志 | `RosOut` | Logs by node and severity |
| 8 | Diagnostics – Detail (ROS) | `DiagnosticStatusPanel` | `DiagnosticArray` detail for a hardware id |
| 9 | Diagnostics – Summary (ROS) | `DiagnosticSummary` | Summary of all diagnostic messages |
| 10 | Map / 地图 | `map` | Geographic map with points / trajectories |
| 11 | Gauge / 仪表 | `Gauge` | Continuous-value gauge |
| 12 | Indicator / 指示器 | `Indicator` | Threshold-driven color/text status |
| 13 | Data Source Info / 数据源信息 | `SourceInfo` | Topics, timestamps, and related source metadata |
| 14 | Moments / 一刻 | `MomentsBar` | Moment/event cards (coScene) |
| 15 | Topic Graph / 主题图 | `TopicGraph` | Graph of nodes, topics, and services |
| 16 | Parameters / 参数 | `Parameters` | Read and write data-source parameters |
| 17 | Publish / 发布 | `Publish` | Publish messages on live connections |
| 18 | Service Call / 调用服务 | `CallService` | Invoke services and inspect results |
| 19 | Teleop / 远程操纵 | `Teleop` | Live robot teleoperation |
| 20 | Data Collection / 数据采集 | `DataCollection` | Live collection commands to device services (coScene) |
| 21 | User Scripts / 用户脚本 | `NodePlayground` | TypeScript transforms that feed other panels |
| 22 | Variable Slider / 变量滑块 | `GlobalVariableSliderPanel` | Layout-scoped numeric variables |
| 23 | Tab / 选项卡 | `Tab` | Groups panels into tabs; does not render message data itself |

#### Selection guide by task

| Task | Preferred panels |
| --- | --- |
| Spatial / robot / point cloud / sensor frames | `3D` |
| Camera frames and annotations | `Image` (cameras may also appear inside `3D`) |
| Time-series metrics | `Plot` |
| State machines / enums over time | `StateTransitions` |
| Message content debugging | `RawMessages`, `Table` |
| Logs and health | `RosOut`, `DiagnosticSummary`, `DiagnosticStatusPanel` |
| Localization on a map | `map` |
| Thresholds / status lights | `Gauge`, `Indicator` |
| System topology | `TopicGraph`, `SourceInfo` |
| Moments / events | `MomentsBar` |
| Live interaction and capture | `Publish`, `CallService`, `Teleop`, `DataCollection`, `Parameters` |
| Derived topics | `NodePlayground` plus downstream panels |

### 1.2 Extension panels (optional)

`PanelCatalogProvider` merges:

1. Builtin panels from `getBuiltin`
2. Panels registered by **installed extensions** (`type = {extensionName}.{registration.name}`)
3. App-injected `extraPanels`

Extension availability depends on deployment and tenant configuration. The fixed product catalog is the **23** builtin types above.

### 1.3 Data sources (input path, not viewing methods)

Data sources supply messages to panels. They are not visualization methods:

| `DataSourceFactoryType` | Description |
| --- | --- |
| `file` | Local or remote files (for example MCAP) |
| `connection` | Live connections |
| `sample` | Sample datasets (may include a `sampleLayout`) |
| `persistent-cache` | Playback from persistent cache |

Share-manifest links additionally load shared data and, when present, a layout definition.

---

## 2. Layout support mechanisms

A layout is a serializable workspace (`LayoutData`): mosaic arrangement, per-panel configuration, global variables, and user scripts. Ownership and sync details are in [`docs/layouts.md`](./layouts.md). This section focuses on how layouts support data viewing.

### 2.1 Spatial arrangement

| Mechanism | Support for viewing |
| --- | --- |
| Single panel | Full-screen focus on one method |
| Row / column split (react-mosaic) | Side-by-side comparison (for example `3D` + `Image` + `Plot`) |
| Nested splits | Multi-sensor dashboards |
| `Tab` panel | Multi-page workflows within one layout |

### 2.2 Ownership and sharing

| Kind | Permission | Support for viewing |
| --- | --- | --- |
| Personal layout | `PERSONAL_WRITE` | Private workspace; may be created offline and synced later |
| Project layout | `PROJECT_WRITE` | Shared project template; requires online access and project write permission |
| Read-only project layout | `PROJECT_READ` | May be opened for viewing; client blocks overwrite save (compatibility) |

The create UI type selector currently offers **personal** and **project** (`PROJECT_WRITE`) only.

### 2.3 How a workspace is obtained

| Mechanism | Support for viewing |
| --- | --- |
| Blank layout | Build any panel combination from scratch |
| Copy / copy from project | Reuse panel placement and topic bindings |
| Import / export JSON | Move complete workspaces across environments |
| Builtin default layout | Fallback when none is selected (`3D` + `Image` + `RawMessages` by default; brand variants below) |
| Sample layout | Sample data sources may ship a ready workspace (NuScenes uses tabs and multiple panels) |
| Share-manifest transient layout | Apply a shared arrangement without storing a personal/project entry (`transient`) |
| URL `layoutId` | Deep-link to an existing personal or project layout |
| Layout history | Restore the last used layout |
| Folders | Organization only; no permission change |
| Desktop `~/.coStudio/layouts/*.json` | Local preset files on desktop |

#### Shipped default and sample compositions

| Artifact | Panel types used |
| --- | --- |
| `defaultLayout.ts` | `3D`, `Image`, `RawMessages` |
| `defaultLayoutKeenon.ts` | `3D`, `Plot`, `RosOut` |
| `defaultLayoutGaussian.ts` | `3D`, `Plot`, `RawMessages`, `RosOut` |
| `SampleNuscenesLayout.json` | Includes `Tab`, `3D`, `Image`, `Plot`, `map`, diagnostics, `RawMessages` (14 panel instances) |

### 2.4 Preferred / recommended layouts

| Concept | i18n key | Notes |
| --- | --- | --- |
| Project preferred | `projectRecommandedLayout` | Intended default workspace at project scope |
| Record preferred | `recordDefaultLayout` | Intended default for a single record; may be removed when switching records (layout manager comments) |

**Known limitations (do not over-claim):**

- App bar logic that ranked `isProjectRecommended` / `isRecordRecommended` and split “public layouts” is **currently commented out**.
- “Public” / organization layout copy remains in i18n, but the permission model remains **personal vs project**—not a stable third ownership class.

### 2.5 Edit lifecycle

| State | Meaning |
| --- | --- |
| `baseline` | Last explicitly saved workspace |
| `working` | Unsaved local edits |
| Save / Revert | Commit or discard working changes |
| Make personal copy | Move shared edits into a personal layout |

---

## 3. Mapping: viewing goals to layouts

| Viewing goal | Typical panels | Layout support |
| --- | --- | --- |
| Single-sensor check | One `Image` or `3D` | Blank or personal single-panel layout |
| Multi-camera + point cloud | Multiple `Image` + `3D` + `Plot` | Mosaic splits; often saved as a **project** layout |
| Metrics + logs | `Plot` + `StateTransitions` + `RosOut` | Personal iteration, then copy to project |
| Onboarding / sample tour | Sample data + sample layout | `sample` factory `sampleLayout` |
| Share “view it this way” | Shared panel arrangement | Share-manifest **transient** layout plus data link |
| Fixed deep-link board | Any stored layout | URL `layoutId` |
| Non-empty first open | Default layout triad | Automatic default when no layout is selected |
| Multi-page workflow | Multiple panel groups | `Tab` within one layout |
| Derived then visualize | `NodePlayground` + consumers | Persist `userNodes` and panel configs in the layout |
| Custom viz | Extension panel types | Same layout system; type ids are extension-qualified |

**Principle:** Builtin and extension panels may appear in personal or project layouts. Layout permission controls **ownership and save/share**, not whether a panel type can render.

---

## 4. Boundaries and non-claims

| Statement | Status |
| --- | --- |
| “A layout is a data viewing method” | **False.** Layouts are workspace containers; panels view data |
| “Only personal and project layouts exist” | **Mostly true for create UX**; also: `PROJECT_READ`, transient share, default/sample |
| “Public/organization is a third ownership type” | **Not a stable product claim** under the current permission model |
| “Project/record preferred layouts are fully productized” | **Partial**—i18n and historical intent exist; ranking UI is commented |
| “Extension panel count is fixed” | **False**—depends on installed extensions |

---

## 5. Source index

| Topic | Path |
| --- | --- |
| Builtin panel catalog | `packages/studio-base/src/panels/index.ts` |
| Panel display strings | `packages/studio-base/src/i18n/en/panels.ts`, `zh/panels.ts` |
| Catalog merge (builtin + extension) | `packages/studio-base/src/providers/PanelCatalogProvider.tsx` |
| Layout data shape | `packages/studio-base/src/context/CurrentLayoutContext/actions.ts` (`LayoutData`) |
| Layout permissions | `packages/studio-base/src/services/CoSceneILayoutStorage.ts` (`LayoutPermission`) |
| Default layouts | `packages/studio-base/src/providers/CurrentLayoutProvider/defaultLayout*.ts` |
| Sample layout | `packages/studio-base/src/dataSources/SampleNuscenesLayout.json` |
| Share-manifest layout | `packages/studio-base/src/components/ShareManifestLayoutSyncAdapter.tsx` |
| Layout UI strings | `packages/studio-base/src/i18n/en/layout.ts`, `zh/layout.ts` |
| Ownership reference | `docs/layouts.md` |

---

## 6. Executive brief

**Data viewing methods** are the **panels** users add to a workspace: twenty-three builtin types covering spatial visualization, imagery, time series, message inspection, diagnostics, maps, live controls, scripts, and organization via tabs, plus optional extension panels.

**Layouts support those methods** by composing panels into a reusable workspace: personal or project ownership, row/column and tab arrangement, default and sample templates, import/export, URL selection, share-manifest application, and save/revert of configuration. Layout type governs collaboration and persistence—not which visualization algorithms are available.
