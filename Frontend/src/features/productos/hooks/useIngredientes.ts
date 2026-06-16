import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ingredientesApi } from '../api/ingredientes'
import type { IngredienteCreate, IngredienteUpdate } from '../api/ingredientes'
import { queryKeys } from '@/shared/api/queryKeys'

/** Fetches all ingredientes with optional pagination (skip/limit). Uses TanStack Query. */
export function useIngredientes(skip = 0, limit = 100) {
  return useQuery({
    queryKey: queryKeys.ingredientes.all,
    queryFn: () => ingredientesApi.getAll(skip, limit),
  })
}

/** Fetches a single ingrediente by its ID. Query is disabled when id is falsy. */
export function useIngrediente(id: number) {
  return useQuery({
    queryKey: [...queryKeys.ingredientes.all, 'detail', id] as const,
    queryFn: () => ingredientesApi.getById(id),
    enabled: !!id,
  })
}

/** Creates a new ingrediente via mutation. Invalidates the ingredientes cache on success. */
export function useCreateIngrediente() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: IngredienteCreate) => ingredientesApi.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.ingredientes.all }),
  })
}

/** Updates an existing ingrediente via mutation. Accepts { id, data }. Invalidates cache on success. */
export function useUpdateIngrediente() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: IngredienteUpdate }) => ingredientesApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.ingredientes.all }),
  })
}

/** Deletes an ingrediente by ID via mutation. Invalidates the ingredientes cache on success. */
export function useDeleteIngrediente() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => ingredientesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.ingredientes.all }),
  })
}
