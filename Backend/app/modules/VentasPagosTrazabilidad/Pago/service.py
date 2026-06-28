"""
Pago service — MercadoPago payment business logic.

This service provides:
    - init_from_cart: Creates a preference in MercadoPago from cart items,
      returns the checkout init_point URL. Creates Pago (pedido_id=NULL) and
      cart_snapshot. This is the NEW post-pago flow.
    - init_mp_payment: LEGACY — replaced by init_from_cart. Kept for reference.
    - update_pago_status: Updates an existing Pago record from webhook data.
    - get_pagos_by_pedido: Lists all payments for an order (read-only).
    - get_payment_from_mp: Fetches payment details from MP API by MP payment ID.
    - process_webhook: Handles MP IPN. On approved, creates Pedido from snapshot.

PATTERN: Write operations use VentasPagosTrazabilidadUnitOfWork for atomicity.
Read operations use the repository directly (no UoW) to avoid commit/expire.
"""
import hashlib
import json as _json
import logging
import os
import uuid
from datetime import datetime
from decimal import Decimal
from typing import List, Optional

import mercadopago
from mercadopago.config.request_options import RequestOptions
from sqlmodel import Session

from .models import Pago
from .repository import PagoRepository
from .schemas import PagoRead, InitFromCartRequest
from ..uow import VentasPagosTrazabilidadUnitOfWork
from ..Pedido.service import PedidoService
from ..CarritoSnapshot.models import CarritoSnapshot
from ..CarritoSnapshot.repository import CarritoSnapshotRepository
from core.dependencies import fire_broadcast, fire_broadcast_admin, get_ws_manager

logger = logging.getLogger(__name__)

# ── MercadoPago SDK singleton ──
_sdk: mercadopago.SDK | None = None
_cached_token: str | None = None


def _get_mp_sdk() -> mercadopago.SDK:
    """Return a MercadoPago SDK instance.

    Reads MP_ACCESS_TOKEN from environment. The SDK is re-created when
    the token changes (supports hot-reload of .env without restart).
    """
    global _sdk, _cached_token
    token = os.getenv("MP_ACCESS_TOKEN", "")
    if not token or "000000" in token:
        raise RuntimeError(
            "MP_ACCESS_TOKEN no configurado o es un placeholder. "
            "Configuralo en Backend/.env con un token real de MercadoPago."
        )
    if _sdk is None or token != _cached_token:
        _sdk = mercadopago.SDK(token)
        _cached_token = token
    return _sdk


# ── Ngrok / webhook base URL ──
def _get_webhook_base_url() -> str:
    return os.getenv("NGROK_URL", "http://localhost:8000").rstrip("/")


# ── Frontend base URL for redirect back_urls ──
def _get_frontend_url() -> str:
    return os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")


def _cart_fingerprint(data: InitFromCartRequest, usuario_id: int) -> str:
    """Generate a deterministic fingerprint from cart data for idempotency.

    Uses SHA256 over the serialized cart + user to detect duplicate init_from_cart
    requests (e.g., double-clicks, retries before redirect).
    """
    raw = _json.dumps(
        {
            "usuario_id": usuario_id,
            "items": sorted(
                [
                    {
                        "producto_id": i.producto_id,
                        "cantidad": i.cantidad,
                        "precio": str(i.precio),
                        "ingredientes_excluidos": sorted(i.ingredientes_excluidos or []),
                    }
                    for i in data.items
                ],
                key=lambda x: x["producto_id"],
            ),
            "forma_pago_codigo": data.forma_pago_codigo,
            "subtotal": str(data.subtotal),
            "costo_envio": str(data.costo_envio),
            "descuento": str(data.descuento),
            "direccion_id": data.direccion_id,
        },
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


class PagoService:
    """Business logic for MercadoPago payment operations."""

    # ──────────────────────────────────────────────────────────────────────
    # NEW: init_from_cart — the post-pago flow
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def init_from_cart(
        session: Session,
        data: InitFromCartRequest,
        usuario,
    ) -> tuple[PagoRead, Optional[str], Optional[str]]:
        """Create a MercadoPago checkout preference from cart items.

        This is the NEW post-pago flow:
        1. Validate stock for all items
        2. Generate external_reference and idempotency_key (UUIDs)
        3. Create carrito_snapshot (cart preserved during payment window)
        4. Create Pago record with pedido_id=NULL
        5. Create MP preference with cart items as line items
        6. Return (PagoRead, init_point, mp_error)

        Returns:
            Tuple of (PagoRead, init_point_url, mp_error_or_None).
            init_point is None if the MP SDK call fails (Pago + snapshot
            still exist in DB). mp_error is a string describing the MP
            error or None on success.
        """
        from app.modules.CatalogoDeProductos.Producto.repository import ProductoRepository

        # ── Step 1: Validate stock ──
        producto_repo = ProductoRepository(session)
        stock_failures = []
        for item in data.items:
            producto = producto_repo.get_by_id(item.producto_id)
            if not producto:
                raise ValueError(f"Producto ID {item.producto_id} no encontrado")
            if producto.stock_cantidad < item.cantidad:
                stock_failures.append({
                    "producto_id": producto.id,
                    "nombre_producto": producto.nombre,
                    "cantidad_solicitada": item.cantidad,
                    "stock_disponible": producto.stock_cantidad,
                })
        if stock_failures:
            error = ValueError("Stock insuficiente para uno o mas productos")
            error.detalles = stock_failures
            raise error

        # ── Step 2: Idempotency — detect duplicate init ──
        fingerprint = _cart_fingerprint(data, usuario.id)
        external_reference: str | None = None
        idempotency_key: str | None = None
        skip_snapshot = False

        # Check for existing Pago with same idempotency key (double-click guard)
        with VentasPagosTrazabilidadUnitOfWork(session) as uow:
            existing_pago = uow.pagos.get_by_idempotency_key(fingerprint)
            if existing_pago:
                mp_pid = existing_pago.mp_payment_id
                if mp_pid is not None:
                    # Try to get a fresh init_point in case the old one expired
                    try:
                        sdk = _get_mp_sdk()
                        mp_pago = sdk.payment().get(mp_pid)
                        mp_data = mp_pago.get("response", {})
                        init_point = (
                            mp_data.get("sandbox_init_point")
                            or mp_data.get("init_point")
                        )
                        if init_point:
                            pago_read = PagoRead.model_validate(existing_pago)
                            return pago_read, init_point, None
                    except Exception:
                        pass  # MP lookup failed, but Pago exists

                # mp_payment_id is None (preference-only, not yet paid) OR
                # MP lookup failed. Create a fresh MP preference with a new
                # idempotency key so the user can retry the payment.
                # Reuse the existing external_reference (both Pagos share the
                # same snapshot — snapshot is NOT duplicated).
                external_reference = existing_pago.external_reference
                idempotency_key = f"{fingerprint}-retry-{uuid.uuid4()}"
                skip_snapshot = True
                logger.info(
                    "Retry init_from_cart for fingerprint=%s: creating new Pago "
                    "with idempotency_key=%s, reusing external_reference=%s",
                    fingerprint, idempotency_key, external_reference,
                )

        # ── Step 3: Generate external_reference (shared with snapshot) ──
        if external_reference is None:
            external_reference = str(uuid.uuid4())
        if idempotency_key is None:
            idempotency_key = fingerprint

        # ── Step 4: Calculate total ──
        total = data.subtotal - data.descuento + data.costo_envio
        if total < 0:
            total = Decimal("0.00")

        # ── Step 5: Build items JSON for snapshot ──
        snapshot_items = []
        preference_items = []
        for item in data.items:
            snapshot_items.append({
                "producto_id": item.producto_id,
                "nombre": item.nombre,
                "precio": float(item.precio),
                "cantidad": item.cantidad,
                "ingredientes_excluidos": item.ingredientes_excluidos,
            })
            preference_items.append({
                "title": item.nombre,
                "quantity": item.cantidad,
                "unit_price": float(item.precio),
                "currency_id": "ARS",
            })

        # ── Step 6: Create snapshot + Pago in a single UoW ──
        with VentasPagosTrazabilidadUnitOfWork(session) as uow:
            # Create the cart snapshot (skip on retry — reuse existing one)
            if not skip_snapshot:
                snapshot = CarritoSnapshot(
                    usuario_id=usuario.id,
                    items=snapshot_items,
                    direccion_id=data.direccion_id,
                    direccion_snapshot=None,  # frozen address built below
                    forma_pago_codigo="MERCADOPAGO",
                    costo_envio=data.costo_envio,
                    subtotal=data.subtotal,
                    total=total,
                    external_reference=external_reference,
                    notas=data.notas,
                )

                # Freeze address if provided
                if data.direccion_id is not None:
                    from app.modules.IdentidadYAcceso.DireccionEntrega.repository import (
                        DireccionEntregaRepository,
                    )
                    dir_repo = DireccionEntregaRepository(session)
                    direccion = dir_repo.get_by_id(data.direccion_id)
                    if direccion:
                        snapshot.direccion_snapshot = {
                            "linea1": getattr(direccion, "linea1", None),
                            "linea2": getattr(direccion, "linea2", None),
                            "ciudad": getattr(direccion, "ciudad", None),
                        }

                uow.snapshots.create(snapshot)

            # Create the Pago record (pedido_id=NULL)
            pago = Pago(
                pedido_id=None,
                mp_status="pending",
                mp_status_detail=None,
                mp_payment_id=None,
                external_reference=external_reference,
                idempotency_key=idempotency_key,
                transaction_amount=total,
                payment_method_id=None,
            )
            uow.add(pago)
            uow.flush()
            uow.refresh(pago)

            # ── Step 7: Create preference in MercadoPago ──
            try:
                sdk = _get_mp_sdk()
                frontend_url = _get_frontend_url()
                webhook_base = _get_webhook_base_url()

                preference_data = {
                    "items": preference_items,
                    "external_reference": external_reference,
                    "auto_return": "approved",
                    "back_urls": {
                        "success": f"{frontend_url}/pedidos/post-pago?external_reference={external_reference}&status=approved",
                        "failure": f"{frontend_url}/carrito",
                        "pending": f"{frontend_url}/pedidos/post-pago?external_reference={external_reference}&status=approved",
                    },
                }

                if usuario:
                    preference_data["payer"] = {
                        "name": usuario.nombre,
                        "email": usuario.email,
                    }

                allow_http = os.getenv("MP_ALLOW_HTTP_WEBHOOK", "").lower() == "true"
                if webhook_base and (webhook_base.startswith("https") or allow_http):
                    if allow_http and not webhook_base.startswith("https"):
                        logger.info("notification_url set with HTTP (dev mode)")
                    preference_data["notification_url"] = f"{webhook_base}/pagos/webhook"

                preference_response = sdk.preference().create(
                    preference_data,
                    RequestOptions(
                        custom_headers={"X-Idempotency-Key": idempotency_key}
                    ),
                )
                response_data = preference_response.get("response", {})

                if preference_response.get("status") not in (200, 201):
                    mp_message = preference_response.get("response", {}).get("message", "unknown error")
                    mp_status = preference_response.get("status", "?")
                    logger.error(
                        "MP preference creation failed [status=%s]: %s",
                        mp_status, mp_message,
                    )
                    logger.error("Full MP response: %s", preference_response)
                    pago_read = PagoRead.model_validate(pago)
                    return pago_read, None, f"MP[{mp_status}]: {mp_message}"

                init_point = (
                    response_data.get("sandbox_init_point")
                    or response_data.get("init_point")
                    or None
                )
                preference_id = response_data.get("id")

                # Note: MP preference IDs contain hyphens (e.g. "2162743739-f86d9b72-...")
                # and cannot be stored in mp_payment_id (an int column).
                # mp_payment_id is reserved for the numeric payment ID received via webhook.

                pago_read = PagoRead.model_validate(pago)
                return pago_read, init_point, None

            except Exception as exc:
                logger.exception("Error creating MP preference from cart for user %s", usuario.id)
                pago_read = PagoRead.model_validate(pago)
                return pago_read, None, str(exc)

    # ──────────────────────────────────────────────────────────────────────
    # LEGACY: init_mp_payment — kept for backward-compat, deprecated
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def init_mp_payment(
        session: Session,
        pedido_id: int,
        uow: Optional[VentasPagosTrazabilidadUnitOfWork] = None,
    ) -> tuple[PagoRead, Optional[str]]:
        """DEPRECATED: Use init_from_cart instead.

        Create a MercadoPago checkout preference from an existing pedido_id.
        Kept for backward compatibility with the PedidosPage retry button.

        Steps:
            1. Fetch the Pedido to validate existence and get the total
            2. Check if a Pago already exists for this pedido (idempotent)
            3. Generate external_reference and idempotency_key as UUIDs
            4. Create the Pago record in DB
            5. Create a preference in MercadoPago via SDK
            6. Return (PagoRead, init_point) tuple

        Returns:
            Tuple of (PagoRead, init_point_url). init_point is None if
            the MP SDK call fails (payment record still exists in DB).
        """
        # Validate the pedido exists and get its total
        pedido = PedidoService.get_by_id(session, pedido_id)
        if not pedido:
            raise ValueError(f"Pedido {pedido_id} no encontrado")

        # ── Idempotency ──
        pago_repo = PagoRepository(session)
        existing_pago = pago_repo.get_pending_or_approved(pedido_id)
        if existing_pago:
            logger.info(
                "Duplicate Pago prevented for pedido %s: existing Pago id=%s, status=%s",
                pedido_id, existing_pago.id, existing_pago.mp_status,
            )
            return PagoRead.model_validate(existing_pago), None

        # ── Create the Pago record in DB ──
        external_reference = str(uuid.uuid4())
        idempotency_key = str(uuid.uuid4())

        pago = Pago(
            pedido_id=pedido_id,
            mp_status="pending",
            mp_status_detail=None,
            mp_payment_id=None,
            external_reference=external_reference,
            idempotency_key=idempotency_key,
            transaction_amount=pedido.total,
            payment_method_id=None,
        )

        if uow is not None:
            uow.add(pago)
            uow.flush()
            uow.refresh(pago)
        else:
            with VentasPagosTrazabilidadUnitOfWork(session) as new_uow:
                new_uow.add(pago)
                new_uow.flush()
                new_uow.refresh(pago)

        # ── Create the preference in MercadoPago ──
        try:
            sdk = _get_mp_sdk()
            webhook_base = _get_webhook_base_url()
            frontend_url = _get_frontend_url()

            preference_data = {
                "items": [
                    {
                        "title": f"Pedido #{pedido_id}",
                        "quantity": 1,
                        "unit_price": float(pedido.total),
                        "currency_id": "ARS",
                    }
                ],
                "external_reference": external_reference,
                "auto_return": "approved",
                "back_urls": {
                    "success": f"{frontend_url}/pedidos/{pedido_id}",
                    "failure": f"{frontend_url}/carrito",
                    "pending": f"{frontend_url}/pedidos/{pedido_id}",
                },
            }

            if pedido.usuario:
                preference_data["payer"] = {
                    "name": pedido.usuario.nombre,
                    "email": pedido.usuario.email,
                }

            allow_http = os.getenv("MP_ALLOW_HTTP_WEBHOOK", "").lower() == "true"
            if webhook_base and (webhook_base.startswith("https") or allow_http):
                if allow_http and not webhook_base.startswith("https"):
                    logger.info("notification_url set with HTTP (dev mode)")
                preference_data["notification_url"] = f"{webhook_base}/pagos/webhook"

            preference_response = sdk.preference().create(
                preference_data,
                RequestOptions(
                    custom_headers={"X-Idempotency-Key": idempotency_key}
                ),
            )
            response_data = preference_response.get("response", {})

            if preference_response.get("status") not in (200, 201):
                logger.error(
                    "MP preference creation failed: %s",
                    preference_response.get("response", {}).get("message", "unknown error"),
                )
                return PagoRead.model_validate(pago), None

            init_point = (
                response_data.get("sandbox_init_point")
                or response_data.get("init_point")
                or None
            )
            preference_id = response_data.get("id")

            # Note: MP preference IDs contain hyphens and cannot be stored in
            # mp_payment_id (int column). mp_payment_id is reserved for the
            # numeric payment ID received via the webhook.

            pago_read = PagoRead.model_validate(pago)
            return pago_read, init_point

        except Exception as exc:
            logger.exception("Error creating MP preference for pedido %s", pedido_id)
            return PagoRead.model_validate(pago), None

    @staticmethod
    def check_pedido_status(
        session: Session,
        external_reference: str,
        current_user,
    ) -> dict:
        """Polling endpoint: check if a Pedido has been created for this payment.

        Returns a dict with status, pedido_id, and mp_status for the
        GET /pagos/status endpoint.
        """
        repo = PagoRepository(session)
        pago = repo.get_by_external_reference(external_reference)

        # Not found at all
        if pago is None:
            return {"status": "not_found", "pedido_id": None, "mp_status": None}

        # Cross-user check: return not_found to avoid leaking information
        from app.modules.VentasPagosTrazabilidad.CarritoSnapshot.repository import (
            CarritoSnapshotRepository,
        )
        snapshot_repo = CarritoSnapshotRepository(session)
        snapshot = snapshot_repo.get_by_external_reference(external_reference)
        owner_id = snapshot.usuario_id if snapshot else None

        # If snapshot exists and belongs to a different user -> deny
        if owner_id is not None and owner_id != current_user.id:
            return {"status": "not_found", "pedido_id": None, "mp_status": None}

        # Pedido already created -> found
        if pago.pedido_id is not None:
            return {
                "status": "found",
                "pedido_id": pago.pedido_id,
                "mp_status": pago.mp_status,
            }

        # Pago exists, pedido not yet created, payment approved -> pending
        if pago.mp_status == "approved" and pago.pedido_id is None:
            return {
                "status": "pending",
                "pedido_id": None,
                "mp_status": pago.mp_status,
            }

        # Otherwise: pago exists but not approved (e.g., still pending)
        return {"status": "not_found", "pedido_id": None, "mp_status": pago.mp_status}

    @staticmethod
    def update_pago_status(
        session: Session,
        mp_payment_id: int,
        mp_status: str,
        mp_status_detail: str | None = None,
    ) -> PagoRead:
        """Update a Pago record's status from a MercadoPago webhook callback."""
        with VentasPagosTrazabilidadUnitOfWork(session) as uow:
            pago = uow.pagos.get_by_mp_payment_id(mp_payment_id)
            if not pago:
                raise ValueError(f"Pago con MP ID {mp_payment_id} no encontrado")

            pago.mp_status = mp_status
            pago.mp_status_detail = mp_status_detail
            pago.mp_payment_id = mp_payment_id
            uow.add(pago)
            return PagoRead.model_validate(pago)

    @staticmethod
    def get_pagos_by_pedido(session: Session, pedido_id: int) -> List[PagoRead]:
        """List all payments for an order, newest first."""
        repo = PagoRepository(session)
        pagos = repo.get_by_pedido(pedido_id)
        return [PagoRead.model_validate(p) for p in pagos]

    @staticmethod
    def process_webhook(body: dict, background_tasks=None) -> dict:
        """Process a MercadoPago IPN webhook notification.

        Flow:
        1. Extract mp_payment_id from the webhook payload
        2. Fetch REAL payment status from MP API (never trust webhook data)
        3. Deduplicate by idempotency_key
        4. Update Pago record
        5. If approved: look up cart_snapshot, create Pedido from snapshot,
           backfill pago.pedido_id, delete snapshot, broadcast pago_confirmado
        6. If rejected: just update Pago status (snapshot preserved for retry)

        POST-PAGO flow: The Pedido is CREATED here, not advanced from PENDIENTE.
        """
        import json as _json

        logger.info("MP webhook received: %s", _json.dumps(body, default=str))

        # ── Extract mp_payment_id ──
        mp_payment_id: int | None = None

        raw_id = body.get("id")
        if raw_id and body.get("topic") == "payment":
            mp_payment_id = int(raw_id)

        if mp_payment_id is None:
            topic = body.get("topic", "")
            action = body.get("action", "")
            if topic != "payment" and "payment" not in action:
                return {"status": "ignored", "detail": "not a payment notification"}

            data_block = body.get("data", {})
            if data_block and isinstance(data_block, dict):
                raw_id = data_block.get("id")
                if raw_id:
                    try:
                        mp_payment_id = int(raw_id)
                    except (ValueError, TypeError):
                        pass

        if mp_payment_id is None:
            logger.warning("MP webhook: could not extract payment ID")
            return {"status": "received", "detail": "no payment id found"}

        # ── Fetch real status from MP API ──
        payment_data = PagoService.get_payment_from_mp(mp_payment_id)
        if not payment_data:
            logger.warning(
                "MP webhook: could not fetch payment %s from MP API",
                mp_payment_id,
            )
            return {"status": "received", "detail": "could not fetch from MP"}

        mp_status = payment_data.get("status", "unknown")
        mp_status_detail = payment_data.get("status_detail")
        external_reference = payment_data.get("external_reference", "")
        idempotency_key = payment_data.get("idempotency_key", str(uuid.uuid4()))

        # ── Process in background to return 200 immediately ──
        from core.database import engine as _engine
        from sqlmodel import Session as _Session

        def _process():
            with _Session(_engine) as _session:
                repo = PagoRepository(_session)

                # Deduplicate: check if already processed with this key
                existing = repo.get_by_idempotency_key(idempotency_key)
                if existing and existing.mp_status in ("approved", "rejected"):
                    logger.info(
                        "MP webhook: duplicate ignored for idempotency_key=%s, status=%s",
                        idempotency_key, existing.mp_status,
                    )
                    return

                # Find existing Pago by external_reference
                pago = repo.get_by_external_reference(external_reference)
                if not pago:
                    logger.warning(
                        "MP webhook: no Pago found for external_reference=%s",
                        external_reference,
                    )
                    return

                # Update Pago status
                _should_broadcast = False
                _broadcast_pedido_id = None
                _broadcast_pedido_usuario_id = None

                with VentasPagosTrazabilidadUnitOfWork(_session) as uow:
                    db_pago = uow.pagos.get_by_id(pago.id)
                    if not db_pago:
                        logger.warning("MP webhook: Pago %s not found in UoW", pago.id)
                        return

                    db_pago.mp_payment_id = mp_payment_id
                    db_pago.mp_status = mp_status
                    db_pago.mp_status_detail = mp_status_detail
                    db_pago.payment_method_id = payment_data.get("payment_method_id")
                    uow.add(db_pago)

                    # ── If approved: create Pedido from snapshot ──
                    if mp_status == "approved":
                        try:
                            # Look up cart snapshot by external_reference
                            snapshot_repo = CarritoSnapshotRepository(_session)
                            snapshot = snapshot_repo.get_by_external_reference(external_reference)

                            if snapshot is None:
                                # Idempotency: snapshot already consumed by prior webhook
                                logger.info(
                                    "MP webhook: snapshot already consumed for ext_ref=%s "
                                    "(pedido already created)",
                                    external_reference,
                                )
                            else:
                                # Create Pedido from snapshot (validates stock, deducts, etc.)
                                from ..Pedido.service import PedidoService as _PedidoService

                                nuevo_pedido = _PedidoService.crear_desde_snapshot(
                                    _session, snapshot, snapshot_repo
                                )

                                # Backfill pago.pedido_id
                                db_pago.pedido_id = nuevo_pedido.id
                                uow.add(db_pago)

                                # Snapshot is deleted inside crear_desde_snapshot already,
                                # but ensure it's gone in this UoW context
                                # (crear_desde_snapshot handles delete within its own UoW,
                                #  so the snapshot is already deleted by now)

                                logger.info(
                                    "MP webhook: Pedido #%s created from snapshot for user %s",
                                    nuevo_pedido.id, nuevo_pedido.usuario_id,
                                )
                                _should_broadcast = True
                                _broadcast_pedido_id = nuevo_pedido.id
                                _broadcast_pedido_usuario_id = nuevo_pedido.usuario_id

                        except Exception as e:
                            logger.exception(
                                "MP webhook: error creating pedido from snapshot "
                                "for ext_ref=%s: %s",
                                external_reference, e,
                            )
                            # Re-raise so the UoW rolls back (snapshot preserved)
                            raise

                    logger.info(
                        "MP webhook: payment %s updated to %s",
                        mp_payment_id, mp_status,
                    )

                # ── AFTER UoW commit: broadcast to WebSocket clients ──
                if _should_broadcast:
                    ws_manager = get_ws_manager()
                    payload = {
                        "event": "pago_confirmado",
                        "pedido_id": _broadcast_pedido_id,
                        "estado_anterior": None,
                        "estado_nuevo": "CONFIRMADO",
                        "usuario_id": _broadcast_pedido_usuario_id,
                        "motivo": None,
                        "timestamp": datetime.utcnow().isoformat(),
                    }
                    fire_broadcast(ws_manager, _broadcast_pedido_id, payload)
                    fire_broadcast_admin(ws_manager, payload)

        if background_tasks is not None:
            background_tasks.add_task(_process)
        else:
            _process()

        return {"status": "received", "detail": "ok"}

    @staticmethod
    def get_payment_from_mp(mp_payment_id: int) -> dict | None:
        """Fetch payment details from MercadoPago API by MP payment ID."""
        try:
            sdk = _get_mp_sdk()
            response = sdk.payment().get(mp_payment_id)
            if response.get("status") == 200:
                return response.get("response")
            logger.warning("MP get_payment returned status %s", response.get("status"))
            return None
        except Exception as exc:
            logger.exception("Error fetching MP payment %s", mp_payment_id)
            return None
