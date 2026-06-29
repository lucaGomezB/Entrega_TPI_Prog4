/**
 * Product filters store (Zustand).
 *
 * Centralises filter state for product listing pages (ProductosCliente, ProductosCRUD).
 * Persisted to localStorage via Zustand `persist` middleware with `partialize`
 * so only filter fields survive page reloads — pagination resets to defaults.
 *
 * State:
 *   - categoriaId: number | null — filter by category ID
 *   - searchTerm: string — text search filter
 *   - esInsumo: boolean | null — insumo-only filter (null = no filter)
 *   - skip: number — pagination offset
 *   - limit: number — page size
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

// ── Types ──

export interface FiltrosState {
  categoriaId: number | null
  searchTerm: string
  esInsumo: boolean | null
  skip: number
  limit: number
}

export interface FiltrosActions {
  setCategoriaId: (id: number | null) => void
  setSearchTerm: (term: string) => void
  setEsInsumo: (value: boolean | null) => void
  setPage: (skip: number) => void
  resetFilters: () => void
}

type FiltrosStore = FiltrosState & FiltrosActions

// ── Store ──

export const useFiltrosStore = create<FiltrosStore>()(
  persist(
    (set) => ({
      categoriaId: null,
      searchTerm: '',
      esInsumo: null,
      skip: 0,
      limit: 10,

      setCategoriaId: (id) =>
        set({ categoriaId: id, skip: 0 }),

      setSearchTerm: (term) =>
        set({ searchTerm: term, skip: 0 }),

      setEsInsumo: (value) =>
        set({ esInsumo: value, skip: 0 }),

      setPage: (skip) => set({ skip }),

      resetFilters: () => {
        useFiltrosStore.persist.clearStorage()
        set({
          categoriaId: null,
          searchTerm: '',
          esInsumo: null,
          skip: 0,
          limit: 10,
        })
      },
    }),
    {
      name: 'filtros-productos',
      storage: createJSONStorage(() => localStorage),
      // Only persist filter values, not pagination
      partialize: (state) => ({
        categoriaId: state.categoriaId,
        searchTerm: state.searchTerm,
        esInsumo: state.esInsumo,
      }),
    }
  )
)

// ── Selectors ──

export const useFiltrosCategoriaId = () => useFiltrosStore((s) => s.categoriaId)
export const useFiltrosSearchTerm = () => useFiltrosStore((s) => s.searchTerm)
export const useFiltrosEsInsumo = () => useFiltrosStore((s) => s.esInsumo)
export const useFiltrosSkip = () => useFiltrosStore((s) => s.skip)
export const useFiltrosLimit = () => useFiltrosStore((s) => s.limit)
