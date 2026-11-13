"""
Estimated material price for usages without a spool.

Prints imported from Bambu Cloud history often carry grams per AMS slot but no
spool (the spool of that time is unknown).  Their material cost would be 0 €,
which makes old months look free.  Instead of changing any data we price such
usages with the average price per gram of the same material across all spools
that have a purchase price (archived ones included), falling back to the
average over all priced spools.  The material comes from the job's
``suggested_usages`` entry for the same AMS slot.

The averages are cached per database for a short time because ``PrintUsage.cost``
is evaluated many times per request.
"""
from __future__ import annotations

import time

from sqlalchemy.orm import Session

CACHE_SECONDS = 60
_ALL = "*"

_cache: dict[int, tuple[float, dict[str, float]]] = {}


def invalidate() -> None:
    _cache.clear()


def price_map(db: Session) -> dict[str, float]:
    """{MATERIAL (upper case): € per gram, "*": over all materials}."""
    key = id(db.get_bind())
    hit = _cache.get(key)
    now = time.monotonic()
    if hit and now - hit[0] < CACHE_SECONDS:
        return hit[1]
    from .models import Spool

    sums: dict[str, list[float]] = {}
    for price, weight, material in db.query(Spool.purchase_price, Spool.initial_weight_g, Spool.material):
        if not price or not weight or price <= 0 or weight <= 0:
            continue
        for k in ((material or "").strip().upper(), _ALL):
            e = sums.setdefault(k, [0.0, 0.0])
            e[0] += price
            e[1] += weight
    result = {k: p / w for k, (p, w) in sums.items() if k}
    _cache[key] = (now, result)
    return result


def usage_material(usage) -> str | None:
    """Material of a spool-less usage, taken from the job's cloud hints."""
    job = usage.print_job
    hints = (job.suggested_usages if job is not None else None) or []
    if not isinstance(hints, list):
        return None
    for h in hints:
        if isinstance(h, dict) and h.get("ams_slot") == usage.ams_slot and h.get("filament_type"):
            return str(h["filament_type"])
    if len(hints) == 1 and isinstance(hints[0], dict) and hints[0].get("filament_type"):
        return str(hints[0]["filament_type"])
    return None


def estimated_cost(usage, db: Session) -> float | None:
    prices = price_map(db)
    if not prices:
        return None
    material = (usage_material(usage) or "").strip().upper()
    per_gram = prices.get(material) or prices.get(_ALL)
    if not per_gram:
        return None
    return round(usage.grams_used * per_gram, 4)
