"""
UnidadMedida service — business logic for measurement unit management.

Design decisions:
    - Static methods receiving session (matches existing pattern in the project)
    - DELETE checks FK references before attempting deletion (design D5, risk mitigation)
    - Immutable catalog: no updated_at logic needed (D4)
"""
from sqlmodel import Session
from typing import Optional, List

from .repository import UnidadMedidaRepository
from .models import UnidadMedida
from .schemas import UnidadMedidaCreate, UnidadMedidaUpdate


class UnidadMedidaService:
    """Business logic for measurement unit CRUD operations."""

    @staticmethod
    def get_all(session: Session, tipo_filter: Optional[str] = None) -> List[UnidadMedida]:
        """List all units, optionally filtered by tipo."""
        repo = UnidadMedidaRepository(session)
        return repo.get_all(tipo_filter=tipo_filter)

    @staticmethod
    def get_by_id(session: Session, unidad_id: int) -> Optional[UnidadMedida]:
        """Retrieve a single unit by its ID. Returns None if not found."""
        repo = UnidadMedidaRepository(session)
        return repo.get_by_id(unidad_id)

    @staticmethod
    def create(session: Session, data: UnidadMedidaCreate) -> UnidadMedida:
        """Create a new measurement unit. Returns the created unit with generated id."""
        repo = UnidadMedidaRepository(session)
        unit = UnidadMedida(
            nombre=data.nombre,
            simbolo=data.simbolo,
            tipo=data.tipo,
        )
        repo.add(unit)
        repo.flush()
        repo.refresh(unit)
        return unit

    @staticmethod
    def update(session: Session, unidad_id: int, data: UnidadMedidaUpdate) -> Optional[UnidadMedida]:
        """Update a measurement unit. Only provided (non-None) fields are changed.

        Returns the updated unit, or None if the unit does not exist.
        """
        repo = UnidadMedidaRepository(session)
        unit = repo.get_by_id(unidad_id)
        if not unit:
            return None

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(unit, field, value)

        repo.add(unit)
        repo.flush()
        repo.refresh(unit)
        return unit

    @staticmethod
    def delete(session: Session, unidad_id: int) -> bool:
        """Delete a measurement unit. Fails if the unit has FK references.

        Returns True if deleted, False if not found.
        Raises ValueError if the unit is referenced by any Producto or
        ProductoIngrediente (FK protection per spec).
        """
        repo = UnidadMedidaRepository(session)
        unit = repo.get_by_id(unidad_id)
        if not unit:
            return False

        if repo.has_references(unidad_id):
            raise ValueError(
                f"La unidad de medida '{unit.nombre}' está en uso y no puede ser eliminada"
            )

        repo.add(unit)
        session.delete(unit)
        session.flush()
        return True
