# Persistent cache design

This directory contains the read-only iterable source used by the `persistent-cache` data source.
The actual storage implementation lives in `packages/studio-base/src/persistence`, and this source
turns a stored cache session back into normal `IIterableSource` playback.

## Cache modes

The IndexedDB cache implementation is shared by two related but different features:

- `realtime-viz`: short-window WebSocket history for replaying recent realtime data through the
  `persistent-cache` data source.
- `playback-spill`: temporary overflow storage for normal iterable playback when in-memory cache
  blocks are evicted.

Both modes use `IndexedDbMessageStore`, but they use separate physical databases in addition to
`CacheSessionKind` and session-id isolation. Cleanup must always target the intended kind/session and
must not clear unrelated origin storage.

## IndexedDB storage

`IndexedDbMessageStore` owns two version-1 IndexedDB databases:

- `studio-realtime-history-v1` for `realtime-viz` sessions;
- `studio-playback-spill-v1` for `playback-spill` sessions.

The old `studio-realtime-cache` database is never opened or upgraded on the startup-critical path.
After the application layout becomes interactive, an idle task attempts to delete it. Deletion is
best-effort: if another Honeybee tab still has the old database open, the user is prompted to close
other tabs. The browser may finish the pending deletion after those blockers close; otherwise a later
startup or explicit action retries it. This cleanup must not delete extension databases, user layouts,
settings, or authentication state.

For temporary recovery on an affected web profile, close every other Honeybee tab, delete only the
`studio-realtime-cache` IndexedDB database in browser developer tools, and reload the page. Do not
clear all site data and do not delete `foxglove-extensions-org` or `foxglove-extensions-local`.

Each new cache database uses the same low-level schema and CRUD operations:

- `messages`: message events keyed by `[sessionId, receiveTime.sec, receiveTime.nsec, seq]`.
- `sessions`: session metadata, including `kind`, a non-sensitive source id, retention settings,
  lifecycle status, `nextSeq`, approximate byte size, and message count. Signed source URLs and
  query parameters are never persisted.
- `datatypes`: serialized datatype definitions per session.
- `topics`: complete topic metadata and optional topic stats per session.
- `loadedRanges`: loaded time ranges for playback spill coverage checks.

The message primary key keeps messages ordered by time while `nextSeq` is persisted in session
metadata so reopening the same session does not overwrite messages that share a receive timestamp.
Loaded ranges also carry the session's persisted content revision. Pruning increments that revision
in the same transaction as message deletion, so a late range write from another connection is
rejected and stale coverage is ignored.

`append()` is non-durable by design: it queues messages and schedules a batched IndexedDB write.
Callers may provide one storage-size estimate per message; accounting uses the larger of that estimate
and the normalized `sizeInBytes`, and rejects negative or non-finite values. Callers that need a
durability boundary must call `flush()` or `close()`. The queue has a hard size limit; exceeding it or
losing a write fails the cache closed and discards uncommitted cache work so incomplete coverage is
never advertised. By default queued estimates are capped at 128 MiB and each append transaction is
capped at 64 MiB; a larger indivisible message disables that cache generation. Shutdown work shares
one absolute deadline across draining, sealing, status fallback, and connection close. It reserves
time to mark an overdue session `abandoned` and aborts active IndexedDB transactions, so a stalled
request cannot hold player close indefinitely. Playback and realtime visualization then continue
without that cache.

Time pruning remains session-local. Global capacity is enforced separately for each physical database
using logical session totals together with `navigator.storage.estimate()`. Playback uses
`min(quota * 10%, 8 GiB)` with a 2 GiB fallback; realtime uses `min(quota * 5%, 2 GiB)` with a 512 MiB
fallback. Playback spill is disabled when its budget is below 256 MiB. At 80% origin usage, writes stop
and cleanup runs; stopped writes resume only when a later project is opened below the pressure
low watermark of 70%. If pruning removes messages from a `playback-spill` session, loaded range metadata is
cleared because coverage can no longer be trusted.

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
separate from the `persistent-cache` data source, but it shares the same IndexedDB primitives. The web
app's Playback disk cache setting controls all playback spill sources and is disabled by default.

The spill cache creates a random session id using the source id, records a stable topic fingerprint,
and writes messages while reading source ranges. Once a range is fully read without source problems,
it records a loaded range. Empty ranges are also recorded so seeking back through message-free spans
does not trigger another network read.

When replaying a requested interval, `CachingIterableSource` checks memory blocks first, then streams
covered spans from IndexedDB in bounded pages, and falls back to the underlying source for gaps. A
same-timestamp tail remains uncommitted until the next timestamp proves it complete, and that tail is
byte-bounded even when payload sizing fails. Backfill follows the same order: memory, spill cache,
then source. Every spill operation has a five-second business deadline; a stalled request disables
and seals only the spill cache before playback continues from the underlying source.

Playback spill sessions are temporary. Termination first seals the session, drops queued writes
without flushing data that is about to be deleted, waits for already-started transactions, and closes
the connection. Normal termination marks it `pending-delete`; failed teardown marks it `abandoned`.
Physical deletion is handled by a restart-safe janitor in short transactions, in the order
`pending-delete`, `abandoned`, then stale `active`. Failure to delete one session does not prevent later
sessions from being reclaimed, and the next startup retries unfinished cleanup. Janitor and global
budget passes are serialized with Web Locks across tabs (plus an in-process fallback) and have a
30-second absolute deadline. On timeout they abort transactions, close the connection, and return
from the lock callback even if an underlying browser promise never settles.

## Ownership rules

- Storage schema and session cleanup live in `IndexedDbMessageStore`.
- Realtime write policy lives in `RealtimeVizHistoryCache` and `FoxgloveWebSocketPlayer`.
- `PersistentCacheIterableSource` is read-only and must not own session deletion.
- Playback spill policy lives in `CachingIterableSource`.
- New cache behavior should preserve explicit durability boundaries: use `append()` for non-blocking
  enqueue, and use `flush()` or `close()` when later reads must observe queued writes.
