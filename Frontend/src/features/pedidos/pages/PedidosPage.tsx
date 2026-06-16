/**
 * PedidosPage — Orders listing and management page.
 * Uses TanStack Query for data fetching and mutations.
 */
import { useEffect, useState, useRef } from "react";
import { type Pedido, type DetallePedido, type StockInsuficienteDetalle } from "@/features/pedidos/api/pedidos";
import { pagosApi, type PagoRead } from "@/features/pedidos/api/pagos";
import { getUserRoles } from "@/shared/api/client";
import { AxiosError } from "axios";
import { useAdminPedidoFeed } from "@/features/pedidos/hooks/useAdminPedidoFeed";
import { useEstadoPedidoWS } from "@/features/pedidos/hooks/useEstadoPedidoWS";
import { useWsStatus } from "@/features/pedidos/store/wsStore";
import { useNotificationStore } from "@/features/pedidos/store/notificationStore";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { addToast } from "@/shared/components/Toast";
import Modal from "@/shared/components/Modal";
import {
  usePedidosActivos,
  usePedidosHistorial,
  useAvanzarPedido,
  useCancelarPedido,
  useActualizarDetalle,
  useHistorialPedido,
} from "@/features/pedidos/hooks/usePedidos";
import { usePagosByPedido } from "@/features/pedidos/hooks/usePagos";

const ESTADOS_COLORES: Record<string, string> = {
  PENDIENTE: "bg-yellow-100 text-yellow-800",
  CONFIRMADO: "bg-blue-100 text-blue-800",
  EN_PREP: "bg-indigo-100 text-indigo-800",
  ENTREGADO: "bg-green-100 text-green-800",
  CANCELADO: "bg-red-100 text-red-800",
};

const ETIQUETAS_AVANCE: Record<string, string> = {
  PENDIENTE: "Confirmar",
  CONFIRMADO: "Preparar",
  EN_PREP: "Entregar",
};

const ETIQUETAS_ESTADO: Record<string, string> = {
  PENDIENTE: "Pendiente",
  CONFIRMADO: "Confirmado",
  EN_PREP: "En Preparacion",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
};

function mpStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "Pendiente",
    approved: "Aprobado",
    rejected: "Rechazado",
    refunded: "Reintegrado",
    cancelled: "Cancelado",
    in_process: "En proceso",
    in_mediation: "En mediacion",
    charged_back: "Contracargo",
  };
  return labels[status] || status;
}

function mpStatusDetailLabel(statusDetail: string | null): string {
  if (statusDetail === null) return "-";
  const labels: Record<string, string> = {
    accredited: "Acreditado",
    pending_contingency: "Pendiente de contingencia",
    pending_review_manual: "Pendiente de revision manual",
    cc_rejected_bad_filled_date: "Fecha de vencimiento invalida",
    cc_rejected_bad_filled_other: "Datos de tarjeta incorrectos",
    cc_rejected_bad_filled_security_code: "Codigo de seguridad invalido",
    cc_rejected_blacklist: "Tarjeta en lista negra",
    cc_rejected_call_for_authorize: "Requiere autorizacion telefonica",
    cc_rejected_card_disabled: "Tarjeta deshabilitada",
    cc_rejected_duplicated_payment: "Pago duplicado",
    cc_rejected_high_risk: "Pago de alto riesgo",
    cc_rejected_insufficient_amount: "Fondos insuficientes",
    cc_rejected_invalid_installments: "Cuotas invalidas",
    cc_rejected_max_attempts: "Maximo de intentos superado",
    cc_rejected_other_reason: "Rechazado por el banco",
    rejected_by_bank: "Rechazado por el banco",
    rejected_by_regulations: "Rechazado por regulaciones",
    rejected_insufficient_data: "Datos insuficientes",
  };
  return labels[statusDetail] || statusDetail;
}

const MP_STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  refunded: "bg-purple-100 text-purple-800",
  cancelled: "bg-gray-100 text-gray-800",
  in_process: "bg-blue-100 text-blue-800",
};

/**
 * PedidoWSSubscriber — subscribes to WebSocket updates for a single pedido.
 * On each WS event, invalidates both activos and detail/timeline queries
 * so the UI refreshes automatically.
 */
function PedidoWSSubscriber({ pedidoId, enabled }: { pedidoId: number; enabled: boolean }) {
  const qc = useQueryClient();
  useEstadoPedidoWS(pedidoId, enabled, () => {
    qc.invalidateQueries({ queryKey: ['pedidos', 'activos'] });
    qc.invalidateQueries({ queryKey: ['pedidos', 'detail'] });
  });
  return null; // invisible — side-effect only
}

function TimelineEstados({ pedidoId }: { pedidoId: number }) {
  const { data: historial, isLoading } = useHistorialPedido(pedidoId);
  if (isLoading) return <p className="text-xs text-gray-400 mt-3">Cargando historial...</p>;
  if (!historial || historial.length === 0) return <p className="text-xs text-gray-400 mt-3">Sin historial de estados</p>;

  return (
    <div className="mt-4 border-t pt-3">
      <h3 className="text-md font-semibold mb-3">Linea de tiempo</h3>
      <div className="relative ml-2">
        {historial.map((entry, i) => (
          <div key={entry.id} className="flex gap-3 mb-3 relative">
            {/* Timeline line and dot */}
            <div className="flex flex-col items-center">
              <div className={`w-3 h-3 rounded-full border-2 ${entry.es_sistema ? 'border-gray-300 bg-gray-200' : 'border-blue-500 bg-blue-400'} z-10`} />
              {i < historial.length - 1 && <div className="w-0.5 flex-1 bg-gray-300" />}
            </div>
            {/* Content */}
            <div className="flex-1 pb-1">
              <p className="text-sm">
                {entry.estado_desde ? (
                  <span>
                    <span className="text-gray-500">{entry.estado_desde}</span>
                    <span className="mx-1 text-gray-400">→</span>
                  </span>
                ) : (
                  <span className="text-gray-400">Creacion </span>
                )}
                <span className="font-medium">{entry.estado_hacia}</span>
                {entry.es_sistema && <span className="text-xs text-gray-400 ml-1">(sistema)</span>}
              </p>
              {entry.motivo && <p className="text-xs text-red-500 mt-0.5">Motivo: {entry.motivo}</p>}
              <p className="text-xs text-gray-400 mt-0.5">
                {new Date(entry.created_at).toLocaleString("es-AR", {
                  day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetallesPopup({ pedido, detalles, onClose, esGestor, pagos }: {
  pedido: Pedido; detalles: DetallePedido[]; onClose: () => void; esGestor?: boolean; pagos?: PagoRead[];
}) {
  return (
    <Modal open={true} onClose={onClose} title={`Detalles del Pedido${esGestor ? ` #${pedido.id}` : ""}`}>
      <p className="text-sm text-gray-500 mb-1">
        Fecha: {new Date(pedido.created_at).toLocaleString("es-AR")}
      </p>
      <p className="text-sm mb-3">
        {pedido.direccion_id ? (
          <span className="text-blue-600">Envio a domicilio</span>
        ) : (
          <span className="text-green-600">Retiro en el local</span>
        )}
      </p>
      <p className="text-sm mb-3">
        <span className="font-medium">Metodo de pago:</span>{" "}
        {pedido.forma_pago_codigo === "MERCADOPAGO" ? "MercadoPago" : pedido.forma_pago_codigo === "PAGO_LOCAL" ? "Pago y retiro en local" : "Efectivo"}
      </p>
      <table className="w-full border-collapse border mb-4">
        <thead><tr className="bg-gray-200">
          <th className="border p-2 text-left">Producto</th>
          <th className="border p-2 text-right">Cantidad</th>
          <th className="border p-2 text-right">Precio Unit.</th>
          <th className="border p-2 text-right">Subtotal</th>
        </tr></thead>
        <tbody>
          {detalles.map((d, i) => (
            <tr key={i} className="hover:bg-gray-100 border-b">
              <td className="p-2">{d.nombre_snapshot}</td>
              <td className="p-2 text-right">{d.cantidad}</td>
              <td className="p-2 text-right">${parseFloat(d.precio_snapshot).toFixed(2)}</td>
              <td className="p-2 text-right font-mono font-semibold">${parseFloat(d.subtotal_snap).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-right text-lg font-bold mb-4">
        Total: <span className="text-blue-700">${parseFloat(pedido.total).toFixed(2)}</span>
      </div>

      {pagos && pagos.length > 0 && (
        <>
          <h3 className="text-md font-semibold mb-2 border-t pt-3">Pagos</h3>
          <table className="w-full border-collapse border">
            <thead><tr className="bg-gray-100">
              <th className="border p-2 text-left">Estado</th>
              <th className="border p-2 text-right">Monto</th>
              <th className="border p-2 text-left">Detalle</th>
              <th className="border p-2 text-left">Metodo</th>
              <th className="border p-2 text-left">Fecha</th>
            </tr></thead>
            <tbody>
              {pagos.map((p) => (
                <tr key={p.id} className="border-b hover:bg-gray-50">
                  <td className="p-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${MP_STATUS_COLORS[p.mp_status] || "bg-gray-100"}`}>
                      {mpStatusLabel(p.mp_status)}
                    </span>
                  </td>
                  <td className="p-2 text-right font-mono">${p.transaction_amount.toFixed(2)}</td>
                  <td className="p-2 text-xs text-gray-600">{mpStatusDetailLabel(p.mp_status_detail)}</td>
                  <td className="p-2 text-xs">{p.payment_method_id || "-"}</td>
                  <td className="p-2 text-xs">
                    {new Date(p.created_at).toLocaleDateString("es-AR", {
                      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <TimelineEstados pedidoId={pedido.id} />
    </Modal>
  );
}

function StockModal({ pedido, detalles, onResolve, onCancel }: {
  pedido: Pedido;
  detalles: StockInsuficienteDetalle[];
  onResolve: (resoluciones: Record<number, number>) => Promise<void>;
  onCancel: () => void;
}) {
  const [resoluciones, setResoluciones] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {};
    for (const d of detalles) {
      init[d.producto_id] = d.stock_disponible;
    }
    return init;
  });
  const [resolving, setResolving] = useState(false);

  const handleConfirmar = async () => {
    setResolving(true);
    try {
      await onResolve(resoluciones);
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white rounded p-6 w-full max-w-lg" style={{ overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-amber-800">Stock Insuficiente</h2>
          <button onClick={onCancel} className="text-gray-500 text-xl cursor-pointer">X</button>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          El pedido <strong>#{pedido.id}</strong> tiene productos con stock insuficiente.
          Ajusta las cantidades o marca para eliminar los que no tengan stock.
        </p>

        <table className="w-full border-collapse border mb-4">
          <thead><tr className="bg-gray-200">
            <th className="border p-2 text-left">Producto</th>
            <th className="border p-2 text-right">Pedido</th>
            <th className="border p-2 text-right">Stock</th>
            <th className="border p-2 text-right">Cantidad</th>
          </tr></thead>
          <tbody>
            {detalles.map((d) => {
              const cant = resoluciones[d.producto_id] ?? 0;
              const eliminar = cant <= 0;
              return (
                <tr key={d.producto_id} className={`border-b ${eliminar ? 'bg-red-50 opacity-60' : ''}`}>
                  <td className="p-2">{d.nombre_producto}</td>
                  <td className="p-2 text-right text-red-600">{d.cantidad_solicitada}</td>
                  <td className="p-2 text-right text-green-700">{d.stock_disponible}</td>
                  <td className="p-2 text-right">
                    {eliminar ? (
                      <span className="text-xs text-red-500 font-medium">Eliminado</span>
                    ) : (
                      <div className="inline-flex items-center gap-1">
                        <button type="button" onClick={() => setResoluciones((prev) => { const next = { ...prev, [d.producto_id]: Math.max(0, (prev[d.producto_id] ?? d.stock_disponible) - 1) }; return next; })} disabled={cant <= 1} className="border border-gray-400 bg-white text-gray-700 hover:bg-gray-100 text-sm w-6 h-6 flex items-center justify-center rounded cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">-</button>
                        <span className="w-6 text-center font-mono text-sm">{cant}</span>
                        <button type="button" onClick={() => setResoluciones((prev) => ({ ...prev, [d.producto_id]: Math.min(d.stock_disponible, (prev[d.producto_id] ?? d.stock_disponible) + 1) }))} disabled={cant >= d.stock_disponible} className="border border-gray-400 bg-white text-gray-700 hover:bg-gray-100 text-sm w-6 h-6 flex items-center justify-center rounded cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">+</button>
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-center">
                    {d.stock_disponible === 0 ? (
                      <span className="text-xs text-gray-400">Sin stock</span>
                    ) : (
                      <button type="button" onClick={() => setResoluciones((prev) => { if ((prev[d.producto_id] ?? d.stock_disponible) > 0) { return { ...prev, [d.producto_id]: 0 }; } return { ...prev, [d.producto_id]: d.stock_disponible }; })} className={`text-xs px-2 py-0.5 rounded cursor-pointer ${eliminar ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}>{eliminar ? "Restaurar" : "Eliminar"}</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={resolving} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-100 cursor-pointer disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={handleConfirmar} disabled={resolving} className="px-4 py-2 text-sm bg-amber-600 text-white rounded hover:bg-amber-700 cursor-pointer disabled:opacity-50">{resolving ? "Aplicando..." : "Aplicar cambios y confirmar"}</button>
        </div>
      </div>
    </div>
  );
}

function CancelMotivoPopup({ pedidoId, onConfirm, onCancel, loading }: {
  pedidoId: number; onConfirm: (motivo: string) => void; onCancel: () => void; loading: boolean;
}) {
  const [motivo, setMotivo] = useState("");
  const trimmed = motivo.trim();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white rounded p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">Cancelar Pedido</h2>
          <button onClick={onCancel} className="text-gray-500 text-xl cursor-pointer" disabled={loading}>X</button>
        </div>
        <p className="text-sm text-gray-700 mb-4">
          Esta seguro que desea cancelar el pedido <strong>#{pedidoId}</strong>?
          No podra cancelarlo hasta rellenar el motivo:
        </p>
        <form onSubmit={handleSubmit}>
          <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Escriba el motivo de la cancelacion..." className="w-full border border-gray-300 rounded px-3 py-2 mb-4 text-sm focus:outline-none focus:border-red-400" autoFocus disabled={loading} maxLength={500} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel} disabled={loading} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-100 cursor-pointer disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={!trimmed || loading} className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 cursor-pointer disabled:opacity-50">{loading ? "Cancelando..." : "Confirmar Cancelacion"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

type ModoVista = "activos" | "historial";

export default function PedidosPage() {
  const [modo, setModo] = useState<ModoVista>("activos");
  const esHistorial = modo === "historial";
  const [detailPopup, setDetailPopup] = useState<Pedido | null>(null);
  const [selectedPedidoId, setSelectedPedidoId] = useState<number>(0);
  const [stockIssue, setStockIssue] = useState<{ pedido: Pedido; detalles: StockInsuficienteDetalle[] } | null>(null);
  const [cancelPopup, setCancelPopup] = useState<number | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [retryingPaymentId, setRetryingPaymentId] = useState<number | null>(null);
  const [limiteExcedido, setLimiteExcedido] = useState(false);

  const autoOpenedRef = useRef(false);
  const { id: autoOpenId } = useParams<{ id: string }>();

  const roles = getUserRoles();
  const esGestor = roles.includes("ADMIN") || roles.includes("PEDIDOS");
  const wsStatus = useWsStatus();
  const wsConnected = wsStatus === 'connected';
  const qc = useQueryClient();

  // Reset unseen notifications when viewing the pedidos page
  useEffect(() => {
    useNotificationStore.getState().resetUnseen();
  }, []);

  // ── TanStack Query: pedidos ──
  const activosQuery = usePedidosActivos(0, 100);
  const historialQuery = usePedidosHistorial(0, 100);
  const { data: pedidosRaw = [], isLoading, isError, error } = esHistorial ? historialQuery : activosQuery;

  // Client-side: limit to 10 for non-gestor
  const pedidos = esGestor || esHistorial ? pedidosRaw : pedidosRaw.slice(0, 10);

  useEffect(() => {
    if (!esGestor && !esHistorial && pedidosRaw.length > 10) {
      setLimiteExcedido(true);
    } else {
      setLimiteExcedido(false);
    }
  }, [pedidosRaw, esGestor, esHistorial]);

  // ── TanStack Query: pagos for selected pedido ──
  const { data: pagosData } = usePagosByPedido(selectedPedidoId);

  // ── TanStack Query mutations ──
  const avanzarMutation = useAvanzarPedido();
  const cancelarMutation = useCancelarPedido();
  const actualizarDetalleMutation = useActualizarDetalle();

  // WS callbacks: invalidate queries instead of manual loadPedidos
  // Also invalidate detail/timeline queries so the historial refreshes on WS events
  useAdminPedidoFeed(esGestor && !esHistorial, () => {
    qc.invalidateQueries({ queryKey: ['pedidos', 'activos'] });
    qc.invalidateQueries({ queryKey: ['pedidos', 'detail'] });
  });

  // Auto-open detail popup from URL param
  useEffect(() => {
    if (!autoOpenId || isLoading || autoOpenedRef.current || pedidos.length === 0) return;
    const pedidoId = Number(autoOpenId);
    const matched = pedidos.find((p) => p.id === pedidoId);
    if (matched) {
      autoOpenedRef.current = true;
      setDetailPopup(matched);
      const shouldFetchPagos = esGestor || matched.forma_pago_codigo === "MERCADOPAGO";
      if (shouldFetchPagos) {
        setSelectedPedidoId(matched.id);
      }
    }
  }, [pedidos, isLoading, autoOpenId, esGestor]);

  const cambiarModo = (nuevo: ModoVista) => {
    if (nuevo !== modo) setModo(nuevo);
  };

  const handleAvanzar = async (id: number) => {
    try {
      const res = await avanzarMutation.mutateAsync(id);
      addToast('exito', res.mensaje);
    } catch (e) {
      if (e instanceof AxiosError && e.response?.status === 409 && e.response.data) {
        const body = e.response.data as { detail?: { error: string; mensaje: string; detalles: StockInsuficienteDetalle[] } };
        if (body.detail?.error === "stock_insuficiente") {
          const pedido = pedidos.find(p => p.id === id);
          if (pedido) {
            setStockIssue({ pedido, detalles: body.detail.detalles });
            return;
          }
        }
      }
      addToast('error', (e as Error).message);
    }
  };

  const handleResolverStock = async (resoluciones: Record<number, number>) => {
    if (!stockIssue) return;
    try {
      for (const [productoIdStr, cantidad] of Object.entries(resoluciones)) {
        const productoId = Number(productoIdStr);
        await actualizarDetalleMutation.mutateAsync({ pedidoId: stockIssue.pedido.id, productoId, cantidad });
      }
      const res = await avanzarMutation.mutateAsync(stockIssue.pedido.id);
      setStockIssue(null);
      addToast('exito', res.mensaje);
    } catch (e) {
      addToast('error', (e as Error).message);
    }
  };

  const handleCancelarClick = (id: number) => {
    setCancelPopup(id);
  };

  const handleCancelarConfirm = async (motivo: string) => {
    if (!cancelPopup) return;
    setCancelLoading(true);
    try {
      await cancelarMutation.mutateAsync({ id: cancelPopup, motivo });
      addToast('exito', 'Pedido cancelado correctamente');
      setCancelPopup(null);
    } catch (e) {
      addToast('error', (e as Error).message);
    } finally {
      setCancelLoading(false);
    }
  };

  return (
    <div className="p-4">
      <div className="flex gap-1 mb-4 border-b border-gray-300">
        <button onClick={() => cambiarModo("activos")} className={`px-4 py-2 text-sm font-medium rounded-t cursor-pointer transition-colors ${modo === "activos" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>Activos</button>
        <button onClick={() => cambiarModo("historial")} className={`px-4 py-2 text-sm font-medium rounded-t cursor-pointer transition-colors ${modo === "historial" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>Historial</button>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-2xl font-bold">
          {esHistorial ? "Historial de Pedidos" : esGestor ? "Gestion de Pedidos" : "Mis Pedidos"}
        </h1>
        {!esHistorial && (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${wsConnected ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`} title={wsConnected ? "Conectado — recibiendo actualizaciones en tiempo real" : "Desconectado — no se reciben actualizaciones"}>
            <span className={`inline-block w-2 h-2 rounded-full ${wsConnected ? "bg-green-500" : "bg-red-500"}`} />
            {wsConnected ? "Conectado" : "Desconectado"}
          </span>
        )}
      </div>

      {isError && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded mb-4">
          {(error as Error)?.message || "Error al cargar"}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600">Cargando pedidos...</span>
        </div>
      ) : pedidos.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          {esHistorial ? (
            <>
              <p className="text-lg mb-2">No hay historial de pedidos</p>
              <p className="text-sm">Los pedidos entregados o cancelados apareceran aqui.</p>
            </>
          ) : (
            <>
              <p className="text-lg mb-2">No hay pedidos activos</p>
              <p className="text-sm">Los pedidos finalizados o cancelados no se muestran aqui.</p>
            </>
          )}
        </div>
      ) : (
        <>
          {limiteExcedido && (
            <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-2 rounded mb-4 text-sm">
              Mostrando los ultimos 10 pedidos activos. Los anteriores estan disponibles en el historial.
            </div>
          )}

          <table className="w-full border-collapse border">
            <thead><tr className="bg-gray-200">
              {esGestor && <th className="border p-2 text-left">Pedido #</th>}
              {esGestor && <th className="border p-2 text-left">Usuario</th>}
              <th className="border p-2 text-left">Fecha</th>
              <th className="border p-2 text-left">Estado</th>
              <th className="border p-2 text-left">Entrega</th>
              <th className="border p-2 text-right">Total</th>
              <th className="border p-2 text-left">Acciones</th>
            </tr></thead>
            <tbody>
              {pedidos.map((ped) => (
                <tr key={ped.id} className={`hover:bg-gray-100 border-b ${ped.deleted_at ? 'bg-red-50' : ''}`}>
                  {esGestor && <td className="p-2 font-mono">#{ped.id}</td>}
                  {esGestor && <td className="p-2">{ped.usuario ? ped.usuario.email : `Usuario #${ped.usuario_id}`}</td>}
                  <td className="p-2 text-sm">{new Date(ped.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="p-2"><span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ESTADOS_COLORES[ped.estado_codigo] || "bg-gray-100"}`}>{ETIQUETAS_ESTADO[ped.estado_codigo] || "Estado desconocido"}</span></td>
                  <td className="p-2 text-xs">{ped.direccion_id ? (<span className="text-blue-600 font-medium">Envio</span>) : (<span className="text-green-600 font-medium">Retiro en local</span>)}</td>
                  <td className="p-2 text-right font-mono font-semibold">${parseFloat(ped.total).toFixed(2)}</td>
                  <td className="p-2">
                    <div className="flex gap-1 flex-wrap">
                      <button onClick={() => { setDetailPopup(ped); setSelectedPedidoId(ped.id); }} className="bg-gray-600 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-gray-700">Ver Detalles</button>
                      {!esHistorial && esGestor && ETIQUETAS_AVANCE[ped.estado_codigo] && (
                        <button onClick={() => handleAvanzar(ped.id)} className="bg-blue-600 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-blue-700">{ETIQUETAS_AVANCE[ped.estado_codigo]}</button>
                      )}
                      {!esHistorial && (esGestor || ped.estado_codigo !== "EN_PREP") && (
                        <button onClick={() => handleCancelarClick(ped.id)} className="bg-red-600 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-red-700">Cancelar</button>
                      )}
                      {ped.estado_codigo === "PENDIENTE" && ped.forma_pago_codigo === "MERCADOPAGO" && (
                        <button onClick={async () => { setRetryingPaymentId(ped.id); try { const res = await pagosApi.initPayment(ped.id); if (res.init_point && res.init_point.startsWith("https://")) { window.location.href = res.init_point; } else { addToast('error', 'El servicio de pago no esta disponible'); setRetryingPaymentId(null); } } catch { addToast('error', 'El servicio de pago no esta disponible'); setRetryingPaymentId(null); } }} disabled={retryingPaymentId === ped.id} className="bg-green-600 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed">{retryingPaymentId === ped.id ? "Redirigiendo..." : "Pagar con MercadoPago"}</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {detailPopup && (
        <DetallesPopup pedido={detailPopup} detalles={detailPopup.detalles ?? []} onClose={() => setDetailPopup(null)} esGestor={esGestor} pagos={pagosData} />
      )}

      {stockIssue && (
        <StockModal pedido={stockIssue.pedido} detalles={stockIssue.detalles} onResolve={handleResolverStock} onCancel={() => setStockIssue(null)} />
      )}

      {cancelPopup !== null && (
        <CancelMotivoPopup pedidoId={cancelPopup} onConfirm={handleCancelarConfirm} onCancel={() => !cancelLoading && setCancelPopup(null)} loading={cancelLoading} />
      )}

      {/* WS subscribers: one per active pedido for client-side real-time updates */}
      {!esGestor && !esHistorial && pedidos.map((p) => (
        <PedidoWSSubscriber key={p.id} pedidoId={p.id} enabled={true} />
      ))}
    </div>
  );
}
