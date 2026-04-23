# syntax=docker/dockerfile:1.7
#
# Build context: the monorepo parent (i.e. `standalone/`). Build with:
#
#   docker build -f chio-open-claw-plugin/Dockerfile -t chio-openclaw standalone/
#
# Docker disallows `../` in COPY, so we lift the context up one level and
# preserve the in-repo layout inside /build so the `file:` deps in
# chio-open-claw-plugin/package.json (which point at `../chio-bridge` and
# `../arc/packages/sdk/chio-ts`) resolve unchanged.

FROM node:22-alpine AS build
WORKDIR /build
# better-sqlite3 needs a C toolchain on alpine.
RUN apk add --no-cache python3 make g++

# Copy workspace siblings first so the `file:` deps resolve during install.
# Layout inside the image mirrors the repo layout: /build/<repo>.
COPY chio-bridge /build/chio-bridge
COPY arc/packages/sdk/chio-ts /build/arc/packages/sdk/chio-ts

# Install + build the SDK (openclaw + bridge depend on its compiled dist/).
WORKDIR /build/arc/packages/sdk/chio-ts
RUN npm install --no-audit --no-fund --ignore-scripts \
 && npm run build

# Install + build the bridge (depends on the SDK via its file: link).
WORKDIR /build/chio-bridge
RUN npm install --no-audit --no-fund --ignore-scripts \
 && npm run build

# Now stage the openclaw plugin and install against the prebuilt siblings.
WORKDIR /build/chio-open-claw-plugin
COPY chio-open-claw-plugin/package.json chio-open-claw-plugin/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY chio-open-claw-plugin/tsconfig.json ./
COPY chio-open-claw-plugin/src ./src
COPY chio-open-claw-plugin/templates ./templates
RUN npm run build

# ---------------------------------------------------------------------------
# Runtime image
# ---------------------------------------------------------------------------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache sqlite
COPY --from=build /build/chio-open-claw-plugin/node_modules ./node_modules
COPY --from=build /build/chio-open-claw-plugin/dist ./dist
COPY --from=build /build/chio-open-claw-plugin/src/web ./src/web
COPY chio-open-claw-plugin/package.json ./
EXPOSE 8787
CMD ["node", "dist/src/index.js"]
