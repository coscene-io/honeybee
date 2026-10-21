# Moment grouping and field track protocol snapshot

The generated JS and declaration files come from cosceneapis PR #862 at
`ef03c11d34d228b7d1db3ae32bee8daa92ba9d5b`, using Buf 1.50.0 and the official
`es-v2/buf.gen.webes.yaml` template (`buf.build/bufbuild/es:v2.16.0`,
`import_extension=js`, default JS target).
Run `buf generate --template es-v2/buf.gen.webes.yaml` for
`coscene/dataplatform/v1alpha3/{common,services}/custom_field.proto`,
then that repository's `scripts/rewrite-googleapis-imports.mjs` before copying the output.
Apply repository Prettier formatting after copying; do not hand-edit descriptor payloads.

The latest stable SDK checked on 2026-10-21 is 0.0.487 and lacks this contract.
Only the Moment schema read uses these descriptors, through Honeybee's existing
client, transport, and permissions. Other custom-field APIs remain on the pinned SDK.
Replace this snapshot when a published SDK contains PR #862. Project rules are
configured in Mono through `SetMomentCustomFieldRules`; Honeybee only reads them.

`groupingRules` permits up to five nested single-select enum fields. `trackRules`
selects any number of supported custom fields for additional projections, with no
overlap with grouping fields. Missing rules retain the base Moment track. An older
backend returning no rules does not establish support for the new save method.
