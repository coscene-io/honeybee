# Image 面板缩放卡顿：测量、根因与修复

实验日期：2026-11-17。分支 `seg-zoom-perf`，起点 `c1fe1a816`；基线 `68cf3381e`（本分支与 `main` 的合并基点，即语义分割改动之前）。全部数据来自生产构建。

## 结论

- **卡在编辑态（进入空间标注后），而且是空转：** 只要标注会话开着，所有 Image 面板就一直满帧重绘，不需要任何输入。主线程在 2.2 s 采样里忙 2405–2570 ms（≈100%），空闲时 rAF p95 已经是 33 ms（正式服务）或 50 ms（本机标注 + 桌面 mask）。缩放、平移只是让用户感觉到了。
- **根因是一个反馈环**（都在 `61c066c51` "feat: add the semantic segmentation editor" 中引入；它是压缩后的单个提交，不能再 bisect 细分）：
  `endFrame` → `segmentation-frame` 事件 → `SegmentationImageEntry.sync` → `runtime.registerSource` → 无条件 `store.setState({ document: {...} })` 和 `service.updateSourceMetadata` → mask 叠加源 `invalidate()` → 每个面板的 `SegmentationMaskLayer` `queueAnimationFrame` → 下一次 `endFrame` ……
  每圈的开销取决于后端：本机标注每圈把整份文档（含桌面 mask）`JSON.stringify` 后写进 localStorage（`persist` + `setItem` 约占 CPU 的 1/3）；正式服务每圈 `mergeSourceMetadata` + `reindex` + `rebuildSummaries` + 通知 timeline，并让整个实例树（`SpatialTree`、`CameraFrameStrip`）重渲染。
- **不进标注时**：本次在 1× 和 4× CPU 下都没有测到可感知的卡顿（rAF p95 与基线相同，约 17.5 ms，无长任务）。不过缩放时主线程的工作量是基线的约 3 倍（44 ms → 128–139 ms / 2.2 s），主要来自 `captureSegmentationImageMetadata → nativeImageView` 每帧逐顶点投影网格。修复后这部分在缩放时仍然存在，因为每帧视图都真的变了（见「未解决」）。
- **修复**（3 个本地提交，未 push）：`registerSource` 在没有新视频、新尺寸、新帧时直接返回，切断环路；`sync` 只在解码图像或帧来源变化时重建帧表，表面状态不变时不通知订阅者；`nativeImageView` 按网格缓存，`PreviewPolygons` 在帧和视图都没变时保留原状态。
- **修复后**：编辑态空闲 rAF p95 回到 17.5 ms，缩放/平移时 rAF p95 17.3–17.6 ms，没有超过 33 ms 的间隔；主线程忙碌 2405 → 398 ms（正式服务）、2570 → 395 ms（本机 + 桌面 mask）。

### 前后对比（1× CPU，中间大相机 head_rgbd，同一帧 11:09:55.555）

每档 3 轮（「修复前 · 只读（正式服务）」只有 2 轮），表中是各轮数值的中位数，单位 ms。滚轮列：20 次 wheel，间隔 16 ms（前 10 次放大、后 10 次缩小）。平移列：拖动 20 步再拖回 20 步，间隔 16 ms。延迟 = 输入事件到下一帧 rAF 之后的 MessageChannel 回调。忙碌 = 单独一轮 CPU profile 中非 idle 的采样时间 / 总时长。

| 场景 | 轮 | 空闲 rAF p95 | 滚轮 rAF p95 | 滚轮 rAF 最大 | 滚轮 >33ms | 滚轮延迟 p50 / p95 | 平移 rAF p95 | 平移延迟 p50 / p95 | 长任务 | 主线程忙碌 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 基线 68cf3381e · 只读 | 3 | 17.6 | 17.5 | 17.7 | 0% | 8.6 / 14.3 | 17.6 | 11.4 / 17.1 | 0 | 44 / 2203 |
| 修复前 · 只读（正式服务，本帧无标注） | 2 | 17.6 | 17.5 | 17.7 | 0% | 13.2 / 20 | 17.6 | 10.3 / 17 | 0 | 128 / 2200 |
| 修复后 · 只读（正式服务） | 3 | 17.6 | 17.6 | 17.6 | 0% | 11.7 / 18.6 | 17.6 | 9.2 / 17.5 | 0 | 139 / 2206 |
| 修复前 · 只读（本机，桌面 mask） | 3 | 16.8 | 17.3 | 17.7 | 0% | 13.6 / 17.1 | 17.5 | 8.9 / 16.8 | 0 | 129 / 2205 |
| 修复后 · 只读（本机，桌面 mask） | 3 | 17.4 | 17.5 | 17.6 | 0% | 9.6 / 15.1 | 17.3 | 11 / 17 | 0 | 未采 |
| **修复前 · 编辑（正式服务）** | 3 | **33.4** | **33.4** | 33.7 | 8.3% | 20.8 / 22.8 | **33.6** | 21 / 23.7 | 0 | **2405 / 2406** |
| 修复后 · 编辑（正式服务） | 3 | 17.5 | 17.5 | 17.7 | 0% | 10.5 / 25.1 | 17.6 | 14 / 17.7 | 0 | 398 / 2202 |
| **修复前 · 编辑（本机，桌面 mask）** | 3 | **50.5** | **50.1** | 50.7 | **50%** | **48.1 / 60.9** | **50.1** | **44.5 / 47.7** | 1 | **2570 / 2571** |
| 修复后 · 编辑（本机，桌面 mask） | 3 | 17.4 | 17.3 | 17.5 | 0% | 14.4 / 17.7 | 17.4 | 13.9 / 18.3 | 0 | 395 / 2203 |

编辑态的滚轮事件计数是 40：编辑画布接住 wheel 再转发给原生 canvas，两次都计入延迟。

## 测量方法

- 环境：Apple M4 Max，ego Chromium，task space `seg zoom perf`，视口 1888×942、DPR 2，推荐五相机布局，云端录像 CJ260330-3-R154。
- 构建与服务：两个 worktree 各自 `yarn web:build:prod`，用 `serve-prod.py`（恢复自 `04bd10093^:benchmark/serve-mask-production.py`）在 `/viz/` 下提供。当前分支 8085，基线 8086（临时 `git worktree add --detach`）。8085 doctor 通过；8086 用 `lsof` 确认 cwd 是基线 worktree。
- 登录：在同一 ego profile 中把 `dev.coscene.cn` 的登录态复制到两个 localhost origin，只在脚本内存中传递，没有输出或落盘。
- 打开：带防缓存参数的录像 URL，点击时间轴 78% 的位置 → 11:09:55.555（暂停）。修复后重新构建时，第一次打开命中了浏览器缓存的旧 `index.html`，那组数据移到 `invalid-stale-cache/`，不计入；之后每次打开都核对 `main.*.js` 的哈希。
- **可见性**：窗口不在可见桌面时，空闲 rAF 约 1 Hz，数据无效（请用户把窗口切到前台过两次）。每轮先测 1.2 s 空闲 rAF，p95 > 20 ms 就作废，除非空闲卡顿本身就是被测现象（修复前编辑态）。
- **输入方式**：CDP `Input.dispatchMouseEvent` 在这个 ego 版本里每个 wheel 要等约 1 s 才返回，基线也一样（`trial-*`），不能用来测量。改为在页面内用 `setTimeout` 按 16 ms 节奏，向 `elementFromPoint` 命中的元素派发 `WheelEvent` / `PointerEvent` + `MouseEvent`（只读预览用左键，编辑态用中键平移）。截图 `zoomed-in-8085.png` 确认合成滚轮确实缩放了画面。代价是不经过浏览器输入管线，延迟不含合成器排队。
- 指标：rAF 间隔分位数、`longtask` PerformanceObserver、每个输入事件到下一帧的延迟；CPU profile 使用 CDP Profiler，采样间隔 200 µs，用当时构建的 sourcemap 映射回源码。每轮之前做一次 GC。
- 「有/无服务端标注」：dev 后端这一帧上有别人留下的 `[honeybee-it] perf` 实例（我没有修改它），只读预览里没有 SVG 多边形。「桌面」场景在 `本机标注` 模式下用本机 SAM2（127.0.0.1:18876，父工作区的 sidecar，只调用 `/segment`）点 5 个正点生成桌面 mask，提交到本机存储，不写 dev 后端。

## Profile 证据

修复前，本机 + 桌面 mask，编辑态（`prof-cur-edit-desk.rep0.cpuprofile`，主线程忙碌 2570/2571 ms）：

| 自身耗时 | 函数 |
|---:|---|
| 609 | (program) |
| 398 | `localStorage.setItem` |
| 191 | `persist` mockService.ts:299 |
| 84 | `mergeSourceMetadata` service.ts:310 |
| 45 | `nativeImageView` |

包含时间：`Renderer` 帧 975 → `ThreeDeeRender` endFrame 监听 928 → `SegmentationImageEntry` onFrame/sync 924 → `registerSource` 706 → `persist` 590。

修复前，正式服务，编辑态（`prof-cur-edit-live`，2405/2406 ms）：`sync` 699，`registerSource` 318，`updateSourceMetadata` 231（`mergeSourceMetadata` 152、`rebuildSummaries` 74），`captureSegmentationImage → nativeImageView` 203，`SpatialTree` 106，`cameraStripCells`/`cameraFrameStrip` 66。

修复后，同样两个场景（`prof-final-edit-*`）：忙碌 395–398 ms，剩下的主要是缩放本身驱动的 React/Emotion 重渲染和 `nativeImageView`，都分摊在各帧里，没有长任务。

只读预览，修复前（`prof-cur-preview`，128 ms）与修复后（`prof-final-preview-live`，139 ms）：`captureSegmentationImageMetadata → nativeImageView` 约 27–29 ms，三处 three.js 投影约 10 ms。基线（`prof-base-preview`）合计 44 ms。

## 根因细节

1. `ThreeDeeRender.tsx` 在每个 `endFrame` 派发 `segmentation-frame`。
2. 编辑会话打开时，`SegmentationImageEntry.sync` 每次都会从播放器缓存、本轮消息和面板解码缓存重建帧时间戳（`receivedFrameStamps`），然后调用 `registerSource`。
3. `runtime.registerSource` 不管表有没有变化，都会 `mergeSourceMetadata`（含排序）、`service.updateSourceMetadata`，再 `store.setState({ document: {...} })`。
4. `installMaskOverlaySource` 订阅了 runtime store 的 `document`，一变就 `segmentationMaskOverlay.invalidate()`，每个 `SegmentationMaskLayer` 随即 `renderer.queueAnimationFrame()`。
5. 新的一帧又回到第 1 步。5 个面板互相触发，所以即使只有一个面板有 mask 或标注，五路都在重绘。

只读预览不进入这个环路：`sync` 在 `session.open` 为假时会提前返回。

## 修复

| 提交 | 内容 |
|---|---|
| `5278585bd` fix: stop the annotation session from re-rendering every frame | `service.sourceMetadataChanges()` 判断这次合并会不会改动来源表（新视频、视频变长、新解码尺寸、新帧，或者有冲突）；`registerSource` 在没有改动时直接返回。冲突仍然交给 `mergeSourceMetadata` 抛错。帧 ID 索引按帧表数组缓存在 WeakMap 里。新增 `runtime.test.ts` 用例。 |
| `0144fdd99` perf: rebuild a panel's source table only when its sources change | `sync` 记录上次注册时读到的来源（解码图像、binding、runtime、播放器缓存块和消息数、tick 消息、面板解码缓存帧数），都没变就跳过重建。`publish` 在表面状态不变时返回原 state，不通知订阅者。 |
| `cb6b63403` perf: reuse the native image view until the camera or mesh changes | `cachedNativeImageView` 按 mesh 缓存，以 mesh/camera 矩阵、尺寸和几何版本作为键，视图不变时保持对象身份；`PreviewPolygons` 在帧和视图都没变时保留 state。新增 `nativeImageTransform.test.ts` 用例。 |

## 校验

- `npx tsc --noEmit -p packages/studio-base/tsconfig.json`：通过。
- 改动文件 ESLint 与 Prettier：通过。
- `yarn jest packages/studio-base/src/semanticSegmentation packages/studio-base/src/panels/ThreeDeeRender`：854 个用例中，每次全量运行有 1 个时序相关用例偶发失败（`NativeStreamPresentation` 或 `WorkflowStopping`，每次不同），单独运行均通过（各 6 次以上）。在未改动的 HEAD worktree 上做对照，`semanticSegmentation/components` 4 次运行中 HEAD 也失败 1 次（同一文件），分支 0 次，所以判断是既有的时序抖动，不是这次改动引入的。
- 实页冒烟（修复后构建，`smoke-edit-*.png`，截图都已读回）：本机编辑态下一帧 → 桌面 mask 消失、树显示「当前帧缺席」；上一帧 → mask 恢复、「当前帧存在」，没有出现「当前帧尚无来源元数据」。只读预览播放约 0.8 s 后时钟前进、暂停正常（`final-preview-playing.png`）。

## 未验证 / 未解决

- **大量 SVG 多边形**：用户提示桌面会生成很多多边形。本次 SAM 结果保存为 GPU mask（树显示「0 块」）；双击 mask 转多边形编辑的操作两次都没有触发成功，所以「多边形很多的只读预览 / 编辑」没有测到。只读的 `PreviewPolygons` 修复前每帧都会用新 state 重渲染并重新生成全部 path；修复后在视图不变时不会，但缩放时视图每帧都在变，仍然会全部重生成。多边形很多时这可能就是「不进标注也卡」的来源，下一步应先构造多边形场景（例如用 `segMockMasks` 或画多边形）再测。
- **不进标注的剩余开销**：修复后只读缩放仍是基线 JS 时间的约 3 倍（139 vs 44 ms / 2.2 s），主要是 `nativeImageView` 对 `PlaneGeometry` 网格每帧做两遍逐顶点投影。相机是 `PerspectiveCamera`，仿射检查依赖投影，不能只在网格变化时做；可以改为只投影四个角、仿射检查只在几何或投影类型变化时做，这需要另外证明正确性，本次没有改。
- **CPU 节流**：`cpu4-*` 两组数据和 1× 几乎一样，没有核实 `Emulation.setCPUThrottlingRate` 在这个 ego 版本里是否生效，所以不把它们当作低端设备结论。
- 播放中的缩放、多面板同时缩放、dev 构建、触控板捏合（ctrl+wheel）都没有测。输入是页面内派发的合成事件，不含合成器和输入管线的延迟。
- 正式服务编辑态的测量帧上带有别人的 `[honeybee-it] perf` 测试实例；没有写入任何服务端数据。

## 证据

目录 `/tmp/verify-seg/zoom-perf/`：

- `*.json`：每轮原始 rAF 时间戳、长任务、逐输入延迟。命名：`base-*` 基线，`cur-*`/`trial3-cur-*` 修复前，`final-*` 修复后。`trial-*`、`trial2-*` 是 CDP 输入方式和窗口不可见时的无效样本，保留但不计入。
- `prof-*.rep0.cpuprofile`：CPU profile。`web/.webpack` 已被修复后的构建覆盖，修复前的 profile 要映射回源码，需要在 `c1fe1a816` 上重新构建（文中的数字是在当时构建下映射得到的）。
- `tools/`：`measure.mjs`、`run-measure.sh`、`open.mjs`、`enter.mjs`、`leave.mjs`、`analyze-profile.cjs`、`serve-prod.py`、`S.sh`。
- 截图：`open-*.png`、`zoomed-in-8085.png`、`desk-sam-before-enter.png`、`desk-saved.png`、`desk-preview-after-exit.png`、`smoke-edit-{start,next,prev}.png`、`final-preview-{playing,paused}.png`。

## 副作用

- 浏览器 localhost:8085 的存储里留有本机标注「桌面」类别和一个实例（只在这个浏览器里）。测试时设置的 `coStudio.semanticSegmentation.backend` 和 `segmentUrl` 两个键已经删除。
- `packages/studio-web/public/cos-config.js` 是本地测试配置，没有提交。
