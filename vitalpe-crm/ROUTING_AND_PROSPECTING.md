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

### Urgency picks who, distance picks the order

Urgency decides **who** to see. Once every stop in a day is geocoded, proximity
decides **in what order**, and the day shows its kilometres.

The ordering is nearest-neighbour anchored on the most urgent company: not
optimal — the travelling salesman is not solved here — but on five stops inside
one comarca it lands within minutes of optimal and it is explainable, which
matters more for something a person overrules daily.

A day with even one ungeocoded stop is **not** reordered and reports no
distance. A half-sorted day would imply a geography that is not known, and a
partial total would read as if it were the whole trip.

### Geocoding

```bash
pnpm geocodifica                        # simulació: diu quantes i quant costaria
pnpm geocodifica -- --remote --apply    # producció
pnpm geocodifica -- --remote --apply --limit=50
```

Needs `GOOGLE_MAPS_API_KEY` in `.env.local`. Without it the script **refuses to
run** rather than degrading: an unconfigured geocoder that invented coordinates
would be worse than none.

| Rule | Why |
| --- | --- |
| `APPROXIMATE` results (≈500 m) are rejected | A village centroid is not an address. It would put a geofence 400 m from the cellar and make every arrival alert wrong. The row stays `PENDENT DE GEOLOCALITZAR` with the reason recorded. |
| `verified_by_user = true` is never overwritten | Somebody moved that pin by hand. |
| `geocode_source`, `geocoded_at`, `accuracy_meters` always written | Where each coordinate came from, and how good it is. |
| Only rows without coordinates are sent | Re-running costs nothing. |

461 addresses are pending, all with street + postal code + municipality —
about **2,30 USD** at Google's 5 USD/1000, inside the 200 USD monthly free
credit.

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
