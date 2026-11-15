# 语义分割 Mask 性能基准

实验日期：2026-11-12。分支 `seg-mask-benchmark`，基线 `9a69ea79a`。已完成84个正式播放样本（54个两项优化、24个原版、6个仅PNG优化），全部通过预期Mask覆盖检查；profile、最终构建冒烟和交互尝试另列。成功拖动验证仍未闭环，不能给出拖动容量结论。

## 环境与隔离

- Apple M4 Max，14 核，36 GiB RAM；macOS 27.0.1 (26A434)，Darwin 27.0.0。
- ego Chromium 156.0.8078.74 / V8 15.6.75.25；独立 task space `seg mask benchmark isolated`。
- 固定 viewport 1920×973，推荐 Astribot S1 五相机布局，视频 1×，云端录像 CJ260330-3-R154。
- 子工作区 `/Volumes/Users/kylefang/orca/workspaces/honeybee/seg-mask-benchmark`；服务 `http://localhost:8082/viz/`。父 8081 未操作。
- `yarn web:build:prod` 成功后用 `python3 -I benchmark/serve-mask-production.py --port 8082` 提供真实 Web 应用生产产物。`PORT=8082 .claude/skills/verify-honeybee-segmentation/scripts/doctor.sh` 核对 PID、cwd 和 HTTP 200。
- 8082 初次缺少登录会跳回 dev 云端。用户授权后，仅在浏览器进程内复用已有登录到新 origin，不输出凭证，不写文件。云端页面截图 `initial.png` 不计入子代码证据。
- `packages/studio-web/public/cos-config.js` 推荐布局开关为本地测试配置，不提交。无云端布局创建、无合成标注提交、无用户存储清理。

## 真实表示与 fixture

`semanticSegmentation/types.ts`：Mask 是按录像、相机 topic、真实 `logTimeNs` 绑定的实例多边形。点是 [0,1] 归一化坐标。一个 FrameInstance 可以含多个 polygons。`SegmentationCanvas.tsx` 用 SVG path 填充和描边；编辑选中的每个顶点还生成一个 g 和两个 circle。`AnnotationPreview.tsx` 是退出编辑后的只读覆盖层。**编辑会话播放时 Mask 实际隐藏**：`SegmentationCanvas.tsx:2200` 的 `(!compact || (nativeView != undefined && !disabled))` 排除了播放时 disabled 的嵌入画布。逐 rAF path 计数已验证播放时为0，暂停后恢复。因此编辑播放数据只保留为隐藏 Mask 的基线，正式有 Mask 播放测试走退出编辑后的真实只读覆盖层；选择/拖动和逐帧则进入编辑会话测试。

`maskBenchmark.ts` 仅在 localhost/127.0.0.1 且显式 `segBenchmark=<JSON>` 参数存在时替换服务。无该参数不启用。fixture 不读写 localStorage、不调用后端，提交/回滚被拒绝；界面类别名显示 `BENCHMARK · memory only`。

可独立改变：`vertices` 每个多边形点数、`instances` 实例数、`polygons` 每实例每相机多边形数、`cameras` 有标注相机数、`startSec`/`durationSec` 跨帧覆盖范围、`seed`。`vertices=0` 是无 Mask；`shape=mock,vertices=4` 用四点矩形和 10px/源帧平移、最大 0.08 归一化偏移构造简单基线。这是简单平移负载的代理，不是 mockService 传播算法的逐行复刻；mock 定时延迟不计作推理。`cameras=1` 默认仍解码五路视频，只一相机有 Mask；它隔离叠加几何成本，并不等同于单视频解码布局。

复杂轮廓有严格递增极角和正半径，包含低频轮廓与较高频边界细节；每个原生帧的点数组独立、形状随时间连续变化，不复制同一点。固定 seed 可复现。此合成几何模拟轮廓负载，不宣称是真实模型输出或真实目标分割。unit test 验证确定性、点唯一、边界、面积和逐帧变化。

`maskBenchmark.frames.json` 保存该录像 9971 个原生消息的精确纳秒时间戳，按 topic 分组，以十进制字符串避免 JavaScript 整数精度损失。此录像的 publish_time 与 log_time 相等，因此帧 ID 保持 `${video.id}:${ns}:${ns}`。仅显式基准模式动态加载该清单，只向源元数据注入配置时间窗口中的帧。四秒窗口五路各有 119–121 帧；完整几何约为当前可见顶点的 120 倍，每帧独立数组。服务和 runtime 的帧表同步补齐，不依赖解码器的预取进度。测试覆盖初始仅一帧、后续注册新相机的情况。

早期 fixture 使用当时 decoder/cache 的部分帧表。诊断证实部分相机只有约 76–80 个标注帧，播放到后续真实源帧时就没有 Mask。旧结果中 `coverageValid=false` 的样本是基准覆盖缺陷，不是渲染容量极限，也不能用较低的耗时声称优化收益。最终 `continuous-*` 数据均使用完整 manifest。

“总可见顶点”=当前实际显示帧所有有标注相机的多边形点数之和，不是整个时间窗口存储点数，也不因填充/描边两条 path 重复计数。选择时的顶点 handle 数另记。

## 运行

1. 独立安装 `yarn install --immutable`，开启本地推荐布局配置。
2. `yarn web:build:prod`。
3. `python3 -I benchmark/serve-mask-production.py --port 8082`，运行 doctor。
4. 使用 ego 在独立 task space 打开云端录像，确认 URL 的 origin 仍是 localhost:8082。生产版路径为 `/viz/`。
5. 以 `benchmark/mask-perf-continuous.json` 为正式播放矩阵；编辑、profile、对照分别见 `mask-perf-continuous-edit.json`、`mask-perf-continuous-profile.json`、`mask-perf-baseline.json`。复制计划并给每次运行一个新的 label，脚本拒绝覆盖已有结果。其它 plan 是探索/失败诊断记录，不作为默认入口。
6. `python3 -I benchmark/run-mask-benchmark.py`（可用 `--plan /absolute/plan.json`）。launcher 将当前工作区绝对路径传给 ego，不另外创建浏览器。脚本从当前独立标签页取得录像 URL，不把登录数据写入结果。每档重载页面，正常 UI seek/进入标注/播放/逐帧。结果逐次写 JSON；异常和部分数据会保留；finally 恢复 CPU 1×。

每档先解码源帧再进入编辑，固定时间轴 61%（约源起点后 40.54 秒），连续标注窗口 [40,44) 秒，预热一次同一窗口，正式 3 次、每次约 2 秒，均从同一位置开始。保持浏览器 HTTP/解码缓存热状态，重复前 collectGarbage，避免把不同 GC 起点混入。重载与初次窗口数据加载不计入播放。UI 操作/传输使采样首尾有小量额外 wall time；JSON 保留实际 duration、播放时钟和源时间戳。

## 测量口径

- rAF：浏览器回调间隔，p50/p95/p99 数值排序。报告 >20ms 与 >33.34ms 比例。它是 UI 主线程刷新机会，不是显示器硬件呈现，也不是视频 FPS。
- longtask：PerformanceObserver 的主线程 ≥50ms 长任务，数量、明细和总时间。不是 GPU/worker 总耗时。
- 每路呈现：逐 rAF 观察 overlay `data-log-time-ns`，记录不同显示源时间戳。这是呈现采样；不能直接推导完整视频源丢帧，因为采样自身可能漏过两次更新。
- Mask 覆盖：逐 rAF 计数真实多边形描边 path；播放前后解析 path 的 M/L 点数。需要整个采样窗口保持非空覆盖，才可称作有 Mask 播放结果。
- 输入：捕获真实 pointerdown/up/keydown 到双 rAF，包含调度等待；不是标准 INP，也不是硬件触摸延迟。
- seek 就绪：点击时间轴后，全部可见相机 `data-source-ready=true`，且实际显示时间戳位于目标 `1774926584257770000ns` 之前 60ms 内。避免把 seek 前遗留的 ready 状态误记为新帧已就绪。
- 逐帧就绪：真实下一帧按钮点击前到 head 时间戳增长且增量 <50ms，全部可见相机 `data-source-ready=true`。两种延迟均包含工具往返、解码/seek/React/标注窗口就绪，不能当纯 decoder 时间；旧探索样本使用较弱条件，不纳入最终延迟汇总。
- Heap：每档结束后 collectGarbage，再取 CDP Runtime.getHeapUsage；usedSize 是主线程 V8 heap，backingStorageSize 单列。不覆盖 GPU、VideoFrame、worker 和进程总 RSS。旧样本未统一 GC，波动明显，不能拼成内存容量曲线。
- CPU 节流：CDP Emulation.setCPUThrottlingRate，通过固定 2,000,000 次 sqrt 运算校验。只近似浏览器 CPU 速度，不对应某个低端设备，不模拟 GPU、网络、硬件解码或内存带宽。
- ego 呈现条件：发现窗口被系统遮挡时，即使 visibilityState=visible/hasFocus=true，rAF 也降至约1Hz且无对应longtask。移窗口只能短暂缓解。最终通过支持的 CDP Page.startScreencast（JPEG quality1，1×1像素，每帧，40ms轮询ACK）维持持续呈现；暂停4秒校验241次rAF、最大17.7ms。所有正式档位相同条件，逐档1200ms空闲rAF预检。存在GPU回读/截图调度开销，结果是此受控观测条件下的容量；不是无工具开销硬件FPS。失效遮挡样本单独归档，不纳入容量。

## 现有指标入口与局限

| 入口 | 实际测量 | 本实验是否直接复用 |
|---|---|---|
| `benchmark/src/BenchmarkStats.ts` / `window.recordFrameTimes` | 合成播放器 await listener wall time，每100样本汇总 | 原入口不含 Mask；现有 values.sort() 未传数值比较器，median/P90 不宜照用 |
| `yarn benchmark:serve` / `benchmark:build:prod` | pointcloud/sinewave/transform 等合成源 | 不覆盖真实云端分割 UI |
| `web/integration-test/remoteMp4Benchmark.test.ts` / `yarn benchmark:remote-mp4` | MP4 初始化、canvas截图变化、seek、Range、longtask、heap | 复用 longtask/heap 测量思路；按用户要求通过 ego 驱动，而不启动其测试浏览器 |
| `services/playbackPerformanceTelemetry.ts` | 默认10%采样；seek accepted→player ready+无关键帧搜索+250ms quiet，15s timeout；GOP/range/longtask计数 | 不等于实际解码画面呈现，不能代替本实验就绪探针 |
| `players/IterablePlayer/IterablePlayer.ts:959` | backfill返回后、queueEmitState前 markPlayerReady | 不含最后渲染/paint |
| `context/PerformanceContext.ts` | 默认 no-op，UserScriptPlayer 消费 | 未发现真实视频 registry/provider |
| `panels/ThreeDeeRender/Stats.tsx` | GL drawcalls/triangles/textures、相邻update间隔、主线程heap | 不包含SVG路径数或GPU timer |
| `benchmark/moments-perf.mjs` | 生产隔离UI，rAF、输入→双rAF、CDP CPU | 本实验参考同一测量定义 |
| `ImageRenderable.ts` / `WorkerImageDecoder.worker.ts` | 30ms target /100ms any-frame等待截止，媒体帧时间戳 | 未发现完整解码 duration 指标；这些阈值不能当解码耗时上限 |

## 热点与实现

CPU profile 显示两个可独立处理的热点：

1. 只读 `AnnotationPreview` 每次取得当前视频帧时走完整截图接口。原始无 Mask profile 的 `toDataURL` self time 为约 1479/4203ms（35%）；10k 五路为约 1427/3987ms（36%）。这里的同步 PNG 编码是额外截图成本，不能称为 H.264 解码成本。新增 `captureSegmentationImageMetadata()` 和对应 canvas WeakMap，让只读覆盖层只读精确显示帧身份与原生坐标变换；编辑截图保留完整 PNG 接口。测试覆盖无编码、准确身份和 seek 隔离。
2. 多实例时 `SpatialTree` 对完整跨帧 `annotations` 反复做 `Object.values().find/filter`。原始 10 实例 profile 的两个树扫描位置 self time 合计约 2279/6372ms（36%）。四处当前帧/可见帧的查询改为规范的 `frameInstanceKey(frameId, instanceId)` 字典查找；不降低几何精度、不改变帧匹配，也没有隐藏顶点。剩余树构造、SVG、React 和其他扫描仍有成本，这不是对整个渲染器的重写。

优化后的 `continuous-profile` 两份 profile 均未采样到 `toDataURL` self time。多实例 profile 约 4234ms 中，`SpatialTree.tsx:313` self 274ms、`PreviewPolygons` self 256ms、`frameInstanceKey` self 121ms，以及 React/Emotion、GC 仍显著；旧扫描热点退去不代表多实例已经流畅。profile 单独采集，不混入普通三轮对照统计。

对照构建脚本 `benchmark/build-mask-comparison.py baseline` 暂时恢复 HEAD 的 `AnnotationPreview.tsx` 与 `SpatialTree.tsx`，构建到单独的 `benchmark/.mask-build-baseline`，在 finally 中恢复精确工作文件。完整 manifest、基准服务、指标和帧身份逻辑保持一致。`png-only` 只恢复 SpatialTree，用于分辨两项收益。运行构建期间停止性能采样，避免编译竞争 CPU。比较后检查工作文件已恢复，不产生 commit/stash。

## 结果

以下均为三轮中“各轮分位数/比例的中位数”，单位 ms；不是将不同轮的全部 rAF 混在一起计算。长任务列是三轮总数量。每轮预热、GC、同一源窗口、真实 UI 播放/暂停；所有正式播放样本 `coverageValid=true`。优化后无 Mask/mock 使用无编译或测试竞争的 `continuous-control` 重跑，其余使用 `continuous-optimized-rest`；对照使用 `continuous-baseline` 和 `continuous-baseline-rest`。这些是完整播放操作窗口的 rAF，含开始/暂停控制边界，因此 p99 也反映边界停顿，不能称为纯稳态视频 FPS。

### 五路、1× CPU、每相机一个多边形

| 总可见顶点 | 原版 p95 | 两项优化 p50 | p95 | p99 | >20ms | >33.34ms | 长任务总数 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 无 Mask | 50.6 | 16.7 | 17.5 | 17.6 | 0.0% | 0.0% | 0 |
| 简单 mock（20点） | 51.1 | 16.7 | 17.5 | 33.3 | 2.3% | 0.8% | 0 |
| 1k | 66.6 | 16.7 | 17.5 | 50.0 | 3.1% | 1.5% | 4 |
| 5k | 51.6 | 16.7 | 17.5 | 33.4 | 1.8% | 1.7% | 3 |
| 10k | 66.7 | 16.7 | 17.7 | 200.0 | 3.6% | 2.7% | 5 |
| 50k | 83.3 | 16.7 | 49.0 | 66.8 | 22.8% | 14.8% | 1 |
| 100k | 100.1 | 32.4 | 66.7 | 282.6 | 50.0% | 35.6% | 5 |

10k 的 p95 改善约 73%，50k 约 41%，100k 约 33%。但这不是所有分位数都改善：原版 10k/100k 的 p99 约 83.1/116.7ms，优化后操作窗口的尾部反而更长。小样本、控制边界、不同更新节奏和文档回收都有可能影响尾部，不能仅凭 p95 宣布“已无卡顿”。1k 与 5k 也不单调，不拟合精确的每顶点成本。

### 同样 10k 顶点，改变结构与相机布局

| 配置（两项优化） | p50 | p95 | p99 | >33.34ms | 三轮长任务 |
|---|---:|---:|---:|---:|---:|
| 1实例、五路共5多边形 | 16.7 | 17.7 | 200.0 | 2.7% | 5 |
| 10实例、五路共50多边形 | 33.4 | 117.6 | 249.1 | 50.9% | 9 |
| 1实例、五路共50多边形 | 16.9 | 66.9 | 433.3 | 35.7% | 5 |
| 1实例、5多边形，8秒几何 | 16.7 | 17.7 | 182.4 | 2.8% | 7 |
| 五路视频，仅一路有一个10k多边形 | 16.7 | 17.7 | 17.7 | 0.9% | 5 |
| 真正只保留一个相机面板，一个10k多边形 | 16.7 | 17.6 | 116.7 | 1.9% | 6 |

10实例原版 p50/p95 为 116.6/150.0ms，>33.34ms 为79.6%，三轮192个长任务；两项优化后 p95 改善约22%，长任务次数减少，但仍明显卡顿。相同点数不能给出统一容量：实例数、多边形数与编辑手柄数都必须单列。8秒 fixture 已核对每路239–241个标注帧，而非只增加一个未生效的配置参数。

### 分开验证两项优化

同一完整 manifest、每档三轮，`continuous-png-only.json` 只启用元数据接口，SpatialTree 仍为 HEAD 版本：

| 配置 / 版本 | p50 | p95 | p99 | 三轮长任务 |
|---|---:|---:|---:|---:|
| 10k / 原版 | 16.8 | 66.7 | 83.1 | 0 |
| 10k / 仅去掉只读 PNG | 16.7 | 33.2 | 33.6 | 0 |
| 10k / 再改树查询 | 16.7 | 17.7 | 200.0 | 5 |
| 10k、10实例 / 原版 | 116.6 | 150.0 | 150.0 | 192 |
| 10k、10实例 / 仅去掉只读 PNG | 85.2 | 117.6 | 118.3 | 204 |
| 10k、10实例 / 再改树查询 | 33.4 | 117.6 | 249.1 | 9 |

第二项优化在多实例下改善了中位刷新间隔与长任务频率，但此样本的 p95 没有进一步降低，p99 也没有改善。不可把两个改动都描述成“所有指标显著提速”。

### CPU 节流（五路、两项优化）

| CPU | 顶点 | p50 | p95 | p99 | >33.34ms | 三轮长任务 |
|---|---|---:|---:|---:|---:|---:|
| 4× | 无 | 99.0 | 116.0 | 117.4 | 75.6% | 3 |
| 4× | 1k | 132.4 | 150.8 | 166.7 | 70.3% | 23 |
| 4× | 10k | 133.0 | 166.7 | 166.9 | 66.7% | 70 |
| 6× | 无 | 133.3 | 166.2 | 166.7 | 74.4% | 74 |
| 6× | 1k | 100.1 | 133.5 | 134.4 | 79.5% | 51 |
| 6× | 10k | 100.9 | 133.6 | 166.6 | 74.0% | 58 |

校验运算 checksum 完全相同；1× 约1–2ms、4× 约3.5–5.9ms、6× 约5.8–10.5ms，节流实际生效。6× 部分有 Mask 数字比无 Mask 更低，甚至低于4×，表明短窗口与调度/回收噪声不能忽略；不能解读成更多 Mask 或更慢 CPU 会更快。稳健结论是：五路在4×/6×下即使无 Mask 也已有严重刷新间隔问题，不能把高配1×的几何预算照搬过去。

### seek 与逐帧

下表 seek 是三轮中位数，逐帧是每档一次；均包含工具往返，且按实际显示源时间戳与所有相机 ready 校验。

| 配置（两项优化） | seek 就绪 ms | 下一原生帧就绪 ms |
|---|---:|---:|
| 无 Mask、五路1× | 762 | 805 |
| 10k、五路1× | 648 | 956 |
| 50k、五路1× | 1383 | 1782 |
| 100k、五路1× | 924 | 1400 |
| 10k、10实例、五路1× | 1766 | 1823 |
| 10k、单面板1× | 578 | 283 |
| 10k、五路4× | 2035 | 1661 |
| 10k、五路6× | 2302 | 2186 |

### 体验预算建议

- 当前可把“1×、五路总10k顶点、1实例/每相机1多边形”作为继续优化和回归测试的起点：95%刷新间隔约18ms，但仍有明显尾部停顿，尚不是流畅性 SLA。
- 50k/100k能够正确持续显示，本实验没有证明它们是硬性上限；它们已经明显超出33ms刷新预算，不宜称为流畅播放容量。
- 多实例/多多边形要单独设预算。50个多边形仅10k点也已明显卡顿，不能只检查顶点总数。
- 4×/6×首先需要解决五路视频与UI的基础开销，再谈增加Mask；单面板只测了1×的10k，未外推成低端设备容量。
- 编辑不能沿用只读预算：10k手柄约产生30k个SVG节点，进入编辑已有百毫秒至数百毫秒延迟。成功拖动尚未验证，不能承诺拖动上限。
- 下一步优先按帧索引并缓存可见标注/树派生数据、减少每次源帧通知导致的重复React更新；对编辑手柄采用保持全部几何精度的按需呈现和空间命中索引。任何路径缓存、Canvas/WebGL或worker方案均需重新验证帧身份和精度，本次没有实施或宣称这些收益。

原始证据目录 `/tmp/verify-seg/mask-benchmark/`。

## 暂停编辑与交互

`continuous-edit-verified.json` 在六种配置下均验证了完整可编辑手柄数量，并各执行三次真实鼠标按下、五步移动、抬起。新增检查比较拖动前后的可见 SVG 路径，**18 次均未检测到路径改变**，因此这些尝试的 pointer→双 rAF 时间只作失败诊断，不能当作成功拖动延迟或拖动容量。另一次手动验证中，选中顶点后按真实 ArrowRight 能改变路径。又用 ego 支持的元素级 `page.dragAndDrop` 在1k场景复核三次（`continuous-drag-api.json`），仍未检测到路径改变；目前没有足够证据把问题归因于应用还是自动化链路，不在本性能任务中宣称已修复。

进入编辑的 pointerup→双 rAF（每档一次，探索性数据，非稳定 p95）：

| 配置 | 实际手柄数 | 进入编辑 ms |
|---|---:|---:|
| 五路 1k | 1,000 | 31.8 |
| 五路 10k | 10,000 | 166.5 |
| 五路 10k / 10实例，选中一个实例 | 1,000 | 371.3 |
| 单面板 10k | 10,000 | 230.9 |
| 五路 1k，4× CPU | 1,000 | 116.8 |
| 五路 10k，4× CPU | 10,000 | 711.3 |

这些结果说明编辑手柄和实例树成本不能用只读播放数字代替。下一步需要先闭合成功拖动的端到端验证，再重复测量拖动中的路径更新、命中测试和提交延迟。旧 `production-edit.json` 只有输入事件/手柄观察，且有部分未就绪样本，不作为成功拖动证据。

## 解释边界

- 这是单台 M4 Max、一个真实五路录像、固定两秒热缓存窗口的受控实验。三轮足以发现大幅回归和热点，不能建立跨设备或长会话容量保证。
- 合成轮廓每帧独立、有实际边界细节，但没有模拟模型输出的全部形态，如孔洞、多尺度碎片、重叠类别或极端细长目标。
- 播放以退出编辑后的只读覆盖层测量；编辑会话的播放会隐藏 Mask，因此不能用它的 FPS 做有 Mask 容量结论。
- rAF 反映 UI 更新机会，既不是视频帧率也不是源丢帧率。实际源时间戳只作为稀疏观测；未取得完整 video decoder 输出/呈现计数，不能承诺源帧零丢失。
- CPU profile 解释主线程 JS/同步 native 调用；不能直接拆出全部 GPU 栅格化、硬件视频解码或网络耗时。热缓存条件也不代表弱网或冷启动。
- fixture 使用隔离内存服务。`seg-mask-fixture-generate` 是合成几何生成时间，不是推理；没有测真实后端提交、JSON 网络传输、IndexedDB 持久化或大标注重载。不能将这部分容量外推到生产存储。
- 输入延迟是事件到双 rAF，包含调度，逐帧/seek wall time 另含自动化往返。它们不是标准 INP，也不是光子级输入响应。
- 即使每档 GC 后采样，heap 也不是单调的几何容量曲线：正式矩阵 10k/50k/100k 的 usedSize 约 1539/1120/1401MiB，同时 CDP 的 Documents/Frames 在导航间曾从 10 增至 14，后来降至 4。读数包含当前 renderer isolate 的多个文档/缓存，不能完全归因于当前 Mask；单独保留原始值，不宣布内存上限。它也不覆盖 GPU、VideoFrame、worker 或浏览器进程总内存。
- 播放矩阵按档位顺序运行，未随机交错或重启浏览器进程。缓存、文档回收和温度会带来顺序效应；对照结果是这次受控会话中的实际测量，不给统计置信区间或超出本设备的精确加速比保证。

## 证据与复现索引

证据根目录：`/tmp/verify-seg/mask-benchmark/results/`。这些本地录像截图/数据未发布到外部页面。

| 文件 | 用途 |
|---|---|
| `final-measurements.csv` | 84个正式、未开启CPU profiler的播放样本；含原始文件标签、每轮分位数、超预算比例、长任务、源时间戳变化观测、seek、逐帧与heap |
| `continuous-control.json`、`continuous-optimized-rest.json` | 两项优化后的完整矩阵，共54轮 |
| `continuous-baseline.json`、`continuous-baseline-rest.json` | 相同完整fixture、原版热点路径，共24轮；前一文件的setup导航错误不影响已保存的完整样本 |
| `continuous-png-only.json` | 隔离PNG优化，6轮 |
| `continuous-profile-*.cpuprofile`、对应 `.summary.json` | 最终profile与当时构建sourcemap映射；独立于普通样本 |
| `production-profile-*.cpuprofile`、`production-followup-10k-5cam-10instances.cpuprofile`及summary | 原始热点证据；早期fixture，不混入最终容量表 |
| `continuous-live.json`、`continuous-live-before/playing/after.png` | 真实只读播放前、中、后；五路各10个200点多边形，源时间戳增长，播放中仍完整10k点；三张截图均已读回 |
| `continuous-optimized-rest-100k-5cam.png` | 已读回：五路各20k点，多边形持续可见；这是暂停状态 |
| `continuous-optimized-rest-10k-single-camera.png` | 已读回：确实只有一个相机面板、10k点 |
| `continuous-edit-verified.json`、`continuous-drag-api.json` | 完整手柄就绪、选择/进入编辑，以及失败拖动的逐次诊断 |
| `continuous-final-smoke.json`及PNG | 最后lint清理后重新生产构建的50k单轮验证，覆盖通过，截图已读回；不替换正式三轮统计 |
| `evidence-index.json`、`checks/` | 源文件摘要、环境/服务/清理记录与构建、测试、lint、类型检查日志 |

`production-*`、`editor-hidden-mask-baseline.json`、`invalid-occluded-diagnostic.json` 等探索结果继续保留。缺Mask、后台1Hz、编辑播放隐藏Mask、未验证成功的拖动均不算容量证据。`continuous-optimized.json` 初次两个控制场景可能与一次测试运行重叠，因此最终表使用 `continuous-control.json` 的干净重跑。历史错误文本中的录像URL已脱敏，数值未改。

完整JSON保留每个rAF间隔、每个长任务和每路源时间戳观察；CSV可重新生成：

```sh
python3 -I benchmark/summarize-mask-results.py /tmp/verify-seg/mask-benchmark/results/final-measurements.csv \
  /tmp/verify-seg/mask-benchmark/results/continuous-control.json \
  /tmp/verify-seg/mask-benchmark/results/continuous-optimized-rest.json \
  /tmp/verify-seg/mask-benchmark/results/continuous-baseline.json \
  /tmp/verify-seg/mask-benchmark/results/continuous-baseline-rest.json \
  /tmp/verify-seg/mask-benchmark/results/continuous-png-only.json
```

最后lint清理只调整fixture类型守卫、将topic查询移出几何生成循环、补测试环境API与格式/import顺序；核心两项优化未变。`benchmark/mask-measured-build.json` 记录正式优化后测量构建的index摘要；最终重新构建与50k覆盖冒烟通过，不用单轮冒烟的更低p95替换三轮结果。

## 检查与清理

- `yarn web:build:prod`：最终生产构建通过；原版和PNG-only对照构建也通过，临时替换的源文件已恢复。
- 四套测试共55项通过：`maskBenchmark.test.ts`、`ImageMode.test.ts`、`AnnotationPreview.test.tsx`、实际的 `acceptance/structure/TreeAcceptance.test.tsx`。
- 所有改动TS/TSX及新增fixture通过 ESLint、Oxlint；改动源文件与三个JS基准工具通过Prettier；`git diff --check`通过。
- 全库 `yarn typecheck:ci` 未通过，唯一剩余错误为原有 `NativeStreamPresentation.test.tsx:271`：`Property 'next' does not exist on type 'AsyncIterable<PropagationResult>'`。已核对HEAD含同一行且该文件无diff，未掩盖或改动此无关测试。
- 全部服务 cwd 都经doctor确认是本子工作区，URL均为 `http://localhost:8082/viz/`。正式优化版PID92975；原版对照PID82439（`--directory benchmark/.mask-build-baseline`）；PNG-only PID88856（`--directory benchmark/.mask-build-png-only`）；最终优化版PID91384。启动命令均为 `python3 -I benchmark/serve-mask-production.py --port 8082`，对照版附上述directory参数。均仅停止各自创建的后台任务；结束时8082已无监听。
- CPU恢复1×，screencast停止。自有浏览器窗口119707168恢复原第二屏fullscreen位置，独立task space已关闭（当前ego API为 `finish({ keep: [] })`）。证据目录保留。
- 父工作区未修改，未停止父服务；无commit、push、PR。未创建云布局、未提交合成标注、未清空用户浏览器存储。推荐布局 `cos-config.js` 仍为明确的本地测试辅助改动，不应提交。

