from app.ha_client import filter_ha_entities


def _s(entity_id, state, **attrs):
    return {"entity_id": entity_id, "state": state, "attributes": attrs}


STATES = [
    _s("sensor.drucker_energy", "70.6", unit_of_measurement="kWh", device_class="energy", friendly_name="Drucker Energie"),
    _s("sensor.heizung_wh", "1200", unit_of_measurement="Wh"),
    _s("sensor.drucker_power", "7.0", unit_of_measurement="W", device_class="power"),
    _s("sensor.preis", "0.3316", unit_of_measurement="EUR/kWh", device_class="monetary"),
    _s("input_number.strompreis", "0.30"),
    _s("sensor.defekt", "unavailable", unit_of_measurement="kWh", device_class="energy"),
    _s("light.lampe", "on"),
]


def test_energy_only_energy_meters_with_numeric_state():
    ids = [e["entity_id"] for e in filter_ha_entities(STATES, "energy")]
    assert ids == ["sensor.drucker_energy", "sensor.heizung_wh"]


def test_price_takes_price_sensors_and_number_helpers():
    ids = [e["entity_id"] for e in filter_ha_entities(STATES, "price")]
    assert ids == ["input_number.strompreis", "sensor.preis"]


def test_entry_has_name_value_unit():
    e = filter_ha_entities(STATES, "energy")[0]
    assert e == {"entity_id": "sensor.drucker_energy", "name": "Drucker Energie", "value": "70.6", "unit": "kWh"}


def test_unknown_kind_returns_nothing():
    assert filter_ha_entities(STATES, "foo") == []
