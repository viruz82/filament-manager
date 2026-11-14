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
