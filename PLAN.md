# IndexedDB Message Cache 改造计划

## 背景与需求

当前项目中 `IndexedDbMessageStore` 主要服务 realtime viz：WebSocket 实时消息写入 IndexedDB，用户可切换到 `persistent-cache` 数据源回放最近一段短窗口数据。新的播放数据 IndexedDB 溢出缓存需求希望在远程数据播放过程中，内存缓存超过上限后不要丢弃已读数据，而是落到 IndexedDB，后续回看同一批订阅 topic 时避免再次从网络加载。

这两个需求都需要 IndexedDB 存储消息，但语义不同：

- realtime viz 缓存是短窗口历史回放缓存，按用户配置的保留时长滚动清理。
- 播放溢出缓存是单次播放会话缓存，重点是记录已完整加载的时间范围，topic/source 变化或会话结束后应及时清理。

因此计划分两步实现：

1. 第一阶段：改造 `IndexedDbMessageStore` 及 realtime viz 短窗口回放缓存，使存储架构具备同时支持两类缓存的能力，并保证 realtime viz 当前功能不回归。
2. 第二阶段：在播放链路接入 IndexedDB 溢出缓存，实现远程播放回看免重复网络加载。

## 当前设计问题

- `IndexedDbMessageStore` 同时承担底层 IndexedDB 访问、session 生命周期、retention 清理、size 清理、统计和 datatypes 存储，职责过重，难以扩展到播放溢出缓存。
- `sessions` 元数据只有 `sessionId/createdAt/lastActiveAt`，无法区分 `realtime-viz` 与未来的 `playback-spill`，也无法记录 source、topic fingerprint、清理策略或缓存状态。
- `close()` 当前先设置 `#closed = true`，再尝试 flush；`#flushAppends()` 看到 closed 会直接返回，导致关闭前队列中的消息可能未落盘。
- `append()` 在普通定时批量写入路径下会很快 resolve，调用方不能明确知道传入 events 是否已写入 IndexedDB。
- `seq` 只保存在内存中；同一个 session 重新打开后从 0 开始，若 receiveTime 相同，存在覆盖旧消息的风险。
- size 清理使用 `navigator.storage.estimate()` 的 origin 总用量，不是当前 DB/session 的精确大小，不能作为某个缓存策略的可靠容量判断。
- `PersistentCacheIterableSource` 初始化时从前 1000 条消息推断 topics/schema，可能漏 topic，topicStats 也不准确。
- `PersistentCacheIterableSource.terminate()` 会清空当前 session。作为“读取 realtime 缓存进行回放”的数据源，它不应该拥有删除缓存 session 的生命周期决策。
- 当前没有 loaded range / coverage 元数据。对 realtime 短窗口回放还能勉强使用，但无法支持播放溢出缓存判断“本地是否完整覆盖某段时间”。

## 总体方案

将当前 `IndexedDbMessageStore` 改造成“低层存储 + 上层策略”的结构。

- 低层存储只负责 IndexedDB schema、事务、消息读写、metadata 读写、session 删除、flush/close。
- realtime viz 使用专门的短窗口缓存策略层，继续保持现有交互和配置行为。
- 后续播放溢出缓存使用同一套低层存储，但使用独立 session kind、coverage 元数据和更严格清理策略。

建议新增或重命名的概念：

- `CacheSessionKind = "realtime-viz" | "playback-spill"`
- `CacheSessionMetadata`
  - `sessionId`
  - `kind`
  - `createdAt`
  - `lastActiveAt`
  - `sourceId?`
  - `sourceKey?`
  - `topicFingerprint?`
  - `retentionWindowMs?`
  - `maxBytes?`
  - `status?: "active" | "closed" | "abandoned"`
- `TopicMetadata`
  - 每个 session 下完整保存 topic name、schemaName、messageEncoding/schemaEncoding 等后续回放初始化需要的信息。
- `LoadedRange`
  - 第二阶段使用。记录某个 session/topicFingerprint 下已完整加载的时间范围。

## 第一阶段：IndexedDbMessageStore + realtime viz 改造

### 目标

- 保持 realtime viz 当前用户功能不变：实时可视化继续非阻塞写入，用户仍可通过 `persistent-cache` 回放短窗口数据。
- 修复现有 IndexedDB 写入/关闭/session 设计缺陷。
- 为第二阶段预留 session kind、metadata、loaded ranges 的架构能力，但第一阶段不接入播放溢出缓存。

### 非目标

- 不在第一阶段修改 `CachingIterableSource` 的内存淘汰行为。
- 不在第一阶段让远程数据平台回看命中 IndexedDB。
- 不把 realtime viz 缓存变成长期离线缓存。

### 存储层改造

1. 升级 IndexedDB schema。
   - 将 DB version 从 1 升到 2。
   - 扩展 `sessions` store，加入 `kind/sourceId/sourceKey/topicFingerprint/retentionWindowMs/maxBytes/status` 等字段。
   - 增加 topic metadata store，例如 `topics` 或 `sessionTopics`，按 session 保存完整 topic/schema 信息。
   - 预留 loaded ranges store，例如 `loadedRanges`。第一阶段可只建表和基础 CRUD，不接入播放链路。

2. 修复 append/flush/close 语义。
   - 新增公开 `flush(): Promise<void>`。
   - 明确 durability 语义：`append(events)` 只保证消息已进入内存队列并已调度写入，不保证返回时已持久化到 IndexedDB。
   - 不要让调用方依赖 `await append()` 表示 durable write；需要确认落盘时必须使用 `flush()` 或 `close()`。
   - realtime 写入路径必须继续 `void append(...)` fire-and-forget，不能每条消息等待 IDB transaction 完成。
   - 只有显式 `flush()` 和 `close()` 保证已入队消息尽量落盘；切换到 `persistent-cache` 回放前、关闭 player 前应调用这些 durable 边界。
   - `close()` 必须先阻止新 append，再等待当前 in-flight flush 完成，再执行 final flush，最后关闭 DB。
   - 当前风险包含两类：先设置 closed 会让 pending queue 的 final flush 被跳过；未等待 in-flight flush 会导致已从 queue 取出的 batch 在 DB close 前后状态不确定。
   - flush 失败应记录日志并让显式 `flush()`/`close()` 调用者能感知；realtime 非阻塞路径可以 catch 后降级。
   - append queue 必须有硬上限（按消息条数或估算 bytes）。如果 IndexedDB 持续慢于消息到达速率，超限时丢弃最旧的未写入消息，并记录 warning/problem，保证实时可视化不被缓存拖垮。

3. 修复消息 key/seq。
   - 避免同 session 重开后 `seq` 从 0 开始覆盖相同 timestamp 数据。
   - 实现前需要在两种方案中明确选择一种：
     - 保留当前复合时间主键 `[sessionId, sec, nsec, seq]`，并在 session metadata 中持久化 `nextSeq`，init 时恢复。
     - 改用 IndexedDB autoIncrement 主键，并保留 `bySessionTime/bySessionTopicTime/bySession` 索引用于时间和 topic 查询。
   - 如果选择 autoIncrement，不能再依赖 object store primary key range 做按时间删除；按时间清理必须走 `bySessionTime` index cursor，批量收集 primary key 后删除。
   - 如果选择复合时间主键，必须覆盖同 session 重开、相同 receiveTime、多消息乱序到达的测试。

4. 明确 size 与清理职责。
   - 低层 store 提供 session 级 `stats()`，不要把 `navigator.storage.estimate()` 的 origin 总用量当作某个 session 的实际大小。
   - message size 可用 `sizeInBytes` 汇总作为近似值，必要时在 session metadata 中维护 approximate bytes。
   - 底层只提供按 session、按 kind、按时间、按 source 删除的能力；具体保留策略由上层决定。

5. 迁移策略。
   - 当前 realtime viz 缓存只服务当次可视化短窗口回放，发布后旧 IndexedDB 缓存没有业务保留价值。
   - DB version 从 v1 升到 v2 时允许破坏式迁移旧缓存数据：可以删除/recreate realtime cache 相关 object stores，或在升级完成后清空旧 `messages/datatypes/sessions` 数据。
   - 不要求 v1 旧 session 在 v2 中继续可读，也不要求跨版本保留 `persistent-cache` 回放能力。
   - 多 tab 场景只做最低限度保护：处理 `blocked`/`blocking`/`terminated`，避免缓存初始化永久挂起；如果升级被其他 tab 阻塞，cache 初始化应失败并降级为无缓存模式，不能影响 realtime viz 正常可视化。

### realtime viz 策略层

1. 引入 realtime 专用封装。
   - 可以命名为 `RealtimeVizHistoryCache`。
   - 内部使用改造后的 IndexedDB 存储层。
   - 负责 realtime 的 retentionWindowMs、非阻塞 append、datatypes/topics 写入、短窗口 prune。

2. 调整 `FoxgloveWebSocketPlayer`。
   - WebSocket message handler 继续非阻塞写入，缓存失败不能影响实时可视化。
   - server/topic/schema/datatypes 更新时，写入完整 metadata，而不是让回放入口从前 1000 条消息猜测。
   - datatypes/topic metadata 与消息写入不要求严格同事务原子性；但切换到回放或关闭前应尽量 flush 已调度的 metadata 与消息写入。metadata 缺失时，回放源应返回明确 problem 或降级，而不是重新用 sample 猜测。
   - close/reopen 时通过 `RealtimeVizHistoryCache.close()` 保证队列尽量 flush。

3. 调整 `PersistentCacheIterableSource`。
   - 初始化时从 session metadata 获取 topics、datatypes、topicStats，而不是 sample 消息推断。
   - 作为只读回放数据源，不应在 `terminate()` 中清空 session；只关闭 reader。
   - 如果 session 不存在或 metadata 不完整，返回明确 problem 或空初始化，不能误报可回放范围。

4. 调整 `PlayerManager` 生命周期。
   - 切换到新 connection 前，仍清理上一个 realtime session。
   - 切换到 `persistent-cache` 回放时，不要提前清掉当前 session。
   - 从 `persistent-cache` 切换到 file/connection 时，由 `PlayerManager` 负责清理之前的 realtime session。
   - 启动或新建缓存时执行旧 session 清理，但只清理符合策略的 session kind。
   - 清理 session 前必须确保相关 reader/player 已真正关闭；避免 `PersistentCacheIterableSource` 还在读取时被 `PlayerManager` 删除底层数据。
   - 建议引入 session lease/reference 或 `pending-delete` 状态：active reader 存在时先标记待清理，reader 关闭后再删除。

5. 清理策略。
   - `realtime-viz`：按用户设置 `retentionWindowMs` 做事件时间窗口清理。
   - `retentionWindowMs = 0` 保持当前语义：不创建 cache、不写入 IndexedDB、不允许切换到 realtime 回放缓存。
   - abandoned realtime session：按较长兜底周期清理，例如 3 天；判断依据应使用 `lastActiveAt`，而不是 `createdAt`。
   - 第一阶段不要引入播放溢出缓存的清理行为，只预留接口。

### 第一阶段测试与验收

必须补充或更新测试：

- `IndexedDbMessageStore`
  - `append()`/`flush()`/`close()` 不丢队列中最后一批消息。
  - 同 session 重开后，相同 timestamp 的消息不会覆盖。
  - v1 到 v2 migration 可以安全丢弃旧缓存数据；升级后新 realtime cache 可正常创建、写入、读取。
  - 多 tab 阻塞升级时不会让 realtime viz 挂起；cache 可以降级禁用并记录 warning。
  - 按 session/kind 清理不会误删其他 session。
  - datatypes/topics metadata 可写可读。

- realtime viz
  - WebSocket 收到消息后可写入 cache，并能通过 `persistent-cache` 回放。
  - `PersistentCacheIterableSource.initialize()` 使用 metadata 构造 topics/datatypes，不依赖前 1000 条消息。
  - `PersistentCacheIterableSource.terminate()` 不删除 session。
  - retentionWindowMs 生效，窗口外消息会被清理。
  - `retentionWindowMs = 0` 时不创建 cache、不写入 IndexedDB、不允许切换到 realtime 回放缓存，现有 UI 行为不变。
  - 高频 WebSocket 写入时 UI 不阻塞，cache 写入队列有上限，缓存失败或降级不会影响实时可视化。
  - IndexedDB 初始化 blocked、写入失败、队列溢出等降级场景需要可观测：至少记录 warning；适合用户感知的场景应 emit player problem/warning。
  - 关闭 realtime player 或切换到 `persistent-cache` 回放时，最后一批已入队消息不会因为 close/flush 竞态丢失。

建议验证命令：

```bash
yarn jest packages/studio-base/src/persistence
yarn jest packages/studio-base/src/players/IterablePlayer/PersistentCache
yarn jest packages/studio-base/src/players/FoxgloveWebSocketPlayer
yarn jest packages/studio-base/src/components/PlaybackControls
```

以上命令是建议范围，具体测试文件和目录需要实现前先确认；如果局部测试名称不匹配，以实际相关文件路径运行对应 jest 测试。

第一阶段还需要做一个简单写入吞吐验证或人工性能验证：

- 高频消息写入时 realtime UI 不能出现明显卡顿。
- IndexedDB 队列长度应有边界，不能无限增长。
- 当 IndexedDB 写入持续慢于消息到达速率时，队列超限会按预期丢弃最旧未写入消息，并产生可观测 warning/problem。
- cache disabled / write failed / migration blocked 等降级场景只影响回放缓存能力，不影响实时可视化。

第一阶段完成后需要人工验证 realtime viz：

- 连接 WebSocket 实时数据源。
- 设置缓存时长，例如 30 秒或 1 分钟。
- 等待消息写入。
- 点击 realtime viz 回放入口切换到 `persistent-cache`。
- 确认回放时间范围、topic 列表、schema/datatypes、seek/backfill 都正常。
- 切换新连接或文件后确认旧 session 被清理，不影响新连接。

## 第二阶段：播放数据 IndexedDB 溢出缓存

### 目标

- 在远程播放链路中，内存缓存超过上限后不再丢弃已读取数据，而是写入 IndexedDB。
- 只要 source 和订阅 topic/fingerprint 未改变，回看已加载范围时优先从本地 IndexedDB 读取，避免再次网络加载。
- 数据仅作为单次播放缓存，必须及时清理。

### 方案

1. 在 `CachingIterableSource` / `BufferedIterableSource` 增加可选 spill cache。
   - 新增 session kind：`playback-spill`。
   - session metadata 包含 source id/source key/topic fingerprint。
   - 内存态是否清缓存可以继续沿用当前 `_.isEqual(args.topics, #cachedTopics)` 等价语义。
   - 持久化 topic fingerprint 必须使用稳定 canonicalizer/hash：topic key 排序，`undefined` 与缺失字段统一处理，fields/preload 等影响消息内容的参数显式纳入。
   - `fields` 是否排序取决于字段顺序是否影响输出语义；如果不影响输出，应排序后 hash；如果影响输出对象顺序，应保留顺序但仍使用 canonical JSON。

2. 写入策略。
   - 从底层 source 读取新消息时，同时写入内存块和 spill cache。
   - 一个 source range 读完后，写入 loaded range metadata。
   - 空消息范围也要记录 loaded range，否则回看无消息区间仍会再次请求网络。
   - 写入 loaded range 时必须合并 overlapping/adjacent ranges，避免长时间播放后产生大量碎片区间。
   - loaded ranges store 需要为 `sessionId/topicFingerprint/start` 建索引，支持高效判断某个请求区间是否被完整覆盖。

3. 读取策略。
   - `messageIterator` 先查内存块。
   - 内存缺失时，如果 IndexedDB coverage 完整覆盖请求区间，则从 spill cache 读取。
   - coverage 不完整时，只对缺口访问底层 source，并补写 IndexedDB。
   - `getBackfillMessages` 顺序为内存、spill cache、底层 source。

4. 清理策略。
   - 订阅 topic/fingerprint 变化：清理当前 playback-spill session，重新开始。
   - source 变化：清理当前 playback-spill session。
   - player/source terminate：清理当前 playback-spill session。
   - 异常残留：启动时清理超过短 TTL 的 `playback-spill` session，建议 24 小时以内。

### 第二阶段测试与验收

- 小内存上限触发内存块淘汰，回看旧时间段不再调用底层 source。
- topic 不变时命中 IndexedDB；topic/fields 变化时清理并重新请求 source。
- 空消息 loaded range 回看不触发网络。
- `getBackfillMessages` 能从已淘汰但落入 IndexedDB 的消息中返回结果。
- terminate/source 切换后 playback-spill session 被清理。
- realtime-viz session 与 playback-spill session 相互隔离，清理互不影响。

## 接力实现顺序建议

1. 先写或更新 IndexedDB 存储层测试，覆盖 flush/close、seq、session kind、metadata、migration。
2. 改造 `IndexedDbMessageStore` schema 与 API，保持现有导出兼容。
3. 引入 realtime viz 策略封装，并接入 `FoxgloveWebSocketPlayer`。
4. 改造 `PersistentCacheIterableSource` 为 metadata 驱动、只读 terminate。
5. 调整 `PlayerManager` 清理职责，确保切换 source 的行为正确。
6. 跑第一阶段测试并人工验证 realtime viz 回放。
7. 第一阶段稳定后，再开始第二阶段播放溢出缓存接入。

## 风险与注意事项

- 不要让 `PersistentCacheIterableSource` 清理 realtime session；清理必须由更高层生命周期管理。
- 不要用 origin 总 storage usage 判断某个 session 是否超限。
- 不要依赖消息 sample 推断 topic/schema；实时回放需要完整 metadata。
- 不要把播放溢出缓存和 realtime 短窗口缓存混用同一个 session。
- 第二阶段必须有 coverage/loaded range，否则无法安全判断是否可以跳过网络请求。
- realtime 写入必须继续保持非阻塞；缓存失败只能影响回放能力，不能影响实时可视化。
- `append()` 不是 durable write 边界；需要持久化确认时必须调用 `flush()` 或 `close()`。
- IndexedDB 写入队列必须有上限，队列溢出时优先保护 realtime UI 和进程内存。
