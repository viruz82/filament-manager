"""Moisture estimate (dryness %) per spool, dryer workflow and storage changes."""
from datetime import timedelta
from types import SimpleNamespace

import pytest

from app import moisture
from app.models import PrinterConfig, Spool, UserPreferences
from app.util import utcnow
from tests.conftest import make_spool_payload


@pytest.fixture(autouse=True)
def _defaults():
    moisture.reset_config()
    yield
    moisture.reset_config()


def _spool(client, **kw):
    r = client.post("/api/spools", json=make_spool_payload(**kw))
    assert r.status_code == 201, r.text
    return r.json()


def _fake(material="PLA", packaging="open", days=0.0, ams_slot=None, **kw):
    now = utcnow()
    return SimpleNamespace(
        material=material, packaging=packaging, ams_slot=ams_slot,
        last_dried_at=now - timedelta(days=days) if days is not None else None,
        is_drying=False, drying_started_at=None,
        moisture_anchor_at=None, moisture_anchor_pct=None, **kw,
    ), now


# ── formula ──────────────────────────────────────────────────────────────────

def test_formula_matches_spooly_example():
    # PLA+ open on the shelf, dried 19 days ago → 100 − 19 × 1 × 1 × 3 = 43 %
    s, now = _fake(material="PLA+", days=19)
    assert moisture.dryness_pct(s, now) == 43.0
    assert moisture.level_for(43.0) == "warning"


def test_storage_and_material_factors():
    s, now = _fake(material="PETG", packaging="drybox", days=10)
    # 100 − 10 × 2 × 0.15 × 3 = 91
    assert moisture.dryness_pct(s, now) == 91.0
    s, now = _fake(material="PLA", packaging="open", days=10, ams_slot="A1:ams1_tray1")
    # in the AMS the AMS factor (0.3) applies: 100 − 10 × 0.3 × 3 = 91
    assert moisture.dryness_pct(s, now) == 91.0


def test_unknown_material_and_packaging_use_defaults():
    s, now = _fake(material="Exotic", packaging=None, days=10)
    # 100 − 10 × 2 × 0.7 × 3 = 58
    assert moisture.dryness_pct(s, now) == 58.0


def test_material_match_prefers_longest_key():
    assert moisture.material_factor("PLA+") == 1
    assert moisture.material_factor("pla silk") == 1
    assert moisture.material_factor("PA12") == 4


def test_floor_at_zero_and_unknown_without_date():
    s, now = _fake(days=100)
    assert moisture.dryness_pct(s, now) == 0.0
    s, now = _fake(days=None)
    assert moisture.info(s, now)["level"] == "unknown"


def test_levels_follow_thresholds():
    assert moisture.level_for(85) == "dry"
    assert moisture.level_for(60) == "good"
    assert moisture.level_for(50) == "good"
    assert moisture.level_for(49.9) == "warning"
    assert moisture.level_for(25) == "warning"
    assert moisture.level_for(24.9) == "critical"
    assert moisture.level_for(None, is_drying=True) == "drying"


def test_storage_change_keeps_reached_value():
    s, now = _fake(material="PLA", packaging="open", days=10)    # 70 %
    moisture.set_packaging(s, "vacuum", now)
    assert s.moisture_anchor_pct == 70.0
    # 10 more days in vacuum: 70 − 10 × 0.05 × 3 = 68.5
    assert moisture.dryness_pct(s, now + timedelta(days=10)) == 68.5


def test_loading_original_spool_opens_it():
    s, now = _fake(packaging="original", days=1)
    moisture.set_ams_slot(s, "A1:ams1_tray1", now)
    assert s.packaging == "open"
    assert s.moisture_anchor_pct is not None


# ── API ──────────────────────────────────────────────────────────────────────

def test_spool_out_has_moisture(client):
    s = _spool(client, material="PLA", packaging="open",
               last_dried_at=(utcnow() - timedelta(days=19)).isoformat())
    assert s["packaging"] == "open"
    assert s["moisture"]["pct"] == 43.0
    assert s["moisture"]["level"] == "warning"
    assert s["moisture"]["storage"] == "open"


def test_spool_without_dry_date_is_unknown(client):
    s = _spool(client)
    assert s["moisture"] == {"pct": None, "level": "unknown", "storage": "unknown", "days_since_dried": None}


def test_invalid_packaging_rejected(client):
    r = client.post("/api/spools", json=make_spool_payload(packaging="bag"))
    assert r.status_code == 422


def test_dryer_workflow(client):
    s = _spool(client, last_dried_at=(utcnow() - timedelta(days=30)).isoformat(), packaging="open")
    assert s["moisture"]["level"] == "critical"
    r = client.post(f"/api/spools/{s['id']}/drying/start")
    assert r.status_code == 200
    body = r.json()
    assert body["is_drying"] is True
    assert body["moisture"]["level"] == "drying"
    assert body["moisture"]["pct"] is None
    r = client.post(f"/api/spools/{s['id']}/drying/finish")
    body = r.json()
    assert body["is_drying"] is False
    assert body["moisture"]["pct"] == 100.0
    assert body["moisture"]["level"] == "dry"
    actions = [a["action"] for a in client.get(f"/api/spools/{s['id']}/audit").json()]
    assert actions[:2] == ["dried", "drying_start"]


def test_drying_cancel_restores_previous_estimate(client):
    s = _spool(client, last_dried_at=(utcnow() - timedelta(days=19)).isoformat(), packaging="open")
    client.post(f"/api/spools/{s['id']}/drying/start")
    body = client.post(f"/api/spools/{s['id']}/drying/cancel").json()
    assert body["is_drying"] is False
    assert body["moisture"]["pct"] == 43.0


def test_mark_dry(client):
    s = _spool(client)
    body = client.post(f"/api/spools/{s['id']}/mark-dry").json()
    assert body["moisture"]["pct"] == 100.0
    assert body["last_dried_at"] is not None


def test_patch_packaging_anchors(client, session):
    s = _spool(client, last_dried_at=(utcnow() - timedelta(days=10)).isoformat(), packaging="open")
    r = client.patch(f"/api/spools/{s['id']}", json={"packaging": "drybox"})
    assert r.status_code == 200
    spool = session.get(Spool, s["id"])
    session.refresh(spool)
    assert spool.moisture_anchor_pct == pytest.approx(70.0, abs=0.1)
    assert r.json()["moisture"]["storage"] == "drybox"


def test_patch_last_dried_resets_anchor(client, session):
    s = _spool(client, last_dried_at=(utcnow() - timedelta(days=10)).isoformat(), packaging="open")
    client.patch(f"/api/spools/{s['id']}", json={"packaging": "drybox"})
    r = client.patch(f"/api/spools/{s['id']}", json={"last_dried_at": utcnow().isoformat()})
    assert r.json()["moisture"]["pct"] == pytest.approx(100.0, abs=0.1)


def test_form_save_with_same_day_keeps_time_and_anchor(client, session):
    # the spool form sends last_dried_at as a plain date on every save
    dried = utcnow() - timedelta(days=10)
    s = _spool(client, last_dried_at=dried.isoformat(), packaging="open")
    client.patch(f"/api/spools/{s['id']}", json={"packaging": "drybox"})
    r = client.patch(f"/api/spools/{s['id']}", json={"notes": "x", "packaging": "drybox",
                                                      "last_dried_at": dried.date().isoformat()})
    spool = session.get(Spool, s["id"])
    session.refresh(spool)
    assert spool.last_dried_at == dried
    assert spool.moisture_anchor_pct == pytest.approx(70.0, abs=0.1)
    assert r.json()["moisture"]["pct"] == pytest.approx(70.0, abs=0.1)


def test_ams_assign_switches_storage_and_keeps_value(client, session):
    session.add(PrinterConfig(id=1, name="A1", ams_unit_count=1))
    session.commit()
    a = _spool(client, last_dried_at=(utcnow() - timedelta(days=10)).isoformat(), packaging="original")
    b = _spool(client, last_dried_at=(utcnow() - timedelta(days=10)).isoformat(), packaging="open")
    client.post("/api/printers/1/ams/ams1_tray1/assign", json={"spool_id": a["id"]})
    got = client.get(f"/api/spools/{a['id']}").json()
    assert got["packaging"] == "open"           # loaded → opened
    assert got["moisture"]["storage"] == "ams"
    # b takes the tray: a leaves the AMS and keeps its reached value
    client.post("/api/printers/1/ams/ams1_tray1/assign", json={"spool_id": b["id"]})
    spool_a = session.get(Spool, a["id"])
    session.refresh(spool_a)
    assert spool_a.ams_slot is None
    assert spool_a.moisture_anchor_pct is not None


def test_thresholds_from_prefs(client):
    r = client.post("/api/settings/user-prefs", json={
        "low_stock_threshold_pct": 25, "almost_empty_threshold_pct": 8,
        "moisture_warning_pct": 60, "moisture_critical_pct": 30,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["almost_empty_threshold_pct"] == 8
    assert body["moisture_warning_pct"] == 60
    assert moisture.level_for(55) == "warning"
    assert moisture.level_for(29) == "critical"


def test_factor_overrides(client):
    r = client.put("/api/settings/moisture", json={"material_factors": {"PLA": 2}, "storage_factors": {"open": 0.5}})
    assert r.status_code == 200
    cfg = client.get("/api/settings/moisture").json()
    assert cfg["material_factors"] == {"PLA": 2.0}
    assert cfg["storage_factors"]["open"] == 0.5
    assert cfg["storage_factors"]["vacuum"] == 0.05      # untouched defaults stay
    # reset to defaults
    cfg = client.put("/api/settings/moisture", json={}).json()
    assert cfg["material_factors"]["PETG"] == 2


def test_ha_sensor_lists_moist_spools(client, session):
    from app import ha_publisher
    _spool(client, color_name="Wet", last_dried_at=(utcnow() - timedelta(days=30)).isoformat(), packaging="open")
    _spool(client, color_name="Dry", last_dried_at=utcnow().isoformat(), packaging="open")
    drying = _spool(client, color_name="InDryer", last_dried_at=(utcnow() - timedelta(days=30)).isoformat())
    client.post(f"/api/spools/{drying['id']}/drying/start")
    values = ha_publisher._compute(session)
    state, attrs = values["sensor.filament_manager_moisture_spools"]
    assert state == 1
    assert attrs["spools"][0]["level"] == "critical"
    assert attrs["critical"] == 1
    assert attrs["drying"] == 1


def test_ha_low_stock_has_almost_empty(client, session):
    from app import ha_publisher
    session.add(UserPreferences(id=1, low_stock_threshold_pct=25, almost_empty_threshold_pct=8))
    session.commit()
    _spool(client, color_name="Low", initial_weight_g=1000, current_weight_g=200)
    _spool(client, color_name="AlmostEmpty", initial_weight_g=1000, current_weight_g=50)
    _, attrs = ha_publisher._compute(session)["sensor.filament_manager_low_stock_spools"]
    assert len(attrs["spools"]) == 2
    assert len(attrs["almost_empty"]) == 1
    assert "AlmostEmpty" in attrs["almost_empty"][0]


def test_patch_sets_moisture_state_for_migration(client):
    s = _spool(client, packaging="open")
    anchor = (utcnow() - timedelta(days=5)).isoformat()
    r = client.patch(f"/api/spools/{s['id']}", json={
        "last_dried_at": (utcnow() - timedelta(days=40)).isoformat(),
        "moisture_anchor_at": anchor, "moisture_anchor_pct": 100,
    })
    body = r.json()
    # anchor wins over the drying date: 100 − 5 × 1 × 1 × 3 = 85
    assert body["moisture"]["pct"] == pytest.approx(85.0, abs=0.1)
    assert body["moisture"]["days_since_dried"] == pytest.approx(40, abs=0.1)
    r = client.patch(f"/api/spools/{s['id']}", json={"is_drying": True})
    assert r.json()["moisture"]["level"] == "drying"
