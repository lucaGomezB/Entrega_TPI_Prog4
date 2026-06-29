"""
UnidadMedida schemas — Pydantic models for API request/response validation.

Design decisions:
    - tipo uses Literal validation (application-level, not DB enum — D3)
    - UnidadMedidaRead includes all 5 fields (id, nombre, simbolo, tipo, created_at)
    - No updated_at (immutable catalog — D4)
"""
from datetime import datetime
from typing import Optional, Literal
from sqlmodel import SQLModel
from app.core.base_schema import ReadModel

# Allowed measurement unit types
UnidadMedidaTipo = Literal["masa", "volumen", "unidad", "area"]


class UnidadMedidaBase(SQLModel):
    """Shared fields for create/update/read."""
    nombre: str
    simbolo: str
    tipo: UnidadMedidaTipo


class UnidadMedidaCreate(UnidadMedidaBase):
    """Request schema for creating a new measurement unit.

    All three fields are required: nombre, simbolo, and tipo.
    tipo is validated against the Literal set (masa, volumen, unidad, area).
    """
    pass


class UnidadMedidaUpdate(SQLModel):
    """Request schema for updating a measurement unit.

    All fields are optional — only provided fields will be updated.
    """
    nombre: Optional[str] = None
    simbolo: Optional[str] = None
    tipo: Optional[UnidadMedidaTipo] = None


class UnidadMedidaRead(ReadModel, UnidadMedidaBase):
    """Response schema for reading a measurement unit.

    Includes all columns: id, nombre, simbolo, tipo, created_at.
    """
    id: int
    created_at: datetime
