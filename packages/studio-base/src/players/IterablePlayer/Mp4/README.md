# Remote MP4 design notes

The source opens the URL through `BrowserHttpReader` and a dedicated exact-range reader. Its LRU
cache is bounded at 200 MiB, and network requests never extend beyond the byte range requested by
the demuxer. The source does not perform background read-ahead or create a full local copy.

Initialization feeds sparse 1 MiB ranges to mp4box. For a moov-at-end file, mp4box returns the byte
offset after `mdat`, so initialization jumps directly to the tail metadata rather than reading media
bytes in between. Playback and seek create independent progressive extraction sessions, call
`seek(time, true)` to begin at a random access point, read 4 MiB media windows, and release extracted
sample data with `releaseUsedSamples` after converting the sample from length-prefixed NAL units to
Annex-B.

The HTTP server must provide `Content-Length` and `Accept-Ranges: bytes`. Browser deployments also
need CORS access and must expose `Accept-Ranges`. Only unfragmented H.264 (`avc1`/`avc3`) and H.265
(`hvc1`/`hev1`) MP4 tracks are supported. Out-of-band codec parameter sets are prepended to
keyframes; `avc3` and `hev1` tracks may instead carry them in-band. B-frame files produce a player
warning and are emitted in decode-timestamp order because `foxglove.CompressedVideo` does not
support presentation reordering.

## Development Mediabunny spike

The web development build has an isolated Mediabunny/WebCodecs spike at
`/?mp4MediabunnySpike=1&url=<encoded-mp4-url>`. It does not replace the production `remote-mp4`
player. It uses Mediabunny's `CustomSource` to adapt the existing exact-range HTTP reader, with an
8 MiB demux cache plus a 192 MiB HTTP LRU cache (200 MiB combined). Small adjacent sample reads share
deterministic on-demand windows of at most 512 KiB. Mediabunny adaptive/background prefetch is
disabled so paused seek and short playback cannot run ahead through the rest of the file.

Mediabunny parses fast-start and moov-at-end MP4 indexes, seeks to the required random access point,
decodes dependencies through WebCodecs, and returns frames in presentation order. Consequently,
paused exact seek and continuous video-only playback both support B-frames and variable frame rate
without remuxing to MSE or materializing the complete file. The UI reports each source byte range so
the sparse access pattern can be inspected.

This spike has no audio clock and has not yet replaced the production `foxglove.CompressedVideo`
message path. Production integration still needs a decoded-frame provider seam shared by the Image
and 3D panels. Codec availability is determined by the browser's WebCodecs implementation. The same
`Content-Length`, HTTP Range, and browser CORS requirements as `remote-mp4` apply.
