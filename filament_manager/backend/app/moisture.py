"""Estimated filament dryness ("moisture") per spool.

Nothing is measured: the value is an estimate from material, storage and the
time since the spool was last dried.

    dryness % = start % − days × material factor × storage factor × multiplier

* start % is 100 after drying. When the storage changes (packaging edited,
  spool loaded into / taken out of the AMS) the reached value is kept as an
  anchor (moisture_anchor_pct at moisture_anchor_at) and only the rate changes
  from then on — a storage change never alters the past.
* Without a drying date the level is "unknown" (no guessing).
* A spool in the dryer has level "drying" and no percentage.

Levels: dry ≥ 80, good ≥ warning threshold, warning ≥ critical threshold,
critical below. Thresholds are user preferences (default 50 / 25).
"""
from __future__ import annotations

from datetime import datetime

from .util import utcnow

# Storage types the user can pick per spool ("packaging"). "ams" is not a
# packaging but the effective storage while the spool sits in an AMS tray.
PACKAGING_TYPES = ("open", "original", "sealed", "vacuum", "drybox")

DEFAULT_MATERIAL_FACTORS: dict[str, float] = {
    "PLA": 1, "PLA+": 1, "PLA Silk": 1, "PLA Matte": 1,
    "ABS": 1, "ASA": 1, "HIPS": 1.5, "Metal": 1.5,
    "PETG": 2, "Carbon": 2, "PC": 2.5, "Wood": 2.5,
    "TPU": 3, "TPE": 3, "PA12": 4, "Nylon": 4.5, "PA": 4.5, "PA6": 4.5,
    "PVA": 5,
}
DEFAULT_MATERIAL_FACTOR = 2.0

DEFAULT_STORAGE_FACTORS: dict[str, float] = {
    "vacuum": 0.05, "drybox": 0.15, "ams": 0.3, "sealed": 0.4,
    "original": 0.6, "open": 1.0, "unknown": 0.7,
}
MULTIPLIER = 3.0
DRY_MIN_PCT = 80

DEFAULT_WARNING_PCT = 50
DEFAULT_CRITICAL_PCT = 25

# Active configuration — replaced from UserPreferences at startup and whenever
# the settings are saved (see load_from_prefs). Tests use the defaults.
_config: dict = {}


def reset_config() -> None:
    _config.clear()
    _config.update(
        material_factors=dict(DEFAULT_MATERIAL_FACTORS),
        storage_factors=dict(DEFAULT_STORAGE_FACTORS),
        warning_pct=DEFAULT_WARNING_PCT,
        critical_pct=DEFAULT_CRITICAL_PCT,
    )


reset_config()


def get_config() -> dict:
    return {
        "material_factors": dict(_config["material_factors"]),
        "storage_factors": dict(_config["storage_factors"]),
        "default_material_factor": DEFAULT_MATERIAL_FACTOR,
        "multiplier": MULTIPLIER,
        "warning_pct": _config["warning_pct"],
        "critical_pct": _config["critical_pct"],
    }


def load_from_prefs(prefs) -> None:
    """Apply the user's moisture settings (None → defaults)."""
    reset_config()
    if prefs is None:
        return
    if getattr(prefs, "moisture_material_factors", None):
        _config["material_factors"] = {
            str(k): float(v) for k, v in prefs.moisture_material_factors.items()
        }
    if getattr(prefs, "moisture_storage_factors", None):
        merged = dict(DEFAULT_STORAGE_FACTORS)
        merged.update({str(k): float(v) for k, v in prefs.moisture_storage_factors.items()})
        _config["storage_factors"] = merged
    if getattr(prefs, "moisture_warning_pct", None) is not None:
        _config["warning_pct"] = prefs.moisture_warning_pct
    if getattr(prefs, "moisture_critical_pct", None) is not None:
        _config["critical_pct"] = prefs.moisture_critical_pct


def material_factor(material: str | None) -> float:
    """Exact match first, then case-insensitive containment either way."""
    factors = _config["material_factors"]
    if not material:
        return DEFAULT_MATERIAL_FACTOR
    if material in factors:
        return factors[material]
    up = material.upper()
    # Prefer the longest matching key so "PLA+" never falls back to "PA".
    best: tuple[int, float] | None = None
    for key, val in factors.items():
        k = key.upper()
        if k in up or up in k:
            if best is None or len(k) > best[0]:
                best = (len(k), val)
    return best[1] if best else DEFAULT_MATERIAL_FACTOR


def effective_storage(spool) -> str:
    """Storage that drives the rate: the AMS while loaded, else the packaging."""
    if getattr(spool, "ams_slot", None):
        return "ams"
    return spool.packaging or "unknown"


def storage_factor(storage: str) -> float:
    factors = _config["storage_factors"]
    return factors.get(storage, factors.get("unknown", DEFAULT_STORAGE_FACTORS["unknown"]))


def _days(since: datetime, now: datetime) -> float:
    return max(0.0, (now - since).total_seconds() / 86400)


def dryness_pct(spool, now: datetime | None = None) -> float | None:
    """Current estimated dryness in %, or None when unknown / drying."""
    if getattr(spool, "is_drying", False):
        return None
    now = now or utcnow()
    if spool.moisture_anchor_at is not None and spool.moisture_anchor_pct is not None:
        start, since = spool.moisture_anchor_pct, spool.moisture_anchor_at
    elif spool.last_dried_at is not None:
        start, since = 100.0, spool.last_dried_at
    else:
        return None
    rate = material_factor(spool.material) * storage_factor(effective_storage(spool)) * MULTIPLIER
    return round(max(0.0, min(100.0, start - _days(since, now) * rate)), 1)


def level_for(pct: float | None, is_drying: bool = False) -> str:
    if is_drying:
        return "drying"
    if pct is None:
        return "unknown"
    if pct >= DRY_MIN_PCT:
        return "dry"
    if pct >= _config["warning_pct"]:
        return "good"
    if pct >= _config["critical_pct"]:
        return "warning"
    return "critical"


def info(spool, now: datetime | None = None) -> dict:
    now = now or utcnow()
    drying = bool(getattr(spool, "is_drying", False))
    pct = dryness_pct(spool, now)
    return {
        "pct": pct,
        "level": level_for(pct, drying),
        "storage": effective_storage(spool),
        "days_since_dried": round(_days(spool.last_dried_at, now), 1) if spool.last_dried_at else None,
    }


def anchor(spool, now: datetime | None = None) -> None:
    """Freeze the reached value before the storage (and so the rate) changes."""
    now = now or utcnow()
    pct = dryness_pct(spool, now)
    if pct is None:
        return
    spool.moisture_anchor_pct = pct
    spool.moisture_anchor_at = now


def set_ams_slot(spool, slot: str | None, now: datetime | None = None) -> None:
    """Change the AMS slot, keeping the dryness value continuous.

    Loading an originally sealed spool opens it, so its packaging becomes "open".
    """
    if (spool.ams_slot or None) == (slot or None):
        spool.ams_slot = slot
        return
    if bool(spool.ams_slot) != bool(slot):
        anchor(spool, now)
    if slot and spool.packaging == "original":
        spool.packaging = "open"
    spool.ams_slot = slot


def set_packaging(spool, packaging: str | None, now: datetime | None = None) -> None:
    if (spool.packaging or None) == (packaging or None):
        return
    if not spool.ams_slot:      # while in the AMS the packaging does not drive the rate
        anchor(spool, now)
    spool.packaging = packaging


def mark_dry(spool, when: datetime | None = None) -> None:
    spool.last_dried_at = when or utcnow()
    spool.is_drying = False
    spool.drying_started_at = None
    spool.moisture_anchor_at = None
    spool.moisture_anchor_pct = None
