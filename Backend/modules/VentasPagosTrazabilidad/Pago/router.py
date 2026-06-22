"""
Pago router — endpoints for payment initiation and MercadoPago webhook/IPN.
"""

import hmac
import hashlib
import json
import logging
import os

from fastapi import APIRouter, Depends, Request, status, HTTPException, BackgroundTasks

from core.database import get_session
from modules.IdentidadYAcceso.Auth.dependencies import get_current_user
from modules.IdentidadYAcceso.Usuario.models import Usuario

from .service import PagoService
from .schemas import (
    InitPaymentRequest,
    InitPaymentResponse,
    InitFromCartRequest,
    PagoRead,
)

logger = logging.getLogger("mercadopago.webhook")

router = APIRouter(prefix="/pagos", tags=["pagos"])

# ── Module-level guard: warn once if the webhook secret is missing or a placeholder ──
_WEBHOOK_SECRET = os.getenv("MP_WEBHOOK_SECRET", "")
if not _WEBHOOK_SECRET or _WEBHOOK_SECRET == "your-webhook-secret-here":
    logger.warning(
        "MP_WEBHOOK_SECRET is missing or still the default placeholder. "
        "Webhook signature validation will be skipped — any caller can POST to /pagos/webhook."
    )


@router.post("/", response_model=InitPaymentResponse, status_code=status.HTTP_201_CREATED)
async def init_payment(
    data: InitPaymentRequest,
    session=Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
):
    """POST /pagos — DEPRECATED. Use /pagos/init-from-cart instead.

    Legacy endpoint for initiating a MercadoPago checkout from a pedido_id.
    This flow is replaced by init-from-cart which creates the Pedido only
    after payment confirmation.

    Returns 501 Not Implemented to guide callers to the new endpoint.
    """
    raise HTTPException(
        status_code=501,
        detail={
            "error": "endpoint_deprecated",
            "mensaje": "Este endpoint fue reemplazado. Use POST /pagos/init-from-cart con los items del carrito.",
        },
    )


@router.post("/init-from-cart", response_model=InitPaymentResponse, status_code=status.HTTP_201_CREATED)
async def init_payment_from_cart(
    data: InitFromCartRequest,
    session=Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
):
    """POST /pagos/init-from-cart — Initiate MercadoPago payment from cart items.

    The NEW post-pago flow:
    1. Validates stock for all cart items
    2. Creates a carrito_snapshot (persists cart state during payment window)
    3. Creates a Pago record with pedido_id=NULL
    4. Creates a MercadoPago preference with cart items as line items
    5. Returns the init_point URL for redirecting the user

    The cart is NOT cleared. The Pedido is created on payment confirmation
    via webhook. The cart is cleared via WebSocket pago_confirmado event.

    Access: any authenticated user.
    """
    try:
        pago_read, init_point, mp_error = PagoService.init_from_cart(
            session, data, current_user
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail={"error": "stock_insuficiente", "mensaje": str(e)})
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    if init_point is None:
        return InitPaymentResponse(
            pago=pago_read,
            init_point=None,
            error=mp_error or "MercadoPago no respondio con una URL de pago. Verifica el token MP_ACCESS_TOKEN en Backend/.env",
        )
    return InitPaymentResponse(pago=pago_read, init_point=init_point)


def _validate_mp_signature(raw_body: bytes, headers) -> bool:
    """Validate the x-signature header from a MercadoPago webhook.

    MercadoPago signs webhooks using two possible formats (both HMAC-SHA256
    keyed with MP_WEBHOOK_SECRET):

    Format A (newer): signature over <x-request-id>.<data.id>
    Format B (legacy):  signature over just the raw request body

    This function attempts Format A first (the current documentation standard).
    If a data.id can be extracted from the JSON body, Format A is checked.
    If that fails, Format B is checked as a fallback.

    Returns True if ANY format matches, False otherwise.
    """
    x_signature = headers.get("x-signature")
    if not x_signature:
        return False

    if not _WEBHOOK_SECRET:
        return False

    # ── Extract data.id from the request body for Format A ──
    data_id = None
    try:
        body_json = json.loads(raw_body.decode("utf-8"))
        data_id = body_json.get("data", {}).get("id") or body_json.get("id")
    except (json.JSONDecodeError, UnicodeDecodeError):
        pass

    # ── Format A: HMAC-SHA256(secret, x-request-id + "." + data.id) ──
    x_request_id = headers.get("x-request-id", "")
    if x_request_id and data_id:
        payload_a = f"{x_request_id}.{data_id}"
        expected_a = hmac.new(
            _WEBHOOK_SECRET.encode("utf-8"),
            payload_a.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        if hmac.compare_digest(x_signature, expected_a):
            return True

    # ── Format B (legacy): HMAC-SHA256(secret, raw_body) ──
    expected_b = hmac.new(
        _WEBHOOK_SECRET.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    if hmac.compare_digest(x_signature, expected_b):
        return True

    # ── Diagnostic log on mismatch: record what MP sent so we can fix the format ──
    logger.warning(
        "MP webhook signature mismatch. x-signature=%s x-request-id=%s data.id=%s body_preview=%s",
        x_signature,
        x_request_id,
        data_id,
        raw_body.decode("utf-8", errors="replace")[:200],
    )
    return False


@router.post("/webhook", status_code=status.HTTP_200_OK)
async def webhook_receiver(request: Request, background_tasks: BackgroundTasks):
    """POST /pagos/webhook — MercadoPago IPN webhook receiver.

    Validates the x-signature header using HMAC-SHA256 (Format A:
    <x-request-id>.<data.id> or Format B: raw body). Requests without
    a valid signature receive HTTP 403 (unless MP_WEBHOOK_SECRET is
    not configured, in which case everything is allowed).

    After validation, responds with 200 OK immediately to prevent MP retries.
    Actual processing (API verification, DB updates) runs in background.
    """
    raw_body = await request.body()

    # ── DIAGNOSTIC: log every header MP sends so we can reverse-engineer the signature format ──
    raw_body_str = raw_body.decode("utf-8", errors="replace")
    logger.warning(
        "MP WEBHOOK RECEIVED | headers=%s | body=%s",
        {k: v for k, v in request.headers.items() if k.startswith("x-") or k in ("content-type", "host")},
        raw_body_str[:500],
    )

    # ── Validate signature (if secret is configured) ──
    if _WEBHOOK_SECRET and _WEBHOOK_SECRET != "your-webhook-secret-here":
        if not _validate_mp_signature(raw_body, request.headers):
            raise HTTPException(status_code=403, detail={"error": "invalid_signature"})
    else:
        logger.warning("MP webhook received without signature validation (secret not configured)")

    # ── Parse JSON ──
    try:
        raw_body_str = raw_body.decode("utf-8")
        body = json.loads(raw_body_str)
    except (json.JSONDecodeError, UnicodeDecodeError):
        logger.warning("MP webhook: failed to parse request body as JSON")
        body = {}

    result = PagoService.process_webhook(body, background_tasks=background_tasks)
    return result


@router.get("/{pedido_id}", response_model=list[PagoRead])
async def get_pagos_by_pedido(
    pedido_id: int,
    session=Depends(get_session),
    current_user: Usuario = Depends(get_current_user),
):
    """GET /pagos/{pedido_id} — List all payment records for a pedido.

    Admins and PEDIDOS-role users can view any pedido's payments.
    Regular users can only view their own pedidos' payments.

    Returns an empty list if the pedido doesn't exist or has no payments.
    Results are ordered by most recent first (descending creation date).
    """
    from ..Pedido.service import PedidoService as _PedidoService
    pedido = _PedidoService.get_by_id(session, pedido_id)
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")

    if not any(rol.codigo in ("ADMIN", "PEDIDOS") for rol in current_user.roles):
        if pedido.usuario_id != current_user.id:
            raise HTTPException(status_code=403, detail="No tienes permiso para ver este pedido")

    return PagoService.get_pagos_by_pedido(session, pedido_id)
