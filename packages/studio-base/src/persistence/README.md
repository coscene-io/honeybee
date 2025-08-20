# 实时数据持久化缓存系统

这个系统为实时数据可视化提供了5分钟滚动窗口的持久化缓存能力，支持历史回放功能。

## 主要特性

1. **自动会话隔离**: 每次创建时自动清理旧数据，确保会话独立性
2. **5分钟滚动窗口**: 自动维护最近5分钟的数据，超时数据自动清理
3. **实时数据落盘**: WebSocket数据自动持久化到IndexedDB
4. **统一回放接口**: 提供标准的IterableSource接口供IterablePlayer使用
5. **性能优化**: 非阻塞的持久化操作，不影响实时可视化性能

## 使用方式

### 1. WebSocket Player集成

WebSocket Player已自动集成持久化缓存功能：

```typescript
// 创建WebSocket Player（已自动启用持久化缓存）
const player = new FoxgloveWebSocketPlayer({
  url: "ws://localhost:21274",
  enablePersistentCache: true, // 默认启用
  // ...其他参数
});

// 检查是否有历史数据可回放
const hasData = await player.hasPlaybackData();

// 获取缓存时间范围
const timeRange = await player.getCachedTimeRange();
console.log(`Cached data from ${timeRange.start} to ${timeRange.end}`);

// 获取窗口统计信息
const windowStats = await player.getWindowStats();
console.log(`Cache utilization: ${windowStats.windowUtilization}%`);

// 创建历史回放数据源（sessionId 自动处理）
const playbackSource = player.createHistoricalPlaybackSource("Recent History");
if (playbackSource) {
  // 使用IterablePlayer进行历史数据回放
  const iterablePlayer = new IterablePlayer({
    source: playbackSource,
    name: "Historical Playback",
    sourceId: "cached-history",
  });
}
```

### 2. 直接使用IndexedDbMessageStore

```typescript
import { IndexedDbMessageStore } from "@foxglove/studio-base/persistence/IndexedDbMessageStore";

// 创建存储实例（自动清理旧数据）
const store = new IndexedDbMessageStore({
  retentionWindowMs: 5 * 60 * 1000, // 5分钟窗口
  autoClearOnInit: true, // 自动清理旧数据
  sessionId: "my-session-id", // 可选，不提供则自动生成
});

await store.init();

// 存储消息
await store.append([
  {
    topic: "/sensor/data",
    receiveTime: { sec: 1699000000, nsec: 0 },
    message: { value: 42 },
    sizeInBytes: 24,
    schemaName: "sensor_msgs/Data",
  },
]);

// 查询历史消息
const messages = await store.getMessages({
  start: { sec: 1699000000, nsec: 0 },
  end: { sec: 1699000300, nsec: 0 }, // 5分钟后
  topics: ["/sensor/data"],
});

// 获取窗口统计
const stats = await store.getWindowStats();
console.log(`Window utilization: ${stats.windowUtilization}%`);
console.log(`Total messages: ${stats.messageCount}`);
```

### 3. 性能调优

```typescript
// 配置清理间隔（默认30秒）
store.setPruneInterval(60 * 1000); // 每分钟清理一次

// 手动触发清理
const result = await store.forcePrune();
console.log(`Pruned ${result.prunedCount} messages`);

// 在WebSocket Player中配置
player.configureCachePruning(45 * 1000); // 每45秒清理一次
```

## 架构设计

### 数据流

```
实时数据 → WebSocket Player → IndexedDbMessageStore → IndexedDB
                  ↓
            可视化界面 (实时)
                  ↓
         PersistentCacheIterableSource
                  ↓
            IterablePlayer (历史回放)
```

### 存储结构

```
IndexedDB (studio-realtime-cache)
├── messages (ObjectStore)
    ├── 主键: [sessionId, receiveTime.sec, receiveTime.nsec, seq]
    ├── 索引: bySessionTime
    ├── 索引: bySessionTopicTime
    └── 索引: bySession

注：sessionId 为内部实现细节，外部接口不涉及
```

### 会话隔离

通过创建独立的 `IndexedDbMessageStore` 实例来实现会话隔离：

- 每个实例管理自己的数据会话
- 实例化时自动生成唯一的内部会话ID
- 初始化时自动清理所有旧数据，确保会话独立性

## 内存与存储管理

### 5分钟滚动窗口

- **自动清理**: 基于消息时间戳自动删除超过5分钟的数据
- **间隔清理**: 默认每30秒执行一次清理操作，避免频繁I/O
- **性能优化**: 清理操作在事务中批量执行

### 存储容量

- **典型使用**: 5分钟窗口约占用50-200MB存储空间
- **自动管理**: 超时数据自动清理，无需手动干预
- **监控**: 提供详细的窗口利用率和缓存效率统计

## 错误处理

所有持久化操作都是非阻塞的，错误不会影响实时可视化：

```typescript
// 持久化错误不会中断实时数据流
await persistentCache.append(sessionId, messages).catch((error) => {
  log.debug("Cache operation failed:", error);
  // 实时可视化继续正常工作
});
```

## 兼容性

- **浏览器**: 支持所有现代浏览器的IndexedDB
- **桌面应用**: 在Electron环境中正常工作
- **向后兼容**: 不影响现有的可视化功能
- **可选启用**: 可通过配置禁用持久化功能

## 接口简化说明

从原本的多会话管理接口简化为单会话管理：

### 旧接口（已弃用）

```typescript
// 繁琐的多会话接口
await cache.append(sessionId, events);
const messages = await cache.getMessages({ sessionId, start, end });
const stats = await cache.stats({ sessionId });
```

### 新接口（推荐）

```typescript
// 简洁的单会话接口，sessionId 内部管理
await cache.append(events);
const messages = await cache.getMessages({ start, end });
const stats = await cache.stats();

// 多会话需求通过创建多个实例实现
const cache1 = new IndexedDbMessageStore({ sessionId: "session-1" });
const cache2 = new IndexedDbMessageStore({ sessionId: "session-2" });
```

## 最佳实践

1. **保持默认配置**: 5分钟窗口和30秒清理间隔已经过优化
2. **监控窗口利用率**: 使用`getWindowStats()`监控缓存状态
3. **适度调优**: 仅在特殊需求下调整清理间隔
4. **错误处理**: 持久化错误应记录但不影响主功能
5. **测试回放**: 定期验证历史回放功能的可用性
6. **会话隔离**: 通过创建独立实例而非传递sessionId参数来实现多会话管理
