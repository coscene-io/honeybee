# Local propagation sidecar (SAM2.1 on Apple Silicon)

A stand-in for `AnnotationService/PropagateAnnotation` while the dev backend has no propagation
(data-platform-server #2403 returns PERMISSION_DENIED / UNIMPLEMENTED). It serves only that one
method over gRPC-Web on `127.0.0.1:18876`; every other annotation RPC still goes to dev.

- Model: Meta `sam2` (the same family det_seg uses for `sam2.1-video` / `sam2.1-motion`),
  `sam2.1_hiera_small`, PyTorch MPS. The request's `model` is ignored.
- Frames: the record's original MCAP on disk. A request topic `…/compressed/h264` is read from the
  source JPEG topic `…/compressed`; for CJ260330-3-R154 both carry identical log times on all five
  cameras. `frame_time` is the log time truncated to microseconds, as in cosceneapis #866.
- Seeds: polygons are rasterized at the source size; masks are COCO counts decoded at that size.
  Results stream as one `frame` event per later source frame with a `mask` per instance.
- One run at a time. Closing the connection (STOP) cancels it. Nothing is saved.

## Run

```bash
tools/seg-local-propagation/run.sh /path/to/CJ260330-3-R154.mcap
```

The first run creates `.venv` (uv, Python 3.12) and downloads the 176 MB checkpoint into `weights/`
(both git-ignored). Startup indexes the MCAP in about 5 s.

Then, in the browser that runs the editor (once per origin):

```js
localStorage.setItem("coStudio.semanticSegmentation.propagationUrl", "http://127.0.0.1:18876");
```

Reload. The app bar shows `正式服务 · 本机传播`. Remove the key to go back to the backend.

Measured on an M4 Max: 30 head_rgbd frames (1280×720, 1 s) in 9–10 s.

`gen/` is `protoc --python_out` of cosceneapis #866 @ 9601538
(`buf generate` with `protoc_builtin: python` on the two annotation protos).
