"""Tests for app.statistics (HA long-term counters and dashboard snapshot)."""
from datetime import datetime, timedelta

from app import statistics
from app.ha_publisher import _compute, STATISTICS_ENTITY
from app.models import PrintJob, PrintUsage, Spool, UserPreferences

NOW = datetime(2026, 11, 13, 12, 0, 0)   # naive UTC, a Friday


def _spool(session, **kw) -> Spool:
    data = dict(brand="Sunlu", material="PLA", color_name="Black", color_hex="#000000",
                initial_weight_g=1000.0, current_weight_g=1000.0, purchase_price=20.0)
    data.update(kw)
    s = Spool(**data)
    session.add(s)
    session.commit()
    return s


def _job(session, spool, grams, *, days_ago, hours=1.0, energy=0.1, wear=0.2, success=True):
    end = NOW - timedelta(days=days_ago)
    j = PrintJob(name="Teil", started_at=end - timedelta(hours=hours), finished_at=end,
                 duration_seconds=int(hours * 3600), success=success,
                 energy_cost=energy, wear_cost=wear, printer_name="A1")
    session.add(j)
    session.flush()
    session.add(PrintUsage(print_job_id=j.id, spool_id=spool.id, grams_used=grams))
    spool.current_weight_g -= grams
    session.commit()
    return j


def _utc(session):
    session.add(UserPreferences(id=1, timezone_override="UTC"))
    session.commit()


class TestCounters:
    def test_totals(self, session):
        s = _spool(session)
        _job(session, s, 100, days_ago=1)
        _job(session, s, 50, days_ago=40, hours=2)

        c = statistics.counters(session)

        assert c["filament_used_g"] == 150
        assert c["prints"] == 2
        assert c["print_hours"] == 3
        assert c["cost_material"] == 3.0          # 150 g × 0.02 €/g
        assert c["cost_energy"] == 0.2
        assert c["cost_wear"] == 0.4
        assert c["cost_total"] == 3.6
        assert c["stock_g"] == 850
        assert c["stock_value"] == 17.0

    def test_running_job_not_counted_as_print(self, session):
        s = _spool(session)
        session.add(PrintJob(name="läuft", started_at=NOW, printer_name="A1"))
        session.commit()
        _job(session, s, 10, days_ago=1)

        assert statistics.counters(session)["prints"] == 1

    def test_archived_and_empty_spools_not_in_stock(self, session):
        _spool(session, current_weight_g=300, archived=True)
        _spool(session, current_weight_g=0)
        _spool(session, current_weight_g=400)

        assert statistics.counters(session)["stock_g"] == 400


class TestSnapshot:
    def test_periods_and_trend(self, session):
        _utc(session)
        s = _spool(session)
        _job(session, s, 70, days_ago=2)
        _job(session, s, 30, days_ago=10)
        _job(session, s, 20, days_ago=45)     # previous 30-day window

        z = statistics.compute(session, now=NOW)["zeitraum"]

        assert z["7"]["drucke"] == 1 and z["7"]["gramm"] == 70
        assert z["30"]["drucke"] == 2 and z["30"]["gramm"] == 100
        assert z["30"]["drucke_vorher"] == 1
        assert z["30"]["gramm_woche"] == round(100 / 30 * 7, 1)

    def test_stock_buckets(self, session):
        session.add(UserPreferences(id=1, timezone_override="UTC", low_stock_threshold_pct=25))
        session.commit()
        _spool(session, current_weight_g=900)              # voll
        _spool(session, current_weight_g=400)              # mittel
        _spool(session, current_weight_g=100)              # niedrig
        _spool(session, current_weight_g=0)                # leer
        _spool(session, current_weight_g=500, archived=True)

        snap = statistics.compute(session, now=NOW)

        assert snap["bestand"] == {"voll": 1, "mittel": 1, "niedrig": 1, "leer": 1, "archiviert": 1}
        assert [n["gramm"] for n in snap["niedrig"]] == [100]

    def test_forecast_per_spool(self, session):
        _utc(session)
        a = _spool(session, custom_id=1, current_weight_g=330)
        b = _spool(session, custom_id=2, current_weight_g=1000)
        _job(session, a, 30, days_ago=3)       # 30 g in 30 days → 7 g/week, 300 g left
        _job(session, b, 10, days_ago=60)      # outside window → no forecast

        p = statistics.compute(session, now=NOW)["prognose"]

        assert len(p) == 1
        assert p[0]["nummer"] == 1 and p[0]["rest_g"] == 300 and p[0]["g_woche"] == 7.0
        assert p[0]["wochen"] == round(300 / 7, 1)
        assert p[0]["leer_am"] == (NOW.date() + timedelta(days=round(300 / 7 * 7))).isoformat()

    def test_months_weekdays_local_time(self, session):
        session.add(UserPreferences(id=1, timezone_override="Europe/Berlin"))
        session.commit()
        s = _spool(session, purchased_at=datetime(2026, 10, 5, 10, 0))
        # 31.10. 23:30 UTC = 01.11. 00:30 in Berlin (Sunday) → November
        j = PrintJob(name="spät", started_at=datetime(2026, 10, 31, 22, 0),
                     finished_at=datetime(2026, 10, 31, 23, 30), duration_seconds=5400)
        session.add(j); session.flush()
        session.add(PrintUsage(print_job_id=j.id, spool_id=s.id, grams_used=12))
        session.commit()

        snap = statistics.compute(session, now=NOW)
        months = {m["monat"]: m for m in snap["monate"]}

        assert len(snap["monate"]) == 12 and snap["monate"][-1]["monat"] == "2026-11"
        assert months["2026-11"]["drucke"] == 1 and months["2026-11"]["gramm"] == 12
        assert months["2026-10"]["drucke"] == 0 and months["2026-10"]["ausgaben"] == 20.0
        assert snap["wochentage"][6] == 1    # Sunday

    def test_breakdowns_and_top(self, session):
        _utc(session)
        a = _spool(session, custom_id=5, subtype="Silk", color_name="Gold", color_hex="#D4AF37")
        b = _spool(session, brand="eSUN", material="PETG")
        _job(session, a, 40, days_ago=1)
        _job(session, a, 10, days_ago=2)
        _job(session, b, 30, days_ago=1)

        snap = statistics.compute(session, now=NOW)

        assert {"name": "PLA Silk", "anzahl": 1} in snap["nach_typ"]
        assert [h["name"] for h in snap["nach_hersteller"]] == ["Sunlu", "eSUN"]
        assert snap["top_filamente"][0] == {"nummer": 5, "name": "Sunlu PLA Silk Gold", "hex": "#D4AF37",
                                            "gramm": 50, "drucke": 2}
        assert snap["uebersicht"]["erfolgsquote"] == 100.0

    def test_empty_database(self, session):
        snap = statistics.compute(session, now=NOW)

        assert snap["uebersicht"]["drucke"] == 0
        assert snap["uebersicht"]["erfolgsquote"] is None
        assert snap["prognose"] == [] and snap["kosten"]["je_druck"] is None


class TestPublishedSensors:
    def test_state_class_and_units(self, session):
        s = _spool(session)
        _job(session, s, 25, days_ago=1)

        values = _compute(session)

        state, attrs = values["sensor.filament_manager_filament_used"]
        assert state == 25 and attrs["state_class"] == "total" and attrs["unit_of_measurement"] == "g"
        _, attrs = values["sensor.filament_manager_cost_total"]
        assert attrs["device_class"] == "monetary" and attrs["unit_of_measurement"] == "EUR"
        _, attrs = values["sensor.filament_manager_stock_value"]
        assert attrs["state_class"] == "measurement" and "device_class" not in attrs
        state, attrs = values[STATISTICS_ENTITY]
        assert state == 1 and "state_class" not in attrs and "prognose" in attrs


class TestEndpoint:
    def test_statistics_endpoint(self, client):
        r = client.get("/api/dashboard/statistics?days=14")

        assert r.status_code == 200
        body = r.json()
        assert body["prognose_tage"] == 14
        assert "counters" in body and "monate" in body
