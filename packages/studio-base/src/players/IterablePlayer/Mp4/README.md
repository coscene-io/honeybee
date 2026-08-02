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
and playback requires browser WebCodecs support for the track's exact codec/profile. MP4 rotation
metadata is reported in frame references; applying non-zero track rotation in the renderer is not
yet implemented.
