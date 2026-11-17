# 语义分割编辑器与 AnnotationService

编辑器通过正式的 `AnnotationService`（cosceneapis #866，gRPC-Web）读写云端录像的标注。只有云端录像能标注；本地文件上「✎ 编辑空间标注」是禁用的。几何模型（一个观测只有一种几何）见 [segmentation-geometry-model.md](segmentation-geometry-model.md)，Mask 的 GPU 渲染见 [segmentation-mask-render.md](segmentation-mask-render.md)。

## 适配器

`semanticSegmentation/liveService.ts` 实现 `SemanticSegmentationService`（`service.ts`），store 和界面只依赖这个接口。入口是 `util/coscene/annotation.ts` 的 `createLiveSemanticSegmentationService({ recordName, startNs, document })`，用 Honeybee 现有的 `getPromiseClient`（同一个 base URL 和鉴权拦截器）。

| 前端动作                       | 调用                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 进入标注（`loadDocument`）     | `ListClasses` + `ListInstances`（分页读完）；每个打开的 topic 一次 `ListTimelineRanges`。之后才注册的相机补读自己的时间轴                |
| 读几何（`loadFrameWindow`）    | `ListFrames(topic, [start, end))`。本地闭区间 `[startSec, endSec]` 转成 `[floor_us(start), floor_us(end) + 1µs)`，超过 10 s 时拆段并分页 |
| 树和帧条上未加载帧的「有标注」 | 时间轴区间覆盖到的已注册帧记为 `{ fromTimeline: true }` 摘要；读到几何后以几何为准                                                       |
| 新建 / 改名 / 改颜色类别       | `CreateClass(classId = UUID)` / `UpdateClass(update_mask = display_name, color)`                                                         |
| 新建 / 改名 / 换类别实例       | `CreateInstance(instanceId = UUID)` / `UpdateInstance(update_mask = display_name, class)`                                                |
| 画、改、删几何；删本帧实例     | 每个改动帧的**完整** `FrameSnapshot`，一次 `SaveAnnotation`                                                                              |
| 删除实例（全部帧）             | `DeleteInstance`（服务端级联删除观测，前端不重发这些帧）                                                                                 |
| 删除类别（连同实例）           | `DeleteClass(force = true)`                                                                                                              |
| 合并类别                       | 逐个 `UpdateInstance` 换类别，再 `DeleteClass`                                                                                           |
| 合并实例                       | **不支持**，写入前就报错：API 列不出录像的全部 topic，删除源实例会连带删掉它在未打开相机上的观测                                         |
| 传播 / 停止                    | `PropagateAnnotation` 服务端流；停止即取消 RPC                                                                                           |
| Moment 引用                    | 不在契约里，正式服务不保存                                                                                                               |

一次提交（`submit`）的顺序：

1. 有合并实例就拒绝。要发送的帧如果还没读过，先用 1 µs 窗口的 `ListFrames` 读到完整状态。
2. 在本地算出全部 `FrameSnapshot`，**全部校验通过后才开始写**（尺寸、微秒碰撞、几何）。
3. 目录：先建/改类别，再建/改实例。
4. 一次 `SaveAnnotation` 原子保存所有改动帧。
5. 删除：`DeleteInstance`，然后 `DeleteClass`。

每个目录请求成功后立即更新适配器缓存，重试不会重复创建。创建返回 `ALREADY_EXISTS`（上次响应丢失）时按契约改为 Update 收敛。

## 几何映射

- 多边形：编辑器存 [0, 1] 归一化坐标，发送时乘以该 topic 的解码尺寸并裁剪到 `[0, width] × [0, height]`。多边形 ID 不是 UUID 时（例如传播结果）按 record / instance / ID 生成确定的 UUID。
- Mask：只收发 `counts`，宽高绑定到该 topic 的解码尺寸。保存前按这个尺寸解码，像素总数不等于宽 × 高就拒绝整次保存（后端不校验这一项）。
- 读回解不开的观测（例如 mask 尺寸不符）不显示，画布上提示，并计入 `maskSizeMismatches`；适配器保留原始 wire 数据，保存这一帧时原样带回，直到用户在同一帧替换或清除该实例。
- `occluded`：编辑器没有这个字段，适配器记住服务端的值并在保存时原样带回。

## frame_time：微秒截断

实现在 `semanticSegmentation/frameTime.ts`。

- 帧身份是本地的纳秒 `logTimeNs`。只在线上边界转换：`frame_time = logTimeNs / 1000`（BigInt 整除，向下截断），保证 `nanos % 1000 == 0`。用于 `FrameSnapshot.frame_time`、每条 `Frame.frame_time` 和传播种子。
- 读回时每个 topic 用 `FrameTimeIndex` 把 `trunc_us(logTimeNs)` 映射回本地帧。未对齐微秒的时间直接报错；没有对应本地帧的观测计入 `unregisteredObservations`，不会挂到最近的帧上。
- 同一 topic 两帧截断到同一微秒时，读写都拒绝（读回计入 `collidingObservations`），不会任选一帧。
- 实测录像 CJ260330-3-R154 的 log_time 几乎都带亚微秒部分，所以必须截断：四舍五入会让约一半的帧落到错误的微秒上。后端校验也要用截断。

## 保存语义与并发

- 后端只保存当前状态，没有历史版本。撤销/重做只作用于还没提交的本地操作；已删除的 ID 不能复用，提交后的删除无法用同一 ID 恢复。
- 一次 `SaveAnnotation` 内所有帧原子保存；目录请求与帧保存相互独立，中途失败不会回滚已成功的请求。store 把这批标为失败并保留本地改动，重试从已推进的状态继续。
- 同一帧以最后一次保存为准，**整帧**覆盖（快照包含别人的实例）。两人同时编辑同一帧时后保存的一方会覆盖先保存的一方；不同帧互不影响。目录按字段覆盖（`update_mask` 只带改动的字段）。前端不会主动拉取别人的修改。
- 未提交的操作只在内存里，刷新页面会丢失。
- 快照里只发有前景几何的观测；清除实例就是从快照里省略它，清空整帧发空的 `annotations`。

## 传播

`PropagateAnnotation` 走 gRPC-Web 服务端流：`ready` 忽略；每个 `frame` 对每个已选实例产出一条结果（服务端没返回的实例记为清除）；`error` 抛出 `传播失败（gRPC code）：message`；`done` 正常结束；没收到 `done` 就断开时报错，已收到的帧保留为草稿。停止就是中止 RPC。模型列表是 `LIVE_PROPAGATION_MODELS`（目前只有后端支持的 `sam2.1-motion`）。

快速标注（点击生成 mask）的接口还没进契约（cosceneapis #870），暂时调用固定的 SAM2 服务，见 `semanticSegmentation/quickSegment.ts` 和 `tools/seg-local-propagation/`。

## 生成代码

已发布的 `@coscene-io/cosceneapis-es-v2` 还没有 `services/annotation_pb`，所以从 #866 在本地生成，放在 `packages/studio-base/src/services/api/spatial-annotation/generated/`（已加入 ESLint 和 Prettier 忽略）。生成命令和换回正式包的步骤见同目录的 `README.md`。

## 已知限制与待后端确认

- 不支持合并实例（见上表）。
- 一次提交只发一个 `SaveAnnotation`，服务端的帧数/字节上限未知。
- 时间轴摘要只覆盖已注册的帧，树上看不到整段录像的标注分布。
- 后端不校验 mask 像素总数和多边形坐标上界，目前由前端兜底；建议服务端也校验。
- `ListTimelineRanges` 每个观测返回一个单点区间，没有合并成连续区间，页数随观测数增长。
- Mask 没有宽高字段；相机换分辨率后旧 mask 会按新尺寸解码失败（前端会提示并原样保留）。
