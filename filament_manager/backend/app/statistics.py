"""
Statistics for Home Assistant and the /api/dashboard/statistics endpoint.

Two kinds of output:

* ``counters(db)`` – a handful of plain numbers that HA records as long-term
  statistics (filament used, prints, print hours, costs, stock).  They are
  pushed with ``state_class`` so HA keeps hourly/daily/monthly history.
* ``compute(db)`` – a compact snapshot with breakdowns (by type, brand,
  colour, month, weekday, storage location …) and a per-spool forecast of
  when it runs empty.  Meant for dashboards; not meant for the recorder.

All grouping by day/month/weekday happens in local time (user override →
``TZ`` environment variable → UTC); timestamps are stored as naive UTC.
"""
from __future__ import annotations

import os
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session, joinedload

from .models import PrintJob, PrintUsage, Spool, UserPreferences
from .util import utcnow

FORECAST_DAYS = 30          # usage window for "runs empty in …" (same default as Spooly)
PERIODS = (7, 30, 90, 365)  # day windows for the period figures
TOP_N = 8


def local_tz(db: Session) -> ZoneInfo:
    prefs = db.get(UserPreferences, 1)
    for name in ((prefs.timezone_override if prefs else None), os.environ.get("TZ")):
        if name and name.strip():
            try:
                return ZoneInfo(name.strip())
            except Exception:
                pass
    return ZoneInfo("UTC")


def _to_local(dt: datetime, tz: ZoneInfo) -> datetime:
    return dt.replace(tzinfo=timezone.utc).astimezone(tz)


def _spool_label(s: Spool) -> str:
    return " ".join(p for p in (s.brand, s.material, s.subtype, s.color_name) if p).strip()


def _type_label(s: Spool) -> str:
    return f"{s.material} {s.subtype}".strip() if s.subtype else (s.material or "?")


def _r(x: float | None, n: int = 2) -> float:
    return round(x or 0.0, n)


def _jobs(db: Session) -> list[PrintJob]:
    return (
        db.query(PrintJob)
        .options(joinedload(PrintJob.usages).joinedload(PrintUsage.spool))
        .all()
    )


def _job_time(j: PrintJob) -> datetime:
    """Point in time a job counts for: its end, or its start while running."""
    return j.finished_at or j.started_at


def counters(db: Session) -> dict[str, float]:
    """Cumulative totals for HA long-term statistics."""
    jobs = _jobs(db)
    spools = db.query(Spool).all()
    grams = sum(u.grams_used for j in jobs for u in j.usages)
    material = sum((u.cost or 0) for j in jobs for u in j.usages)
    energy = sum((j.energy_cost or 0) for j in jobs)
    wear = sum((j.wear_cost or 0) for j in jobs)
    finished = [j for j in jobs if j.finished_at]
    active = [s for s in spools if not s.archived and s.current_weight_g > 0]
    return {
        "filament_used_g": _r(grams, 1),
        "prints": len(finished),
        "print_hours": _r(sum((j.duration_seconds or 0) for j in finished) / 3600, 2),
        "cost_material": _r(material),
        "cost_energy": _r(energy),
        "cost_wear": _r(wear),
        "cost_total": _r(material + energy + wear),
        "stock_g": _r(sum(s.current_weight_g for s in active), 1),
        "stock_value": _r(sum((s.cost_per_gram or 0) * s.current_weight_g for s in active)),
    }


def compute(db: Session, now: datetime | None = None, forecast_days: int = FORECAST_DAYS) -> dict:
    """Dashboard snapshot. ``now`` is naive UTC (tests pass a fixed value)."""
    now = now or utcnow()
    tz = local_tz(db)
    today = _to_local(now, tz).date()

    prefs = db.get(UserPreferences, 1)
    low_pct = (prefs.low_stock_threshold_pct if prefs else None) or 20

    spools = db.query(Spool).all()
    jobs = _jobs(db)
    finished = [j for j in jobs if j.finished_at]

    # ── overview ────────────────────────────────────────────────────────────
    active = [s for s in spools if not s.archived]
    with_filament = [s for s in active if s.current_weight_g > 0]
    total_g = sum(u.grams_used for j in jobs for u in j.usages)
    ok_jobs = [j for j in finished if j.success is not False]

    def _bucket(s: Spool) -> str:
        if s.archived:
            return "archiviert"
        if s.current_weight_g <= 0:
            return "leer"
        if s.remaining_pct < low_pct:
            return "niedrig"
        if s.remaining_pct <= 50:
            return "mittel"
        return "voll"

    status = {k: 0 for k in ("voll", "mittel", "niedrig", "leer", "archiviert")}
    for s in spools:
        status[_bucket(s)] += 1

    # ── period windows (+ the window before, for a trend) ──────────────────
    def _window(days: int, offset: int = 0) -> dict:
        end = now - timedelta(days=offset)
        start = end - timedelta(days=days)
        sel = [j for j in jobs if start <= _job_time(j) < end]
        g = sum(u.grams_used for j in sel for u in j.usages)
        cost = sum(j.total_cost for j in sel)
        return {"drucke": len(sel), "gramm": _r(g, 1), "kosten": _r(cost),
                "stunden": _r(sum((j.duration_seconds or 0) for j in sel) / 3600, 1)}

    zeitraum = {}
    for d in PERIODS:
        cur, prev = _window(d), _window(d, d)
        cur["drucke_vorher"] = prev["drucke"]
        cur["gramm_vorher"] = prev["gramm"]
        cur["gramm_woche"] = _r(cur["gramm"] / d * 7, 1)
        cur["drucke_woche"] = _r(cur["drucke"] / d * 7, 1)
        zeitraum[str(d)] = cur

    # ── breakdowns ──────────────────────────────────────────────────────────
    def _count(key) -> list[dict]:
        c: dict[str, int] = defaultdict(int)
        for s in active:
            c[key(s)] += 1
        return [{"name": k, "anzahl": v} for k, v in sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))]

    colours: dict[str, dict] = {}
    for s in active:
        e = colours.setdefault(s.color_name or "?", {"name": s.color_name or "?", "hex": s.color_hex or "#888888", "anzahl": 0})
        e["anzahl"] += 1
    nach_farbe = sorted(colours.values(), key=lambda e: (-e["anzahl"], e["name"]))[:TOP_N]

    moisture = {"trocken": 0, "gut": 0, "warnung": 0, "kritisch": 0, "trockner": 0, "unbekannt": 0}
    lvl_map = {"dry": "trocken", "good": "gut", "warning": "warnung", "critical": "kritisch", "drying": "trockner"}
    for s in with_filament:
        lvl = s.moisture.get("level")
        moisture[lvl_map.get(lvl, "unbekannt")] += 1

    locations: dict[str, dict] = {}
    for s in with_filament:
        name = s.storage_location or "ohne Lagerort"
        e = locations.setdefault(name, {"name": name, "anzahl": 0, "gramm": 0.0, "wert": 0.0})
        e["anzahl"] += 1
        e["gramm"] += s.current_weight_g
        e["wert"] += (s.cost_per_gram or 0) * s.current_weight_g
    lagerorte = [
        {**e, "gramm": _r(e["gramm"], 0), "wert": _r(e["wert"])}
        for e in sorted(locations.values(), key=lambda e: -e["anzahl"])
    ]

    low = sorted(
        (s for s in with_filament if s.remaining_pct < low_pct),
        key=lambda s: s.remaining_pct,
    )
    niedrig = [
        {"nummer": s.custom_id, "name": _spool_label(s), "hex": s.color_hex,
         "gramm": _r(s.current_weight_g, 0), "prozent": s.remaining_pct}
        for s in low
    ]

    # ── per spool usage ─────────────────────────────────────────────────────
    per_spool_g: dict[int, float] = defaultdict(float)
    per_spool_jobs: dict[int, set] = defaultdict(set)
    recent_g: dict[int, float] = defaultdict(float)
    since = now - timedelta(days=forecast_days)
    for j in jobs:
        for u in j.usages:
            if u.spool_id is None:
                continue
            per_spool_g[u.spool_id] += u.grams_used
            per_spool_jobs[u.spool_id].add(j.id)
            if _job_time(j) >= since:
                recent_g[u.spool_id] += u.grams_used
    by_id = {s.id: s for s in spools}

    top = sorted(per_spool_g.items(), key=lambda kv: -kv[1])[:TOP_N]
    top_filamente = [
        {"nummer": by_id[sid].custom_id, "name": _spool_label(by_id[sid]), "hex": by_id[sid].color_hex,
         "gramm": _r(g, 0), "drucke": len(per_spool_jobs[sid])}
        for sid, g in top if sid in by_id
    ]

    prognose = []
    for sid, g in recent_g.items():
        s = by_id.get(sid)
        if not s or s.archived or g <= 0:
            continue
        per_week = g / forecast_days * 7
        weeks = s.current_weight_g / per_week if per_week else None
        empty = today + timedelta(days=round(weeks * 7)) if weeks is not None else None
        prognose.append({
            "nummer": s.custom_id, "name": _spool_label(s), "hex": s.color_hex,
            "rest_g": _r(s.current_weight_g, 0), "g_woche": _r(per_week, 1),
            "wochen": _r(weeks, 1), "leer_am": empty.isoformat() if empty else None,
        })
    prognose.sort(key=lambda p: p["wochen"])

    # ── months (last 12, local time) and weekdays ──────────────────────────
    months: list[str] = []
    y, m = today.year, today.month
    for _ in range(12):
        months.append(f"{y:04d}-{m:02d}")
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
    months.reverse()
    mon = {k: {"monat": k, "drucke": 0, "gramm": 0.0, "stunden": 0.0, "material": 0.0,
               "strom": 0.0, "abnutzung": 0.0, "ausgaben": 0.0} for k in months}
    weekdays = [0] * 7
    for j in finished:
        loc = _to_local(j.finished_at, tz)
        weekdays[loc.weekday()] += 1
        e = mon.get(f"{loc.year:04d}-{loc.month:02d}")
        if e is None:
            continue
        e["drucke"] += 1
        e["gramm"] += j.total_grams
        e["stunden"] += (j.duration_seconds or 0) / 3600
        e["material"] += j.material_cost
        e["strom"] += j.energy_cost or 0
        e["abnutzung"] += j.wear_cost or 0
    for s in spools:
        if s.purchased_at and s.purchase_price:
            loc = _to_local(s.purchased_at, tz)
            e = mon.get(f"{loc.year:04d}-{loc.month:02d}")
            if e is not None:
                e["ausgaben"] += s.purchase_price
    monate = [
        {**e, "gramm": _r(e["gramm"], 0), "stunden": _r(e["stunden"], 1), "material": _r(e["material"]),
         "strom": _r(e["strom"]), "abnutzung": _r(e["abnutzung"]), "ausgaben": _r(e["ausgaben"])}
        for e in mon.values()
    ]

    # ── costs ───────────────────────────────────────────────────────────────
    c = counters(db)
    lager_gesamt = sum((s.purchase_price or 0) for s in spools)
    brand_price: dict[str, list[float]] = defaultdict(list)
    for s in spools:
        if s.cost_per_gram:
            brand_price[s.brand or "?"].append(s.cost_per_gram)
    preis_je_gramm = sorted(
        ({"name": b, "eur_g": round(sum(v) / len(v), 4), "spulen": len(v)} for b, v in brand_price.items()),
        key=lambda e: e["eur_g"],
    )

    return {
        "stand": now.replace(tzinfo=timezone.utc).isoformat(timespec="seconds"),
        "uebersicht": {
            "spulen": len(active),
            "spulen_mit_filament": len(with_filament),
            "gewicht_g": _r(sum(s.current_weight_g for s in with_filament), 0),
            "verbraucht_g": _r(total_g, 0),
            "drucke": len(finished),
            "stunden": _r(sum((j.duration_seconds or 0) for j in finished) / 3600, 1),
            "erfolgsquote": _r(len(ok_jobs) / len(finished) * 100, 1) if finished else None,
            "gramm_je_druck": _r(total_g / len(finished), 1) if finished else None,
        },
        "zeitraum": zeitraum,
        "bestand": status,
        "niedrig_ab_prozent": low_pct,
        "niedrig": niedrig,
        "feuchte": moisture,
        "nach_typ": _count(_type_label),
        "nach_hersteller": _count(lambda s: s.brand or "?"),
        "nach_farbe": nach_farbe,
        "lagerorte": lagerorte,
        "top_filamente": top_filamente,
        "prognose_tage": forecast_days,
        "prognose": prognose,
        "monate": monate,
        "wochentage": weekdays,
        "kosten": {
            "lager_gesamt": _r(lager_gesamt),
            "rest_wert": c["stock_value"],
            "verbraucht_wert": _r(lager_gesamt - c["stock_value"]),
            "material": c["cost_material"],
            "strom": c["cost_energy"],
            "abnutzung": c["cost_wear"],
            "gesamt": c["cost_total"],
            "je_druck": _r(c["cost_total"] / len(finished)) if finished else None,
            "preis_je_gramm": preis_je_gramm,
        },
    }
