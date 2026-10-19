# Moment grouping protocol snapshot

The generated JS and declaration files are copied unchanged from Mono PR #3420
at e791975c8db3ae5bcb27b474819e5056e8344504. They were generated from
cosceneapis PR #862 at f99439c36452eb76cd60e68d6d8bf5596fb7613a using
`buf.build/bufbuild/es:v2.16.0`, `import_extension=js`, and the default JS target.
Run `buf generate` for `coscene/dataplatform/v1alpha3/{common,services}/custom_field.proto`,
then that repository's `scripts/rewrite-googleapis-imports.mjs` before copying the output.
Do not edit the generated files.

The latest published SDK checked on 2026-10-19 is 0.0.487 and lacks this contract.
Only the Moment schema read uses these descriptors, through Honeybee's existing
client, transport, and permissions. Other custom-field APIs remain on the pinned SDK.
Replace this snapshot when a published SDK contains PR #862. No grouping write API,
local configuration fallback, or organization-level grouping is added here.

An older backend returns no grouping rules, which renders the existing ungrouped
view. This does not establish that the backend supports saving grouping rules.
