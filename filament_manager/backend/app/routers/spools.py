from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..util import utcnow
from ..models import Spool, BrandSpoolWeight, FilamentSubtype, FilamentMaterial, SpoolAudit
from ..schemas import SpoolCreate, SpoolOut, SpoolUpdate, SpoolAuditEntry
from .. import moisture
from .filament_sync import _sync_spool_weight_to_cloud


def _resolve_spool_weight(brand: str | None, db: Session) -> float:
    """Look up tare weight from brand config. Returns 0 if not found."""
    if not brand:
        return 0.0
    entry = db.query(BrandSpoolWeight).filter(
        BrandSpoolWeight.brand.ilike(brand)
    ).first()
    return entry.spool_weight_g if entry else 0.0

def _claim_ams_slot(slot: str | None, spool_id: int | None, db: Session) -> str | None:
    """Normalise an AMS slot value and free it on every other spool.

    A tray can only hold one spool. The AMS assignment endpoint already clears
    the previous holder; the spool form must do the same, otherwise two spools
    end up in one tray and slot lookups pick an arbitrary one. Matches both the
    full key ("Printer:ams1_tray1") and the legacy bare key ("ams1_tray1"),
    like the lookups in printers.py and print_monitor.py.
    """
    slot = (slot or "").strip() or None
    if slot is None:
        return None
    bare = slot.split(":", 1)[1] if ":" in slot else slot
    q = db.query(Spool).filter((Spool.ams_slot == slot) | (Spool.ams_slot == bare))
    if spool_id is not None:
        q = q.filter(Spool.id != spool_id)
    for other in q.all():
        moisture.set_ams_slot(other, None)   # leaves the AMS → keep its dryness value
    return slot


router = APIRouter(prefix="/api/spools", tags=["spools"])


@router.get("", response_model=list[SpoolOut])
def list_spools(
    material: str | None = None,
    include_archived: bool = False,
    db: Session = Depends(get_db),
):
    q = db.query(Spool)
    if material:
        q = q.filter(Spool.material == material)
    if not include_archived:
        q = q.filter(Spool.archived == False)  # noqa: E712
    return q.order_by(Spool.brand, Spool.material).all()


@router.post("", response_model=SpoolOut, status_code=201)
def create_spool(body: SpoolCreate, db: Session = Depends(get_db)):
    data = body.model_dump()
    # An explicit per-spool tare wins; otherwise take it from the brand config.
    if not data.get("spool_weight_g"):
        data["spool_weight_g"] = _resolve_spool_weight(data.get("brand"), db)
    if "ams_slot" in data:
        data["ams_slot"] = _claim_ams_slot(data["ams_slot"], None, db)
    if data.get("ams_slot") and data.get("packaging") == "original":
        data["packaging"] = "open"      # loaded into the AMS → no longer sealed
    spool = Spool(**data)
    db.add(spool)
    db.commit()
    db.refresh(spool)
    return spool


class LabelPrintedIn(BaseModel):
    ids: list[int] = Field(..., min_length=1, max_length=500)
    printed: bool = True   # False → "no label" again


@router.post("/label-printed")
def mark_label_printed(body: LabelPrintedIn, db: Session = Depends(get_db)):
    """Remember that labels were printed (or remove the mark) for the given spools."""
    when = utcnow() if body.printed else None
    n = 0
    for spool in db.query(Spool).filter(Spool.id.in_(body.ids)).all():
        spool.label_printed_at = when
        n += 1
    db.commit()
    return {"updated": n, "label_printed_at": when}


@router.get("/{spool_id}", response_model=SpoolOut)
def get_spool(spool_id: int, db: Session = Depends(get_db)):
    spool = db.get(Spool, spool_id)
    if not spool:
        raise HTTPException(404, "Spool not found")
    return spool


@router.patch("/{spool_id}", response_model=SpoolOut)
def update_spool(spool_id: int, body: SpoolUpdate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    spool = db.get(Spool, spool_id)
    if not spool:
        raise HTTPException(404, "Spool not found")
    updates = body.model_dump(exclude_unset=True)
    # Tare rules:
    # - an explicit spool_weight_g in the PATCH is applied as the spool's own
    #   tare (None → take it from the brand config again);
    # - otherwise the brand tare is only re-resolved when the brand actually
    #   changes, so unrelated PATCHes never reset a stored tare (issue #71).
    if "spool_weight_g" in updates:
        if updates["spool_weight_g"] is None:
            updates["spool_weight_g"] = _resolve_spool_weight(updates.get("brand", spool.brand), db)
    elif "brand" in updates and updates["brand"] != spool.brand:
        updates["spool_weight_g"] = _resolve_spool_weight(updates["brand"], db)
    if "ams_slot" in updates:
        updates["ams_slot"] = _claim_ams_slot(updates["ams_slot"], spool.id, db)
    weight_before = spool.current_weight_g
    explicit = {k: updates.pop(k) for k in
                ("is_drying", "drying_started_at", "moisture_anchor_at", "moisture_anchor_pct")
                if k in updates}
    # Storage changes keep the reached dryness value (only the rate changes);
    # material is applied first only when the storage does not change with it.
    if "packaging" in updates:
        moisture.set_packaging(spool, updates.pop("packaging"))
    if "ams_slot" in updates:
        moisture.set_ams_slot(spool, updates.pop("ams_slot"))
    if "last_dried_at" in updates:
        new_dried = updates["last_dried_at"]
        old_dried = spool.last_dried_at
        if new_dried is not None and old_dried is not None and new_dried.date() == old_dried.date():
            # the form only knows the day: same day → keep the exact stored time
            updates.pop("last_dried_at")
        elif new_dried != old_dried:
            # a new drying date restarts the estimate at 100 % from that date
            spool.moisture_anchor_at = None
            spool.moisture_anchor_pct = None
    for field, value in updates.items():
        setattr(spool, field, value)
    for field, value in explicit.items():      # migration: exact moisture state
        setattr(spool, field, bool(value) if field == "is_drying" else value)
    spool.updated_at = utcnow()
    if "current_weight_g" in updates:
        weight_after = spool.current_weight_g
        db.add(SpoolAudit(
            spool_id=spool.id,
            action="spool_edit",
            delta_g=weight_after - weight_before,
            weight_before=weight_before,
            weight_after=weight_after,
        ))
    db.commit()
    db.refresh(spool)
    if "current_weight_g" in updates and spool.bambu_spool_id:
        background_tasks.add_task(_sync_spool_weight_to_cloud, spool.id)
    from .. import ha_publisher
    ha_publisher.trigger()
    return spool


class WeighIn(BaseModel):
    gross_g: float = Field(ge=0)   # scale reading: filament + empty spool


@router.post("/{spool_id}/weigh", response_model=SpoolOut)
def weigh_spool(spool_id: int, body: WeighIn, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Set the remaining filament from a scale reading.

    remaining = scale reading − empty-spool tare (the spool's own tare, else the
    brand config), floored at 0. Logged as audit action 'weigh'.
    """
    spool = db.get(Spool, spool_id)
    if not spool:
        raise HTTPException(404, "Spool not found")
    tare = spool.spool_weight_g or _resolve_spool_weight(spool.brand, db)
    weight_before = spool.current_weight_g
    spool.current_weight_g = round(max(0.0, body.gross_g - tare), 1)
    spool.updated_at = utcnow()
    db.add(SpoolAudit(
        spool_id=spool.id,
        action="weigh",
        delta_g=spool.current_weight_g - weight_before,
        weight_before=weight_before,
        weight_after=spool.current_weight_g,
    ))
    db.commit()
    db.refresh(spool)
    if spool.bambu_spool_id:
        background_tasks.add_task(_sync_spool_weight_to_cloud, spool.id)
    from .. import ha_publisher
    ha_publisher.trigger()
    return spool


def _drying_audit(db: Session, spool: Spool, action: str) -> None:
    db.add(SpoolAudit(
        spool_id=spool.id, action=action, delta_g=0,
        weight_before=spool.current_weight_g, weight_after=spool.current_weight_g,
    ))


def _get_spool(db: Session, spool_id: int) -> Spool:
    spool = db.get(Spool, spool_id)
    if not spool:
        raise HTTPException(404, "Spool not found")
    return spool


@router.post("/{spool_id}/drying/start", response_model=SpoolOut)
def start_drying(spool_id: int, db: Session = Depends(get_db)):
    """Spool goes into the dryer: level 'drying', no warnings until finished."""
    spool = _get_spool(db, spool_id)
    if not spool.is_drying:
        spool.is_drying = True
        spool.drying_started_at = utcnow()
        spool.updated_at = utcnow()
        _drying_audit(db, spool, "drying_start")
        db.commit()
        db.refresh(spool)
        from .. import ha_publisher
        ha_publisher.trigger()
    return spool


@router.post("/{spool_id}/drying/finish", response_model=SpoolOut)
def finish_drying(spool_id: int, db: Session = Depends(get_db)):
    """Spool comes out of the dryer: the estimate restarts at 100 %."""
    spool = _get_spool(db, spool_id)
    moisture.mark_dry(spool)
    spool.updated_at = utcnow()
    _drying_audit(db, spool, "dried")
    db.commit()
    db.refresh(spool)
    from .. import ha_publisher
    ha_publisher.trigger()
    return spool


@router.post("/{spool_id}/drying/cancel", response_model=SpoolOut)
def cancel_drying(spool_id: int, db: Session = Depends(get_db)):
    """Taken out of the dryer early: back to the previous estimate."""
    spool = _get_spool(db, spool_id)
    if spool.is_drying:
        spool.is_drying = False
        spool.drying_started_at = None
        spool.updated_at = utcnow()
        _drying_audit(db, spool, "drying_cancel")
        db.commit()
        db.refresh(spool)
        from .. import ha_publisher
        ha_publisher.trigger()
    return spool


@router.post("/{spool_id}/mark-dry", response_model=SpoolOut)
def mark_spool_dry(spool_id: int, db: Session = Depends(get_db)):
    """Dried without the dryer workflow (or freshly unpacked): restart at 100 %."""
    return finish_drying(spool_id, db)


@router.get("/{spool_id}/audit", response_model=list[SpoolAuditEntry])
def get_spool_audit(spool_id: int, db: Session = Depends(get_db)):
    spool = db.get(Spool, spool_id)
    if not spool:
        raise HTTPException(404, "Spool not found")
    return (
        db.query(SpoolAudit)
        .filter(SpoolAudit.spool_id == spool_id)
        .order_by(SpoolAudit.changed_at.desc())
        .all()
    )


@router.post("/{spool_id}/audit/{entry_id}/correct", response_model=SpoolAuditEntry, status_code=201)
def correct_spool_audit(spool_id: int, entry_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Create a reversal correction entry for an audit row and update spool weight accordingly."""
    spool = db.get(Spool, spool_id)
    if not spool:
        raise HTTPException(404, "Spool not found")
    entry = (
        db.query(SpoolAudit)
        .filter(SpoolAudit.id == entry_id, SpoolAudit.spool_id == spool_id)
        .first()
    )
    if not entry:
        raise HTTPException(404, "Audit entry not found")

    weight_before = spool.current_weight_g
    correction_delta = -entry.delta_g
    spool.current_weight_g = max(0.0, min(spool.initial_weight_g, weight_before + correction_delta))
    spool.updated_at = utcnow()
    weight_after = spool.current_weight_g
    actual_delta = weight_after - weight_before

    correction = SpoolAudit(
        spool_id=spool_id,
        action="correction",
        delta_g=actual_delta,
        weight_before=weight_before,
        weight_after=weight_after,
        print_name=f"Correction: {entry.print_name or entry.action}",
    )
    db.add(correction)
    db.commit()
    db.refresh(correction)
    if spool.bambu_spool_id:
        background_tasks.add_task(_sync_spool_weight_to_cloud, spool.id)
    return correction


@router.delete("/{spool_id}", status_code=204)
def delete_spool(spool_id: int, db: Session = Depends(get_db)):
    spool = db.get(Spool, spool_id)
    if not spool:
        raise HTTPException(404, "Spool not found")
    db.delete(spool)
    db.commit()
    from .. import ha_publisher
    ha_publisher.trigger()


@router.post("/{spool_id}/archive", response_model=SpoolOut)
def archive_spool(spool_id: int, db: Session = Depends(get_db)):
    spool = db.get(Spool, spool_id)
    if not spool:
        raise HTTPException(404, "Spool not found")
    spool.archived = True
    spool.updated_at = utcnow()
    db.commit()
    db.refresh(spool)
    from .. import ha_publisher
    ha_publisher.trigger()
    return spool


@router.post("/{spool_id}/unarchive", response_model=SpoolOut)
def unarchive_spool(spool_id: int, db: Session = Depends(get_db)):
    spool = db.get(Spool, spool_id)
    if not spool:
        raise HTTPException(404, "Spool not found")
    spool.archived = False
    spool.updated_at = utcnow()
    db.commit()
    db.refresh(spool)
    from .. import ha_publisher
    ha_publisher.trigger()
    return spool


@router.get("/materials/list")
def list_materials(db: Session = Depends(get_db)):
    rows = db.query(FilamentMaterial).order_by(FilamentMaterial.name).all()
    return [r.name for r in rows]


@router.get("/subtypes/list")
def list_subtypes(db: Session = Depends(get_db)):
    rows = db.query(FilamentSubtype).order_by(FilamentSubtype.name).all()
    return [r.name for r in rows]
