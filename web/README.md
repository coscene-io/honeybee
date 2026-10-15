This is an internal package used for bundling the Foxglove Studio web app. Its API is not considered public or stable.

## Browser authentication deployments

The default `/viz/` build runs beside Console and uses its same-origin `/auth/*` routes and session storage. The root build (`HONEYBEE_WEB_PUBLIC_PATH=/`), used by standalone viewers, keeps public shares and local playback on the viewer. Private-data sign-in and passive recovery continue on the HTTPS Console host selected by `DOMAIN_CONFIG.webDomain`. Console receives `/viz` plus the original query parameters and hash as `redirectToPath`; no viewer credential is transferred between origins. Signing in continues in Console rather than returning to the independent viewer origin.

Validate both production configurations locally without deploying:

```sh
HONEYBEE_WEB_PUBLIC_PATH=/viz/ yarn web:build:prod
HONEYBEE_WEB_PUBLIC_PATH=/viz/ INTEGRATION_SKIP_BUILD=1 yarn test:web-integration --testPathPatterns=browserSession.test.ts --runInBand
HONEYBEE_WEB_PUBLIC_PATH=/ yarn web:build:prod
HONEYBEE_WEB_PUBLIC_PATH=/ INTEGRATION_SKIP_BUILD=1 yarn test:web-integration --testPathPatterns=browserSession.test.ts --runInBand
```

The browser tests use synthetic credentials and mocked Console/API endpoints.
