"""
Unit of Work for the Estadisticas module.

Provides a transactional boundary for analytics queries.
All read operations are wrapped in a UoW for consistency.
"""
from sqlmodel import Session
from .repository import EstadisticasRepository


class EstadisticasUnitOfWork:
    """Unit of Work for the Estadisticas (analytics) module."""

    def __init__(self, session: Session):
        self.session = session
        self.estadisticas = EstadisticasRepository(session)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type:
            self.rollback()
        else:
            self.commit()
        return False

    def commit(self):
        self.session.commit()

    def rollback(self):
        self.session.rollback()

    def add(self, entity):
        self.session.add(entity)
        return entity

    def flush(self):
        self.session.flush()

    def refresh(self, entity):
        self.session.refresh(entity)
        return entity

    def delete(self, entity):
        self.session.delete(entity)
