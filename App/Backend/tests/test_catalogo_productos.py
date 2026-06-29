"""
Integration tests for CatalogoDeProductos module.

Covers: Categoria, Producto, Ingrediente endpoints.
Uses real SQLite DB via conftest fixtures.
"""
import pytest
from fastapi import status

from app.modules.CatalogoDeProductos.Categoria.models import Categoria
from app.modules.CatalogoDeProductos.Producto.models import Producto
from app.modules.CatalogoDeProductos.Ingrediente.models import Ingrediente


# ═══════════════════════════════════════════════════════════════════════════
# CATEGORIA ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

class TestCategoriaEndpoints:

    def test_create_categoria_admin(self, client, admin_headers, db_session):
        """Admin can create a new category."""
        response = client.post("/api/v1/categorias/", json={
            "nombre": "Test Category",
            "descripcion": "A test category",
        }, headers=admin_headers)
        assert response.status_code == status.HTTP_201_CREATED
        data = response.json()
        assert data["nombre"] == "Test Category"
        assert "id" in data

    def test_list_categorias_public(self, client, db_session):
        """List categories is public (no auth required)."""
        c = Categoria(nombre="Public Cat", descripcion="Public", orden_display=1)
        db_session.add(c)
        db_session.flush()

        response = client.get("/api/v1/categorias/")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 1

    def test_get_categoria_by_id(self, client, db_session):
        """GET /categorias/{id} returns a single category."""
        c = Categoria(nombre="GetMe", descripcion="Test", orden_display=1)
        db_session.add(c)
        db_session.flush()

        response = client.get(f"/api/v1/categorias/{c.id}")
        assert response.status_code == 200
        assert response.json()["nombre"] == "GetMe"

    def test_categoria_not_found_returns_404(self, client):
        """Non-existent category returns 404."""
        response = client.get("/api/v1/categorias/99999")
        assert response.status_code == 404

    def test_create_categoria_client_rejected(self, client, client_headers):
        """Client cannot create categories (403)."""
        response = client.post("/api/v1/categorias/", json={
            "nombre": "Unauthorized", "descripcion": "Should fail",
        }, headers=client_headers)
        assert response.status_code == 403

    def test_subcategory_hierarchy(self, client, admin_headers, db_session):
        """Subcategories can be created under parent categories."""
        parent = Categoria(nombre="Parent", descripcion="Root", orden_display=1)
        db_session.add(parent)
        db_session.flush()

        child_resp = client.post("/api/v1/categorias/", json={
            "nombre": "Child",
            "descripcion": "Subcategory",
            "parent_id": parent.id,
        }, headers=admin_headers)
        assert child_resp.status_code == 201
        data = child_resp.json()
        assert data["parent_id"] == parent.id

    def test_tree_endpoint(self, client, db_session):
        """GET /categorias/tree returns hierarchical tree structure."""
        parent = Categoria(nombre="Root", descripcion="Top", orden_display=1)
        db_session.add(parent)
        db_session.flush()
        child = Categoria(
            nombre="Branch", descripcion="Child",
            orden_display=1, parent_id=parent.id,
        )
        db_session.add(child)
        db_session.flush()

        response = client.get("/api/v1/categorias/tree")
        assert response.status_code == 200
        tree = response.json()
        assert isinstance(tree, list)
        roots = [c for c in tree if c["nombre"] == "Root"]
        assert len(roots) >= 1


# ═══════════════════════════════════════════════════════════════════════════
# PRODUCTO ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

class TestProductoEndpoints:

    def test_create_producto_admin(self, client, admin_headers, db_session):
        """Admin can create a product."""
        response = client.post("/api/v1/productos/", json={
            "nombre": "Test Product",
            "descripcion": "A test product",
            "precio_base": "500.00",
            "precio_actual": "500.00",
            "stock_cantidad": 100,
            "tiempo_prep_min": 10,
            "disponible": True,
            "es_insumo": False,
        }, headers=admin_headers)
        assert response.status_code == status.HTTP_201_CREATED
        data = response.json()
        assert data["nombre"] == "Test Product"

    def test_list_productos_public(self, client, db_session):
        """List productos is public."""
        p = Producto(
            nombre="Public Prod", descripcion="Test",
            precio_base=500, precio_actual=500,
            stock_cantidad=10, tiempo_prep_min=5,
            disponible=True,
        )
        db_session.add(p)
        db_session.flush()

        response = client.get("/api/v1/productos/")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 1

    def test_get_producto_by_id(self, client, db_session):
        """GET /productos/{id} returns a single product."""
        p = Producto(
            nombre="GetProduct", descripcion="Test",
            precio_base=300, precio_actual=300,
            stock_cantidad=5, tiempo_prep_min=3,
            disponible=True,
        )
        db_session.add(p)
        db_session.flush()

        response = client.get(f"/api/v1/productos/{p.id}")
        assert response.status_code == 200
        assert response.json()["nombre"] == "GetProduct"

    def test_producto_not_found_returns_404(self, client):
        """Non-existent product returns 404."""
        response = client.get("/api/v1/productos/99999")
        assert response.status_code == 404

    def test_create_producto_client_rejected(self, client, client_headers):
        """Client cannot create products (403)."""
        response = client.post("/api/v1/productos/", json={
            "nombre": "Unauthorized", "descripcion": "Should fail",
            "precio_base": "100.00", "precio_actual": "100.00",
            "stock_cantidad": 1, "tiempo_prep_min": 1,
            "disponible": True,
        }, headers=client_headers)
        assert response.status_code == 403

    def test_soft_delete_producto(self, client, admin_headers, db_session):
        """Admin can soft-delete a product (204)."""
        p = Producto(
            nombre="DeleteMe", descripcion="Test",
            precio_base=100, precio_actual=100,
            stock_cantidad=1, tiempo_prep_min=1,
            disponible=True,
        )
        db_session.add(p)
        db_session.flush()

        response = client.delete(
            f"/api/v1/productos/{p.id}", headers=admin_headers
        )
        assert response.status_code == 204

        # Verify it's gone from listing
        get_resp = client.get(f"/api/v1/productos/{p.id}")
        assert get_resp.status_code == 404

    def test_create_with_categories(self, client, admin_headers, db_session):
        """Product can be created with category assignments."""
        cat = Categoria(nombre="ProdCat", descripcion="Test", orden_display=1)
        db_session.add(cat)
        db_session.flush()

        response = client.post("/api/v1/productos/", json={
            "nombre": "CatProduct",
            "descripcion": "With category",
            "precio_base": "200.00",
            "precio_actual": "200.00",
            "stock_cantidad": 50,
            "tiempo_prep_min": 5,
            "disponible": True,
            "categorias": [{"categoria_id": cat.id, "es_principal": True}],
        }, headers=admin_headers)
        assert response.status_code == 201

    def test_get_ingredientes_includes_es_alergeno(self, client, admin_headers, db_session):
        """GET /productos/{id}/ingredientes returns es_alergeno field per ingredient."""
        # Create an allergenic ingredient
        ing_resp = client.post("/api/v1/ingredientes/", json={
            "nombre": "Allergenic Ing",
            "descripcion": "Contains allergens",
            "es_alergeno": True,
            "precio_actual": "50.00",
            "stock_actual": 30,
        }, headers=admin_headers)
        assert ing_resp.status_code == 201
        ing_id = ing_resp.json()["id"]

        # Create a product
        prod_resp = client.post("/api/v1/productos/", json={
            "nombre": "Allergen Product",
            "descripcion": "Product with allergens",
            "precio_base": "300.00",
            "precio_actual": "300.00",
            "stock_cantidad": 10,
            "tiempo_prep_min": 5,
            "disponible": True,
        }, headers=admin_headers)
        assert prod_resp.status_code == 201
        prod_id = prod_resp.json()["id"]

        # Assign ingredient to product
        assign_resp = client.post(f"/api/v1/productos/{prod_id}/ingredientes", json={
            "ingrediente_id": ing_id,
            "cantidad": 1,
            "es_removible": True,
            "es_principal": True,
            "orden": 1,
        }, headers=admin_headers)
        assert assign_resp.status_code == 201

        # Fetch ingredients — must include es_alergeno
        get_resp = client.get(f"/api/v1/productos/{prod_id}/ingredientes")
        assert get_resp.status_code == 200
        ingredients = get_resp.json()
        assert len(ingredients) == 1
        assert ingredients[0]["es_alergeno"] is True
        assert ingredients[0]["ingrediente_nombre"] == "Allergenic Ing"

    def test_get_ingredientes_es_alergeno_false(self, client, admin_headers, db_session):
        """Non-allergenic ingredient returns es_alergeno: false."""
        # Create a non-allergenic ingredient
        ing_resp = client.post("/api/v1/ingredientes/", json={
            "nombre": "Safe Ing",
            "descripcion": "No allergens",
            "es_alergeno": False,
            "precio_actual": "25.00",
            "stock_actual": 100,
        }, headers=admin_headers)
        assert ing_resp.status_code == 201
        ing_id = ing_resp.json()["id"]

        # Create a product
        prod_resp = client.post("/api/v1/productos/", json={
            "nombre": "Safe Product",
            "descripcion": "No allergens",
            "precio_base": "200.00",
            "precio_actual": "200.00",
            "stock_cantidad": 20,
            "tiempo_prep_min": 3,
            "disponible": True,
        }, headers=admin_headers)
        assert prod_resp.status_code == 201
        prod_id = prod_resp.json()["id"]

        # Assign ingredient to product
        assign_resp = client.post(f"/api/v1/productos/{prod_id}/ingredientes", json={
            "ingrediente_id": ing_id,
            "cantidad": 1,
            "orden": 1,
        }, headers=admin_headers)
        assert assign_resp.status_code == 201

        # Fetch ingredients — es_alergeno must be false
        get_resp = client.get(f"/api/v1/productos/{prod_id}/ingredientes")
        assert get_resp.status_code == 200
        ingredients = get_resp.json()
        assert len(ingredients) == 1
        assert ingredients[0]["es_alergeno"] is False
        assert ingredients[0]["ingrediente_nombre"] == "Safe Ing"


    # ── search parameter ──

    def test_list_productos_search_filters_by_name(self, client, db_session):
        """Search param filters productos by nombre ILIKE."""
        db_session.add(Producto(nombre="Pizza Margarita", descripcion="Test", precio_base=500, precio_actual=500, stock_cantidad=10, tiempo_prep_min=15, disponible=True))
        db_session.add(Producto(nombre="Pizza Napolitana", descripcion="Test", precio_base=600, precio_actual=600, stock_cantidad=8, tiempo_prep_min=20, disponible=True))
        db_session.add(Producto(nombre="Empanada de Carne", descripcion="Test", precio_base=200, precio_actual=200, stock_cantidad=30, tiempo_prep_min=5, disponible=True))
        db_session.flush()

        response = client.get("/api/v1/productos/?skip=0&limit=10&search=pizza")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 2
        names = [item["nombre"] for item in data["items"]]
        assert all("pizza" in name.lower() for name in names)

    def test_list_productos_search_empty_returns_all(self, client, db_session):
        """Empty search param returns unfiltered results."""
        db_session.add(Producto(nombre="Prod A", descripcion="Test", precio_base=100, precio_actual=100, stock_cantidad=5, tiempo_prep_min=5, disponible=True))
        db_session.add(Producto(nombre="Prod B", descripcion="Test", precio_base=200, precio_actual=200, stock_cantidad=10, tiempo_prep_min=5, disponible=True))
        db_session.flush()

        response = client.get("/api/v1/productos/?skip=0&limit=10&search=")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 2

    def test_list_productos_search_no_match_returns_empty(self, client, db_session):
        """Search with no matches returns empty items."""
        db_session.add(Producto(nombre="Test Prod", descripcion="Test", precio_base=100, precio_actual=100, stock_cantidad=5, tiempo_prep_min=5, disponible=True))
        db_session.flush()

        response = client.get("/api/v1/productos/?skip=0&limit=10&search=zzz_nonexistent")
        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_productos_search_with_pagination(self, client, db_session):
        """Search combines with pagination correctly."""
        for i in range(10):
            db_session.add(Producto(nombre=f"Art {chr(97+i)}", descripcion="Test", precio_base=100, precio_actual=100, stock_cantidad=5, tiempo_prep_min=5, disponible=True))
        db_session.flush()

        response = client.get("/api/v1/productos/?skip=5&limit=5&search=a")
        assert response.status_code == 200
        data = response.json()
        assert data["skip"] == 5
        assert data["limit"] == 5

    def test_list_productos_search_without_param_works(self, client, db_session):
        """Omitting search param preserves existing behavior."""
        db_session.add(Producto(nombre="NoSearch", descripcion="Test", precio_base=100, precio_actual=100, stock_cantidad=5, tiempo_prep_min=5, disponible=True))
        db_session.flush()

        response = client.get("/api/v1/productos/?skip=0&limit=10")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 1


# ═══════════════════════════════════════════════════════════════════════════
# INGREDIENTE ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

class TestIngredienteEndpoints:

    def test_create_ingrediente_admin(self, client, admin_headers, db_session):
        """Admin can create an ingredient."""
        response = client.post("/api/v1/ingredientes/", json={
            "nombre": "Test Ingredient",
            "descripcion": "Test ingredient desc",
            "es_alergeno": False,
            "precio_actual": "50.00",
            "stock_actual": 100,
        }, headers=admin_headers)
        assert response.status_code == status.HTTP_201_CREATED
        data = response.json()
        assert data["nombre"] == "Test Ingredient"

    def test_list_ingredientes_public(self, client, db_session):
        """List ingredientes is public."""
        i = Ingrediente(
            nombre="Public Ing", descripcion="Test",
            precio_actual=30, stock_actual=50,
        )
        db_session.add(i)
        db_session.flush()

        response = client.get("/api/v1/ingredientes/")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 1

    def test_get_ingrediente_by_id(self, client, db_session):
        """GET /ingredientes/{id} returns a single ingredient."""
        i = Ingrediente(
            nombre="GetIng", descripcion="Test",
            precio_actual=40, stock_actual=20,
        )
        db_session.add(i)
        db_session.flush()

        response = client.get(f"/api/v1/ingredientes/{i.id}")
        assert response.status_code == 200
        assert response.json()["nombre"] == "GetIng"

    def test_ingrediente_not_found_returns_404(self, client):
        """Non-existent ingredient returns 404."""
        response = client.get("/api/v1/ingredientes/99999")
        assert response.status_code == 404

    def test_create_ingrediente_client_rejected(self, client, client_headers):
        """Client cannot create ingredients (403)."""
        response = client.post("/api/v1/ingredientes/", json={
            "nombre": "Unauthorized", "descripcion": "Should fail",
            "precio_actual": "10.00", "stock_actual": 1,
        }, headers=client_headers)
        assert response.status_code == 403

    def test_create_ingrediente_with_alergeno(self, client, admin_headers, db_session):
        """Ingredient can be created with es_alergeno=True."""
        response = client.post("/api/v1/ingredientes/", json={
            "nombre": "Allergen Ing",
            "descripcion": "Contains allergens",
            "es_alergeno": True,
            "precio_actual": "75.00",
            "stock_actual": 30,
        }, headers=admin_headers)
        assert response.status_code == 201
        assert response.json()["es_alergeno"] is True

    def test_delete_ingrediente_admin(self, client, admin_headers, db_session):
        """Admin can soft-delete an ingredient."""
        i = Ingrediente(
            nombre="DeleteIng", descripcion="Test",
            precio_actual=25, stock_actual=10,
        )
        db_session.add(i)
        db_session.flush()

        response = client.delete(
            f"/api/v1/ingredientes/{i.id}", headers=admin_headers
        )
        assert response.status_code == 204

        # Verify deleted
        get_resp = client.get(f"/api/v1/ingredientes/{i.id}")
        assert get_resp.status_code == 404

    # ── search parameter ──

    def test_list_ingredientes_search_filters_by_name(self, client, db_session):
        """Search param filters ingredients by nombre ILIKE."""
        db_session.add(Ingrediente(nombre="Harina Integral", descripcion="Test", precio_actual=10, stock_actual=50))
        db_session.add(Ingrediente(nombre="Azucar Refinada", descripcion="Test", precio_actual=5, stock_actual=100))
        db_session.add(Ingrediente(nombre="Harina Comun", descripcion="Test", precio_actual=8, stock_actual=80))
        db_session.flush()

        response = client.get("/api/v1/ingredientes/?skip=0&limit=10&search=harina")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 2
        names = [item["nombre"] for item in data["items"]]
        assert all("harina" in name.lower() for name in names)

    def test_list_ingredientes_search_empty_returns_all(self, client, db_session):
        """Empty search param returns unfiltered results."""
        db_session.add(Ingrediente(nombre="Ing A", descripcion="Test", precio_actual=10, stock_actual=50))
        db_session.add(Ingrediente(nombre="Ing B", descripcion="Test", precio_actual=5, stock_actual=100))
        db_session.flush()

        response = client.get("/api/v1/ingredientes/?skip=0&limit=10&search=")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 2

    def test_list_ingredientes_search_no_match_returns_empty(self, client, db_session):
        """Search with no matches returns empty items."""
        db_session.add(Ingrediente(nombre="Test Ing", descripcion="Test", precio_actual=10, stock_actual=50))
        db_session.flush()

        response = client.get("/api/v1/ingredientes/?skip=0&limit=10&search=zzz_nonexistent")
        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_ingredientes_search_without_param_works(self, client, db_session):
        """Omitting search param preserves existing behavior."""
        db_session.add(Ingrediente(nombre="NoSearch", descripcion="Test", precio_actual=10, stock_actual=50))
        db_session.flush()

        response = client.get("/api/v1/ingredientes/?skip=0&limit=10")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 1
