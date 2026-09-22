# syntax=docker/dockerfile:1
# Debian slim rather than Alpine: pdfjs-dist pulls @napi-rs/canvas, whose prebuilt binaries are
# glibc. On musl they fall back to a source build that needs a full toolchain.
FROM node:26-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install -g pnpm@12.4.2
WORKDIR /repo

# Dependencies resolve from the lockfile alone, so this layer survives any source edit.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY . .
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
ARG NEXT_PUBLIC_SENTRY_ENABLED=true
ARG NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.1
ARG SENTRY_RELEASE
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT
ENV NEXT_PUBLIC_SENTRY_ENABLED=$NEXT_PUBLIC_SENTRY_ENABLED
ENV NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=$NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
ENV NEXT_PUBLIC_SENTRY_RELEASE=$SENTRY_RELEASE
ENV SENTRY_RELEASE=$SENTRY_RELEASE
# The build must not reach the database or a provider; only compilation happens here.
RUN --mount=type=secret,id=sentry_auth_token,env=SENTRY_AUTH_TOKEN pnpm --filter @k5/web build

FROM base AS runtime
ENV NODE_ENV=production
# node:sqlite needs a writable path that is not inside the build output.
ENV DATABASE_PATH=/data/k5.sqlite
ENV VAULT_STORAGE_PATH=/data/uploads

COPY --chown=node:node --from=deps /repo/node_modules ./node_modules
COPY --chown=node:node --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --chown=node:node --from=build /repo/apps/web/.next ./apps/web/.next
COPY --chown=node:node --from=build /repo/apps/web/public ./apps/web/public
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY --chown=node:node apps/web/package.json apps/web/next.config.ts apps/web/tsconfig.json ./apps/web/
COPY --chown=node:node apps/web/db ./apps/web/db
COPY --chown=node:node apps/web/scripts ./apps/web/scripts
COPY --chown=node:node apps/web/src ./apps/web/src

# The runtime user owns /data so the volume is writable without running as root.
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
WORKDIR /repo/apps/web

EXPOSE 3000
CMD ["pnpm", "start"]
