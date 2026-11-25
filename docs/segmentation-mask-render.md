# Drawing segmentation masks on the GPU

Mask observations (COCO compressed RLE) are drawn inside the Image panel, in the same three.js scene as the image and in the same frame. See [segmentation-geometry-model.md](segmentation-geometry-model.md) for the geometry model.

## Why WebGL2

The Image panel (the ImageMode of ThreeDeeRender) already is a WebGL2 scene. A mask is a mesh that shares the image geometry (`SegmentationMaskLayer`), so it follows zoom, pan, rotation, flips and undistortion and cannot drift from the image. WebGPU would need its own canvas and a compositing layer (with the risk of being a frame or more out of step), or moving the whole Image panel to WebGPU.

Both were compared on the same machine when choosing: the GPU pass is cheap in both (about 0.07–0.13 ms per camera), but WebGPU frame times were unstable during large texture uploads and it covers fewer devices than WebGL2 (about 89% against 97%). WebGL2 is therefore the only path; WebGPU can be considered when the whole Image panel migrates.

## Data flow

```
document (RLE counts)            Worker                      GPU (each Image panel)
  overlaySource:                 buildMaskPlanes             SegmentationMaskLayer
  topic + logTimeNs → geometry   RLE → transposed integer →  DataTexture R8/R16/R32UI
  stable geometry id             bit planes, cached with     texelFetch + highest visible bit
  style: visible / selected      a byte limit (shared by     submitted with the image's frame
                                 panels), prefetched by
                                 time window
```

- **Transposed bit planes** (`maskOverlay/maskPlanes.ts`): each instance takes one bit. Up to 8 instances use R8UI, up to 16 R16UI, up to 32 R32UI, and up to 64 two R32UI textures. Pixel (x, y) is stored at row x, column y of the texture, so each run of the column-major RLE is contiguous memory and building costs O(runs + pixels).
- **Overlap**: with one bit per instance, overlapping regions lose no instance. The shader prefers a selected instance and otherwise the highest slot. Outlines are about 1.5 screen pixels wide, and at least one image pixel at any zoom.
- **Frame accuracy**: the overlay matches the displayed frame by `topic + logTimeNs`. While the planes of the current frame are not ready, nothing is drawn for that frame; a neighbouring frame's mask is never shown.
- **Stable ids**: a geometry id changes only with the counts, so registering new frames during playback does not invalidate planes already built.
- **Building and caching** (`maskOverlay/maskPlaneCache.ts`): planes are built in a Worker (through Comlink). The CPU cache has a byte limit and is shared by the panels; the segmentation host owns it and releases it when it is disposed. The frame each panel displays is pinned and never evicted. 75% of the budget is available to prefetch, shared among the panels that have masks nearby, and prefetch follows a time window rather than a fixed number of frames.

## Degraded cases

Each is counted in the overlay's diagnostics; none happens silently.

| Situation                                           | Behaviour                                                            |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| The Worker is unavailable or fails                  | Planes are built on the main thread (still outside the render frame) |
| The current frame's planes are still being built    | No mask this frame; counted in the cache's `misses`                  |
| More than 64 instances on one frame                 | Only the first 64 are drawn; counted in `truncatedFrames`            |
| A mask's size differs from the topic's decoded size | That instance is skipped; counted in `sizeMismatches`                |
| A mask side exceeds `MAX_TEXTURE_SIZE`              | Not drawn; an error is logged                                        |
| No WebGL2                                           | The Image panel itself does not work; masks add no requirement       |

Integer textures are read only with `texelFetch` (they cannot be filtered linearly), which is core WebGL2 and needs no extension. The specification guarantees only `MAX_TEXTURE_SIZE` ≥ 2048: a transposed 1280×720 frame is 720×1280 and fits, while a 4K source is refused and counted on a device limited to 2048.

## Verified and not verified

- Verified in Chromium on macOS (Apple Silicon, ANGLE Metal): `texelFetch` on R8UI/R16UI/R32UI, five cameras playing and paused, and recovery by three.js after a lost context (triggered only in a micro benchmark).
- Not verified: Windows, Linux (especially software rendering without a GPU), Safari, Firefox; a lost WebGL context on the product page; real data with a 4K source or more than 64 instances.
- The sidebar instance tree (`SpatialTree`, `CameraFrameStrip`, `AnnotationPreview`) is split with narrow selectors and memo and is no longer a known bottleneck; it has not been measured again on a real long recording with many instances.

## To agree with the backend

- **Overlap semantics**: masks of several instances on one frame may overlap, and the editor keeps all of them. The contract should say whether overlap is allowed and which one is on top.
- **Where the size comes from**: `Mask` has no width or height, so the editor uses the decoded frame size of the topic. Adding them to `Mask` or `Frame`, or at least validating on the server, is recommended.
- **Instances per frame**: the editor draws at most 64 instances on a frame. If the business needs more, it should be discussed beforehand.
