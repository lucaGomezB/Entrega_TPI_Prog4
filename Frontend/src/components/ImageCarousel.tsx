/**
 * ImageCarousel — Reusable image navigation component.
 *
 * Features:
 *   - Left/right arrow navigation with wrap-around
 *   - Single image: no arrows shown
 *   - Empty state: "Sin imagenes" gray placeholder
 *   - Delete button (X) per image (only when !readOnly)
 *   - No auto-rotate (user-controlled only)
 *
 * Props:
 *   - images: string[] — array of image URLs to display
 *   - publicIds: string[] — parallel array of Cloudinary public IDs
 *   - onDelete: (publicId: string) => void — delete callback
 *   - readOnly?: boolean — if true, hides delete button
 */
import { useState } from "react";

interface ImageCarouselProps {
  images: string[];
  publicIds: string[];
  onDelete: (publicId: string) => void;
  readOnly?: boolean;
}

export default function ImageCarousel({
  images,
  publicIds,
  onDelete,
  readOnly = false,
}: ImageCarouselProps) {
  const [current, setCurrent] = useState(0);

  // Empty state — gray placeholder
  if (images.length === 0) {
    return (
      <div className="w-full aspect-[4/3] bg-gray-300 flex items-center justify-center text-gray-500 rounded">
        Sin imagenes
      </div>
    );
  }

  const hasMultiple = images.length > 1;

  const goLeft = () => {
    setCurrent((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  };

  const goRight = () => {
    setCurrent((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  };

  const handleDelete = () => {
    const targetId = publicIds[current];
    if (targetId) {
      onDelete(targetId);
    }
  };

  return (
    <div className="relative w-full aspect-[4/3] bg-gray-100 rounded overflow-hidden group">
      {/* Current image */}
      <img
        src={images[current]}
        alt={`Imagen ${current + 1} de ${images.length}`}
        className="w-full h-full object-cover"
      />

      {/* Delete button (X) — top-right, only when not readOnly */}
      {!readOnly && (
        <button
          onClick={handleDelete}
          className="absolute top-2 right-2 bg-red-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-sm hover:bg-red-700 cursor-pointer z-10"
          title="Eliminar imagen"
        >
          X
        </button>
      )}

      {/* Left arrow — only if multiple images */}
      {hasMultiple && (
        <button
          onClick={goLeft}
          className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-black/70 cursor-pointer"
          title="Anterior"
        >
          {"\u2190"}
        </button>
      )}

      {/* Right arrow — only if multiple images */}
      {hasMultiple && (
        <button
          onClick={goRight}
          className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-black/70 cursor-pointer"
          title="Siguiente"
        >
          {"\u2192"}
        </button>
      )}

      {/* Image counter */}
      {hasMultiple && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 text-white text-xs px-2 py-0.5 rounded">
          {current + 1} / {images.length}
        </div>
      )}
    </div>
  );
}
