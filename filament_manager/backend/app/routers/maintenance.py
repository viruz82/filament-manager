"""Maintenance log API (Wartungsbuch).

GET    /api/maintenance                    tasks with progress
POST   /api/maintenance                    create a task
PATCH  /api/maintenance/{id}               change a task
DELETE /api/maintenance/{id}               delete a task (and its log)
POST   /api/maintenance/{id}/done          mark as done {note?, done_at?}
GET    /api/maintenance/{id}/log           history of one task
DELETE /api/maintenance/log/{entry_id}     remove a wrong log entry (does not reset the task)
POST   /api/maintenance/template?lang=de   add Bambu Lab's A1 recommendations (missing ones only)
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from .. import ha_publisher, maintenance
from ..database import get_db
from ..models import MaintenanceLog, MaintenanceTask, PrinterConfig

router = APIRouter(prefix="/api/maintenance", tags=["maintenance"])


class TaskIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    printer_id: int | None = None
    interval_hours: float | None = Field(default=None, gt=0)
    interval_days: int | None = Field(default=None, gt=0)
    interval_grams: float | None = Field(default=None, gt=0)
    enabled: bool = True
    last_done_at: datetime | None = None    # start of counting; default now


class TaskPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    printer_id: int | None = None
    interval_hours: float | None = Field(default=None, gt=0)
    interval_days: int | None = Field(default=None, gt=0)
    interval_grams: float | None = Field(default=None, gt=0)
    enabled: bool | None = None
    sort_order: int | None = None
    last_done_at: datetime | None = None


class DoneIn(BaseModel):
    note: str | None = Field(default=None, max_length=2000)
    done_at: datetime | None = None


def _naive_utc(dt: datetime | None) -> datetime | None:
    if dt is None or dt.tzinfo is None:
        return dt
    from datetime import timezone
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() + "Z" if dt else None


def _out(db: Session, t: MaintenanceTask) -> dict:
    ev = maintenance.evaluate(db, t)
    return {
        "id": t.id, "name": t.name, "description": t.description,
        "printer_id": t.printer_id, "printer_name": t.printer.name if t.printer else None,
        "interval_hours": t.interval_hours, "interval_days": t.interval_days,
        "interval_grams": t.interval_grams, "enabled": t.enabled,
        "template_key": t.template_key, "sort_order": t.sort_order,
        "last_done_at": _iso(t.last_done_at), "log_count": len(t.log),
        **ev,
    }


def _log_out(e: MaintenanceLog) -> dict:
    return {"id": e.id, "task_id": e.task_id, "done_at": _iso(e.done_at), "note": e.note,
            "hours_since": e.hours_since, "grams_since": e.grams_since, "days_since": e.days_since}


def _get(db: Session, task_id: int) -> MaintenanceTask:
    t = db.get(MaintenanceTask, task_id)
    if not t:
        raise HTTPException(404, "Maintenance task not found")
    return t


def _check_printer(db: Session, printer_id: int | None) -> None:
    if printer_id is not None and not db.get(PrinterConfig, printer_id):
        raise HTTPException(400, "Printer not found")


@router.get("")
def list_tasks(db: Session = Depends(get_db)):
    tasks = (db.query(MaintenanceTask)
             .options(joinedload(MaintenanceTask.printer), joinedload(MaintenanceTask.log))
             .order_by(MaintenanceTask.sort_order, MaintenanceTask.id).all())
    return [_out(db, t) for t in tasks]


@router.post("", status_code=201)
def create_task(body: TaskIn, db: Session = Depends(get_db)):
    _check_printer(db, body.printer_id)
    data = body.model_dump()
    data["last_done_at"] = _naive_utc(data["last_done_at"]) or maintenance.utcnow()
    data["sort_order"] = db.query(MaintenanceTask).count()
    t = MaintenanceTask(**data)
    db.add(t)
    db.commit()
    db.refresh(t)
    ha_publisher.trigger()
    return _out(db, t)


@router.patch("/{task_id}")
def update_task(task_id: int, body: TaskPatch, db: Session = Depends(get_db)):
    t = _get(db, task_id)
    data = body.model_dump(exclude_unset=True)
    if "printer_id" in data:
        _check_printer(db, data["printer_id"])
    if "last_done_at" in data:
        if data["last_done_at"] is None:
            raise HTTPException(400, "last_done_at cannot be empty")
        data["last_done_at"] = _naive_utc(data["last_done_at"])
    for k in ("name", "enabled", "sort_order"):
        if k in data and data[k] is None:
            del data[k]
    for k, v in data.items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    ha_publisher.trigger()
    return _out(db, t)


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, db: Session = Depends(get_db)):
    db.delete(_get(db, task_id))
    db.commit()
    ha_publisher.trigger()


@router.post("/{task_id}/done")
def task_done(task_id: int, body: DoneIn | None = None, db: Session = Depends(get_db)):
    t = _get(db, task_id)
    body = body or DoneIn()
    done_at = _naive_utc(body.done_at)
    if done_at and done_at < t.last_done_at:
        raise HTTPException(400, "done_at is before the last time this task was done")
    entry = maintenance.mark_done(db, t, note=(body.note or "").strip() or None, done_at=done_at)
    db.commit()
    db.refresh(t)
    ha_publisher.trigger()
    return {"task": _out(db, t), "entry": _log_out(entry)}


@router.get("/{task_id}/log")
def task_log(task_id: int, db: Session = Depends(get_db)):
    return [_log_out(e) for e in _get(db, task_id).log]


@router.delete("/log/{entry_id}", status_code=204)
def delete_log_entry(entry_id: int, db: Session = Depends(get_db)):
    e = db.get(MaintenanceLog, entry_id)
    if not e:
        raise HTTPException(404, "Log entry not found")
    db.delete(e)
    db.commit()


@router.post("/template")
def add_template(lang: str = "de", db: Session = Depends(get_db)):
    created = maintenance.apply_template(db, lang)
    db.commit()
    ha_publisher.trigger()
    return {"created": len(created), "tasks": list_tasks(db)}
