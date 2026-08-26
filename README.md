# barber-backend

Barbershop management API — appointments, barbers, commissions, financials.

- **Architecture:** see [`SPEC.md`](./SPEC.md) (read before any development work)
- **Domain scope:** see [`barbershop-app-summary.md`](./barbershop-app-summary.md)
- **Module specs:** see [`specs/`](./specs/) — one spec per module (numbered by build order) plus [`specs/00-database.md`](./specs/00-database.md) for schema & migrations
- **Build plans:** `plans/` — how each slice was actually built, kept as a local record of the decisions and what was found on the way. Not committed (see `.gitignore`), so specs referencing a plan file are pointing at working notes rather than a shared document

## Stack

Node.js ≥ 24 · TypeScript (strict) · Express · TypeORM 0.3 · PostgreSQL · awilix · Zod · pino · Vitest

## Setup

```bash
nvm use                  # Node 24 (.nvmrc)
npm install
cp .env.example .env
npm run start:db         # Postgres container, waits until it reports healthy
npm run migration:run    # create the schema
npm run seed             # dev data: 15 users across 4 roles, 5 barbers, 8 services, ~20 appointments, commissions paid and pending, a stocked shelf
npm run start:backend    # API on http://localhost:3000/health
```

### Infrastructure

One container per technology — currently just Postgres, since nothing in scope runs outside a request. Staging and production databases live on their own servers and are injected by CI/CD, and are never described here.

Dev and test share the container but never the data. Integration tests truncate every table between cases, so they get `barber_test` to themselves, created alongside `barber` the first time the volume initialises (`docker/postgres/initdb`). `tests/support/setup-env.ts` _overwrites_ `DATABASE_URL` with `TEST_DATABASE_URL` rather than falling back to it, so `npm test` cannot reach your development data even if you have it exported — and any host that isn't obviously disposable is refused outright.

Each command does exactly one thing — containers, schema, and application are started separately, and none reaches into the others:

| Script                  | What it does                                                    |
| ----------------------- | --------------------------------------------------------------- |
| `npm run start:db`      | Starts every infrastructure container and **waits for healthy** |
| `npm run stop:db`       | Stops them, keeping the data                                    |
| `npm run reset:db`      | Destroys the volume, recreates, migrates and re-seeds           |
| `npm run logs:db`       | Tails container logs                                            |
| `npm run migration:run` | Applies pending migrations                                      |
| `npm run start:backend` | Runs the API with watch                                         |

`start:backend` assumes the database is up with its schema applied; it neither starts containers nor migrates. Start the container once with `npm run start:db` and leave it running between sessions — `restart: unless-stopped` brings it back after a reboot — and run `npm run migration:run` when you pull new migrations. Everything here is safe to re-run: containers already up are left alone, and applied migrations are skipped.

`npm start` is the production-shaped run — it compiles to `build/` first, then executes the compiled server, so it can never boot stale JavaScript. A deployed image should invoke `node build/server.js` directly instead, since it has no TypeScript installed.

`.env` must contain a `JWT_SECRET` of at least 32 characters — the server refuses to start without one. Generate one with `openssl rand -base64 48`.

`CANCELLATION_WINDOW_HOURS` (default 24) is how close to the start a client may still cancel or reschedule on their own. Staff are never held to it.

`SHOP_TIMEZONE` (default `America/Sao_Paulo`) is the shop's wall clock. Working hours are stored as local times like `09:00` so "works 9–18" survives a DST change, and this is the zone they are read in; everything else — appointments, blocks, every timestamp in a response — is UTC. It must be a real IANA zone or the server refuses to start.

### Seed data

`npm run seed` fills the database with enough to exercise every path. It is idempotent: reference data (users, barbers, services) is reconciled to match the script on each run, while appointments are only created when missing, so status changes you make while testing survive.

|         | Accounts                                       | Notes                                                      |
| ------- | ---------------------------------------------- | ---------------------------------------------------------- |
| ADMIN   | `admin@barber.local`, `helena@barber.local`    | can create staff and edit any user                         |
| MANAGER | `marcos@barber.local`, `patricia@barber.local` | can list users and book for clients                        |
| BARBER  | `rafael@`, `bruno@`, `carla@`, `diego@`        | `eduardo@` is **deactivated** — history kept               |
| CLIENT  | `cliente@`, `joao@`, `maria@`, `pedro@`        | `lucia@` is **deactivated**; `walkin@` has **no password** |

All of them share the password **`barber123`** — except `walkin@barber.local`, which is a counter-created client that cannot log in, and `lucia@barber.local`, whose login is refused because the account is deactivated. Both exist so you can see the 401 paths without hand-editing rows.

Eight services (one discontinued, for the 409 path) and ~20 appointments spread across the five statuses: completed history, cancellations with a reason, a no-show, a busy today, and free slots over the next three days for testing new bookings and double-booking conflicts.

Four of the six clients have a CRM profile — preferences, two with internal notes, and one birthday landing in the current month so `?birthdayMonth=` always returns somebody. `pedro@` and `walkin@` are left without one, so you can see what an un-edited client reads back as.

Eight payments across all four methods sit on the completed history, one of them a split, so card fee snapshots and a method mix are there to group by. Two register sessions come with them: yesterday's, closed with a withdrawal and a R$ 1,50 shortfall explained in the notes, and today's, still open with a deposit, a withdrawal and one cash payment taken up front — so `GET /cash-register/current` shows something on a fresh clone.

Six expenses cover both kinds and most categories in all three states: rent paid by pix and products by debit, salaries and a utility bill still pending, a maintenance job already past due so `?overdue=true` always returns something, and supplies paid in **cash out of today's open drawer** — the row that exercises the atomic path without you typing anything.

Six commission rules show all four levels of precedence at once: the shop default at 40% gross, Rafael on a better 50% split, `Pigmentação de Barba` paid on the net after card fees, Carla on that same service at 55%, and a retired rule for Diego that resolution must skip — plus a `products` rule at 10% for whoever sells off the shelf. The completed history carries its entries, timestamped when each cut ended rather than when the seed ran — so reports have something to sum, and periods have something to close over. The default means you can complete an appointment on a fresh clone without setting anything up first.

Six products cover every state a shelf can be in: three comfortably stocked, `Shampoo Anticaspa` sitting exactly on its threshold (which counts as low), `Minoxidil` out of stock so an insufficient-stock path is always available, and a discontinued `Balm Pós-Barba` whose leftovers were written off. Stock is never seeded directly — each product's count is the sum of its seeded adjustments minus what was sold, so the trail explains the shelf, and a unit you write off while testing stays gone on the next run.

Three sales sit on top of that shelf: a two-line basket Rafael sold for cash (one payment, one drawer movement, a commission entry per line), a house sale on credit that nobody is credited for, and one already voided — so a zeroed entry, a voided payment and its compensating `out` movement are all there to read without issuing a request.

The payout side arrives half-settled on purpose. Rafael's last fortnight is **closed and paid** in cash, so today's drawer holds a real `payout` movement; Bruno's is **closed and unpaid**, ready for `POST /commission-periods/:id/pay` without closing anything first. Eduardo's, Carla's and Diego's entries are deliberately left unassigned, and Carla has a cash vale still waiting — so `?unassigned=true` and the next close both have something to show. Rafael's own vale is under what he earned, which keeps his statement positive and the payout non-zero.

Everyone works Monday to Saturday — Rafael and Carla 09:00–18:00 with a lunch break, Bruno 09:00–19:00, Diego 08:00–17:00 — so Sunday and lunchtime are genuinely empty, and there are three blocks (a dentist appointment, two vacations) to book against.

### Booking a haircut

Nothing below needs database access — the roster, the catalog and the free times are all public reads:

```bash
curl -s localhost:3000/v1/services | jq '.data[] | {id, name, durationMinutes, priceCents}'
curl -s localhost:3000/v1/barbers  | jq '.data[] | {id, displayName}'

# Free time tomorrow, plus start times that fit that service
curl -s "localhost:3000/v1/barbers/$BARBER_ID/availability?date=2026-07-28&serviceId=$SERVICE_ID" | jq .data

TOKEN=$(curl -s -X POST localhost:3000/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"cliente@barber.local","password":"barber123"}' | jq -r .data.accessToken)

# startsAt: any value from .data.slots above
APPOINTMENT_ID=$(curl -s -X POST localhost:3000/v1/appointments \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"barberId\":\"$BARBER_ID\",\"serviceId\":\"$SERVICE_ID\",\"startsAt\":\"2026-07-28T13:00:00.000Z\"}" | jq -r .data.id)

curl -s localhost:3000/v1/clients/me/appointments -H "authorization: Bearer $TOKEN" | jq
```

The client is taken from the token, so `clientId` is only accepted from ADMIN/MANAGER callers booking on someone's behalf. A time outside the barber's working hours, inside their lunch break, over a block, or already taken is refused with 409 — staff can add `"force": true` to book outside the schedule anyway, but nothing lets two appointments share one chair.

Someone who walks in off the street has no account, so reception sends `"walkIn": {"name": "…", "phone": "…"}` in place of `clientId` — sending both is a 400, and a CLIENT sending it at all is a 403. What comes back is an ordinary appointment against a CLIENT row with no email and no password, which is why that row can never log in. The phone is what identifies a client, not the name: the same number books the client already on file rather than a second copy of them, matched on digits alone so `(11) 98888-7777` and `11988887777` are the same person. Client search reads phones the same way. The client is only written once the slot has survived every check, and rolls back with the booking, so a rejected walk-in leaves nobody behind.

### The rest of the appointment's life

Everything below runs as reception, since confirming and completing belong to the shop:

```bash
STAFF=$(curl -s -X POST localhost:3000/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"marcos@barber.local","password":"barber123"}' | jq -r .data.accessToken)
AUTH="authorization: Bearer $STAFF"
JSON='content-type: application/json'

# Move it — price and duration stay as booked, and the status drops back to scheduled
curl -s -X PATCH localhost:3000/v1/appointments/$APPOINTMENT_ID -H "$AUTH" -H "$JSON" \
  -d '{"startsAt":"2026-07-28T14:00:00.000Z"}' | jq '.data | {startsAt, priceCents, status}'

curl -s -X POST localhost:3000/v1/appointments/$APPOINTMENT_ID/confirm  -H "$AUTH" | jq -r .data.status
curl -s -X POST localhost:3000/v1/appointments/$APPOINTMENT_ID/complete -H "$AUTH" | jq -r .data.status

# The day, and the week — the staff list needs a range and answers with a meta block
curl -s "localhost:3000/v1/barbers/$BARBER_ID/agenda?date=2026-07-28" -H "$AUTH" | jq '.data | length'
curl -s "localhost:3000/v1/appointments?from=2026-07-27&to=2026-08-03&limit=5" -H "$AUTH" | jq .meta
```

| Endpoint                             | Auth                                  | Effect                                                   |
| ------------------------------------ | ------------------------------------- | -------------------------------------------------------- |
| `PATCH /v1/appointments/:id`         | ADMIN, MANAGER, owner client          | reschedule; keeps the snapshots, resets to `scheduled`   |
| `POST /v1/appointments/:id/confirm`  | ADMIN, MANAGER, the barber working it | `scheduled` → `confirmed`                                |
| `POST /v1/appointments/:id/complete` | ADMIN, MANAGER, the barber working it | `confirmed` → `completed`                                |
| `POST /v1/appointments/:id/no-show`  | ADMIN, MANAGER, the barber working it | `confirmed` → `no_show`, only once the start time passed |
| `POST /v1/appointments/:id/cancel`   | ADMIN, MANAGER, owner client          | records who and why; staff must give a `reason`          |
| `GET /v1/appointments?from=&to=`     | ADMIN, MANAGER                        | paginated, range required and capped at 92 days          |
| `GET /v1/barbers/:id/agenda?date=`   | ADMIN, MANAGER, the barber themself   | one shop-local day, every status                         |
| `GET /v1/clients/me/appointments`    | authenticated                         | your own, newest first                                   |

Any step off that path is a 409 — completing something nobody confirmed, cancelling something already cancelled, marking a no-show before the client was even due. Clients may cancel or reschedule their own booking up to `CANCELLATION_WINDOW_HOURS` (default 24) before it starts; inside the window they get a 403 telling them to call the shop, while staff are never restricted.

### Knowing the client

The CRM sits over the client users: what they like, when they last came in, and what the shop needs to remember about them. Same client, three different answers depending on who asks:

```bash
CLIENT_ID=$(curl -s "localhost:3000/v1/clients?search=joao" -H "$AUTH" | jq -r '.data[0].id')

# Reception sees everything, stats included
curl -s localhost:3000/v1/clients/$CLIENT_ID -H "$AUTH" | jq '.data | {preferences, internalNotes, stats}'

curl -s -X PATCH localhost:3000/v1/clients/$CLIENT_ID -H "$AUTH" -H "$JSON" \
  -d '{"preferences":"Máquina 2 na lateral","internalNotes":"Encaixar com folga"}' | jq .data.preferences

# The same client, reading their own profile: no notes about them, no stats
curl -s localhost:3000/v1/clients/me -H "authorization: Bearer $TOKEN" | jq .data
curl -s -X PATCH localhost:3000/v1/clients/me -H "authorization: Bearer $TOKEN" -H "$JSON" \
  -d '{"birthday":"1988-03-14"}' | jq .data

curl -s "localhost:3000/v1/clients/$CLIENT_ID/history?limit=5" -H "$AUTH" | jq '.meta, (.data[] | {startsAt, status})'
```

| Endpoint                                   | Auth                                          | Effect                                                          |
| ------------------------------------------ | --------------------------------------------- | --------------------------------------------------------------- |
| `GET /v1/clients?search=&limit=&offset=`   | ADMIN, MANAGER                                | name, email or phone; paginated with a `meta` block             |
| `GET /v1/clients?birthdayMonth=8`          | ADMIN, MANAGER                                | birthdays in a month, whatever the year                         |
| `GET /v1/clients?inactiveSince=2026-05-01` | ADMIN, MANAGER                                | nobody with a completed cut since that date — no default window |
| `GET /v1/clients/:id`                      | ADMIN, MANAGER; BARBER; the client themselves | one of three shapes, chosen by role                             |
| `PATCH /v1/clients/:id`                    | ADMIN, MANAGER                                | birthday, preferences, internal notes                           |
| `GET /v1/clients/:id/history`              | ADMIN, MANAGER, BARBER, the client themselves | that client's appointments, newest first                        |
| `GET`/`PATCH /v1/clients/me`               | authenticated client                          | own birthday and preferences                                    |

`internalNotes` is staff-only and is simply absent from the other two shapes — a barber sees preferences and stats but no email or phone, and a client sees neither the notes nor the stats. `PATCH /v1/clients/me` cannot write notes even if you send them: the field is dropped before the request reaches the service. Nobody has a profile row until someone edits one, so a client who has never been edited reads back as an empty profile rather than a 404 (`pedro@` and `walkin@` are seeded that way on purpose). Stats — visits, last visit, average ticket, no-shows — are computed from completed appointments on every read, never stored.

### Taking the money

Cash is the only method that touches the register, and it does so atomically: the payment and the cash movement are one write. The seed leaves a drawer open, so start by looking at it:

```bash
curl -s localhost:3000/v1/cash-register/current -H "$AUTH" | jq '.data.totals'

# Pay a completed cut in cash — the movement appears in the same request
PAID=$(curl -s -X POST localhost:3000/v1/appointments/$APPOINTMENT_ID/payments -H "$AUTH" -H "$JSON" \
  -d '{"payments":[{"amountCents":2000,"method":"cash"},{"amountCents":2500,"method":"credit"}]}')
echo "$PAID" | jq '.data[] | {method, amountCents, cardFeeCents, netAmountCents}'

# The drawer went up by the cash half only
curl -s localhost:3000/v1/cash-register/current -H "$AUTH" | jq '.data.totals'

# Undo the cash one as ADMIN: the row survives and a compensating movement goes out
ADMIN=$(curl -s -X POST localhost:3000/v1/auth/login -H "$JSON" \
  -d '{"email":"admin@barber.local","password":"barber123"}' | jq -r .data.accessToken)
CASH_ID=$(echo "$PAID" | jq -r '.data[] | select(.method=="cash") | .id')
curl -s -X DELETE localhost:3000/v1/payments/$CASH_ID -H "authorization: Bearer $ADMIN" -H "$JSON" \
  -d '{"reason":"cobrado do cliente errado"}' | jq '.data | {voidedAt, voidReason}'

# Money out of the till, then close against a physical count
curl -s -X POST localhost:3000/v1/cash-register/movements -H "$AUTH" -H "$JSON" \
  -d '{"type":"out","source":"withdrawal","amountCents":5000,"description":"Sangria para o cofre"}' | jq .data.amountCents

EXPECTED=$(curl -s localhost:3000/v1/cash-register/current -H "$AUTH" | jq '.data.totals.expectedBalanceCents')
curl -s -X POST localhost:3000/v1/cash-register/close -H "$AUTH" -H "$JSON" \
  -d "{\"countedBalanceCents\":$((EXPECTED - 150)),\"notes\":\"Faltaram R\$ 1,50\"}" \
  | jq '.data | {expectedBalanceCents, countedBalanceCents, differenceCents}'
```

| Endpoint                                | Auth                            | Effect                                                         |
| --------------------------------------- | ------------------------------- | -------------------------------------------------------------- |
| `POST /v1/appointments/:id/payments`    | ADMIN, MANAGER                  | one or more payments as a batch; overpay rolls all of it back  |
| `GET /v1/appointments/:id/payments`     | staff, the barber who worked it | including voided ones — they are part of the story             |
| `GET /v1/payments?method=&from=&to=`    | ADMIN, MANAGER                  | paginated with a `meta` block                                  |
| `DELETE /v1/payments/:id`               | ADMIN                           | same-day soft void; cash writes a compensating `out` movement  |
| `POST /v1/cash-register/open` / `close` | ADMIN, MANAGER                  | one open drawer at a time; closing snapshots the difference    |
| `GET /v1/cash-register/current`         | ADMIN, MANAGER                  | the open session and its live totals; 409 when nothing is open |
| `POST /v1/cash-register/movements`      | ADMIN, MANAGER                  | withdrawal, deposit or adjustment — never `payment`            |
| `GET /v1/cash-register/sessions[/:id]`  | ADMIN, MANAGER                  | history, and one session with its movements                    |

Card fees are snapshotted per payment from `CARD_FEE_RATE_DEBIT` and `CARD_FEE_RATE_CREDIT`, so changing a rate never rewrites what was already taken. Payments only go against `confirmed` or `completed` appointments, may not add up to more than the price, and can be backdated inside the current shop day but never into another one or into the future. Cash with no open register is a 409 and leaves nothing behind — no payment, no movement. Voiding is soft: the row stays readable with who and why, every sum stops counting it, and the amount is free to be paid again. Movements are append-only, and a closed session accepts none — corrections are an `adjustment` in the other direction.

### What the shop spends

The other side of the drawer. An expense with no `paymentMethod` is an account payable; paying it in cash takes the money out of the open register in the same write:

```bash
# A cost that is not paid yet
EXPENSE_ID=$(curl -s -X POST localhost:3000/v1/expenses -H "$AUTH" -H "$JSON" \
  -d '{"description":"Conta de água","category":"utilities","kind":"fixed","amountCents":8900,"dueDate":"2026-08-10"}' \
  | jq -r .data.id)

curl -s localhost:3000/v1/cash-register/current -H "$AUTH" | jq '.data.totals.expectedBalanceCents'

# Pay it from the till — the out movement is part of this request
curl -s -X POST localhost:3000/v1/expenses/$EXPENSE_ID/pay -H "$AUTH" -H "$JSON" \
  -d '{"paymentMethod":"cash"}' | jq '.data | {paidAt, paymentMethod}'

# The drawer dropped by exactly that, and the movement says what for
curl -s localhost:3000/v1/cash-register/current -H "$AUTH" | jq '.data.totals'
SESSION_ID=$(curl -s localhost:3000/v1/cash-register/current -H "$AUTH" | jq -r '.data.session.id')
curl -s localhost:3000/v1/cash-register/sessions/$SESSION_ID -H "$AUTH" \
  | jq '.data.movements[] | select(.source=="expense") | {amountCents, description, expenseId}'

# What is late, and what is still to come
curl -s "localhost:3000/v1/expenses?overdue=true" -H "$AUTH" | jq '.data[] | {description, dueDate}'
curl -s "localhost:3000/v1/expenses?paid=false&kind=fixed" -H "$AUTH" | jq .meta
```

| Endpoint                                          | Auth           | Effect                                                      |
| ------------------------------------------------- | -------------- | ----------------------------------------------------------- |
| `POST /v1/expenses`                               | ADMIN, MANAGER | pending, or already paid when you send a `paymentMethod`    |
| `GET /v1/expenses?category=&kind=&paid=&overdue=` | ADMIN, MANAGER | paginated; `from`/`to` bound `paidAt`                       |
| `GET /v1/expenses/:id`                            | ADMIN, MANAGER | detail, with `overdue` computed on the read                 |
| `PATCH /v1/expenses/:id`                          | ADMIN, MANAGER | anything while pending; description and category after paid |
| `POST /v1/expenses/:id/pay`                       | ADMIN, MANAGER | settles it once; cash needs an open register                |
| `DELETE /v1/expenses/:id`                         | ADMIN          | pending only — a paid expense is financial history          |

An expense is paid exactly once; a second attempt is a 409, and so is editing the amount, kind, due date or recurrence afterwards — the response names the fields it refused, and corrections belong in an `adjustment` movement. Cash cannot be backdated out of the current shop day, because the drawer it comes from only exists today; a pix or transfer recorded three days late is fine, since that is just bookkeeping catching up. Nothing may be recorded in the future. A cash expense with the register closed is a 409 that leaves neither the expense nor the movement behind. `overdue` is `dueDate` in the past with nothing paid, computed in `SHOP_TIMEZONE` on every read and never stored. `recurring` is a badge and nothing more until the jobs infrastructure exists — it creates nothing on its own.

### What the barbers earn

A rule says what a barber keeps and of what; completing an appointment snapshots an entry from it, in the same transaction. The rate is a fraction — `0.4` is 40%:

```bash
# The shop default: every barber, every service, 40% of the price
curl -s -X POST localhost:3000/v1/commission-rules -H "$AUTH" -H "$JSON" \
  -d '{"rate":0.4,"base":"gross"}' | jq '.data | {barberId, serviceId, rate, base}'

# An override for one barber, which beats the default for them
curl -s -X POST localhost:3000/v1/commission-rules -H "$AUTH" -H "$JSON" \
  -d "{\"barberId\":\"$BARBER_ID\",\"rate\":0.5,\"base\":\"gross\"}" | jq '.data.rate'

# Complete a confirmed cut — the entry is written as part of it
curl -s -X POST localhost:3000/v1/appointments/$APPOINTMENT_ID/complete -H "$AUTH" | jq '.data.status'

# What it earned, snapshotted: rate, base, and what the rate was applied to
curl -s "localhost:3000/v1/commissions/entries?barberId=$BARBER_ID" -H "$AUTH" \
  | jq '.data[0] | {rate, base, baseAmountCents, amountCents}'

# Raising the rate now changes nothing about what is already earned
curl -s -X PATCH localhost:3000/v1/commission-rules/$RULE_ID -H "$AUTH" -H "$JSON" \
  -d '{"rate":0.6}' | jq '.data.rate'
```

| Endpoint                                              | Auth                        | Effect                                                     |
| ----------------------------------------------------- | --------------------------- | ---------------------------------------------------------- |
| `POST /v1/commission-rules`                           | ADMIN                       | one active rule per scope; a duplicate is a 409            |
| `GET /v1/commission-rules?appliesTo=&active=`         | ADMIN, MANAGER, BARBER      | most specific first; a barber sees only what applies to them |
| `PATCH /v1/commission-rules/:id`                      | ADMIN                       | `rate`, `base`, `active` — the scope is immutable          |
| `GET /v1/commissions/entries?barberId=&periodId=&from=&to=` | ADMIN, MANAGER; BARBER own | paginated with a `meta` block                        |

Precedence runs `(barber, service)` → `(barber, *)` → `(*, service)` → `(*, *)`, resolved in one query so two rules of equal specificity cannot exist — an active rule per scope is enforced by the database, wildcards included. **A cut whose barber has no applicable rule cannot be completed**: it is a 409 and the appointment stays `confirmed`, deliberately, so nobody silently works for free. The seed ships a shop default, which makes this a one-time setup step.

An entry is a snapshot and is never recomputed from a live rule — a rate raised in June cannot rewrite what May paid. The one exception is a `base: "net"` entry, which is what actually landed after card fees: a payment recorded (or voided) after completion moves it inside that payment's own transaction, and a `net` entry with nothing paid yet falls back to the appointment price rather than earning zero on work that was done. `gross` entries never move. Barbers read only their own entries; asking for another's is a 403.

### Paying the barbers

Entries pile up as cuts are completed; a vale is money handed over early; closing a period settles the two against each other and freezes them:

```bash
# A vale, in cash — out of the open drawer, in one transaction
curl -s -X POST localhost:3000/v1/commission-advances -H "$AUTH" -H "$JSON" \
  -d "{\"barberId\":\"$BARBER_ID\",\"amountCents\":15000,\"paymentMethod\":\"cash\",\"notes\":\"vale de sexta\"}" \
  | jq '.data | {amountCents, periodId}'

# Close last fortnight for everyone who has something owing (omit barberId for the whole shop)
curl -s -X POST localhost:3000/v1/commission-periods/close -H "$AUTH" -H "$JSON" \
  -d '{"startsOn":"2026-07-16","endsOn":"2026-07-31"}' \
  | jq '.data[] | {barberId, totalEntriesCents, totalAdvancesCents, totalDueCents}'

# The statement: the snapshot, plus the rows it was taken from
curl -s localhost:3000/v1/commission-periods/$PERIOD_ID -H "$AUTH" \
  | jq '{due: .data.period.totalDueCents, entries: (.data.entries | length), advances: (.data.advances | length)}'

# Pay it. Cash leaves the drawer as a `payout` movement; pix does not touch it
curl -s -X POST localhost:3000/v1/commission-periods/$PERIOD_ID/pay -H "$AUTH" -H "$JSON" \
  -d '{"paymentMethod":"cash"}' | jq '.data | {status, paidAt, paymentMethod}'
```

| Endpoint                                                       | Auth                       | Effect                                                       |
| -------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------ |
| `POST /v1/commission-advances`                                 | ADMIN, MANAGER             | a vale; cash needs an open register                          |
| `GET /v1/commission-advances?barberId=&unassigned=&from=&to=`   | ADMIN, MANAGER; BARBER own | `unassigned=true` is what the next close will sweep          |
| `POST /v1/commission-periods/close`                            | ADMIN                      | `{barberId?, startsOn, endsOn}` — all barbers when omitted   |
| `GET /v1/commission-periods?barberId=&status=&from=&to=`        | ADMIN, MANAGER; BARBER own | paginated; a barber sees only their own                      |
| `GET /v1/commission-periods/:id`                               | ADMIN, MANAGER; BARBER own | statement; another barber's is a 403                         |
| `POST /v1/commission-periods/:id/pay`                          | ADMIN                      | marks paid once; a second attempt is a 409                   |

A period only exists once it is closed — there is no "open period" to keep in sync, just the entries and advances nobody has settled yet. Closing sweeps every unassigned entry and advance in the range, snapshots `totalEntries`, `totalAdvances` and `totalDue`, and stamps the period onto the rows it counted, which is what freezes them. **Closing the whole shop is one transaction**: if any barber already has an overlapping period the request is a 409 naming them and nothing is closed, because a half-finished payroll run is worse than none. Overlap is also a database constraint, so two admins closing at once cannot both win. A barber with nothing owing simply gets no row.

**A range can only be closed once its days are over.** Closing a fortnight that is still running would orphan everything earned in the rest of it — those days are inside a taken range, and a second close for them is refused forever.

Advances are never checked against the balance: a shop advancing more than a barber earned gets a negative `totalDueCents`, which is information rather than an error, and nothing carries it into the next period. Paying a period whose `totalDueCents` is zero or less moves no cash but still marks it paid.

Once a period has closed over an entry, the money behind it is settled history. **Voiding the payment is refused** (409, gross or net — reversing money the shop has already paid out on is a decision for a human), and a **late payment is refused only if it would actually move the entry**, so a `gross` commission or a sum that lands on the same base is still accepted.

### The shelf

```bash
# A new product, stocked as it is created
curl -s -X POST localhost:3000/v1/products -H "$AUTH" -H "$JSON" \
  -d '{"name":"Pomada Modeladora","priceCents":3500,"costCents":1800,"stockQuantity":24,"lowStockThreshold":4}' \
  | jq '.data | {name, stockQuantity, lowStock}'

# What needs restocking — computed per row against its own threshold
curl -s "localhost:3000/v1/products?lowStock=true" -H "$AUTH" \
  | jq '.data[] | {name, stockQuantity, lowStockThreshold}'

# Stock only ever moves with a reason attached
curl -s -X POST localhost:3000/v1/products/$PRODUCT_ID/stock-adjustments -H "$AUTH" -H "$JSON" \
  -d '{"delta":-1,"reason":"loss","notes":"pote quebrou na bancada"}' \
  | jq '.data | {delta, reason, resultingQuantity}'

# And the trail says what the shelf held at each step
curl -s localhost:3000/v1/products/$PRODUCT_ID/stock-adjustments -H "$AUTH" \
  | jq '.data[] | {delta, reason, resultingQuantity, notes}'
```

| Endpoint                                                    | Auth                   | Effect                                              |
| ----------------------------------------------------------- | ---------------------- | --------------------------------------------------- |
| `POST /v1/products`                                         | ADMIN                  | an opening `stockQuantity` writes its own adjustment |
| `GET /v1/products?lowStock=&includeInactive=&search=`        | ADMIN, MANAGER, BARBER | paginated; retired products hidden by default        |
| `GET /v1/products/:id`                                      | ADMIN, MANAGER, BARBER |                                                     |
| `PATCH /v1/products/:id`                                    | ADMIN                  | name, description, price, cost, threshold — not stock |
| `POST /v1/products/:id/stock-adjustments`                   | ADMIN, MANAGER         | `{delta, reason, notes?}`; reasons `purchase`/`loss`/`correction` |
| `GET /v1/products/:id/stock-adjustments`                    | ADMIN, MANAGER         | newest first                                        |
| `DELETE /v1/products/:id`                                   | ADMIN                  | soft delete, returning the retired row               |

**Stock never moves without a reason.** `PATCH` refuses a `stockQuantity` outright; the only ways in are an adjustment and a sale. Each adjustment snapshots `resultingQuantity`, because sales move stock without writing an adjustment — so summing deltas cannot reconstruct a count, and a `correction` row would otherwise be unreadable a month later. The move itself is arithmetic in the database (`stock_quantity + :delta >= 0`), so two tills cannot both sell the last unit, and a write-off larger than the shelf is a 400 that names what is actually there.

Unlike services, the catalog is staff-only — a client has no reason to read stock counts. A discontinued product still accepts adjustments, which is how leftovers get written off.

### Selling off the shelf

```bash
# One trip to the counter: several products, one payment
curl -s -X POST localhost:3000/v1/product-sales -H "$AUTH" -H "$JSON" -d '{
  "items": [
    {"productId":"'$POMADE_ID'","quantity":2},
    {"productId":"'$OIL_ID'","quantity":1}
  ],
  "method": "cash",
  "soldByBarberId": "'$BARBER_ID'"
}' | jq '.data | {totalCents, cardFeeCents, netTotalCents, commissionEntryIds, lines: (.lines | length)}'

# Same-day undo — restocks, voids the payment, zeroes what it earned
curl -s -X POST localhost:3000/v1/product-sales/$SALE_LINE_ID/void -H "$AUTH" -H "$JSON" \
  -d '{"reason":"cliente desistiu"}' | jq '.data[] | {productId, quantity, voidedAt}'
```

| Endpoint                                                       | Auth           | Effect                                                         |
| -------------------------------------------------------------- | -------------- | -------------------------------------------------------------- |
| `POST /v1/product-sales`                                       | ADMIN, MANAGER | one basket, one payment; `soldByBarberId` earns the commission |
| `GET /v1/product-sales?from=&to=&barberId=&productId=&voided=` | ADMIN, MANAGER | paginated lines, newest first                                  |
| `GET /v1/product-sales/:id`                                    | ADMIN, MANAGER | every line of that line's basket                               |
| `POST /v1/product-sales/:id/void`                              | ADMIN          | same-day only                                                  |

**A sale is one transaction**: stock comes off the shelf, the payment is written (cash needs an open register and makes a movement, cards snapshot their fee), the lines are stored with the price they sold at, and the seller's commission is calculated. Anything that refuses — an empty shelf, a closed register — leaves nothing behind. Stock is checked first, so a customer who cannot be served never causes a payment to be written and rolled back.

**The basket is the unit.** The lines share a payment, so `POST /:id/void` takes any line and undoes the whole sale — a payment cannot be partly voided. The void compensates rather than erases: stock goes back, the payment is voided (taking the cash out of whichever drawer is open now), and the commission entries keep their barber, rule and rate while earning zero. Once a commission period has closed over one of those entries, the void is refused with a 409.

**A missing commission rule does not block a sale.** Completing an appointment does — the work is already done — but money at the till should not wait on payroll setup, so a sale with no matching `applies_to: products` rule simply earns nobody anything and still records who sold it. Rules resolve with no service to narrow by, so only `(barber, *)` and `(*, *)` can win, and a `net` rule shares the card fee across the basket in proportion to each line.

### Reading the books

Every endpoint takes `?from=&to=` as inclusive shop-local dates and defaults to the current month. Most are ADMIN or MANAGER; a barber may read only their own summary:

```bash
# Where the month's money came from
curl -s "localhost:3000/v1/reports/revenue?groupBy=barber" -H "$AUTH" \
  | jq '.data | {from, to, totals, buckets}'

# Did the shop make money?
curl -s "localhost:3000/v1/reports/dre?from=2026-08-01&to=2026-08-31" -H "$AUTH" \
  | jq '.data | {revenue, expenses: .expenses.totalCents, commissionsCents, resultCents}'

# How full were the chairs?
curl -s "localhost:3000/v1/reports/occupancy" -H "$AUTH" \
  | jq '.data | {overall, barbers: [.barbers[] | {barberName, occupancyRate}]}'
```

| Endpoint                               | Auth                    | Effect                                                                       |
| -------------------------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `GET /v1/reports/revenue?groupBy=`     | ADMIN, MANAGER          | totals plus buckets; `day`, `week`, `month`, `barber`, `service` or `method` |
| `GET /v1/reports/average-ticket`       | ADMIN, MANAGER          | service takings ÷ cuts, overall and per barber                               |
| `GET /v1/reports/top-services?limit=`  | ADMIN, MANAGER          | ranked by takings, then by cuts                                              |
| `GET /v1/reports/products`             | ADMIN, MANAGER          | units, takings and margin per product, plus what needs restocking            |
| `GET /v1/reports/dre`                  | ADMIN, MANAGER          | revenue − card fees − paid expenses − commissions = result                   |
| `GET /v1/reports/occupancy`            | ADMIN, MANAGER          | booked minutes ÷ scheduled working minutes, per barber                       |
| `GET /v1/reports/no-shows`             | ADMIN, MANAGER          | no-show + cancellation counts and rates                                      |
| `GET /v1/reports/clients`              | ADMIN, MANAGER          | new vs recurring in the period, plus inactive count                          |
| `GET /v1/reports/barbers/:id/summary`  | ADMIN, MANAGER, BARBER  | one barber's dashboard; a BARBER may only read their own                     |

**Money is counted when it was paid.** A cut done Monday and paid Tuesday is Tuesday's revenue, on every report — which is what lets the revenue report and the DRE reconcile over the same month. Days are cut in `SHOP_TIMEZONE`, so a 21:00 payment belongs to that evening rather than to tomorrow UTC, and there is deliberately no `?tz=` to override it: a report bucketed in one zone and a commission period closed in another would give two answers to the same question.

**Revenue that cannot be attributed is reported, not hidden.** Grouping by barber gives house sales a `null` key; grouping by service does the same for product payments. The buckets always sum to the total. A basket is collapsed to one row before it is joined, so a three-line sale counts its payment once.

**The DRE is simplified and says so**: paid expenses only, payments by `paid_at`. Commissions are its one accrual line — counted when earned, so they sit with the revenue that produced them rather than with the payroll run that settled them. Product margin uses each product's cost *today*, since a sale snapshots its price but not its cost; where no cost was ever recorded the margin reads `null` and `productsWithoutCost` says how many were skipped.

**Occupancy uses the same schedule math as booking.** The denominator is `workingIntervals` — weekday window minus break minus blocks — so a day cannot be fully booked on one endpoint and half free on another. Booked minutes exclude cancellations (they freed the slot) and use each appointment's snapshotted duration.

### Auth flow

| Endpoint                 | Notes                                                       |
| ------------------------ | ----------------------------------------------------------- |
| `POST /v1/auth/register` | self-registration, always CLIENT                            |
| `POST /v1/auth/login`    | returns a 15-minute access token and a 30-day refresh token |
| `POST /v1/auth/refresh`  | rotates the refresh token; the old one dies immediately     |
| `POST /v1/auth/logout`   | revokes the presented refresh token                         |

Refresh tokens are opaque, stored only as a sha256 hash, and grouped into families. Presenting an already-rotated token is treated as theft: the entire family is revoked, forcing a fresh login.

### Barbers, catalog and agenda

| Endpoint                                                  | Auth                              |
| --------------------------------------------------------- | --------------------------------- |
| `GET /v1/barbers`, `GET /v1/barbers/:id`                  | public                            |
| `GET /v1/barbers/:id/availability?date=&serviceId=`       | public                            |
| `POST /v1/barbers`, `DELETE /v1/barbers/:id`              | ADMIN                             |
| `PATCH /v1/barbers/:id`                                   | ADMIN, or the barber themself     |
| `GET`/`PUT /v1/barbers/:id/schedule`                      | ADMIN, MANAGER, or the barber     |
| `POST /v1/barbers/:id/blocks`, `DELETE …/blocks/:blockId` | ADMIN, MANAGER, or the barber     |
| `GET /v1/services`, `GET /v1/services/:id`                | public (`?includeInactive` staff) |
| `POST`/`PATCH`/`DELETE /v1/services…`                     | ADMIN                             |

`PUT /schedule` replaces the entire week in one transaction — send every working day, omit the days off. Deleting a barber or a service is a soft delete; deactivating a barber who still has future appointments is refused with 409 listing them, rather than quietly cancelling someone's haircut.

## Scripts

| Script                                              | What it does                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run start:db` / `stop:db` / `reset:db`         | Infrastructure containers (see above)                                                      |
| `npm run start:backend`                             | The API with watch (`tsx watch src/server.ts`), nothing else                               |
| `npm run build`                                     | Compile to `build/`                                                                        |
| `npm start`                                         | Compile, then run the compiled server                                                      |
| `npm test`                                          | Run all tests once (Vitest); integration tests need `start:db`                             |
| `npm run test:watch`                                | Tests in watch mode                                                                        |
| `npm run seed`                                      | Insert development data (idempotent, refuses production); `LOG_LEVEL=trace` to see the SQL |
| `npm run lint`                                      | ESLint                                                                                     |
| `npm run typecheck`                                 | `tsc --noEmit` over `src` + `tests`                                                        |
| `npm run migration:generate -- src/migrations/Name` | Generate migration from entity diff                                                        |
| `npm run migration:run`                             | Apply pending migrations                                                                   |
| `npm run migration:revert`                          | Revert last migration                                                                      |

## Project layout

```
src/
├── config.ts         # env loading + Zod validation (only file reading process.env)
├── container.ts      # awilix composition root (only file registering dependencies)
├── app.ts            # express app assembly
├── server.ts         # bootstrap + graceful shutdown
├── middleware/       # errorHandler, validate, scope, authenticate, authorize
├── errors/           # AppError + subclasses
├── lib/              # data-source, logger, wrap-handler, password, tokens, money, clock
├── migrations/       # TypeORM migrations
├── routes/           # <module>.routes.ts — URL → controller mapping
├── controllers/      # <module>.controller.ts — HTTP ↔ domain translation
├── services/         # <module>.service.ts — business rules
├── repositories/     # <module>.repository.ts — persistence (only layer touching TypeORM)
├── schemas/          # <module>.schemas.ts — Zod schemas + DTO types
└── entities/         # <module>.entity.ts — TypeORM entities

tests/                # mirrors src/ — src/services/x.service.ts → tests/services/x.service.test.ts
├── lib/ errors/ middleware/ repositories/ routes/ services/
└── support/          # db.ts (connect, migrate, truncate), factories.ts, setup-env.ts
```

`npm run typecheck` covers `src` and `tests`; `npm run build` uses `tsconfig.build.json` and compiles `src` only.
