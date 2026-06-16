import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { categoriasApi } from '../api/categorias'
import type { CategoriaCreate, CategoriaUpdate } from '../api/categorias'
import { queryKeys } from '@/shared/api/queryKeys'

/** Fetches all categorias with optional pagination (skip/limit). Uses TanStack Query. */
export function useCategorias(skip = 0, limit = 100) {
  return useQuery({
    queryKey: queryKeys.categorias.all,
    queryFn: () => categoriasApi.getAll(skip, limit),
  })
}

/** Fetches the full categoria tree (parent-child hierarchy). Uses TanStack Query. */
export function useCategoriasTree() {
  return useQuery({
    queryKey: queryKeys.categorias.tree,
    queryFn: () => categoriasApi.getTree(),
  })
}

/** Creates a new categoria via mutation. Invalidates both list and tree caches on success. */
export function useCreateCategoria() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CategoriaCreate) => categoriasApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.categorias.all })
      qc.invalidateQueries({ queryKey: queryKeys.categorias.tree })
    },
  })
}

/** Updates an existing categoria via mutation. Accepts { id, data }. Invalidates both list and tree caches on success. */
export function useUpdateCategoria() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: CategoriaUpdate }) => categoriasApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.categorias.all })
      qc.invalidateQueries({ queryKey: queryKeys.categorias.tree })
    },
  })
}

/** Deletes a categoria by ID via mutation. Invalidates both list and tree caches on success. */
export function useDeleteCategoria() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => categoriasApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.categorias.all })
      qc.invalidateQueries({ queryKey: queryKeys.categorias.tree })
    },
  })
}
