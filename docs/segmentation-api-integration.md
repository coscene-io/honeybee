# 语义分割编辑器接入正式 AnnotationService（dev）

分支 `seg-api-integration`（从本地 `seg/editor` @ `49aca876e` 分出），日期 2026-11-14。录像：质检测试 CJ260330-3-R154，`warehouses/b2fa5bcd-…/projects/b554c1c9-…/records/a59e1369-1809-4900-a6a1-5b3e2ff7d067`。环境：ego Chromium，`http://localhost:8084`，后端 `https://api.dev.coscene.cn`（gRPC-Web）。契约：cosceneapis PR #866 `feat/spatial-annotation-api` @ `96015385a`。

## 结论

**前端已接上正式服务，但 dev 后端目前只能跑通类别和实例。读帧、带几何的保存和传播都被后端挡住，所以"画 → 保存 → 刷新读回几何 → 传播"这条链路没能在真实环境里跑通。**

| RPC                               | dev 实测                                                                                                 | 前端状态                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| ListClasses / ListInstances       | ✅ 通过；真实页面进入标注后树里显示服务端目录                                                            | 已接入                                           |
| Create / Update / Delete Class    | ✅ 通过（通过真实页面里的适配器，以及原始请求）；重复删除返回 NOT_FOUND，复用已删 ID 返回 ALREADY_EXISTS | 已接入                                           |
| Create / Update / Delete Instance | ✅ 通过；跨类别移动实例也通过                                                                            | 已接入                                           |
| SaveAnnotation（`frames` 为空）   | ✅ 通过（空操作）                                                                                        | —                                                |
| **SaveAnnotation（带帧）**        | ❌ `FAILED_PRECONDITION: Source media metadata is not configured for annotation`                         | 已接入，单测覆盖；dev 上被挡住                   |
| **ListFrames**                    | ❌ 同上（未对齐微秒的请求正确返回 INVALID_ARGUMENT）                                                     | 已接入；界面显示这条错误并提供重试               |
| **ListTimelineRanges**            | ❌ 同上，**不存在的 topic 也返回同一个错误**，说明是服务级配置缺失，不是这条录像的问题                   | 已接入；失败只记录，不影响目录                   |
| **PropagateAnnotation**           | ❌ gRPC-Web 返回 **HTTP 403**（没有 grpc-status）；WSS 握手失败（1006）；浏览器访问不到 REST 路由        | 已接入（gRPC-Web 服务端流 + 取消 RPC），单测覆盖 |

**前端还缺什么**（详见[未验证与已知限制](#未验证与已知限制)）：

1. 读帧失败时编辑器整体不可用，连类别/实例操作也禁用（这是 store 原有的"帧窗口未就绪不能编辑"门控）。后端修好后这个问题自然消失；要不要允许在没有帧的情况下只改目录，需要产品决定。
2. 正式服务模式下，未提交的本地草稿只在内存里，刷新页面会丢失。
3. 树上的时间轴只覆盖已从数据源列出时间的帧（当前窗口附近），不是整段录像。
4. 正式服务下合并实例被拒绝（原因见下）。

本分支的提交（都在本地，未 push）：

- `81eae4b8f` feat: read and save segmentation through the live AnnotationService
- `d7db3246e` fix: read the timeline of cameras that join after the document read
- `c61b40fd8` test: a save whose frames cannot be read writes nothing
- 以及拒绝正式服务下合并实例、本报告（见 `git log`）

## RPC ↔ 前端功能

适配器：`packages/studio-base/src/semanticSegmentation/liveService.ts`，实现原有接口 `SemanticSegmentationService`（`service.ts`），store 和界面没有改结构。入口：`util/coscene/annotation.ts` 的 `createLiveSemanticSegmentationService({ recordName, startNs, document })`，用 Honeybee 现有的 `getPromiseClient`（同一个 base URL、同一个鉴权拦截器）。

| 前端动作                                | 调用                                                                                                                                                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 预览 / 进入标注（`loadDocument`）       | `ListClasses` + `ListInstances`（分页读完）；每个打开的 topic 一次 `ListTimelineRanges`（读完所有页）。后加入的相机注册时补读自己的时间轴                                                                 |
| 读几何（`loadFrameWindow`）             | `ListFrames(topic, [start, end))`。本地窗口是闭区间 `[startSec, endSec]`，转成 `[floor_us(start), floor_us(end)+1µs)`，超过 10 s 的部分拆成多段并分页                                                     |
| 树和帧条上未加载帧的"有标注"            | 时间轴区间覆盖到的已注册帧，记为 `{ fromTimeline: true }` 摘要；读到真实几何后以几何为准                                                                                                                  |
| 新建 / 改名 / 改颜色类别                | `CreateClass(classId=UUID)` / `UpdateClass(update_mask=display_name,color)`                                                                                                                               |
| 新建 / 改名 / 换类别实例                | `CreateInstance(instanceId=UUID)` / `UpdateInstance(update_mask=display_name,class)`                                                                                                                      |
| 画、改、删多边形；编辑 Mask；删本帧实例 | 改动帧的**完整** `FrameSnapshot`，一次 `SaveAnnotation`                                                                                                                                                   |
| 删除实例（全部帧）                      | `DeleteInstance`（服务端级联删除观测，前端不重发这些帧）                                                                                                                                                  |
| 删除类别（连同其实例）                  | `DeleteClass(force=true)`，一次原子操作                                                                                                                                                                   |
| 合并类别                                | 逐个 `UpdateInstance` 换类别，再 `DeleteClass`                                                                                                                                                            |
| 合并实例                                | **暂不支持**，在任何写之前报错。契约要求先保存源实例在所有 topic 上的帧再 `DeleteInstance(源)`，但标注 API 列不出录像有哪些 topic，前端只知道当前布局打开的相机；删除源实例会级联删掉它在其他相机上的观测 |
| 传播 / STOP                             | `PropagateAnnotation` 服务端流；STOP 取消 RPC                                                                                                                                                             |
| 历史版本、回退                          | 正式服务没有：`listRevisions` 返回空，`loadRevision`/`rollbackRevision` 直接报错                                                                                                                          |
| Moment 引用                             | 契约里没有，只留在本地                                                                                                                                                                                    |

一次提交的执行顺序（`submit`）：

1. 有合并实例就直接拒绝。对每个要发送的帧，没读过的先用 1 µs 窗口的 `ListFrames` 读完整状态。
2. 在本地算出全部 `FrameSnapshot`，**先完成全部校验再写**（尺寸、微秒碰撞、几何）。
3. 目录：Create → Update（类别在前，实例在后）。
4. 一次 `SaveAnnotation` 保存所有改动帧。
5. 删除：`DeleteInstance`，然后 `DeleteClass`。

每个目录 RPC 成功后立即更新适配器缓存，所以重试不会重复创建。创建时如果返回 ALREADY_EXISTS（响应丢失的情况），按契约改为 Update 收敛，不盲目重放。

几何映射：

- 多边形：编辑器存 [0,1] 归一化坐标，发送时乘以该 topic 的解码尺寸并裁剪到 `[0, width] × [0, height]`；少于 3 个顶点的（正在画的）留在本地草稿，不发送。多边形 ID 不是 UUID 时（例如传播结果）按 record/instance/ID 生成确定的 UUID。
- Mask：只收发 `counts`，宽高绑定到 topic 的解码尺寸。读回时用该尺寸解码校验，对不上就跳过并计数（`maskSizeMismatches`），不按猜测的尺寸显示。之后照常走已有的 GPU Mask 渲染和双击转多边形。
- `occluded`：编辑器没有这个字段。适配器记住服务端的值并在保存时原样带回，避免把别人设置的遮挡标记清掉。

## 生成代码

已发布的包都**没有** `coscene/dataplatform/v1alpha3/services/annotation_pb`（2026-11-14 检查）：`@coscene-io/cosceneapis-es-v2` 的 `latest` 0.0.491，以及分支构建 `0.0.488-branch.g26ae20a.772.1`、`0.0.488-branch.g944503d.770.1`。

所以从 #866 @ `96015385a12de1d75421d5dca08476a31fe94ffb` 在本地生成，放在 `packages/studio-base/src/services/api/spatial-annotation/generated/`，沿用仓库里 `moment-custom-field/generated` 的先例（已加入 ESLint 和 Prettier 的忽略列表）。生成器是 `@bufbuild/protoc-gen-es@2.10.1`，与 Honeybee 的 `@bufbuild/protobuf` 运行时版本相同；TS 输出，googleapis 的 import 改写到已有依赖 `@buf/googleapis_googleapis.bufbuild_es`。生成命令和换回正式包的步骤写在同目录的 `README.md`。没有发布 npm 包，也没有向 cosceneapis 推送任何东西。

## frame_time：微秒截断

实现：`semanticSegmentation/frameTime.ts`。

- **显示帧 → 提交**：帧身份仍然是本地的纳秒 `logTimeNs`（十进制字符串 + BigInt）。只有在线上边界才转换：`frame_time = logTimeNs / 1000`（BigInt 整除，即向下截断），输出 `{seconds, nanos}`，保证 `nanos % 1000 == 0`。用于 `FrameSnapshot.frame_time`、每条 `Frame.frame_time`、传播的种子 `frame_time`。
- **读回 → 本地帧**：每个 topic 维护一个 `FrameTimeIndex`，记录 `trunc_us(logTimeNs) → frameId`。读到的 `frame_time` 先校验是否对齐微秒（不对齐直接报错，不偷偷截断），再查表。没有对应本地帧的观测计入 `unregisteredObservations`，不会被挂到最近的帧上；这一帧后续注册后，store 会重新读这个窗口。
- **截断后碰撞**：同一 topic 的两帧截断到同一微秒时，两个方向都拒绝（读回计入 `collidingObservations`；保存和传播直接报错"同一 topic 有多帧的 log_time 截断到同一微秒"），不会任选一帧。
- **窗口和传播终点**：`ListFrames` 的边界是"录像起点 + 相对秒数"向下取到微秒；传播 `end_time` 是终点帧的 `trunc_us(logTimeNs)`。

**用这条录像的实测数据**（仓库里 `maskBenchmark.frames.json` 存了全部 9971 条源消息的精确纳秒时间，`/tmp/verify-seg/api-integration/raw/06-microsecond-collisions.txt`）：

| topic            | 帧数 | 亚微秒部分非零 | 截断后唯一 | 碰撞 | 最小间隔 |
| ---------------- | ---- | -------------- | ---------- | ---- | -------- |
| head_rgbd        | 2002 | 1999           | 2002       | 0    | 14.36 ms |
| head_stereo      | 1995 | 1995           | 1995       | 0    | 18.71 ms |
| left_wrist_rgbd  | 1993 | 1990           | 1993       | 0    | 24.13 ms |
| right_wrist_rgbd | 1993 | 1992           | 1993       | 0    | 18.37 ms |
| torso_rgbd       | 1988 | 1987           | 1988       | 0    | 16.87 ms |

这条录像的 log_time **几乎都带有亚微秒部分**（例如 `1774926595552013305`）。这和"log_time 现在也只用到微秒"的说法不一致，前端必须截断，四舍五入会让大约一半的帧落到错误的微秒上。后端校验时也必须用同样的截断规则。真实页面里五路相机已注册的帧也没有碰撞（`localCollisions: {}`）。

## 去掉版本之后：保存与并发

- **保存语义**：后端只保存当前状态。一次 `SaveAnnotation` 内所有帧原子保存；目录 CRUD 和帧保存是相互独立的请求，没有跨请求事务。适配器先完成所有校验再写；但如果中途某个目录请求或保存失败，前面已经成功的请求不会回滚（例如类别建好了、帧保存失败）。store 会把这批标记为失败、保留本地改动，重试会从已经推进的状态继续。
- **CAS 去掉了**：`versions`/`expectedVersions` 在正式服务下始终为空，`submit` 不会返回冲突。store 里的版本和冲突代码没有删，在正式服务下不起作用，本机 mock 仍在用。
- **并发覆盖风险**：同一帧以最后一次保存为准，**整帧**覆盖（快照里包括别人的实例）。两个标签页或两个人编辑同一帧时，后保存的一方会静默覆盖先保存的一方，包括对方新加的实例观测。不同帧之间互不影响。目录修改按字段覆盖（`update_mask` 只带改动的字段）。前端不会主动刷新，看到别人的修改需要重新进入标注。按契约，一期是单人编辑。
- **撤销/重做**：只作用于还没提交的本地操作。提交成功后没有历史，也不能回退。已删除的 ID 不能复用（dev 实测返回 ALREADY_EXISTS），所以已经提交的删除无法通过重新创建同一 ID 来恢复。
- **本地草稿**：正式服务模式下，未提交的操作只在内存里，刷新页面就没了。本机标注模式仍然存在浏览器存储里（存储键和以前一样，旧草稿不受影响）。
- **"不再有空占位"**：快照里只发有前景几何的观测；被清空的实例直接从快照里去掉（等于删除本帧观测），清空整帧时发空的 `annotations`。树和帧条的"有/无"来自已加载的几何或时间轴区间，不再依赖逐帧占位。传播返回某一帧时漏掉的已选实例会被清除。

## 传播：传输方式

PropagateAnnotation 用 gRPC-Web 服务端流（`getPromiseClient` 那个 connect 客户端），事件对应关系：`ready` 忽略；每个 `frame` 对每个已选实例产出一条结果（服务端没返回的实例产出空结果，即清除）；`error` 抛出 `传播失败（gRPC code）：message`；`done` 正常结束；没收到 `done` 就断开时报"传播连接在完成前断开"，已收到的帧保留为草稿（store 原有行为）。STOP 中止 RPC（`AbortSignal`），`cancelPropagation` 直接确认，因为没有服务端任务需要等待确认。模型列表暂时写死为契约示例 `sam2.1-motion`、`sam3.1`，由服务端校验。

dev 实测（`raw/03-propagate-transport-probe.json`、`raw/07-adapter-propagate.json`）：

- gRPC-Web `POST /coscene.dataplatform.v1alpha3.services.AnnotationService/PropagateAnnotation`：**HTTP 403**，响应体为空，没有 grpc-status。同一服务的一元方法返回 200。看起来是网关拦截了这个方法（或者拦截了服务端流）。
- 契约文档说浏览器走 WSS：`wss://api.dev.coscene.cn/dataplatform/v1alpha3/{record}:propagateAnnotation` 握手失败（close 1006）。REST 路由（`…/classes`、`…:propagateAnnotation`）浏览器 fetch 直接失败（CORS 或者网关没有暴露）。
- 在真实页面里通过适配器发一次约 0.33 s（10 帧）的传播：87 ms 后返回 `[permission_denied] HTTP 403`，0 帧。

**结论**：浏览器端用哪种传输需要后端决定。前端现在用 gRPC-Web 服务端流，网关放行后就能直接用；如果定了 WSS，需要换一个传输实现（首条消息发请求 JSON，之后每条文本消息是一个 response，STOP 时关闭连接），事件处理可以复用。

## 端到端验证

截图和原始响应在 `/tmp/verify-seg/api-integration/`（`raw/` 里是去掉 token 的原始响应，契约文件在 `contract/`）。截图都用 Read 看过。

| 步骤                                      | 方式                             | 结果                                                                                                                                                                  | 证据                                            |
| ----------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 打开录像，app bar 显示后端                | 用户路径                         | 右上角显示"正式服务 / 改用本机 / ✎ 编辑空间标注"                                                                                                                      | `01-open-mid.png`                               |
| 进入标注，读到服务端数据                  | 点击"编辑空间标注"               | 树里显示服务端的 `[honeybee-it] probe class/instance`；ListClasses 1 次、ListInstances 1 次、ListTimelineRanges 5 次（每个相机一次）                                  | `03-entered.png`                                |
| 读帧失败时的界面                          | 同上                             | 五路相机都显示"当前标注窗口读取失败：FAILED_PRECONDITION: Source media metadata is not configured for annotation"，带"重试当前标注窗口"；"新建"等按钮禁用             | `03-entered.png`                                |
| 改类别/实例（新建、改名、改颜色、换类别） | 真实页面里的适配器（见下面说明） | 发出 `CreateClass → CreateInstance → UpdateClass → UpdateInstance ×2`；服务端读回的名字、颜色 `#FF6633`、类别都对                                                     | `raw/04-adapter-crud-in-page.json`              |
| 刷新后从服务端读回目录                    | 用户路径（重新打开、进入标注）   | 树显示"e2e class renamed（橙色）共 2 个实例"，下面是 e2e instance 和 probe instance moved；probe class 变成 0 个实例；顶部"2 实例"                                    | `06-entered-readback.png`                       |
| 画多边形后保存                            | 真实页面里的适配器               | 先读该帧完整快照，ListFrames 返回 FAILED_PRECONDITION，**在任何写请求之前**整体失败（单测 `writes nothing when a changed frame cannot be read first` 覆盖同样的顺序） | `raw/05-adapter-save-blocked.json`              |
| 带帧保存（原始请求）                      | 原始 gRPC-Web 请求               | FAILED_PRECONDITION                                                                                                                                                   | `raw/02-crud-probe.json`                        |
| 传播 + STOP                               | 真实页面里的适配器、原始请求     | HTTP 403，没有可用的通道；STOP 在 dev 上无法验证                                                                                                                      | `raw/03-…`、`raw/07-…`                          |
| 切换到本机标注                            | 用户路径                         | 结束标注 → "改用本机" → 进入标注：显示"本机标注"，目录为空、"新建"可用、没有服务端报错；之后已切回正式服务                                                            | `07-local-mode.png`                             |
| 清理                                      | 原始请求                         | 删除自己创建的 2 个类别、2 个实例，之后 ListClasses/ListInstances 都为空                                                                                              | `raw/08-cleanup.json`、`created-resources.json` |

**关于"真实页面里的适配器"**：dev 读帧失败，store 原有的门控会禁用树上的所有操作（"新建"、"Add instance"、"Actions" 都是 disabled），所以通过点击走不到目录写入。为了在真实环境里验证适配器本身，我临时加了一个只在 localhost 生效、**未提交、已撤掉**的探针，把 live service 挂到 `globalThis`，在 localhost:8084 页面里直接调用 `service.submit`。用的是同一个适配器、同一个 gRPC-Web 传输、同一个登录态。这是适配器级别的证据，不是用户点击路径。

单元测试（`liveService.test.ts`，14 个，用 connect `createRouterTransport` 模拟服务端）覆盖：微秒截断与对齐校验、碰撞拒绝、时间轴失败不影响目录、时间轴摘要、窗口拆成不超过 10 s 的对齐分段、Mask 尺寸绑定与不符时跳过、完整快照（读取未加载帧、保留其他实例和 `occluded`、未完成的多边形不发送）、删除实例只发一个 RPC、删除类别用 force、传播流的帧映射与清除、`error` 事件和缺少 `done`、读帧失败时不写入、合并实例在写入前被拒绝。`semanticSegmentation` 全部 59 个测试套件、559 个测试通过；`tsc` 唯一的错误在 `NativeStreamPresentation.test.tsx:271`，在 HEAD `49aca876e` 上就存在（我用临时 worktree 确认过），与本次改动无关；改动文件 ESLint 通过。

## 后端问题清单

请转给后端同学。所有请求都发往 `https://api.dev.coscene.cn`，gRPC-Web，服务 `coscene.dataplatform.v1alpha3.services.AnnotationService`，带当前登录用户的 Authorization（这里不包含 token）。`R = warehouses/b2fa5bcd-1ec3-42a3-95df-b26eea9fccb2/projects/b554c1c9-1d2f-46a8-aab6-5a7d8336ebbd/records/a59e1369-1809-4900-a6a1-5b3e2ff7d067`（CJ260330-3-R154）。

**B1（阻塞）后端还没有实现源媒体适配器**

- 复现：`ListTimelineRanges { parent: R, topic: "/astribot_camera/head_rgbd/color_compress/compressed/h264" }`；`ListFrames { parent: R, topic: 同上, startTime: "2026-03-31T03:09:51Z", endTime: "2026-03-31T03:09:52Z" }`；`SaveAnnotation { record: R, frames: [{ topic: 同上, frameTime: "2026-03-31T03:09:51.568000Z", annotations: [一个有效的三角形] }] }`。
- 返回：都是 grpc-status 9 `FAILED_PRECONDITION: Source media metadata is not configured for annotation`。`topic: "/does/not/exist"` 也返回同样的错误。
- 期望：返回数据（这条录像目前为空），或者对无效 topic 返回 INVALID_ARGUMENT。
- 原因（已核对后端代码）：data-platform-server PR #2403（`codex/spatial-annotation-api` @ `cdf2e2fa`）里 `AnnotationMedia` 只有默认实现 `UnavailableAnnotationMedia`，`topic()` 对任何 record、任何 topic 都直接抛出这条 FAILED_PRECONDITION。PR 描述写明"the real source-media adapter remain deferred"。所以这不是配置问题，换录像也不会好。
- 需要后端做的：实现 `AnnotationMedia.Topic`，按 record + topic 给出 `frameCount`、`width`、`height`，以及每帧 log_time 截断到微秒后的时间（唯一递增）。ListFrames、ListTimelineRanges、SaveAnnotation 的帧和几何校验都依赖它。
- 影响：读几何、时间轴、带几何的保存，以及（大概率）传播。前端编辑器因此整体无法编辑。

**B2（阻塞）浏览器调不了 PropagateAnnotation**

- 复现：gRPC-Web `POST /coscene.dataplatform.v1alpha3.services.AnnotationService/PropagateAnnotation`，请求体可以是任意内容（包括空消息）。
- 返回：HTTP 403，响应体为空，没有 grpc-status 或 grpc-message。同一服务的一元方法正常。
- 另外：`wss://api.dev.coscene.cn/dataplatform/v1alpha3/R:propagateAnnotation` 握手失败（1006）；REST 路由 `…/R/classes`、`…/R:propagateAnnotation` 浏览器 fetch 失败（没有 CORS 或者没有暴露）。
- 需要决定：浏览器走 gRPC-Web 服务端流（网关放行这个方法），还是契约里说的 WSS 网关（需要部署，还要说明浏览器怎么鉴权，因为 WebSocket 不能带 Authorization 头）。前端现在用 gRPC-Web。
- 另外：PR #2403 的服务端 PropagateAnnotation 本身也还没实现（返回 UNIMPLEMENTED），403 是请求还没到服务就被网关拦下了。网关放行后浏览器会先看到 UNIMPLEMENTED。
- 影响：传播和 STOP 都无法验证。

**B3 没有发布生成代码**

- `@coscene-io/cosceneapis-es-v2` 0.0.491 和两个分支构建都没有 `services/annotation_pb`。请从 #866 发布一个版本或分支构建；前端目前用本地生成的副本（见 `services/api/spatial-annotation/README.md`）。

**B4 需要确认的契约细节**

1. **log_time 的精度**：这条录像 99.9% 的 log_time 带亚微秒部分（见上表）。前端按截断提交；请确认后端校验也用截断（不是四舍五入），并且媒体索引给前端的也是截断值。
2. **Mask 尺寸**：Mask 只有 counts，前端用 topic 的解码尺寸（如 head_rgbd 1280×720、wrist 640×360、head_stereo 1280×480）。请确认服务端校验用同一个尺寸来源；建议在服务端对尺寸不符的 counts 给出明确错误。
3. **单次 SaveAnnotation 的上限**：契约说会拒绝超限的请求（RESOURCE_EXHAUSTED），但没给数字。前端目前一次提交只发一个请求；需要知道帧数或字节上限才能拆分（拆分后就不是原子的了）。
4. **ListTimelineRanges 只能查一个 topic**：五路相机进入一次标注就要 5 次请求（还有分页）。如果能一次查多个 topic，会省请求。
5. **已删除 ID 不能复用**：dev 实测是 ALREADY_EXISTS，和契约一致。这意味着已提交的删除无法用同一 ID 恢复，前端撤销只覆盖未提交的操作。请确认这是预期行为。

## 接入后可删除

先不删，列出来供统一清理时参考。"保留"是指本机标注模式还要用。

| 内容                                                                                                                                                                    | 位置                                                                                                                                                      | 说明                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| CreateCommit 投影：`projectCommit`、`projectStoredDocument`、`documentFromCommit`、`contractRequestId`、`recordResourceName`、Commit/Catalog 类型                       | `annotationContract.ts`、`annotationContract.test.ts`                                                                                                     | 契约已经没有 Commit；正式服务只用 `isUuid`、`polygonWireId` |
| mock 里的 `contractCommits`、`rememberContract`、`headCommitName`                                                                                                       | `mockService.ts`                                                                                                                                          | 只用来模拟旧的 CreateCommit                                 |
| 版本 / CAS：`versions`、`expectedVersions`、`conflict` 状态、`rebaseOperation`、`conflictNext`、`simulateExternalEdit`                                                  | `types.ts`、`store.ts`、`service.ts`（`patchAnnotationKeys` 还要保留）、`mockService.ts`、相关测试                                                        | 正式服务下不起作用                                          |
| 历史版本：`revisions`、`viewRevision`、`rollbackRevision`、`listRevisions`、`loadRevision`，WorkflowControls 里的历史和回退界面                                         | `store.ts`、`service.ts`、`runtime.ts`、`components/WorkflowControls.tsx`、`revisionRollback.test.ts`                                                     | 后端没有历史                                                |
| 离线任务和导出：`SegmentationTask*`、`enqueueTask`、`refreshTasks`、`cancelTask`、`applyTaskResult`                                                                     | `types.ts`、`store.ts`、相关界面                                                                                                                          | 契约去掉了离线传播和导出                                    |
| GPU 会话和媒体缓存：`mockGpuPool.ts`、`mockGpuSession.ts`、`startGpu`/`stopGpu`/`uploadMedia`、`MediaCacheMissError`、`cacheKey`、`PropagationCapabilities.resolutions` | `semanticSegmentation/`、`mediaCacheCapabilities.test.ts`                                                                                                 | 契约说媒体准备和 GPU 都由服务端内部处理                     |
| Mask/多边形基准                                                                                                                                                         | `maskBenchmark.ts`、`maskBenchmark.frames.json`（帧时间清单，微秒核对用过）、`maskBenchmark.test.ts`、`benchmark/`、`docs/segmentation-mask-benchmark.md` | 只在 localhost `segBenchmark` 下生效                        |
| MOCK Mask                                                                                                                                                               | `mockMasks.ts`、`fixtures/`                                                                                                                               | 只在 localhost `segMockMasks` 下生效                        |
| 演示页                                                                                                                                                                  | `SemanticSegmentationDemo.tsx`、`SemanticSegmentationWorkbench.tsx`、`getDemoRuntime`                                                                     | 如果不再需要独立 demo                                       |
| 本地生成代码                                                                                                                                                            | `services/api/spatial-annotation/`，以及 ESLint/Prettier 忽略项                                                                                           | 等正式包发布后替换                                          |
| **保留**                                                                                                                                                                | `mockService.ts` 主体、`annotationBackend.ts`                                                                                                             | 本机标注模式和切换开关要用                                  |

## 未验证与已知限制

未在真实环境验证（被 B1/B2 挡住，只有单测）：

- ListFrames 读回多边形和 Mask、逐字段核对 frame_time、几何、实例（"保存 → 刷新 → 读回几何"整条链路）。
- 带几何的 SaveAnnotation、编辑 Mask 后保存、删除本帧实例。
- ListTimelineRanges 的数据、分页（服务端只返回过空列表或错误）。
- 传播流、STOP、传播结果保存。
- 服务端对 Mask 尺寸、多边形自交、微秒对齐的校验（只验证过 ListFrames 对未对齐时间返回 INVALID_ARGUMENT）。

前端已知限制：

- 读帧失败时编辑器整体不可用（门控原本就有），包括目录操作。
- 正式服务模式下未提交的草稿只在内存里。
- 时间轴摘要只覆盖已注册的帧；树上看不到整段录像的标注分布。
- 正式服务下不能合并实例。要支持，需要从媒体层拿到录像的全部视频 topic（或者后端提供服务端合并），再对每个 topic 读源实例的帧。
- 一次提交只发一个 SaveAnnotation，不了解服务端上限。
- 目录写入和帧保存不是原子的；中途失败后会留下部分已完成的目录修改（重试可以收敛）。
- 不会主动拉取别人的修改。
- 传播模型列表写死在前端。
- 只在 macOS 的 ego Chromium 上测过。

## 环境与副作用

- 开发服务：`yarn web:serve --port 8084`，`PORT=8084 doctor.sh` 确认 cwd 是本 worktree。ego task space `seg api integration`。没有操作 8081–8083。
- localhost:8084 原本没有登录态，会跳到 dev 云端。我在浏览器进程内把 dev.coscene.cn 的现有登录复制到了 localhost:8084 的 localStorage（和之前子任务做法一样）。没有输出或写文件，也没有清空任何存储。
- 本地测试配置 `packages/studio-web/public/cos-config.js`（推荐布局开关）没有提交。
- dev 上的写操作只针对 CJ260330-3-R154，名字都带 `[honeybee-it]` 前缀，最后都删了。没有成功写入任何帧观测。没有发起成功的传播（403）。
- `packages/studio-base/package.json` 没有改；本地生成代码不需要新依赖。
