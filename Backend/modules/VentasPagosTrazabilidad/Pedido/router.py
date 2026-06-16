"""
Pedido router — API endpoints for order management.

Request flow: HTTP -> FastAPI (Pydantic validation) -> Router -> Service -> DB
Response flow: DB -> Service -> Pydantic schema -> JSON

Auth:
    - require_roles(["ADMIN", "PEDIDOS"]) = restricted to admins/order managers
    - get_current_user = any authenticated user
    - No decorator = public access

Prefix: /pedidos
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query, Body, WebSocket, WebSocketException
from sqlmodel import Session
from typing import List
from core.database import get_session
from core.paginated_response import PaginatedResponse
from core.security import decode_token
from core.websocket_manager import WSManager
from core.dependencies import get_ws_manager
from modules.IdentidadYAcceso.Auth.dependencies import require_roles, get_current_user
from modules.IdentidadYAcceso.Usuario.models import Usuario
from modules.IdentidadYAcceso.Usuario.repository import UsuarioRepository
from .service import PedidoService
from .schemas import (
    PedidoRead, PedidoCreate, PedidoUpdate,
    PedidoAvanzarResponse, PedidoCancelarResponse,
    CancelarPedidoInput,
    DetallePedidoUpdate,
    ValidarStockInput, ValidarStockResponse,
)
from ..HistorialEstadoPedido.service import HistorialEstadoPedidoService
from ..HistorialEstadoPedido.schemas import HistorialRead
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pedidos", tags=["Pedidos"])


@router.get("/", response_model=PaginatedResponse[PedidoRead],
            dependencies=[Depends(require_roles(["ADMIN", "PEDIDOS"]))])
def read_all(
    skip: int = Query(0),
    limit: int = Query(100),
    session: Session = Depends(get_session),
):
    """GET /pedidos — List ALL orders with pagination. Requires ADMIN or PEDIDOS role."""
    return PedidoService.get_all(session, skip=skip, limit=limit)


@router.get("/activos", response_model=PaginatedResponse[PedidoRead])
def read_activos(
    skip: int = Query(0),
    limit: int = Query(100),
    session: Session = Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
):
    """GET /pedidos/activos — List active (non-terminal) orders.

    ADMIN/PEDIDOS see all active orders; regular users only see their own.
    """
    es_gestor = any(rol.codigo in ("ADMIN", "PEDIDOS") for rol in current_user.roles)
    if es_gestor:
        return PedidoService.get_activos(session, skip=skip, limit=limit)
    # Regular user: filter to their own active orders
    todos_activos = PedidoService.get_activos(session, skip=0, limit=10000)
    items_filtrados = [p for p in todos_activos.items if p.usuario_id == current_user.id]
    return PaginatedResponse(
        items=items_filtrados[skip:skip + limit],
        total=len(items_filtrados),
        skip=skip,
        limit=limit,
    )


@router.get("/historial", response_model=PaginatedResponse[PedidoRead])
def read_historial(
    skip: int = Query(0),
    limit: int = Query(100),
    session: Session = Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
):
    """GET /pedidos/historial — List terminal-state orders (ENTREGADO, CANCELADO).

    ADMIN/PEDIDOS see all history; regular users only see their own.
    """
    es_gestor = any(rol.codigo in ("ADMIN", "PEDIDOS") for rol in current_user.roles)
    if es_gestor:
        return PedidoService.get_historial(session, skip=skip, limit=limit)
    return PedidoService.get_historial_by_usuario(session, current_user.id, skip=skip, limit=limit)


@router.get("/mis-pedidos", response_model=PaginatedResponse[PedidoRead])
def read_mis_pedidos(
    skip: int = Query(0),
    limit: int = Query(100),
    session: Session = Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
):
    """GET /pedidos/mis-pedidos — List orders belonging to the authenticated user.

    Used for the "My Orders" section in the customer profile.
    """
    return PedidoService.get_by_usuario_id(session, current_user.id, skip=skip, limit=limit)


@router.get("/{pedido_id}", response_model=PedidoRead)
def read_one(
    pedido_id: int,
    session: Session = Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
):
    """GET /pedidos/{id} — Get a single order by its ID.

    ADMIN/PEDIDOS can see any order; regular users can only see their own.
    """
    obj = PedidoService.get_by_id(session, pedido_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")

    # Regular users cannot view other users' orders
    if not any(rol.codigo in ("ADMIN", "PEDIDOS") for rol in current_user.roles):
        if obj.usuario_id != current_user.id:
            raise HTTPException(status_code=403, detail="No tienes permiso para ver este pedido")
    return obj


@router.get("/{pedido_id}/historial", response_model=List[HistorialRead])
def read_historial_pedido(
    pedido_id: int,
    session: Session = Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
):
    """GET /pedidos/{id}/historial — Get full state transition history for an order.

    ADMIN/PEDIDOS can see any order's history; regular users can only see their own.
    Returns the audit trail ordered from oldest to newest, with timestamps.
    """
    # First verify the order exists and user has access (same scoping as read_one)
    obj = PedidoService.get_by_id(session, pedido_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")

    if not any(rol.codigo in ("ADMIN", "PEDIDOS") for rol in current_user.roles):
        if obj.usuario_id != current_user.id:
            raise HTTPException(status_code=403, detail="No tienes permiso para ver este pedido")

    return HistorialEstadoPedidoService.get_by_pedido(session, pedido_id)


@router.post("/", response_model=PedidoRead, status_code=status.HTTP_201_CREATED)
def create(
    data: PedidoCreate,
    session: Session = Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
    ws_manager: WSManager = Depends(get_ws_manager),
):
    """POST /pedidos — Create a new order.

    Logic:
    1. Forces the authenticated user as owner unless ADMIN/PEDIDOS supplies a different user_id
    2. Creates the order in PENDIENTE state with price/name snapshots
    3. Broadcasts creation event to admin room after commit
    4. Confirmation (PENDIENTE -> CONFIRMADO) happens ONLY via approved payment webhook

    Note: auto_confirmar was removed. Confirmation is exclusively via MercadoPago webhook.
    """
    if data.usuario_id is None:
        data.usuario_id = current_user.id

    pedido = PedidoService.create(session, data, ws_manager=ws_manager)
    return pedido


@router.post("/validar-stock", response_model=ValidarStockResponse)
def validar_stock(
    data: ValidarStockInput,
    session: Session = Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
):
    """POST /pedidos/validar-stock — Pre-validate stock availability for cart items.

    Read-only check — does NOT reserve or deduct stock.
    Used by the frontend cart to show real-time stock errors before order creation.
    """
    return PedidoService.validar_stock_items(session, data)


@router.patch("/{pedido_id}/avanzar", response_model=PedidoAvanzarResponse,
              dependencies=[Depends(require_roles(["ADMIN", "PEDIDOS"]))])
def avanzar(
    pedido_id: int,
    session: Session = Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
    ws_manager: WSManager = Depends(get_ws_manager),
):
    """PATCH /pedidos/{id}/avanzar — Advance the order to the next FSM state.

    Transitions:
        PENDIENTE -> CONFIRMADO (payment confirmed)
        CONFIRMADO -> EN_PREP (preparation started)
        EN_PREP -> ENTREGADO (delivered)

    NOTE: PENDIENTE -> CONFIRMADO is EXCLUSIVELY via payment webhook.
    This endpoint does NOT handle that transition anymore.

    Requires ADMIN or PEDIDOS role.
    """
    pedido, estado_anterior = PedidoService.avanzar_estado(
        session, pedido_id, current_user, ws_manager=ws_manager,
    )
    return PedidoAvanzarResponse(
        id=pedido.id,
        estado_anterior=estado_anterior,
        estado_actual=pedido.estado_codigo,
        mensaje=f"Pedido avanzó de {estado_anterior} a {pedido.estado_codigo}",
    )


@router.patch("/{pedido_id}/cancelar", response_model=PedidoCancelarResponse)
def cancelar(
    pedido_id: int,
    body: CancelarPedidoInput = Body(...),
    session: Session = Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
    ws_manager: WSManager = Depends(get_ws_manager),
):
    """PATCH /pedidos/{id}/cancelar — Cancel an order with a required motivo.

    Permission rules:
        ALL roles can cancel orders in PENDIENTE or CONFIRMADO state.
        EN_PREP can only be cancelled by ADMIN/PEDIDOS.
        Cancelation is blocked for terminal states (ENTREGADO, CANCELADO).

    Body:
        { "motivo": "Falta de stock" } — required, non-empty string.
    """
    pedido = PedidoService.cancelar_pedido(
        session, pedido_id, current_user,
        motivo=body.motivo,
        ws_manager=ws_manager,
    )
    return PedidoCancelarResponse(
        id=pedido.id,
        estado_anterior=pedido.estado_codigo,
        estado_actual="CANCELADO",
        mensaje="Pedido cancelado",
    )


@router.patch("/{pedido_id}", response_model=PedidoRead,
              dependencies=[Depends(require_roles(["ADMIN", "PEDIDOS"]))])
def update(pedido_id: int, data: PedidoUpdate, session: Session = Depends(get_session)):
    """PATCH /pedidos/{id} — Update order metadata and/or replace details.

    Metadata fields: direccion_id, forma_pago_codigo, notas.
    If `detalles` is provided, ALL existing detail lines are replaced
    with the new set (works only for PENDIENTE orders).
    Subtotal and total are recalculated automatically.

    Requires ADMIN or PEDIDOS role.
    """
    obj = PedidoService.update(session, pedido_id, data)
    if not obj:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    return obj


@router.patch("/{pedido_id}/detalles/{producto_id}", response_model=PedidoRead,
              dependencies=[Depends(require_roles(["ADMIN", "PEDIDOS"]))])
def actualizar_detalle(
    pedido_id: int,
    producto_id: int,
    data: DetallePedidoUpdate,
    session: Session = Depends(get_session),
):
    """PATCH /pedidos/{id}/detalles/{producto_id} — Update or remove a detail line.

    cantidad=0 removes the detail line entirely.
    Only works on PENDIENTE orders (once CONFIRMADO, stock is already deducted).
    Recalculates subtotal and total after modification. Requires ADMIN or PEDIDOS role.
    """
    return PedidoService.actualizar_detalle(session, pedido_id, producto_id, data.cantidad)


@router.delete("/{pedido_id}", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=[Depends(require_roles(["ADMIN"]))])
def delete(pedido_id: int, session: Session = Depends(get_session)):
    """DELETE /pedidos/{id} — Soft-delete an order by its ID.

    The row remains in the database but is excluded from normal queries.
    Requires ADMIN role.
    """
    if not PedidoService.soft_delete(session, pedido_id):
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    return None


# ──────────────────────────────────────────────────────────────────────────────
# WebSocket helpers
# ──────────────────────────────────────────────────────────────────────────────


async def _get_user_from_ws_token(
    websocket: WebSocket,
    session: Session,
) -> Usuario:
    """Extract and validate a JWT token from the WebSocket query parameters.

    Called during the WebSocket handshake phase (before accept()).
    Raises WebSocketException(code=4001) on invalid/missing token or user.
    """
    token = websocket.query_params.get("token")
    if not token:
        logger.warning("WS auth: missing token")
        raise WebSocketException(code=4001, reason="Token requerido")

    token_data = decode_token(token)
    if not token_data:
        logger.warning("WS auth: invalid or expired token")
        raise WebSocketException(code=4001, reason="Token invalido o expirado")

    repo = UsuarioRepository(session)
    user = repo.get_with_roles(token_data.user_id)
    if not user:
        logger.warning("WS auth: user %s not found", token_data.user_id)
        raise WebSocketException(code=4001, reason="Usuario no encontrado")

    return user


# ──────────────────────────────────────────────────────────────────────────────
# WebSocket endpoints
# ──────────────────────────────────────────────────────────────────────────────


@router.websocket("/ws/pedidos/{pedido_id}")
async def ws_pedido(
    websocket: WebSocket,
    pedido_id: int,
    session: Session = Depends(get_session),
    ws_manager: WSManager = Depends(get_ws_manager),
):
    """WebSocket endpoint for client-specific order updates.

    Authenticates via JWT query parameter (?token=<jwt>).
    Validates: user owns the order OR has ADMIN/PEDIDOS role.
    Subscribes the socket to the pedido-specific room.
    """
    await websocket.accept()

    try:
        user = await _get_user_from_ws_token(websocket, session)
    except WebSocketException:
        await websocket.close(code=4001, reason="Token requerido")
        return

    # Verify access: user owns the order or has admin/pedidos role
    user_roles = [rol.codigo for rol in user.roles]
    is_gestor = "ADMIN" in user_roles or "PEDIDOS" in user_roles

    if not is_gestor:
        pedido = PedidoService.get_by_id(session, pedido_id)
        if not pedido or pedido.usuario_id != user.id:
            await websocket.close(code=4003, reason="No autorizado")
            return

    ws_manager.connect(websocket, pedido_id)

    try:
        while True:
            await websocket.receive_text()
    except Exception:
        pass
    finally:
        ws_manager.disconnect(websocket)


@router.websocket("/ws/admin/pedidos")
async def ws_admin_pedidos(
    websocket: WebSocket,
    session: Session = Depends(get_session),
    ws_manager: WSManager = Depends(get_ws_manager),
):
    """WebSocket endpoint for admin real-time order feed.

    Authenticates via JWT query parameter (?token=<jwt>).
    Restricts access to ADMIN or PEDIDOS roles.
    Subscribes the socket to the 'admin' room.
    """
    await websocket.accept()

    try:
        user = await _get_user_from_ws_token(websocket, session)
    except WebSocketException:
        await websocket.close(code=4001, reason="Token requerido")
        return

    user_roles = [rol.codigo for rol in user.roles]
    if "ADMIN" not in user_roles and "PEDIDOS" not in user_roles:
        await websocket.close(code=4003, reason="No autorizado")
        return

    ws_manager.connect(websocket, "admin")

    try:
        while True:
            await websocket.receive_text()
    except Exception:
        pass
    finally:
        ws_manager.disconnect(websocket)
