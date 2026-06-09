# Build stage
FROM node:24 as build
WORKDIR /src
ARG CURRENT_IMAGE_TAG
ARG GITHUB_SHA
ARG GH_PACKAGES_ORG_TOKEN
ARG SENTRY_AUTH_TOKEN
ENV IMAGE_TAG=${CURRENT_IMAGE_TAG}
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY . ./

RUN corepack enable
RUN yarn install --immutable

RUN yarn run web:build:prod

# Release stage
FROM caddy:2.5.2-alpine
WORKDIR /src
COPY --from=build /src/web/.webpack ./
COPY --from=build /src/web/Caddyfile ./

EXPOSE 8080

CMD ["caddy", "run"]
