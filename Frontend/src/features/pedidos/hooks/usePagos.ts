import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pagosApi } from '../api/pagos'
import { queryKeys } from '@/shared/api/queryKeys'

/** Fetches all pagos for a given pedido ID. Query is disabled when pedidoId is falsy. */
export function usePagosByPedido(pedidoId: number) {
  return useQuery({
    queryKey: queryKeys.pagos.byPedido(pedidoId),
    queryFn: () => pagosApi.getPagosByPedido(pedidoId),
    enabled: !!pedidoId,
  })
}

/** Initiates a MercadoPago payment for a pedido via mutation. Invalidates the pedidos cache on success. */
export function useInitPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pedidoId: number) => pagosApi.initPayment(pedidoId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.pedidos.all }),
  })
}
