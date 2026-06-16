/**
 * Dashboard — Admin statistics and analytics page.
 *
 * Displays 4 KPI stat cards and 4 charts:
 *   - Ventas por Periodo (LineChart + PeriodSelector)
 *   - Top Productos (vertical BarChart)
 *   - Pedidos por Estado (PieChart)
 *   - Ingresos por Forma de Pago (horizontal BarChart)
 *
 * Data is fetched on mount from 5 API endpoints. The PeriodSelector
 * triggers a re-fetch of only the ventas-periodo chart data.
 *
 * Render states: loading (spinner), error (message + retry), empty ("Sin datos"),
 * and normal data display.
 */
import { useEffect, useState, useCallback } from "react";
import {
  BarChart,
  PieChart,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Cell,
  CartesianGrid,
  Bar,
  Pie,
  Line,
} from "recharts";
import {
  fetchResumen,
  fetchVentasPeriodo,
  fetchProductosTop,
  fetchPedidosEstado,
  fetchIngresosFormaPago,
  type ResumenResponse,
  type VentasPeriodoItem,
  type ProductoTopItem,
  type PedidosEstadoItem,
  type IngresosResponse,
} from "@/features/estadisticas/api/estadisticas";

// ── Constants ──

/** Color mapping for order estados (matches PedidosPage ESTADOS_COLORES). */
const ESTADO_COLORS: Record<string, string> = {
  PENDIENTE: "#eab308",
  CONFIRMADO: "#3b82f6",
  EN_PREP: "#6366f1",
  ENTREGADO: "#22c55e",
  CANCELADO: "#ef4444",
};

/** Human-readable estado labels. */
const ESTADO_LABELS: Record<string, string> = {
  PENDIENTE: "Pendiente",
  CONFIRMADO: "Confirmado",
  EN_PREP: "En Preparacion",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
};

/** Fallback color for estados not in the mapping. */
const FALLBACK_ESTADO_COLOR = "#9ca3af";

/** How many characters to show before truncating product names in the chart. */
const PRODUCT_NAME_MAX_LEN = 22;

/**
 * Truncates a string to maxLen characters, appending "..." if truncated.
 * E.g., "Sandwich de Milanesa" => "Sandwich de Milan..."
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

/** Formats a monetary string/value as Argentine pesos. */
function formatCurrency(value: string | number): string {
  const num = typeof value === "string" ? Number(value) : value;
  return num.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

/** Returns a date string offset by `days` from today, in YYYY-MM-DD format. */
function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

// ── Sub-components ──

/**
 * StatCard — A single KPI card with a colored left border accent.
 *
 * Props:
 *   - label: the metric name (e.g., "Ventas Hoy").
 *   - value: the formatted value to display.
 *   - accentColor: Tailwind border color class (e.g., "border-l-blue-500").
 */
function StatCard({
  label,
  value,
  accentColor,
}: {
  label: string;
  value: string;
  accentColor: string;
}) {
  return (
    <div
      className={`bg-white rounded-lg shadow border-l-4 ${accentColor} p-4`}
    >
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-bold text-gray-800">{value}</p>
    </div>
  );
}

/**
 * ChartSection — Wrapper for a chart with a title.
 * Handles loading and empty states specific to each chart.
 */
function ChartSection({
  title,
  loading,
  empty,
  emptyMessage,
  error,
  onRetry,
  children,
}: {
  title: string;
  loading: boolean;
  empty: boolean;
  emptyMessage: string;
  error: string | null;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="text-lg font-semibold text-gray-700 mb-3">{title}</h3>
      {loading && (
        <div className="flex justify-center items-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
          <span className="ml-2 text-gray-500 text-sm">Cargando...</span>
        </div>
      )}
      {error && !loading && (
        <div className="text-center py-8">
          <p className="text-red-600 text-sm mb-2">{error}</p>
          <button
            onClick={onRetry}
            className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      )}
      {empty && !loading && !error && (
        <p className="text-center py-8 text-gray-400 text-sm">
          {emptyMessage}
        </p>
      )}
      {!loading && !error && !empty && children}
    </div>
  );
}

/**
 * PeriodSelector — Three buttons to choose the grouping for ventas-periodo.
 */
function PeriodSelector({
  value,
  onChange,
}: {
  value: "day" | "week" | "month";
  onChange: (v: "day" | "week" | "month") => void;
}) {
  const options: { key: "day" | "week" | "month"; label: string }[] = [
    { key: "day", label: "Dia" },
    { key: "week", label: "Semana" },
    { key: "month", label: "Mes" },
  ];

  return (
    <div className="flex gap-1 mb-3">
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={`px-3 py-1 text-xs rounded cursor-pointer transition-colors ${
            value === opt.key
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Main Component ──

export default function Dashboard() {
  // ── Summary (KPI) state ──
  const [resumen, setResumen] = useState<ResumenResponse | null>(null);
  const [resumenLoading, setResumenLoading] = useState(true);
  const [resumenError, setResumenError] = useState<string | null>(null);

  // ── Ventas periodo state ──
  const [ventasPeriodo, setVentasPeriodo] = useState<VentasPeriodoItem[]>([]);
  const [ventasPeriodoLoading, setVentasPeriodoLoading] = useState(true);
  const [ventasPeriodoError, setVentasPeriodoError] = useState<string | null>(
    null
  );
  const [agrupacion, setAgrupacion] = useState<"day" | "week" | "month">(
    "day"
  );

  // ── Productos top state ──
  const [productosTop, setProductosTop] = useState<ProductoTopItem[]>([]);
  const [productosTopLoading, setProductosTopLoading] = useState(true);
  const [productosTopError, setProductosTopError] = useState<string | null>(
    null
  );

  // ── Pedidos estado state ──
  const [pedidosEstado, setPedidosEstado] = useState<PedidosEstadoItem[]>([]);
  const [pedidosEstadoLoading, setPedidosEstadoLoading] = useState(true);
  const [pedidosEstadoError, setPedidosEstadoError] = useState<string | null>(
    null
  );

  // ── Ingresos forma de pago state ──
  const [ingresosFP, setIngresosFP] = useState<IngresosResponse[]>([]);
  const [ingresosFPLoading, setIngresosFPLoading] = useState(true);
  const [ingresosFPError, setIngresosFPError] = useState<string | null>(null);

  // ── Global error (when ALL fail) ──
  const [globalError, setGlobalError] = useState<string | null>(null);

  // ── Fetch helpers ──

  const loadResumen = useCallback(async () => {
    setResumenLoading(true);
    setResumenError(null);
    try {
      const data = await fetchResumen();
      setResumen(data);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Error al cargar resumen";
      setResumenError(msg);
    } finally {
      setResumenLoading(false);
    }
  }, []);

  const loadVentasPeriodo = useCallback(
    async (desde: string, hasta: string, ag: string) => {
      setVentasPeriodoLoading(true);
      setVentasPeriodoError(null);
      try {
        const data = await fetchVentasPeriodo(desde, hasta, ag);
        setVentasPeriodo(data);
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Error al cargar ventas por periodo";
        setVentasPeriodoError(msg);
      } finally {
        setVentasPeriodoLoading(false);
      }
    },
    []
  );

  const loadProductosTop = useCallback(async () => {
    setProductosTopLoading(true);
    setProductosTopError(null);
    try {
      const data = await fetchProductosTop(10);
      setProductosTop(data);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Error al cargar productos top";
      setProductosTopError(msg);
    } finally {
      setProductosTopLoading(false);
    }
  }, []);

  const loadPedidosEstado = useCallback(async () => {
    setPedidosEstadoLoading(true);
    setPedidosEstadoError(null);
    try {
      const data = await fetchPedidosEstado();
      setPedidosEstado(data);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Error al cargar pedidos por estado";
      setPedidosEstadoError(msg);
    } finally {
      setPedidosEstadoLoading(false);
    }
  }, []);

  const loadIngresosFP = useCallback(
    async (desde: string, hasta: string) => {
      setIngresosFPLoading(true);
      setIngresosFPError(null);
      try {
        const data = await fetchIngresosFormaPago(desde, hasta);
        setIngresosFP(data);
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Error al cargar ingresos por forma de pago";
        setIngresosFPError(msg);
      } finally {
        setIngresosFPLoading(false);
      }
    },
    []
  );

  // ── Initial fetch on mount ──
  useEffect(() => {
    const hoy = dateOffset(0);
    const hace30 = dateOffset(30);

    const allPromises = [
      loadResumen(),
      loadVentasPeriodo(hace30, hoy, "day"),
      loadProductosTop(),
      loadPedidosEstado(),
      loadIngresosFP(hace30, hoy),
    ];

    Promise.allSettled(allPromises).then((results) => {
      const allFailed = results.every(
        (r) => r.status === "rejected"
      );
      if (allFailed) {
        setGlobalError(
          "No se pudieron cargar los datos del dashboard. Verifique su conexion."
        );
      }
    });
  }, [loadResumen, loadVentasPeriodo, loadProductosTop, loadPedidosEstado, loadIngresosFP]);

  // ── PeriodSelector change handler ──
  const handleAgrupacionChange = (newAg: "day" | "week" | "month") => {
    setAgrupacion(newAg);
    const hoy = dateOffset(0);
    // Wider range for week/month to show meaningful data
    const rangeMap: Record<string, number> = {
      day: 30,
      week: 90,
      month: 365,
    };
    const desde = dateOffset(rangeMap[newAg]);
    loadVentasPeriodo(desde, hoy, newAg);
  };

  // ── Retry all ──
  const handleRetryAll = () => {
    setGlobalError(null);
    const hoy = dateOffset(0);
    const hace30 = dateOffset(30);
    loadResumen();
    loadVentasPeriodo(hace30, hoy, agrupacion);
    loadProductosTop();
    loadPedidosEstado();
    loadIngresosFP(hace30, hoy);
  };

  // ── Render ──

  // Global error state: all requests failed
  if (globalError && resumenError && ventasPeriodoError && productosTopError && pedidosEstadoError && ingresosFPError) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">
          Dashboard de Estadisticas
        </h1>
        <div className="text-center py-12">
          <p className="text-red-600 text-lg mb-4">{globalError}</p>
          <button
            onClick={handleRetryAll}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">
        Dashboard de Estadisticas
      </h1>

      {/* ── Stat Cards Row ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {resumenLoading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="bg-white rounded-lg shadow border-l-4 border-l-gray-300 p-4 animate-pulse"
              >
                <div className="h-4 bg-gray-200 rounded w-24 mb-2" />
                <div className="h-6 bg-gray-200 rounded w-32" />
              </div>
            ))}
          </>
        ) : resumenError ? (
          <div className="col-span-full">
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              <p className="text-sm">{resumenError}</p>
              <button
                onClick={loadResumen}
                className="mt-1 text-xs text-red-600 underline cursor-pointer"
              >
                Reintentar
              </button>
            </div>
          </div>
        ) : resumen ? (
          <>
            <StatCard
              label="Ventas Hoy"
              value={formatCurrency(resumen.ventas_hoy)}
              accentColor="border-l-blue-500"
            />
            <StatCard
              label="Ticket Promedio"
              value={formatCurrency(resumen.ticket_promedio)}
              accentColor="border-l-green-500"
            />
            <StatCard
              label="Pedidos Activos"
              value={String(resumen.pedidos_activos)}
              accentColor="border-l-orange-500"
            />
            <StatCard
              label="Mes Actual"
              value={formatCurrency(resumen.mes_actual)}
              accentColor="border-l-purple-500"
            />
          </>
        ) : null}
      </div>

      {/* ── Charts Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ventas por Periodo */}
        <ChartSection
          title="Ventas por Periodo"
          loading={ventasPeriodoLoading}
          empty={ventasPeriodo.length === 0 && !ventasPeriodoLoading && !ventasPeriodoError}
          emptyMessage="Sin datos de ventas para este periodo"
          error={ventasPeriodoError}
          onRetry={() => {
            const hoy = dateOffset(0);
            const rangeMap: Record<string, number> = {
              day: 30,
              week: 90,
              month: 365,
            };
            const desde = dateOffset(rangeMap[agrupacion]);
            loadVentasPeriodo(desde, hoy, agrupacion);
          }}
        >
          <PeriodSelector value={agrupacion} onChange={handleAgrupacionChange} />
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={ventasPeriodo}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="fecha"
                tick={{ fontSize: 11 }}
                tickFormatter={(val: string) => {
                  const d = new Date(val + "T00:00:00");
                  return d.toLocaleDateString("es-AR", {
                    day: "2-digit",
                    month: "2-digit",
                  });
                }}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(val: number) => formatCurrency(val)}
              />
              <Tooltip
                formatter={(val: number | string) => {
                  const n = typeof val === "string" ? Number(val) : val;
                  return [formatCurrency(n), "Total"];
                }}
                labelFormatter={(label: string) => {
                  const d = new Date(label + "T00:00:00");
                  return d.toLocaleDateString("es-AR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  });
                }}
              />
              <Line
                type="monotone"
                dataKey="total"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartSection>

        {/* Top Productos */}
        <ChartSection
          title="Top Productos"
          loading={productosTopLoading}
          empty={productosTop.length === 0 && !productosTopLoading && !productosTopError}
          emptyMessage="Sin datos de productos"
          error={productosTopError}
          onRetry={loadProductosTop}
        >
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={productosTop} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                type="number"
                tick={{ fontSize: 11 }}
                tickFormatter={(val: number) => formatCurrency(val)}
              />
              <YAxis
                dataKey="nombre"
                type="category"
                tick={{ fontSize: 10 }}
                tickFormatter={(val: string) =>
                  truncate(val, PRODUCT_NAME_MAX_LEN)
                }
                width={130}
              />
              <Tooltip
                formatter={(val: number | string, _name: string, props: { payload: ProductoTopItem }) => {
                  const n = typeof val === "string" ? Number(val) : val;
                  return [formatCurrency(n), "Ingresos"];
                }}
                labelFormatter={(label: string) => label}
              />
              <Bar dataKey="ingresos" fill="#6366f1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartSection>

        {/* Pedidos por Estado */}
        <ChartSection
          title="Pedidos por Estado"
          loading={pedidosEstadoLoading}
          empty={pedidosEstado.length === 0 && !pedidosEstadoLoading && !pedidosEstadoError}
          emptyMessage="Sin datos de pedidos"
          error={pedidosEstadoError}
          onRetry={loadPedidosEstado}
        >
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={pedidosEstado}
                dataKey="cantidad"
                nameKey="estado_codigo"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={({ estado_codigo, cantidad }: PedidosEstadoItem) =>
                  `${ESTADO_LABELS[estado_codigo] || estado_codigo}: ${cantidad}`
                }
              >
                {pedidosEstado.map((entry) => (
                  <Cell
                    key={entry.estado_codigo}
                    fill={
                      ESTADO_COLORS[entry.estado_codigo] ||
                      FALLBACK_ESTADO_COLOR
                    }
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(val: number, _name: string, props: { payload: PedidosEstadoItem }) => {
                  return [val, ESTADO_LABELS[props.payload.estado_codigo] || props.payload.estado_codigo];
                }}
              />
              <Legend
                formatter={(val: string) =>
                  ESTADO_LABELS[val] || val
                }
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartSection>

        {/* Ingresos por Forma de Pago */}
        <ChartSection
          title="Ingresos por Forma de Pago"
          loading={ingresosFPLoading}
          empty={ingresosFP.length === 0 && !ingresosFPLoading && !ingresosFPError}
          emptyMessage="Sin datos de ingresos por forma de pago"
          error={ingresosFPError}
          onRetry={() => {
            const hoy = dateOffset(0);
            const hace30 = dateOffset(30);
            loadIngresosFP(hace30, hoy);
          }}
        >
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={ingresosFP} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                type="number"
                tick={{ fontSize: 11 }}
                tickFormatter={(val: number) => formatCurrency(val)}
              />
              <YAxis
                dataKey="forma_pago_codigo"
                type="category"
                tick={{ fontSize: 11 }}
                width={100}
              />
              <Tooltip
                formatter={(val: number | string) => {
                  const n = typeof val === "string" ? Number(val) : val;
                  return [formatCurrency(n), "Total"];
                }}
              />
              <Bar dataKey="total" fill="#f59e0b" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartSection>
      </div>
    </div>
  );
}
