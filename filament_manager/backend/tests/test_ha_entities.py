from app.ha_client import filter_ha_entities


def _s(entity_id, state, **attrs):
    return {"entity_id": entity_id, "state": state, "attributes": attrs}


STATES = [
    _s("sensor.drucker_energy", "70.6", unit_of_measurement="kWh", device_class="energy", state_class="total_increasing", friendly_name="Drucker Energie"),
    _s("sensor.heizung_wh", "1200", unit_of_measurement="Wh", state_class="total"),
    _s("sensor.drucker_energy_today", "0.07", unit_of_measurement="kWh", device_class="energy", state_class="total_increasing"),
    _s("sensor.drucker_energy_monthly", "1.8", unit_of_measurement="kWh", device_class="energy", state_class="total_increasing"),
    _s("sensor.zaehler_zyklus", "5", unit_of_measurement="kWh", state_class="total", meter_period="daily"),
    _s("sensor.prognose_kwh", "14000", unit_of_measurement="kWh", device_class="energy"),
    _s("sensor.drucker_power", "7.0", unit_of_measurement="W", device_class="power"),
    _s("sensor.preis", "0.3316", unit_of_measurement="EUR/kWh", device_class="monetary"),
    _s("input_number.strompreis", "0.30"),
    _s("input_number.abschlag_strom", "90"),
    _s("sensor.co2", "80", unit_of_measurement="gCO2eq/kWh"),
    _s("sensor.kosten_heute", "1.2", unit_of_measurement="EUR", device_class="monetary"),
    _s("sensor.defekt", "unavailable", unit_of_measurement="kWh", device_class="energy"),
    _s("light.lampe", "on"),
    # real-world noise from a Home Assistant install (all must stay out of "price")
    _s("input_number.kosten_je_kwh", "33.16", unit_of_measurement="Cent"),
    _s("input_number.grundpreis_je_monat", "17.88"),
    _s("input_number.abwasserpreis_m3", "2.97"),
    _s("input_number.spulmaschine_start_kwh", "261.5", unit_of_measurement="kWh"),
    _s("input_number.heizkosten_warmwasser_kwh_tag", "7.4", unit_of_measurement="kWh/Tag"),
    _s("sensor.preis_cent", "33.16", unit_of_measurement="ct/kWh"),
    _s("input_number.strom_eur_kwh", "0.33", unit_of_measurement="€/kWh"),
]


def test_energy_only_total_meters_without_period_counters():
    ids = [e["entity_id"] for e in filter_ha_entities(STATES, "energy")]
    assert ids == ["sensor.drucker_energy", "sensor.heizung_wh"]


def test_price_takes_price_sensors_and_price_like_helpers():
    ids = [e["entity_id"] for e in filter_ha_entities(STATES, "price")]
    assert ids == ["input_number.strom_eur_kwh", "input_number.strompreis", "sensor.preis"]


def test_price_drops_cent_prices_base_fees_and_meter_snapshots():
    ids = {e["entity_id"] for e in filter_ha_entities(STATES, "price")}
    for bad in ("input_number.kosten_je_kwh", "input_number.grundpreis_je_monat",
                "input_number.abwasserpreis_m3", "input_number.spulmaschine_start_kwh",
                "input_number.heizkosten_warmwasser_kwh_tag", "sensor.preis_cent",
                "input_number.abschlag_strom"):
        assert bad not in ids


def test_entry_has_name_value_unit():
    e = filter_ha_entities(STATES, "energy")[0]
    assert e == {"entity_id": "sensor.drucker_energy", "name": "Drucker Energie", "value": "70.6", "unit": "kWh"}


def test_unknown_kind_returns_nothing():
    assert filter_ha_entities(STATES, "foo") == []
