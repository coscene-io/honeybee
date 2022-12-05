# Build stage
FROM node:16 as build
WORKDIR /src
ARG BUF_TOKEN \
  GH_PACKAGES_ORG_TOKEN \
  PROJECT_ENV

COPY . ./

RUN corepack enable
RUN yarn install --immutable

ENV FOXGLOVE_DISABLE_SIGN_IN=true
RUN yarn run web:build:prod --env PROJECT_ENV=${PROJECT_ENV}

# Release stage
FROM caddy:2.5.2-alpine
WORKDIR /src
COPY --from=build /src/web/.webpack ./

EXPOSE 8080
CMD ["caddy", "file-server", "--listen", ":8080"]
