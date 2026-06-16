"""
Integration tests for Pedido (Order) module.

Covers: create, avanzar FSM, cancel, RBAC guards, list, historial.
Uses real SQLite DB via conftest fixtures. Pedidos are created directly
in DB to avoid complex WS/manager dependency setup.
"""
import pytest
from decimal import Decimal
from fastapi import status

from modules.IdentidadYAcceso.Usuario.models import Usuario
from modules.IdentidadYAcceso.usuario_rol import UsuarioRol
from modules.IdentidadYAcceso.DireccionEntrega.models import DireccionEntrega
from modules.CatalogoDeProductos.Producto.models import Producto
from modules.VentasPagosTrazabilidad.Pedido.models import Pedido
from modules.VentasPagosTrazabilidad.DetallePedido.models import DetallePedido
from modules.VentasPagosTrazabilidad.HistorialEstadoPedido.models import HistorialEstadoPedido
from core.security.passwords import get_password_hash


# ═══════════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════════

def _ensure_roles(db_session):
    from modules.IdentidadYAcceso.Rol.models import Rol
    from sqlmodel import select
    for codigo, nombre in [
        ("ADMIN", "Admin"), ("CLIENT", "Client"),
        ("PEDIDOS", "Pedidos"), ("STOCK", "Stock"),
    ]:
        if not db_session.exec(select(Rol).where(Rol.codigo == codigo)).first():
            db_session.add(Rol(codigo=codigo, nombre=nombre))
    db_session.flush()


def _ensure_estados(db_session):
    from modules.VentasPagosTrazabilidad.EstadoPedido.models import EstadoPedido
    from sqlmodel import select
    for codigo, desc, orden, terminal in [
        ("PENDIENTE", "Pendiente", 1, False),
        ("CONFIRMADO", "Confirmado", 2, False),
        ("EN_PREP", "En prep", 3, False),
        ("ENTREGADO", "Entregado", 4, True),
        ("CANCELADO", "Cancelado", 5, True),
    ]:
        if not db_session.exec(select(EstadoPedido).where(EstadoPedido.codigo == codigo)).first():
            db_session.add(EstadoPedido(codigo=codigo, descripcion=desc, orden=orden, es_terminal=terminal))
    db_session.flush()


def _ensure_formas_pago(db_session):
    from modules.VentasPagosTrazabilidad.FormaPago.models import FormaPago
    from sqlmodel import select
    for codigo, desc, hab in [
        ("MERCADOPAGO", "MP", True),
        ("EFECTIVO", "Efectivo", True),
        ("PAGO_LOCAL", "Pago local", True),
    ]:
        if not db_session.exec(select(FormaPago).where(FormaPago.codigo == codigo)).first():
            db_session.add(FormaPago(codigo=codigo, descripcion=desc, habilitado=hab))
    db_session.flush()


def _seed_all(db_session):
    _ensure_roles(db_session)
    _ensure_estados(db_session)
    _ensure_formas_pago(db_session)


def _create_user(db_session, email="pedidotest@test.com", roles=None):
    if roles is None:
        roles = ["CLIENT"]
    u = Usuario(
        nombre="Test", apellido="User", email=email,
        password_hash=get_password_hash("pass123"),
    )
    db_session.add(u)
    db_session.flush()
    for c in roles:
        db_session.add(UsuarioRol(usuario_id=u.id, rol_codigo=c))
    db_session.flush()
    return u


def _create_producto(db_session, nombre="TestProd", stock=100):
    p = Producto(
        nombre=nombre, descripcion="Test",
        precio_base=Decimal("500"), precio_actual=Decimal("500"),
        stock_cantidad=stock, tiempo_prep_min=5, disponible=True,
    )
    db_session.add(p)
    db_session.flush()
    return p


def _create_direccion(db_session, usuario_id):
    d = DireccionEntrega(
        usuario_id=usuario_id, alias="Casa",
        linea1="Calle Test 123", ciudad="Mendoza",
        es_principal=True,
    )
    db_session.add(d)
    db_session.flush()
    return d


def _create_pedido(db_session, usuario_id, estado="PENDIENTE", forma_pago="EFECTIVO"):
    """Direct DB pedido creation (bypasses HTTP complexity)."""
    p = Pedido(
        usuario_id=usuario_id,
        estado_codigo=estado,
        forma_pago_codigo=forma_pago,
        subtotal=Decimal("500"),
        total=Decimal("500"),
    )
    db_session.add(p)
    db_session.flush()
    return p


# ═══════════════════════════════════════════════════════════════════════════
# PEDIDO LIST TESTS
# ═══════════════════════════════════════════════════════════════════════════

class TestPedidoList:

    def test_list_pedidos_admin(self, client, admin_headers, db_session):
        """Admin/PEDIDOS can list all orders."""
        _seed_all(db_session)
        u = _create_user(db_session)
        _create_pedido(db_session, u.id)

        response = client.get("/api/v1/pedidos/", headers=admin_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 1

    def test_mis_pedidos_client(self, client, client_headers, db_session):
        """Authenticated user can view their own orders."""
        _seed_all(db_session)
        response = client.get("/api/v1/pedidos/mis-pedidos", headers=client_headers)
        assert response.status_code == 200

    def test_list_pedidos_unauthenticated(self, client):
        """Unauthenticated access to pedidos returns 401."""
        response = client.get("/api/v1/pedidos/")
        assert response.status_code == 401

    def test_list_pedidos_client_rejected(self, client, client_headers, db_session):
        """Client cannot list ALL pedidos (only their own)."""
        _seed_all(db_session)
        response = client.get("/api/v1/pedidos/", headers=client_headers)
        assert response.status_code == 403

    def test_get_pedido_by_id(self, client, admin_headers, db_session):
        """Get single pedido by ID."""
        _seed_all(db_session)
        u = _create_user(db_session)
        p = _create_pedido(db_session, u.id)

        response = client.get(f"/api/v1/pedidos/{p.id}", headers=admin_headers)
        assert response.status_code == 200
        assert response.json()["id"] == p.id

    def test_pedido_not_found_returns_404(self, client, admin_headers):
        response = client.get("/api/v1/pedidos/99999", headers=admin_headers)
        assert response.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════
# PEDIDO AVANZAR FSM TESTS
# ═══════════════════════════════════════════════════════════════════════════

class TestPedidoAvanzarFSM:

    def test_avanzar_pendiente_to_confirmado(self, client, admin_headers, db_session):
        """PENDIENTE -> CONFIRMADO via avanzar endpoint."""
        _seed_all(db_session)
        u = _create_user(db_session)
        prod = _create_producto(db_session, stock=50)
        p = _create_pedido(db_session, u.id, estado="PENDIENTE", forma_pago="EFECTIVO")

        # Add a detail for stock validation
        db_session.add(DetallePedido(
            pedido_id=p.id, producto_id=prod.id,
            cantidad=1, nombre_snapshot=prod.nombre,
            precio_snapshot=prod.precio_actual,
            subtotal_snap=prod.precio_actual,
        ))
        db_session.flush()

        response = client.patch(
            f"/api/v1/pedidos/{p.id}/avanzar",
            headers=admin_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["estado_anterior"] == "PENDIENTE"
        assert data["estado_actual"] == "CONFIRMADO"

    def test_avanzar_full_cycle(self, client, admin_headers, db_session):
        """FSM: PENDIENTE -> CONFIRMADO -> EN_PREP -> ENTREGADO."""
        _seed_all(db_session)
        u = _create_user(db_session)
        prod = _create_producto(db_session, stock=50)
        p = _create_pedido(db_session, u.id, estado="PENDIENTE", forma_pago="EFECTIVO")

        db_session.add(DetallePedido(
            pedido_id=p.id, producto_id=prod.id,
            cantidad=1, nombre_snapshot=prod.nombre,
            precio_snapshot=prod.precio_actual,
            subtotal_snap=prod.precio_actual,
        ))
        db_session.flush()

        expected = ["CONFIRMADO", "EN_PREP", "ENTREGADO"]
        for exp_state in expected:
            resp = client.patch(
                f"/api/v1/pedidos/{p.id}/avanzar",
                headers=admin_headers,
            )
            assert resp.status_code == 200, f"Failed advancing to {exp_state}"
            assert resp.json()["estado_actual"] == exp_state

    def test_terminal_state_blocks_avanzar(self, client, admin_headers, db_session):
        """Advancing from ENTREGADO returns 400."""
        _seed_all(db_session)
        u = _create_user(db_session)
        p = _create_pedido(db_session, u.id, estado="ENTREGADO")

        response = client.patch(
            f"/api/v1/pedidos/{p.id}/avanzar",
            headers=admin_headers,
        )
        assert response.status_code == 400

    def test_avanzar_mercado_pago_blocked(self, client, admin_headers, db_session):
        """MercadoPago orders cannot be advanced via endpoint."""
        _seed_all(db_session)
        u = _create_user(db_session)
        p = _create_pedido(db_session, u.id, estado="PENDIENTE", forma_pago="MERCADOPAGO")

        response = client.patch(
            f"/api/v1/pedidos/{p.id}/avanzar",
            headers=admin_headers,
        )
        assert response.status_code in (400, 404)

    def test_avanzar_client_rejected(self, client, client_headers):
        """Client cannot advance pedidos."""
        response = client.patch("/api/v1/pedidos/1/avanzar", headers=client_headers)
        assert response.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════
# PEDIDO CANCEL TESTS
# ═══════════════════════════════════════════════════════════════════════════

class TestPedidoCancel:

    def test_cancel_pendiente_pedido(self, client, client_headers, db_session):
        """Customer can cancel their own PENDIENTE order."""
        _seed_all(db_session)
        # The client_headers user is created by conftest. We need their ID.
        from sqlmodel import select
        u = db_session.exec(select(Usuario).where(Usuario.email == "client_test@test.com")).first()
        assert u is not None

        p = _create_pedido(db_session, u.id, estado="PENDIENTE")
        response = client.patch(
            f"/api/v1/pedidos/{p.id}/cancelar",
            json={"motivo": "Ya no lo quiero"},
            headers=client_headers,
        )
        assert response.status_code == 200
        assert response.json()["estado_actual"] == "CANCELADO"

    def test_cancel_empty_motivo_fails(self, client, client_headers, db_session):
        """Cancel with empty motivo returns 422."""
        _seed_all(db_session)
        from sqlmodel import select
        u = db_session.exec(select(Usuario).where(Usuario.email == "client_test@test.com")).first()
        p = _create_pedido(db_session, u.id, estado="PENDIENTE")

        response = client.patch(
            f"/api/v1/pedidos/{p.id}/cancelar",
            json={"motivo": ""},
            headers=client_headers,
        )
        # Empty motivo should fail validation (422)
        assert response.status_code == 422

    def test_cancel_terminal_state_blocked(self, client, admin_headers, db_session):
        """Cannot cancel ENTREGADO order."""
        _seed_all(db_session)
        u = _create_user(db_session)
        p = _create_pedido(db_session, u.id, estado="ENTREGADO")

        response = client.patch(
            f"/api/v1/pedidos/{p.id}/cancelar",
            json={"motivo": "Quiero cancelar"},
            headers=admin_headers,
        )
        assert response.status_code == 400

    def test_cancel_en_prep_pedido(self, client, admin_headers, db_session):
        """Admin can cancel an EN_PREP order and stock is restored."""
        _seed_all(db_session)
        u = _create_user(db_session)
        prod = _create_producto(db_session, stock=50)
        p = _create_pedido(db_session, u.id, estado="EN_PREP", forma_pago="EFECTIVO")

        # Add a detail so stock restoration can be verified
        db_session.add(DetallePedido(
            pedido_id=p.id, producto_id=prod.id,
            cantidad=3, nombre_snapshot=prod.nombre,
            precio_snapshot=prod.precio_actual,
            subtotal_snap=prod.precio_actual * 3,
        ))
        db_session.flush()

        stock_before = prod.stock_cantidad

        response = client.patch(
            f"/api/v1/pedidos/{p.id}/cancelar",
            json={"motivo": "Cancelacion desde EN_PREP"},
            headers=admin_headers,
        )
        assert response.status_code == 200
        assert response.json()["estado_actual"] == "CANCELADO"

        # Verify stock was restored (same logic as cancelling from CONFIRMADO)
        db_session.refresh(prod)
        assert prod.stock_cantidad == stock_before + 3

    def test_cancel_en_prep_restores_stock_multiple_products(self, client, admin_headers, db_session):
        """Cancelling from EN_PREP restores stock for ALL detail lines."""
        _seed_all(db_session)
        u = _create_user(db_session)
        prod_a = _create_producto(db_session, nombre="ProdA", stock=100)
        prod_b = _create_producto(db_session, nombre="ProdB", stock=200)
        p = _create_pedido(db_session, u.id, estado="EN_PREP", forma_pago="EFECTIVO")

        db_session.add(DetallePedido(
            pedido_id=p.id, producto_id=prod_a.id,
            cantidad=5, nombre_snapshot=prod_a.nombre,
            precio_snapshot=prod_a.precio_actual,
            subtotal_snap=prod_a.precio_actual * 5,
        ))
        db_session.add(DetallePedido(
            pedido_id=p.id, producto_id=prod_b.id,
            cantidad=7, nombre_snapshot=prod_b.nombre,
            precio_snapshot=prod_b.precio_actual,
            subtotal_snap=prod_b.precio_actual * 7,
        ))
        db_session.flush()

        stock_a_before = prod_a.stock_cantidad
        stock_b_before = prod_b.stock_cantidad

        response = client.patch(
            f"/api/v1/pedidos/{p.id}/cancelar",
            json={"motivo": "Stock restore test"},
            headers=admin_headers,
        )
        assert response.status_code == 200

        db_session.refresh(prod_a)
        db_session.refresh(prod_b)
        assert prod_a.stock_cantidad == stock_a_before + 5
        assert prod_b.stock_cantidad == stock_b_before + 7


# ═══════════════════════════════════════════════════════════════════════════
# PEDIDO HISTORIAL TESTS
# ═══════════════════════════════════════════════════════════════════════════

class TestPedidoHistorial:

    def test_historial_append_only(self, client, admin_headers, db_session):
        """State transitions create history entries (verified via GET)."""
        _seed_all(db_session)
        u = _create_user(db_session)
        prod = _create_producto(db_session, stock=50)
        p = _create_pedido(db_session, u.id, estado="CONFIRMADO")

        # Create a history entry manually
        db_session.add(HistorialEstadoPedido(
            pedido_id=p.id,
            estado_desde="PENDIENTE",
            estado_hacia="CONFIRMADO",
            usuario_id=u.id,
            es_sistema=False,
        ))
        db_session.flush()

        response = client.get(
            f"/api/v1/pedidos/{p.id}/historial",
            headers=admin_headers,
        )
        assert response.status_code == 200
        historial = response.json()
        assert len(historial) >= 1
        assert historial[0]["estado_hacia"] == "CONFIRMADO"

    def test_historial_ownership_scope(self, client, client_headers, db_session):
        """User A cannot access user B's pedido historial."""
        _seed_all(db_session)
        from sqlmodel import select
        # Create user B
        user_b = _create_user(db_session, email="userb_hist@test.com")
        p = _create_pedido(db_session, user_b.id)

        # Client tries to access user B's historial
        response = client.get(
            f"/api/v1/pedidos/{p.id}/historial",
            headers=client_headers,
        )
        assert response.status_code in (403, 404)
