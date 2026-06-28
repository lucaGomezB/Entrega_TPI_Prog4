"""
Producto repository — data access layer for Product and its many-to-many relations.

Extends BaseRepository with custom queries for managing the link tables
ProductoCategoria and ProductoIngrediente, plus batch ingredient checks
and price-recalculation support.
"""
from decimal import Decimal
from sqlmodel import Session, col, select
from typing import List, Optional, Set, Tuple

from core.base_repository import BaseRepository
from ..producto_categoria import ProductoCategoria
from ..producto_ingrediente import ProductoIngrediente
from ..Ingrediente.models import Ingrediente
from ..Categoria.models import Categoria
from ..UnidadMedida.models import UnidadMedida
from .models import Producto


class ProductoRepository(BaseRepository[Producto]):
    """Repository for Product entity with link-table management methods."""

    def __init__(self, session: Session):
        super().__init__(session, Producto)

    def add_categoria_relacion(self, producto_id: int, categoria_id: int, es_principal: bool):
        """Create a ProductoCategoria link row."""
        enlace = ProductoCategoria(
            producto_id=producto_id,
            categoria_id=categoria_id,
            es_principal=es_principal,
        )
        self.session.add(enlace)
        return enlace

    def add_ingrediente_relacion(
        self,
        producto_id: int,
        ingrediente_id: int,
        es_removible: bool,
        es_principal: bool,
        orden: int = 0,
        cantidad: Decimal = Decimal("1"),
        unidad_medida_id: Optional[int] = None,
    ):
        """Create a ProductoIngrediente link row with relationship metadata."""
        enlace = ProductoIngrediente(
            producto_id=producto_id,
            ingrediente_id=ingrediente_id,
            es_removible=es_removible,
            es_principal=es_principal,
            orden=orden,
            cantidad=cantidad,
            unidad_medida_id=unidad_medida_id,
        )
        self.session.add(enlace)
        return enlace

    def get_ingredientes(self, producto_id: int):
        """Return ingredients for a product JOINed with Ingrediente and UnidadMedida.

        Uses a three-table join: inner join on Ingrediente (always present),
        left outer join on UnidadMedida (optional — ingredient might not have
        a unit assigned). Results are ordered by the 'orden' display field.
        """
        statement = (
            select(ProductoIngrediente, Ingrediente, UnidadMedida)
            .join(Ingrediente, ProductoIngrediente.ingrediente_id == Ingrediente.id)
            .outerjoin(UnidadMedida, ProductoIngrediente.unidad_medida_id == UnidadMedida.id)
            .where(ProductoIngrediente.producto_id == producto_id)
            .order_by(ProductoIngrediente.orden)
        )
        results = self.session.exec(statement).all()
        return [
            {
                "ingrediente_id": rel.ingrediente_id,
                "ingrediente_nombre": ing.nombre,
                "cantidad": rel.cantidad,
                "es_removible": rel.es_removible,
                "es_principal": rel.es_principal,
                "orden": rel.orden,
                "es_alergeno": ing.es_alergeno,
                "unidad_medida_id": rel.unidad_medida_id,
                "unidad_medida_simbolo": um.simbolo if um else None,
            }
            for rel, ing, um in results
        ]

    def get_categorias(self, producto_id: int):
        """Return categories for a product JOINed with Categoria data."""
        statement = (
            select(ProductoCategoria, Categoria)
            .join(Categoria, ProductoCategoria.categoria_id == Categoria.id)
            .where(ProductoCategoria.producto_id == producto_id)
        )
        results = self.session.exec(statement).all()
        return [
            {
                "categoria_id": rel.categoria_id,
                "categoria_nombre": cat.nombre,
                "es_principal": rel.es_principal,
            }
            for rel, cat in results
        ]

    def delete_ingrediente_relacion(self, producto_id: int, ingrediente_id: int):
        """Remove an ingredient association. Returns True if a row was deleted."""
        statement = select(ProductoIngrediente).where(
            ProductoIngrediente.producto_id == producto_id,
            ProductoIngrediente.ingrediente_id == ingrediente_id,
        )
        enlace = self.session.exec(statement).first()
        if enlace:
            self.session.delete(enlace)
            return True
        return False

    def delete_categoria_relacion(self, producto_id: int, categoria_id: int):
        """Remove a category association. Returns True if a row was deleted."""
        statement = select(ProductoCategoria).where(
            ProductoCategoria.producto_id == producto_id,
            ProductoCategoria.categoria_id == categoria_id,
        )
        enlace = self.session.exec(statement).first()
        if enlace:
            self.session.delete(enlace)
            return True
        return False

    # ------------------------------------------------------------------
    # Query methods for service migration
    # ------------------------------------------------------------------

    def get_with_ingredients(self, producto_id: int) -> Optional[Producto]:
        """Fetch a product by ID (uses BaseRepository.get_by_id with soft-delete filter)."""
        return self.get_by_id(producto_id)

    def get_all_with_ingredient_flag(self, skip: int = 0, limit: int = 100, search: Optional[str] = None) -> Tuple[List[Producto], Set[int]]:
        """Return paginated non-deleted products and the set of IDs that have ingredients.

        Optionally filters by name ILIKE when search is provided.
        Returns (products, ids_with_ingredients) so the caller can set
        the tiene_ingredientes flag per product.
        """
        productos = self.get_all_filtered(skip=skip, limit=limit, search=search)
        if not productos:
            return [], set()

        product_ids = [p.id for p in productos]
        stmt = select(ProductoIngrediente.producto_id).where(
            ProductoIngrediente.producto_id.in_(product_ids)
        ).distinct()
        rows = self.session.exec(stmt).all()
        ids_with_ingredients = set(rows)
        return list(productos), ids_with_ingredients

    def get_all_filtered(self, skip: int = 0, limit: int = 100, search: Optional[str] = None) -> List[Producto]:
        """List non-deleted products with optional name search, newest first."""
        if search:
            return self.search("nombre", search, skip=skip, limit=limit)
        return self.get_all(skip=skip, limit=limit)

    def get_productos_afectados(self, ingrediente_id: int) -> List[int]:
        """Return distinct product IDs that use a given ingredient."""
        statement = select(ProductoIngrediente.producto_id).where(
            ProductoIngrediente.ingrediente_id == ingrediente_id,
        ).distinct()
        return self.session.exec(statement).all()

    def get_producto_ingredientes(self, producto_id: int):
        """Return all ProductoIngrediente associations for a product."""
        statement = select(ProductoIngrediente).where(
            ProductoIngrediente.producto_id == producto_id,
        )
        return self.session.exec(statement).all()

    def get_producto_ingrediente(self, producto_id: int, ingrediente_id: int):
        """Return a specific ProductoIngrediente association (or None)."""
        statement = select(ProductoIngrediente).where(
            ProductoIngrediente.producto_id == producto_id,
            ProductoIngrediente.ingrediente_id == ingrediente_id,
        )
        return self.session.exec(statement).first()

    def get_ingrediente(self, ingrediente_id: int) -> Optional[Ingrediente]:
        """Fetch a single ingredient by ID."""
        return self.session.get(Ingrediente, ingrediente_id)

    def get_insumo_ids(self, producto_ids: List[int]) -> Set[int]:
        """Return the subset of product IDs that are insumos."""
        if not producto_ids:
            return set()
        statement = select(Producto.id).where(
            Producto.id.in_(producto_ids),
            Producto.es_insumo == True,
        )
        return set(self.session.exec(statement).all())

    def count_all(self, search: Optional[str] = None) -> int:
        """Count all non-deleted products, optionally filtered by name search."""
        return super().count_all(search=search, search_column="nombre" if search else None)
