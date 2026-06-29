/**
 * Shopping cart Zustand store with Zustand `persist` middleware and
 * email-scoped localStorage keys.
 *
 * The cart is persisted to localStorage with email-scoped keys
 * (carrito_{email}) so that each authenticated user has their own cart,
 * and guests share a "carrito" key. A custom storage adapter resolves
 * the key dynamically so the persist middleware writes to the correct
 * email-scoped slot.
 *
 * On auth change (login/logout), call `hydrate()` to re-read from the
 * new user's key.
 */
import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { getUserInfo } from '@/shared/api/client';

// ── Types ──

export interface CarritoItem {
  productoId: number;
  nombre: string;
  precio: number;
  cantidad: number;
  ingredientesExcluidos: number[];
}

interface CartState {
  items: CarritoItem[];
}

interface CartActions {
  /** Hydrate the store from localStorage using the current user's key. */
  hydrate: () => void;
  /** Add a product to the cart, or increment quantity if already present. */
  addToCart: (productoId: number, nombre: string, precio: number, cantidad?: number) => void;
  /** Remove a product from the cart entirely. */
  removeFromCart: (productoId: number) => void;
  /** Set the exact quantity for a product (ignores < 1). */
  updateCantidad: (productoId: number, cantidad: number) => void;
  /** Set the excluded ingredient IDs for a specific product. */
  setIngredientesExcluidos: (productoId: number, ids: number[]) => void;
  /** Empty the cart entirely. */
  clearCarrito: () => void;
  /** Total price of all items. */
  getTotal: () => number;
  /** Total count of individual items (sum of quantities). */
  getItemCount: () => number;
}

type CartStore = CartState & CartActions;

// ── Dynamic storage key ──

function storageKey(): string {
  const user = getUserInfo();
  return user?.email ? `carrito_${user.email}` : 'carrito';
}

/**
 * Custom StateStorage adapter that resolves the email-scoped key dynamically.
 *
 * The persist middleware (via createJSONStorage) calls `getItem(name)`,
 * `setItem(name, value)`, and `removeItem(name)`. We ignore `name` and
 * use the email-scoped key instead, delegating to localStorage for
 * the actual read/write.
 */
const cartStateStorage: StateStorage = {
  getItem: (_name: string): string | null => {
    try {
      return localStorage.getItem(storageKey());
    } catch {
      return null;
    }
  },
  setItem: (_name: string, value: string): void => {
    try {
      localStorage.setItem(storageKey(), value);
    } catch {
      // localStorage might be full or blocked — silently ignore
    }
  },
  removeItem: (_name: string): void => {
    try {
      localStorage.removeItem(storageKey());
    } catch {
      // silently ignore
    }
  },
};

// ── Store ──

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],

      hydrate: () => {
        // Re-read from email-scoped key on auth change.
        // The persist middleware's onRehydrateStorage isn't suited for
        // dynamic key changes, so hydrate manually.
        try {
          const raw = localStorage.getItem(storageKey());
          if (raw) {
            const parsed = JSON.parse(raw);
            // Zustand v5 persist middleware wraps state as {state: {items: [...]}, version: 0}.
            // Extract items from the wrapper first, fall back to parsed directly for backward
            // compatibility with legacy plain-array format.
            const items = (parsed as Record<string, unknown>).state
              ? (parsed as { state: { items: CarritoItem[] } }).state.items
              : parsed;
            if (Array.isArray(items)) {
              set({ items });
              return;
            }
          }
        } catch {
          // silently ignore
        }
        set({ items: [] });
      },

      addToCart: (productoId, nombre, precio, cantidad = 1) => {
        const items = get().items;
        const existing = items.find((i) => i.productoId === productoId);

        const newItems: CarritoItem[] = existing
          ? items.map((i) =>
              i.productoId === productoId
                ? { ...i, cantidad: i.cantidad + cantidad }
                : i
            )
          : [...items, { productoId, nombre, precio: Number(precio), cantidad, ingredientesExcluidos: [] }];

        set({ items: newItems });
      },

      removeFromCart: (productoId) => {
        const newItems = get().items.filter((i) => i.productoId !== productoId);
        set({ items: newItems });
      },

      updateCantidad: (productoId, cantidad) => {
        if (cantidad < 1) return;
        const newItems = get().items.map((i) =>
          i.productoId === productoId ? { ...i, cantidad } : i
        );
        set({ items: newItems });
      },

      setIngredientesExcluidos: (productoId, ids) => {
        const newItems = get().items.map((i) =>
          i.productoId === productoId ? { ...i, ingredientesExcluidos: ids } : i
        );
        set({ items: newItems });
      },

      clearCarrito: () => {
        try {
          localStorage.removeItem(storageKey());
        } catch {
          // silently ignore
        }
        set({ items: [] });
      },

      getTotal: () => {
        return get().items.reduce((sum, i) => sum + Number(i.precio) * i.cantidad, 0);
      },

      getItemCount: () => {
        return get().items.reduce((sum, i) => sum + i.cantidad, 0);
      },
    }),
    {
      name: 'cart-storage',
      storage: createJSONStorage(() => cartStateStorage),
    }
  )
);

// ── Selectors ──

export const useCartItems = () => useCartStore((s) => s.items);
export const useCartTotal = () => useCartStore((s) => s.getTotal());
export const useCartCount = () => useCartStore((s) => s.getItemCount());
