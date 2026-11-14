"""Tests for the label PDF (POST /api/reports/labels.pdf)."""
import base64
import struct
import zlib


def _png(w=24, h=12) -> str:
    """Minimal white RGB PNG as base64."""
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + b"\xff" * (w * 3) for _ in range(h))
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    return base64.b64encode(png).decode()


def test_labels_pdf_one_page_per_image(client):
    r = client.post("/api/reports/labels.pdf",
                    json={"width_mm": 30, "height_mm": 15, "images": [_png(), "data:image/png;base64," + _png()]})
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")
    assert b"/Count 2" in r.content


def test_labels_pdf_rejects_non_png(client):
    r = client.post("/api/reports/labels.pdf",
                    json={"images": [base64.b64encode(b"GIF89a....").decode()]})
    assert r.status_code == 422


def test_labels_pdf_rejects_bad_base64(client):
    r = client.post("/api/reports/labels.pdf", json={"images": ["%%%"]})
    assert r.status_code == 422


def test_labels_pdf_needs_images(client):
    assert client.post("/api/reports/labels.pdf", json={"images": []}).status_code == 422


def test_labels_pdf_grid_a4_pages(client):
    from app.routers.reports import grid_dims
    cols, rows = grid_dims(50, 30)
    assert (cols, rows) == (3, 8)
    n = cols * rows + 1   # one more than fits on a page
    r = client.post("/api/reports/labels.pdf",
                    json={"width_mm": 50, "height_mm": 30, "layout": "grid", "images": [_png()] * n})
    assert r.status_code == 200
    assert b"/Count 2" in r.content


def test_grid_dims_small_labels():
    from app.routers.reports import grid_dims
    assert grid_dims(30, 15) == (6, 16)
    assert grid_dims(300, 300) == (1, 1)


def test_labels_pdf_bad_layout(client):
    assert client.post("/api/reports/labels.pdf", json={"images": [_png()], "layout": "x"}).status_code == 422


def test_label_printed_mark_and_clear(client, session):
    from app.models import Spool
    s = Spool(brand="Sunlu", material="PLA", color_name="Schwarz", color_hex="#000000",
              initial_weight_g=1000.0, current_weight_g=800.0)
    session.add(s)
    session.commit()
    r = client.post("/api/spools/label-printed", json={"ids": [s.id]})
    assert r.status_code == 200 and r.json()["updated"] == 1
    assert client.get(f"/api/spools/{s.id}").json()["label_printed_at"] is not None
    client.post("/api/spools/label-printed", json={"ids": [s.id], "printed": False})
    assert client.get(f"/api/spools/{s.id}").json()["label_printed_at"] is None


def test_label_profiles_roundtrip(client):
    assert client.get("/api/settings/label-profiles").json() == []
    body = [{"name": "D110", "settings": {"widthMm": 30}}, {"name": " d110 ", "settings": {}},
            {"name": "A4", "settings": {"layout": "grid"}}]
    r = client.put("/api/settings/label-profiles", json=body)
    assert r.status_code == 200
    assert [p["name"] for p in r.json()] == ["D110", "A4"]
    assert client.get("/api/settings/label-profiles").json()[0]["settings"] == {"widthMm": 30}
    exp = client.get("/api/data/export").json()
    assert exp["user_preferences"]["label_profiles"][1]["name"] == "A4"
