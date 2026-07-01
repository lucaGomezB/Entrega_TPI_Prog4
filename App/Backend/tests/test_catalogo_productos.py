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
from app.modules.CatalogoDeProductos.producto_categoria import ProductoCategoria


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

    # ── category filter (categoria_id param) ──

    def test_get_productos_by_category(self, client, db_session):
        """GET /productos/?categoria_id=X returns only products in that category."""
        cat_a = Categoria(nombre="Bebidas", descripcion="Drinks", orden_display=1)
        cat_b = Categoria(nombre="Comidas", descripcion="Food", orden_display=2)
        db_session.add_all([cat_a, cat_b])
        db_session.flush()

        prod_a = Producto(nombre="Coca-Cola", descripcion="Test", precio_base=500, precio_actual=500, stock_cantidad=10, tiempo_prep_min=5, disponible=True)
        prod_b = Producto(nombre="Hamburguesa", descripcion="Test", precio_base=500, precio_actual=500, stock_cantidad=10, tiempo_prep_min=5, disponible=True)
        db_session.add_all([prod_a, prod_b])
        db_session.flush()

        db_session.add(ProductoCategoria(producto_id=prod_a.id, categoria_id=cat_a.id, es_principal=True))
        db_session.add(ProductoCategoria(producto_id=prod_b.id, categoria_id=cat_b.id, es_principal=True))
        db_session.flush()

        resp = client.get(f"/api/v1/productos/?categoria_id={cat_a.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["nombre"] == "Coca-Cola"

    def test_get_productos_by_category_includes_descendants(self, client, db_session):
        """Filtering by root category returns products in descendant subcategories."""
        root = Categoria(nombre="Bebidas", descripcion="Root", orden_display=1)
        db_session.add(root)
        db_session.flush()
        child = Categoria(nombre="Gaseosas", descripcion="Child", orden_display=1, parent_id=root.id)
        db_session.add(child)
        db_session.flush()

        prod = Producto(nombre="Sprite", descripcion="Test", precio_base=500, precio_actual=500, stock_cantidad=10, tiempo_prep_min=5, disponible=True)
        db_session.add(prod)
        db_session.flush()
        db_session.add(ProductoCategoria(producto_id=prod.id, categoria_id=child.id, es_principal=True))
        db_session.flush()

        resp = client.get(f"/api/v1/productos/?categoria_id={root.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["nombre"] == "Sprite"

    def test_get_productos_by_nonexistent_category(self, client, db_session):
        """Filtering by non-existent category returns empty results."""
        resp = client.get("/api/v1/productos/?categoria_id=99999")
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_get_productos_category_and_search_combined(self, client, db_session):
        """Category filter + text search combine correctly."""
        cat_a = Categoria(nombre="Bebidas", descripcion="Drinks", orden_display=1)
        cat_b = Categoria(nombre="Panaderia", descripcion="Bakery", orden_display=2)
        db_session.add_all([cat_a, cat_b])
        db_session.flush()

        prod_a = Producto(nombre="Coca-Cola", descripcion="Test", precio_base=500, precio_actual=500, stock_cantidad=10, tiempo_prep_min=5, disponible=True)
        prod_b = Producto(nombre="Pan Frances", descripcion="Test", precio_base=500, precio_actual=500, stock_cantidad=10, tiempo_prep_min=5, disponible=True)
        db_session.add_all([prod_a, prod_b])
        db_session.flush()

        db_session.add(ProductoCategoria(producto_id=prod_a.id, categoria_id=cat_a.id, es_principal=True))
        db_session.add(ProductoCategoria(producto_id=prod_b.id, categoria_id=cat_b.id, es_principal=True))
        db_session.flush()

        resp = client.get(f"/api/v1/productos/?categoria_id={cat_a.id}&search=coca")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["nombre"] == "Coca-Cola"

    def test_product_read_has_categoria_ids(self, client, db_session):
        """ProductoRead response includes categoria_ids field with at least one ID."""
        cat = Categoria(nombre="Postres", descripcion="Desserts", orden_display=1)
        db_session.add(cat)
        db_session.flush()

        prod = Producto(nombre="Flan", descripcion="Test", precio_base=500, precio_actual=500, stock_cantidad=10, tiempo_prep_min=5, disponible=True)
        db_session.add(prod)
        db_session.flush()
        db_session.add(ProductoCategoria(producto_id=prod.id, categoria_id=cat.id, es_principal=True))
        db_session.flush()

        resp = client.get("/api/v1/productos/")
        assert resp.status_code == 200
        items = resp.json()["items"]
        flan = next((p for p in items if p["nombre"] == "Flan"), None)
        assert flan is not None, "Flan not found in response"
        assert "categoria_ids" in flan, "categoria_ids missing in ProductoRead"
        assert cat.id in flan["categoria_ids"], f"Expected categoria_ids to contain {cat.id}"

    # ── multiple category filter (categoria_id repeated param) ──

    def test_get_productos_by_multiple_categories(self, client, db_session):
        """GET /productos/?categoria_id=X&categoria_id=Y returns products from ANY matching category (union)."""
        cat_a = Categoria(nombre="Bebidas", descripcion="Drinks", orden_display=1)
        cat_b = Categoria(nombre="Postres", descripcion="Desserts", orden_display=2)
        cat_c = Categoria(nombre="Pizzas", descripcion="Pizza", orden_display=3)
        db_session.add_all([cat_a, cat_b, cat_c])
        db_session.flush()

        prod_a = Producto(nombre="Coca-Cola", descripcion="Test", precio_base=500, precio_actual=500, stock_cantidad=10, tiempo_prep_min=5, disponible=True)
        prod_b = Producto(nombre="Flan", descripcion="Test", precio_base=400, precio_actual=400, stock_cantidad=5, tiempo_prep_min=8, disponible=True)
        prod_c = Producto(nombre="Muzzarella", descripcion="Test", precio_base=800, precio_actual=800, stock_cantidad=3, tiempo_prep_min=20, disponible=True)
        db_session.add_all([prod_a, prod_b, prod_c])
        db_session.flush()

        db_session.add(ProductoCategoria(producto_id=prod_a.id, categoria_id=cat_a.id, es_principal=True))
        db_session.add(ProductoCategoria(producto_id=prod_b.id, categoria_id=cat_b.id, es_principal=True))
        db_session.add(ProductoCategoria(producto_id=prod_c.id, categoria_id=cat_c.id, es_principal=True))
        db_session.flush()

        # Request products from BOTH Bebidas and Postres — should get Coca-Cola AND Flan, not Muzzarella
        resp = client.get(f"/api/v1/productos/?categoria_id={cat_a.id}&categoria_id={cat_b.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2, f"Expected 2 products, got {data['total']}"
        names = [item["nombre"] for item in data["items"]]
        assert "Coca-Cola" in names
        assert "Flan" in names
        assert "Muzzarella" not in names

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


# ═══════════════════════════════════════════════════════════════════════════
# SCHEMA HARDENING TESTS — stock_cantidad ge=0 constraints (Bug 2)
# ═══════════════════════════════════════════════════════════════════════════

class TestProductoStockConstraints:

    def test_producto_create_negative_stock_raises_validation_error(self):
        """ProductoCreate(stock_cantidad=-5) raises ValidationError."""
        from pydantic import ValidationError
        from app.modules.CatalogoDeProductos.Producto.schemas import ProductoCreate
        with pytest.raises(ValidationError):
            ProductoCreate(
                nombre="Test",
                categorias_ids=[1],
                stock_cantidad=-5,
            )

    def test_producto_create_stock_zero_succeeds(self):
        """ProductoCreate(stock_cantidad=0) succeeds."""
        from app.modules.CatalogoDeProductos.Producto.schemas import ProductoCreate
        p = ProductoCreate(
            nombre="Test",
            categorias_ids=[1],
            stock_cantidad=0,
        )
        assert p.stock_cantidad == 0

    def test_producto_update_negative_stock_raises_validation_error(self):
        """ProductoUpdate(stock_cantidad=-1) raises ValidationError."""
        from pydantic import ValidationError
        from app.modules.CatalogoDeProductos.Producto.schemas import ProductoUpdate
        with pytest.raises(ValidationError):
            ProductoUpdate(stock_cantidad=-1)

    def test_producto_update_stock_zero_succeeds(self):
        """ProductoUpdate(stock_cantidad=0) succeeds."""
        from app.modules.CatalogoDeProductos.Producto.schemas import ProductoUpdate
        p = ProductoUpdate(stock_cantidad=0)
        assert p.stock_cantidad == 0

    def test_producto_update_stock_none_succeeds(self):
        """ProductoUpdate(stock_cantidad=None) succeeds (omit field)."""
        from app.modules.CatalogoDeProductos.Producto.schemas import ProductoUpdate
        p = ProductoUpdate(stock_cantidad=None)
        assert p.stock_cantidad is None


# ═══════════════════════════════════════════════════════════════════════════
# INGREDIENT-DERIVED MAX TESTS — stock validation includes max_posible
# ═══════════════════════════════════════════════════════════════════════════

class TestIngredientDerivedMax:

    def test_create_product_with_limiting_ingredient_shows_max_posible(self, client, admin_headers, db_session):
        """Creating product with ingredient limiting to 3 units shows max_posible."""
        from app.modules.CatalogoDeProductos.Ingrediente.models import Ingrediente

        # Create ingredient with limited stock: 10 units
        ing = Ingrediente(
            nombre="Limon", descripcion="Test",
            precio_actual=50, stock_actual=10,
        )
        db_session.add(ing)
        db_session.flush()

        # Create a product with stock_cantidad=5 and ingredient cantidad=4
        # needed = 4 * 5 = 20, but stock_actual=10, so 10 < 20 — SHORT
        # max_posible = floor(10 / 4) = 2
        response = client.post("/api/v1/productos/", json={
            "nombre": "Limonada",
            "categorias_ids": [1],
            "stock_cantidad": 5,
            "ingredientes": [{
                "ingrediente_id": ing.id,
                "cantidad": 4,
                "es_removible": False,
                "es_principal": True,
                "orden": 0,
            }],
        }, headers=admin_headers)
        # Expect error due to ingredient stock shortage
        assert response.status_code in (400, 422)
        data = response.json()
        # The custom exception handler moves structured detail fields to top level
        ingredientes = data.get("ingredientes", [])
        if ingredientes:
            assert len(ingredientes) > 0
            has_max = any("max_posible" in ing for ing in ingredientes)
            assert has_max, f"Expected max_posible in ingredientes: {ingredientes}"
        else:
            # Fallback: check detail string
            detail = data.get("detail", "")
            error_text = str(detail)
            assert "max_posible" in error_text or "maximo" in error_text.lower()

    def test_create_product_with_sufficient_stock_succeeds(self, client, admin_headers, db_session):
        """Creating product with sufficient ingredient stock succeeds."""
        from app.modules.CatalogoDeProductos.Ingrediente.models import Ingrediente

        # Ingredient with plenty of stock
        ing = Ingrediente(
            nombre="Azucar", descripcion="Test",
            precio_actual=20, stock_actual=500,
        )
        db_session.add(ing)
        db_session.flush()

        response = client.post("/api/v1/productos/", json={
            "nombre": "Dulce de Leche",
            "categorias_ids": [1],
            "stock_cantidad": 2,
            "ingredientes": [{
                "ingrediente_id": ing.id,
                "cantidad": 1,
                "es_removible": False,
                "es_principal": True,
                "orden": 0,
            }],
        }, headers=admin_headers)
        assert response.status_code == 201
        data = response.json()
        assert data["nombre"] == "Dulce de Leche"
