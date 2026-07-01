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
import { useRef, useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { Producto } from "@/features/productos/api/productos";
import { useProductos } from "@/features/productos/hooks/useProductos";
import { useQuery } from "@tanstack/react-query";
import { categoriasApi } from "@/features/categorias/api/categorias";
import type { CategoriaTree } from "@/features/categorias/api/categorias";
import { getDescendantIds } from "@/features/categorias/utils/tree";
import { useCartStore } from "@/shared/store/cartStore";
import { getAccessToken, getUserRoles } from "@/shared/api/client";
import ProductCard from "@/features/productos/components/ProductCard";
import SearchFilter from "@/shared/components/SearchFilter";

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

/**
 * Flattens the category tree into a depth-annotated list for single-pass rendering.
 * All chips render as siblings in one flex container — no nested divs breaking flow.
 */
function flattenTree(nodes: CategoriaTree[], depth = 0): Array<{ node: CategoriaTree; depth: number }> {
  const flat: Array<{ node: CategoriaTree; depth: number }> = [];
  for (const node of nodes) {
    flat.push({ node, depth });
    if (node.subcategorias.length > 0) {
      flat.push(...flattenTree(node.subcategorias, depth + 1));
    }
  }
  return flat;
}

// ── Page component ──

export default function ProductosCliente() {
  const navigate = useNavigate();
  const isAuth = !!getAccessToken();
  const esAdmin = getUserRoles().includes("ADMIN");

  // UI-only state (declared before useProductos — needed for query key)
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<number>>(new Set());

  // Derive array from Set for API calls
  const selectedIdsArray = useMemo(() => Array.from(selectedCategoryIds), [selectedCategoryIds]);

  // TanStack Query: products — server-side filtering by categories (multi-select)
  const { data: productsData, isLoading, isError, error } = useProductos(
    0, 1000, undefined, selectedIdsArray.length > 0 ? selectedIdsArray : undefined,
  );
  const products = productsData?.items ?? [];

  // TanStack Query: categories (for filter chips + image fallback)
  const { data: categoriasData } = useQuery({
    queryKey: ["categorias", "tree"],
    queryFn: () => categoriasApi.getTree(),
  });
  const categorias = categoriasData ?? [];

  // Recently-added feedback
  const [recentlyAdded, setRecentlyAdded] = useState<Set<number>>(new Set());
  const addTimerRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  /** Adds a product to the cart and triggers visual feedback.
   *  Guests are redirected to /login?mode=register to create an account first. */
  const handleAddToCart = (prod: Producto) => {
    if (!isAuth) {
      navigate("/login?mode=register");
      return;
    }
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

  // ── Empty category filter ──

  /**
   * Persisted set of category IDs that have at least one product assigned.
   * Computed when viewing "Todas" (full product list) and preserved via useRef
   * so it survives across re-renders when filters change.
   */
  const nonEmptyCategoryIds = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (selectedCategoryIds.size === 0 && products.length > 0) {
      const ids = new Set<number>();
      for (const p of products) {
        for (const cid of p.categoria_ids) {
          ids.add(cid);
        }
      }
      nonEmptyCategoryIds.current = ids;
    }
  }, [selectedCategoryIds.size, products]);

  // ── Category ID → node lookup map (O(1) for getDescendantIds) ──
  const categoryMap = useRef<Map<number, CategoriaTree>>(new Map());

  useEffect(() => {
    const map = new Map<number, CategoriaTree>();
    function indexTree(nodes: CategoriaTree[]) {
      for (const node of nodes) {
        map.set(node.id, node);
        if (node.subcategorias.length > 0) indexTree(node.subcategorias);
      }
    }
    indexTree(categorias);
    categoryMap.current = map;
  }, [categorias]);

  /**
   * Recursively removes categories that have zero products assigned.
   * If nonEmptyIds is empty (not yet computed), returns nodes unchanged as fallback.
   */
  function filterEmptyCategories(nodes: CategoriaTree[], nonEmptyIds: Set<number>): CategoriaTree[] {
    if (nonEmptyIds.size === 0) return nodes; // fallback: show all
    return nodes
      .filter(node =>
        nonEmptyIds.has(node.id) ||
        node.subcategorias.some(child => nonEmptyIds.has(child.id))
      )
      .map(node => ({
        ...node,
        subcategorias: filterEmptyCategories(node.subcategorias, nonEmptyIds),
      }));
  }

  const displayCategories = filterEmptyCategories(categorias, nonEmptyCategoryIds.current);

  /** Flat list of visible categories with depth — all chips render as siblings in one flex row. */
  const flattenedCategories = useMemo(
    () => flattenTree(displayCategories),
    [displayCategories],
  );

  // ── Derived data ──

  /** Filter: only available products matching the text filter. Category filter is server-side. */
  const filtered = products.filter(
    (p) =>
      p.disponible === true &&
      p.nombre.toLowerCase().includes(filter.toLowerCase())
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
        <SearchFilter
          onSearch={(v) => { setFilter(v); setPage(0); }}
          placeholder="Filtrar por nombre..."
        />
      </div>

      {/* Category filter chips — flat list, uniform gap, depth shown via subtle color, empty nodes pruned */}
      {displayCategories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4 items-center">
          <button
            onClick={() => { setSelectedCategoryIds(new Set()); setPage(0); }}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors cursor-pointer ${
              selectedCategoryIds.size === 0
                ? "bg-blue-600 text-white"
                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
            }`}
          >
            Todas
          </button>
          {flattenedCategories.map(({ node, depth }) => (
            <button
              key={node.id}
              onClick={() => {
                setSelectedCategoryIds(prev => {
                  const next = new Set(prev);
                  const found = categoryMap.current.get(node.id);
                  if (!found) return prev;
                  const descendantIds = getDescendantIds(found);
                  if (next.has(node.id)) {
                    for (const did of descendantIds) next.delete(did);
                  } else {
                    for (const did of descendantIds) next.add(did);
                  }
                  return next;
                });
                setPage(0);
              }}
              className={`px-3 py-1 rounded-full text-sm font-medium transition-colors cursor-pointer ${
                selectedCategoryIds.has(node.id)
                  ? "bg-blue-600 text-white"
                  : depth > 0
                    ? "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              {node.nombre}
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
                categoryImages={
                  prod.categoria_ids.length > 0
                    ? categoryImagesMap[prod.categoria_ids[0]]
                    : undefined
                }
                showId={esAdmin}
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
