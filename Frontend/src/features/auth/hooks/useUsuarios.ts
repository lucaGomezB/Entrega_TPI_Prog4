import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usuariosApi } from '../api/usuarios'
import type { UsuarioCreate, UsuarioUpdate } from '../api/usuarios'
import { queryKeys } from '@/shared/api/queryKeys'

/** Fetches all usuarios with optional pagination and role filter. Uses TanStack Query. */
export function useUsuarios(skip = 0, limit = 100, rolCodigo?: string) {
  return useQuery({
    queryKey: [queryKeys.usuarios.all[0], 'list', { skip, limit, rolCodigo }] as const,
    queryFn: () => usuariosApi.getAll(skip, limit, rolCodigo),
  })
}

/** Fetches a single usuario by ID. Query is disabled when id is falsy. */
export function useUsuario(id: number) {
  return useQuery({
    queryKey: [queryKeys.usuarios.all[0], 'detail', id] as const,
    queryFn: () => usuariosApi.getById(id),
    enabled: !!id,
  })
}

/** Creates a new usuario via mutation. Invalidates the usuarios list cache on success. */
export function useCreateUsuario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: UsuarioCreate) => usuariosApi.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.usuarios.all }),
  })
}

/** Updates an existing usuario via mutation. Accepts { id, data }. Invalidates cache on success. */
export function useUpdateUsuario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UsuarioUpdate }) => usuariosApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.usuarios.all }),
  })
}

/** Soft-deletes a usuario by ID via mutation. Invalidates the usuarios list cache on success. */
export function useDeleteUsuario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => usuariosApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.usuarios.all }),
  })
}
