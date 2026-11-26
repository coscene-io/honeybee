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
  style: visible / selected      a shared target budget      submitted with the image's frame
                                 prefetch by time window
```

- **Transposed bit planes** (`maskOverlay/maskPlanes.ts`): each instance takes one bit. Up to 8 instances use R8UI, up to 16 R16UI, up to 32 R32UI, and up to 64 two R32UI textures. Pixel (x, y) is stored at row x, column y of the texture, so each run of the column-major RLE is contiguous memory and building costs O(runs + pixels).
- **Overlap**: with one bit per instance, overlapping regions lose no instance. The shader prefers a selected instance and otherwise the highest slot. Outlines are about 1.5 screen pixels wide, and at least one image pixel at any zoom.
- **Frame accuracy**: the overlay matches the displayed frame by `topic + logTimeNs`. While the planes of the current frame are not ready, nothing is drawn for that frame; a neighbouring frame's mask is never shown.
- **Stable IDs.** For the same topic and log time, `overlaySource` reuses the previous geometry ID when the width, height, ordered instance IDs, and counts all match. If the previous geometry drops out of the bounded history, a later rebuild can issue a new ID.
- **Building and caching.** A Worker builds the planes through Comlink. The segmentation host owns the shared CPU cache and releases it on disposal. The cache targets 96 MiB and pins the frame each panel displays. Pinned entries can push `cachedBytes` above the target. Prefetch uses a time window, with 75% of the budget shared among panels with masks nearby.

## Degraded cases

| Situation                                                         | Behaviour                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Worker is unavailable or fails                                | The cache builds planes on the main thread outside the requesting render frame. Worker creation failures and abandonment produce a warning. The diagnostics have no fallback counter.                                                                                           |
| The current frame's planes are still being built                  | The renderer withholds the mask and the cache counts a miss.                                                                                                                                                                                                                    |
| More than 64 compatible masks on one frame                        | The overlay source keeps the first 64 slots and increments `truncatedFrames`. The GPU and cache limits still apply.                                                                                                                                                             |
| A mask differs in size from the first mask on its frame           | The overlay source skips that mask and increments `sizeMismatches`. It uses the first mask's dimensions for all retained masks.                                                                                                                                                 |
| The frame's planes need more than one quarter of the cache budget | The cache rejects the geometry and increments `errors`. With the default budget, the cutoff is 24 MiB. A 3840×2160 frame with 17–32 compatible masks needs about 31.6 MiB for one R32UI plane, so the renderer withholds all its masks even on a GPU that supports 4K textures. |
| A mask side exceeds `MAX_TEXTURE_SIZE`                            | The renderer withholds the mask and logs a warning. This check has no diagnostics counter.                                                                                                                                                                                      |
| No WebGL2                                                         | The Image panel itself requires WebGL2.                                                                                                                                                                                                                                         |

The overlay draws on the image mesh. If the first mask's dimensions differ from the image's decoded dimensions, the mesh stretches the mask to fit. `sizeMismatches` compares masks on the same frame.

Integer textures use WebGL2's `texelFetch`. On a device with `MAX_TEXTURE_SIZE` of 2048, a transposed 1280×720 frame fits and a 4K mask exceeds the limit.

## Verified and not verified

- Verified in Chromium on macOS (Apple Silicon, ANGLE Metal): `texelFetch` on R8UI/R16UI/R32UI, five cameras playing and paused, and recovery by three.js after a lost context (triggered only in a micro benchmark).
- Not verified: Windows, Linux (especially software rendering without a GPU), Safari, Firefox; a lost WebGL context on the product page; real data with a 4K source or more than 64 instances.
- The sidebar instance tree (`SegmentationTree`, `CameraFrameStrip`, `SegmentationPreview`) is split with narrow selectors and memo and is no longer a known bottleneck; it has not been measured again on a real long recording with many instances.

## To agree with the backend

- **Overlap semantics**: masks of several instances on one frame may overlap, and the editor keeps all of them. The contract should say whether overlap is allowed and which one is on top.
- **Where the size comes from**: `Mask` has no width or height, so the editor uses the decoded frame size of the topic. Adding them to `Mask` or `Frame`, or at least validating on the server, is recommended.
- **Instances per frame**: the editor draws at most 64 instances on a frame. If the business needs more, it should be discussed beforehand.
