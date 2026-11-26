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
| Quick annotation | Q                          | Positive and negative SAM points. Enter stages a mask.                                                   |
| Polygon          | P                          | Click each vertex, Enter finishes                                                                        |
| Brush / eraser   | B / E, `[` `]` change size | Edits a mask observation (or an instance with no observation on the frame); each stroke is one undo step |

The "+" of an instance in the tree starts drawing with the current tool; the tool switcher lists quick annotation first. Pressing P or Q while drawing switches tools and drops the other tool's draft. Polygons can still be drawn when quick annotation is unavailable.

## Merging and converting

- When either observation in a merge is a mask, `mergeObservations` rasterizes the polygons and takes the union. The canvas shows a representation-change notice when finishing a polygon on a mask or adding a quick annotation mask to a polygon observation. Moving polygons onto a mask-backed instance in the tree rasterizes them without that canvas notice.
- **Convert to polygons…** in the editing toolbar can preserve holes by representing the mask as a union of individually hole-free polygons. Simplification and small features can still change pixels. `maskConversionLoss` compares the rasterized result to the mask and measures intersection over union, pixels lost or added, holes filled, and foreground components dropped. The toolbar asks for confirmation when the conversion changes pixels. Undo restores the mask.
- A propagation result replaces the target observation on its frame. A polygon result can replace a mask through the staged propagation operation without the toolbar's conversion confirmation.
- "Convert to mask" in the toolbar turns polygons into a mask, which the brush can then edit.
- Double-clicking a mask starts editing that instance with the brush; it is no longer converted to polygons implicitly.

## Saving and reading (live service)

- Before encoding, the editor applies the backend's rules plus the two the backend does not check: a mask's pixel count must equal the topic's decoded width × height, and polygon coordinates are clamped to the image. Anything that fails rejects the whole save before any write and names the observation.
- An observation that cannot be decoded when read (a mask of the wrong size, for example) is not shown. It is recorded in the document's `unreadableObservations`, and the canvas says how many annotations of the frame cannot be shown. The adapter keeps the original wire data and sends it back unchanged when the frame is saved, so that a whole-frame snapshot does not delete it; once the user replaces or clears that instance on the frame, it is no longer sent back.
