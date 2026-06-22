"""
CarritoSnapshot repository — data access layer for cart snapshots.
"""
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlmodel import Session, select, delete, col

from .models import CarritoSnapshot


class CarritoSnapshotRepository:
    """Repository for CarritoSnapshot CRUD and TTL cleanup."""

    def __init__(self, session: Session):
        self.session = session

    def create(self, snapshot: CarritoSnapshot) -> CarritoSnapshot:
        """Insert a new snapshot."""
        self.session.add(snapshot)
        self.session.flush()
        self.session.refresh(snapshot)
        return snapshot

    def get_by_external_reference(self, external_reference: str) -> Optional[CarritoSnapshot]:
        """Lookup a snapshot by its external_reference (shared with Pago)."""
        statement = select(CarritoSnapshot).where(
            CarritoSnapshot.external_reference == external_reference
        )
        return self.session.exec(statement).first()

    def delete(self, snapshot: CarritoSnapshot) -> None:
        """Delete a snapshot by ORM entity."""
        self.session.delete(snapshot)

    def delete_expired(self) -> int:
        """Delete all snapshots where expires_at < NOW(). Returns count deleted."""
        now = datetime.now(timezone.utc)
        statement = delete(CarritoSnapshot).where(
            col(CarritoSnapshot.expires_at) < now
        )
        result = self.session.exec(statement)
        self.session.flush()
        return result.rowcount
