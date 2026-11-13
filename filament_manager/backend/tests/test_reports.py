"""Tests for price estimates (pricing.py) and the PDF reports (routers/reports.py)."""
from datetime import datetime, timedelta

import pytest

from app import pricing, statistics
from app.models import PrintJob, PrintUsage, Project, ProjectPrint, Spool, UserPreferences
from app.routers.reports import inventory_report, latin1, project_report

NOW = datetime(2026, 11, 13, 12, 0, 0)


def _spool(session, **kw) -> Spool:
    data = dict(brand="Sunlu", material="PLA", color_name="Schwarz", color_hex="#000000",
                initial_weight_g=1000.0, current_weight_g=800.0, purchase_price=20.0)
    data.update(kw)
    s = Spool(**data)
    session.add(s)
    session.commit()
    return s


def _job(session, *, spool=None, grams=10.0, slot="ams1_tray1", hint_type=None, hint_color="#FFFFFF",
         energy=0.1, wear=0.2, hours=1.0, project=None, days_ago=1, name="Teil"):
    end = NOW - timedelta(days=days_ago)
    j = PrintJob(name=name, started_at=end - timedelta(hours=hours), finished_at=end,
                 duration_seconds=int(hours * 3600), success=True, energy_cost=energy,
                 energy_kwh=(energy / 0.33 if energy is not None else None), wear_cost=wear,
                 printer_name="A1",
                 suggested_usages=([{"ams_slot": slot, "grams": grams, "filament_type": hint_type,
                                     "color": hint_color}] if hint_type else None),
                 fm_project_id=project.id if project else None)
    session.add(j)
    session.flush()
    session.add(PrintUsage(print_job_id=j.id, spool_id=spool.id if spool else None,
                           grams_used=grams, ams_slot=slot))
    session.commit()
    return j


class TestEstimates:
    def test_spool_less_usage_priced_with_material_average(self, session):
        _spool(session, material="PLA", purchase_price=20.0)               # 0.02 €/g
        _spool(session, material="PLA", purchase_price=30.0)               # 0.03 €/g → avg 0.025
        _spool(session, material="PETG", purchase_price=40.0)              # 0.04 €/g
        j = _job(session, grams=100, hint_type="PETG")
        u = j.usages[0]
        assert u.cost_estimated is True
        assert u.cost == pytest.approx(4.0)
        assert j.material_cost == pytest.approx(4.0)

    def test_unknown_material_falls_back_to_overall_average(self, session):
        _spool(session, material="PLA", purchase_price=20.0)
        _spool(session, material="PETG", purchase_price=40.0)
        j = _job(session, grams=100, hint_type="TPU")
        assert j.usages[0].cost == pytest.approx(3.0)                       # 60 € / 2000 g

    def test_no_hint_falls_back_to_overall_average(self, session):
        _spool(session, purchase_price=20.0)
        j = _job(session, grams=50)
        assert j.usages[0].cost == pytest.approx(1.0)

    def test_material_match_is_case_insensitive(self, session):
        _spool(session, material="petg", purchase_price=40.0)
        _spool(session, material="PLA", purchase_price=10.0)
        j = _job(session, grams=10, hint_type="PETG")
        assert j.usages[0].cost == pytest.approx(0.4)

    def test_spool_with_price_not_estimated(self, session):
        s = _spool(session, purchase_price=20.0)
        j = _job(session, spool=s, grams=100, hint_type="PETG")
        assert j.usages[0].cost_estimated is False
        assert j.usages[0].cost == pytest.approx(2.0)

    def test_spool_without_price_stays_none(self, session):
        _spool(session, purchase_price=20.0)
        s = _spool(session, purchase_price=None)
        j = _job(session, spool=s, grams=100)
        assert j.usages[0].cost_estimated is False
        assert j.usages[0].cost is None

    def test_no_priced_spools_gives_none(self, session):
        _spool(session, purchase_price=None)
        j = _job(session, grams=100, hint_type="PLA")
        assert j.usages[0].cost is None
        assert j.material_cost == 0

    def test_cache_is_invalidated(self, session):
        s = _spool(session, purchase_price=20.0)
        j = _job(session, grams=100)
        assert j.usages[0].cost == pytest.approx(2.0)
        s.purchase_price = 40.0
        session.commit()
        pricing.invalidate()
        assert j.usages[0].cost == pytest.approx(4.0)

    def test_statistics_include_estimate(self, session):
        session.add(UserPreferences(id=1, timezone_override="UTC"))
        s = _spool(session, purchase_price=20.0)
        _job(session, spool=s, grams=100)
        _job(session, grams=50, hint_type="PLA")
        c = statistics.counters(session)
        assert c["cost_material"] == pytest.approx(3.0)
        k = statistics.compute(session, now=NOW)["kosten"]
        assert k["material_geschaetzt"] == pytest.approx(1.0)
        assert k["gramm_ohne_spule"] == pytest.approx(50.0)

    def test_dashboard_material_cost_includes_estimate(self, client, session):
        s = _spool(session, purchase_price=20.0)
        _job(session, spool=s, grams=100, energy=0, wear=0)
        _job(session, grams=50, hint_type="PLA", energy=0, wear=0)
        r = client.get("/api/dashboard")
        assert r.status_code == 200
        assert r.json()["total_print_cost_eur"] == pytest.approx(3.0)

    def test_usage_out_has_estimate_flag(self, client, session):
        _spool(session, purchase_price=20.0)
        j = _job(session, grams=50, hint_type="PLA")
        r = client.get(f"/api/prints/{j.id}")
        u = r.json()["usages"][0]
        assert u["cost_estimated"] is True
        assert u["cost"] == pytest.approx(1.0)


def _project(session, name="Halterung „Bad“ – groß") -> Project:
    p = Project(name=name, description="Überblick für Tests", url="https://example.org/x")
    session.add(p)
    session.commit()
    return p


def _pdf_text(pdf) -> str:
    data = bytes(pdf.output())
    assert data.startswith(b"%PDF")
    return data.decode("latin-1")


class TestProjectReport:
    def test_endpoint_returns_pdf(self, client, session):
        session.add(UserPreferences(id=1, timezone_override="Europe/Berlin"))
        session.commit()
        s = _spool(session, purchase_price=20.0, color_hex="#FF8800")
        p = _project(session)
        j1 = _job(session, spool=s, grams=100, project=p, name="Teil A")
        _job(session, grams=50, hint_type="PETG", project=p, name="Teil B", energy=None)
        session.add(ProjectPrint(project_id=p.id, print_job_id=j1.id, is_test_print=True))
        session.commit()
        r = client.get(f"/api/reports/projects/{p.id}.pdf?lang=de")
        assert r.status_code == 200
        assert r.headers["content-type"] == "application/pdf"
        assert "attachment" in r.headers["content-disposition"]
        assert ".pdf" in r.headers["content-disposition"]
        assert r.content.startswith(b"%PDF")

    def test_unknown_project_404(self, client):
        assert client.get("/api/reports/projects/999.pdf").status_code == 404

    def test_empty_project(self, client, session):
        p = _project(session, name="Leer")
        r = client.get(f"/api/reports/projects/{p.id}.pdf")
        assert r.status_code == 200
        assert r.content.startswith(b"%PDF")

    def test_english_and_other_currency(self, client, session):
        s = _spool(session)
        p = _project(session, name="Bracket")
        _job(session, spool=s, project=p)
        r = client.get(f"/api/reports/projects/{p.id}.pdf?lang=en&currency=CHF")
        assert r.status_code == 200

    def test_many_prints_span_pages(self, session):
        s = _spool(session)
        p = _project(session)
        for i in range(120):
            _job(session, spool=s, project=p, grams=1, name=f"Teil {i}", days_ago=i % 30)
        session.refresh(p)
        pdf = project_report(session, p)
        assert pdf.page_no() >= 3
        _pdf_text(pdf)


class TestInventoryReport:
    def test_endpoint_returns_pdf(self, client, session):
        _spool(session, custom_id=3, storage_location="Regal", color_hex="#00FF00")
        _spool(session, custom_id=1, storage_location="Regal", current_weight_g=0)
        _spool(session, custom_id=2, storage_location=None, purchase_price=None)
        _spool(session, custom_id=9, archived=True)
        r = client.get("/api/reports/inventory.pdf")
        assert r.status_code == 200
        assert r.headers["content-type"] == "application/pdf"
        assert r.content.startswith(b"%PDF")

    def test_archived_and_empty_filter(self, session):
        _spool(session, custom_id=1)
        _spool(session, custom_id=2, current_weight_g=0)
        _spool(session, custom_id=3, archived=True)
        pdf = inventory_report(session, include_empty=False)
        assert "(1 Spulen)" in pdf.title_text
        pdf = inventory_report(session)
        assert "(2 Spulen)" in pdf.title_text

    def test_no_spools(self, client):
        r = client.get("/api/reports/inventory.pdf?lang=en")
        assert r.status_code == 200

    def test_drying_spool_and_bad_colour(self, session):
        _spool(session, custom_id=1, is_drying=True, drying_started_at=NOW, color_hex="zz")
        _pdf_text(inventory_report(session))


def test_latin1_replaces_unsupported_characters():
    assert latin1("12 € – „ok“ … ×") == '12 Euro - "ok" ... x'
    assert latin1("Grün ß") == "Grün ß"
    assert latin1("漢") == "?"
    assert latin1(None) == ""
