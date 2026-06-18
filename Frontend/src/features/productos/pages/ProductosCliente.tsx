/**
 * ProductosCliente — Client-facing product listing page with card grid layout.
 *
 * Responsibilities:
 *  - Fetch all products via TanStack Query useProductos()
 *  - Fetch categories for filter chips
 *  - Client-side text filter by name and category filter
 *  - Hide products where disponible === false
 *  - Simple prev/next pagination (PAGE_SIZE = 12 for 3 rows of 4)
 *  - Renders each product via ProductCard with add-to-cart integration
 *  - Shows "Ver Carrito (N)" button for authenticated users
 *  - Skeleton loaders while fetching
 */
import { useRef, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Producto } from "@/features/productos/api/productos";
import { useProductos } from "@/features/productos/hooks/useProductos";
import { useCategorias } from "@/features/categorias/hooks/useCategorias";
import { useCartStore } from "@/shared/store/cartStore";
import { getAccessToken } from "@/shared/api/client";
import ProductCard from "@/features/productos/components/ProductCard";

const PAGE_SIZE = 12;

/**
 * Skeleton loader grid — mimics the exact layout of product cards
 * but with animated pulse placeholders. Uses the same responsive grid.
 */
function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="bg-white rounded-lg shadow-md overflow-hidden animate-pulse">
          <div className="w-full aspect-[4/3] bg-gray-200" />
          <div className="p-4 space-y-2">
            <div className="h-4 bg-gray-200 rounded w-3/4" />
            <div className="h-3 bg-gray-200 rounded w-1/2" />
            <div className="h-6 bg-gray-200 rounded w-1/3 mt-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Page component ──

export default function ProductosCliente() {
  const navigate = useNavigate();
  const isAuth = !!getAccessToken();

  // TanStack Query: products
  const { data: productsData, isLoading, isError, error } = useProductos(0, 1000);
  const products = productsData?.items ?? [];

  // TanStack Query: categories (for filter chips + image fallback)
  const { data: categoriasData } = useCategorias(0, 1000);
  const categorias = categoriasData?.items ?? [];

  // UI-only state
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);

  // Recently-added feedback
  const [recentlyAdded, setRecentlyAdded] = useState<Set<number>>(new Set());
  const addTimerRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  /** Adds a product to the cart and triggers visual feedback. */
  const handleAddToCart = (prod: Producto) => {
    useCartStore.getState().addToCart(prod.id, prod.nombre, Number(prod.precio_base));
    triggerFeedback(prod.id);
  };

  /**
   * Visual feedback: turns the button green for 1.2s, then reverts.
   * Uses a ref map to manage per-product timers independently.
   */
  const triggerFeedback = (productoId: number) => {
    setRecentlyAdded((prev) => new Set(prev).add(productoId));
    const existingTimer = addTimerRef.current.get(productoId);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      setRecentlyAdded((prev) => {
        const next = new Set(prev);
        next.delete(productoId);
        return next;
      });
      addTimerRef.current.delete(productoId);
    }, 1200);
    addTimerRef.current.set(productoId, timer);
  };

  // Category images map for product card fallback
  const categoryImagesMap = useMemo(() => {
    const map: Record<number, string[]> = {};
    for (const cat of categorias) {
      if (cat.imagen_url && cat.imagen_url.length > 0) {
        map[cat.id] = cat.imagen_url;
      }
    }
    return map;
  }, [categorias]);

  // Get the first available category image for any product
  const firstCategoryImages = Object.values(categoryImagesMap).find(
    (urls) => urls.length > 0
  );

  // ── Derived data ──

  /** Filter: only available products matching the text filter AND selected category. */
  const filtered = products.filter(
    (p) =>
      p.disponible === true &&
      p.nombre.toLowerCase().includes(filter.toLowerCase()) &&
      (selectedCategoryId === null || p.categoria_principal_id === selectedCategoryId)
  );

  /** Current page slice. */
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  // ── Render ──

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Menu</h1>

      {/* Error state */}
      {isError && <p className="text-red-500 mb-4">{(error as Error)?.message || "Error al cargar productos"}</p>}

      {/* Search filter */}
      <div className="flex gap-2 mb-4 items-center">
        <input
          type="text"
          placeholder="Filtrar por nombre..."
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setPage(0); }}
          className="border px-2 py-1 rounded flex-grow"
        />
      </div>

      {/* Category filter chips */}
      {categorias.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => { setSelectedCategoryId(null); setPage(0); }}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors cursor-pointer ${
              selectedCategoryId === null
                ? "bg-blue-600 text-white"
                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
            }`}
          >
            Todas
          </button>
          {categorias.map((cat) => (
            <button
              key={cat.id}
              onClick={() => {
                setSelectedCategoryId(selectedCategoryId === cat.id ? null : cat.id);
                setPage(0);
              }}
              className={`px-3 py-1 rounded-full text-sm font-medium transition-colors cursor-pointer ${
                selectedCategoryId === cat.id
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              {cat.nombre}
            </button>
          ))}
        </div>
      )}

      {/* Loading state — skeleton loaders */}
      {isLoading && <SkeletonGrid />}

      {/* Results */}
      {!isLoading && !isError && filtered.length === 0 && (
        <p className="text-center text-gray-500 py-8">Sin resultados</p>
      )}

      {!isLoading && !isError && filtered.length > 0 && (
        <>
          {/* Product grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {paged.map((prod) => (
              <ProductCard
                key={prod.id}
                product={prod}
                onAddToCart={handleAddToCart}
                recentlyAdded={recentlyAdded}
                categoryImages={firstCategoryImages}
              />
            ))}
          </div>

          {/* Pagination + cart button */}
          <div className="flex gap-2 mt-6 items-center justify-between">
            <div className="flex gap-2 items-center">
              <button
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
                className="bg-gray-300 px-3 py-1 rounded disabled:opacity-50 cursor-pointer"
              >
                Anterior
              </button>
              <span>
                Pagina {page + 1}{totalPages > 1 ? ` de ${totalPages}` : ""}
              </span>
              <button
                disabled={page + 1 >= totalPages}
                onClick={() => setPage(page + 1)}
                className="bg-gray-300 px-3 py-1 rounded disabled:opacity-50 cursor-pointer"
              >
                Siguiente
              </button>
            </div>

            {isAuth && (
              <button
                onClick={() => navigate("/carrito")}
                className="bg-green-700 text-white px-4 py-1.5 rounded text-sm font-semibold hover:bg-green-800 cursor-pointer"
              >
                Ver Carrito {useCartStore.getState().getItemCount() > 0 ? `(${useCartStore.getState().getItemCount()})` : ""}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
