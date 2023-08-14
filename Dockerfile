# Build stage
FROM node:16 as build
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

EXPOSE 8080

COPY <<EOF /entrypoint.sh
# Optionally override the default layout with one provided via bind mount
mkdir -p /foxglove
touch /foxglove/default-layout.json
index_html=\$(cat index.html)
replace_pattern='/*FOXGLOVE_STUDIO_DEFAULT_LAYOUT_PLACEHOLDER*/'
replace_value=\$(cat /foxglove/default-layout.json)
echo "\${index_html/"\$replace_pattern"/\$replace_value}" > index.html

# Continue executing the CMD
exec "\$@"
EOF

ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
CMD ["caddy", "file-server", "--listen", ":8080"]
