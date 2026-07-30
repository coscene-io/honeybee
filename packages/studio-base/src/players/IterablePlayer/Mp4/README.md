# Remote MP4 design notes

The source opens the URL through `BrowserHttpReader` and `CachedFilelike` via the same
`RemoteFileReadable` used by remote MCAP. The cache is bounded at 200 MiB; the source never creates
a full local copy or a full-file conversion buffer.

Initialization feeds sparse 1 MiB ranges to mp4box. For a moov-at-end file, mp4box returns the byte
offset after `mdat`, so initialization jumps directly to the tail metadata rather than reading media
bytes in between. Playback and seek create independent progressive extraction sessions, call
`seek(time, true)` to begin at a random access point, read 4 MiB media windows, and release extracted
sample data with `releaseUsedSamples` after converting the sample from length-prefixed NAL units to
Annex-B.

The HTTP server must provide `Content-Length` and `Accept-Ranges: bytes`. Browser deployments also
need CORS access and must expose `Accept-Ranges`. Only unfragmented H.264 (`avc1`/`avc3`) and H.265
(`hvc1`/`hev1`) MP4 tracks are supported. Codec parameter sets are prepended to keyframes. B-frame
files produce a player warning and are emitted in decode-timestamp order because
`foxglove.CompressedVideo` does not support presentation reordering.
