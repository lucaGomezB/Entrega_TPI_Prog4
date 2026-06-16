/**
 * Product filters store (Zustand).
 *
 * Centralises filter state for product listing pages (ProductosCliente, ProductosCRUD).
 * Persisted to localStorage so filters survive page navigation, but cleared on
 * explicit reset or when the user closes the browser tab.
 *
 * State:
 *   - categoriaId: number | null — filter by category ID
 *   - searchTerm: string — text search filter
 *   - esInsumo: boolean | null — insumo-only filter (null = no filter)
 *   - skip: number — pagination offset
 *   - limit: number — page size
 */
import { create } from 'zustand'

const STORAGE_KEY = 'filtros_productos'

// ── localStorage helpers ──

function readFromLS(): Partial<FiltrosState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Partial<FiltrosState>
  } catch {
    return {}
  }
}

function writeToLS(state: FiltrosState): void {
  try {
    // Only persist filter values, not pagination
    const { categoriaId, searchTerm, esInsumo } = state
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ categoriaId, searchTerm, esInsumo }))
  } catch {
    // localStorage might be full or blocked — silently ignore
  }
}

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

const initialFilters = (): FiltrosState => ({
  categoriaId: null,
  searchTerm: '',
  esInsumo: null,
  skip: 0,
  limit: 10,
  ...readFromLS(),
})

// ── Store ──

export const useFiltrosStore = create<FiltrosStore>((set) => ({
  ...initialFilters(),

  setCategoriaId: (id) =>
    set((state) => {
      const next = { ...state, categoriaId: id, skip: 0 }
      writeToLS(next)
      return { categoriaId: id, skip: 0 }
    }),

  setSearchTerm: (term) =>
    set((state) => {
      const next = { ...state, searchTerm: term, skip: 0 }
      writeToLS(next)
      return { searchTerm: term, skip: 0 }
    }),

  setEsInsumo: (value) =>
    set((state) => {
      const next = { ...state, esInsumo: value, skip: 0 }
      writeToLS(next)
      return { esInsumo: value, skip: 0 }
    }),

  setPage: (skip) => set({ skip }),

  resetFilters: () => {
    const defaults: FiltrosState = {
      categoriaId: null,
      searchTerm: '',
      esInsumo: null,
      skip: 0,
      limit: 10,
    }
    localStorage.removeItem(STORAGE_KEY)
    set(defaults)
  },
}))

// ── Selectors ──

export const useFiltrosCategoriaId = () => useFiltrosStore((s) => s.categoriaId)
export const useFiltrosSearchTerm = () => useFiltrosStore((s) => s.searchTerm)
export const useFiltrosEsInsumo = () => useFiltrosStore((s) => s.esInsumo)
export const useFiltrosSkip = () => useFiltrosStore((s) => s.skip)
export const useFiltrosLimit = () => useFiltrosStore((s) => s.limit)
