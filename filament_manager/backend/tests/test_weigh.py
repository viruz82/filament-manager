"""POST /api/spools/{id}/weigh — remaining filament from a scale reading."""
from app.models import BrandSpoolWeight
from tests.conftest import make_spool_payload


def _spool(client, **kw):
    r = client.post("/api/spools", json=make_spool_payload(**kw))
    assert r.status_code == 201
    return r.json()


def test_weigh_uses_own_tare(client):
    s = _spool(client, brand="SUNLU", spool_weight_g=128.0, current_weight_g=1000)
    r = client.post(f"/api/spools/{s['id']}/weigh", json={"gross_g": 628})
    assert r.status_code == 200
    assert r.json()["current_weight_g"] == 500.0


def test_weigh_falls_back_to_brand_tare(client, session):
    s = _spool(client, brand="NoTare")
    session.add(BrandSpoolWeight(brand="NoTare", spool_weight_g=200.0))
    session.commit()
    r = client.post(f"/api/spools/{s['id']}/weigh", json={"gross_g": 700})
    assert r.json()["current_weight_g"] == 500.0


def test_weigh_floors_at_zero(client):
    s = _spool(client, spool_weight_g=250.0)
    r = client.post(f"/api/spools/{s['id']}/weigh", json={"gross_g": 100})
    assert r.json()["current_weight_g"] == 0.0


def test_weigh_writes_audit(client):
    s = _spool(client, spool_weight_g=200.0, current_weight_g=800)
    client.post(f"/api/spools/{s['id']}/weigh", json={"gross_g": 900})
    audit = client.get(f"/api/spools/{s['id']}/audit").json()
    assert audit[0]["action"] == "weigh"
    assert audit[0]["delta_g"] == -100.0
    assert audit[0]["weight_before"] == 800.0
    assert audit[0]["weight_after"] == 700.0


def test_weigh_rejects_negative(client):
    s = _spool(client)
    r = client.post(f"/api/spools/{s['id']}/weigh", json={"gross_g": -1})
    assert r.status_code == 422


def test_weigh_unknown_spool(client):
    r = client.post("/api/spools/9999/weigh", json={"gross_g": 500})
    assert r.status_code == 404
