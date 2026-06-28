"""
Tests for the Pedido Post-Pago flow (init-from-cart + webhook creates Pedido).

Covers:
- POST /pagos/init-from-cart: happy path, stock validation
- crear_desde_snapshot: retiro en local, stock insufficient
- Snapshot TTL cleanup
- process_webhook: webhook flow (unit-level via mocked session)
- Regression: PAGO_LOCAL flow still works
"""
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from sqlmodel import Session, select

from app.modules.VentasPagosTrazabilidad.Pago.service import PagoService
from app.modules.VentasPagosTrazabilidad.Pago.schemas import InitFromCartRequest, CartItemInput
from app.modules.VentasPagosTrazabilidad.Pedido.service import PedidoService
from app.modules.VentasPagosTrazabilidad.CarritoSnapshot.models import CarritoSnapshot
from app.modules.VentasPagosTrazabilidad.CarritoSnapshot.repository import CarritoSnapshotRepository


# ── Helpers ──

def _init_request(items=None, direccion_id=None, subtotal=None):
    items = items or [
        CartItemInput(
            producto_id=1, nombre="Test Product",
            precio=Decimal("100.00"), cantidad=2, ingredientes_excluidos=[],
        )
    ]
    return InitFromCartRequest(
        forma_pago_codigo="MERCADOPAGO",
        subtotal=subtotal or Decimal("200.00"),
        descuento=Decimal("0.00"),
        costo_envio=Decimal("50.00") if direccion_id else Decimal("0.00"),
        direccion_id=direccion_id,
        items=items,
    )


def _make_mock_usuario():
    user = MagicMock()
    user.id = 1
    user.nombre = "Test"
    user.apellido = "User"
    user.email = "test@test.com"
    user.roles = []
    return user


# ═══════════════════════════════════════════════════════════════════════════
# 8.1: init-from-cart happy path (2 tests)
# ═══════════════════════════════════════════════════════════════════════════


# ═══════════════════════════════════════════════════════════════════════════
# TASK 1.1: auto_return in MercadoPago preference
# ═══════════════════════════════════════════════════════════════════════════


class TestAutoReturn:
    """Verify auto_return: 'approved' is included in preference_data."""

    @patch("app.modules.VentasPagosTrazabilidad.Pago.service._get_mp_sdk")
    def test_init_from_cart_includes_auto_return(self, mock_sdk, db_session):
        """init_from_cart sends auto_return='approved' in preference_data."""
        from tests.conftest import (
            _seed_roles, _seed_estados_pedido, _seed_formas_pago, producto_factory,
        )
        _seed_roles(db_session); _seed_estados_pedido(db_session); _seed_formas_pago(db_session)
        producto_factory(db_session, id=1, nombre="AutoReturn", precio_base=Decimal("100.00"), stock_cantidad=10)

        mock_sdk_instance = MagicMock()
        mock_pref = MagicMock()
        mock_pref.create.return_value = {
            "status": 201, "response": {"id": "pref-auto", "init_point": "https://mp.com/checkout"},
        }
        mock_sdk_instance.preference.return_value = mock_pref
        mock_sdk.return_value = mock_sdk_instance

        PagoService.init_from_cart(db_session, _init_request(), _make_mock_usuario())

        # Capture the preference_data passed to create()
        create_call_args = mock_pref.create.call_args[0][0]
        assert create_call_args.get("auto_return") == "approved", (
            f"auto_return missing or wrong in init_from_cart preference_data: {create_call_args}"
        )

    @patch("app.modules.VentasPagosTrazabilidad.Pago.service._get_mp_sdk")
    def test_init_mp_payment_includes_auto_return(self, mock_sdk, db_session):
        """init_mp_payment sends auto_return='approved' in preference_data."""
        from tests.conftest import (
            _seed_roles, _seed_estados_pedido, _seed_formas_pago, producto_factory, pedido_factory,
        )
        _seed_roles(db_session); _seed_estados_pedido(db_session); _seed_formas_pago(db_session)
        producto_factory(db_session, id=1, nombre="Test", precio_base=Decimal("100.00"), stock_cantidad=10)
        pedido_factory(db_session, usuario_id=1, id=123, total=Decimal("200.00"))

        mock_sdk_instance = MagicMock()
        mock_pref = MagicMock()
        mock_pref.create.return_value = {
            "status": 201, "response": {"id": "pref-legacy", "init_point": "https://mp.com/checkout"},
        }
        mock_sdk_instance.preference.return_value = mock_pref
        mock_sdk.return_value = mock_sdk_instance

        PagoService.init_mp_payment(db_session, pedido_id=123)

        create_call_args = mock_pref.create.call_args[0][0]
        assert create_call_args.get("auto_return") == "approved", (
            f"auto_return missing or wrong in init_mp_payment preference_data: {create_call_args}"
        )


# ═══════════════════════════════════════════════════════════════════════════
# TASK 1.2: Dev-mode webhook toggle
# ═══════════════════════════════════════════════════════════════════════════


class TestWebhookDevMode:

    @patch("app.modules.VentasPagosTrazabilidad.Pago.service._get_webhook_base_url")
    @patch("app.modules.VentasPagosTrazabilidad.Pago.service._get_mp_sdk")
    @patch.dict("os.environ", {"MP_ALLOW_HTTP_WEBHOOK": "true"}, clear=False)
    def test_notification_url_included_with_http_when_env_true(self, mock_sdk, mock_webhook_base, db_session):
        """With MP_ALLOW_HTTP_WEBHOOK=true, notification_url is added even for http://"""
        from tests.conftest import (
            _seed_roles, _seed_estados_pedido, _seed_formas_pago, producto_factory,
        )
        _seed_roles(db_session); _seed_estados_pedido(db_session); _seed_formas_pago(db_session)
        producto_factory(db_session, id=1, nombre="Test", precio_base=Decimal("100.00"), stock_cantidad=10)
        # Force webhook base to HTTP to test the toggle
        mock_webhook_base.return_value = "http://localhost:8000"

        mock_sdk_instance = MagicMock()
        mock_pref = MagicMock()
        mock_pref.create.return_value = {
            "status": 201, "response": {"id": "pref-http", "init_point": "https://mp.com/checkout"},
        }
        mock_sdk_instance.preference.return_value = mock_pref
        mock_sdk.return_value = mock_sdk_instance

        PagoService.init_from_cart(db_session, _init_request(), _make_mock_usuario())

        create_call_args = mock_pref.create.call_args[0][0]
        assert "notification_url" in create_call_args, (
            f"notification_url should be present when MP_ALLOW_HTTP_WEBHOOK=true, got: {create_call_args}"
        )

    @patch("app.modules.VentasPagosTrazabilidad.Pago.service._get_webhook_base_url")
    @patch("app.modules.VentasPagosTrazabilidad.Pago.service._get_mp_sdk")
    @patch.dict("os.environ", {"MP_ALLOW_HTTP_WEBHOOK": ""}, clear=False)
    def test_notification_url_absent_with_http_when_env_not_set(self, mock_sdk, mock_webhook_base, db_session):
        """Without MP_ALLOW_HTTP_WEBHOOK, notification_url is omitted for http://"""
        from tests.conftest import (
            _seed_roles, _seed_estados_pedido, _seed_formas_pago, producto_factory,
        )
        _seed_roles(db_session); _seed_estados_pedido(db_session); _seed_formas_pago(db_session)
        producto_factory(db_session, id=1, nombre="Test", precio_base=Decimal("100.00"), stock_cantidad=10)
        # Force webhook base to HTTP
        mock_webhook_base.return_value = "http://localhost:8000"

        mock_sdk_instance = MagicMock()
        mock_pref = MagicMock()
        mock_pref.create.return_value = {
            "status": 201, "response": {"id": "pref-nosig", "init_point": "https://mp.com/checkout"},
        }
        mock_sdk_instance.preference.return_value = mock_pref
        mock_sdk.return_value = mock_sdk_instance

        PagoService.init_from_cart(db_session, _init_request(), _make_mock_usuario())

        create_call_args = mock_pref.create.call_args[0][0]
        assert "notification_url" not in create_call_args, (
            f"notification_url should be absent when MP_ALLOW_HTTP_WEBHOOK is not set, got: {create_call_args}"
        )


# ═══════════════════════════════════════════════════════════════════════════
# TASK 1.3: GET /pagos/status polling endpoint tests
# ═══════════════════════════════════════════════════════════════════════════


class TestPagoStatusEndpoint:
    """Tests for GET /pagos/status polling endpoint."""

    def test_status_found_when_pago_has_pedido(self, db_session, client, client_headers):
        """Pago with pedido_id -> status found with pedido_id."""
        from tests.conftest import _seed_roles, _seed_estados_pedido, _seed_formas_pago
        from app.modules.VentasPagosTrazabilidad.Pago.models import Pago
        import uuid

        _seed_roles(db_session); _seed_estados_pedido(db_session); _seed_formas_pago(db_session)
        ext_ref = str(uuid.uuid4())

        pago = Pago(
            pedido_id=42, mp_status="approved", external_reference=ext_ref,
            idempotency_key=str(uuid.uuid4()), transaction_amount=100.00,
        )
        db_session.add(pago)
        db_session.commit()

        response = client.get(
            f"/api/v1/pagos/status?external_reference={ext_ref}",
            headers=client_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "found"
        assert data["pedido_id"] == 42
        assert data["mp_status"] == "approved"

    def test_status_pending_when_pago_no_pedido(self, db_session, client, client_headers):
        """Pago without pedido_id, mp_status approved -> status pending."""
        from tests.conftest import _seed_roles, _seed_estados_pedido, _seed_formas_pago
        from app.modules.VentasPagosTrazabilidad.Pago.models import Pago
        import uuid

        _seed_roles(db_session); _seed_estados_pedido(db_session); _seed_formas_pago(db_session)
        ext_ref = str(uuid.uuid4())

        pago = Pago(
            pedido_id=None, mp_status="approved", external_reference=ext_ref,
            idempotency_key=str(uuid.uuid4()), transaction_amount=100.00,
        )
        db_session.add(pago)
        db_session.commit()

        response = client.get(
            f"/api/v1/pagos/status?external_reference={ext_ref}",
            headers=client_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "pending"
        assert data["pedido_id"] is None
        assert data["mp_status"] == "approved"

    def test_status_not_found_for_unknown_reference(self, client, client_headers, db_session):
        """Unknown external_reference -> 404 not_found."""
        from tests.conftest import _seed_roles, _seed_estados_pedido, _seed_formas_pago
        _seed_roles(db_session); _seed_estados_pedido(db_session); _seed_formas_pago(db_session)

        response = client.get(
            "/api/v1/pagos/status?external_reference=nonexistent-123",
            headers=client_headers,
        )
        assert response.status_code == 404
        data = response.json()
        assert data["status"] == "not_found"

    def test_status_cross_user_returns_not_found(self, db_session, client, client_headers):
        """User B querying User A's pago -> 404 (not 403, per spec)."""
        from tests.conftest import _seed_roles, create_user_with_role
        from app.modules.VentasPagosTrazabilidad.Pago.models import Pago
        from app.modules.VentasPagosTrazabilidad.CarritoSnapshot.models import CarritoSnapshot
        import uuid

        _seed_roles(db_session)
        # User A owns the pago (create user with a different email)
        user_a, user_a_headers = create_user_with_role(
            db_session, nombre="UserA", email="user_a@test.com",
        )
        ext_ref = str(uuid.uuid4())

        # Create snapshot owned by User A (required for ownership check)
        snapshot = CarritoSnapshot(
            usuario_id=user_a.id,
            items=[{"producto_id": 1, "nombre": "Test", "precio": 100.0, "cantidad": 1}],
            forma_pago_codigo="MERCADOPAGO", costo_envio=0,
            subtotal=100.00, total=100.00, external_reference=ext_ref,
        )
        db_session.add(snapshot)

        pago = Pago(
            pedido_id=42, mp_status="approved", external_reference=ext_ref,
            idempotency_key=str(uuid.uuid4()), transaction_amount=100.00,
        )
        db_session.add(pago)
        db_session.commit()

        # User B (client_headers = client_test@test.com) queries it
        response = client.get(
            f"/api/v1/pagos/status?external_reference={ext_ref}",
            headers=client_headers,
        )
        # Per spec: cross-user access returns 404 (information leaking prevention)
        assert response.status_code == 404
        data = response.json()
        assert data["status"] == "not_found"


class TestInitFromCartHappyPath:

    @patch("app.modules.VentasPagosTrazabilidad.Pago.service._get_mp_sdk")
    def test_creates_pago_and_snapshot(self, mock_sdk, db_session):
        from tests.conftest import (
            _seed_roles, _seed_estados_pedido, _seed_formas_pago, producto_factory,
        )
        _seed_roles(db_session); _seed_estados_pedido(db_session); _seed_formas_pago(db_session)
        producto_factory(db_session, id=1, nombre="Test Product",
                         precio_base=Decimal("100.00"), stock_cantidad=10)

        mock_sdk_instance = MagicMock()
        mock_pref = MagicMock()
        mock_pref.create.return_value = {
            "status": 201, "response": {"id": "pref-123", "init_point": "https://mp.com/checkout"},
        }
        mock_sdk_instance.preference.return_value = mock_pref
        mock_sdk.return_value = mock_sdk_instance

        pago_read, _, __ = PagoService.init_from_cart(db_session, _init_request(), _make_mock_usuario())

        assert pago_read.pedido_id is None
        assert pago_read.mp_status == "pending"

        snapshot = CarritoSnapshotRepository(db_session).get_by_external_reference(pago_read.external_reference)
        assert snapshot is not None
        assert snapshot.items[0]["producto_id"] == 1

    @patch("app.modules.VentasPagosTrazabilidad.Pago.service._get_mp_sdk")
    def test_returns_init_point(self, mock_sdk, db_session):
        from tests.conftest import (
            _seed_roles, _seed_estados_pedido, _seed_formas_pago, producto_factory,
        )
        _seed_roles(db_session); _seed_estados_pedido(db_session); _seed_formas_pago(db_session)
        producto_factory(db_session, id=1, nombre="Test Product",
                         precio_base=Decimal("100.00"), stock_cantidad=10)

        mock_sdk_instance = MagicMock()
        mock_pref = MagicMock()
        mock_pref.create.return_value = {
            "status": 201, "response": {"id": "pref-456", "init_point": "https://mp.com/checkout"},
        }
        mock_sdk_instance.preference.return_value = mock_pref
        mock_sdk.return_value = mock_sdk_instance

        _, init_point, __ = PagoService.init_from_cart(db_session, _init_request(), _make_mock_usuario())
        assert init_point == "https://mp.com/checkout"


# ═══════════════════════════════════════════════════════════════════════════
# 8.2: Stock validation failure (1 test)
# ═══════════════════════════════════════════════════════════════════════════


class TestInitFromCartStockValidation:

    def test_stock_insufficient_raises(self, db_session):
        from tests.conftest import (
            _seed_roles, _seed_estados_pedido, _seed_formas_pago, producto_factory,
        )
        _seed_roles(db_session); _seed_estados_pedido(db_session); _seed_formas_pago(db_session)
        producto_factory(db_session, id=1, nombre="Scarce", precio_base=Decimal("100.00"), stock_cantidad=1)

        data = _init_request(items=[
            CartItemInput(producto_id=1, nombre="Scarce", precio=Decimal("100.00"), cantidad=5, ingredientes_excluidos=[])
        ])
        with pytest.raises(ValueError, match="Stock insuficiente"):
            PagoService.init_from_cart(db_session, data, _make_mock_usuario())

        assert len(db_session.exec(select(CarritoSnapshot)).all()) == 0


# ═══════════════════════════════════════════════════════════════════════════
# 8.3-8.5: Webhook flow — unit-level tests via mocked session
# ═══════════════════════════════════════════════════════════════════════════


class TestWebhookFlow:

    @patch("app.modules.VentasPagosTrazabilidad.Pago.service.get_ws_manager")
    @patch("app.modules.VentasPagosTrazabilidad.Pago.service.PagoService.get_payment_from_mp")
    @patch("sqlmodel.Session")
    def test_approved_creates_pedido_and_deletes_snapshot(self, mock_session_cls, mock_get_payment, mock_ws, db_session):
        """process_webhook on approved creates Pedido, deletes snapshot, backfills pago."""
        from tests.conftest import (
            _seed_roles, _seed_estados_pedido, _seed_formas_pago, producto_factory,
        )
        _seed_roles(db_session); _seed_estados_pedido(db_session); _seed_formas_pago(db_session)
        producto_factory(db_session, id=1, nombre="Test", precio_base=Decimal("100.00"), stock_cantidad=10)

        from app.modules.VentasPagosTrazabilidad.Pago.models import Pago
        from app.modules.VentasPagosTrazabilidad.Pedido.models import Pedido
        import uuid

        ext_ref = str(uuid.uuid4())
        idem_key = str(uuid.uuid4())

        snapshot = CarritoSnapshot(
            usuario_id=1,
            items=[{"producto_id": 1, "nombre": "Test", "precio": 100.0, "cantidad": 2, "ingredientes_excluidos": None}],
            forma_pago_codigo="MERCADOPAGO", costo_envio=Decimal("0.00"),
            subtotal=Decimal("200.00"), total=Decimal("200.00"), external_reference=ext_ref,
        )
        db_session.add(snapshot)

        pago = Pago(pedido_id=None, mp_status="pending", external_reference=ext_ref,
                     idempotency_key=idem_key, transaction_amount=Decimal("200.00"))
        db_session.add(pago)
        db_session.commit()

        mock_get_payment.return_value = {
            "status": "approved", "status_detail": "accredited",
            "external_reference": ext_ref, "idempotency_key": idem_key,
        }
        mock_ws_instance = MagicMock()
        mock_ws.return_value = mock_ws_instance
        mock_session_cls.return_value.__enter__.return_value = db_session

        result = PagoService.process_webhook({"id": "999999", "topic": "payment"})
        assert result["status"] == "received"

        pedidos = db_session.exec(select(Pedido)).all()
        assert len(pedidos) == 1
        assert pedidos[0].estado_codigo == "CONFIRMADO"

        snapshots_left = db_session.exec(
            select(CarritoSnapshot).where(CarritoSnapshot.external_reference == ext_ref)
        ).all()
        assert len(snapshots_left) == 0

    @patch("app.modules.VentasPagosTrazabilidad.Pago.service.get_ws_manager")
    @patch("app.modules.VentasPagosTrazabilidad.Pago.service.PagoService.get_payment_from_mp")
    @patch("sqlmodel.Session")
    def test_duplicate_webhook_no_duplicate_pedido(self, mock_session_cls, mock_get_payment, mock_ws, db_session):
        from tests.conftest import (
            _seed_roles, _seed_estados_pedido, _seed_formas_pago, producto_factory,
        )
        _seed_roles(db_session); _seed_estados_pedido(db_session); _seed_formas_pago(db_session)
        producto_factory(db_session, id=1, nombre="Test", precio_base=Decimal("100.00"), stock_cantidad=10)

        from app.modules.VentasPagosTrazabilidad.Pago.models import Pago
        from app.modules.VentasPagosTrazabilidad.Pedido.models import Pedido
        import uuid

        ext_ref = str(uuid.uuid4())
        idem_key = str(uuid.uuid4())

        snapshot = CarritoSnapshot(
            usuario_id=1,
            items=[{"producto_id": 1, "nombre": "Test", "precio": 100.0, "cantidad": 1}],
            forma_pago_codigo="MERCADOPAGO", costo_envio=Decimal("0.00"),
            subtotal=Decimal("100.00"), total=Decimal("100.00"), external_reference=ext_ref,
        )
        db_session.add(snapshot)

        pago = Pago(pedido_id=None, mp_status="pending", external_reference=ext_ref,
                     idempotency_key=idem_key, transaction_amount=Decimal("100.00"))
        db_session.add(pago)
        db_session.commit()

        mock_get_payment.return_value = {
            "status": "approved", "status_detail": "accredited",
            "external_reference": ext_ref, "idempotency_key": idem_key,
        }
        mock_ws_instance = MagicMock()
        mock_ws.return_value = mock_ws_instance
        mock_session_cls.return_value.__enter__.return_value = db_session

        PagoService.process_webhook({"id": "111", "topic": "payment"})
        PagoService.process_webhook({"id": "222", "topic": "payment"})

        assert len(db_session.exec(select(Pedido)).all()) == 1

    @patch("app.modules.VentasPagosTrazabilidad.Pago.service.PagoService.get_payment_from_mp")
    @patch("sqlmodel.Session")
    def test_rejected_preserves_snapshot(self, mock_session_cls, mock_get_payment, db_session):
        from tests.conftest import _seed_roles, _seed_estados_pedido, _seed_formas_pago
        _seed_roles(db_session); _seed_estados_pedido(db_session); _seed_formas_pago(db_session)

        from app.modules.VentasPagosTrazabilidad.Pago.models import Pago
        from app.modules.VentasPagosTrazabilidad.Pedido.models import Pedido
        import uuid

        ext_ref = str(uuid.uuid4())
        idem_key = str(uuid.uuid4())

        snapshot = CarritoSnapshot(
            usuario_id=1,
            items=[{"producto_id": 1, "nombre": "Test", "precio": 100.0, "cantidad": 1}],
            forma_pago_codigo="MERCADOPAGO", costo_envio=Decimal("0.00"),
            subtotal=Decimal("100.00"), total=Decimal("100.00"), external_reference=ext_ref,
        )
        db_session.add(snapshot)

        pago = Pago(pedido_id=None, mp_status="pending", external_reference=ext_ref,
                     idempotency_key=idem_key, transaction_amount=Decimal("100.00"))
        db_session.add(pago)
        db_session.commit()

        mock_get_payment.return_value = {
            "status": "rejected", "status_detail": "cc_rejected_other_reason",
            "external_reference": ext_ref, "idempotency_key": idem_key,
        }
        mock_session_cls.return_value.__enter__.return_value = db_session

        PagoService.process_webhook({"id": "333", "topic": "payment"})

        assert len(db_session.exec(
            select(CarritoSnapshot).where(CarritoSnapshot.external_reference == ext_ref)
        ).all()) == 1
        assert len(db_session.exec(select(Pedido)).all()) == 0


# ═══════════════════════════════════════════════════════════════════════════
# 8.6: crear_desde_snapshot — retiro en local
# ═══════════════════════════════════════════════════════════════════════════


class TestCrearDesdeSnapshot:

    def test_retiro_en_local(self, db_session):
        from tests.conftest import (
            _seed_roles, _seed_estados_pedido, _seed_formas_pago, producto_factory,
        )
        _seed_roles(db_session); _seed_estados_pedido(db_session); _seed_formas_pago(db_session)
        producto_factory(db_session, id=1, nombre="Test", precio_base=Decimal("100.00"), stock_cantidad=10)

        snapshot = CarritoSnapshot(
            usuario_id=1,
            items=[{"producto_id": 1, "nombre": "Test", "precio": 100.0, "cantidad": 2, "ingredientes_excluidos": None}],
            direccion_id=None, direccion_snapshot=None,
            forma_pago_codigo="MERCADOPAGO", costo_envio=Decimal("0.00"),
            subtotal=Decimal("200.00"), total=Decimal("200.00"), external_reference="test-retiro",
        )
        db_session.add(snapshot)
        db_session.commit()

        pedido = PedidoService.crear_desde_snapshot(db_session, snapshot)
        assert pedido.direccion_id is None
        assert pedido.direccion_snapshot is None
        assert pedido.costo_envio == Decimal("0.00")
        assert pedido.estado_codigo == "CONFIRMADO"


# ═══════════════════════════════════════════════════════════════════════════
# 8.7: Stock insufficient rollback
# ═══════════════════════════════════════════════════════════════════════════


class TestStockRollback:

    def test_raises_409_on_stock_failure(self, db_session):
        from tests.conftest import (
            _seed_roles, _seed_estados_pedido, _seed_formas_pago, producto_factory,
        )
        from app.modules.VentasPagosTrazabilidad.Pedido.models import Pedido

        _seed_roles(db_session); _seed_estados_pedido(db_session); _seed_formas_pago(db_session)
        producto_factory(db_session, id=1, nombre="Limited", precio_base=Decimal("100.00"), stock_cantidad=0)

        snapshot = CarritoSnapshot(
            usuario_id=1,
            items=[{"producto_id": 1, "nombre": "Limited", "precio": 100.0, "cantidad": 5, "ingredientes_excluidos": None}],
            forma_pago_codigo="MERCADOPAGO", costo_envio=Decimal("0.00"),
            subtotal=Decimal("500.00"), total=Decimal("500.00"), external_reference="test-rollback",
        )
        db_session.add(snapshot)
        db_session.commit()

        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            PedidoService.crear_desde_snapshot(db_session, snapshot)

        assert exc_info.value.status_code == 409
        assert "stock_insuficiente" in str(exc_info.value.detail)
        assert len(db_session.exec(select(Pedido)).all()) == 0


# ═══════════════════════════════════════════════════════════════════════════
# 8.9: Snapshot TTL cleanup
# ═══════════════════════════════════════════════════════════════════════════


class TestSnapshotTTLCleanup:

    def test_deletes_only_expired(self, db_session):
        from datetime import datetime, timezone, timedelta

        active = CarritoSnapshot(
            usuario_id=1, items=[], forma_pago_codigo="MERCADOPAGO",
            costo_envio=Decimal("0.00"), subtotal=Decimal("0.00"), total=Decimal("0.00"),
            external_reference="active-ref",
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        db_session.add(active)

        expired = CarritoSnapshot(
            usuario_id=1, items=[], forma_pago_codigo="MERCADOPAGO",
            costo_envio=Decimal("0.00"), subtotal=Decimal("0.00"), total=Decimal("0.00"),
            external_reference="expired-ref",
            expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
        db_session.add(expired)
        db_session.commit()

        repo = CarritoSnapshotRepository(db_session)
        deleted_count = repo.delete_expired()
        db_session.commit()

        assert deleted_count == 1
        assert repo.get_by_external_reference("active-ref") is not None
        assert repo.get_by_external_reference("expired-ref") is None


# ═══════════════════════════════════════════════════════════════════════════
# 8.10: Regression — PAGO_LOCAL flow
# ═══════════════════════════════════════════════════════════════════════════


class TestSyncFlowsRegression:

    def test_pago_local_creates_pedido(self, db_session, client, client_headers):
        from tests.conftest import (
            _seed_roles, _seed_estados_pedido, _seed_formas_pago, producto_factory,
        )
        _seed_roles(db_session); _seed_estados_pedido(db_session); _seed_formas_pago(db_session)
        producto_factory(db_session, id=1, nombre="Test", precio_base=Decimal("100.00"), stock_cantidad=10)

        payload = {
            "forma_pago_codigo": "PAGO_LOCAL",
            "subtotal": "100.00", "descuento": "0.00", "costo_envio": "0.00",
            "detalles": [{"producto_id": 1, "cantidad": 1, "nombre_snapshot": "Test", "precio_snapshot": "100.00"}],
        }
        response = client.post("/api/v1/pedidos/", json=payload, headers=client_headers)
        assert response.status_code == 201
        data = response.json()
        assert data["estado_codigo"] == "CONFIRMADO"
        assert data["forma_pago_codigo"] == "PAGO_LOCAL"
        assert data["direccion_id"] is None
