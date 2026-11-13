"""
PDF reports: cost overview per project and an inventory list of all spools.

Plain overviews for hobby use (no margin, labour or quotes).  Built with fpdf2
and its core Helvetica font, so text is limited to Latin-1: umlauts work, the
euro sign does not – amounts are written as "12,34 Euro" (or the currency code).
"""
from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import quote

import math

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from fpdf import FPDF
from fpdf.fonts import FontFace
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session, joinedload, selectinload

from ..database import get_db
from ..models import PrintJob, PrintUsage, Project, Spool
from ..statistics import local_tz
from ..util import utcnow

router = APIRouter(prefix="/api/reports", tags=["reports"])

# ── texts ───────────────────────────────────────────────────────────────────

TEXTS = {
    "de": {
        "project_title": "Kostenaufstellung", "inventory_title": "Inventarliste",
        "as_of": "Stand", "page": "Seite", "period": "Zeitraum", "link": "Link",
        "summary": "Übersicht", "prints": "Drucke", "of_which_test": "davon Testdrucke",
        "duration": "Druckdauer", "filament": "Filament", "material": "Material",
        "energy": "Strom", "wear": "Abnutzung", "total": "Gesamt", "per_print": "je Druck",
        "of_which_est": "davon geschätzt", "by_material": "Verbrauch je Material",
        "color": "Farbe", "grams": "Gramm", "share": "Anteil", "print_list": "Drucke im Projekt",
        "date": "Datum", "name": "Name", "sum": "Summe", "no_spool": "ohne Spule",
        "note_est": "Geschätzt: Drucke ohne zugeordnete Spule (alter Cloud-Import) sind mit dem "
                    "Durchschnittspreis je Gramm des Materials aus dem Bestand bewertet.",
        "note_no_kwh": "{n} Drucke ohne Strommessung (Strom dort 0).",
        "note_test": "T = Testdruck.", "failed": "fehlgeschlagen",
        "spools": "Spulen", "no_location": "Ohne Lagerort", "nr": "Nr.", "brand": "Marke",
        "remaining": "Rest", "moisture": "Feuchte", "value": "Wert", "ams": "AMS",
        "checked": "Geprüft", "all_locations": "Alle Lagerorte", "empty": "leer",
        "drying": "im Trockner", "inv_note": "Feuchte = geschätzte Trockenheit in Prozent "
                    "(100 = frisch getrocknet). Wert = Restgewicht mal Preis je Gramm.",
        "h": "h", "no_prints": "Keine Drucke im Projekt.", "no_spools": "Keine Spulen.",
        "extras": "Zusatzposten", "tests_excluded": "Testdrucke nicht mitgerechnet ({n}).",
        "included": "Enthalten", "amounts_in": "Beträge in {unit}.",
    },
    "en": {
        "project_title": "Cost overview", "inventory_title": "Inventory list",
        "as_of": "As of", "page": "Page", "period": "Period", "link": "Link",
        "summary": "Summary", "prints": "Prints", "of_which_test": "of which test prints",
        "duration": "Print time", "filament": "Filament", "material": "Material",
        "energy": "Energy", "wear": "Wear", "total": "Total", "per_print": "per print",
        "of_which_est": "of which estimated", "by_material": "Usage by material",
        "color": "Colour", "grams": "Grams", "share": "Share", "print_list": "Prints in project",
        "date": "Date", "name": "Name", "sum": "Sum", "no_spool": "no spool",
        "note_est": "Estimated: prints without an assigned spool (old cloud import) are priced "
                    "with the average price per gram of that material in stock.",
        "note_no_kwh": "{n} prints without energy measurement (energy 0 there).",
        "note_test": "T = test print.", "failed": "failed",
        "spools": "Spools", "no_location": "No storage location", "nr": "No.", "brand": "Brand",
        "remaining": "Left", "moisture": "Dryness", "value": "Value", "ams": "AMS",
        "checked": "Checked", "all_locations": "All locations", "empty": "empty",
        "drying": "drying", "inv_note": "Dryness = estimated dryness in percent "
                    "(100 = freshly dried). Value = remaining weight times price per gram.",
        "h": "h", "no_prints": "No prints in this project.", "no_spools": "No spools.",
        "extras": "Extra items", "tests_excluded": "Test prints not included ({n}).",
        "included": "Included", "amounts_in": "Amounts in {unit}.",
    },
}

_REPLACE = {"€": "Euro", "–": "-", "—": "-", "„": '"', "“": '"', "”": '"', "‘": "'",
            "’": "'", "…": "...", "•": "-", "×": "x", "≈": "~", " ": " "}


def _t(lang: str) -> dict:
    return TEXTS.get((lang or "de")[:2].lower(), TEXTS["en"])


def latin1(text: str | None) -> str:
    """Make text printable with the core fonts (Latin-1 only)."""
    s = str(text or "")
    for a, b in _REPLACE.items():
        s = s.replace(a, b)
    return s.encode("latin-1", "replace").decode("latin-1")


# ── number formatting ───────────────────────────────────────────────────────

def _num(x: float | None, digits: int, lang: str) -> str:
    s = f"{(x or 0):,.{digits}f}"
    if lang.startswith("de"):
        s = s.replace(",", "\x00").replace(".", ",").replace("\x00", ".")
    return s


def _money(x: float | None, lang: str, currency: str) -> str:
    unit = "Euro" if currency.upper() == "EUR" else currency.upper()
    return f"{_num(x, 2, lang)} {unit}"


def _hex_rgb(hex_: str | None) -> tuple[int, int, int]:
    h = (hex_ or "").lstrip("#")
    if len(h) >= 6:
        try:
            return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        except ValueError:
            pass
    return 136, 136, 136


# ── PDF base ────────────────────────────────────────────────────────────────

class _Pdf(FPDF):
    def __init__(self, title: str, stand: str, tx: dict, orientation: str = "P"):
        super().__init__(orientation=orientation, unit="mm", format="A4")
        self.title_text = latin1(title)
        self.stand = latin1(stand)
        self.tx = tx
        self.set_auto_page_break(True, margin=15)
        self.set_margins(12, 12, 12)
        self.set_title(self.title_text)
        self.set_creator("Filament Manager")
        self.alias_nb_pages()

    def header(self):
        self.set_font("Helvetica", "B", 15)
        self.cell(0, 8, self.title_text, new_x="LMARGIN", new_y="NEXT")
        self.set_font("Helvetica", "", 9)
        self.set_text_color(110, 110, 110)
        self.cell(0, 5, self.stand, new_x="LMARGIN", new_y="NEXT")
        self.set_text_color(0, 0, 0)
        self.set_draw_color(200, 200, 200)
        self.line(self.l_margin, self.get_y() + 1, self.w - self.r_margin, self.get_y() + 1)
        self.ln(4)

    def footer(self):
        self.set_y(-11)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(130, 130, 130)
        self.cell(0, 5, latin1(f"Filament Manager · {self.tx['page']} {self.page_no()}/{{nb}}"), align="R")
        self.set_text_color(0, 0, 0)

    def section(self, text: str):
        self.ln(2)
        self.set_font("Helvetica", "B", 11)
        self.cell(0, 7, latin1(text), new_x="LMARGIN", new_y="NEXT")
        self.set_font("Helvetica", "", 9)

    def note(self, text: str):
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(100, 100, 100)
        self.multi_cell(0, 4, latin1(text), new_x="LMARGIN", new_y="NEXT")
        self.set_text_color(0, 0, 0)
        self.set_font("Helvetica", "", 9)


_HEAD = FontFace(emphasis="BOLD", fill_color=(232, 232, 232))
_TOTAL = FontFace(emphasis="BOLD", fill_color=(245, 245, 245))


def _pdf_response(pdf: FPDF, filename: str) -> Response:
    data = bytes(pdf.output())
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


def _stand(db: Session, tx: dict) -> tuple[str, "object"]:
    tz = local_tz(db)
    now = utcnow().replace(tzinfo=timezone.utc).astimezone(tz)
    return f"{tx['as_of']} {now:%d.%m.%Y %H:%M}", tz


def _local(dt: datetime | None, tz) -> datetime | None:
    return dt.replace(tzinfo=timezone.utc).astimezone(tz) if dt else None


def _slug(name: str) -> str:
    keep = "".join(c if c.isalnum() else "_" for c in (name or "projekt"))
    return "_".join(p for p in keep.split("_") if p)[:60] or "projekt"


# ── report options (selection dialog) ───────────────────────────────────────

class ReportExtra(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    amount: float

    @field_validator("amount")
    @classmethod
    def _finite(cls, v: float) -> float:
        if not math.isfinite(v):
            raise ValueError("amount must be a finite number")
        return round(v, 2)


class ProjectReportOptions(BaseModel):
    """What the project cost report contains (all on = same as 1.6.0)."""
    material: bool = True
    energy: bool = True
    wear: bool = True
    include_tests: bool = True
    show_by_material: bool = True
    show_print_list: bool = True
    extras: list[ReportExtra] = Field(default_factory=list, max_length=20)


def _project_jobs(project: Project, opts: ProjectReportOptions) -> tuple[list[PrintJob], set[int], int]:
    """Jobs of the project (sorted), ids of test prints, number of test prints left out."""
    test_ids = {pp.print_job_id for pp in project.project_prints if pp.is_test_print}
    jobs = sorted(project.print_jobs, key=lambda j: j.started_at or datetime.min)
    if opts.include_tests:
        return jobs, test_ids, 0
    kept = [j for j in jobs if j.id not in test_ids]
    return kept, test_ids, len(jobs) - len(kept)


def project_summary(project: Project, opts: ProjectReportOptions | None = None) -> dict:
    """Totals of the project with the chosen options (preview + PDF)."""
    opts = opts or ProjectReportOptions()
    jobs, test_ids, excluded = _project_jobs(project, opts)
    material = sum(j.material_cost for j in jobs)
    estimated = sum((u.cost or 0) for j in jobs for u in j.usages if u.cost_estimated)
    energy = sum((j.energy_cost or 0) for j in jobs)
    kwh = sum((j.energy_kwh or 0) for j in jobs)
    wear = sum((j.wear_cost or 0) for j in jobs)
    extras = sum(e.amount for e in opts.extras)
    total = ((material if opts.material else 0) + (energy if opts.energy else 0)
             + (wear if opts.wear else 0) + extras)
    return {
        "prints": len(jobs),
        "test_prints": len(test_ids & {j.id for j in jobs}),
        "test_prints_excluded": excluded,
        "grams": round(sum(j.total_grams for j in jobs), 2),
        "hours": round(sum((j.duration_seconds or 0) for j in jobs) / 3600, 2),
        "material": round(material, 2) if opts.material else None,
        "material_estimated": round(estimated, 2) if opts.material else None,
        "energy": round(energy, 2) if opts.energy else None,
        "energy_kwh": round(kwh, 3) if opts.energy else None,
        "wear": round(wear, 2) if opts.wear else None,
        "extras": round(extras, 2),
        "total": round(total, 2),
        "per_print": round(total / len(jobs), 2) if jobs else None,
        "prints_without_kwh": sum(1 for j in jobs if j.energy_kwh is None),
    }


# ── project cost report ─────────────────────────────────────────────────────

def project_report(db: Session, project: Project, lang: str = "de", currency: str = "EUR",
                   opts: ProjectReportOptions | None = None) -> FPDF:
    opts = opts or ProjectReportOptions()
    tx = _t(lang)
    stand, tz = _stand(db, tx)
    pdf = _Pdf(f"{tx['project_title']}: {project.name}", stand, tx)
    pdf.add_page()

    jobs, test_ids, excluded = _project_jobs(project, opts)
    sm = project_summary(project, opts)

    # head
    pdf.set_font("Helvetica", "", 9)
    if project.description:
        pdf.multi_cell(0, 4.5, latin1(project.description), new_x="LMARGIN", new_y="NEXT")
    starts = [j.started_at for j in jobs if j.started_at]
    if starts:
        a, b = _local(min(starts), tz), _local(max(starts), tz)
        pdf.cell(0, 5, latin1(f"{tx['period']}: {a:%d.%m.%Y} - {b:%d.%m.%Y}"), new_x="LMARGIN", new_y="NEXT")
    if project.url:
        pdf.cell(0, 5, latin1(f"{tx['link']}: {project.url}"), new_x="LMARGIN", new_y="NEXT")

    if not jobs and not opts.extras:
        pdf.ln(4)
        pdf.cell(0, 6, latin1(tx["no_prints"]), new_x="LMARGIN", new_y="NEXT")
        if excluded:
            pdf.ln(2)
            pdf.note(tx["tests_excluded"].format(n=excluded))
        return pdf

    material, energy, wear = sm["material"] or 0, sm["energy"] or 0, sm["wear"] or 0
    estimated = sm["material_estimated"] or 0
    grams, hours, total = sm["grams"], sm["hours"], sm["total"]
    m = lambda x: _money(x, lang, currency)  # noqa: E731

    # summary
    pdf.section(tx["summary"])
    n_tests = sm["test_prints"]
    rows = [
        (tx["prints"], f"{len(jobs)}" + (f" ({tx['of_which_test']} {n_tests})" if n_tests else "")),
        (tx["duration"], f"{_num(hours, 1, lang)} {tx['h']}"),
        (tx["filament"], f"{_num(grams, 1, lang)} g"),
    ]
    if opts.material:
        rows.append((tx["material"], m(material) + (f" ({tx['of_which_est']} {m(estimated)})" if estimated > 0 else "")))
    if opts.energy:
        rows.append((tx["energy"], f"{m(energy)} ({_num(sm['energy_kwh'], 2, lang)} kWh)"))
    if opts.wear:
        rows.append((tx["wear"], m(wear)))
    for e in opts.extras:
        rows.append((e.name, m(e.amount)))
    with pdf.table(col_widths=(45, 100), width=145, align="LEFT", first_row_as_headings=False,
                   line_height=5.5, borders_layout="HORIZONTAL_LINES") as table:
        for label, value in rows:
            r = table.row()
            r.cell(latin1(label))
            r.cell(latin1(value))
        r = table.row()
        r.cell(latin1(tx["total"]), style=_TOTAL)
        per = f" ({tx['per_print']} {m(sm['per_print'])})" if jobs else ""
        r.cell(latin1(f"{m(total)}{per}"), style=_TOTAL)

    # by material / colour
    usage: dict[tuple[str, str, str], float] = {}
    for j in jobs:
        hints = {h.get("ams_slot"): h for h in (j.suggested_usages or []) if isinstance(h, dict)}
        for u in j.usages:
            if u.spool:
                key = (u.spool.material or "?", u.spool.color_name or "", u.spool.color_hex or "#888888")
            else:
                h = hints.get(u.ams_slot) or {}
                key = (str(h.get("filament_type") or "?"), tx["no_spool"], str(h.get("color") or "#888888"))
            usage[key] = usage.get(key, 0.0) + (u.grams_used or 0)
    if opts.show_by_material and usage and grams > 0:
        pdf.section(tx["by_material"])
        with pdf.table(col_widths=(8, 30, 62, 25, 20), width=145, align="LEFT", headings_style=_HEAD,
                       line_height=5, text_align=("LEFT", "LEFT", "LEFT", "RIGHT", "RIGHT")) as table:
            h = table.row()
            for c in ("", tx["material"], tx["color"], tx["grams"], tx["share"]):
                h.cell(latin1(c))
            for (mat, cname, chex), g in sorted(usage.items(), key=lambda kv: -kv[1]):
                r = table.row()
                r.cell("", style=FontFace(fill_color=_hex_rgb(chex)))
                r.cell(latin1(mat))
                r.cell(latin1(cname or chex))
                r.cell(_num(g, 1, lang))
                r.cell(f"{_num(g / grams * 100, 1, lang)} %")

    # print list – only the chosen cost columns; "Sum" = chosen costs of that print
    if opts.show_print_list and jobs:
        cost_cols = [(tx["material"], 18, "material"), (tx["energy"], 16, "energy"), (tx["wear"], 18, "wear")]
        cost_cols = [c for c in cost_cols if getattr(opts, c[2])]
        sum_w = 19 if cost_cols else 0
        name_w = 64 + (52 + 19) - sum(c[1] for c in cost_cols) - sum_w
        widths = (19, name_w, 13, 15) + tuple(c[1] for c in cost_cols) + ((sum_w,) if cost_cols else ())
        heads = (tx["date"], tx["name"], tx["h"], "g") + tuple(c[0] for c in cost_cols) + ((tx["sum"],) if cost_cols else ())
        pdf.section(tx["print_list"])
        pdf.set_font("Helvetica", "", 8)
        with pdf.table(col_widths=widths, align="LEFT", headings_style=_HEAD, line_height=4.5,
                       text_align=("LEFT", "LEFT") + ("RIGHT",) * (len(widths) - 2)) as table:
            h = table.row()
            for c in heads:
                h.cell(latin1(c))
            for j in jobs:
                r = table.row()
                st = _local(j.started_at, tz)
                r.cell(f"{st:%d.%m.%Y}" if st else "")
                name = (j.design_title or j.name or "")[:60]
                flags = (" [T]" if j.id in test_ids else "") + (f" ({tx['failed']})" if j.success is False else "")
                r.cell(latin1(name + flags))
                r.cell(_num((j.duration_seconds or 0) / 3600, 1, lang))
                r.cell(_num(j.total_grams, 1, lang))
                row_sum = 0.0
                for _label, _w, key in cost_cols:
                    if key == "material":
                        est = "*" if any(u.cost_estimated for u in j.usages) else ""
                        r.cell(_num(j.material_cost, 2, lang) + est)
                        row_sum += j.material_cost
                    else:
                        v = j.energy_cost if key == "energy" else j.wear_cost
                        r.cell(_num(v, 2, lang) if v is not None else "-")
                        row_sum += v or 0
                if cost_cols:
                    r.cell(_num(row_sum, 2, lang))
            r = table.row()
            r.cell(latin1(tx["sum"]), style=_TOTAL)
            r.cell(latin1(f"{len(jobs)} {tx['prints']}"), style=_TOTAL)
            r.cell(_num(hours, 1, lang), style=_TOTAL)
            r.cell(_num(grams, 1, lang), style=_TOTAL)
            vals = {"material": material, "energy": energy, "wear": wear}
            for _label, _w, key in cost_cols:
                r.cell(_num(vals[key], 2, lang), style=_TOTAL)
            if cost_cols:
                r.cell(_num(sum(vals[c[2]] for c in cost_cols), 2, lang), style=_TOTAL)

    pdf.ln(2)
    unit = "Euro" if currency.upper() == "EUR" else currency.upper()
    notes = [tx["amounts_in"].format(unit=unit)]
    if opts.show_print_list and test_ids & {j.id for j in jobs}:
        notes.append(tx["note_test"].replace("T", "[T]", 1))
    if excluded:
        notes.append(tx["tests_excluded"].format(n=excluded))
    if opts.material and estimated > 0:
        notes.append(("* " if opts.show_print_list else "") + tx["note_est"])
    if opts.energy and sm["prints_without_kwh"]:
        notes.append(tx["note_no_kwh"].format(n=sm["prints_without_kwh"]))
    pdf.note(" ".join(notes))
    return pdf


# ── inventory list ──────────────────────────────────────────────────────────

def inventory_report(db: Session, lang: str = "de", currency: str = "EUR",
                     include_empty: bool = True) -> FPDF:
    tx = _t(lang)
    stand, _tz = _stand(db, tx)
    spools = [s for s in db.query(Spool).all() if not s.archived]
    if not include_empty:
        spools = [s for s in spools if (s.current_weight_g or 0) > 0]
    pdf = _Pdf(f"{tx['inventory_title']} ({len(spools)} {tx['spools']})", stand, tx, orientation="L")
    pdf.add_page()
    if not spools:
        pdf.cell(0, 6, latin1(tx["no_spools"]))
        return pdf

    groups: dict[str, list[Spool]] = {}
    for s in spools:
        groups.setdefault((s.storage_location or "").strip(), []).append(s)
    order = sorted(groups, key=lambda k: (k == "", k.lower()))

    def _value(s: Spool) -> float:
        return (s.cost_per_gram or 0) * max(s.current_weight_g or 0, 0)

    widths = (12, 7, 30, 42, 50, 22, 15, 20, 24, 20, 15)
    align = ("RIGHT", "LEFT", "LEFT", "LEFT", "LEFT", "RIGHT", "RIGHT", "RIGHT", "RIGHT", "LEFT", "CENTER")
    heads = (tx["nr"], "", tx["brand"], tx["material"], tx["color"], f"{tx['remaining']} g",
             "%", tx["moisture"], tx["value"], tx["ams"], tx["checked"])
    grand_g = grand_v = 0.0
    for loc in order:
        items = sorted(groups[loc], key=lambda s: (s.custom_id is None, s.custom_id or 0, s.id))
        sum_g = sum(max(s.current_weight_g or 0, 0) for s in items)
        sum_v = sum(_value(s) for s in items)
        grand_g += sum_g
        grand_v += sum_v
        pdf.section(f"{loc or tx['no_location']} ({len(items)})")
        pdf.set_font("Helvetica", "", 8.5)
        with pdf.table(col_widths=widths, align="LEFT", headings_style=_HEAD, line_height=5,
                       text_align=align) as table:
            h = table.row()
            for c in heads:
                h.cell(latin1(c))
            for s in items:
                r = table.row()
                r.cell(str(s.custom_id) if s.custom_id is not None else f"({s.id})")
                r.cell("", style=FontFace(fill_color=_hex_rgb(s.color_hex)))
                r.cell(latin1(s.brand))
                r.cell(latin1(" ".join(p for p in (s.material, s.subtype, s.subtype2) if p)))
                r.cell(latin1(s.color_name))
                g = max(s.current_weight_g or 0, 0)
                r.cell(_num(g, 0, lang) if g > 0 else latin1(tx["empty"]))
                r.cell(_num(s.remaining_pct, 0, lang))
                mo = s.moisture or {}
                if mo.get("level") == "drying":
                    r.cell(latin1(tx["drying"]))
                else:
                    r.cell(f"{_num(mo['pct'], 0, lang)} %" if mo.get("pct") is not None else "-")
                r.cell(_num(_value(s), 2, lang) if s.cost_per_gram else "-")
                slot = (s.ams_slot or "").split(":")[-1].replace("ams1_tray", "")
                r.cell(latin1(slot))
                r.cell("")
            r = table.row()
            r.cell(latin1(tx["sum"]), style=_TOTAL, colspan=5)
            r.cell(_num(sum_g, 0, lang), style=_TOTAL)
            r.cell("", style=_TOTAL)
            r.cell("", style=_TOTAL)
            r.cell(_num(sum_v, 2, lang), style=_TOTAL)
            r.cell("", style=_TOTAL, colspan=2)

    pdf.section(tx["all_locations"])
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 5, latin1(f"{len(spools)} {tx['spools']} · {_num(grand_g / 1000, 2, lang)} kg · "
                          f"{tx['value']} {_money(grand_v, lang, currency)}"),
             new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)
    pdf.note(tx["inv_note"])
    return pdf


# ── endpoints ───────────────────────────────────────────────────────────────

def _load_project(db: Session, project_id: int) -> Project:
    project = (
        db.query(Project)
        .options(
            selectinload(Project.print_jobs).selectinload(PrintJob.usages).joinedload(PrintUsage.spool),
            selectinload(Project.project_prints),
        )
        .filter(Project.id == project_id)
        .first()
    )
    if not project:
        raise HTTPException(404, "Project not found")
    return project


def _project_pdf_response(db: Session, project_id: int, lang: str, currency: str,
                          opts: ProjectReportOptions) -> Response:
    project = _load_project(db, project_id)
    pdf = project_report(db, project, lang, currency, opts)
    tx = _t(lang)
    return _pdf_response(pdf, f"{_slug(tx['project_title'])}_{_slug(project.name)}.pdf")


@router.get("/projects/{project_id}.pdf")
def project_pdf(project_id: int, lang: str = "de", currency: str = "EUR",
                db: Session = Depends(get_db)):
    """Cost overview with everything included."""
    return _project_pdf_response(db, project_id, lang, currency, ProjectReportOptions())


@router.post("/projects/{project_id}.pdf")
def project_pdf_with_options(project_id: int, opts: ProjectReportOptions, lang: str = "de",
                             currency: str = "EUR", db: Session = Depends(get_db)):
    """Cost overview with the items chosen in the selection dialog."""
    return _project_pdf_response(db, project_id, lang, currency, opts)


@router.post("/projects/{project_id}/summary")
def project_summary_endpoint(project_id: int, opts: ProjectReportOptions,
                             db: Session = Depends(get_db)):
    """Totals for the preview in the selection dialog."""
    return project_summary(_load_project(db, project_id), opts)


@router.get("/inventory.pdf")
def inventory_pdf(lang: str = "de", currency: str = "EUR",
                  include_empty: bool = Query(True),
                  db: Session = Depends(get_db)):
    pdf = inventory_report(db, lang, currency, include_empty)
    tx = _t(lang)
    stamp = utcnow().strftime("%Y-%m-%d")
    return _pdf_response(pdf, f"{_slug(tx['inventory_title'])}_{stamp}.pdf")
