FROM oven/bun:1.3.1 AS deps
WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/map/package.json packages/map/package.json
COPY packages/netcode/package.json packages/netcode/package.json
COPY packages/sim/package.json packages/sim/package.json

RUN bun install --frozen-lockfile

FROM deps AS build
WORKDIR /app

COPY apps/server ./apps/server
COPY packages/db ./packages/db
COPY packages/map ./packages/map
COPY packages/netcode ./packages/netcode
COPY packages/sim ./packages/sim
COPY test ./test

RUN bun run --cwd packages/db build \
  && bun run --cwd packages/map build \
  && bun run --cwd packages/netcode build \
  && bun run --cwd packages/sim build \
  && bun run --cwd apps/server build

FROM oven/bun:1.3.1 AS prod-deps
WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/map/package.json packages/map/package.json
COPY packages/netcode/package.json packages/netcode/package.json
COPY packages/sim/package.json packages/sim/package.json

RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.1 AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/bun.lock ./bun.lock
COPY --from=build /app/tsconfig.base.json ./tsconfig.base.json
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/packages/db ./packages/db
COPY --from=build /app/packages/map ./packages/map
COPY --from=build /app/packages/netcode ./packages/netcode
COPY --from=build /app/packages/sim ./packages/sim

EXPOSE 3000

CMD ["bun", "run", "--cwd", "apps/server", "start"]
