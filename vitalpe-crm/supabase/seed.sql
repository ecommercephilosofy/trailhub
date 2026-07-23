-- ============================================================================
-- VITALPE CRM — SEED (master data, not demo data)
--
-- Everything here is real reference data the product needs to run: the
-- workspace, the normalised product catalogue from the commercial brief, and
-- the campaigns present in the source spreadsheets.
--
-- DEMO rows live in scripts/maintenance/seed-demo.ts and are always flagged
-- is_demo = true so they can be wiped before a production import.
-- ============================================================================

insert into public.workspaces (id, name, slug, timezone, locale)
values ('00000000-0000-4000-8000-000000000001', 'VITALPE', 'vitalpe', 'Europe/Madrid', 'ca-ES')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- PRODUCTES NORMALITZATS
-- Campaign is never part of the name. Organic and conventional are always
-- separate products. Bag in Box, BRISA and MARES are deliberately absent.
-- ---------------------------------------------------------------------------
insert into public.products (name, category, is_organic, sort_order) values
  -- BASE CAVA
  ('VI BLANC CUPATGE BASE CAVA GUARDA',                          'BASE CAVA', false, 10),
  ('VI BLANC CUPATGE BASE CAVA GUARDA ECOLÒGIC',                 'BASE CAVA', true,  11),
  ('VI BLANC CUPATGE BASE CAVA GUARDA SUPERIOR',                 'BASE CAVA', false, 12),
  ('VI BLANC CUPATGE BASE CAVA GUARDA SUPERIOR ECOLÒGIC',        'BASE CAVA', true,  13),
  ('VI BLANC XAREL·LO BASE CAVA GUARDA',                         'BASE CAVA', false, 14),
  ('VI BLANC XAREL·LO BASE CAVA GUARDA SUPERIOR ECOLÒGIC',       'BASE CAVA', true,  15),
  ('VI BLANC MACABEU BASE CAVA GUARDA',                          'BASE CAVA', false, 16),
  ('VI BLANC MACABEU BASE CAVA GUARDA SUPERIOR ECOLÒGIC',        'BASE CAVA', true,  17),
  ('VI BLANC CHARDONNAY BASE CAVA GUARDA SUPERIOR ECOLÒGIC',     'BASE CAVA', true,  18),
  ('VI ROSAT CUPATGE BASE CAVA GUARDA',                          'BASE CAVA', false, 19),
  ('VI ROSAT CUPATGE BASE CAVA GUARDA SUPERIOR ECOLÒGIC',        'BASE CAVA', true,  20),
  ('VI ROSAT GARNATXA BASE CAVA GUARDA SUPERIOR ECOLÒGIC',       'BASE CAVA', true,  21),
  ('VI ROSAT PINOT NOIR BASE CAVA GUARDA SUPERIOR ECOLÒGIC',     'BASE CAVA', true,  22),
  ('MOST BLANC CHARDONNAY BASE CAVA GUARDA SUPERIOR ECOLÒGIC',   'BASE CAVA', true,  23),
  ('MOST ROSAT GARNATXA BASE CAVA GUARDA SUPERIOR ECOLÒGIC',     'BASE CAVA', true,  24),
  -- DO PENEDÈS
  ('VI BLANC CUPATGE DO PENEDÈS',                                'DO PENEDES', false, 30),
  ('VI BLANC CUPATGE DO PENEDÈS ECOLÒGIC',                       'DO PENEDES', true,  31),
  ('VI BLANC XAREL·LO DO PENEDÈS',                               'DO PENEDES', false, 32),
  ('VI BLANC XAREL·LO DO PENEDÈS ECOLÒGIC',                      'DO PENEDES', true,  33),
  ('VI BLANC XAREL·LO VERMELL DO PENEDÈS ECOLÒGIC',              'DO PENEDES', true,  34),
  ('VI BLANC MACABEU DO PENEDÈS ECOLÒGIC',                       'DO PENEDES', true,  35),
  ('VI BLANC CHARDONNAY DO PENEDÈS ECOLÒGIC',                    'DO PENEDES', true,  36),
  ('VI BLANC MUSCAT FRONTIGNAN DO PENEDÈS ECOLÒGIC',             'DO PENEDES', true,  37),
  ('VI NEGRE CUPATGE DO PENEDÈS',                                'DO PENEDES', false, 38),
  ('VI NEGRE MERLOT DO PENEDÈS ECOLÒGIC',                        'DO PENEDES', true,  39),
  ('VI NEGRE CABERNET DO PENEDÈS ECOLÒGIC',                      'DO PENEDES', true,  40),
  ('VI NEGRE GARNATXA DO PENEDÈS ECOLÒGIC',                      'DO PENEDES', true,  41),
  ('VI ROSAT GARNATXA DO PENEDÈS ECOLÒGIC',                      'DO PENEDES', true,  42),
  ('VI ROSAT MERLOT DO PENEDÈS ECOLÒGIC',                        'DO PENEDES', true,  43),
  -- DO CATALUNYA
  ('VI BLANC CUPATGE DO CATALUNYA',                              'DO CATALUNYA', false, 50),
  ('VI BLANC MACABEU DO CATALUNYA',                              'DO CATALUNYA', false, 51),
  -- ALTRES / SENSE DO
  ('VI BLANC DE TAULA',                                          'ALTRES / SENSE DO', false, 60),
  ('VI BLANC DE TAULA ECOLÒGIC',                                 'ALTRES / SENSE DO', true,  61),
  ('VI BLANC XAREL·LO DE TAULA ECOLÒGIC',                        'ALTRES / SENSE DO', true,  62),
  ('VI BLANC MACABEU DE TAULA ECOLÒGIC',                         'ALTRES / SENSE DO', true,  63),
  ('VI BLANC PARELLADA DE TAULA ECOLÒGIC',                       'ALTRES / SENSE DO', true,  64),
  ('MOST BLANC XAREL·LO DE TAULA',                               'ALTRES / SENSE DO', false, 65),
  ('VI NEGRE DE TAULA',                                          'ALTRES / SENSE DO', false, 66),
  ('VI NEGRE DE TAULA ECOLÒGIC',                                 'ALTRES / SENSE DO', true,  67),
  ('VI NEGRE GARNATXA DE TAULA',                                 'ALTRES / SENSE DO', false, 68),
  ('VI ROSAT GARNATXA DE TAULA',                                 'ALTRES / SENSE DO', false, 69),
  ('VI ROSAT MERLOT DE TAULA',                                   'ALTRES / SENSE DO', false, 70)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- CAMPANYES
-- A wine campaign runs harvest-to-harvest (August..July), which is exactly how
-- the source sheets are cut ("GUIES AGOST 24 - JULIOL 25", "25-26").
-- ---------------------------------------------------------------------------
insert into public.campaigns (name, year_start, year_end, status, starts_on, ends_on) values
  ('2023-2024', 2023, 2024, 'TANCADA', '2023-08-01', '2024-07-31'),
  ('2024-2025', 2024, 2025, 'TANCADA', '2024-08-01', '2025-07-31'),
  ('2025-2026', 2025, 2026, 'OBERTA',  '2025-08-01', '2026-07-31'),
  ('2026-2027', 2026, 2027, 'FUTURA',  '2026-08-01', '2027-07-31')
on conflict (name_norm) do nothing;

-- ---------------------------------------------------------------------------
-- PRODUCT IMPORT ALIASES
-- Only used to map source spreadsheet strings onto the catalogue during an
-- import and to widen search. Never shown as a product name.
-- Codes seen in the sources: G-CB = Guarda base cava, GS-CB = Guarda Superior
-- base cava, AF = apte flor, "APTE D.O X" = eligible for that DO.
-- ---------------------------------------------------------------------------
insert into public.product_aliases (product_id, alias, source)
select p.id, a.alias, 'VENTES CAVA G I GS.xlsx'
from (values
  ('VI BLANC CUPATGE BASE CAVA GUARDA',                        'VI BLANC CUPATGE BASE CAVA (G-CB)'),
  ('VI BLANC CUPATGE BASE CAVA GUARDA',                        'VI BLANC CUPATGE B. CAVA (G-CB)'),
  ('VI BLANC CUPATGE BASE CAVA GUARDA ECOLÒGIC',               'VI BLANC CUPATGE ECOLÒGIC BASE CAVA (G-CB)'),
  ('VI BLANC CUPATGE BASE CAVA GUARDA ECOLÒGIC',               'VI BLANC CUPATGE ECOLGÒGIC BASE CAVA (G-CB)'),
  ('VI BLANC CUPATGE BASE CAVA GUARDA SUPERIOR',               'VI BLANC CUPATGE B.CAVA (GS-CB)'),
  ('VI BLANC CUPATGE BASE CAVA GUARDA SUPERIOR',               'VI BLANC CUPATGE B.CAVA (GS)'),
  ('VI BLANC CUPATGE BASE CAVA GUARDA SUPERIOR',               'VI BLANC CUPATGE B.CAVA (GS-CB-AF)'),
  ('VI BLANC CUPATGE BASE CAVA GUARDA SUPERIOR ECOLÒGIC',      'VI BLANC CUPATGE ECOLÒGIC B. CAVA (GS-CB)'),
  ('VI BLANC CUPATGE BASE CAVA GUARDA SUPERIOR ECOLÒGIC',      'VI BLANC CUPATGE ECOLÒGIC BASE CAVA (GS-CB)'),
  ('VI BLANC MACABEU BASE CAVA GUARDA SUPERIOR ECOLÒGIC',      'VI BLANC MACABEU ECOLÒGIC BASE CAVA (GS-CB)'),
  ('VI BLANC CHARDONNAY BASE CAVA GUARDA SUPERIOR ECOLÒGIC',   'VI BLANC CHARDONNAY ECOLÒGIC B. CAVA (GS-CB)'),
  ('VI BLANC CHARDONNAY BASE CAVA GUARDA SUPERIOR ECOLÒGIC',   'VI BLANC CHARDONNAY ECOLÒGIC BASE CAVA (GS-CB)'),
  ('VI ROSAT CUPATGE BASE CAVA GUARDA',                        'VI ROSAT CUPATGE BASE CAVA (G-CB)'),
  ('VI ROSAT CUPATGE BASE CAVA GUARDA SUPERIOR ECOLÒGIC',      'VI ROSAT CUPATGE ECOLÒGIC BASE CAVA (GS-CB)'),
  ('MOST ROSAT GARNATXA BASE CAVA GUARDA SUPERIOR ECOLÒGIC',   'MOST ROSAT GARNATXA ECOLÒGICA BASE CAVA (GS-CB)'),
  ('MOST BLANC XAREL·LO DE TAULA',                             'MOST BLANC XAREL·LO TAULA'),
  ('VI BLANC DE TAULA',                                        'VI BLANC TAULA'),
  ('VI BLANC DE TAULA ECOLÒGIC',                               'VI BLANC TAULA ECOLÒGIC'),
  ('VI BLANC CUPATGE DO CATALUNYA',                            'VI BLANC D.O CATALUNYA'),
  ('VI BLANC CUPATGE DO CATALUNYA',                            'VI BLANC CUPATGE D.O CATALUNYA'),
  ('VI BLANC MACABEU DO PENEDÈS ECOLÒGIC',                     'VI BLANC MACABEU ECOLÒGIC APTE D.O PENEDÈS'),
  ('VI NEGRE CUPATGE DO PENEDÈS',                              'VI NEGE APTE D.O PENEDÈS (CUPATGE)'),
  ('VI NEGRE CABERNET DO PENEDÈS ECOLÒGIC',                    'VI NEGRE CABERNET ECOLÒGIC APTE D.O PENEDÈS'),
  ('VI ROSAT GARNATXA DO PENEDÈS ECOLÒGIC',                    'VI ROSAT CUPATGE ECOLÒGIC APTE D.O PENEDÈS'),
  ('VI BLANC CUPATGE DO PENEDÈS ECOLÒGIC',                     'VI BLANC CUPATGE ECOLÒGIC D.O PENEDÈS')
) as a(product_name, alias)
join public.products p on p.name = a.product_name
on conflict (alias_norm) do nothing;
