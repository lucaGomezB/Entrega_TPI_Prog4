import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/shared/api/client'

interface ActivePedidosResponse {
  total: number
}

/**
 * Returns the count of active pedidos (non-terminal states).
 * Used for the navbar badge. Refreshes every 30 seconds.
 */
export function useActivePedidosCount() {
  const { data } = useQuery<ActivePedidosResponse>({
    queryKey: ['pedidos', 'activos', 'count'],
    queryFn: () => apiFetch<ActivePedidosResponse>('/pedidos/activos?limit=1'),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
  return data?.total ?? 0
}
