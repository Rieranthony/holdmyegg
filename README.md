# HoldMyEgg

HoldMyEgg is a voxel arena game built with Bun, React, Three.js, and an authoritative Bun + Hono multiplayer server. The repo now includes:

- solo `Explore` and `PLAY NPC` modes
- a shared simulation package used by both web and server
- anonymous Better Auth sessions with persistent multiplayer stats
- Bun websocket rooms with waiting-room chat, spectators, and room rotation
- Drizzle + Postgres persistence for profiles, lifetime stats, and match history

## Repo Layout

- `apps/web`: Vite client, renderer, HUD, menu shell, multiplayer client
- `apps/server`: Bun + Hono server, Better Auth, room manager, websocket entrypoint
- `packages/map`: voxel map schema, serialization, world editing helpers
- `packages/sim`: fixed-step gameplay simulation and authoritative match logic
- `packages/netcode`: shared multiplayer contracts, binary codecs, runtime input packing
- `packages/db`: Drizzle schema, migrations, and database helpers
- `test`: shared test setup and fixtures

## Local Setup

### 1. Start Postgres

```bash
docker compose up -d
```

This starts a local Postgres instance on `localhost:55432` by default with:

- database: `out_of_bounds`
- user: `postgres`
- password: `postgres`

### 2. Add env files

Copy these examples into real env files before starting the app:

- [`.env.example`](.env.example)
- [`apps/server/.env.example`](apps/server/.env.example)
- [`apps/web/.env.example`](apps/web/.env.example)

The root `.env` is used by Docker Compose for local infra defaults like `POSTGRES_PORT`.

Required server env vars:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `PUBLIC_SERVER_URL`
- `WEB_ORIGIN`

Local default values:

```env
POSTGRES_PORT=55432
DATABASE_URL=postgres://postgres:postgres@localhost:55432/out_of_bounds
BETTER_AUTH_URL=http://localhost:3000
PUBLIC_SERVER_URL=http://localhost:3000
WEB_ORIGIN=http://localhost:5173
VITE_SERVER_URL=http://localhost:3000
```

### 3. Install dependencies

```bash
bun install
```

### 4. Start the web app and multiplayer server together

```bash
bun run dev
```

This starts both local processes:

- web app on `http://localhost:5173`
- Bun server on `http://localhost:3000`

Important: the server still runs pending Drizzle migrations automatically before it starts serving HTTP or websocket traffic. This is the same fail-fast behavior used for local dev and Railway startup.

## Database and Migration Commands

- `bun run db:up`: start local Postgres with Docker Compose
- `bun run db:down`: stop local Postgres
- `bun run db:logs`: tail Postgres logs
- `bun run db:generate`: generate a new Drizzle migration from schema changes
- `bun run db:migrate`: apply pending migrations manually

Committed migrations live in [`packages/db/drizzle`](packages/db/drizzle).

## Development Commands

- `bun run dev`: start the web app and server together
- `bun run dev:web`: start only the web app
- `bun run dev:server`: start the Bun server with automatic migrations
- `bun run test`: run the full test suite
- `bun run test:mechanics`: run map and simulation tests
- `bun run test:server`: run netcode, DB, and server tests
- `bun run test:web`: run DOM and app-shell tests
- `bun run test:coverage`: run coverage
- `bun run build`: run workspace builds
- `bun run check`: run tests and then builds

## Gameplay Notes

- `Explore`: roam the map, harvest blocks, build terrain, and test movement
- `PLAY NPC`: fight AI opponents in the same arena ruleset
- `Multiplayer`: join or spectate live rooms, chat in waiting rooms, and carry anonymous progress across visits

The main menu now hides multiplayer automatically when the server is unreachable. When the server is up, the menu shows a single multiplayer entry with the current online player count.

## How Multiplayer Works

- The server runs on Bun with Hono routes and Hono’s Bun websocket helper
- Live room state stays in memory; Postgres is not in the hot tick path
- Matches run from the shared sim package at `60 Hz`
- The server batches authoritative state for room broadcasts and only persists stats at round boundaries
- Anonymous auth creates a stable guest account the first time a player commits a name for multiplayer
- Returning players restore their session from cookies and can jump straight back into the lobby

## Testing

The multiplayer, auth, server, and DB layers all have direct test coverage. Useful entry points:

- [`apps/server/src/app.test.ts`](apps/server/src/app.test.ts)
- [`apps/server/src/bootstrap.test.ts`](apps/server/src/bootstrap.test.ts)
- [`apps/server/src/rooms/manager.test.ts`](apps/server/src/rooms/manager.test.ts)
- [`apps/web/src/app/App.multiplayer.test.tsx`](apps/web/src/app/App.multiplayer.test.tsx)
- [`apps/web/src/multiplayer/client.test.ts`](apps/web/src/multiplayer/client.test.ts)
- [`packages/db/src/migrate.test.ts`](packages/db/src/migrate.test.ts)

## Railway Notes

- Railway should provide the Postgres connection string as `DATABASE_URL`
- The server boot path runs migrations before startup, so there is no separate migration release step
- `PUBLIC_SERVER_URL` and `BETTER_AUTH_URL` should match the deployed server URL
- `WEB_ORIGIN` should match the deployed web client origin
- The root [`Dockerfile`](Dockerfile) is the Railway server image and does not package the web app
- Railway should probe the existing `/health` route externally; the container does not define a Docker `HEALTHCHECK`
