# Spatial annotation protocol snapshot

`generated/` is a local, temporary copy of the generated protobuf-es code for
`coscene.dataplatform.v1alpha3.services.AnnotationService`. No published
`@coscene-io/cosceneapis-es-v2` contains it: on 2026-11-14 the `latest` tag (0.0.491)
and both branch builds (`0.0.488-branch.g26ae20a.772.1`, `0.0.488-branch.g944503d.770.1`)
were checked and none has `coscene/dataplatform/v1alpha3/services/annotation_pb`.

Source: cosceneapis PR #866, branch `feat/spatial-annotation-api`, commit
`96015385a12de1d75421d5dca08476a31fe94ffb` (2026-11-13), files
`coscene/dataplatform/v1alpha3/{resources,services}/annotation.proto`, plus `SegmentFrame`
from PR #870 as amended on local branch `feat/annotation-segment-frame` (commit `e6a5ba0`,
2026-11-18; documentation-only changes on top of #870). Regenerate from the merged
contract once #870 lands; only `services/annotation_pb.ts` changed.

Generator: `@bufbuild/protoc-gen-es@2.10.1` (the same version as Honeybee's
`@bufbuild/protobuf` runtime), TypeScript target, googleapis imports rewritten to the
`@buf/googleapis_googleapis.bufbuild_es` package Honeybee already depends on.

```yaml
# buf.gen.annotation.yaml, run from a cosceneapis checkout at the commit above
version: v2
plugins:
  - local: <path>/node_modules/.bin/protoc-gen-es # @bufbuild/protoc-gen-es@2.10.1
    out: gen-out
    opt:
      - target=ts
      - rewrite_imports=./google/**/*_pb.js:@buf/googleapis_googleapis.bufbuild_es
```

```bash
buf generate --template buf.gen.annotation.yaml \
  --path coscene/dataplatform/v1alpha3/services/annotation.proto \
  --path coscene/dataplatform/v1alpha3/resources/annotation.proto
```

Copy `gen-out/coscene` here unchanged; do not hand-edit descriptor payloads.

Replace this snapshot with the published SDK once a release contains PR #866: change the
imports in `util/coscene/annotation.ts` to
`@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/services/annotation_pb` and
delete this directory together with its lint and Prettier ignore entries.
