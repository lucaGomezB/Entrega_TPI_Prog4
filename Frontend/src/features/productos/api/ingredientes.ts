/**
 * Ingredient API functions.
 *
 * Ingredients represent the raw components used in products (e.g., flour, cheese).
 * They track allergen information, current price, and stock levels independently
 * of products. The `updatePrecio` and `updateStock` endpoints allow partial
 * updates specific to pricing and inventory operations.
 */
import { apiFetch } from "@/shared/api/client";
import { createCrudApi } from "@/shared/api/createCrudApi";

// ── Types ──

export interface Ingrediente {
  id: number;
  nombre: string;
  descripcion?: string | null;
  es_alergeno: boolean;
  precio_actual: number;
  stock_actual: number;
  unidad_medida_id?: number | null;
  unidad_medida_simbolo?: string | null;
}

export interface IngredienteCreate {
  nombre: string;
  descripcion?: string | null;
  es_alergeno?: boolean;
  precio_actual?: number;
  stock_actual?: number;
  unidad_medida_id?: number | null;
}

export interface IngredienteUpdate {
  nombre?: string | null;
  descripcion?: string | null;
  es_alergeno?: boolean | null;
  precio_actual?: number | null;
  stock_actual?: number | null;
  unidad_medida_id?: number | null;
}

export const ingredientesApi = {
  ...createCrudApi<Ingrediente>("/ingredientes"),

  /**
   * Updates only the price of an ingredient.
   * Separate from the general update to allow granular permission checks
   * and price-specific audit logging on the backend.
   */
  updatePrecio: (id: number, precio: number) =>
    apiFetch<Ingrediente>(`/ingredientes/${id}/precio`, {
      method: "PATCH",
      body: JSON.stringify({ precio }),
    }),

  /**
   * Updates only the stock quantity of an ingredient.
   * Separate endpoint to support stock-specific workflows (e.g., inventory
   * adjustments without changing price or other fields).
   */
  updateStock: (id: number, stock: number) =>
    apiFetch<Ingrediente>(`/ingredientes/${id}/stock`, {
      method: "PATCH",
      body: JSON.stringify({ stock }),
    }),
};
