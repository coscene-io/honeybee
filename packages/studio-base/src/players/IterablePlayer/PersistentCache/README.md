# Persistent cache design

This directory contains the read-only iterable source used by the `persistent-cache` data source.
The actual storage implementation lives in `packages/studio-base/src/persistence`, and this source
turns a stored cache session back into normal `IIterableSource` playback.

## Cache modes

The IndexedDB cache is shared by two related but different features:

- `realtime-viz`: short-window WebSocket history for replaying recent realtime data through the
  `persistent-cache` data source.
- `playback-spill`: temporary overflow storage for normal iterable playback when in-memory cache
  blocks are evicted.

Both modes use `IndexedDbMessageStore`, but they are isolated by `CacheSessionKind` and session id.
Cleanup must always target the intended kind/session instead of clearing the whole database.

## IndexedDB storage

`IndexedDbMessageStore` opens the `studio-realtime-cache` IndexedDB database at version 2. It owns the
low-level schema and CRUD operations:

- `messages`: message events keyed by `[sessionId, receiveTime.sec, receiveTime.nsec, seq]`.
- `sessions`: session metadata, including `kind`, source keys, retention settings, status, `nextSeq`,
  approximate byte size, and message count.
- `datatypes`: serialized datatype definitions per session.
- `topics`: complete topic metadata and optional topic stats per session.
- `loadedRanges`: loaded time ranges for playback spill coverage checks.

The message primary key keeps messages ordered by time while `nextSeq` is persisted in session
metadata so reopening the same session does not overwrite messages that share a receive timestamp.

`append()` is non-durable by design: it queues messages and schedules a batched IndexedDB write.
Callers that need a durability boundary must call `flush()` or `close()`. The queue has a hard size
limit and drops the oldest queued messages if IndexedDB cannot keep up, so realtime visualization is
not blocked by cache pressure.

Pruning is session-local. Time pruning uses the session retention window, and size pruning uses the
session's approximate byte count instead of origin-wide browser storage estimates. If pruning removes
messages from a `playback-spill` session, loaded range metadata is cleared because coverage can no
longer be trusted.

## Realtime history path

`FoxgloveWebSocketPlayer` creates a `RealtimeVizHistoryCache` when the user-configured retention
window is greater than zero. That wrapper owns the realtime write policy:

- it creates an `IndexedDbMessageStore` with `kind: "realtime-viz"`;
- message appends are fire-and-forget so websocket handling stays non-blocking;
- topic metadata and datatypes are stored separately and re-written during `flush()`;
- initialization or write failures disable only the cache, not realtime visualization.

`persistent-cache` replay uses the current realtime session id. Switching away from the realtime
connection is responsible for deleting old realtime sessions; the read-only source in this directory
does not delete cache data.

## PersistentCacheIterableSource

`PersistentCacheIterableSource` is an `IIterableSource` facade over an existing
`IndexedDbMessageStore` session.

Initialization:

- requires a `sessionId`;
- opens the store with the provided retention and size settings;
- reads `stats()`, `getTopics()`, and `getDatatypes()`;
- returns an empty initialization if the session has no messages;
- returns a warning problem when messages exist but topic metadata is missing.

The source intentionally builds topics, datatypes, and topic stats from metadata instead of sampling
messages. This avoids missing topics that do not appear in the first messages of a cache session.

Iteration:

- reads only requested topics;
- defaults to the cached session's earliest/latest message times when `start` or `end` is omitted;
- queries IndexedDB in one-second chunks to avoid pulling the whole session into memory;
- yields message events in receive-time order;
- yields stamp records at chunk boundaries when needed so playback can advance through empty spans.

Backfill:

- delegates to `IndexedDbMessageStore.getBackfillMessages()`;
- returns the latest message at or before the requested time for each selected topic.

Termination:

- only closes the store connection;
- never deletes the session.

`PersistentCacheIterableSource.worker.ts` exposes the same source through `WorkerIterableSourceWorker`
and Comlink for worker-backed playback.

## Playback spill path

Normal iterable playback uses `CachingIterableSource` and may enable a `playback-spill` store. This is
separate from the `persistent-cache` data source, but it shares the same IndexedDB primitives.

The spill cache creates a random session id using the source id, records a stable topic fingerprint,
and writes messages while reading source ranges. Once a range is fully read without source problems,
it records a loaded range. Empty ranges are also recorded so seeking back through message-free spans
does not trigger another network read.

When replaying a requested interval, `CachingIterableSource` checks memory blocks first, then uses
loaded range coverage to read covered spans from IndexedDB, and falls back to the underlying source
for gaps. Backfill follows the same order: memory, spill cache, then source.

Playback spill sessions are temporary. Topic changes clear the current spill session, player
termination deletes it, page lifecycle handlers attempt best-effort cleanup, and stale spill sessions
are cleaned up using a short inactive TTL.

## Ownership rules

- Storage schema and session cleanup live in `IndexedDbMessageStore`.
- Realtime write policy lives in `RealtimeVizHistoryCache` and `FoxgloveWebSocketPlayer`.
- `PersistentCacheIterableSource` is read-only and must not own session deletion.
- Playback spill policy lives in `CachingIterableSource`.
- New cache behavior should preserve explicit durability boundaries: use `append()` for non-blocking
  enqueue, and use `flush()` or `close()` when later reads must observe queued writes.
