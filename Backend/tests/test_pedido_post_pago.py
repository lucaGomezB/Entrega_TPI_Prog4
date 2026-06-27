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

from modules.VentasPagosTrazabilidad.Pago.service import PagoService
from modules.VentasPagosTrazabilidad.Pago.schemas import InitFromCartRequest, CartItemInput
from modules.VentasPagosTrazabilidad.Pedido.service import PedidoService
from modules.VentasPagosTrazabilidad.CarritoSnapshot.models import CarritoSnapshot
from modules.VentasPagosTrazabilidad.CarritoSnapshot.repository import CarritoSnapshotRepository


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


class TestInitFromCartHappyPath:

    @patch("modules.VentasPagosTrazabilidad.Pago.service._get_mp_sdk")
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

    @patch("modules.VentasPagosTrazabilidad.Pago.service._get_mp_sdk")
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

    @patch("modules.VentasPagosTrazabilidad.Pago.service.get_ws_manager")
    @patch("modules.VentasPagosTrazabilidad.Pago.service.PagoService.get_payment_from_mp")
    @patch("sqlmodel.Session")
    def test_approved_creates_pedido_and_deletes_snapshot(self, mock_session_cls, mock_get_payment, mock_ws, db_session):
        """process_webhook on approved creates Pedido, deletes snapshot, backfills pago."""
        from tests.conftest import (
            _seed_roles, _seed_estados_pedido, _seed_formas_pago, producto_factory,
        )
        _seed_roles(db_session); _seed_estados_pedido(db_session); _seed_formas_pago(db_session)
        producto_factory(db_session, id=1, nombre="Test", precio_base=Decimal("100.00"), stock_cantidad=10)

        from modules.VentasPagosTrazabilidad.Pago.models import Pago
        from modules.VentasPagosTrazabilidad.Pedido.models import Pedido
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

    @patch("modules.VentasPagosTrazabilidad.Pago.service.get_ws_manager")
    @patch("modules.VentasPagosTrazabilidad.Pago.service.PagoService.get_payment_from_mp")
    @patch("sqlmodel.Session")
    def test_duplicate_webhook_no_duplicate_pedido(self, mock_session_cls, mock_get_payment, mock_ws, db_session):
        from tests.conftest import (
            _seed_roles, _seed_estados_pedido, _seed_formas_pago, producto_factory,
        )
        _seed_roles(db_session); _seed_estados_pedido(db_session); _seed_formas_pago(db_session)
        producto_factory(db_session, id=1, nombre="Test", precio_base=Decimal("100.00"), stock_cantidad=10)

        from modules.VentasPagosTrazabilidad.Pago.models import Pago
        from modules.VentasPagosTrazabilidad.Pedido.models import Pedido
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

    @patch("modules.VentasPagosTrazabilidad.Pago.service.PagoService.get_payment_from_mp")
    @patch("sqlmodel.Session")
    def test_rejected_preserves_snapshot(self, mock_session_cls, mock_get_payment, db_session):
        from tests.conftest import _seed_roles, _seed_estados_pedido, _seed_formas_pago
        _seed_roles(db_session); _seed_estados_pedido(db_session); _seed_formas_pago(db_session)

        from modules.VentasPagosTrazabilidad.Pago.models import Pago
        from modules.VentasPagosTrazabilidad.Pedido.models import Pedido
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
        from modules.VentasPagosTrazabilidad.Pedido.models import Pedido

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
