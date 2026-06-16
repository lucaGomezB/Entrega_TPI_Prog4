/**
 * ProductCard — Reusable card component for displaying products in a grid view.
 *
 * Features:
 *  - Product image carousel (multiple images with arrow navigation)
 *  - Fallback chain when no product images: category image -> gray placeholder
 *  - Name, formatted price, availability status
 *  - "Agregar al carrito" button with green flash feedback on add
 *  - Disabled state for unavailable or out-of-stock products
 *
 * State management: simple props-driven; visual feedback via recentlyAdded Set.
 */
import { useState } from "react";
import type { Producto } from "@/features/productos/api/productos";
import ImageCarousel from "@/shared/components/ImageCarousel";

// ── Fallback image when product has no own images ──

/**
 * Renders a fallback image when the product has no imagenes_url.
 * Tries: 1) category image, 2) static file, 3) gray placeholder on total failure.
 */
function FallbackImage({ categoryImages, id }: { categoryImages?: string[]; id: number }) {
  const src = categoryImages?.[0] ?? `/productos/${id}.jpg`;
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="w-full aspect-[4/3] bg-gray-300 flex items-center justify-center text-gray-500 rounded">
        Sin imagen
      </div>
    );
  }

  return (
    <img
      src={src}
      alt="Producto"
      className="w-full aspect-[4/3] object-cover rounded-t-lg"
      onError={() => setFailed(true)}
    />
  );
}

// ── Public API ──

interface ProductCardProps {
  product: Producto;
  onAddToCart: (prod: Producto) => void;
  recentlyAdded: Set<number>;
  categoryImages?: string[];
}

export default function ProductCard({ product, onAddToCart, recentlyAdded, categoryImages }: ProductCardProps) {
  const isUnavailable = !product.disponible || product.stock_cantidad <= 0;
  const isRecent = recentlyAdded.has(product.id);

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden transition-shadow hover:shadow-lg flex flex-col">
      {/* Image section — carousel for multiple images, fallback for empty */}
      {product.imagenes_url.length > 0 ? (
        <ImageCarousel
          images={product.imagenes_url}
          publicIds={[]}
          onDelete={() => {}}
          readOnly={true}
        />
      ) : (
        <FallbackImage categoryImages={categoryImages} id={product.id} />
      )}

      {/* Content */}
      <div className="p-4 flex flex-col flex-1">
        <h3 className="font-semibold text-lg mb-1">{product.nombre}</h3>
        <p className="text-gray-700 text-sm mb-2">
          ${Number(product.precio_actual).toFixed(2)}
        </p>

        {/* Availability indicator */}
        {!product.disponible && (
          <span className="text-xs text-red-600 font-medium mb-2">No disponible</span>
        )}
        {product.disponible && product.stock_cantidad <= 0 && (
          <span className="text-xs text-red-600 font-medium mb-2">Sin stock</span>
        )}

        {/* Add-to-cart button */}
        <div className="mt-auto">
          {isUnavailable ? (
            <button
              disabled
              className="w-full px-4 py-2 rounded-b-lg font-medium text-white transition-colors cursor-not-allowed disabled:bg-gray-400 disabled:text-gray-600"
            >
              {!product.disponible ? "No disponible" : "Sin stock"}
            </button>
          ) : (
            <button
              onClick={() => onAddToCart(product)}
              className={`w-full px-4 py-2 rounded-b-lg font-medium text-white transition-colors cursor-pointer ${
                isRecent ? "bg-green-600" : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {isRecent ? "OK Agregado" : "Agregar al carrito"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
