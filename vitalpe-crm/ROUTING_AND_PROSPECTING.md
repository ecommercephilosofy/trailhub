# RUTES I PROSPECCIÓ

Two features added on top of the CRM: a weekly route suggestion, and a queue of
companies found in public registers. Both are built around the same constraint —
**do not invent data** — and both are honest about what they cannot do.

---

## 1. The working list

Carlos maintains an operational workbook by hand. In July 2026 he cut it from
801 companies to 347. `clients.in_working_list` records that decision.

**Nothing was deleted.** 507 CRM companies fall outside the cleaned list and 29
of them have real purchases totalling **2.6 million litres** — Pinord alone is
615.000 L, and several are the same company under a different spelling. A
cleaned prospecting sheet says what is being worked this season; it does not say
who stopped being a customer.

```bash
pnpm llista:sync -- "/ruta/CRM VITALPE GRANEL V2 · OPERATIU.xlsx"            # simulació
pnpm llista:sync -- "<fitxer>" --apply                                       # local
pnpm llista:sync -- "<fitxer>" --remote --apply                              # producció
```

Matching is deterministic or it becomes a question:

| Rule | Effect |
| --- | --- |
| `VIT-GR-nnnn` id | identity across renames |
| normalised name or alias | direct match |
| either half of `RAÓ SOCIAL - MARCA` | resolved 29 of 92 apparent misses |
| anything else | creates the company **and** queues a duplicate candidate |

Result of the first run: 284 matched, 63 created, 35 duplicates queued for
review, 519 moved out of the working list with their history intact.

---

## 2. The weekly route — `/rutes`

### What it claims

*These companies are due, and these ones are near each other.* One comarca per
working day, so a day's driving stays in one area.

### What it does not claim

An optimal itinerary. **Not one company on the working list is geocoded**, so
there is no distance to optimise; a "shortest path" would be fiction. Order
inside a day is by urgency, not geography.

### How a zone is decided

`packages/domain/src/zones.ts` maps municipality → comarca, using real
administrative geography. A municipality that is not in the map becomes **its own
zone**: we know where it is, we do not claim to know what it is near. Places
outside Catalonia group at province level — a trip to Requena is a different kind
of journey.

### Why a company is on the list

`packages/domain/src/routing.ts` scores each company and **shows its reasons**:

| Signal | Weight |
| --- | ---: |
| Overdue task (capped) | 22 each, max 66 |
| Task due this week | 18 |
| Other open tasks (capped) | 6 each, max 18 |
| Active customer | 14 |
| Interested prospect | 11 |
| Priority ALTA | 10 |
| Silence 60 / 120 / 240 days | 10 / 18 / 24 |
| Never contacted | 8 |
| Litres at stake (log scale, capped) | max 15 |

Everything is bounded so no single signal dominates. The weights are exported as
`WEIGHTS` so the ranking can be argued with rather than reverse-engineered.

A zone with fewer than two due companies is deferred, not padded: a two-hour
drive for one cellar is not a route. Companies with a visit already booked are
left to the calendar, and companies with no municipality are listed separately
rather than guessed into a zone.

---

## 3. Prospecting — `/prospeccio`

Companies found in public registers that are not in the CRM.

`public.prospects.source` is `not null`: a prospect nobody can trace back to a
register is indistinguishable from an invented one, so the table refuses to hold
one. Every row also keeps `source_url` and the day it was consulted.

**Nothing is auto-promoted.** A prospect has no history, cannot be assigned, and
becomes a company only when a person presses a button in PROSPECCIÓ. The created
company records the source in its notes and starts with **no classification** —
an unqualified lead is exactly a company nobody has judged yet.

```bash
pnpm prospeccio -- data/prospects/do-penedes-2026-07.json           # simulació
pnpm prospeccio -- data/prospects/do-catalunya-2026-07.json --apply
```

A source file states where it came from:

```json
{
  "source": "DO Penedès — registre públic de cellers",
  "sourceUrl": "https://www.dopenedes.cat/cellers/",
  "consultedOn": "2026-07-25",
  "candidates": [{ "name": "...", "municipality": "...", "rationale": "..." }]
}
```

### What the first two passes found

| Register | Published | Already in the CRM | New |
| --- | ---: | ---: | ---: |
| [DO Penedès](https://www.dopenedes.cat/cellers/) | 134 | **134** | 0 |
| [DO Catalunya](https://docat.cat/es/las-bodegas/) | 126 | 124 | 2 |

**258 of 260.** The portfolio is far more complete than it looked, and that is a
real answer, not a failed run: the useful prospecting ground is elsewhere —
bottlers without vineyards, DO Cava producers outside Catalonia, other regions.

A pass never re-suggests a company already in the CRM under any spelling it can
match, nor one that was discarded before: putting a rejected lead back in front
of somebody every month is how a review queue stops being read.
