# @foxglove/studio-web

This is an internal package used for bundling the Foxglove Studio web app. Its API is not considered public or stable.

## Organization access

Private short links are checked through Gidle's `/bff/shortenUrl/:id/access`
before mounting StudioApp. Deploy the Gidle access endpoint and Web's named
organization switch entry before this viewer. The viewer only uses the current
credential for the metadata check; existing API clients keep their immutable
session and abort on a session boundary.

The access page and blocking dialog use Studio's theme and MUI components.
A switch routes through Console `/switch-organization` with an organization name
and the complete return path. Console validates membership and credentials again.
Unknown legacy links remain generic access failures, never inferred mismatches.
Public shares and local playback retain their existing session-independent behavior.
Working layout copies remain in local storage, with a leave warning for pending
or transient edits; the playback position is captured before player teardown.
