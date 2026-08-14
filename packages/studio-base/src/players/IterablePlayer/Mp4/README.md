# Remote MP4 design notes

The source opens the URL through `BrowserHttpReader` and a dedicated exact-range reader. HTTP and
Mediabunny caches are bounded at 192 MiB and 8 MiB respectively. Mediabunny background prefetch is
disabled. Small reads share deterministic on-demand windows of at most 512 KiB, while larger reads
are fetched at their exact requested size, so opening or seeking never creates a full local or
in-memory copy of the MP4.

Mediabunny reads the MP4 sample tables during initialization. Fast-start files need only prefix
metadata; moov-at-end files add a tail range without traversing the intervening `mdat`. The player
stores small presentation-time frame references rather than compressed or decoded media. At the
Image/3D renderer boundary, a main-thread provider proxy asks a dedicated Mediabunny/WebCodecs
worker to resolve those references with `VideoSampleSink`: seeks begin at the required random
access point and sequential playback reuses the active decode session. Decoded `VideoFrame`s are
transferred back to the renderer and closed when superseded.

This separation lets the normal player timeline, VFR timestamps, annotations, and message caches
remain serializable while Mediabunny/WebCodecs handle decode order and return B-frames in
presentation order.

The HTTP server must provide `Content-Length` and `Accept-Ranges: bytes`. Browser deployments also
need CORS access and must expose `Accept-Ranges`. The source accepts H.264 and H.265 MP4 tracks only,
and playback requires browser WebCodecs support for the track's exact codec/profile. MP4 track
rotation metadata is applied at the renderer boundary before display.

## Browser benchmark

The opt-in Playwright benchmark exercises the production web bundle, HTTP Range transport,
Mediabunny worker, WebCodecs decoder, player seeking, and Image panel rendering. Media stays outside
the repository:

```sh
REMOTE_MP4_BENCHMARK_DIR=/absolute/path/to/mp4s yarn benchmark:remote-mp4
```

Set `REMOTE_MP4_BENCHMARK_LIMIT` to cap the number of alphabetically sorted inputs, or
`REMOTE_MP4_BENCHMARK_FILES` to a comma-separated list of file names. Playwright's bundled Chromium
may not include the codec support available in an installed browser; for example, set
`REMOTE_MP4_BENCHMARK_BROWSER_CHANNEL=chrome` to exercise installed Google Chrome. The benchmark
reports source initialization and first-frame latency, individual and rapid-seek latency, sampled
playback frame changes, main-thread long tasks, JavaScript heap size, and HTTP request/byte coverage.
It enforces correctness invariants but intentionally does not impose machine-dependent latency
thresholds. For before/after comparisons, build another revision and set
`REMOTE_MP4_BENCHMARK_APP_DIR` to its `web/.webpack` directory; use `REMOTE_MP4_BENCHMARK_LABEL` to
identify each JSON result set.
