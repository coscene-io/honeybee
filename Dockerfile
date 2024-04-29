# Build stage
FROM node:20 as build
WORKDIR /src
ARG CURRENT_IMAGE_TAG
ARG GITHUB_SHA
ARG BUF_BUILD_TOKEN
ARG GH_PACKAGES_ORG_TOKEN
ARG SENTRY_AUTH_TOKEN
ENV IMAGE_TAG=${CURRENT_IMAGE_TAG}

COPY . ./

RUN corepack enable
RUN yarn install

RUN yarn run web:build:prod

# Release stage
FROM caddy:2.5.2-alpine
WORKDIR /src
COPY --from=build /src/web/.webpack ./
COPY --from=build /src/web/Caddyfile ./

EXPOSE 8080

CMD ["caddy", "run"]
