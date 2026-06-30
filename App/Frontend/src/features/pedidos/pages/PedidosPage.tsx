/**
 * PedidosPage — Orders listing and management page.
 * Uses TanStack Query for data fetching and mutations.
 * Uses DataTable with server-side pagination.
 */
import { useEffect, useState, useRef, useMemo } from "react";
import { type Pedido, type DetallePedido, type StockInsuficienteDetalle } from "@/features/pedidos/api/pedidos";
import { type PagoRead } from "@/features/pedidos/api/pagos";
import { getUserRoles } from "@/shared/api/client";
import { AxiosError } from "axios";
import { useAdminPedidoFeed } from "@/features/pedidos/hooks/useAdminPedidoFeed";
import { useClientePedidoFeed } from "@/features/pedidos/hooks/useClientePedidoFeed";
import { useWsStatus } from "@/features/pedidos/store/wsStore";
import { useNotificationStore } from "@/features/pedidos/store/notificationStore";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { addToast } from "@/shared/components/Toast";
import Modal from "@/shared/components/Modal";
import { usePagination } from "@/shared/hooks/usePagination";
import DataTable, { type DataTableColumn } from "@/shared/components/DataTable";
import {
  usePedidosActivos,
  usePedidosHistorial,
  useAvanzarPedido,
  useCancelarPedido,
  useActualizarDetalle,
} from "@/features/pedidos/hooks/usePedidos";
import { usePagosByPedido } from "@/features/pedidos/hooks/usePagos";
import { HistorialTimeline } from "@/features/pedidos/components/HistorialTimeline";
import ErrorBanner from "@/shared/components/ErrorBanner";
import SearchFilter from "@/shared/components/SearchFilter";

const DEFAULT_LIMIT = 10;

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
  return null;
}

function DetallesPopup({ pedido, detalles, onClose, esGestor: _esGestor, pagos }: {
  pedido: Pedido; detalles: DetallePedido[]; onClose: () => void; esGestor?: boolean; pagos?: PagoRead[];
}) {
  return (
    <Modal open={true} onClose={onClose} title={`Detalles del Pedido #${pedido.id}`}>
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

      <HistorialTimeline pedidoId={pedido.id} />
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
    <Modal
      open={true}
      onClose={onCancel}
      title="Stock Insuficiente"
      maxWidth="max-w-lg"
      footer={
        <>
          <button type="button" onClick={onCancel} disabled={resolving} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-100 cursor-pointer disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={handleConfirmar} disabled={resolving} className="px-4 py-2 text-sm bg-amber-600 text-white rounded hover:bg-amber-700 cursor-pointer disabled:opacity-50">{resolving ? "Aplicando..." : "Aplicar cambios y confirmar"}</button>
        </>
      }
    >
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

    </Modal>
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
    <Modal
      open={true}
      onClose={onCancel}
      title="Cancelar Pedido"
      maxWidth="max-w-md"
      footer={
        <>
          <button type="button" onClick={onCancel} disabled={loading} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-100 cursor-pointer disabled:opacity-50">Cancelar</button>
          <button type="submit" form="cancel-pedido-form" disabled={!trimmed || loading} className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 cursor-pointer disabled:opacity-50">{loading ? "Cancelando..." : "Confirmar Cancelacion"}</button>
        </>
      }
    >
        <p className="text-sm text-gray-700 mb-4">
          Esta seguro que desea cancelar el pedido <strong>#{pedidoId}</strong>?
          No podra cancelarlo hasta rellenar el motivo:
        </p>
        <form id="cancel-pedido-form" onSubmit={handleSubmit}>
          <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Escriba el motivo de la cancelacion..." className="w-full border border-gray-300 rounded px-3 py-2 mb-4 text-sm focus:outline-none focus:border-red-400" autoFocus disabled={loading} maxLength={500} />
        </form>
    </Modal>
  );
}

type ModoVista = "activos" | "historial";

export default function PedidosPage() {
  const [modo, setModo] = useState<ModoVista>("activos");
  const esHistorial = modo === "historial";

  const { skip, limit, handlePageChange, handleLimitChange } = usePagination(DEFAULT_LIMIT);
  const [sortBy, setSortBy] = useState("id");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [detailPopup, setDetailPopup] = useState<Pedido | null>(null);
  const [selectedPedidoId, setSelectedPedidoId] = useState<number>(0);
  const [stockIssue, setStockIssue] = useState<{ pedido: Pedido; detalles: StockInsuficienteDetalle[] } | null>(null);
  const [cancelPopup, setCancelPopup] = useState<number | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const autoOpenedRef = useRef(false);
  const { id: autoOpenId } = useParams<{ id: string }>();

  // ── Column-level filters ──
  const [filters, setFilters] = useState<Record<string, string>>({});

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
  const activosQuery = usePedidosActivos(skip, limit, sortBy, sortOrder, search);
  const historialQuery = usePedidosHistorial(skip, limit, sortBy, sortOrder, search);
  const activeQuery = esHistorial ? historialQuery : activosQuery;
  const { data, isLoading, isError, error } = activeQuery;
  const pedidos = data?.items ?? [];
  const total = data?.total ?? 0;

  // ── Client-side filtering ──
  const filteredPedidos = useMemo(() => {
    return pedidos.filter(p => {
      if (filters["id"] && !String(p.id).includes(filters["id"])) return false;
      if (filters["estado_codigo"] && p.estado_codigo !== filters["estado_codigo"]) return false;
      if (filters["created_at"]) {
        const dateStr = new Date(p.created_at).toLocaleDateString("es-AR");
        if (!dateStr.includes(filters["created_at"])) return false;
      }
      return true;
    });
  }, [pedidos, filters]);

  // ── TanStack Query: pagos for selected pedido ──
  const { data: pagosData } = usePagosByPedido(selectedPedidoId);

  // ── TanStack Query mutations ──
  const avanzarMutation = useAvanzarPedido();
  const cancelarMutation = useCancelarPedido();
  const actualizarDetalleMutation = useActualizarDetalle();

  // WS callbacks: invalidate queries instead of manual loadPedidos
  useAdminPedidoFeed(esGestor && !esHistorial, () => {
    qc.invalidateQueries({ queryKey: ['pedidos', 'activos'] });
    qc.invalidateQueries({ queryKey: ['pedidos', 'detail'] });
  });

  // Client feed: single WebSocket for all client orders (replaces per-pedido connections)
  useClientePedidoFeed(!esGestor && !esHistorial, () => {
    qc.invalidateQueries({ queryKey: ['pedidos', 'activos'] });
    qc.invalidateQueries({ queryKey: ['pedidos', 'detail'] });
    qc.invalidateQueries({ queryKey: ['mis-pedidos'] });
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
    if (nuevo !== modo) {
      setModo(nuevo);
      handlePageChange(0);
      setSortBy("id");
      setSortOrder("desc");
    }
  };

  const handleSort = (newSortBy: string, newSortOrder: "asc" | "desc") => {
    setSortBy(newSortBy);
    setSortOrder(newSortOrder);
    handlePageChange(0);
  };

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    handlePageChange(0);
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

  // Build columns based on role and mode
  const columns: DataTableColumn<Pedido>[] = [
    {
      key: "id" as const,
      label: "Pedido #",
      render: (ped: Pedido) => <span className="font-mono">#{ped.id}</span>,
      sortable: true,
      filterable: true,
    },
    ...(esGestor ? [
      {
        key: "usuario" as const,
        label: "Usuario",
        render: (ped: Pedido) => ped.usuario ? ped.usuario.email : `Usuario #${ped.usuario_id}`,
        hideOnMobile: true,
      },
    ] : []),
    {
      key: "estado_codigo" as const,
      label: "Estado",
      render: (ped: Pedido) => (
        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ESTADOS_COLORES[ped.estado_codigo] || "bg-gray-100"}`}>
          {ETIQUETAS_ESTADO[ped.estado_codigo] || "Estado desconocido"}
        </span>
      ),
      sortable: true,
      filterable: true,
      filterType: "select",
      filterOptions: [
        { value: "PENDIENTE", label: ETIQUETAS_ESTADO["PENDIENTE"] },
        { value: "CONFIRMADO", label: ETIQUETAS_ESTADO["CONFIRMADO"] },
        { value: "EN_PREP", label: ETIQUETAS_ESTADO["EN_PREP"] },
        { value: "ENTREGADO", label: ETIQUETAS_ESTADO["ENTREGADO"] },
        { value: "CANCELADO", label: ETIQUETAS_ESTADO["CANCELADO"] },
      ],
    },
    {
      key: "created_at" as const,
      label: "Fecha",
      render: (ped: Pedido) => (
        <span className="text-sm">
          {new Date(ped.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        </span>
      ),
      hideOnMobile: true,
      sortable: true,
      filterable: true,
    },
    {
      key: "total" as const,
      label: "Total",
      render: (ped: Pedido) => <span className="font-mono font-semibold">${parseFloat(ped.total).toFixed(2)}</span>,
      hideOnMobile: true,
      sortable: true,
    },
    {
      key: "acciones" as const,
      label: "Acciones",
      render: (ped: Pedido) => (
        <div className="flex gap-1 flex-wrap">
          <button onClick={() => { setDetailPopup(ped); setSelectedPedidoId(ped.id); }} className="bg-gray-600 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-gray-700">Ver Detalles</button>
          {!esHistorial && esGestor && ETIQUETAS_AVANCE[ped.estado_codigo] && (
            <button onClick={() => handleAvanzar(ped.id)} className="bg-blue-600 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-blue-700">{ETIQUETAS_AVANCE[ped.estado_codigo]}</button>
          )}
          {!esHistorial && (esGestor || ped.estado_codigo !== "EN_PREP") && (
            <button onClick={() => handleCancelarClick(ped.id)} className="bg-red-600 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-red-700">Cancelar</button>
          )}

        </div>
      ),
    },
  ];

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

      <ErrorBanner isError={isError} error={error} message="Error al cargar" />

      <div className="mb-4">
        <SearchFilter
          onSearch={(v) => { setSearch(v); handlePageChange(0); }}
          placeholder="Buscar pedidos..."
        />
      </div>

      <DataTable
        columns={columns}
        data={filteredPedidos}
        total={filteredPedidos.length}
        skip={skip}
        limit={limit}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={handleSort}
        onPageChange={handlePageChange}
        onLimitChange={handleLimitChange}
        isLoading={isLoading}
        emptyMessage={esHistorial ? "No hay historial de pedidos" : "No hay pedidos activos"}
        filters={filters}
        onFilterChange={handleFilterChange}
      />

      {detailPopup && (
        <DetallesPopup pedido={detailPopup} detalles={detailPopup.detalles ?? []} onClose={() => setDetailPopup(null)} esGestor={esGestor} pagos={pagosData} />
      )}

      {stockIssue && (
        <StockModal pedido={stockIssue.pedido} detalles={stockIssue.detalles} onResolve={handleResolverStock} onCancel={() => setStockIssue(null)} />
      )}

      {cancelPopup !== null && (
        <CancelMotivoPopup pedidoId={cancelPopup} onConfirm={handleCancelarConfirm} onCancel={() => !cancelLoading && setCancelPopup(null)} loading={cancelLoading} />
      )}
    </div>
  );
}
