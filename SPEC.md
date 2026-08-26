# Barbershop Backend — Architecture Spec

> Living document. Read this before any development work. Domain scope lives in `barbershop-app-summary.md`; this file defines **how** the code is built.

## 1. Stack

| Concern      | Choice                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------- |
| Runtime      | Node.js ≥ 24, TypeScript (strict mode)                                                             |
| HTTP         | Express                                                                                            |
| ORM          | **TypeORM 0.3.x** — decorator entities                                                             |
| Database     | PostgreSQL (`pg` driver)                                                                           |
| Schema       | TypeORM migrations (generated from entity diffs, reviewed, committed). `synchronize: false` always |
| Validation   | Zod (at the HTTP boundary only)                                                                    |
| Auth         | JWT (`jsonwebtoken`) + argon2 password hashing                                                     |
| DI / IoC     | awilix (PROXY mode)                                                                                |
| Logging      | pino + pino-http                                                                                   |
| Tests        | Vitest (unit) + Supertest (HTTP integration)                                                       |
| Infra        | Docker Compose (Postgres)                                                                          |
| Jobs         | None. Nothing in scope runs outside a request — see the build order below                          |

Money is always `numeric`/`DECIMAL` in the DB (TypeORM returns it as string; convert via a decimal transformer or integer cents) — never `number` floats.

TypeORM requires `reflect-metadata` imported first and `experimentalDecorators` + `emitDecoratorMetadata` in `tsconfig.json`.

## 2. Layers

Request flow, top to bottom:

```
HTTP request
  → middleware (logging, parsing, auth, validation)
  → route          (URL → controller method, nothing else)
  → controller     (HTTP ↔ domain translation)
  → service        (business rules — the domain lives here)
  → repository     (persistence — the only layer that touches TypeORM)
  → PostgreSQL
```

**Dependency rule: layers only point downward.** A service never imports a controller; a repository never imports a service. Nothing below the controller knows Express (`req`/`res` never leave the controller).

### 2.1 Routes — `src/routes/<module>.routes.ts`

- Map paths/verbs to controller methods **through the container wrapper** (see §3.1) — routes never import controllers or the container directly:

  ```ts
  router.post(
    '/appointments',
    validate(createAppointmentSchema),
    wrapHandler('appointmentsController.create'),
  );
  ```

- Attach per-route middleware (auth, validation schema). Zero logic; no inline handlers.

### 2.2 Middleware — `src/middleware/`

- **Global (foundation, built first):** request logger (pino-http), JSON body parser, helmet, CORS, global error handler (last in chain).
- **Per-route:** `validate(schema)` — parses `body`/`params`/`query` with Zod, attaches typed result; `authenticate` — verifies JWT, attaches `req.user`; `authorize(...roles)` — role gate.
- Error handler is the **only** place that maps errors → HTTP responses (see §4).

### 2.3 Controllers — `src/controllers/<module>.controller.ts`

- Translate HTTP → domain: extract validated input, call **one** service method, map result → status code + JSON.
- No business rules, no SQL, no try/catch (async errors flow to the error handler via wrapper).
- Response shape: `{ data }` on success, `{ error: { code, message } }` on failure (set by error handler).

### 2.4 Services — `src/services/<module>.service.ts`

- **All business rules live here**: conflict/overbooking checks, appointment state machine, commission calculation, cancel/reschedule policies, cash-register rules.
- Receive/return **domain types (DTOs), not raw DB rows and not HTTP objects**.
- Throw typed domain errors (`ConflictError`, `NotFoundError`, …) — never HTTP codes.
- Orchestrate repositories; may call other services. Multi-write operations use a DB transaction (`dataSource.transaction(cb)` behind a `withTransaction` helper; the `EntityManager` is passed down to repository methods).
- Pure where possible: side effects (the clock, any outbound provider) behind interfaces so they can be mocked.

### 2.5 Repositories — `src/repositories/<module>.repository.ts`

- The **only** layer that imports TypeORM query APIs. Each wraps a TypeORM repository (`dataSource.getRepository(Entity)`) injected via the cradle — services never touch `DataSource` or entities' query methods directly.
- One repository per aggregate (users, barbers, services, appointments, payments, commissions…). Methods speak domain language (`findOverlapping(barberId, start, end)`), not generic CRUD passthroughs.
- Prefer repository/query-builder methods with parameter binding; raw SQL (`query()`) only when necessary, always parameterized.
- No business decisions — a repository can _fetch_ overlapping appointments but never decides what an overlap _means_.
- Entities may be returned as-is when they're plain data; map to DTOs whenever the shape exposed upward differs from the table.

### 2.6 Entities & Migrations

- **Entities** (`src/entities/<module>.entity.ts`, decorator style like medusa-core's `src/models/`): `@Entity`, `@PrimaryColumn`/`@PrimaryGeneratedColumn`, `@Column`, relations. snake_case column names via `name:` or a global `SnakeNamingStrategy`.
- **Migrations** (`src/migrations/`): generated with `typeorm migration:generate` from entity diffs, then reviewed by hand and committed. `synchronize: false` in every environment; `migration:run` applies.
- Constraints that guard invariants live in the DB too (unique keys, FKs, and an exclusion/partial index supporting the appointment-overlap check) — the service check is the rule, the constraint is the safety net.
- Type mapping discipline: `numeric` for money (with a decimal transformer), `timestamptz` in UTC, `boolean`, enums as Postgres enums or `varchar` + TS union types.

## 3. Dependency Injection — awilix (IoC container)

- **awilix** with `InjectionMode.PROXY`. Single composition root: `src/container.ts` registers everything; it is the only file that imports awilix registration APIs.
- Every class takes **one constructor argument — the cradle** — and destructures what it needs by registration name:

  ```ts
  export class AppointmentsService {
    private readonly appointmentsRepository: AppointmentsRepository;
    constructor({ appointmentsRepository }: Cradle) {
      this.appointmentsRepository = appointmentsRepository;
    }
  }
  ```

- A `Cradle` interface in `container.ts` types every registration; `AwilixContainer<Cradle>` gives typed `resolve()`.
- Registration naming: camelCase of the class (`AppointmentsService` → `appointmentsService`). Names are the contract — constructor destructuring must match.
- **Lifetimes:** `asClass(...).singleton()` for stateless services/repositories/controllers; `asValue()` for config, logger, and the TypeORM `DataSource`; `.scoped()` only when per-request state is truly needed (then use a per-request scope middleware).
- **No class ever does `new` on a collaborator, imports the container, or reads `process.env`.** Config is loaded once (`src/config.ts`, Zod-validated env) and registered `asValue`.
- Tests don't need the container: instantiate classes directly with a mock cradle object (`new AppointmentsService({ appointmentsRepository: mockRepo } as Cradle)`).

### 3.1 Route ↔ container wrapper (`src/lib/wrap-handler.ts`)

Mirrors builder-backend's `asyncWrapHandler`. Routes reference controllers by **string name**, resolved lazily per request:

```ts
// scope middleware (registered globally in app.ts, before routes)
app.use((req, _res, next) => {
  req.container = container.createScope();
  next();
});

// wrapHandler — the only place besides container.ts that touches the container
export function wrapHandler(fullName: `${string}.${string}`): RequestHandler {
  return async (req, res, next) => {
    try {
      const [controllerName, methodName] = fullName.split('.');
      const controller = req.container.resolve(controllerName as keyof Cradle);
      const method = Reflect.get(controller as object, methodName);
      if (typeof method !== 'function') {
        throw new Error(`Handler ${fullName} not found`);
      }
      await Reflect.apply(method, controller, [req, res, next]);
    } catch (error) {
      next(error); // async errors → global error handler
    }
  };
}
```

Rules:

- `wrapHandler` is the **only** service-locator allowed in the codebase; classes still receive everything via the cradle.
- Resolution happens **at request time** from the per-request scope, so `.scoped()` registrations (per-request state) work automatically and controllers are lazily built only when their route is hit.
- It doubles as the async wrapper — controllers need no try/catch (§2.3).
- `req.container` is typed via Express declaration merging (`declare global { namespace Express { interface Request { container: AwilixContainer<Cradle> } } }`).

## 4. Error Handling

- `AppError` base class: `code` (stable string), `message`, `httpStatus`. Subclasses: `ValidationError` (400), `UnauthorizedError` (401), `ForbiddenError` (403), `NotFoundError` (404), `ConflictError` (409).
- Services throw domain errors; the global error handler maps them to responses and logs them. Unknown errors → logged with stack, respond `500 { error: { code: "INTERNAL" } }` — never leak internals.
- Zod failures are converted to `ValidationError` with field details.

## 5. Validation

- Zod schemas per endpoint, one file per module in `src/schemas/<module>.schemas.ts`. Types are inferred (`z.infer`) and reused as controller/service input DTOs — one source of truth.
- Validate at the boundary only; services trust their typed inputs.
- Normalize (trim, lowercase email, coerce dates) inside the schema, before validation logic.

## 6. Folder Structure

Layer-based layout: each layer has its own folder; a module (e.g. `appointments`) contributes one file per layer, named `<module>.<layer>.ts`.

```
src/
├── config.ts                  # env loading + Zod validation
├── container.ts               # composition root (all wiring)
├── app.ts                     # express app assembly (middleware + routers)
├── server.ts                  # listen() only
├── middleware/                # errorHandler, authenticate, authorize, validate, logging
├── errors/                    # AppError + subclasses
├── lib/                       # data-source.ts (TypeORM DataSource), wrap-handler.ts, logger, date/money utils
├── migrations/                # TypeORM migrations (generated + reviewed)
├── routes/                    # appointments.routes.ts, …
├── controllers/               # appointments.controller.ts, …
├── services/                  # appointments.service.ts, …
├── repositories/              # appointments.repository.ts, …
├── schemas/                   # appointments.schemas.ts (Zod + DTO types), …
└── entities/                  # appointments.entity.ts, … (extra entity files when a module owns several tables)
```

**Tests live in `tests/`, mirroring the `src/` layout** — `src/services/appointments.service.ts` is covered by `tests/services/appointments.service.test.ts`. Shared harness code (database connection, factories, env setup) lives in `tests/support/`, the one folder with no `src/` counterpart.

```
tests/
├── config.test.ts
├── errors/ lib/ middleware/ repositories/ routes/ services/   # mirror of src/
└── support/                   # db.ts (connect + truncate), factories.ts, setup-env.ts
```

`tsconfig.json` typechecks `src` and `tests` together; `tsconfig.build.json` compiles `src` alone, so no test code reaches `build/`.

Modules (build order): **users/auth → barbers → services-catalog → appointments → clients → payments → cash-register → expenses → commissions → products → reports.** Dependency direction between modules follows that order (commissions may depend on appointments; never the reverse).

Build order 11 was notifications — appointment reminders over WhatsApp, and the only module that needed a worker process, Redis and BullMQ. It was **dropped from scope**, which is why the spec files skip from 10 to 12: reports keeps its number, since a renumbering would only make the existing references to `specs/12-reports.md` wrong. Nothing was ever built for it.

One exception, and only one: `AppointmentsService.complete` calls `CommissionsService.recordForAppointment`, because completing a cut *is* the event that earns a commission and the two must be one transaction (`specs/09-commissions.md`). The alternative — an event bus for a single hook — would hide a transaction behind indirection. There is no cycle: commissions never import appointments, the appointment is passed in as an argument.

Each module has its own spec in [`specs/`](./specs/) (`specs/NN-<module>.md`, numbered by build order) covering entities, endpoints, business rules, errors, and testing focus. The database schema overview and migration workflow live in [`specs/00-database.md`](./specs/00-database.md). Read the module spec before building or changing a module.

## 7. Domain Invariants (enforced in services, backed by DB)

- Appointment state machine: `scheduled → confirmed → completed | cancelled | no_show`. No other transitions; transitions are service methods, not raw status updates.
- No overlapping appointments per barber (considering service duration + blocked time).
- `commission_entries` are **created at the moment an appointment becomes `completed`**, snapshotting the rate — never recomputed from mutable data.
- Commission base (gross vs net-after-card-fees) is explicit per rule.
- Cash register must be open to record cash movements; closing snapshots totals.
- Soft-delete/`active` flags for barbers & services (history must survive).

## 8. Auth & Roles

_Implemented — details in [`specs/01-users-auth.md`](./specs/01-users-auth.md)._

- Roles: `ADMIN`, `MANAGER`, `BARBER`, `CLIENT`. Enforcement = `authenticate` + `authorize(...)` middleware; **resource-level checks** (barber sees only own agenda/commissions, client only own bookings) live in services.
- JWT access token (15 min, `{ sub, role }`) + opaque refresh token (30 days, sha256-hashed at rest, rotated on every use, family-revoked on replay). Secrets via env only.
- Identity is **never** read from a request body. Controllers take the actor from `req.user`; services accept an `AuthenticatedUser` (`src/lib/actor.ts`, deliberately below the HTTP layer).
- The logger redacts `Authorization` headers and password/token fields — pino-http serializes entire requests, so this is not optional.

## 9. Testing Strategy

- **Services:** unit tests with mocked repositories — this is where the value is (state machine, conflicts, commission math).
- **HTTP:** Supertest integration tests per module against a test DB (happy path + main error codes).
- **Repositories:** thin; covered by integration tests, not mocked-out unit tests.
- Every bug fix gets a regression test. Commission and scheduling logic require tests before merge.

## 10. Conventions

- Files: `<module>.<layer>.ts` (kebab-case module names). Classes `PascalCase`, everything else `camelCase`. DB: `snake_case` tables/columns via `SnakeNamingStrategy` (entities stay camelCase).
- REST: plural nouns (`/appointments`, `/barbers/:id/schedule`); verbs only for state transitions (`POST /appointments/:id/confirm`, `/complete`, `/cancel`).
- API versioned under `/v1`. Health check at `/health` (no auth).
- All timestamps UTC in DB; timezone handling at the edge. `createdAt`/`updatedAt` on every table.
- Commits: conventional (`feat:`, `fix:`, `chore:`); one module concern per PR when possible.

## 11. Definition of Done (per endpoint)

1. Zod schema + route + controller + service + repository wired through the container.
2. Domain errors mapped correctly (verify via integration test).
3. Service unit tests for its rules.
4. Auth/role guard applied (once auth exists).
5. Migration generated, reviewed, and committed if entities changed.
