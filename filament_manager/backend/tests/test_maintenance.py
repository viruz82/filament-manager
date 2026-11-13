"""Maintenance log (Wartungsbuch): tasks by print hours, days or grams."""
from datetime import datetime, timedelta

from app import maintenance
from app.models import MaintenanceTask, PrintJob
from app.util import utcnow
from tests.conftest import make_spool_payload


def _printer(client, name="A1"):
    r = client.post("/api/printers", json={"name": name})
    assert r.status_code == 201
    return r.json()


def _print(client, finished: datetime, seconds=3600, grams=0.0, printer_name="A1", spool_id=None):
    body = {"name": "Benchy", "started_at": (finished - timedelta(seconds=seconds)).isoformat(),
            "finished_at": finished.isoformat(), "duration_seconds": seconds,
            "printer_name": printer_name}
    if grams and spool_id:
        body["usages"] = [{"spool_id": spool_id, "grams_used": grams}]
    r = client.post("/api/prints", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _task(client, **kw):
    body = {"name": "Düse reinigen", **kw}
    r = client.post("/api/maintenance", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_new_task_starts_at_zero(client):
    t = _task(client, interval_hours=100)
    assert t["hours_since"] == 0
    assert t["pct"] == 0
    assert t["level"] == "ok"
    assert t["hours_left"] == 100


def test_hours_and_grams_count_only_after_last_done(client):
    spool = client.post("/api/spools", json=make_spool_payload()).json()
    start = utcnow() - timedelta(days=10)
    _print(client, start - timedelta(days=1), seconds=36000, grams=500, spool_id=spool["id"])  # before → ignored
    t = _task(client, interval_hours=10, interval_grams=1000, last_done_at=start.isoformat())
    _print(client, start + timedelta(days=1), seconds=3600 * 4, grams=200, spool_id=spool["id"])
    t = client.get("/api/maintenance").json()[0]
    assert t["hours_since"] == 4
    assert t["grams_since"] == 200
    assert t["pct"] == 40          # hours 40 % beats grams 20 %
    assert t["level"] == "ok"


def test_first_limit_wins_and_levels(client):
    start = utcnow() - timedelta(days=28)
    t = _task(client, interval_days=30, interval_hours=1000, last_done_at=start.isoformat())
    assert t["level"] == "soon"    # 28/30 days = 93 %
    t = client.patch(f"/api/maintenance/{t['id']}", json={"interval_days": 20}).json()
    assert t["level"] == "due"
    assert t["days_left"] < 0


def test_disabled_and_no_limit(client):
    t = _task(client)
    assert t["level"] == "none"
    t = client.patch(f"/api/maintenance/{t['id']}", json={"enabled": False, "interval_days": 1}).json()
    assert t["level"] == "off"


def test_printer_filter(client):
    p = _printer(client, "A1")
    _printer(client, "X1")
    start = utcnow() - timedelta(days=5)
    _task(client, interval_hours=10, printer_id=p["id"], last_done_at=start.isoformat())
    _print(client, start + timedelta(days=1), seconds=3600, printer_name="A1")
    _print(client, start + timedelta(days=2), seconds=7200, printer_name="X1")
    t = client.get("/api/maintenance").json()[0]
    assert t["hours_since"] == 1
    assert t["printer_name"] == "A1"


def test_done_resets_and_logs(client):
    start = utcnow() - timedelta(days=40)
    t = _task(client, interval_days=30, last_done_at=start.isoformat())
    _print(client, start + timedelta(days=1), seconds=7200)
    assert t["level"] == "due"
    r = client.post(f"/api/maintenance/{t['id']}/done", json={"note": "geölt"})
    assert r.status_code == 200
    out = r.json()
    assert out["task"]["level"] == "ok"
    assert out["task"]["hours_since"] == 0
    assert out["entry"]["hours_since"] == 2
    assert round(out["entry"]["days_since"]) == 40
    log = client.get(f"/api/maintenance/{t['id']}/log").json()
    assert len(log) == 1 and log[0]["note"] == "geölt"
    assert client.get("/api/maintenance").json()[0]["log_count"] == 1


def test_done_without_body_and_backdated_rejected(client):
    t = _task(client, interval_days=30)
    assert client.post(f"/api/maintenance/{t['id']}/done").status_code == 200
    old = (utcnow() - timedelta(days=3)).isoformat()
    assert client.post(f"/api/maintenance/{t['id']}/done", json={"done_at": old}).status_code == 400


def test_delete_log_entry_and_task(client):
    t = _task(client, interval_days=30)
    entry = client.post(f"/api/maintenance/{t['id']}/done").json()["entry"]
    assert client.delete(f"/api/maintenance/log/{entry['id']}").status_code == 204
    assert client.get(f"/api/maintenance/{t['id']}/log").json() == []
    client.post(f"/api/maintenance/{t['id']}/done")
    assert client.delete(f"/api/maintenance/{t['id']}").status_code == 204
    assert client.get("/api/maintenance").json() == []
    assert client.delete(f"/api/maintenance/{t['id']}").status_code == 404


def test_validation(client):
    assert client.post("/api/maintenance", json={"name": ""}).status_code == 422
    assert client.post("/api/maintenance", json={"name": "x", "interval_hours": 0}).status_code == 422
    assert client.post("/api/maintenance", json={"name": "x", "printer_id": 999}).status_code == 400
    t = _task(client)
    assert client.patch(f"/api/maintenance/{t['id']}", json={"last_done_at": None}).status_code == 400


def test_template_once_and_language(client):
    p = _printer(client)
    r = client.post("/api/maintenance/template?lang=de").json()
    assert r["created"] == len(maintenance.TEMPLATE_A1)
    names = {t["name"] for t in r["tasks"]}
    assert "Düse reinigen" in names
    assert all(t["printer_id"] == p["id"] for t in r["tasks"])
    fans = next(t for t in r["tasks"] if t["template_key"] == "fans")
    assert fans["enabled"] is False and fans["interval_days"] == 7
    ptfe = next(t for t in r["tasks"] if t["template_key"] == "ptfe")
    assert ptfe["interval_grams"] == 6000
    # second call adds nothing; a deleted template task comes back
    assert client.post("/api/maintenance/template?lang=en").json()["created"] == 0
    client.delete(f"/api/maintenance/{ptfe['id']}")
    again = client.post("/api/maintenance/template?lang=en").json()
    assert again["created"] == 1
    assert any(t["name"] == "Replace PTFE tube" for t in again["tasks"])


def test_sensor(session):
    now = utcnow()
    session.add_all([
        MaintenanceTask(name="due", interval_days=10, last_done_at=now - timedelta(days=11)),
        MaintenanceTask(name="soon", interval_days=10, last_done_at=now - timedelta(days=9.5)),
        MaintenanceTask(name="ok", interval_days=10, last_done_at=now - timedelta(days=1)),
        MaintenanceTask(name="off", interval_days=1, enabled=False, last_done_at=now - timedelta(days=5)),
    ])
    session.commit()
    state, attrs = maintenance.sensor(session, now)
    assert state == 1
    assert attrs["soon"] == 1
    assert [t["name"] for t in attrs["tasks"]] == ["due", "soon", "ok"]
    assert attrs["unit_of_measurement"] == "tasks"


def test_unfinished_print_not_counted(session):
    now = utcnow()
    session.add(MaintenanceTask(name="x", interval_hours=10, last_done_at=now - timedelta(days=2)))
    session.add(PrintJob(name="running", started_at=now - timedelta(hours=3), duration_seconds=3600))
    session.commit()
    hours, grams = maintenance.usage_since(session, now - timedelta(days=2))
    assert hours == 0 and grams == 0


def test_export_import_roundtrip(client, session):
    p = _printer(client)
    t = _task(client, interval_days=30, printer_id=p["id"])
    client.post(f"/api/maintenance/{t['id']}/done", json={"note": "ok"})
    bundle = client.get("/api/data/export").json()
    assert bundle["maintenance"][0]["name"] == "Düse reinigen"
    assert len(bundle["maintenance"][0]["log"]) == 1
    # same bundle again → nothing duplicated
    r = client.post("/api/data/import", json=bundle).json()
    assert r["imported"]["maintenance_tasks"] == 0
    # into an empty maintenance table → task and log restored
    client.delete(f"/api/maintenance/{t['id']}")
    r = client.post("/api/data/import", json=bundle).json()
    assert r["imported"]["maintenance_tasks"] == 1
    tasks = client.get("/api/maintenance").json()
    assert tasks[0]["log_count"] == 1 and tasks[0]["printer_name"] == "A1"
