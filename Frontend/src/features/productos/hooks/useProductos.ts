import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { productosApi } from '../api/productos'
import type { ProductoCreate, ProductoUpdate } from '../api/productos'
import { queryKeys } from '@/shared/api/queryKeys'

/** Fetches all productos with optional pagination (skip/limit). Uses TanStack Query. */
export function useProductos(skip = 0, limit = 1000) {
  return useQuery({
    queryKey: queryKeys.productos.list({ skip, limit }),
    queryFn: () => productosApi.getAll(skip, limit),
  })
}

/** Fetches a single producto by its ID. Query is disabled when id is falsy. */
export function useProducto(id: number) {
  return useQuery({
    queryKey: queryKeys.productos.detail(id),
    queryFn: () => productosApi.getById(id),
    enabled: !!id,
  })
}

/** Creates a new producto via mutation. Invalidates the productos list cache on success. */
export function useCreateProducto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ProductoCreate) => productosApi.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.productos.all }),
  })
}

/** Updates an existing producto via mutation. Accepts { id, data }. Invalidates cache on success. */
export function useUpdateProducto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: ProductoUpdate }) => productosApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.productos.all }),
  })
}

/** Soft-deletes a producto by ID via mutation. Invalidates the productos list cache on success. */
export function useDeleteProducto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => productosApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.productos.all }),
  })
}
