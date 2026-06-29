"""
Pedido service — the core business logic module for orders.

This is the most important file in the Sales module. It contains:
    - Order creation with detail snapshots
    - Finite State Machine (FSM) for state transitions
    - Stock deduction for products AND ingredients at confirmation time
    - Total calculation (subtotal, descuento, costo_envio, total)
    - Pre-creation stock validation
    - Cancelation with role-based permissions
    - Append-only state change history

PATTERN: Unit of Work (UoW)
    ALL operations (read and write) go through VentasPagosTrazabilidadUnitOfWork.
"""
import logging
from datetime import datetime
from sqlmodel import Session
from typing import List, Optional
from decimal import Decimal
from fastapi import HTTPException, status
from app.core.routing import get_or_404
import math
from .models import Pedido
from .schemas import PedidoRead

logger = logging.getLogger(__name__)
from .repository import SORTABLE_FIELDS
from .schemas import PedidoCreate, PedidoUpdate, ValidarStockInput, ValidarStockResponse, ValidarStockDetalleResponse
from app.core.paginated_response import PaginatedResponse
from ..uow import VentasPagosTrazabilidadUnitOfWork
from app.modules.CatalogoDeProductos.uow import CatalogoDeProductosUnitOfWork
from app.modules.IdentidadYAcceso.uow import IdentidadYAccesoUnitOfWork
from ..HistorialEstadoPedido.service import HistorialEstadoPedidoService
from ..DetallePedido.models import DetallePedido
from ..HistorialEstadoPedido.models import HistorialEstadoPedido
from app.core.base import get_utc_now
from app.core.dependencies import fire_broadcast, fire_broadcast_admin


# ---------------------------------------------------------------------------
# FINITE STATE MACHINE (FSM) definition
# ---------------------------------------------------------------------------
# Full flow:
#
#   PENDIENTE --[confirm]--> CONFIRMADO --[start prep]--> EN_PREP --[deliver]--> ENTREGADO
#       |                                                                   |
#       |  (customer or admin)                                              |
#       +--[cancel]--> CANCELADO                                            |
#
# Terminal states (no further transitions allowed):
#   - ENTREGADO: delivery completed
#   - CANCELADO: order cancelled
#
# State transition rules:
#   - Only one state advance at a time
#   - From PENDIENTE or CONFIRMADO: customer or admin can CANCEL
#   - From EN_PREP: only ADMIN/PEDIDOS can cancel
#   - ENTREGADO and CANCELADO are TERMINAL — no coming back
# ---------------------------------------------------------------------------
ESTADOS_TERMINALES = {"ENTREGADO", "CANCELADO"}

# Payment methods that only allow in-store pickup (no delivery)
PICKUP_ONLY_METHODS = {"EFECTIVO", "PAGO_LOCAL"}

TRANSICIONES_VALIDAS: dict[str, str] = {
    "PENDIENTE": "CONFIRMADO",
    "CONFIRMADO": "EN_PREP",
    "EN_PREP": "ENTREGADO",
}


class PedidoService:
    """Business logic for the Order entity — FSM, stock validation, and CRUD."""

    @staticmethod
    def _registrar_transicion(uow, pedido, estado_anterior, estado_siguiente, usuario_id=None, motivo=None):
        """Register an atomic state transition: INSERT audit trail + UPDATE order state.

        This is the ONLY place where HistorialEstadoPedido rows are created and
        where pedido.estado_codigo is modified. Both operations happen within
        the same UoW transaction to ensure atomicity.

        Args:
            uow: Active VentasPagosTrazabilidadUnitOfWork instance.
            pedido: The Pedido ORM instance to transition.
            estado_anterior: Previous state (None = creation event).
            estado_siguiente: Target state string (e.g. 'CONFIRMADO', 'CANCELADO').
            usuario_id: Who triggered the transition (None = system/webhook).
            motivo: Optional reason string (e.g. "Cancelado por usuario").
        """
        # Insert audit trail row (append-only — never modified after creation)
        uow.add(HistorialEstadoPedido(
            pedido_id=pedido.id,
            estado_desde=estado_anterior,
            estado_hacia=estado_siguiente,
            usuario_id=usuario_id,
            motivo=motivo,
            es_sistema=(usuario_id is None),
        ))
        # Update the order's current state
        pedido.estado_codigo = estado_siguiente
        uow.pedidos.add(pedido)

    @staticmethod
    def _validar_personalizacion(session: Session, producto_id: int, personalizacion: list[int]):
        """
        Validate that every ID in personalizacion belongs to a ProductoIngrediente
        with es_removible=True for the given producto_id.

        Raises HTTPException(422) if any ID is invalid or not removable.
        """
        if not personalizacion:
            return

        repo = CatalogoDeProductosUnitOfWork(session).productos
        ingredientes_asignados = repo.get_ingredientes(producto_id)

        # Build a set of valid removable ingredient IDs for this product
        # NOTE: get_ingredientes() returns list of dicts, not ORM objects
        ids_removibles = {
            ing["ingrediente_id"]
            for ing in ingredientes_asignados
            if ing["es_removible"]
        }

        invalid_ids = [i for i in personalizacion if i not in ids_removibles]
        if invalid_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "message": "IDs de ingredientes invalidos o no removibles para el producto",
                    "producto_id": producto_id,
                    "invalid_ids": invalid_ids,
                }
            )

    @staticmethod
    def get_all(session: Session, skip: int = 0, limit: int = 100) -> PaginatedResponse[PedidoRead]:
        """List ALL orders with pagination. Intended for ADMIN/PEDIDOS users."""
        with VentasPagosTrazabilidadUnitOfWork(session) as uow:
            rows = uow.pedidos.get_all_eager(skip=skip, limit=limit)
            total = uow.pedidos.count_all()
            return PaginatedResponse(
                items=[PedidoRead.model_validate(r) for r in rows],
                total=total,
                skip=skip,
                limit=limit,
            )

    @staticmethod
    def get_by_id(session: Session, pedido_id: int) -> Optional[Pedido]:
        """Fetch a single order by its primary key with eager-loaded details."""
        with VentasPagosTrazabilidadUnitOfWork(session) as uow:
            return uow.pedidos.get_by_id_eager(pedido_id)

    @staticmethod
    def get_by_id_scoped(session: Session, pedido_id: int, user) -> Pedido:
        """Fetch a single order with ownership enforcement.

        ADMIN/PEDIDOS can see any order; regular users can only see their own.
        Raises HTTPException(404) if not found, HTTPException(403) if unauthorized.
        """
        pedido = PedidoService.get_by_id(session, pedido_id)
        pedido = get_or_404(pedido, "Pedido no encontrado")
        es_gestor = any(rol.codigo in ("ADMIN", "PEDIDOS") for rol in user.roles)
        if not es_gestor and pedido.usuario_id != user.id:
            raise HTTPException(status_code=403, detail="No tienes permiso para ver este pedido")
        return pedido

    @staticmethod
    def get_by_usuario_id(session: Session, usuario_id: int, skip: int = 0, limit: int = 100) -> PaginatedResponse[PedidoRead]:
        """Fetch non-deleted orders for a specific user, newest first."""
        with VentasPagosTrazabilidadUnitOfWork(session) as uow:
            rows = uow.pedidos.get_by_usuario_id_eager(usuario_id, skip=skip, limit=limit)
            total = uow.pedidos.count_by_usuario_id(usuario_id)
            return PaginatedResponse(
                items=[PedidoRead.model_validate(r) for r in rows],
                total=total,
                skip=skip,
                limit=limit,
            )

    @staticmethod
    def get_activos(session: Session, skip: int = 0, limit: int = 100,
                    sort_by: str = "id", sort_order: str = "desc") -> PaginatedResponse[PedidoRead]:
        """Fetch non-terminal orders (not ENTREGADO or CANCELADO), with dynamic sorting.

        Used for the "active orders" dashboard.
        """
        with VentasPagosTrazabilidadUnitOfWork(session) as uow:
            rows = uow.pedidos.get_activos(skip=skip, limit=limit, sort_by=sort_by, sort_order=sort_order)
            total = uow.pedidos.count_activos()
            return PaginatedResponse(
                items=[PedidoRead.model_validate(r) for r in rows],
                total=total,
                skip=skip,
                limit=limit,
            )

    @staticmethod
    def get_activos_scoped(session: Session, user, skip: int = 0, limit: int = 100,
                           sort_by: str = "id", sort_order: str = "desc") -> PaginatedResponse[PedidoRead]:
        """Fetch active orders scoped to the user's role.

        ADMIN/PEDIDOS see all active orders; regular users only see their own.
        Sort validation is done here so the router stays thin.
        """
        if sort_by not in SORTABLE_FIELDS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"sort_by debe ser uno de: {', '.join(sorted(SORTABLE_FIELDS))}",
            )
        if sort_order not in ("asc", "desc"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="sort_order debe ser 'asc' o 'desc'",
            )

        es_gestor = any(rol.codigo in ("ADMIN", "PEDIDOS") for rol in user.roles)
        if es_gestor:
            return PedidoService.get_activos(session, skip=skip, limit=limit,
                                             sort_by=sort_by, sort_order=sort_order)
        # Regular user: filter to their own active orders
        todos_activos = PedidoService.get_activos(session, skip=0, limit=10000,
                                                   sort_by=sort_by, sort_order=sort_order)
        items_filtrados = [p for p in todos_activos.items if p.usuario_id == user.id]
        return PaginatedResponse(
            items=items_filtrados[skip:skip + limit],
            total=len(items_filtrados),
            skip=skip,
            limit=limit,
        )

    @staticmethod
    def get_historial(session: Session, skip: int = 0, limit: int = 100,
                      sort_by: str = "id", sort_order: str = "desc") -> PaginatedResponse[PedidoRead]:
        """Fetch terminal-state orders (ENTREGADO or CANCELADO), with dynamic sorting.

        Used for the order history view.
        """
        with VentasPagosTrazabilidadUnitOfWork(session) as uow:
            rows = uow.pedidos.get_historial(skip=skip, limit=limit, sort_by=sort_by, sort_order=sort_order)
            total = uow.pedidos.count_historial()
            return PaginatedResponse(
                items=[PedidoRead.model_validate(r) for r in rows],
                total=total,
                skip=skip,
                limit=limit,
            )

    @staticmethod
    def get_historial_by_usuario(session: Session, usuario_id: int, skip: int = 0, limit: int = 100) -> PaginatedResponse[PedidoRead]:
        """Fetch terminal-state orders for a specific user, most recently updated first."""
        with VentasPagosTrazabilidadUnitOfWork(session) as uow:
            rows = uow.pedidos.get_historial_by_usuario(usuario_id, skip=skip, limit=limit)
            total = uow.pedidos.count_by_usuario_id(usuario_id)
            return PaginatedResponse(
                items=[PedidoRead.model_validate(r) for r in rows],
                total=total,
                skip=skip,
                limit=limit,
            )

    @staticmethod
    def get_historial_scoped(session: Session, pedido_id: int, user):
        """Return full state history for an order with ownership enforcement.

        ADMIN/PEDIDOS can see any order's history; regular users can only see their own.
        Delegates the actual history retrieval to HistorialEstadoPedidoService internally.
        """
        pedido = PedidoService.get_by_id(session, pedido_id)
        pedido = get_or_404(pedido, "Pedido no encontrado")
        es_gestor = any(rol.codigo in ("ADMIN", "PEDIDOS") for rol in user.roles)
        if not es_gestor and pedido.usuario_id != user.id:
            raise HTTPException(status_code=403, detail="No tienes permiso para ver este pedido")
        return HistorialEstadoPedidoService.get_by_pedido(session, pedido_id)

    @staticmethod
    def create(session: Session, data: PedidoCreate, ws_manager=None) -> Pedido:
        """Create a new order with full integrity checks.

        Step-by-step logic:
        1. Auto-select the user's primary delivery address if none specified
        2. Load the address and capture direccion_snapshot
        3. Validate stock for ALL products BEFORE inserting anything
        4. Calculate subtotal and total on the server from detail snapshots
        5. Create the Pedido row with estado_codigo = "PENDIENTE"
        6. Create DetallePedido rows with price/name snapshots
        7. Register the creation event in HistorialEstadoPedido (estado_desde=NULL)
        8. After commit: broadcast to admin room

        Atomicity: everything happens inside a single UoW. If any step fails
        (stock validation, ingredient validation, DB constraint), the entire
        transaction is rolled back. No partial orders.
        """
        # ── Pickup-only payment methods: EFECTIVO and PAGO_LOCAL do NOT support delivery ──
        if data.forma_pago_codigo in PICKUP_ONLY_METHODS:
            if data.direccion_id is not None:
                raise HTTPException(
                    status_code=422,
                    detail="Este metodo de pago no admite envio a domicilio. direccion_id debe ser null.",
                )

        # Auto-select user's primary address if none provided
        # (skip for pickup-only methods: they don't need a delivery address)
        if data.direccion_id is None and data.forma_pago_codigo not in PICKUP_ONLY_METHODS:
            direccion_repo = IdentidadYAccesoUnitOfWork(session).direcciones
            principal = direccion_repo.get_principal(data.usuario_id)
            if principal:
                data.direccion_id = principal.id

        # Load address and create snapshot BEFORE the transaction
        direccion_snapshot = None
        if data.direccion_id is not None:
            direccion_repo = IdentidadYAccesoUnitOfWork(session).direcciones
            direccion = direccion_repo.get_by_id(data.direccion_id)
            if direccion:
                direccion_snapshot = {
                    "linea1": getattr(direccion, "linea1", None),
                    "linea2": getattr(direccion, "linea2", None),
                    "ciudad": getattr(direccion, "ciudad", None),
                }

        with VentasPagosTrazabilidadUnitOfWork(session) as uow:
            # Force costo_envio=0 for pickup-only payment methods
            if data.forma_pago_codigo in PICKUP_ONLY_METHODS:
                data.costo_envio = Decimal('0.00')

            costo_envio = data.costo_envio if data.direccion_id else Decimal('0.00')

            # ── Step 1: Pre-validate stock for ALL products ──
            producto_repo = CatalogoDeProductosUnitOfWork(session).productos
            if data.detalles:
                for det in data.detalles:
                    producto = producto_repo.get_by_id(det.producto_id)
                    get_or_404(producto, f"Producto ID {det.producto_id} no encontrado")
                    if producto.stock_cantidad < det.cantidad:
                        raise HTTPException(
                            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={
                                "error": "stock_insuficiente",
                                "mensaje": f"Stock insuficiente para '{producto.nombre}'",
                                "producto_id": det.producto_id,
                                "solicitado": det.cantidad,
                                "disponible": producto.stock_cantidad,
                            },
                        )

                    # Validate ingredient exclusions
                    if det.personalizacion:
                        PedidoService._validar_personalizacion(session, det.producto_id, det.personalizacion)

            # ── Step 2: Calculate totals server-side ──
            subtotal_calculado = Decimal('0')
            if data.detalles:
                for det in data.detalles:
                    subtotal_calculado += det.precio_snapshot * det.cantidad

            total = subtotal_calculado - data.descuento + costo_envio
            if total < 0:
                raise ValueError("El total no puede ser negativo")

            # ── Step 3: Create the Pedido ──
            db_pedido = Pedido(
                usuario_id=data.usuario_id,
                direccion_id=data.direccion_id,
                direccion_snapshot=direccion_snapshot,
                estado_codigo="PENDIENTE",
                forma_pago_codigo=data.forma_pago_codigo,
                subtotal=subtotal_calculado,
                descuento=data.descuento,
                costo_envio=costo_envio,
                total=total,
                notas=data.notas,
            )
            uow.add(db_pedido)
            uow.flush()

            # ── Step 4: Create DetallePedido rows ──
            if data.detalles:
                for det in data.detalles:
                    line_total = det.precio_snapshot * det.cantidad
                    uow.add(DetallePedido(
                        pedido_id=db_pedido.id,
                        producto_id=det.producto_id,
                        cantidad=det.cantidad,
                        nombre_snapshot=det.nombre_snapshot,
                        precio_snapshot=det.precio_snapshot,
                        subtotal_snap=line_total,
                        personalizacion=det.personalizacion,
                    ))

            # ── Step 5: Register creation in history ──
            PedidoService._registrar_transicion(
                uow,
                pedido=db_pedido,
                estado_anterior=None,
                estado_siguiente="PENDIENTE",
                usuario_id=data.usuario_id,
            )

            uow.refresh(db_pedido)
            result_pedido = db_pedido

        # ── AFTER UoW commit: broadcast new order to admin room ──
        if ws_manager is not None:
            payload = {
                "event": "estado_cambiado",
                "pedido_id": result_pedido.id,
                "estado_anterior": None,
                "estado_nuevo": "PENDIENTE",
                "usuario_id": data.usuario_id,
                "motivo": None,
                "timestamp": datetime.utcnow().isoformat(),
            }
            fire_broadcast_admin(ws_manager, payload)

        # Auto-confirm PAGO_LOCAL orders (payment happens in person at the store)
        if data.forma_pago_codigo == "PAGO_LOCAL" and ws_manager is not None:
            class _SistemaUser:
                id = None
            PedidoService.avanzar_estado(session, result_pedido.id, _SistemaUser(), ws_manager=ws_manager)

        return result_pedido

    @staticmethod
    def validar_stock_items(session: Session, data: ValidarStockInput) -> ValidarStockResponse:
        """Validate stock availability WITHOUT creating an order or any side effects.

        This is a READ-ONLY check used by the frontend cart to show stock
        errors in real-time. The REAL stock validation (with deduction)
        happens in avanzar_estado when the order transitions to CONFIRMADO.
        """
        with VentasPagosTrazabilidadUnitOfWork(session) as uow:
            errores: list[ValidarStockDetalleResponse] = []

            for det in data.detalles:
                prod = uow.pedidos.get_producto(det.producto_id)
                if not prod:
                    raise HTTPException(status_code=404, detail=f"Producto {det.producto_id} no encontrado")
                stock_disp = prod.stock_cantidad
                if stock_disp < det.cantidad:
                    errores.append(ValidarStockDetalleResponse(
                        producto_id=det.producto_id,
                        nombre_producto=prod.nombre,
                        cantidad_solicitada=det.cantidad,
                        stock_disponible=stock_disp,
                    ))

            return ValidarStockResponse(
                valido=len(errores) == 0,
                detalles=errores,
            )

    @staticmethod
    def actualizar_detalle(session: Session, pedido_id: int, producto_id: int, cantidad: int) -> Pedido:
        """Update or remove a detail line on a PENDIENTE order.

        cantidad=0 removes the detail line.
        Only works on PENDIENTE orders — once CONFIRMADO, details are frozen
        because stock has already been deducted.

        After modification, subtotal and total are recalculated from the
        remaining details' subtotal_snap values.
        """
        with VentasPagosTrazabilidadUnitOfWork(session) as uow:
            db_pedido = uow.pedidos.get_by_id_eager(pedido_id)
            get_or_404(db_pedido, "Pedido no encontrado")
            if db_pedido.estado_codigo != "PENDIENTE":
                raise HTTPException(status_code=400, detail="Solo se pueden modificar detalles en pedidos PENDIENTE")

            detalle = uow.pedidos.get_detalle_by_producto(pedido_id, producto_id)
            get_or_404(detalle, "Detalle no encontrado en el pedido")

            if cantidad <= 0:
                uow.delete(detalle)
            else:
                detalle.cantidad = cantidad
                detalle.subtotal_snap = detalle.precio_snapshot * cantidad
                uow.add(detalle)

            # Recalculate order totals from remaining details
            detalles_restantes = uow.pedidos.get_detalles(pedido_id)
            nuevo_subtotal = sum(d.subtotal_snap for d in detalles_restantes)
            db_pedido = uow.pedidos.get_by_id(pedido_id)
            db_pedido.subtotal = nuevo_subtotal
            db_pedido.total = nuevo_subtotal - db_pedido.descuento + (db_pedido.costo_envio or Decimal('0.00'))
            if db_pedido.total < 0:
                db_pedido.total = Decimal('0.00')
            uow.add(db_pedido)
            uow.refresh(db_pedido)
            return db_pedido

    @staticmethod
    def avanzar_estado(session: Session, pedido_id: int, usuario, ws_manager=None) -> tuple[Pedido, str]:
        """Advance the order to the next FSM state.

        This is the CORE state transition method. Flow:
        1. Fetch the order, validate it exists
        2. Check it's not in a terminal state
        3. Look up the next state from TRANSICIONES_VALIDAS
        4. If transitioning to CONFIRMADO and NOT MERCADOPAGO:
            a. Validate product stock sufficiency
            b. Validate ingredient stock sufficiency
            c. Deduct product stock (stock_cantidad -= cantidad)
            d. Deduct ingredient stock (stock_actual -= pi.cantidad * det.cantidad)
            (MercadoPago orders are blocked here — they go through the IPN webhook)
        5. Register the change in HistorialEstadoPedido (append-only)
        6. Broadcast to pedido room + admin room AFTER UoW commit
        7. Return (pedido, estado_anterior)

        IMPORTANT: The result is computed inside the UoW block, committed via
        __exit__, and the broadcast happens OUTSIDE the block. This ensures
        clients are only notified after the transaction is durable.
        """
        usuario_id = usuario.id if hasattr(usuario, 'id') else None

        with VentasPagosTrazabilidadUnitOfWork(session) as uow:
            db_pedido = uow.pedidos.get_by_id(pedido_id)
            get_or_404(db_pedido, "Pedido no encontrado")

            estado_anterior = db_pedido.estado_codigo
            if estado_anterior in ESTADOS_TERMINALES:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"El pedido ya está en estado terminal '{estado_anterior}'",
                )

            if estado_anterior not in TRANSICIONES_VALIDAS:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"No hay transición definida desde '{estado_anterior}'",
                )

            estado_siguiente = TRANSICIONES_VALIDAS[estado_anterior]

            # PENDIENTE -> CONFIRMADO: allowed for non-MP payment methods (PAGO_LOCAL, EFECTIVO)
            # MERCADOPAGO orders MUST go through the IPN webhook (PagoService.process_webhook)
            if estado_siguiente == "CONFIRMADO" and db_pedido.forma_pago_codigo == "MERCADOPAGO":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="La confirmacion del pedido con MercadoPago solo puede realizarse mediante pago aprobado",
                )

            # For non-MP PENDIENTE->CONFIRMADO: validate and deduct stock here.
            # For MercadoPago orders, the webhook blocks above and stock is handled
            # by confirmar_por_pago() called from PagoService.process_webhook().
            if estado_siguiente == "CONFIRMADO":
                # Validate product stock
                errores_stock: list[dict] = []
                for det in db_pedido.detalles:
                    prod = uow.pedidos.get_producto(det.producto_id)
                    stock_disp = prod.stock_cantidad if prod else 0
                    if stock_disp < det.cantidad:
                        errores_stock.append({
                            "producto_id": det.producto_id,
                            "nombre_producto": det.nombre_snapshot,
                            "cantidad_solicitada": det.cantidad,
                            "stock_disponible": stock_disp,
                        })

                if errores_stock:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail={
                            "error": "stock_insuficiente",
                            "mensaje": "Stock insuficiente para confirmar el pedido.",
                            "detalles": errores_stock,
                        },
                    )

                # Validate ingredient stock
                errores_ing_stock: list[dict] = []
                for det in db_pedido.detalles:
                    for pi in uow.pedidos.get_producto_ingredientes(det.producto_id):
                        cantidad_needed = pi.cantidad * det.cantidad
                        ing = uow.pedidos.get_ingrediente(pi.ingrediente_id)
                        if ing and ing.stock_actual < cantidad_needed:
                            errores_ing_stock.append({
                                "ingrediente": ing.nombre,
                                "disponible": ing.stock_actual,
                                "requerido": int(math.ceil(cantidad_needed)),
                            })

                if errores_ing_stock:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail={
                            "error": "stock_insuficiente",
                            "ingredientes": errores_ing_stock,
                        },
                    )

                # Deduct product stock
                for det in db_pedido.detalles:
                    prod = uow.pedidos.get_producto(det.producto_id)
                    if prod:
                        prod.stock_cantidad = max(0, prod.stock_cantidad - det.cantidad)
                        uow.add(prod)

                # Deduct ingredient stock
                for det in db_pedido.detalles:
                    for pi in uow.pedidos.get_producto_ingredientes(det.producto_id):
                        cantidad_a_descontar = int(math.ceil(pi.cantidad * det.cantidad))
                        ing = uow.pedidos.get_ingrediente(pi.ingrediente_id)
                        if ing:
                            ing.stock_actual = max(0, ing.stock_actual - cantidad_a_descontar)
                            uow.add(ing)

            # Atomic transition: audit trail + state update
            PedidoService._registrar_transicion(
                uow,
                pedido=db_pedido,
                estado_anterior=estado_anterior,
                estado_siguiente=estado_siguiente,
                usuario_id=usuario_id,
            )

            # Save results for use AFTER commit
            result_pedido = db_pedido
            result_estado_anterior = estado_anterior
            result_estado_siguiente = estado_siguiente

        # ── AFTER UoW commit: broadcast to WebSocket clients ──
        if ws_manager is not None:
            payload = {
                "event": "estado_cambiado",
                "pedido_id": result_pedido.id,
                "estado_anterior": result_estado_anterior,
                "estado_nuevo": result_estado_siguiente,
                "usuario_id": usuario_id,
                "motivo": None,
                "timestamp": datetime.utcnow().isoformat(),
            }
            fire_broadcast(ws_manager, result_pedido.id, payload)
            fire_broadcast_admin(ws_manager, payload)

        return (result_pedido, result_estado_anterior)

    @staticmethod
    def crear_desde_snapshot(
        session: Session,
        snapshot,
        snapshot_repo=None,
    ) -> Pedido:
        """Create a complete Pedido from a carrito_snapshot after MP payment approval.

        This is the POST-PAGO creation path. The Pedido is created in CONFIRMADO
        state directly (bypassing PENDIENTE) because payment is already confirmed.

        Steps (all inside a single UoW):
        1. Validate product stock for all snapshot items
        2. Validate ingredient stock
        3. Create Pedido in CONFIRMADO state with snapshot monetary data
        4. Create DetallePedido rows with name/price snapshots
        5. Deduct product stock
        6. Deduct ingredient stock
        7. Register creation in HistorialEstadoPedido (estado_desde=NULL)
        8. Delete the carrito_snapshot row atomically

        Atomicity: If any step fails, the entire UoW rolls back, preserving
        the snapshot for retry.

        Args:
            session: SQLModel database session.
            snapshot: CarritoSnapshot ORM instance.
            snapshot_repo: Optional CarritoSnapshotRepository (uses UoW's if None).

        Returns:
            The newly created Pedido ORM instance.

        Raises:
            HTTPException(409): If stock is insufficient at creation time.
        """
        from ..CarritoSnapshot.repository import CarritoSnapshotRepository

        with VentasPagosTrazabilidadUnitOfWork(session) as uow:
            # ── Step 1: Validate product stock ──
            producto_repo = CatalogoDeProductosUnitOfWork(session).productos
            errores_stock: list[dict] = []

            for item_dict in snapshot.items:
                producto_id = item_dict.get("producto_id")
                cantidad = item_dict.get("cantidad", 0)
                nombre = item_dict.get("nombre", str(producto_id))

                producto = producto_repo.get_by_id(producto_id)
                if not producto:
                    errores_stock.append({
                        "producto_id": producto_id,
                        "nombre_producto": nombre,
                        "cantidad_solicitada": cantidad,
                        "stock_disponible": 0,
                        "error": "producto_no_encontrado",
                    })
                    continue

                if producto.stock_cantidad < cantidad:
                    errores_stock.append({
                        "producto_id": producto_id,
                        "nombre_producto": producto.nombre,
                        "cantidad_solicitada": cantidad,
                        "stock_disponible": producto.stock_cantidad,
                    })

            if errores_stock:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "error": "stock_insuficiente",
                        "mensaje": "Stock insuficiente para confirmar el pedido por pago.",
                        "detalles": errores_stock,
                    },
                )

            # ── Step 2: Validate ingredient stock ──
            errores_ing_stock: list[dict] = []
            for item_dict in snapshot.items:
                producto_id = item_dict.get("producto_id")
                cantidad = item_dict.get("cantidad", 0)
                ingredientes_excluidos = set(item_dict.get("ingredientes_excluidos") or [])

                for pi in uow.pedidos.get_producto_ingredientes(producto_id):
                    # Skip ingredients that were excluded by the user
                    if pi.ingrediente_id in ingredientes_excluidos:
                        continue

                    cantidad_needed = pi.cantidad * cantidad
                    ing = uow.pedidos.get_ingrediente(pi.ingrediente_id)
                    if ing and ing.stock_actual < cantidad_needed:
                        errores_ing_stock.append({
                            "ingrediente": ing.nombre,
                            "disponible": ing.stock_actual,
                            "requerido": int(math.ceil(cantidad_needed)),
                        })

            if errores_ing_stock:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "error": "stock_insuficiente",
                        "ingredientes": errores_ing_stock,
                    },
                )

            # ── Step 3: Create the Pedido ──
            db_pedido = Pedido(
                usuario_id=snapshot.usuario_id,
                direccion_id=snapshot.direccion_id,
                direccion_snapshot=snapshot.direccion_snapshot,
                estado_codigo="CONFIRMADO",
                forma_pago_codigo=snapshot.forma_pago_codigo,
                subtotal=snapshot.subtotal,
                descuento=Decimal("0.00"),
                costo_envio=snapshot.costo_envio,
                total=snapshot.total,
                notas=snapshot.notas,
            )
            uow.add(db_pedido)
            uow.flush()

            # ── Step 4: Create DetallePedido rows ──
            for item_dict in snapshot.items:
                producto_id = item_dict.get("producto_id")
                cantidad = item_dict.get("cantidad", 0)
                nombre = item_dict.get("nombre", "")
                precio = Decimal(str(item_dict.get("precio", "0.00")))
                ingredientes_excluidos = item_dict.get("ingredientes_excluidos") or []
                line_total = precio * cantidad

                uow.add(DetallePedido(
                    pedido_id=db_pedido.id,
                    producto_id=producto_id,
                    cantidad=cantidad,
                    nombre_snapshot=nombre,
                    precio_snapshot=precio,
                    subtotal_snap=line_total,
                    personalizacion=ingredientes_excluidos if ingredientes_excluidos else None,
                ))

            # ── Step 5: Deduct product stock ──
            for item_dict in snapshot.items:
                producto_id = item_dict.get("producto_id")
                cantidad = item_dict.get("cantidad", 0)

                prod = uow.pedidos.get_producto(producto_id)
                if prod:
                    prod.stock_cantidad = max(0, prod.stock_cantidad - cantidad)
                    uow.add(prod)

            # ── Step 6: Deduct ingredient stock ──
            for item_dict in snapshot.items:
                producto_id = item_dict.get("producto_id")
                cantidad = item_dict.get("cantidad", 0)
                ingredientes_excluidos = set(item_dict.get("ingredientes_excluidos") or [])

                for pi in uow.pedidos.get_producto_ingredientes(producto_id):
                    if pi.ingrediente_id in ingredientes_excluidos:
                        continue
                    cantidad_a_descontar = int(math.ceil(pi.cantidad * cantidad))
                    ing = uow.pedidos.get_ingrediente(pi.ingrediente_id)
                    if ing:
                        ing.stock_actual = max(0, ing.stock_actual - cantidad_a_descontar)
                        uow.add(ing)

            # ── Step 7: Register creation in history ──
            PedidoService._registrar_transicion(
                uow,
                pedido=db_pedido,
                estado_anterior=None,
                estado_siguiente="CONFIRMADO",
                usuario_id=None,  # System — triggered by webhook
            )

            # ── Step 8: Delete the snapshot atomically ──
            # Need to reload snapshot in this UoW's session
            snapshot_to_delete = uow.snapshots.get_by_external_reference(
                snapshot.external_reference
            )
            if snapshot_to_delete:
                uow.snapshots.delete(snapshot_to_delete)

            uow.refresh(db_pedido)
            return db_pedido

    @staticmethod
    def confirmar_por_pago(session: Session, pedido_id: int) -> Pedido:
        """DEPRECATED: Advance PENDIENTE -> CONFIRMADO via payment webhook.

        This method is DEPRECATED for the MercadoPago flow. It is replaced by
        crear_desde_snapshot() which creates the Pedido directly in CONFIRMADO
        state instead of advancing from PENDIENTE.

        The method is kept for backward compatibility with tests and to serve
        as documentation of the original flow. It should NOT be called from
        process_webhook() anymore.

        Original docstring follows:

        Called by PagoService.process_webhook() when MercadoPago reports
        an approved payment. For MERCADOPAGO orders this is the ONLY way
        PENDIENTE advances to CONFIRMADO — the API endpoint blocks the
        MP transition in avanzar_estado.
        Non-MP methods (PAGO_LOCAL, EFECTIVO) transition directly via
        avanzar_estado, which also validates/deducts stock.

        Flow:
        1. Validate the order exists and is PENDIENTE
        2. Validate product stock sufficiency
        3. Validate ingredient stock sufficiency
        4. Deduct product stock (stock_cantidad -= cantidad)
        5. Deduct ingredient stock
        6. Register the transition in HistorialEstadoPedido (append-only)
        7. Return the updated Pedido

        NOTE: Does NOT create a new MP payment — the Pago record already
        exists from init_mp_payment() called by the frontend.
        """
        with VentasPagosTrazabilidadUnitOfWork(session) as uow:
            db_pedido = uow.pedidos.get_by_id_eager(pedido_id)
            get_or_404(db_pedido, "Pedido no encontrado")

            if db_pedido.estado_codigo != "PENDIENTE":
                logger.warning(
                    "confirmar_por_pago: pedido %s is %s, not PENDIENTE",
                    pedido_id, db_pedido.estado_codigo,
                )
                # Not an error — webhook may arrive after already confirmed
                return db_pedido

            # Stock validation — product level
            errores_stock: list[dict] = []
            for det in db_pedido.detalles:
                prod = uow.pedidos.get_producto(det.producto_id)
                stock_disp = prod.stock_cantidad if prod else 0
                if stock_disp < det.cantidad:
                    errores_stock.append({
                        "producto_id": det.producto_id,
                        "nombre_producto": det.nombre_snapshot,
                        "cantidad_solicitada": det.cantidad,
                        "stock_disponible": stock_disp,
                    })

            if errores_stock:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "error": "stock_insuficiente",
                        "mensaje": "Stock insuficiente para confirmar el pedido por pago.",
                        "detalles": errores_stock,
                    },
                )

            # Stock validation — ingredient level
            errores_ing_stock: list[dict] = []
            for det in db_pedido.detalles:
                for pi in uow.pedidos.get_producto_ingredientes(det.producto_id):
                    cantidad_needed = pi.cantidad * det.cantidad
                    ing = uow.pedidos.get_ingrediente(pi.ingrediente_id)
                    if ing and ing.stock_actual < cantidad_needed:
                        errores_ing_stock.append({
                            "ingrediente": ing.nombre,
                            "disponible": ing.stock_actual,
                            "requerido": int(math.ceil(cantidad_needed)),
                        })

            if errores_ing_stock:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "error": "stock_insuficiente",
                        "ingredientes": errores_ing_stock,
                    },
                )

            # Deduct product stock
            for det in db_pedido.detalles:
                prod = uow.pedidos.get_producto(det.producto_id)
                if prod:
                    prod.stock_cantidad = max(0, prod.stock_cantidad - det.cantidad)
                    uow.add(prod)

            # Deduct ingredient stock
            for det in db_pedido.detalles:
                for pi in uow.pedidos.get_producto_ingredientes(det.producto_id):
                    cantidad_a_descontar = int(math.ceil(pi.cantidad * det.cantidad))
                    ing = uow.pedidos.get_ingrediente(pi.ingrediente_id)
                    if ing:
                        ing.stock_actual = max(0, ing.stock_actual - cantidad_a_descontar)
                        uow.add(ing)

            # Register transition: PENDIENTE -> CONFIRMADO
            PedidoService._registrar_transicion(
                uow,
                pedido=db_pedido,
                estado_anterior="PENDIENTE",
                estado_siguiente="CONFIRMADO",
                usuario_id=None,  # System user — triggered by webhook
            )

            return db_pedido

    @staticmethod
    def cancelar_pedido(session: Session, pedido_id: int, usuario, motivo: str = "Cancelado por usuario", ws_manager=None) -> Pedido:
        """Cancel an order. Only PENDIENTE, CONFIRMADO, or EN_PREP orders can be cancelled.

        Permission rules:
            - ALL roles can only cancel PENDIENTE or CONFIRMADO orders
            - Stock is restored if cancelling from CONFIRMADO or EN_PREP (previously deducted)
            - ENTREGADO and CANCELADO cannot be cancelled

        Args:
            motivo: User-provided cancellation reason (replaces hardcoded string).
            ws_manager: Optional WSManager for broadcasting the cancellation event.
        """
        usuario_id = usuario.id if hasattr(usuario, 'id') else None

        with VentasPagosTrazabilidadUnitOfWork(session) as uow:
            db_pedido = uow.pedidos.get_by_id(pedido_id)
            get_or_404(db_pedido, "Pedido no encontrado")

            estado_actual = db_pedido.estado_codigo
            if estado_actual in ESTADOS_TERMINALES:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"El pedido ya está en estado terminal '{estado_actual}'",
                )

            # Only PENDIENTE, CONFIRMADO and EN_PREP can be cancelled
            estados_permitidos_cancelar = {"PENDIENTE", "CONFIRMADO", "EN_PREP"}
            if estado_actual not in estados_permitidos_cancelar:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"No se puede cancelar un pedido en estado '{estado_actual}'",
                )

            # Restore stock if cancelling from CONFIRMADO or EN_PREP (stock was deducted at confirmation)
            if estado_actual in ("CONFIRMADO", "EN_PREP"):
                for det in db_pedido.detalles:
                    prod = uow.pedidos.get_producto(det.producto_id)
                    if prod:
                        prod.stock_cantidad += det.cantidad
                        uow.add(prod)

                    # Restore ingredient stock
                    for pi in uow.pedidos.get_producto_ingredientes(det.producto_id):
                        cantidad_a_restaurar = int(math.ceil(pi.cantidad * det.cantidad))
                        ing = uow.pedidos.get_ingrediente(pi.ingrediente_id)
                        if ing:
                            ing.stock_actual += cantidad_a_restaurar
                            uow.add(ing)

            PedidoService._registrar_transicion(
                uow,
                pedido=db_pedido,
                estado_anterior=estado_actual,
                estado_siguiente="CANCELADO",
                usuario_id=usuario_id,
                motivo=motivo,
            )

            # Save result for use AFTER commit
            result_pedido = db_pedido
            result_estado_anterior = estado_actual

        # ── AFTER UoW commit: broadcast to WebSocket clients ──
        if ws_manager is not None:
            payload = {
                "event": "pedido_cancelado",
                "pedido_id": result_pedido.id,
                "estado_anterior": result_estado_anterior,
                "estado_nuevo": "CANCELADO",
                "usuario_id": usuario_id,
                "motivo": motivo,
                "timestamp": datetime.utcnow().isoformat(),
            }
            fire_broadcast(ws_manager, result_pedido.id, payload)
            fire_broadcast_admin(ws_manager, payload)

        return result_pedido

    @staticmethod
    def update(session: Session, pedido_id: int, data: PedidoUpdate) -> Optional[Pedido]:
        """Update order metadata and/or replace detail lines.

        Allowed for any authenticated user with ADMIN/PEDIDOS role.
        Only provided fields are applied (exclude_unset=True).
        Does NOT modify state — that has a dedicated endpoint.

        When `detalles` is provided:
        - Only works on PENDIENTE orders (stock already deducted for CONFIRMADO+)
        - ALL existing details are replaced with the new ones
        - Subtotal and total are recalculated from the new details' subtotal_snap
        """
        with VentasPagosTrazabilidadUnitOfWork(session) as uow:
            db_pedido = uow.pedidos.get_by_id(pedido_id)
            if not db_pedido:
                return None

            values = data.model_dump(exclude_unset=True)

            # Handle detail replacement (only for PENDIENTE orders)
            if 'detalles' in values:
                if db_pedido.estado_codigo != "PENDIENTE":
                    raise HTTPException(
                        status_code=400,
                        detail="Solo se pueden modificar los detalles de pedidos en estado PENDIENTE",
                    )

                # Remove all existing details
                for det in uow.pedidos.get_detalles(pedido_id):
                    uow.delete(det)

                # Add new details from the request
                nuevo_subtotal = Decimal('0')
                for det in data.detalles:
                    # Validate ingredient exclusions before creating the detail
                    if det.personalizacion:
                        PedidoService._validar_personalizacion(session, det.producto_id, det.personalizacion)

                    line_total = det.precio_snapshot * det.cantidad
                    nuevo_subtotal += line_total
                    uow.add(DetallePedido(
                        pedido_id=pedido_id,
                        producto_id=det.producto_id,
                        cantidad=det.cantidad,
                        nombre_snapshot=det.nombre_snapshot,
                        precio_snapshot=det.precio_snapshot,
                        subtotal_snap=line_total,
                        personalizacion=det.personalizacion,
                    ))

                # Recalculate order totals
                db_pedido.subtotal = nuevo_subtotal
                db_pedido.total = nuevo_subtotal - db_pedido.descuento + (db_pedido.costo_envio or Decimal('0.00'))
                if db_pedido.total < 0:
                    db_pedido.total = Decimal('0.00')

                # Remove 'detalles' from values to avoid setattr on the field (not a column)
                del values['detalles']

            # Apply remaining metadata fields
            for key, value in values.items():
                setattr(db_pedido, key, value)

            uow.add(db_pedido)
            uow.refresh(db_pedido)
            return db_pedido

    @staticmethod
    def soft_delete(session: Session, pedido_id: int) -> bool:
        """Soft-delete an order by setting deleted_at.

        The row remains in the database for reporting/historical purposes,
        but is excluded from normal queries (WHERE deleted_at IS NULL).
        """
        with VentasPagosTrazabilidadUnitOfWork(session) as uow:
            db_pedido = uow.pedidos.get_by_id(pedido_id)
            if not db_pedido:
                return False
            db_pedido.deleted_at = get_utc_now()
            uow.add(db_pedido)
            return True
