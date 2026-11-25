# The segmentation editor's geometry model

The contract (cosceneapis #866) gives every observation (one instance on one frame) exactly one geometry: `oneof geometry { Polygons polygons; Mask mask; }`. The editor does the same, and treats the mask as the lossless side when it has to choose.

## Data model

`FrameInstance = { frameId, instanceId } & ({ kind: "polygons", polygons } | { kind: "mask", mask })` (`types.ts`).

- The type cannot express "both". Geometry is read with `polygonsOf()` / `maskOf()` (`maskGeometry.ts`): a mask observation has an empty polygon list, and the reverse.
- An observation in the document always has foreground: a polygon observation has at least one complete polygon (three vertices or more), a mask at least one foreground pixel. Deleting the last polygon, or erasing a whole mask, removes the observation instead of leaving an empty one. `polygonObservation()` / `maskObservation()` keep this invariant.
- A propagation result can be `{ kind: "empty" }`, meaning the instance is cleared on that frame.

## Creating geometry

Drawing is a session: the store records only `drawing = { instanceId, frameId }` and `creationTool` (`polygon` / `quick`, remembered in the app setting `segmentation.creationTool`). The draft (vertices or SAM clicks) lives only in the canvas. Cancelling leaves nothing behind; finishing writes the whole geometry at once (`addPolygon` / `addMask`).

| Tool             | Keys                       | Result                                                                                                   |
| ---------------- | -------------------------- | -------------------------------------------------------------------------------------------------------- |
| Polygon          | P                          | Click each vertex, Enter finishes                                                                        |
| Quick annotation | Q                          | Positive and negative SAM points, Enter saves a mask                                                     |
| Brush / eraser   | B / E, `[` `]` change size | Edits a mask observation (or an instance with no observation on the frame); each stroke is one undo step |

The "+" of an instance in the tree starts drawing with the current tool. Pressing P or Q while drawing switches tools and drops the other tool's draft. Polygons can still be drawn when quick annotation is unavailable.

## Merging and converting

- When two observations of one instance on one frame are merged and either side is a mask, the result is a mask (`mergeObservations`): drawing a polygon on a mask, merging a quick annotation result into a polygon observation, and moving polygons onto an instance that has a mask all rasterize the polygons and take the union. Rasterizing loses only sub-pixel precision; the canvas says that the representation changed.
- A mask becomes polygons only when the user asks for it ("Convert to polygons…" in the editing toolbar). A union of polygons cannot express holes or one-pixel slivers, so `maskConversionLoss` first computes the IoU, the pixels lost and added, the holes filled and the small regions dropped. A lossy conversion asks for confirmation; a lossless one converts directly. Undo restores the mask.
- "Convert to mask" in the toolbar turns polygons into a mask, which the brush can then edit.
- Double-clicking a mask starts editing that instance with the brush; it is no longer converted to polygons implicitly.

## Saving and reading (live service)

- Before encoding, the editor applies the backend's rules plus the two the backend does not check: a mask's pixel count must equal the topic's decoded width × height, and polygon coordinates are clamped to the image. Anything that fails rejects the whole save before any write and names the observation.
- An observation that cannot be decoded when read (a mask of the wrong size, for example) is not shown. It is recorded in the document's `unreadableObservations`, and the canvas says how many annotations of the frame cannot be shown. The adapter keeps the original wire data and sends it back unchanged when the frame is saved, so that a whole-frame snapshot does not delete it; once the user replaces or clears that instance on the frame, it is no longer sent back.
