# Spatial annotation protocol snapshot

`generated/` is a local, temporary copy of the generated protobuf-es code for
`coscene.dataplatform.v1alpha3.services.AnnotationService`. No published
`@coscene-io/cosceneapis-es-v2` contains it: on 2026-11-14 the `latest` tag (0.0.491)
and both branch builds (`0.0.488-branch.g26ae20a.772.1`, `0.0.488-branch.g944503d.770.1`)
were checked and none has `coscene/dataplatform/v1alpha3/services/annotation_pb`.

Source: cosceneapis PR #866, branch `feat/spatial-annotation-api`, commit `66758a9`
(2026-11-18), files `coscene/dataplatform/v1alpha3/{resources,services}/annotation.proto`.
That commit includes `SegmentFrame` (PR #870) and the propagation `direction`.

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

Everything imports the protocol from `services/api/spatial-annotation` (`index.ts`), never
from `generated/` directly. To switch to the published SDK once a release contains PR #866:

1. Add or bump `@coscene-io/cosceneapis-es-v2` in `packages/studio-base/package.json`.
2. In `index.ts`, point both `export *` lines at
   `@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/{resources,services}/annotation_pb`.
3. Delete `generated/` and this README, and the `spatial-annotation/generated` entries in
   `.prettierignore`, `.oxlintrc.json` and `eslint.config.cjs`.
4. Run the type-check and `liveService.test.ts`; a field renamed between #866 and the release
   shows up there.
