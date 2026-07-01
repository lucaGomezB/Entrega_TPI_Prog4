"""
Producto service — business logic for product CRUD, ingredient/category
management, and automatic price recalculation.

This is the thickest layer in the Product module. Key invariants:
- precio_base is auto-calculated from ingredient costs when ingredients exist
- Stock transitions can trigger ingredient stock consumption
- Soft-delete is used (no physical row removal)
- All write operations use the Unit of Work pattern
"""
from decimal import Decimal
import math

from fastapi import HTTPException
from sqlmodel import Session, select
from typing import Optional
from collections import defaultdict
from .models import Producto
from .schemas import ProductoCreate, ProductoRead, ProductoUpdate, IngredienteAsignado, CategoriaAsignada
from app.core.paginated_response import PaginatedResponse
from app.core.base import get_utc_now
from ..Categoria.models import Categoria
from ..Ingrediente.models import Ingrediente
from ..producto_ingrediente import ProductoIngrediente
from ..uow import CatalogoDeProductosUnitOfWork
from ..UnidadMedida.models import UnidadMedida

# ── Unit conversion factors ──────────────────────────────────────────────
# Each UnidadMedida ID maps to its conversion factor relative to the
# canonical base unit of its tipo (gramo for masa, mililitro for volumen,
# porcion for unidad, metro cuadrado for area).
#
# Base units (factor=1): g(2), mL(4), porcion(5), m²(7)
# These are also stored in the unidadmedida.factor_conversion column.
# The dict below is the canonical seed; _load_conversion_factors()
# reads from the DB at runtime.
_CONVERSION: dict[int, Decimal] = {
    1: Decimal("1000"),   # kg → g
    2: Decimal("1"),       # g (base)
    3: Decimal("1000"),   # L → mL
    4: Decimal("1"),       # mL (base)
    5: Decimal("1"),       # porcion (base)
    6: Decimal("12"),     # docena → porcion
    7: Decimal("1"),       # m² (base)
}


def _load_conversion_factors(session) -> dict[int, Decimal]:
    """Load conversion factors from the UnidadMedida table.

    Falls back to the hardcoded _CONVERSION dict if the table is empty
    (e.g. during tests before seeding).
    """
    rows = session.exec(select(UnidadMedida.id, UnidadMedida.factor_conversion)).all()
    if not rows:
        return dict(_CONVERSION)
    return {row[0]: Decimal(str(row[1])) for row in rows}


def _convertir_cantidad(
    cantidad: Decimal,
    unidad_origen_id: int | None,
    unidad_destino_id: int | None,
    factores: dict[int, Decimal] | None = None,
) -> Decimal:
    """Convert a quantity from one unit to another within the same tipo.

    When both units are the same or either is None, returns cantidad unchanged.
    Uses conversion factors relative to each tipo's base unit.
    If factores is not provided, falls back to the hardcoded _CONVERSION dict.
    """
    if unidad_origen_id is None or unidad_destino_id is None:
        return cantidad
    if unidad_origen_id == unidad_destino_id:
        return cantidad
    if factores is None:
        factores = _CONVERSION
    factor_origen = factores.get(unidad_origen_id, Decimal("1"))
    factor_destino = factores.get(unidad_destino_id, Decimal("1"))
    return cantidad * (factor_origen / factor_destino)


class ProductoService:
    """Business logic for the Product entity."""

    @staticmethod
    def create(session: Session, data: ProductoCreate):
        """Create a product with optional category and ingredient associations.

        Business rules:
        - stock_cantidad and disponible are independent flags
        - The price is recalculated from ingredients if any are assigned
        """
        with CatalogoDeProductosUnitOfWork(session) as uow:
            factores = _load_conversion_factors(session)
            producto_data = data.model_dump(exclude={"categorias_ids", "categoria_principal_id", "ingredientes"})
            db_producto = Producto(**producto_data)

            # Set precio_actual default to precio_base if not provided
            if db_producto.precio_actual is None or db_producto.precio_actual == 0:
                db_producto.precio_actual = db_producto.precio_base

            # Validate: precio_actual must not be lower than precio_base
            if db_producto.precio_actual < db_producto.precio_base:
                raise HTTPException(
                    status_code=400,
                    detail="El precio actual no puede ser menor al precio base"
                )

            # Validate price: must be > 0 when the product has no ingredients
            # and is not marked as an insumo (resold item with manual price).
            if not data.es_insumo and (not data.ingredientes) and db_producto.precio_base <= 0:
                raise HTTPException(
                    status_code=400,
                    detail="El precio base debe ser mayor a 0 cuando el producto no tiene ingredientes ni es de reventa"
                )

            uow.productos.create(db_producto)

            if data.categorias_ids:
                for cat_id in data.categorias_ids:
                    uow.productos.add_categoria_relacion(
                        producto_id=db_producto.id,
                        categoria_id=cat_id,
                        es_principal=(cat_id == data.categoria_principal_id),
                    )

            # Skip ingredient block entirely for insumo products
            if not data.es_insumo and data.ingredientes:
                for ingrediente in data.ingredientes:
                    uow.productos.add_ingrediente_relacion(
                        producto_id=db_producto.id,
                        ingrediente_id=ingrediente.ingrediente_id,
                        es_removible=ingrediente.es_removible,
                        es_principal=ingrediente.es_principal,
                        orden=ingrediente.orden,
                        cantidad=ingrediente.cantidad,
                        unidad_medida_id=ingrediente.unidad_medida_id,
                    )

                # Task 5.1 & 5.2: Stock deduction on create (two-pass atomic)
                # Only deduct when the product is being created with stock > 0
                # AND has ingredient associations.
                if db_producto.stock_cantidad > 0:
                    associations = uow.productos.get_producto_ingredientes(db_producto.id)

                    # Pass 1: validate ALL ingredients, collect every shortage
                    shortages: list[dict] = []
                    for pi in associations:
                        ing = uow.productos.get_ingrediente(pi.ingrediente_id)
                        if ing:
                            pi_unidad = pi.unidad_medida_id or ing.unidad_medida_id
                            factor = (
                                _convertir_cantidad(
                                    Decimal(pi.cantidad), pi_unidad, ing.unidad_medida_id,
                                    factores=factores,
                                )
                            )
                            needed = factor * Decimal(db_producto.stock_cantidad)
                            if ing.stock_actual < needed:
                                max_posible = int(ing.stock_actual // factor)
                                shortages.append({
                                    "ingrediente": ing.nombre,
                                    "disponible": ing.stock_actual,
                                    "requerido": int(math.ceil(needed)),
                                    "max_posible": max_posible,
                                })

                    if shortages:
                        raise HTTPException(
                            status_code=400,
                            detail={
                                "error": "stock_insuficiente",
                                "mensaje": "Stock insuficiente en los siguientes ingredientes",
                                "ingredientes": shortages,
                            }
                        )

                    # Pass 2: all validated — deduct now
                    for pi in associations:
                        ing = uow.productos.get_ingrediente(pi.ingrediente_id)
                        if ing:
                            pi_unidad = pi.unidad_medida_id or ing.unidad_medida_id
                            needed = (
                                _convertir_cantidad(
                                    Decimal(pi.cantidad), pi_unidad, ing.unidad_medida_id,
                                    factores=factores,
                                )
                                * Decimal(db_producto.stock_cantidad)
                            )
                            ing.stock_actual -= int(needed)
                            uow.add(ing)

            # Recalculate price if the product has ingredients (skip for insumo)
            if not data.es_insumo and data.ingredientes:
                ProductoService._recalcular_precio_producto(uow, db_producto.id)

            uow.productos.refresh(db_producto)
            return db_producto

    @staticmethod
    def _recalcular_precio_producto(uow: CatalogoDeProductosUnitOfWork, producto_id: int):
        """Recalculate precio_base = SUM(ingrediente.precio_actual * pi.cantidad).

        This method does NOT manage its own UoW — the calling method
        is responsible for the transaction boundary. All writes go through uow.add().
        """
        factores = _load_conversion_factors(uow.session)
        db_producto = uow.productos.get_with_ingredients(producto_id)
        if not db_producto:
            return

        # Skip recalculation for insumo products (their price is manual)
        if db_producto.es_insumo:
            return

        # Fetch all ProductoIngrediente associations for this product
        associations = uow.productos.get_producto_ingredientes(producto_id)

        if not associations:
            return

        total = Decimal('0')
        for pi in associations:
            ing = uow.productos.get_ingrediente(pi.ingrediente_id)
            if ing and ing.precio_actual:
                # Convert: pi.cantidad (in pi.unidad_medida) → ing.unidad_medida
                # Fallback: if pi.unidad_medida_id is None, default to the
                # ingredient's own unit so the quantity is not misinterpreted.
                pi_unidad = pi.unidad_medida_id or ing.unidad_medida_id
                cantidad_convertida = _convertir_cantidad(
                    Decimal(pi.cantidad),
                    pi_unidad,
                    ing.unidad_medida_id,
                    factores=factores,
                )
                total += ing.precio_actual * cantidad_convertida

        db_producto.precio_base = total

        # Ensure precio_actual is not lower than the recalculated precio_base
        if db_producto.precio_actual < db_producto.precio_base:
            db_producto.precio_actual = db_producto.precio_base

        uow.productos.update(db_producto)

    @staticmethod
    def recalcular_precio_productos_afectados(session: Session, ingrediente_id: int):
        """Recalculate precio_base for ALL products using a given ingredient.

        Called automatically when an ingredient's price changes.
        Manages its own UoW transaction. The UoW __exit__ handles commit.
        """
        with CatalogoDeProductosUnitOfWork(session) as uow:
            producto_ids = uow.productos.get_productos_afectados(ingrediente_id)

            # Exclude insumo products from recalculation (their price is manual).
            # Single batch query instead of N+1 individual session.get() calls.
            if producto_ids:
                insumo_ids = uow.productos.get_insumo_ids(producto_ids)
                producto_ids = [pid for pid in producto_ids if pid not in insumo_ids]

            for pid in producto_ids:
                ProductoService._recalcular_precio_producto(uow, pid)

            # NOTE: No manual uow.commit() — the UoW __exit__ handles it automatically.

    @staticmethod
    def get_all(session: Session, skip: int = 0, limit: int = 100, search: Optional[str] = None, categoria_id: Optional[list[int]] = None) -> PaginatedResponse[ProductoRead]:
        """List all non-deleted products with pagination, ingredient flag, optional text search, and optional category filter.

        When categoria_id is provided (single ID or list), the filter includes each category
        and all its descendants (union via get_descendant_ids on the category repository).

        Read-only: wrapped in UoW for consistent DB access. The data is already
        in memory when returned so the UoW commit on exit is harmless.

        The tiene_ingredientes flag is computed in a batch query to
        avoid N+1 checks per product.
        """
        with CatalogoDeProductosUnitOfWork(session) as uow:
            # Resolve descendant category IDs when filtering by category
            # Supports both single int (backward compat) and list[int] (multi-select)
            categoria_ids: Optional[list[int]] = None
            if categoria_id:
                all_ids: set[int] = set()
                for cid in categoria_id:
                    all_ids.update(uow.categorias.get_descendant_ids(cid))
                categoria_ids = list(all_ids)

            productos, ids_with_ingredients = uow.productos.get_all_with_ingredient_flag(
                skip=skip, limit=limit, search=search, categoria_ids=categoria_ids,
            )
            total = uow.productos.count_all(search=search, categoria_ids=categoria_ids)

            # Build ProductoRead response with computed tiene_ingredientes
            result = []
            for p in productos:
                if p.imagenes_url is None:
                    p.imagenes_url = []
                base = ProductoRead.model_validate(p).model_dump(exclude={"tiene_ingredientes"})
                result.append(
                    ProductoRead(
                        **base,
                        tiene_ingredientes=p.id in ids_with_ingredients,
                    )
                )

            # Populate categoria_ids on each ProductoRead via batch query
            if result:
                product_ids = [p.id for p in result]
                from ..producto_categoria import ProductoCategoria as PC
                pc_stmt = select(PC).where(PC.producto_id.in_(product_ids))
                pc_rows = session.exec(pc_stmt).all()
                pc_map = defaultdict(list)
                for row in pc_rows:
                    pc_map[row.producto_id].append(row.categoria_id)
                # Build new list with populated categoria_ids
                enriched = []
                for p in result:
                    p_dict = p.model_dump()
                    p_dict['categoria_ids'] = pc_map.get(p.id, [])
                    enriched.append(ProductoRead(**p_dict))
                result = enriched

            return PaginatedResponse(
                items=result,
                total=total,
                skip=skip,
                limit=limit,
            )

    @staticmethod
    def get_by_id(session: Session, producto_id: int):
        """Fetch a single non-deleted product by ID.

        Read-only: wrapped in UoW for consistent DB access.
        """
        with CatalogoDeProductosUnitOfWork(session) as uow:
            return uow.productos.get_with_ingredients(producto_id)

    @staticmethod
    def update(session: Session, producto_id: int, data: ProductoUpdate):
        """Update a product with stock-aware business rules.

        Key business rules:
        - Increasing stock consumes ingredient stock (validates availability)
        - Decreasing stock restores ingredient stock
        - stock_cantidad and disponible are independent flags
        - Price is recalculated if the product has ingredients
        """
        with CatalogoDeProductosUnitOfWork(session) as uow:
            factores = _load_conversion_factors(session)
            db_producto = uow.productos.get_by_id(producto_id)
            if not db_producto:
                return None

            values = data.model_dump(exclude_unset=True)

            # Task 5.5: Handle ingredientes field — pop before the loop
            # to avoid trying to setattr on a SQLAlchemy relationship.
            nuevos_ingredientes = values.pop("ingredientes", None)

            # Track state before applying changes, for transition detection
            old_stock = db_producto.stock_cantidad

            for key, value in values.items():
                setattr(db_producto, key, value)

            # If stock was increased, deduct the difference from ingredient inventory
            new_stock = db_producto.stock_cantidad
            if 'stock_cantidad' in values and new_stock > old_stock:
                diff = new_stock - old_stock
                associations = uow.productos.get_producto_ingredientes(producto_id)

                # First pass: validate ALL ingredients, collect every shortage
                shortages: list[dict] = []
                for pi in associations:
                    ing = uow.productos.get_ingrediente(pi.ingrediente_id)
                    if ing:
                        factor = _convertir_cantidad(
                            Decimal(pi.cantidad), pi.unidad_medida_id, ing.unidad_medida_id,
                            factores=factores,
                        )
                        needed = factor * Decimal(diff)
                        if ing.stock_actual < needed:
                            max_posible = int(ing.stock_actual // factor)
                            shortages.append({
                                "ingrediente": ing.nombre,
                                "disponible": ing.stock_actual,
                                "requerido": int(math.ceil(needed)),
                                "max_posible": max_posible,
                            })

                # If ANY ingredient is short, report ALL at once — do NOT deduct anything
                if shortages:
                    raise HTTPException(
                        status_code=400,
                        detail={
                            "error": "stock_insuficiente",
                            "mensaje": "Stock insuficiente en los siguientes ingredientes",
                            "ingredientes": shortages,
                        }
                    )

                # Second pass: all validated — deduct now
                for pi in associations:
                    ing = uow.productos.get_ingrediente(pi.ingrediente_id)
                    if ing:
                        needed = (
                            _convertir_cantidad(
                                Decimal(pi.cantidad), pi.unidad_medida_id, ing.unidad_medida_id,
                                factores=factores,
                            )
                            * Decimal(diff)
                        )
                        ing.stock_actual -= int(needed)
                        uow.add(ing)

            # Task 5.3: If stock was decreased, restore ingredient stock
            elif 'stock_cantidad' in values and new_stock < old_stock:
                diff = old_stock - new_stock  # positive absolute difference
                associations = uow.productos.get_producto_ingredientes(producto_id)

                for pi in associations:
                    ing = uow.productos.get_ingrediente(pi.ingrediente_id)
                    if ing:
                        needed = (
                            _convertir_cantidad(
                                Decimal(pi.cantidad), pi.unidad_medida_id, ing.unidad_medida_id,
                                factores=factores,
                            )
                            * Decimal(diff)
                        )
                        ing.stock_actual += int(needed)
                        uow.add(ing)

            # Task 5.5: Handle ingredientes field — full replacement of ingredient list
            if nuevos_ingredientes is not None:
                # Delete all existing ingredient associations for this product
                existing = uow.productos.get_producto_ingredientes(producto_id)
                for pi in existing:
                    uow.delete(pi)

                # Create new associations from the provided list
                for ing_data in nuevos_ingredientes:
                    uow.productos.add_ingrediente_relacion(
                        producto_id=producto_id,
                        ingrediente_id=ing_data.ingrediente_id,
                        es_removible=ing_data.es_removible,
                        es_principal=ing_data.es_principal,
                        orden=ing_data.orden,
                        cantidad=ing_data.cantidad,
                        unidad_medida_id=ing_data.unidad_medida_id,
                    )

            # Validate: if precio_actual was updated, it must not be lower than precio_base
            if 'precio_actual' in values and db_producto.precio_actual < db_producto.precio_base:
                raise HTTPException(
                    status_code=400,
                    detail="El precio actual no puede ser menor al precio base"
                )

            # Validate price after updates: must be > 0 when the product
            # has no ingredients and is not an insumo (resold item).
            if not db_producto.es_insumo and not db_producto.ingredientes and db_producto.precio_base <= 0:
                raise HTTPException(
                    status_code=400,
                    detail="El precio base debe ser mayor a 0 cuando el producto no tiene ingredientes ni es de reventa"
                )

            # Recalculate price if the product has ingredients (skip for insumo)
            if not db_producto.es_insumo and db_producto.ingredientes:
                ProductoService._recalcular_precio_producto(uow, producto_id)

            uow.productos.update(db_producto)
            return db_producto

    @staticmethod
    def soft_delete(session: Session, producto_id: int):
        """Soft-delete a product by setting deleted_at.

        The row remains in the database for historical integrity.
        """
        with CatalogoDeProductosUnitOfWork(session) as uow:
            db_producto = uow.productos.get_by_id(producto_id)
            if not db_producto:
                return None

            db_producto.deleted_at = get_utc_now()
            uow.productos.update(db_producto)
            return db_producto

    @staticmethod
    def get_ingredientes(session: Session, producto_id: int):
        """Get all ingredients associated with a product."""
        with CatalogoDeProductosUnitOfWork(session) as uow:
            return uow.productos.get_ingredientes(producto_id)

    @staticmethod
    def get_categorias(session: Session, producto_id: int):
        """Get all categories associated with a product."""
        with CatalogoDeProductosUnitOfWork(session) as uow:
            return uow.productos.get_categorias(producto_id)

    @staticmethod
    def add_ingrediente(session: Session, producto_id: int, data: IngredienteAsignado):
        """Assign an ingredient to a product and recalculate the price."""
        with CatalogoDeProductosUnitOfWork(session) as uow:
            db_producto = uow.productos.get_by_id(producto_id)
            if not db_producto:
                return None
            uow.productos.add_ingrediente_relacion(
                producto_id=producto_id,
                ingrediente_id=data.ingrediente_id,
                es_removible=data.es_removible,
                es_principal=data.es_principal,
                orden=data.orden,
                cantidad=data.cantidad,
                unidad_medida_id=data.unidad_medida_id,
            )
            # Recalculate price after ingredient change (skip for insumo)
            if not db_producto.es_insumo:
                ProductoService._recalcular_precio_producto(uow, producto_id)
            return uow.productos.get_ingredientes(producto_id)

    @staticmethod
    def remove_ingrediente(session: Session, producto_id: int, ingrediente_id: int):
        """Remove an ingredient association and recalculate price."""
        with CatalogoDeProductosUnitOfWork(session) as uow:
            result = uow.productos.delete_ingrediente_relacion(producto_id, ingrediente_id)
            if result:
                # Recalculate price after ingredient removal
                ProductoService._recalcular_precio_producto(uow, producto_id)
            return result

    @staticmethod
    def update_ingrediente(session: Session, producto_id: int, ingrediente_id: int, data: "IngredienteAsignado"):
        """Update a ProductoIngrediente association (cantidad, removible, principal, unidad).

        Returns the updated ingredient list on success, None if not found.
        """
        with CatalogoDeProductosUnitOfWork(session) as uow:
            pi = uow.productos.get_producto_ingrediente(producto_id, ingrediente_id)
            if not pi:
                return None

            pi.cantidad = data.cantidad
            pi.es_removible = data.es_removible
            pi.es_principal = data.es_principal
            if data.unidad_medida_id is not None:
                pi.unidad_medida_id = data.unidad_medida_id
            uow.update(pi)

            # Recalculate price after change
            ProductoService._recalcular_precio_producto(uow, producto_id)

            return uow.productos.get_ingredientes(producto_id)

    @staticmethod
    def add_categoria(session: Session, producto_id: int, data: "CategoriaAsignada"):
        """Assign a category to a product."""
        with CatalogoDeProductosUnitOfWork(session) as uow:
            db_producto = uow.productos.get_by_id(producto_id)
            if not db_producto:
                return None
            uow.productos.add_categoria_relacion(
                producto_id=producto_id,
                categoria_id=data.categoria_id,
                es_principal=data.es_principal,
            )
            return uow.productos.get_categorias(producto_id)

    @staticmethod
    def remove_categoria(session: Session, producto_id: int, categoria_id: int):
        """Remove a category association."""
        with CatalogoDeProductosUnitOfWork(session) as uow:
            result = uow.productos.delete_categoria_relacion(producto_id, categoria_id)
            return result
