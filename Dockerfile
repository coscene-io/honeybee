# Build stage
FROM node:18-bullseye as build
WORKDIR /src
ARG BUF_TOKEN \
  GH_PACKAGES_ORG_TOKEN \
  PROJECT_ENV

ENV NODE_OPTIONS=--max_old_space_size=6144
RUN DEBIAN_FRONTEND=noninteractive && apt-get update && apt-get install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev

COPY . ./

RUN corepack enable
RUN yarn config set httpProxy http://gfw:7890
RUN yarn config set httpsProxy http://gfw:7890
RUN yarn set version berry
RUN yarn cache clean
RUN yarn install

ENV FOXGLOVE_DISABLE_SIGN_IN=true
RUN yarn run web:build:prod

# Release stage
FROM caddy:2.5.2-alpine
WORKDIR /src
COPY --from=build /src/web/.webpack ./

EXPOSE 8080
CMD ["caddy", "file-server", "--listen", ":8080"]
