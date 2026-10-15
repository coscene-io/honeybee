# @foxglove/studio-desktop

This is an internal package used for bundling the Foxglove Studio desktop app. Its API is not considered public or stable.

Desktop sign-in continues to accept the legacy `coscene://signin-complete?jwt=` callback, containing a Base64-encoded full `Bearer` or `Basic` authorization value. The URI and renderer arguments must never be written to logs. Cold-start and existing-window callbacks go through the main-process broker and wait for the renderer's auth-ready handshake; they are not ordinary playback deep links.

Each login gets a process-scoped increasing revision. Renderers serialize credential changes with Web Locks, retain the last revision after logout, and reject delayed login/logout messages. Logout aborts local protected requests and clears their in-memory credentials immediately, before committing shared storage under the lock. Local files and public shares keep playing on unrelated login or session expiry; explicit sign-out may stop playback. These checks do not add a server-side token-revocation or refresh protocol.

`coSceneAuthStatus` cookies are retired as sign-out notifications. Browser sessions use the same-origin credential and session-version state; existing runtime cookie field names remain accepted for deployment compatibility. Generic desktop deep-link restoration cookies remain in use.
