# Moment custom field tracks fixture

Build and serve the existing timeline benchmark from the repository root:

```sh
yarn rspack build --mode production --config benchmark/moments.rspack.config.ts
python3 -m http.server 8087 --bind 127.0.0.1 --directory benchmark/.webpack-moments
```

Open <http://127.0.0.1:8087/?count=8&distribution=continuous&groupLevels=1&groupCount=1&fieldTracks=true>.
Add `&theme=light` to check the light theme. Increase the timeline height using its splitter to see every row.

The timeline's More menu places **Moment grouping and tracks** below the seek step,
separated from the playback tools. It opens the current project's console page in
a new tab with `?momentRules=1`, which asks Mono to open its existing shared rules
editor. Public projects use the data publisher's organization slug, including
when it differs from the signed-in organization. The fixture uses synthetic
organization/project slugs; its link is for
visual inspection, not a deployed project configuration test.

In a connected project, returning to the visible, focused studio reloads the
project's Moment schema once per foreground transition. Existing rules remain in
use while the request is pending or fails; late responses from previous requests
or projects cannot replace the latest rules. Playback, zoom, and personal track
visibility are not reset.

The fixture enables seven field tracks: text, number (including zero), single and
multiple enum values, timestamp, and single and multiple users. User names are
resolved through the mock batch API. Each original Moment appears on its base row
and seven additional rows; group counts still count original Moments once.

Check independent base/field visibility, group collapse, and drag/resize/linked
editing from a field row. Editing a projection must update the original Moment
and all its visible projections. Fields with no usable value produce no bar.

This page uses production timeline components with synthetic records and mocked
APIs. It does not verify backend rule persistence or deployments. The existing
performance measurements in `MOMENT_PERFORMANCE.md` predate field tracks and do
not measure the additional projection workload.
