"""
Integration tests for Pedido (Order) module.

Covers: create, avanzar FSM, cancel, RBAC guards, list, historial.
Uses real SQLite DB via conftest fixtures. Pedidos are created directly
in DB to avoid complex WS/manager dependency setup.
"""
import pytest
from decimal import Decimal
from fastapi import status

from app.modules.IdentidadYAcceso.Usuario.models import Usuario
from app.modules.IdentidadYAcceso.usuario_rol import UsuarioRol
from app.modules.IdentidadYAcceso.DireccionEntrega.models import DireccionEntrega
from app.modules.CatalogoDeProductos.Producto.models import Producto
from app.modules.VentasPagosTrazabilidad.Pedido.models import Pedido
from app.modules.VentasPagosTrazabilidad.DetallePedido.models import DetallePedido
from app.modules.VentasPagosTrazabilidad.HistorialEstadoPedido.models import HistorialEstadoPedido
from app.core.security.passwords import get_password_hash


# ═══════════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════════

def _ensure_roles(db_session):
    from app.modules.IdentidadYAcceso.Rol.models import Rol
    from sqlmodel import select
    for codigo, nombre in [
        ("ADMIN", "Admin"), ("CLIENT", "Client"),
        ("PEDIDOS", "Pedidos"), ("STOCK", "Stock"),
    ]:
        if not db_session.exec(select(Rol).where(Rol.codigo == codigo)).first():
            db_session.add(Rol(codigo=codigo, nombre=nombre))
    db_session.flush()


def _ensure_estados(db_session):
    from app.modules.VentasPagosTrazabilidad.EstadoPedido.models import EstadoPedido
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
    from app.modules.VentasPagosTrazabilidad.FormaPago.models import FormaPago
    from sqlmodel import select
    for codigo, desc, hab in [
        ("MERCADOPAGO", "MP", True),
        ("EFECTIVO", "Efectivo", False),
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
        """Customer (CLIENT role) cannot cancel pedidos — returns 403.
        
        Only ADMIN and PEDIDOS roles can cancel orders after the role guard fix.
        """
        _seed_all(db_session)
        from sqlmodel import select
        u = db_session.exec(select(Usuario).where(Usuario.email == "client_test@test.com")).first()
        assert u is not None

        p = _create_pedido(db_session, u.id, estado="PENDIENTE")
        response = client.patch(
            f"/api/v1/pedidos/{p.id}/cancelar",
            json={"motivo": "Ya no lo quiero"},
            headers=client_headers,
        )
        assert response.status_code == 403

    def test_cancel_pendiente_admin(self, client, admin_headers, db_session):
        """Admin can cancel any PENDIENTE order."""
        _seed_all(db_session)
        u = _create_user(db_session, email="admincancel@test.com", roles=["CLIENT"])
        p = _create_pedido(db_session, u.id, estado="PENDIENTE")
        response = client.patch(
            f"/api/v1/pedidos/{p.id}/cancelar",
            json={"motivo": "Cancelado por admin"},
            headers=admin_headers,
        )
        assert response.status_code == 200
        assert response.json()["estado_actual"] == "CANCELADO"

    def test_cancel_pendiente_pedidos_role(self, client, pedidos_headers, db_session):
        """PEDIDOS role can cancel any PENDIENTE order."""
        _seed_all(db_session)
        u = _create_user(db_session, email="pedidoscancel@test.com", roles=["CLIENT"])
        p = _create_pedido(db_session, u.id, estado="PENDIENTE")
        response = client.patch(
            f"/api/v1/pedidos/{p.id}/cancelar",
            json={"motivo": "Cancelado por pedidos"},
            headers=pedidos_headers,
        )
        assert response.status_code == 200
        assert response.json()["estado_actual"] == "CANCELADO"

    def test_cancel_empty_motivo_fails(self, client, admin_headers, db_session):
        """Cancel with empty motivo returns 422 (uses admin to bypass role guard)."""
        _seed_all(db_session)
        u = _create_user(db_session, email="empty_motivo@test.com")
        p = _create_pedido(db_session, u.id, estado="PENDIENTE")

        response = client.patch(
            f"/api/v1/pedidos/{p.id}/cancelar",
            json={"motivo": ""},
            headers=admin_headers,
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


# ═══════════════════════════════════════════════════════════════════════════
# PEDIDO CREATE TESTS — POST /api/v1/pedidos/
# ═══════════════════════════════════════════════════════════════════════════

class TestPedidoCreate:

    def test_create_pedido_ok_pendiente(self, client, client_headers, db_session):
        """POST /pedidos with PAGO_LOCAL creates order (auto-confirms to CONFIRMADO for in-store payment)
        with calculated total and detail snapshots."""
        _seed_all(db_session)
        prod = _create_producto(db_session, nombre="Pizza", stock=50)

        response = client.post("/api/v1/pedidos/", json={
            "forma_pago_codigo": "PAGO_LOCAL",
            "subtotal": "1500.00",
            "costo_envio": "0.00",
            "detalles": [{
                "producto_id": prod.id,
                "cantidad": 3,
                "nombre_snapshot": prod.nombre,
                "precio_snapshot": str(prod.precio_actual),
            }],
        }, headers=client_headers)
        assert response.status_code == 201
        data = response.json()
        assert data["estado_codigo"] == "CONFIRMADO"  # PAGO_LOCAL auto-confirms
        assert Decimal(data["total"]) > Decimal("0")
        assert data["costo_envio"] == "0.00"
        assert data["direccion_id"] is None
        assert len(data["detalles"]) == 1
        det = data["detalles"][0]
        assert det["nombre_snapshot"] == prod.nombre
        assert Decimal(det["precio_snapshot"]) == prod.precio_actual
        assert det["cantidad"] == 3
        assert Decimal(det["subtotal_snap"]) == prod.precio_actual * 3

    def test_create_pedido_stock_insuficiente(self, client, client_headers, db_session):
        """POST /pedidos with cantidad > stock returns 422 stock_insuficiente.

        The error prevents pedido creation entirely — stock is never deducted.
        UoW rollback on exception guarantees atomicity.
        """
        _seed_all(db_session)
        prod = _create_producto(db_session, nombre="ScarceItem", stock=2)

        response = client.post("/api/v1/pedidos/", json={
            "forma_pago_codigo": "PAGO_LOCAL",
            "subtotal": "5000.00",
            "detalles": [{
                "producto_id": prod.id,
                "cantidad": 10,
                "nombre_snapshot": prod.nombre,
                "precio_snapshot": str(prod.precio_actual),
            }],
        }, headers=client_headers)
        assert response.status_code == 422
        resp_json = response.json()
        detail = resp_json.get("detail", "")

        # detail may be a dict, list, or string depending on error origin
        error_text = ""
        if isinstance(detail, dict):
            error_text = detail.get("error", "") + " " + detail.get("mensaje", "")
        elif isinstance(detail, list):
            error_text = " ".join(str(d.get("msg", "")) for d in detail)
        else:
            error_text = str(detail)

        assert "stock" in error_text.lower() or "insuficiente" in error_text.lower()

    def test_create_pedido_mercadopago_stays_pendiente(self, client, client_headers, db_session):
        """POST /pedidos with MERCADOPAGO creates order in PENDIENTE (awaits payment).
        
        Note: Without direccion_id, costo_envio is forced to 0 by the service.
        """
        _seed_all(db_session)
        prod = _create_producto(db_session, nombre="MP Product", stock=30)

        response = client.post("/api/v1/pedidos/", json={
            "forma_pago_codigo": "MERCADOPAGO",
            "subtotal": "1000.00",
            "costo_envio": "50.00",
            "detalles": [{
                "producto_id": prod.id,
                "cantidad": 2,
                "nombre_snapshot": prod.nombre,
                "precio_snapshot": str(prod.precio_actual),
            }],
        }, headers=client_headers)
        assert response.status_code == 201
        data = response.json()
        assert data["estado_codigo"] == "PENDIENTE"
        # Without direccion_id, costo_envio is forced to 0
        assert Decimal(data["total"]) == Decimal("1000.00")

    def test_create_pedido_sin_detalles_creates_empty_order(self, client, client_headers, db_session):
        """POST /pedidos without detalles creates a PENDIENTE order with zero subtotal."""
        _seed_all(db_session)

        response = client.post("/api/v1/pedidos/", json={
            "forma_pago_codigo": "PAGO_LOCAL",
            "subtotal": "0.00",
            "detalles": [],
        }, headers=client_headers)
        assert response.status_code == 201
        data = response.json()
        assert data["estado_codigo"] == "CONFIRMADO"  # PAGO_LOCAL auto-confirms
        assert data["total"] == "0.00"


# ═══════════════════════════════════════════════════════════════════════════
# PEDIDO PAGO_LOCAL — pickup-only validation
# ═══════════════════════════════════════════════════════════════════════════

class TestPedidoPickupOnly:
    """POST /api/v1/pedidos — PAGO_LOCAL (pickup-only) forces direccion_id=null or local-only."""

    def test_pago_local_with_personal_direccion_rejected(self, client, client_headers, db_session):
        """PAGO_LOCAL with a non-local (personal) direccion_id returns 422."""
        _seed_all(db_session)
        prod = _create_producto(db_session, stock=50)

        from sqlmodel import select
        u = db_session.exec(select(Usuario).where(Usuario.email == "client_test@test.com")).first()
        assert u is not None

        direccion = _create_direccion(db_session, u.id)  # es_local=False by default

        response = client.post("/api/v1/pedidos/", json={
            "forma_pago_codigo": "PAGO_LOCAL",
            "direccion_id": direccion.id,
            "subtotal": 500,
            "costo_envio": 50,
            "detalles": [{
                "producto_id": prod.id,
                "cantidad": 1,
                "nombre_snapshot": prod.nombre,
                "precio_snapshot": str(prod.precio_actual),
            }],
        }, headers=client_headers)
        assert response.status_code == 422

    def test_pago_local_with_local_direccion_allowed(self, client, admin_headers, client_headers, db_session):
        """PAGO_LOCAL with direccion_id pointing to a local (es_local=True) succeeds."""
        _seed_all(db_session)
        prod = _create_producto(db_session, stock=50)

        # Admin creates a local/store
        response_local = client.post("/api/v1/direcciones/", json={
            "alias": "Sucursal Centro",
            "linea1": "Av. Principal 100",
            "ciudad": "Mendoza",
            "es_local": True,
        }, headers=admin_headers)
        assert response_local.status_code == 201
        local_id = response_local.json()["id"]
        assert response_local.json()["es_local"] is True

        # Now a CLIENT creates a pedido with PAGO_LOCAL referencing that local
        from sqlmodel import select
        u = db_session.exec(select(Usuario).where(Usuario.email == "client_test@test.com")).first()
        assert u is not None
        _ensure_formas_pago(db_session)

        response = client.post("/api/v1/pedidos/", json={
            "forma_pago_codigo": "PAGO_LOCAL",
            "direccion_id": local_id,
            "subtotal": 500,
            "costo_envio": 50,
            "detalles": [{
                "producto_id": prod.id,
                "cantidad": 1,
                "nombre_snapshot": prod.nombre,
                "precio_snapshot": str(prod.precio_actual),
            }],
        }, headers=client_headers)
        assert response.status_code == 201
        data = response.json()
        assert data["estado_codigo"] == "CONFIRMADO"  # PAGO_LOCAL auto-confirms
        assert data["costo_envio"] == "0.00"
        assert data["direccion_id"] == local_id

    def test_pago_local_sin_direccion_creates_order(self, client, client_headers, db_session):
        """PAGO_LOCAL without direccion_id creates order successfully (anonymous pickup)."""
        _seed_all(db_session)
        prod = _create_producto(db_session, stock=50)

        response = client.post("/api/v1/pedidos/", json={
            "forma_pago_codigo": "PAGO_LOCAL",
            "subtotal": 500,
            "costo_envio": 50,
            "detalles": [{
                "producto_id": prod.id,
                "cantidad": 1,
                "nombre_snapshot": prod.nombre,
                "precio_snapshot": str(prod.precio_actual),
            }],
        }, headers=client_headers)
        assert response.status_code == 201
        data = response.json()
        assert data["estado_codigo"] == "CONFIRMADO"  # PAGO_LOCAL auto-confirms
        assert data["costo_envio"] == "0.00"
        assert data["direccion_id"] is None

    def test_mercadopago_with_direccion_allowed(self, client, client_headers, db_session):
        """MERCADOPAGO with direccion_id is allowed (delivery-enabled method)."""
        _seed_all(db_session)
        prod = _create_producto(db_session, stock=50)

        from sqlmodel import select
        u = db_session.exec(select(Usuario).where(Usuario.email == "client_test@test.com")).first()
        assert u is not None

        direccion = _create_direccion(db_session, u.id)

        response = client.post("/api/v1/pedidos/", json={
            "forma_pago_codigo": "MERCADOPAGO",
            "direccion_id": direccion.id,
            "subtotal": 500,
            "costo_envio": 50,
            "detalles": [{
                "producto_id": prod.id,
                "cantidad": 1,
                "nombre_snapshot": prod.nombre,
                "precio_snapshot": str(prod.precio_actual),
            }],
        }, headers=client_headers)
        assert response.status_code == 201
        data = response.json()
        assert data["direccion_id"] == direccion.id


# ═══════════════════════════════════════════════════════════════════════════
# PEDIDO SORT TESTS — sort_by / sort_order query params
# ═══════════════════════════════════════════════════════════════════════════

class TestPedidoSortParams:

    def test_activos_sort_by_id_asc(self, client, admin_headers, db_session):
        """GET /pedidos/activos?sort_by=id&sort_order=asc returns sorted ascending by ID."""
        _seed_all(db_session)
        u = _create_user(db_session)
        p1 = _create_pedido(db_session, u.id, estado="PENDIENTE")
        p2 = _create_pedido(db_session, u.id, estado="PENDIENTE")
        p3 = _create_pedido(db_session, u.id, estado="PENDIENTE")

        response = client.get(
            "/api/v1/pedidos/activos?sort_by=id&sort_order=asc",
            headers=admin_headers,
        )
        assert response.status_code == 200
        items = response.json()["items"]
        ids = [item["id"] for item in items]
        assert ids == sorted(ids), f"Expected ASC by id, got {ids}"

    def test_activos_sort_by_created_at_desc(self, client, admin_headers, db_session):
        """GET /pedidos/activos?sort_by=created_at&sort_order=desc returns newest first."""
        _seed_all(db_session)
        u = _create_user(db_session)
        p1 = _create_pedido(db_session, u.id, estado="PENDIENTE")
        p2 = _create_pedido(db_session, u.id, estado="PENDIENTE")
        p3 = _create_pedido(db_session, u.id, estado="PENDIENTE")

        response = client.get(
            "/api/v1/pedidos/activos?sort_by=created_at&sort_order=desc",
            headers=admin_headers,
        )
        assert response.status_code == 200
        items = response.json()["items"]
        dates = [item["created_at"] for item in items]
        # Verify descending: each date >= next
        for i in range(len(dates) - 1):
            assert dates[i] >= dates[i + 1], f"Expected DESC by created_at, {dates[i]} < {dates[i + 1]}"

    def test_activos_sort_by_total_asc(self, client, admin_headers, db_session):
        """GET /pedidos/activos?sort_by=total&sort_order=asc returns cheapest first."""
        _seed_all(db_session)
        u = _create_user(db_session)
        p1 = _create_pedido(db_session, u.id, estado="PENDIENTE")
        p1.total = Decimal("100.00")
        p2 = _create_pedido(db_session, u.id, estado="PENDIENTE")
        p2.total = Decimal("500.00")
        p3 = _create_pedido(db_session, u.id, estado="PENDIENTE")
        p3.total = Decimal("300.00")
        db_session.flush()

        response = client.get(
            "/api/v1/pedidos/activos?sort_by=total&sort_order=asc",
            headers=admin_headers,
        )
        assert response.status_code == 200
        items = response.json()["items"]
        totals = [Decimal(item["total"]) for item in items]
        assert totals == sorted(totals), f"Expected ASC by total, got {totals}"

    def test_activos_sort_by_estado_codigo_asc(self, client, admin_headers, db_session):
        """GET /pedidos/activos?sort_by=estado_codigo&sort_order=asc sorts by status alphabetically."""
        _seed_all(db_session)
        u = _create_user(db_session)
        p1 = _create_pedido(db_session, u.id, estado="CONFIRMADO")
        p2 = _create_pedido(db_session, u.id, estado="PENDIENTE")
        p3 = _create_pedido(db_session, u.id, estado="EN_PREP")

        response = client.get(
            "/api/v1/pedidos/activos?sort_by=estado_codigo&sort_order=asc",
            headers=admin_headers,
        )
        assert response.status_code == 200
        items = response.json()["items"]
        estados = [item["estado_codigo"] for item in items]
        assert estados == sorted(estados), f"Expected ASC by estado_codigo, got {estados}"

    def test_historial_sort_by_updated_at_asc(self, client, admin_headers, db_session):
        """GET /pedidos/historial?sort_by=updated_at&sort_order=asc sorts oldest updated first."""
        _seed_all(db_session)
        u = _create_user(db_session)
        p1 = _create_pedido(db_session, u.id, estado="ENTREGADO")
        p2 = _create_pedido(db_session, u.id, estado="CANCELADO")

        response = client.get(
            "/api/v1/pedidos/historial?sort_by=updated_at&sort_order=asc",
            headers=admin_headers,
        )
        assert response.status_code == 200
        items = response.json()["items"]
        dates = [item["updated_at"] for item in items]
        for i in range(len(dates) - 1):
            assert dates[i] <= dates[i + 1], f"Expected ASC by updated_at, {dates[i]} > {dates[i + 1]}"

    def test_historial_default_sort_desc(self, client, admin_headers, db_session):
        """GET /pedidos/historial without sort params defaults to id desc."""
        _seed_all(db_session)
        u = _create_user(db_session)
        p1 = _create_pedido(db_session, u.id, estado="ENTREGADO")
        p2 = _create_pedido(db_session, u.id, estado="CANCELADO")

        response = client.get(
            "/api/v1/pedidos/historial",
            headers=admin_headers,
        )
        assert response.status_code == 200
        items = response.json()["items"]
        ids = [item["id"] for item in items]
        assert ids == sorted(ids, reverse=True), f"Expected DESC by id (default), got {ids}"

    def test_activos_sort_by_invalid_field_returns_422(self, client, admin_headers, db_session):
        """Invalid sort_by value returns 422."""
        _seed_all(db_session)
        response = client.get(
            "/api/v1/pedidos/activos?sort_by=invalid_field",
            headers=admin_headers,
        )
        assert response.status_code == 422

    def test_activos_sort_order_invalid_returns_422(self, client, admin_headers, db_session):
        """Invalid sort_order value returns 422."""
        _seed_all(db_session)
        response = client.get(
            "/api/v1/pedidos/activos?sort_order=up",
            headers=admin_headers,
        )
        assert response.status_code == 422

    def test_activos_client_sees_own_sorted(self, client, client_headers, db_session):
        """Client user sees only their own orders with sorting applied."""
        _seed_all(db_session)
        from sqlmodel import select
        u = db_session.exec(select(Usuario).where(Usuario.email == "client_test@test.com")).first()
        assert u is not None
        _create_pedido(db_session, u.id, estado="PENDIENTE")
        _create_pedido(db_session, u.id, estado="PENDIENTE")

        # Create another user's pedido to ensure it does NOT appear
        u2 = _create_user(db_session, email="other_user@test.com")
        _create_pedido(db_session, u2.id, estado="PENDIENTE")

        response = client.get(
            "/api/v1/pedidos/activos?sort_by=id&sort_order=asc",
            headers=client_headers,
        )
        assert response.status_code == 200
        items = response.json()["items"]
        # All items should belong to client user
        for item in items:
            assert item["usuario_id"] == u.id

    def test_historial_sort_by_total_desc(self, client, admin_headers, db_session):
        """GET /pedidos/historial?sort_by=total&sort_order=desc returns most expensive first."""
        _seed_all(db_session)
        u = _create_user(db_session)
        p1 = _create_pedido(db_session, u.id, estado="ENTREGADO")
        p1.total = Decimal("200.00")
        p2 = _create_pedido(db_session, u.id, estado="CANCELADO")
        p2.total = Decimal("800.00")
        p3 = _create_pedido(db_session, u.id, estado="ENTREGADO")
        p3.total = Decimal("500.00")
        db_session.flush()

        response = client.get(
            "/api/v1/pedidos/historial?sort_by=total&sort_order=desc",
            headers=admin_headers,
        )
        assert response.status_code == 200
        items = response.json()["items"]
        totals = [Decimal(item["total"]) for item in items]
        assert totals == sorted(totals, reverse=True), f"Expected DESC by total, got {totals}"


# ═══════════════════════════════════════════════════════════════════════════
# SCHEMA HARDENING TESTS — cantidad field constraints
# ═══════════════════════════════════════════════════════════════════════════

class TestSchemaConstraints:

    def test_item_pedido_request_cantidad_zero_raises_validation_error(self):
        """ItemPedidoRequest(cantidad=0) raises ValidationError — gt=0 constraint."""
        from pydantic import ValidationError
        from app.modules.VentasPagosTrazabilidad.Pedido.schemas import ItemPedidoRequest
        with pytest.raises(ValidationError):
            ItemPedidoRequest(
                producto_id=1,
                cantidad=0,
                nombre_snapshot="Test",
                precio_snapshot="100.00",
            )

    def test_item_pedido_request_cantidad_negative_raises_validation_error(self):
        """ItemPedidoRequest(cantidad=-1) raises ValidationError — gt=0 constraint."""
        from pydantic import ValidationError
        from app.modules.VentasPagosTrazabilidad.Pedido.schemas import ItemPedidoRequest
        with pytest.raises(ValidationError):
            ItemPedidoRequest(
                producto_id=1,
                cantidad=-1,
                nombre_snapshot="Test",
                precio_snapshot="100.00",
            )

    def test_item_pedido_request_cantidad_one_succeeds(self):
        """ItemPedidoRequest(cantidad=1) succeeds — valid positive integer."""
        from app.modules.VentasPagosTrazabilidad.Pedido.schemas import ItemPedidoRequest
        item = ItemPedidoRequest(
            producto_id=1,
            cantidad=1,
            nombre_snapshot="Test",
            precio_snapshot="100.00",
        )
        assert item.cantidad == 1

    def test_detalle_pedido_update_cantidad_negative_raises_validation_error(self):
        """DetallePedidoUpdate(cantidad=-1) raises ValidationError — ge=0 constraint."""
        from pydantic import ValidationError
        from app.modules.VentasPagosTrazabilidad.Pedido.schemas import DetallePedidoUpdate
        with pytest.raises(ValidationError):
            DetallePedidoUpdate(cantidad=-1)

    def test_detalle_pedido_update_cantidad_zero_succeeds(self):
        """DetallePedidoUpdate(cantidad=0) succeeds — ge=0 allows removal."""
        from app.modules.VentasPagosTrazabilidad.Pedido.schemas import DetallePedidoUpdate
        update = DetallePedidoUpdate(cantidad=0)
        assert update.cantidad == 0

    def test_validar_stock_detalle_input_cantidad_zero_raises_validation_error(self):
        """ValidarStockDetalleInput(producto_id=1, cantidad=0) raises ValidationError — gt=0."""
        from pydantic import ValidationError
        from app.modules.VentasPagosTrazabilidad.Pedido.schemas import ValidarStockDetalleInput
        with pytest.raises(ValidationError):
            ValidarStockDetalleInput(producto_id=1, cantidad=0)


# ═══════════════════════════════════════════════════════════════════════════
# PEDIDO DETAIL MODIFICATION TESTS — actualizar_detalle stock validation
# ═══════════════════════════════════════════════════════════════════════════

class TestActualizarDetalleStock:
    """PATCH /pedidos/{id}/detalles/{producto_id} — stock validation on detail update."""

    def test_update_detail_cantidad_exceeding_stock_returns_422(self, client, admin_headers, db_session):
        """Updating a detail's cantidad above product stock returns 422 stock_insuficiente."""
        _seed_all(db_session)
        u = _create_user(db_session, email="stock_update@test.com")
        prod = _create_producto(db_session, nombre="LowStock", stock=3)
        p = _create_pedido(db_session, u.id, estado="PENDIENTE", forma_pago="EFECTIVO")

        # Add a detail line with cantidad=1
        from app.modules.VentasPagosTrazabilidad.DetallePedido.models import DetallePedido
        db_session.add(DetallePedido(
            pedido_id=p.id, producto_id=prod.id,
            cantidad=1, nombre_snapshot=prod.nombre,
            precio_snapshot=prod.precio_actual,
            subtotal_snap=prod.precio_actual,
        ))
        db_session.flush()

        # Try to update to 10 (stock is only 3)
        response = client.patch(
            f"/api/v1/pedidos/{p.id}/detalles/{prod.id}",
            json={"cantidad": 10},
            headers=admin_headers,
        )
        assert response.status_code == 422
        resp_json = response.json()
        detail = resp_json.get("detail", "")
        # detail may be a dict or string depending on error origin
        error_text = ""
        if isinstance(detail, dict):
            error_text = detail.get("error", "") + " " + detail.get("mensaje", "")
            assert detail.get("solicitado") == 10
            assert detail.get("disponible") == 3
        elif isinstance(detail, list):
            error_text = " ".join(str(d.get("msg", "")) for d in detail)
        else:
            error_text = str(detail)
        assert "stock" in error_text.lower() or "insuficiente" in error_text.lower()

    def test_update_detail_cantidad_within_stock_succeeds(self, client, admin_headers, db_session):
        """Updating a detail's cantidad within available stock succeeds."""
        _seed_all(db_session)
        u = _create_user(db_session, email="stock_ok@test.com")
        prod = _create_producto(db_session, nombre="PlentyStock", stock=50)
        p = _create_pedido(db_session, u.id, estado="PENDIENTE", forma_pago="EFECTIVO")

        from app.modules.VentasPagosTrazabilidad.DetallePedido.models import DetallePedido
        db_session.add(DetallePedido(
            pedido_id=p.id, producto_id=prod.id,
            cantidad=1, nombre_snapshot=prod.nombre,
            precio_snapshot=prod.precio_actual,
            subtotal_snap=prod.precio_actual,
        ))
        db_session.flush()

        response = client.patch(
            f"/api/v1/pedidos/{p.id}/detalles/{prod.id}",
            json={"cantidad": 5},
            headers=admin_headers,
        )
        assert response.status_code == 200
        data = response.json()
        # Verify the detail was updated
        updated_det = [d for d in data["detalles"] if d["producto_id"] == prod.id]
        assert len(updated_det) == 1
        assert updated_det[0]["cantidad"] == 5

    def test_update_detail_cantidad_zero_removes_detail(self, client, admin_headers, db_session):
        """Updating a detail's cantidad to 0 removes the detail line (stock check skipped)."""
        _seed_all(db_session)
        u = _create_user(db_session, email="remove_det@test.com")
        prod = _create_producto(db_session, nombre="DelMe", stock=0)  # stock=0 but removal skipped
        p = _create_pedido(db_session, u.id, estado="PENDIENTE", forma_pago="EFECTIVO")

        from app.modules.VentasPagosTrazabilidad.DetallePedido.models import DetallePedido
        db_session.add(DetallePedido(
            pedido_id=p.id, producto_id=prod.id,
            cantidad=1, nombre_snapshot=prod.nombre,
            precio_snapshot=prod.precio_actual,
            subtotal_snap=prod.precio_actual,
        ))
        db_session.flush()

        response = client.patch(
            f"/api/v1/pedidos/{p.id}/detalles/{prod.id}",
            json={"cantidad": 0},
            headers=admin_headers,
        )
        assert response.status_code == 200
        data = response.json()
        # Detail should be removed
        updated_det = [d for d in data["detalles"] if d["producto_id"] == prod.id]
        assert len(updated_det) == 0


# ═══════════════════════════════════════════════════════════════════════════
# PEDIDO UPDATE (PATCH) TESTS — update() stock validation
# ═══════════════════════════════════════════════════════════════════════════

class TestPedidoUpdateStock:
    """PATCH /pedidos/{id} — stock validation when replacing detalles."""

    def test_patch_pedido_detail_exceeding_stock_returns_422(self, client, admin_headers, db_session):
        """PATCH pedido with a detail line exceeding product stock returns 422."""
        _seed_all(db_session)
        u = _create_user(db_session, email="patch_stock@test.com")
        prod = _create_producto(db_session, nombre="PatchScarce", stock=1)
        p = _create_pedido(db_session, u.id, estado="PENDIENTE", forma_pago="EFECTIVO")

        response = client.patch(
            f"/api/v1/pedidos/{p.id}",
            json={
                "detalles": [{
                    "producto_id": prod.id,
                    "cantidad": 5,
                    "nombre_snapshot": prod.nombre,
                    "precio_snapshot": str(prod.precio_actual),
                }],
            },
            headers=admin_headers,
        )
        assert response.status_code == 422
        resp_json = response.json()
        detail = resp_json.get("detail", "")
        # detail may be a dict or string depending on error origin
        if isinstance(detail, dict):
            assert detail.get("error") == "stock_insuficiente"
        elif isinstance(detail, list):
            error_text = " ".join(str(d.get("msg", "")) for d in detail)
            assert "stock" in error_text.lower() or "insuficiente" in error_text.lower()
        else:
            assert "stock" in str(detail).lower() or "insuficiente" in str(detail).lower()

    def test_patch_pedido_detail_within_stock_succeeds(self, client, admin_headers, db_session):
        """PATCH pedido with detail lines within available stock succeeds."""
        _seed_all(db_session)
        u = _create_user(db_session, email="patch_ok@test.com")
        prod = _create_producto(db_session, nombre="PatchOk", stock=50)
        p = _create_pedido(db_session, u.id, estado="PENDIENTE", forma_pago="EFECTIVO")

        response = client.patch(
            f"/api/v1/pedidos/{p.id}",
            json={
                "detalles": [{
                    "producto_id": prod.id,
                    "cantidad": 3,
                    "nombre_snapshot": prod.nombre,
                    "precio_snapshot": str(prod.precio_actual),
                }],
            },
            headers=admin_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["detalles"]) == 1
        assert data["detalles"][0]["cantidad"] == 3
