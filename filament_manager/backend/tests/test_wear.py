"""Printer wear cost (€ per print hour) on print jobs, projects and dashboard."""
from tests.conftest import make_spool_payload


def _printer(client, rate=0.2, name="A1"):
    r = client.post("/api/printers", json={"name": name, "wear_cost_per_hour": rate})
    assert r.status_code == 201
    return r.json()


def _print(client, printer_name="A1", seconds=7200, **extra):
    body = {"name": "Benchy", "started_at": "2026-11-01T10:00:00",
            "duration_seconds": seconds, "printer_name": printer_name, **extra}
    r = client.post("/api/prints", json=body)
    assert r.status_code == 201
    return r.json()


def test_printer_stores_rate(client):
    p = _printer(client, rate=0.2)
    assert p["wear_cost_per_hour"] == 0.2
    r = client.patch(f"/api/printers/{p['id']}", json={"name": "A1", "wear_cost_per_hour": 0.35})
    assert r.json()["wear_cost_per_hour"] == 0.35


def test_negative_rate_rejected(client):
    r = client.post("/api/printers", json={"name": "A1", "wear_cost_per_hour": -1})
    assert r.status_code == 422


def test_manual_print_gets_wear_cost(client):
    _printer(client, rate=0.2)
    job = _print(client, seconds=7200)
    assert job["wear_cost"] == 0.4
    assert job["total_cost"] == 0.4


def test_wear_cost_added_to_material_cost(client):
    _printer(client, rate=0.2)
    spool = client.post("/api/spools", json=make_spool_payload(purchase_price=20.0)).json()
    job = _print(client, seconds=3600, usages=[{"spool_id": spool["id"], "grams_used": 100}])
    # 100 g × 0.02 €/g = 2.00 € material + 0.20 € wear
    assert abs(job["total_cost"] - 2.2) < 1e-6


def test_no_rate_no_wear_cost(client):
    _printer(client, rate=None)
    job = _print(client)
    assert job["wear_cost"] is None


def test_unknown_printer_no_wear_cost(client):
    _printer(client, rate=0.2)
    job = _print(client, printer_name="Other")
    assert job["wear_cost"] is None


def test_update_duration_recomputes(client):
    _printer(client, rate=0.2)
    job = _print(client, seconds=3600)
    r = client.patch(f"/api/prints/{job['id']}", json={"duration_seconds": 1800})
    assert r.json()["wear_cost"] == 0.1


def test_update_other_field_keeps_stored_cost(client):
    p = _printer(client, rate=0.2)
    job = _print(client, seconds=3600)
    client.patch(f"/api/printers/{p['id']}", json={"name": "A1", "wear_cost_per_hour": 1.0})
    r = client.patch(f"/api/prints/{job['id']}", json={"notes": "x"})
    assert r.json()["wear_cost"] == 0.2


def test_recalculate_applies_new_rate(client):
    p = _printer(client, rate=0.2)
    _print(client, seconds=3600)
    _print(client, seconds=7200)
    _print(client, printer_name="Other", seconds=3600)
    client.patch(f"/api/printers/{p['id']}", json={"name": "A1", "wear_cost_per_hour": 0.5})
    r = client.post(f"/api/printers/{p['id']}/recalculate-wear")
    assert r.status_code == 200
    assert r.json() == {"updated": 2, "total_wear_cost": 1.5}


def test_dashboard_total_includes_wear(client):
    _printer(client, rate=0.2)
    _print(client, seconds=3600 * 5)
    r = client.get("/api/dashboard")
    assert r.json()["total_print_cost_eur"] == 1.0


def test_project_totals_include_wear(client, session):
    from app.models import PrintJob, Project
    from app.routers.projects import _project_out
    _printer(client, rate=0.2)
    proj = Project(name="P")
    session.add(proj)
    session.commit()
    for _ in range(2):
        job = _print(client, seconds=3600)
        session.get(PrintJob, job["id"]).fm_project_id = proj.id
    session.commit()
    session.refresh(proj)
    out = _project_out(proj)
    assert out.total_wear_cost == 0.4
    assert abs(out.total_cost - 0.4) < 1e-6
