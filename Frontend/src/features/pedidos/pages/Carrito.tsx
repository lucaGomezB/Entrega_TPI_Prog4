/**
 * Carrito — Shopping cart page.
 * Uses TanStack Query for direcciones, Zustand for cart state.
 *
 * POST-PAGO FLOW (MercadoPago):
 *   1. Validate stock
 *   2. Call pagosApi.initFromCart() with cart items
 *   3. Redirect to MP init_point (cart NOT cleared)
 *   4. WebSocket pago_confirmado event clears cart and navigates
 *
 * SYNCHRONOUS FLOW (PAGO_LOCAL, EFECTIVO):
 *   1. Create Pedido
 *   2. Clear cart
 *   3. Navigate to pedidos
 */
import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCartStore } from "@/shared/store/cartStore";
import { AxiosError } from "axios";
import { pedidosApi, type ValidarStockDetalle } from "@/features/pedidos/api/pedidos";
import { productosApi, type ProductoIngredienteRead } from "@/features/productos/api/productos";
import {
  direccionesApi,
  formatDireccion,
  type DireccionEntregaInput,
} from "@/features/pedidos/api/direcciones";
import { pagosApi, type InitFromCartRequest } from "@/features/pedidos/api/pagos";
import { getAccessToken } from "@/shared/api/client";
import { useAppForm, required } from "@/shared/hooks/useAppForm";
import { useStore } from "@tanstack/react-form";
import { useDirecciones } from "@/features/pedidos/hooks/useDirecciones";

/* ── Modal rapido para crear direccion desde el carrito ── */

function NuevaDireccionModal({ onClose, onSave }: {
  onClose: () => void;
  onSave: (data: DireccionEntregaInput) => Promise<void>;
}) {
  const [guardando, setGuardando] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: { alias: "", linea1: "", linea2: "", ciudad: "" },
    onSubmit: async ({ value }) => {
      setGuardando(true);
      setModalError(null);
      try {
        await onSave({
          alias: value.alias.trim() || null,
          linea1: value.linea1.trim(),
          linea2: value.linea2.trim() || null,
          ciudad: value.ciudad.trim(),
          es_principal: false,
        });
        onClose();
      } catch {
        setModalError("Error al guardar la direccion. Intente nuevamente.");
        setTimeout(() => setModalError(null), 4000);
      } finally {
        setGuardando(false);
      }
    },
  });

  const formValues = useStore(form.store, (s) => s.values);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded p-6 w-full max-w-md" style={{ overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">Nueva Direccion de Entrega</h2>
        {modalError && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded mb-4 text-sm">{modalError}</div>}
        <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void form.handleSubmit(); }} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Alias</label>
            <form.Field name="alias">
              {(field) => <input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} placeholder="Ej: Casa, Trabajo..." maxLength={50} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />}
            </form.Field>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Calle y Numero <span className="text-red-500">*</span></label>
            <form.Field name="linea1" validators={{ onChange: required() }}>
              {(field) => <input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} required maxLength={100} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />}
            </form.Field>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Piso / Dpto</label>
            <form.Field name="linea2">
              {(field) => <input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} maxLength={100} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />}
            </form.Field>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ciudad <span className="text-red-500">*</span></label>
            <form.Field name="ciudad" validators={{ onChange: required() }}>
              {(field) => <input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} required maxLength={100} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />}
            </form.Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-100 cursor-pointer">Cancelar</button>
            <button type="submit" disabled={guardando || !formValues.linea1?.trim() || !formValues.ciudad?.trim()} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 cursor-pointer">{guardando ? "Guardando..." : "Guardar"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Modal de aviso de stock insuficiente ── */

function StockWarningModal({ detalles, onAdjust, onClose }: {
  detalles: ValidarStockDetalle[];
  onAdjust: (ajustes: Record<string, number>) => void;
  onClose: () => void;
}) {
  const [ajustes, setAjustes] = useState<Record<string, number>>({});

  const handleConfirm = () => {
    const final: Record<string, number> = {};
    for (const d of detalles) {
      final[d.producto_id] = ajustes[d.producto_id] ?? d.stock_disponible;
    }
    onAdjust(final);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded p-6 w-full max-w-md" style={{ overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-amber-700 mb-3">Stock Insuficiente</h2>
        <p className="text-sm text-gray-600 mb-3">No hay suficiente stock para completar el pedido. Reduzca las cantidades para continuar.</p>
        <div className="space-y-2 mb-4">
          {detalles.map((d) => {
            const current = ajustes[d.producto_id] ?? d.stock_disponible;
            return (
              <div key={d.producto_id} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{d.nombre_producto} (Disp: {d.stock_disponible})</span>
                <span className="text-red-600 font-medium">{d.cantidad_solicitada} pedidos</span>
                <input type="number" min={0} max={d.stock_disponible} value={current} onChange={(e) => setAjustes(prev => ({ ...prev, [d.producto_id]: parseInt(e.target.value) || 0 }))} className="border px-2 py-1 w-16 rounded text-sm" />
              </div>
            );
          })}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-100 cursor-pointer">Cancelar Pedido</button>
          <button onClick={handleConfirm} className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 cursor-pointer">Ajustar y continuar</button>
        </div>
      </div>
    </div>
  );
}

/* ── Pagina Principal ── */

export default function Carrito() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!getAccessToken()) navigate("/login", { replace: true });
  }, [navigate]);

  const items = useCartStore((s) => s.items);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [direccionSelId, setDireccionSelId] = useState<number | "nueva" | null>(null);
  const [showNewDir, setShowNewDir] = useState(false);
  const [stockWarnings, setStockWarnings] = useState<ValidarStockDetalle[] | null>(null);
  const [mensaje, setMensaje] = useState<{ tipo: 'exito' | 'error'; texto: string } | null>(null);
  const [formaPago, setFormaPago] = useState<string>("PAGO_LOCAL");
  const [ingredientesPorProducto, setIngredientesPorProducto] = useState<Record<number, ProductoIngredienteRead[]>>({});

  // ── TanStack Query: direcciones ──
  const { data: direcciones = [], isLoading: loadingDirs } = useDirecciones();

  // Auto-select primary direction
  useEffect(() => {
    if (direcciones.length > 0 && direccionSelId === null) {
      const principal = direcciones.find((d) => d.es_principal);
      setDireccionSelId(principal ? principal.id : direcciones[0].id);
    }
  }, [direcciones, direccionSelId]);

  // Hydrate cart on focus
  useEffect(() => {
    const onFocus = () => useCartStore.getState().hydrate();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Load removable ingredients for each product in the cart
  useEffect(() => {
    const cartItems = useCartStore.getState().items;
    const ids = [...new Set(cartItems.map(i => i.productoId))];
    Promise.all(
      ids.map(async (id) => {
        try {
          const ingredientes = await productosApi.getIngredientes(id);
          return { id, ingredientes: ingredientes.filter(i => i.es_removible) };
        } catch {
          return { id, ingredientes: [] };
        }
      })
    ).then((results) => {
      const map: Record<number, ProductoIngredienteRead[]> = {};
      results.forEach(r => { map[r.id] = r.ingredientes; });
      setIngredientesPorProducto(map);
    });
  }, []);

  const handleRemove = (productoId: number) => {
    useCartStore.getState().removeFromCart(productoId);
  };

  const handleIncrement = (productoId: number) => {
    const item = items.find((i) => i.productoId === productoId);
    if (item) useCartStore.getState().updateCantidad(productoId, item.cantidad + 1);
  };

  const handleDecrement = (productoId: number) => {
    const item = items.find((i) => i.productoId === productoId);
    if (item && item.cantidad > 1) useCartStore.getState().updateCantidad(productoId, item.cantidad - 1);
  };

  const doRealizarPedido = async () => {
    const currentItems = useCartStore.getState().items;
    if (currentItems.length === 0) return;
    setEnviando(true);
    setError(null);

    try {
      // 1. Validate stock (common to both flows)
      const stockResult = await pedidosApi.validarStock({ detalles: currentItems.map((i) => ({ producto_id: i.productoId, cantidad: i.cantidad })) });
      if (!stockResult.valido) { setStockWarnings(stockResult.detalles); setEnviando(false); return; }

      const direccionId = typeof direccionSelId === "number" ? direccionSelId : undefined;
      const subtotal = useCartStore.getState().getTotal();
      const costoEnvio = direccionId ? 50 : 0;

      // ── BRANCH: MercadoPago vs synchronous flows ──
      if (formaPago === "MERCADOPAGO") {
        // ── POST-PAGO FLOW ──
        // No Pedido created yet. Cart survives redirect.
        const initData: InitFromCartRequest = {
          forma_pago_codigo: "MERCADOPAGO",
          subtotal: subtotal,
          descuento: 0,
          costo_envio: costoEnvio,
          direccion_id: direccionId ?? null,
          items: currentItems.map((i) => ({
            producto_id: i.productoId,
            nombre: i.nombre,
            precio: Number(i.precio),
            cantidad: i.cantidad,
            ingredientes_excluidos: i.ingredientesExcluidos,
          })),
        };

        try {
          const paymentResult = await pagosApi.initFromCart(initData);
          if (paymentResult.init_point && paymentResult.init_point.startsWith("https://")) {
            // Cart is NOT cleared — it survives the redirect
            // The WebSocket pago_confirmado event will clear it later
            window.location.href = paymentResult.init_point;
          } else {
            // init_point is null — MP API failure
            setMensaje({
              tipo: 'error',
              texto: 'Servicio de pago no disponible. Intente nuevamente.',
            });
            setEnviando(false);
          }
        } catch {
          setMensaje({
            tipo: 'error',
            texto: 'No se pudo conectar con el servicio de pago. Intente nuevamente desde el carrito.',
          });
          setEnviando(false);
        }
      } else {
        // ── SYNCHRONOUS FLOW (PAGO_LOCAL, EFECTIVO) ──
        const pedido = await pedidosApi.create({
          forma_pago_codigo: formaPago,
          subtotal: subtotal,
          descuento: 0,
          costo_envio: costoEnvio,
          direccion_id: direccionId,
          detalles: currentItems.map((i) => ({
            producto_id: i.productoId,
            cantidad: i.cantidad,
            nombre_snapshot: i.nombre,
            precio_snapshot: i.precio,
            ...(i.ingredientesExcluidos.length > 0 ? { personalizacion: i.ingredientesExcluidos } : {}),
          })),
        });

        useCartStore.getState().clearCarrito();
        setMensaje({ tipo: 'exito', texto: 'Pedido confirmado. Retire en el local cuando este listo.' });
        setTimeout(() => navigate("/pedidos"), 1500);
      }
    } catch (e) {
      if (e instanceof AxiosError && e.response?.status === 409) {
        const body = e.response.data as Record<string, unknown>;
        const detail = body?.detail as Record<string, unknown> | undefined;
        if (detail?.error === "stock_insuficiente" && Array.isArray(detail?.detalles)) {
          setStockWarnings(detail.detalles as ValidarStockDetalle[]);
          setEnviando(false);
          return;
        }
      }
      if (e instanceof AxiosError && e.response?.data) {
        const data = e.response.data as Record<string, unknown>;
        const detail = data.detail;
        if (typeof detail === 'string') setError(detail);
        else if (typeof detail === 'object') {
          const obj = detail as Record<string, unknown>;
          if (obj.mensaje && typeof obj.mensaje === 'string') setError(obj.mensaje);
          else if (obj.detalles && Array.isArray(obj.detalles)) setError('No hay stock suficiente para completar el pedido.');
          else setError('Error al procesar el pedido. Verifique los datos.');
        } else if (typeof data.message === "string") setError(data.message);
        else setError((e as Error).message);
      } else setError((e as Error).message);
      setEnviando(false);
    } finally {
      if (formaPago === "MERCADOPAGO") {
        // For MP flow: if we haven't redirected yet, keep enviando true
        // (the page will redirect or show message)
      } else {
        setEnviando(false);
      }
    }
  };

  const handleRealizarPedido = () => doRealizarPedido();

  const handleStockAdjust = (ajustes: Record<string, number>) => {
    for (const [key, nuevaCantidad] of Object.entries(ajustes)) {
      const productoId = Number(key);
      if (nuevaCantidad <= 0) useCartStore.getState().removeFromCart(productoId);
      else useCartStore.getState().updateCantidad(productoId, nuevaCantidad);
    }
    setStockWarnings(null);
    if (useCartStore.getState().items.length > 0) doRealizarPedido();
  };

  const handleCrearDireccion = async (data: DireccionEntregaInput) => {
    const nueva = await direccionesApi.create(data);
    setDireccionSelId(nueva.id);
  };

  const total = useCartStore((s) => s.getTotal());
  const itemCount = useCartStore((s) => s.getItemCount());

  const buttonText = () => {
    if (enviando && formaPago === "MERCADOPAGO") return "Redirigiendo a MercadoPago...";
    if (enviando) return "Creando pedido...";
    if (formaPago === "MERCADOPAGO") return "Pagar con MercadoPago";
    return "Realizar Pedido";
  };

  if (items.length === 0) {
    return (
      <div className="p-4 text-center">
        <h1 className="text-2xl font-bold mb-4">Carrito</h1>
        <p className="text-gray-500 mb-4">El carrito esta vacio</p>
        <Link to="/productos" className="inline-block bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700">Ver Productos</Link>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Carrito ({itemCount} productos)</h1>

      {mensaje && <div className={`p-3 mb-4 rounded border ${mensaje.tipo === 'exito' ? 'bg-green-100 text-green-800 border-green-400' : 'bg-red-100 text-red-800 border-red-400'}`}>{mensaje.texto}</div>}
      {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded mb-4">Error al crear pedido: {error}</div>}

      <table className="w-full border-collapse border mb-4">
        <thead><tr className="bg-gray-200">
          <th className="border p-2 text-left">Producto</th>
          <th className="border p-2 text-left">Precio Unitario</th>
          <th className="border p-2 text-center">Cantidad</th>
          <th className="border p-2 text-left">Total</th>
          <th className="border p-2 text-left">Acciones</th>
        </tr></thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.productoId} className="hover:bg-gray-100 border-b">
              <td className="p-2">
                <div>{item.nombre}</div>
                {ingredientesPorProducto[item.productoId]?.length > 0 && (
                  <div className="mt-1 space-y-1">
                    {ingredientesPorProducto[item.productoId].map((ing) => (
                      <label key={ing.ingrediente_id} className="flex items-center gap-1 text-xs text-gray-600">
                        <input type="checkbox" checked={!item.ingredientesExcluidos.includes(ing.ingrediente_id)} onChange={() => {
                          const excluidos = item.ingredientesExcluidos.includes(ing.ingrediente_id) ? item.ingredientesExcluidos.filter(id => id !== ing.ingrediente_id) : [...item.ingredientesExcluidos, ing.ingrediente_id];
                          useCartStore.getState().setIngredientesExcluidos(item.productoId, excluidos);
                        }} className="cursor-pointer" /> {ing.ingrediente_nombre}
                      </label>
                    ))}
                  </div>
                )}
              </td>
              <td className="p-2">${Number(item.precio).toFixed(2)}</td>
              <td className="p-2 text-center">
                <span className="inline-flex items-center gap-1">
                  <button onClick={() => handleDecrement(item.productoId)} disabled={item.cantidad <= 1} className="border border-gray-400 bg-white text-gray-700 hover:bg-gray-100 text-sm w-7 h-7 flex items-center justify-center rounded cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">-</button>
                  <span className="w-8 text-center font-mono font-semibold">{item.cantidad}</span>
                  <button onClick={() => handleIncrement(item.productoId)} className="border border-gray-400 bg-white text-gray-700 hover:bg-gray-100 text-sm w-7 h-7 flex items-center justify-center rounded cursor-pointer">+</button>
                </span>
              </td>
              <td className="p-2 font-mono font-semibold">${(Number(item.precio) * item.cantidad).toFixed(2)}</td>
              <td className="p-2">
                <button onClick={() => handleRemove(item.productoId)} className="bg-red-600 text-white px-3 py-1 rounded text-sm cursor-pointer hover:bg-red-700">Quitar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="border-t pt-4 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Direccion de entrega</h2>
        {loadingDirs ? (
          <p className="text-sm text-gray-400">Cargando direcciones...</p>
        ) : (
          <div className="flex items-center gap-2">
            <select value={direccionSelId === null ? "retiro" : direccionSelId} onChange={(e) => {
              const val = e.target.value;
              if (val === "nueva") setShowNewDir(true);
              else if (val === "retiro") setDireccionSelId(null);
              else setDireccionSelId(val ? Number(val) : null);
            }} className="border border-gray-300 rounded px-3 py-2 text-sm flex-1 max-w-md">
              <option value="retiro">Retirar en el local mas cercano (gratis)</option>
              {direcciones.length > 0 && (
                <optgroup label="--- Tus direcciones ---">
                  {direcciones.map((d) => (<option key={d.id} value={d.id}>{formatDireccion(d)}{d.es_principal ? " (Principal)" : ""}</option>))}
                </optgroup>
              )}
              <option value="nueva" disabled={direcciones.length >= 10}>+ Agregar nueva direccion</option>
            </select>
            {direccionSelId === null ? <span className="text-xs text-green-600 font-medium whitespace-nowrap">Retiro en local (gratis)</span> : <span className="text-xs text-blue-600 font-medium whitespace-nowrap">Con envio (+$50.00)</span>}
          </div>
        )}
      </div>

      <div className="border-t pt-4 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Metodo de pago</h2>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="formaPago" value="PAGO_LOCAL" checked={formaPago === "PAGO_LOCAL"} onChange={() => { setFormaPago("PAGO_LOCAL"); setDireccionSelId(null); }} className="cursor-pointer" />
            <span className="text-sm">Pago y retiro en local</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="formaPago" value="MERCADOPAGO" checked={formaPago === "MERCADOPAGO"} onChange={() => setFormaPago("MERCADOPAGO")} className="cursor-pointer" />
            <span className="text-sm">MercadoPago (tarjeta/debito)</span>
          </label>
        </div>
      </div>

      <div className="border-t pt-4 flex justify-between items-center">
        <div className="text-xl font-bold">
          Subtotal: <span className="text-blue-700">${total.toFixed(2)}</span>
          {direccionSelId && typeof direccionSelId === "number" && <span className="text-base font-normal text-gray-500 ml-2">(+ $50.00 envio)</span>}
        </div>
        <button onClick={handleRealizarPedido} disabled={enviando} className="bg-green-700 text-white px-6 py-2 rounded text-lg font-semibold cursor-pointer hover:bg-green-800 disabled:opacity-60 disabled:cursor-not-allowed">
          {buttonText()}
        </button>
      </div>

      {stockWarnings && <StockWarningModal detalles={stockWarnings} onAdjust={handleStockAdjust} onClose={() => setStockWarnings(null)} />}
      {showNewDir && <NuevaDireccionModal onClose={() => setShowNewDir(false)} onSave={handleCrearDireccion} />}
    </div>
  );
}
