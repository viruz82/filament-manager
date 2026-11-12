"""Printer wear (depreciation) cost per print job.

The cost is stored on the job (like energy_cost) so a later change of the
printer's rate does not silently rewrite past prints. Use the recalculate
endpoint to apply a new rate to the history on purpose.
"""
from sqlalchemy.orm import Session

from .models import PrintJob, PrinterConfig


def wear_cost_for(job: PrintJob, printer: PrinterConfig | None) -> float | None:
    if not printer or not printer.wear_cost_per_hour or not job.duration_seconds:
        return None
    return round(job.duration_seconds / 3600 * printer.wear_cost_per_hour, 4)


def apply_wear_cost(db: Session, job: PrintJob) -> None:
    """Set job.wear_cost from the rate of the printer named in job.printer_name."""
    printer = None
    if job.printer_name:
        printer = db.query(PrinterConfig).filter(PrinterConfig.name == job.printer_name).first()
    job.wear_cost = wear_cost_for(job, printer)
