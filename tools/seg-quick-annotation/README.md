# Quick-annotation server (SAM2.1)

The segmentation editor's quick-annotation tool (Q) turns clicks on the displayed frame into one
mask. Until the AnnotationService offers this operation (cosceneapis #870), the web app posts to
this server through a Cloudflare Tunnel at the fixed URL in
`packages/studio-base/src/semanticSegmentation/quickSegment.ts`. Everything else, including
propagation, goes through the AnnotationService.

- Model: Meta `sam2`, checkpoint `sam2.1_hiera_small`, PyTorch on MPS (Apple Silicon) or CPU.
- Privacy: the browser uploads the displayed frame only when the user runs quick annotation.
  Browser origins are limited to coScene domains and localhost (`--allow-origin` to change).

## API

`POST /segment`, multipart form:

- `request`: JSON `{frameToken, points: [{x, y, positive}]}`, points in source pixels.
- `image` (optional): the displayed frame. The embedding of the last uploaded frame is cached
  under its random `frameToken`; later clicks on the same frame send the token without `image`.
  A request whose token is not the cached one gets HTTP 400 and the client uploads again.

Answer: `{counts, width, height, score, area}`, a COCO RLE mask at the image size. The first click
on a frame takes about 1 s (upload and image encoding); each further click 20–70 ms on an M4 Max.

## Run

```bash
tools/seg-quick-annotation/run.sh            # listens on 127.0.0.1:18876
cloudflared tunnel run <tunnel-name>          # forwards the public URL to it (protocol: http2)
```

The first run creates `.venv` (uv, Python 3.12) and downloads the 176 MB checkpoint into
`weights/` (both git-ignored).
