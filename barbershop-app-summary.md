# Barbershop Management App — Project Summary

## Stack

Node/Express + TypeScript, Prisma, PostgreSQL, Docker.

## Feature Scope

The app manages multiple barbers, appointments, financials, and commissions.

### Core Modules

- **Appointment scheduling** — per-barber agendas, online booking, conflict/overbooking prevention, no-show handling, blocked time (lunch, days off, vacation), configurable service duration, manual overbooking by reception, reschedule/cancel rules, waitlist.
- **Barber management** — profiles (photo, specialties), individual work schedules, configurable commission rates per barber and per service, active/inactive status, scoped access permissions.
- **Services & products** — catalog with price, duration, commission; combos; product sales with basic inventory and low-stock alerts.
- **Client CRM** — service history, preferences/notes, inactive-client campaigns, loyalty program, birthday tracking.
- **Financials** — payments by method (cash, Pix, debit/credit), fixed & variable expenses, daily cash flow with open/close, accounts payable/receivable, card fees deducted from net, simplified DRE.
- **Commissions** — auto-calculated on completed appointments, gross-vs-net rules (net = after card fees; must be explicit to avoid disputes), per-service and per-barber rates, product-sale commissions, advances/vales, period closing (weekly/biweekly/monthly), self-service statements for barbers, plus support for the chair-rental model as an alternative to commission.
- **Reporting/dashboards** — revenue by period/barber/service, agenda occupancy, average ticket, no-show & cancellation rate, top services, new vs recurring clients.

### Access Roles

- **Admin** — everything
- **Manager/reception** — full agenda + cash register
- **Barber** — own agenda + own commissions
- **Client** — booking + history

### Key Data Model Notes

- Generate `commission_entries` **at the moment an appointment becomes `completed`** — never calculate commissions on-the-fly over mutable data, or history breaks when rates change.
- Appointment state machine: `scheduled → confirmed → completed / cancelled / no_show`.
- Core tables: `users` (with roles), `barbers`, `services`, `appointments`, `payments`, `commission_rules`, `commission_entries`.

## Architecture / Sequencing Decision

**Question raised:** should auth/roles/middleware be built first?
**Conclusion:** No — building auth in isolation up front is a trap (permissions modeled in a vacuum, no end-to-end feedback loop, tendency to over-engineer RBAC).

### Recommended build order

1. **Base setup** — Express/TS, Prisma connected, Docker, first migration, health check, global error handler, logger.
2. **Core domain without auth** — model `users`, `barbers`, `services`, `appointments`; build a **walking skeleton** (a vertical slice through all layers using "create appointment" as the central use case: route → controller → service → repository/Prisma → Postgres → response).
3. **Auth** — register, login, password hashing (argon2/bcrypt), JWT issuance.
4. **Authorization** — roles + middleware, derived from the now-mapped endpoints.
5. **Remaining modules** — financials, commissions, etc., protected from birth.

### Middleware guidance

- Build early (every route benefits): global error handler, request logger, body parser / CORS / helmet, Zod input validation.
- Add at steps 3–4: `authenticate` and `authorize(role)`.
- **Caveat:** nothing with real client data should be _deployed_ without auth, even though local dev can proceed on the skeleton first.

## Open Next Steps (not yet delivered)

- Folder structure + skeleton of the error handler and auth/role middleware in TypeScript.
- Optionally: the DB schema (Prisma/Postgres) or an architecture diagram.
