#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Parse the two PDF source documents of the VITALPE CRM import pipeline into
structured JSON.

Sources
-------
1. CLIENTS_ACTIUS.pdf
   Spanish accounting ledger ("Extracto de Cuentas Contables") for
   VITALPE SAT NUM 1384 CAT - F61378659, accounts 43000000000..43099999999,
   period 01/08/2025 .. 03/06/2026.
   Produces: parsed/clients_actius_accounts.json
   (account code -> company name + movement metadata; NO monetary amounts).

2. Listado_de_Bodegas_Elaboradoras_de_Cava_Certificadas.pdf
   Official list of certified cava-producing wineries.
   Produces: parsed/bodegues_cava_certificades.json

Nothing is inferred or invented: every field is taken literally from the
printed text. Absent values are emitted as null.

Text extraction uses `pdftotext -layout` (poppler). Requires poppler-utils.

Usage
-----
    python3 scripts/import/parse_pdf_sources.py [--extracted-at YYYY-MM-DD]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCES_DIR = REPO_ROOT / "data" / "sources"
PARSED_DIR = SOURCES_DIR / "parsed"

CLIENTS_PDF = SOURCES_DIR / "CLIENTS_ACTIUS.pdf"
BODEGAS_PDF = SOURCES_DIR / "Listado_de_Bodegas_Elaboradoras_de_Cava_Certificadas.pdf"

CLIENTS_JSON = PARSED_DIR / "clients_actius_accounts.json"
BODEGAS_JSON = PARSED_DIR / "bodegues_cava_certificades.json"

DEFAULT_EXTRACTED_AT = "2026-07-23"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def sha256_of(path: Path) -> str:
    """Return the hex sha256 digest of a file."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_pdftotext() -> str:
    exe = shutil.which("pdftotext")
    if not exe:
        sys.exit(
            "ERROR: `pdftotext` (poppler-utils) not found on PATH.\n"
            "Install it with e.g. `brew install poppler`."
        )
    return exe


def page_count(path: Path) -> int:
    """Page count via `pdfinfo` when available, else pypdf."""
    pdfinfo = shutil.which("pdfinfo")
    if pdfinfo:
        out = subprocess.run(
            [pdfinfo, str(path)], capture_output=True, text=True, check=True
        ).stdout
        match = re.search(r"^Pages:\s+(\d+)", out, re.MULTILINE)
        if match:
            return int(match.group(1))
    import pypdf  # noqa: PLC0415  (optional dependency, only used as fallback)

    return len(pypdf.PdfReader(str(path)).pages)


def pages_text(path: Path) -> list[str]:
    """Extract each page separately with `pdftotext -layout`, preserving columns."""
    exe = require_pdftotext()
    pages: list[str] = []
    for page_no in range(1, page_count(path) + 1):
        out = subprocess.run(
            [exe, "-layout", "-f", str(page_no), "-l", str(page_no), str(path), "-"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        pages.append(out)
    return pages


def iso_date(ddmmyy: str) -> str:
    """'06/09/25' -> '2025-09-06'. The ledger prints 2-digit years only."""
    day, month, year = ddmmyy.split("/")
    return f"20{year}-{month}-{day}"


# ---------------------------------------------------------------------------
# 1. CLIENTS_ACTIUS.pdf  --  accounting ledger
# ---------------------------------------------------------------------------

# A movement row always begins at column 0 with a DD/MM/YY date.
RE_MOVEMENT = re.compile(r"^(\d{2}/\d{2}/\d{2})\s")

# An account block header: account code at column 0, then the company name.
RE_ACCOUNT_HEADER = re.compile(r"^(\d{4,12})\s{2,}(\S.*?)\s*$")

# Continuation of an account across a page break.
RE_CONTINUATION = re.compile(
    r"^\s*Continuaci[oó]n de la cuenta:\s*(\d{4,12})\s+(\S.*?)\s*$"
)

# Repeated page furniture emitted on every page of the report.
NOISE_PREFIXES = (
    "Desde la cuenta",
    "Desde el d",  # "Desde el día ..."
    "Todas las partidas",
    "Imprimir saldos iniciales",
    "VITALPE SAT",
    "FECHA",
)


def is_noise(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return True
    if stripped.startswith(NOISE_PREFIXES):
        return True
    # Standalone "Fecha: ... / Pág.: N" banner line.
    if "Pág.:" in stripped or re.fullmatch(r"Fecha:\s*[\d-]+", stripped):
        return True
    return False


def parse_clients(path: Path, extracted_at: str) -> tuple[dict, dict]:
    """Parse the ledger. Returns (payload, stats)."""
    pages = pages_text(path)

    # account_code -> record
    accounts: dict[str, dict] = {}
    order: list[str] = []

    current: str | None = None
    unparsed: list[dict] = []
    apertura_rows = 0
    total_movement_rows = 0

    for page_index, page in enumerate(pages, start=1):
        for raw_line in page.splitlines():
            line = raw_line.rstrip()

            if is_noise(line):
                continue

            # "Total General" closes the printed block but the account context
            # is simply superseded by the next header, so nothing to do here.
            if "Total General" in line:
                continue

            cont = RE_CONTINUATION.match(line)
            if cont:
                code = cont.group(1)
                # Continuation blocks belong to an account already opened.
                # Merge, never duplicate.
                if code not in accounts:
                    accounts[code] = {
                        "account_code": code,
                        "company_name": cont.group(2),
                        "movement_count": 0,
                        "first_movement_date": None,
                        "last_movement_date": None,
                        "page": page_index,
                    }
                    order.append(code)
                current = code
                continue

            mov = RE_MOVEMENT.match(line)
            if mov:
                if current is None:
                    unparsed.append(
                        {
                            "page": page_index,
                            "reason": "movement row before any account header",
                            "line": line,
                        }
                    )
                    continue
                date = iso_date(mov.group(1))
                rec = accounts[current]
                rec["movement_count"] += 1
                total_movement_rows += 1
                if "Apertura del Ejercicio" in line:
                    apertura_rows += 1
                if rec["first_movement_date"] is None or date < rec["first_movement_date"]:
                    rec["first_movement_date"] = date
                if rec["last_movement_date"] is None or date > rec["last_movement_date"]:
                    rec["last_movement_date"] = date
                continue

            head = RE_ACCOUNT_HEADER.match(line)
            if head:
                code, name = head.group(1), head.group(2)
                if code not in accounts:
                    accounts[code] = {
                        "account_code": code,
                        "company_name": name,
                        "movement_count": 0,
                        "first_movement_date": None,
                        "last_movement_date": None,
                        "page": page_index,
                    }
                    order.append(code)
                current = code
                continue

            unparsed.append(
                {"page": page_index, "reason": "unrecognised line", "line": line}
            )

    payload = {
        "source_file": path.name,
        "sha256": sha256_of(path),
        "extracted_at": extracted_at,
        "period": {"from": "2025-08-01", "to": "2026-06-03"},
        "accounts": [accounts[c] for c in order],
    }
    stats = {
        "pages": len(pages),
        "accounts": len(order),
        "movement_rows": total_movement_rows,
        "apertura_rows": apertura_rows,
        "unparsed": unparsed,
    }
    return payload, stats


# ---------------------------------------------------------------------------
# 2. Listado de Bodegas Elaboradoras de Cava Certificadas
# ---------------------------------------------------------------------------

# Three printed columns: RAZÓN SOCIAL | ALCANCE | MUNICIPIO.
# ALCANCE is a constant literal in this document, which gives a reliable anchor
# for splitting the row regardless of the per-page indentation.
RE_BODEGA_ROW = re.compile(
    r"^\s*(?P<name>\S.*?)\s{2,}(?P<scope>Elaboración de Cava)\s{2,}(?P<mun>\S.*?)\s*$"
)

BODEGAS_SKIP = (
    "LISTADO DE BODEGAS",
    "Normas y otros documentos",
    "* Pliego de Condiciones",
    "* PG10-",
    "RAZÓN SOCIAL",
)


def parse_bodegas(path: Path, extracted_at: str) -> tuple[dict, dict]:
    pages = pages_text(path)

    companies: list[dict] = []
    unparsed: list[dict] = []
    rows_per_page: list[int] = []

    for page_index, page in enumerate(pages, start=1):
        page_rows = 0
        for raw_line in page.splitlines():
            line = raw_line.rstrip()
            if not line.strip():
                continue
            if any(marker in line for marker in BODEGAS_SKIP):
                continue

            match = RE_BODEGA_ROW.match(line)
            if match:
                companies.append(
                    {
                        "name": match.group("name"),
                        "municipality": match.group("mun"),
                        # The document prints no province column.
                        "province": None,
                        "other_columns": {"ALCANCE": match.group("scope")},
                    }
                )
                page_rows += 1
                continue

            unparsed.append(
                {"page": page_index, "reason": "unrecognised line", "line": line}
            )
        rows_per_page.append(page_rows)

    payload = {
        "source_file": path.name,
        "sha256": sha256_of(path),
        "extracted_at": extracted_at,
        "companies": companies,
    }
    stats = {
        "pages": len(pages),
        "companies": len(companies),
        "rows_per_page": rows_per_page,
        "unparsed": unparsed,
    }
    return payload, stats


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extracted-at", default=DEFAULT_EXTRACTED_AT)
    args = parser.parse_args()

    clients_payload, clients_stats = parse_clients(CLIENTS_PDF, args.extracted_at)
    write_json(CLIENTS_JSON, clients_payload)

    bodegas_payload, bodegas_stats = parse_bodegas(BODEGAS_PDF, args.extracted_at)
    write_json(BODEGAS_JSON, bodegas_payload)

    print(f"{CLIENTS_PDF.name}: {clients_stats['pages']} pages, "
          f"{clients_stats['accounts']} accounts, "
          f"{clients_stats['movement_rows']} movement rows "
          f"({clients_stats['apertura_rows']} 'Apertura del Ejercicio'), "
          f"{len(clients_stats['unparsed'])} unparsed lines")
    for item in clients_stats["unparsed"]:
        print(f"   [p{item['page']}] {item['reason']}: {item['line']!r}")

    print(f"{BODEGAS_PDF.name}: {bodegas_stats['pages']} pages, "
          f"{bodegas_stats['companies']} companies "
          f"(per page: {bodegas_stats['rows_per_page']}), "
          f"{len(bodegas_stats['unparsed'])} unparsed lines")
    for item in bodegas_stats["unparsed"]:
        print(f"   [p{item['page']}] {item['reason']}: {item['line']!r}")

    print(f"\nWrote {CLIENTS_JSON}")
    print(f"Wrote {BODEGAS_JSON}")


if __name__ == "__main__":
    main()
