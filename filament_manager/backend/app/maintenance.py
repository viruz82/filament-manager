"""Maintenance log (Wartungsbuch): recurring tasks by print hours, days or grams.

Each task counts from ``last_done_at``. Print hours and grams come from the
prints that finished after that moment (only prints of the task's printer when
one is set). The task is due when the first limit is reached; "soon" from
SOON_PCT percent of a limit on.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session, joinedload

from .models import MaintenanceLog, MaintenanceTask, PrintJob, PrinterConfig
from .util import utcnow

SOON_PCT = 90.0

# Bambu Lab's periodic maintenance recommendations for the A1 series
# (wiki.bambulab.com → A1 → Periodic Maintenance; the A1 page links the A1 mini
# guideline). Bambu gives time and spool intervals, no print hours; one spool
# counts as 1000 g. Tasks Bambu only lists "when HMS prompts" or "on error"
# are left out. The weekly fan cleaning starts disabled (it would remind every week).
TEMPLATE_A1: list[dict] = [
    {"key": "rails", "days": 30,
     "de": ("X-, Y- und Z-Schiene reinigen und ölen", "Fremdkörper mit Pinzette entfernen, mit fusselfreiem Tuch abwischen, dünn mit Schmieröl (nicht Fett) ölen, Achse von Hand durchschieben."),
     "en": ("Clean and oil X, Y and Z rails", "Remove debris with tweezers, wipe with a lint-free cloth, apply lubricant oil (not grease), move the axis by hand.")},
    {"key": "hotend_clean", "days": 30,
     "de": ("Heizblock des Hotends reinigen", "Silikonsocke abnehmen, Rückstände entfernen, Heizblock mit Tuch und Isopropanol abwischen, Socke wieder aufsetzen."),
     "en": ("Clean hotend heating assembly", "Remove the silicone sock, clean residue, wipe the heater with a cloth and alcohol, refit the sock.")},
    {"key": "lead_screw", "days": 90,
     "de": ("Z-Spindel fetten", "Fett auf den Arbeitsbereich und das untere Lager, danach Z-Achse einmal ganz hoch und runter fahren."),
     "en": ("Grease Z lead screw", "Apply grease to the working area and bottom bearing, then move Z up and down once.")},
    {"key": "idler", "days": 90,
     "de": ("Umlenkrolle der X-Achse ölen", "Am Ende der X-Achse etwas Öl zwischen Riemen und Umlenkrolle geben."),
     "en": ("Oil X idler pulley", "Near the X-axis end cover, drop some oil between belt and idler pulley.")},
    {"key": "cutter", "grams": 3000,
     "de": ("Schneidmesser prüfen", "Andruckblock abnehmen, Klinge auf Ausbrüche prüfen, bei Bedarf tauschen (alle 3 Rollen PLA/PETG)."),
     "en": ("Check filament cutter", "Remove the pressing block, check the blade, replace if chipped (every 3 spools of PLA/PETG).")},
    {"key": "nozzle", "grams": 5000,
     "de": ("Düse reinigen", "Alle 5 Rollen PLA/PETG (Kohlefaser: alle 2). Bei Verschleiß oder Undichtigkeit Hotend tauschen."),
     "en": ("Clean nozzle", "Every 5 spools of PLA/PETG (carbon fibre: every 2). Replace the hotend when worn or leaking.")},
    {"key": "extruder_gear", "grams": 5000,
     "de": ("Extruderzahnrad reinigen", "Alle 5 Rollen PLA/PETG (Kohlefaser: alle 2): Fadenreste mit Pinzette entfernen, ausblasen."),
     "en": ("Clean extruder gear", "Every 5 spools of PLA/PETG (carbon fibre: every 2): remove debris with tweezers, blow out.")},
    {"key": "ptfe", "grams": 6000,
     "de": ("PTFE-Schlauch tauschen", "Alle 6 Rollen PLA (Kohlefaser/Holz: alle 2). Maß: außen 4 mm, innen 2,5 mm."),
     "en": ("Replace PTFE tube", "Every 6 spools of PLA (carbon fibre/wood: every 2). Size: 4 mm outer, 2.5 mm inner diameter.")},
    {"key": "fans", "days": 7, "enabled": False,
     "de": ("Lüfter reinigen (Bauteil- und Hotend-Lüfter)", "Luftkanäle auf Staub und Fremdkörper prüfen und reinigen."),
     "en": ("Clean fans (part and hotend cooling)", "Check the air ducts for dust and debris and clean them.")},
]


def _r(v: float | None, nd: int = 1) -> float | None:
    return None if v is None else round(v, nd)


def usage_since(db: Session, since: datetime, printer_name: str | None = None) -> tuple[float, float]:
    """(print hours, grams) of prints finished after ``since``."""
    q = (db.query(PrintJob)
         .options(joinedload(PrintJob.usages))
         .filter(PrintJob.finished_at.isnot(None), PrintJob.finished_at > since))
    if printer_name:
        q = q.filter(PrintJob.printer_name == printer_name)
    jobs = q.all()
    hours = sum((j.duration_seconds or 0) for j in jobs) / 3600
    grams = sum(u.grams_used for j in jobs for u in j.usages)
    return hours, grams


def evaluate(db: Session, task: MaintenanceTask, now: datetime | None = None) -> dict:
    """Progress of one task: counters since last done, % per limit, level."""
    now = now or utcnow()
    printer_name = task.printer.name if task.printer else None
    hours, grams = usage_since(db, task.last_done_at, printer_name)
    days = (now - task.last_done_at).total_seconds() / 86400

    parts: list[float] = []
    out: dict = {
        "hours_since": _r(hours, 2), "grams_since": _r(grams, 1), "days_since": _r(days, 1),
        "hours_left": None, "grams_left": None, "days_left": None,
    }
    if task.interval_hours:
        parts.append(hours / task.interval_hours * 100)
        out["hours_left"] = _r(task.interval_hours - hours, 1)
    if task.interval_grams:
        parts.append(grams / task.interval_grams * 100)
        out["grams_left"] = _r(task.interval_grams - grams, 0)
    if task.interval_days:
        parts.append(days / task.interval_days * 100)
        out["days_left"] = _r(task.interval_days - days, 1)

    pct = max(parts) if parts else None
    if not task.enabled:
        level = "off"
    elif pct is None:
        level = "none"          # no limit set
    elif pct >= 100:
        level = "due"
    elif pct >= SOON_PCT:
        level = "soon"
    else:
        level = "ok"
    out["pct"] = _r(pct, 1)
    out["level"] = level
    return out


def mark_done(db: Session, task: MaintenanceTask, note: str | None = None,
              done_at: datetime | None = None) -> MaintenanceLog:
    done_at = done_at or utcnow()
    ev = evaluate(db, task, now=done_at)
    entry = MaintenanceLog(task_id=task.id, done_at=done_at, note=note or None,
                           hours_since=ev["hours_since"], grams_since=ev["grams_since"],
                           days_since=ev["days_since"])
    db.add(entry)
    task.last_done_at = done_at
    return entry


def apply_template(db: Session, lang: str = "de", printer_id: int | None = None) -> list[MaintenanceTask]:
    """Create the template tasks that do not exist yet (by template_key). Counting starts now."""
    lang = "de" if (lang or "").lower().startswith("de") else "en"
    existing = {t.template_key for t in db.query(MaintenanceTask).filter(MaintenanceTask.template_key.isnot(None))}
    if printer_id is None:
        first = db.query(PrinterConfig).filter(PrinterConfig.is_active.is_(True)).order_by(PrinterConfig.id).first()
        printer_id = first.id if first else None
    start = (db.query(MaintenanceTask).count())
    created: list[MaintenanceTask] = []
    now = utcnow()
    for i, tpl in enumerate(TEMPLATE_A1):
        if tpl["key"] in existing:
            continue
        name, desc = tpl[lang]
        t = MaintenanceTask(name=name, description=desc, printer_id=printer_id,
                            interval_hours=tpl.get("hours"), interval_days=tpl.get("days"),
                            interval_grams=tpl.get("grams"), enabled=tpl.get("enabled", True),
                            template_key=tpl["key"], sort_order=start + i, last_done_at=now)
        db.add(t)
        created.append(t)
    return created


def sensor(db: Session, now: datetime | None = None) -> tuple[int, dict]:
    """State (number of due tasks) and attributes for the HA sensor."""
    tasks = (db.query(MaintenanceTask)
             .options(joinedload(MaintenanceTask.printer))
             .order_by(MaintenanceTask.sort_order, MaintenanceTask.id).all())
    rows = []
    for t in tasks:
        if not t.enabled:
            continue
        ev = evaluate(db, t, now)
        rows.append({"id": t.id, "name": t.name, "level": ev["level"], "pct": ev["pct"],
                     "hours_left": ev["hours_left"], "grams_left": ev["grams_left"],
                     "days_left": ev["days_left"], "last_done": t.last_done_at.isoformat() + "Z"})
    rows.sort(key=lambda r: -(r["pct"] or 0))
    due = sum(1 for r in rows if r["level"] == "due")
    return due, {
        "friendly_name": "Filament Manager: Maintenance Due",
        "icon": "mdi:wrench-clock",
        "unit_of_measurement": "tasks",
        "soon": sum(1 for r in rows if r["level"] == "soon"),
        "soon_pct": SOON_PCT,
        "tasks": rows,
    }
