"""Home Assistant Supervisor API client.

Only the Supervisor-level helpers remain here — language/timezone detection,
connectivity check, and sensor-state push.
"""
import logging
import os
import re
import httpx

log = logging.getLogger(__name__)

HA_API = "http://supervisor/core/api"
_TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {_TOKEN}",
        "Content-Type": "application/json",
    }


async def is_ha_available() -> bool:
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(f"{HA_API}/", headers=_headers())
            return r.status_code == 200
    except Exception:
        return False


async def get_ha_state(entity_id: str) -> float | None:
    """Read a numeric sensor state from HA. Returns None if unavailable or non-numeric."""
    if not _TOKEN:
        return None
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{HA_API}/states/{entity_id}", headers=_headers())
            if r.status_code != 200:
                log.warning("get_ha_state %s → HTTP %d", entity_id, r.status_code)
                return None
            state = r.json().get("state", "")
            return float(state)
    except (ValueError, TypeError):
        log.debug("get_ha_state %s: non-numeric state", entity_id)
        return None
    except Exception as exc:
        log.debug("get_ha_state %s failed: %s", entity_id, exc)
        return None


async def delete_ha_state(entity_id: str) -> bool:
    """DELETE a sensor entity from the HA states API. Returns True on success."""
    if not _TOKEN:
        return False
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.delete(f"{HA_API}/states/{entity_id}", headers=_headers())
            return r.status_code in (200, 204)
    except Exception as exc:
        log.warning("delete_ha_state %s failed: %s", entity_id, exc)
        return False


async def push_ha_state(entity_id: str, state: int | str, attributes: dict) -> bool:
    """POST a sensor state to the HA states API. Returns True on success."""
    if not _TOKEN:
        log.warning("push_ha_state: SUPERVISOR_TOKEN is not set — cannot push %s", entity_id)
        return False
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.post(
                f"{HA_API}/states/{entity_id}",
                headers=_headers(),
                json={"state": str(state), "attributes": attributes},
            )
            if r.status_code not in (200, 201):
                log.warning("push_ha_state %s → HTTP %d", entity_id, r.status_code)
                return False
        return True
    except Exception as exc:
        log.warning("push_ha_state %s failed: %s", entity_id, exc)
        return False


_ENERGY_UNITS = {"kwh", "wh", "mwh"}
_PRICE_WORDS = ("preis", "price", "tarif", "kwh")
_PERIOD_RE = re.compile(r"(^|_)(today|daily|weekly|monthly|yearly|quarterly|heute|tag|woche|monat|jahr)(_|$)")


def _is_periodic_meter(entity_id: str, attrs: dict) -> bool:
    """Daily/weekly/monthly/yearly counters reset and would lose the energy of a print that crosses the reset."""
    if any(k in attrs for k in ("meter_period", "cycle", "last_period")):
        return True
    return bool(_PERIOD_RE.search(entity_id.split(".", 1)[1]))


def filter_ha_entities(states: list[dict], kind: str) -> list[dict]:
    """Pick the entities that make sense for a settings field.

    kind "energy": cumulative energy meters (state class total/total_increasing, unit kWh/Wh/MWh),
    without daily/weekly/monthly/yearly counters.
    kind "price":  price sensors (unit …/kWh) and number helpers whose name looks like a price.
    Only entities with a numeric state are returned, sorted by entity id.
    """
    out: list[dict] = []
    for s in states:
        entity_id = s.get("entity_id", "")
        domain = entity_id.split(".", 1)[0]
        if domain not in ("sensor", "input_number", "number"):
            continue
        try:
            float(s.get("state", ""))
        except (ValueError, TypeError):
            continue
        attrs = s.get("attributes") or {}
        unit = str(attrs.get("unit_of_measurement") or "")
        device_class = attrs.get("device_class")
        if kind == "energy":
            ok = (
                domain == "sensor"
                and (device_class == "energy" or unit.lower() in _ENERGY_UNITS)
                and attrs.get("state_class") in ("total", "total_increasing")
                and not _is_periodic_meter(entity_id, attrs)
            )
        elif kind == "price":
            low = unit.lower()
            if domain == "sensor":
                # price per kWh (EUR/kWh, ct/kWh) — not CO2 intensity or plain costs
                ok = "/kwh" in low and "co2" not in low
            else:
                # number helpers have no unit: only those that look like a price
                ident = (entity_id + " " + str(attrs.get("friendly_name") or "")).lower()
                ok = "/kwh" in low or any(w in ident for w in _PRICE_WORDS)
        else:
            ok = False
        if ok:
            out.append({
                "entity_id": entity_id,
                "name": attrs.get("friendly_name") or entity_id,
                "value": s.get("state"),
                "unit": unit,
            })
    out.sort(key=lambda e: e["entity_id"])
    return out


async def list_ha_entities(kind: str) -> list[dict]:
    """Return suggestion entities for a settings field (empty list if HA is unreachable)."""
    if not _TOKEN:
        return []
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{HA_API}/states", headers=_headers())
            if r.status_code != 200:
                log.warning("list_ha_entities → HTTP %d", r.status_code)
                return []
            return filter_ha_entities(r.json(), kind)
    except Exception as exc:
        log.debug("list_ha_entities failed: %s", exc)
        return []
