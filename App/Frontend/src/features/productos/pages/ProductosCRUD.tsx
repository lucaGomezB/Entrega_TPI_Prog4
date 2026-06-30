/**
 * ProductosCRUD — Product management page with role-based views.
 *
 * Roles and what they see:
 *   - admin:   full CRUD + category/ingredient management + variant bulk creation.
 *   - stock:   stock-only editing (quantity, availability toggle).
 *   - pedidos: full view but no create/delete (mid-level access).
 *   - client:  read-only menu view with "Agregar al carrito" button.
 *
 * State management: TanStack Query for products, TanStack Form for create/edit.
 * Uses DataTable with server-side pagination.
 */
import { useCallback, useEffect, useState, useRef } from "react";
import { useAppForm } from "@/shared/hooks/useAppForm";
import type { Producto, ProductoCreate, ProductoIngredienteRead, ProductoCategoriaRead } from "@/features/productos/api/productos";
import { productosApi } from "@/features/productos/api/productos";
import type { Ingrediente } from "@/features/productos/api/ingredientes";
import { ingredientesApi } from "@/features/productos/api/ingredientes";
import type { Categoria } from "@/features/categorias/api/categorias";
import { categoriasApi } from "@/features/categorias/api/categorias";
import { unidadesMedidaApi } from "@/features/unidades-medida/api/unidadesMedidaApi";
import type { UnidadMedida } from "@/features/unidades-medida/api/unidadesMedidaApi";
import { useProductos, useCreateProducto, useUpdateProducto, useDeleteProducto } from "@/features/productos/hooks/useProductos";
import ImageCarousel from "@/shared/components/ImageCarousel";
import { addToast } from "@/shared/components/Toast";
import Modal from "@/shared/components/Modal";
import DataTable, { type DataTableColumn } from "@/shared/components/DataTable";
import { useNavigate } from "react-router-dom";
import { exportToExcel } from "@/shared/utils/exportExcel";
import { useCartStore } from "@/shared/store/cartStore";
import { AxiosError } from "axios";
import { getAccessToken } from "@/shared/api/client";
import SearchFilter from "@/shared/components/SearchFilter";
import { usePagination } from "@/shared/hooks/usePagination";
import ErrorBanner from "@/shared/components/ErrorBanner";
import { EditButton, DeleteButton } from "@/shared/components/ActionButton";
import FormFooter from "@/shared/components/FormFooter";
import { useCloudinaryUpload } from "@/shared/hooks/useCloudinaryUpload";

const DEFAULT_LIMIT = 10;

/* ── Selector de Categorias (para creacion) ── */

function CategoriaSelector({ allCategorias, selectedIds, onSelect, onClose }: {
  allCategorias: Categoria[]; selectedIds: number[]; onSelect: (ids: number[]) => void; onClose: () => void;
}) {
  const [localSelected, setLocalSelected] = useState<number[]>(selectedIds);

  const toggleCategory = (id: number) => {
    setLocalSelected(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const handleConfirm = () => {
    onSelect(localSelected);
    onClose();
  };

  return (
    <Modal open={true} onClose={onClose} title="Seleccionar Categorias" maxWidth="max-w-2xl">
      <table className="w-full border-collapse border mb-4">
          <thead><tr className="bg-gray-200">
            <th className="border p-2 text-left">Seleccionar</th>
            <th className="border p-2 text-left">Nombre</th>
            <th className="border p-2 text-left">Descripcion</th>
          </tr></thead>
          <tbody>
            {allCategorias.map((cat) => (
              <tr key={cat.id}>
                <td className="border p-2">
                  <input type="checkbox" checked={localSelected.includes(cat.id)} onChange={() => toggleCategory(cat.id)} />
                </td>
                <td className="border p-2">{cat.nombre}</td>
                <td className="border p-2">{cat.descripcion ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex gap-2">
          <button onClick={handleConfirm} className="bg-blue-600 text-white px-4 py-1 rounded cursor-pointer">Confirmar</button>
          <button onClick={onClose} className="bg-gray-400 text-white px-4 py-1 rounded cursor-pointer">Cancelar</button>
        </div>
    </Modal>
  );
}

/* ── Selector de Ingredientes (para creacion) ── */

type SelectedIngredientItem = { id: number; cantidad: number; unidad_medida_id?: number | null };

function IngredienteSelector({ allIngredientes, unidades, selected, onSelect, onClose }: {
  allIngredientes: Ingrediente[];
  unidades: UnidadMedida[];
  selected: SelectedIngredientItem[];
  onSelect: (items: SelectedIngredientItem[]) => void;
  onClose: () => void;
}) {
  const [localSelected, setLocalSelected] = useState<SelectedIngredientItem[]>(selected);

  const toggleIngredient = (id: number) => {
    setLocalSelected(prev =>
      prev.some(s => s.id === id)
        ? prev.filter(s => s.id !== id)
        : [...prev, { id, cantidad: 1, unidad_medida_id: null }]
    );
  };

  const handleConfirm = () => {
    onSelect(localSelected);
    onClose();
  };

  return (
    <Modal open={true} onClose={onClose} title="Seleccionar Ingredientes" maxWidth="max-w-3xl">
      <table className="w-full border-collapse border mb-4">
          <thead><tr className="bg-gray-200">
            <th className="border p-2 text-left">Sel.</th>
            <th className="border p-2 text-left">Nombre</th>
            <th className="border p-2 text-left">Alerg.</th>
            <th className="border p-2 text-left">Precio</th>
            <th className="border p-2 text-left">Stock</th>
            <th className="border p-2 text-left">Cantidad</th>
            <th className="border p-2 text-left">Max Prod.</th>
          </tr></thead>
          <tbody>
            {allIngredientes.map((ing) => {
              const sel = localSelected.find(s => s.id === ing.id);
              return (
              <tr key={ing.id}>
                <td className="border p-2">
                  <input type="checkbox" checked={!!sel} onChange={() => toggleIngredient(ing.id)} />
                </td>
                <td className="border p-2">{ing.nombre}</td>
                <td className="border p-2">{ing.es_alergeno ? "Si" : "No"}</td>
                <td className="border p-2">${Number(ing.precio_actual).toFixed(2)}</td>
                <td className="border p-2">
                  {ing.stock_actual}{ing.unidad_medida_simbolo ? ` ${ing.unidad_medida_simbolo}` : ""}
                </td>
                <td className="border p-2">
                  {sel && (
                    <span className="inline-flex items-center gap-1">
                      <input type="number" step="0.001" min="0.001"
                        value={sel.cantidad}
                        onChange={(e) => {
                          const newCant = Number(e.target.value) || 0.001;
                          setLocalSelected(prev =>
                            prev.map(s => s.id === ing.id ? { ...s, cantidad: newCant } : s)
                          );
                        }}
                        className="border px-2 py-1 rounded w-16" />
                      <select
                        value={sel.unidad_medida_id ?? ""}
                        onChange={(e) => {
                          const val = e.target.value ? Number(e.target.value) : null;
                          setLocalSelected(prev =>
                            prev.map(s => s.id === ing.id ? { ...s, unidad_medida_id: val } : s)
                          );
                        }}
                        className="border px-1 py-1 rounded text-xs"
                      >
                        <option value="">--</option>
                        {unidades.map((u) => (
                          <option key={u.id} value={u.id}>{u.simbolo}</option>
                        ))}
                      </select>
                    </span>
                  )}
                </td>
                <td className="border p-2">
                  {sel ? Math.floor(ing.stock_actual / sel.cantidad) : "-"}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex gap-2">
          <button onClick={handleConfirm} className="bg-blue-600 text-white px-4 py-1 rounded cursor-pointer">Confirmar</button>
          <button onClick={onClose} className="bg-gray-400 text-white px-4 py-1 rounded cursor-pointer">Cancelar</button>
        </div>
    </Modal>
  );
}

/* ── Popup de Ingredientes ── */

function IngredientesPopup({ productoId, productoNombre, unidades, onClose, onIngredientsChange }: {
  productoId: number; productoNombre: string; unidades: UnidadMedida[]; onClose: () => void;
  onIngredientsChange?: (ings: { ingrediente_id: number; cantidad: number; unidad_medida_id?: number | null }[]) => void;
}) {
  const [ings, setIngs] = useState<ProductoIngredienteRead[]>([]);
  const [allIngs, setAllIngs] = useState<Ingrediente[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<number | null>(null);
  const [addForm, setAddForm] = useState({ ingrediente_id: 0, cantidad: 1, es_removible: true, es_principal: false, orden: 0, unidad_medida_id: null as number | null });
  const [showAdd, setShowAdd] = useState(false);
  const [updatingCantidad, setUpdatingCantidad] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [prodIngs, available] = await Promise.all([
      productosApi.getIngredientes(productoId),
      ingredientesApi.getAll(0, 1000),
    ]);
    setIngs(prodIngs);
    setAllIngs(available);
    setLoading(false);
  }, [productoId]);

  const refresh = useCallback(async () => {
    const [prodIngs, available] = await Promise.all([
      productosApi.getIngredientes(productoId),
      ingredientesApi.getAll(0, 1000),
    ]);
    setIngs(prodIngs);
    setAllIngs(available);
    if (onIngredientsChange) {
      onIngredientsChange(prodIngs.map(ing => ({
        ingrediente_id: ing.ingrediente_id,
        cantidad: ing.cantidad,
        unidad_medida_id: ing.unidad_medida_id ?? null,
      })));
    }
  }, [productoId, onIngredientsChange]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!addForm.ingrediente_id) return;
    try {
      await productosApi.addIngrediente(productoId, addForm);
      setShowAdd(false);
      setAddForm({ ingrediente_id: 0, cantidad: 1, es_removible: true, es_principal: false, orden: 0, unidad_medida_id: null });
      await refresh();
      addToast('exito', 'Ingrediente agregado correctamente');
    } catch {
      addToast('error', 'Error al agregar ingrediente');
    }
  };

  const handleCantidadChange = async (ingredienteId: number, newCantidad: number, unidadMedidaId?: number | null) => {
    if (newCantidad <= 0) return;
    setUpdatingCantidad(ingredienteId);
    const updatedIngs = ings.map(ing =>
      ing.ingrediente_id === ingredienteId
        ? { ...ing, cantidad: newCantidad }
        : ing
    );
    setIngs(updatedIngs);
    try {
      await productosApi.updateIngredienteCantidad(productoId, ingredienteId, newCantidad, unidadMedidaId);
      notifyIngredientsChanged(updatedIngs);
    } catch {
      refresh();
    } finally {
      setUpdatingCantidad(null);
    }
  };

  const handleRemove = async (ingredienteId: number) => {
    if (!confirm("Quitar este ingrediente?")) return;
    try {
      await productosApi.removeIngrediente(productoId, ingredienteId);
      await refresh();
      addToast('exito', 'Ingrediente quitado correctamente');
    } catch {
      addToast('error', 'Error al quitar ingrediente');
    }
  };

  const notifyIngredientsChanged = (currentIngs: ProductoIngredienteRead[]) => {
    if (onIngredientsChange) {
      onIngredientsChange(currentIngs.map(ing => ({
        ingrediente_id: ing.ingrediente_id,
        cantidad: ing.cantidad,
        unidad_medida_id: ing.unidad_medida_id ?? null,
      })));
    }
  };

  const handleToggleAlergeno = async (ingredienteId: number, currentValue: boolean) => {
    setToggling(ingredienteId);
    try {
      await ingredientesApi.update(ingredienteId, { es_alergeno: !currentValue });
      await refresh();
    } catch (err) {
      console.error("[alergeno-toggle] Error al cambiar alergeno:", err);
      alert("Error al cambiar alergeno. Revisa que tengas permisos de administrador o stock.");
    } finally {
      setToggling(null);
    }
  };

  const handleToggleRemovible = async (ingredienteId: number, newValue: boolean, cantidad: number) => {
    setToggling(ingredienteId);
    try {
      const updated = await productosApi.toggleIngredienteFlag(productoId, ingredienteId, "es_removible", newValue, cantidad);
      setIngs(updated);
      notifyIngredientsChanged(updated);
    } catch (err) {
      console.error("[removible-toggle] Error:", err);
      alert("Error al cambiar. Revisa que tengas permisos de administrador o stock.");
    } finally {
      setToggling(null);
    }
  };

  const handleTogglePrincipal = async (ingredienteId: number, newValue: boolean, cantidad: number) => {
    setToggling(ingredienteId);
    try {
      const updated = await productosApi.toggleIngredienteFlag(productoId, ingredienteId, "es_principal", newValue, cantidad);
      setIngs(updated);
      notifyIngredientsChanged(updated);
    } catch (err) {
      console.error("[principal-toggle] Error:", err);
      alert("Error al cambiar. Revisa que tengas permisos de administrador o stock.");
    } finally {
      setToggling(null);
    }
  };

  const getIngInfo = (ingredienteId: number) =>
    allIngs.find((i) => i.id === ingredienteId);

  const availableIngs = allIngs.filter(
    (ai) => !ings.some((i) => i.ingrediente_id === ai.id)
  );

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Ingredientes de "${productoNombre}"`}
      maxWidth="max-w-2xl"
      footer={
        showAdd ? (
          <>
            <button onClick={handleAdd} className="bg-blue-600 text-white px-4 py-1 rounded cursor-pointer">Confirmar</button>
            <button onClick={() => setShowAdd(false)} className="bg-gray-400 text-white px-4 py-1 rounded cursor-pointer">Cancelar</button>
          </>
        ) : undefined
      }
    >
        {loading ? <p>Cargando...</p> : (
          <>
            {ings.length === 0 ? (
              <p className="text-gray-500 mb-4">Sin ingredientes asignados.</p>
            ) : (
              <table className="w-full border-collapse border mb-4">
                <thead><tr className="bg-gray-200">
                  <th className="border p-2 text-left">Ingrediente</th>
                  <th className="border p-2 text-left">Cantidad</th>
                  <th className="border p-2 text-left">Unidad</th>
                  <th className="border p-2 text-left">Costo</th>
                  <th className="border p-2 text-left">Alergeno</th>
                  <th className="border p-2 text-left">Removible</th>
                  <th className="border p-2 text-left">Principal</th>
                  <th className="border p-2 text-left">Acciones</th>
                </tr></thead>
                <tbody>
                  {(() => {
                    const totalCalculado = ings.reduce((sum, ing) => {
                      const info = getIngInfo(ing.ingrediente_id);
                      const precio = info?.precio_actual ?? 0;
                      return sum + Number(precio) * Number(ing.cantidad);
                    }, 0);
                    return (
                      <>
                        {ings.map((ing) => {
                          const info = getIngInfo(ing.ingrediente_id);
                          const isAlergeno = info?.es_alergeno ?? false;
                          const precioIng = info?.precio_actual ?? 0;
                          const cost = Number(precioIng) * Number(ing.cantidad);
                          return (
                            <tr key={ing.ingrediente_id}>
                              <td className="border p-2">{ing.ingrediente_nombre}</td>
                              <td className="border p-2">
                                <span className="inline-flex items-center gap-1">
                                  <input type="number" step="0.001" min="0.001"
                                    value={ing.cantidad}
                                    disabled={updatingCantidad === ing.ingrediente_id}
                                    onChange={(e) => handleCantidadChange(ing.ingrediente_id, Number(e.target.value) || 0.001, ing.unidad_medida_id)}
                                    className="border px-2 py-1 rounded w-20" />
                                </span>
                              </td>
                              <td className="border p-2 text-sm text-gray-600">
                                {ing.unidad_medida_simbolo ?? "—"}
                              </td>
                              <td className="border p-2 font-mono">
                                ${cost.toFixed(2)}
                              </td>
                              <td className="border p-2">
                                <span className="inline-flex items-center gap-1">
                                  <span className={isAlergeno ? "text-red-600 font-medium" : "text-gray-500"}>
                                    {isAlergeno ? "Si" : "No"}
                                  </span>
                                  <button
                                    onClick={() => handleToggleAlergeno(ing.ingrediente_id, isAlergeno)}
                                    disabled={toggling === ing.ingrediente_id}
                                    className="text-xs border border-gray-400 rounded px-1.5 py-0.5 hover:bg-gray-100 cursor-pointer disabled:opacity-50"
                                    title={isAlergeno ? "Marcar como no alergeno" : "Marcar como alergeno"}
                                  >
                                    {toggling === ing.ingrediente_id ? "..." : "Cambiar"}
                                  </button>
                                </span>
                              </td>
                              <td className="border p-2">
                                <span className="inline-flex items-center gap-1">
                                  <span className={ing.es_removible ? "text-green-600 font-medium" : "text-gray-500"}>
                                    {ing.es_removible ? "Si" : "No"}
                                  </span>
                                  <button
                                    onClick={() => handleToggleRemovible(ing.ingrediente_id, !ing.es_removible, ing.cantidad)}
                                    disabled={toggling === ing.ingrediente_id}
                                    className="text-xs border border-gray-400 rounded px-1.5 py-0.5 hover:bg-gray-100 cursor-pointer disabled:opacity-50"
                                  >
                                    {toggling === ing.ingrediente_id ? "..." : "Cambiar"}
                                  </button>
                                </span>
                              </td>
                              <td className="border p-2">
                                <span className="inline-flex items-center gap-1">
                                  <span className={ing.es_principal ? "text-blue-600 font-medium" : "text-gray-500"}>
                                    {ing.es_principal ? "Si" : "No"}
                                  </span>
                                  <button
                                    onClick={() => handleTogglePrincipal(ing.ingrediente_id, !ing.es_principal, ing.cantidad)}
                                    disabled={toggling === ing.ingrediente_id}
                                    className="text-xs border border-gray-400 rounded px-1.5 py-0.5 hover:bg-gray-100 cursor-pointer disabled:opacity-50"
                                  >
                                    {toggling === ing.ingrediente_id ? "..." : "Cambiar"}
                                  </button>
                                </span>
                              </td>
                              <td className="border p-2">
                                <button onClick={() => handleRemove(ing.ingrediente_id)}
                                  className="bg-red-600 text-white px-2 py-1 rounded text-sm cursor-pointer hover:bg-red-700">Quitar</button>
                              </td>
                            </tr>
                          );
                        })}
                        {ings.length > 0 && (
                          <tr className="bg-gray-100 font-semibold">
                            <td colSpan={2} className="border p-2 text-right">Costo total calculado:</td>
                            <td className="border p-2"></td>
                            <td className="border p-2 font-mono">${totalCalculado.toFixed(2)}</td>
                            <td colSpan={4} className="border p-2"></td>
                          </tr>
                        )}
                      </>
                    );
                  })()}
                </tbody>
              </table>
            )}

            {!showAdd ? (
              <button onClick={() => setShowAdd(true)}
                className="bg-green-600 text-white px-4 py-1 rounded cursor-pointer hover:bg-green-700">+ Agregar Ingrediente</button>
            ) : (
              <div className="border p-3 rounded bg-gray-50">
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <div>
                    <label className="block text-sm font-medium">Ingrediente</label>
                    <select value={addForm.ingrediente_id}
                      onChange={(e) => setAddForm({ ...addForm, ingrediente_id: Number(e.target.value) })}
                      className="border px-2 py-1 rounded w-full">
                      <option value={0}>-- Seleccionar --</option>
                      {availableIngs.map((ai) => (
                        <option key={ai.id} value={ai.id}>{ai.nombre} (${Number(ai.precio_actual).toFixed(2)})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Cantidad</label>
                    <span className="inline-flex gap-1">
                      <input type="number" step="0.001" min="0.001" value={addForm.cantidad}
                        onChange={(e) => setAddForm({ ...addForm, cantidad: Number(e.target.value) || 0.001 })}
                        className="border px-2 py-1 rounded w-20" />
                      <select
                        value={addForm.unidad_medida_id ?? ""}
                        onChange={(e) => setAddForm({ ...addForm, unidad_medida_id: e.target.value ? Number(e.target.value) : null })}
                        className="border px-1 py-1 rounded text-sm flex-1"
                      >
                        <option value="">--</option>
                        {unidades.map((u) => (
                          <option key={u.id} value={u.id}>{u.simbolo}</option>
                        ))}
                      </select>
                    </span>
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Orden</label>
                    <input type="number" value={addForm.orden}
                      onChange={(e) => setAddForm({ ...addForm, orden: Number(e.target.value) })}
                      className="border px-2 py-1 rounded w-full" />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm">Removible</label>
                    <input type="checkbox" checked={addForm.es_removible}
                      onChange={(e) => setAddForm({ ...addForm, es_removible: e.target.checked })} />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm">Principal</label>
                    <input type="checkbox" checked={addForm.es_principal}
                      onChange={(e) => setAddForm({ ...addForm, es_principal: e.target.checked })} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleAdd}
                    className="bg-blue-600 text-white px-4 py-1 rounded cursor-pointer">Confirmar</button>
                  <button onClick={() => setShowAdd(false)}
                    className="bg-gray-400 text-white px-4 py-1 rounded cursor-pointer">Cancelar</button>
                </div>
              </div>
            )}
          </>
        )}
    </Modal>
  );
}

/* ── Popup de Categorias ── */

function CategoriasPopup({ productoId, productoNombre, onClose }: {
  productoId: number; productoNombre: string; onClose: () => void;
}) {
  const [cats, setCats] = useState<ProductoCategoriaRead[]>([]);
  const [allCats, setAllCats] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ categoria_id: 0, es_principal: false });

  const load = useCallback(async () => {
    setLoading(true);
    const [prodCats, available] = await Promise.all([
      productosApi.getCategorias(productoId),
      categoriasApi.getAll(0, 1000),
    ]);
    setCats(prodCats);
    setAllCats(available);
    setLoading(false);
  }, [productoId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!addForm.categoria_id) return;
    try {
      await productosApi.addCategoria(productoId, addForm);
      setShowAdd(false);
      setAddForm({ categoria_id: 0, es_principal: false });
      load();
      addToast('exito', 'Categoria agregada correctamente');
    } catch {
      addToast('error', 'Error al agregar la categoria. Verifique los datos.');
    }
  };

  const handleRemove = async (categoriaId: number) => {
    if (!confirm("Quitar esta categoria?")) return;
    try {
      await productosApi.removeCategoria(productoId, categoriaId);
      load();
      addToast('exito', 'Categoria quitada correctamente');
    } catch {
      addToast('error', 'Error al quitar la categoria');
    }
  };

  const availableCats = allCats.filter(
    (ac) => !cats.some((c) => c.categoria_id === ac.id)
  );

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Categorias de "${productoNombre}"`}
      maxWidth="max-w-lg"
      footer={
        showAdd ? (
          <>
            <button onClick={handleAdd} className="bg-blue-600 text-white px-4 py-1 rounded cursor-pointer">Confirmar</button>
            <button onClick={() => setShowAdd(false)} className="bg-gray-400 text-white px-4 py-1 rounded cursor-pointer">Cancelar</button>
          </>
        ) : undefined
      }
    >
        {loading ? <p>Cargando...</p> : (
          <>
            {cats.length === 0 ? (
              <p className="text-gray-500 mb-4">Sin categorias asignadas.</p>
            ) : (
              <table className="w-full border-collapse border mb-4">
                <thead><tr className="bg-gray-200">
                  <th className="border p-2 text-left">Categoria</th>
                  <th className="border p-2 text-left">Principal</th>
                  <th className="border p-2 text-left">Acciones</th>
                </tr></thead>
                <tbody>
                  {cats.map((c) => (
                    <tr key={c.categoria_id}>
                      <td className="border p-2">{c.categoria_nombre}</td>
                      <td className="border p-2">{c.es_principal ? "Si" : "No"}</td>
                      <td className="border p-2">
                        <button onClick={() => handleRemove(c.categoria_id)}
                          className="bg-red-600 text-white px-2 py-1 rounded text-sm cursor-pointer">Quitar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {!showAdd ? (
              <button onClick={() => setShowAdd(true)}
                className="bg-green-600 text-white px-4 py-1 rounded cursor-pointer">+ Agregar Categoria</button>
            ) : (
              <div className="border p-3 rounded bg-gray-50">
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <label className="block text-sm font-medium">Categoria</label>
                    <select value={addForm.categoria_id}
                      onChange={(e) => setAddForm({ ...addForm, categoria_id: Number(e.target.value) })}
                      className="border px-2 py-1 rounded w-full">
                      <option value={0}>-- Seleccionar --</option>
                      {availableCats.map((ac) => (
                        <option key={ac.id} value={ac.id}>{ac.nombre}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm">Principal</label>
                    <input type="checkbox" checked={addForm.es_principal}
                      onChange={(e) => setAddForm({ ...addForm, es_principal: e.target.checked })} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleAdd}
                    className="bg-blue-600 text-white px-4 py-1 rounded cursor-pointer">Confirmar</button>
                  <button onClick={() => setShowAdd(false)}
                    className="bg-gray-400 text-white px-4 py-1 rounded cursor-pointer">Cancelar</button>
                </div>
              </div>
            )}
          </>
        )}
    </Modal>
  );
}

/* ── Pagina principal ── */

export default function ProductosCRUD({ role = 'admin' }: { role?: 'admin' | 'stock' | 'pedidos' | 'client' }) {
  const navigate = useNavigate();
  const readOnly = role === 'client';
  const isStockMode = role === 'stock';
  const isAuth = !!getAccessToken();
  const hideCreate = role !== 'admin';
  const hideDelete = role === 'client' || role === 'stock';
  const hideCategoriasBtn = role === 'client' || role === 'stock';
  const hideExport = role === 'client' || role === 'stock';

  // ── UI-only state ──
  const [search, setSearch] = useState("");

  const { skip, limit, handlePageChange, handleLimitChange } = usePagination(DEFAULT_LIMIT);

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    handlePageChange(0);
  }, [handlePageChange]);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [stockEditOnly, setStockEditOnly] = useState(false);
  const [selectedCategorias, setSelectedCategorias] = useState<{id: number, nombre: string, descripcion: string | null}[]>([]);
  const [selectedIngredientes, setSelectedIngredientes] = useState<{id: number, nombre: string, es_alergeno: boolean, cantidad: number, unidad_medida_id?: number | null}[]>([]);
  const [showCategoriaSelector, setShowCategoriaSelector] = useState(false);
  const [showIngredienteSelector, setShowIngredienteSelector] = useState(false);
  const [ingPopup, setIngPopup] = useState<{ id: number; nombre: string } | null>(null);
  const [catPopup, setCatPopup] = useState<{ id: number; nombre: string } | null>(null);
  const [pendingIngredientesUpdate, setPendingIngredientesUpdate] = useState<{ ingrediente_id: number; cantidad: number; unidad_medida_id?: number | null }[] | null>(null);
  const [recentlyAdded, setRecentlyAdded] = useState<Set<number>>(new Set());
  const addTimerRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // Cloudinary Upload Widget state (managed by shared hook)
  const [imagenPublicIds, setImagenPublicIds] = useState<string[]>([]);

  // ── TanStack Query: products (paginated) ──
  const { data, isLoading, isError, error } = useProductos(skip, limit, search || undefined);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  // ── Categories and ingredients for selectors (fetch all, not paginated) ──
  const [allCats, setAllCats] = useState<Categoria[]>([]);
  const [allIngs, setAllIngs] = useState<Ingrediente[]>([]);

  useEffect(() => {
    categoriasApi.getAll(0, 1000).then(setAllCats).catch(() => {});
    ingredientesApi.getAll(0, 1000).then(setAllIngs).catch(() => {});
  }, []);

  // ── TanStack Query mutations ──
  const createMutation = useCreateProducto();
  const updateMutation = useUpdateProducto();
  const deleteMutation = useDeleteProducto();

  // ── UnidadMedida state (fetched once for dropdowns) ──
  const [unidades, setUnidades] = useState<UnidadMedida[]>([]);

  useEffect(() => {
    unidadesMedidaApi.getAll().then(setUnidades).catch(() => {});
  }, []);

  const extractPublicId = (url: string): string => {
    try {
      const parts = url.split("/");
      const last = parts[parts.length - 1];
      const dotIdx = last.lastIndexOf(".");
      return dotIdx >= 0 ? last.substring(0, dotIdx) : last;
    } catch {
      return url;
    }
  };

  const handleAddToCart = (prod: Producto) => {
    useCartStore.getState().addToCart(prod.id, prod.nombre, Number(prod.precio_actual));
    triggerFeedback(prod.id);
  };

  const triggerFeedback = (productoId: number) => {
    setRecentlyAdded((prev) => new Set(prev).add(productoId));
    const existingTimer = addTimerRef.current.get(productoId);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      setRecentlyAdded((prev) => {
        const next = new Set(prev);
        next.delete(productoId);
        return next;
      });
      addTimerRef.current.delete(productoId);
    }, 1200);
    addTimerRef.current.set(productoId, timer);
  };

  // Cloudinary Upload Widget (shared hook, multiple mode)
  const { abrirWidget, eliminarImagen, uploadingImages } = useCloudinaryUpload("multiple");

  const handleDeleteImagen = async (publicId: string) => {
    await eliminarImagen(publicId);
    const idx = imagenPublicIds.indexOf(publicId);
    if (idx >= 0) {
      const currentUrls = form.getFieldValue("imagenes_url") ?? [];
      const newUrls = [...currentUrls];
      newUrls.splice(idx, 1);
      form.setFieldValue("imagenes_url", newUrls);
      setImagenPublicIds((prev) => prev.filter((id) => id !== publicId));
    }
  };

  // Load selected categories and ingredients when editing an existing product
  useEffect(() => {
    if (editingId) {
      Promise.all([
        productosApi.getCategorias(editingId),
        productosApi.getIngredientes(editingId),
      ]).then(([cats, ings]) => {
        setSelectedCategorias(cats.map(c => ({ id: c.categoria_id, nombre: c.categoria_nombre, descripcion: null })));
        const selectedIngs = ings.map(i => {
          const ing = allIngs.find(ai => ai.id === i.ingrediente_id);
          return { id: i.ingrediente_id, nombre: i.ingrediente_nombre, es_alergeno: ing ? ing.es_alergeno : false, cantidad: i.cantidad ?? 1 };
        });
        setSelectedIngredientes(selectedIngs);
      });
    }
  }, [editingId, allIngs]);

  // Sync calculated price from selected ingredients (create mode only)
  const precioCalculadoRef = useRef(0);
  useEffect(() => {
    if (!editingId && selectedIngredientes.length > 0) {
      const totalPrice = selectedIngredientes.reduce((sum, ing) => {
        const fullIng = allIngs.find(a => a.id === ing.id);
        return sum + Number(fullIng?.precio_actual ?? 0) * (ing.cantidad ?? 1);
      }, 0);
      precioCalculadoRef.current = totalPrice;
      form.setFieldValue('precio_base', totalPrice);
    }
  }, [selectedIngredientes, editingId, allIngs]);

  const form = useAppForm<ProductoCreate>({
    defaultValues: {
      nombre: "",
      descripcion: "",
      precio_base: 0,
      precio_actual: 0,
      receta: "",
      stock_cantidad: 0,
      tiempo_prep_min: 0,
      disponible: true,
      es_insumo: false,
      imagenes_url: [],
      categorias_ids: [],
      ingredientes: [],
      unidad_medida_id: 5,
    },
    onSubmit: async ({ value }: { value: ProductoCreate }) => {
      try {
        if (editingId) {
          if (stockEditOnly) {
            await updateMutation.mutateAsync({ id: editingId, data: {
              stock_cantidad: value.stock_cantidad,
              disponible: value.disponible,
              es_insumo: value.es_insumo,
              unidad_medida_id: value.unidad_medida_id,
            }});
          } else {
            const original = items.find(p => p.id === editingId);
            const changed: Record<string, unknown> = {};
            if (value.nombre !== original?.nombre) changed.nombre = value.nombre;
            if (value.descripcion !== (original?.descripcion ?? null)) changed.descripcion = value.descripcion;
            if (value.receta !== (original?.receta ?? null)) changed.receta = value.receta;
            if (Number(value.precio_base) !== Number(original?.precio_base ?? 0)) changed.precio_base = value.precio_base;
            if (Number(value.precio_actual) !== Number(original?.precio_actual ?? 0)) changed.precio_actual = value.precio_actual;
            if (Number(value.stock_cantidad) !== Number(original?.stock_cantidad ?? 0)) changed.stock_cantidad = value.stock_cantidad;
            if (value.disponible !== original?.disponible) changed.disponible = value.disponible;
            if (value.es_insumo !== original?.es_insumo) changed.es_insumo = value.es_insumo;
            if (JSON.stringify(value.imagenes_url) !== JSON.stringify(original?.imagenes_url ?? [])) {
              changed.imagenes_url = value.imagenes_url;
            }
            if (Number(value.tiempo_prep_min) !== Number(original?.tiempo_prep_min ?? 0)) changed.tiempo_prep_min = value.tiempo_prep_min;
            if (value.unidad_medida_id !== original?.unidad_medida_id) changed.unidad_medida_id = value.unidad_medida_id ?? null;
            if (pendingIngredientesUpdate) {
              changed.ingredientes = pendingIngredientesUpdate.map(pi => ({
                ingrediente_id: pi.ingrediente_id,
                cantidad: pi.cantidad,
                unidad_medida_id: pi.unidad_medida_id ?? null,
              }));
            }
            await updateMutation.mutateAsync({ id: editingId, data: changed });
          }
          addToast('exito', 'Producto actualizado correctamente');
        } else {
          if (!value.es_insumo && selectedIngredientes.length === 0 && Number(value.precio_base ?? 0) <= 0) {
            throw new Error("El precio base debe ser mayor a 0 cuando no hay ingredientes");
          }
          await createMutation.mutateAsync({
            ...value,
            precio_actual: value.precio_actual,
            es_insumo: value.es_insumo,
            categorias_ids: selectedCategorias.map(c => c.id),
            ingredientes: selectedIngredientes.map(i => ({
              ingrediente_id: i.id,
              cantidad: i.cantidad ?? 1,
              es_removible: true,
              es_principal: false,
              orden: 0,
              unidad_medida_id: i.unidad_medida_id ?? null,
            })),
            unidad_medida_id: value.unidad_medida_id || null,
          });
          addToast('exito', 'Producto creado correctamente');
        }
        handleCloseForm();
      } catch (err) {
        let msg = (err as Error).message;
        if (err instanceof AxiosError && err.response?.data) {
          const body = err.response.data as Record<string, unknown>;
          if (body.detail) {
            if (typeof body.detail === 'string') {
              msg = body.detail;
            } else if (typeof body.detail === 'object') {
              const detail = body.detail as Record<string, unknown>;
              const messages: string[] = [];
              for (const [, val] of Object.entries(detail)) {
                if (Array.isArray(val)) {
                  messages.push(val.join('. '));
                } else if (typeof val === 'string') {
                  messages.push(val);
                } else {
                  messages.push(JSON.stringify(val));
                }
              }
              msg = messages.length > 0 ? messages.join('. ') : 'Error del servidor. Verifique los datos ingresados.';
            } else {
              msg = 'Error del servidor. Verifique los datos ingresados.';
            }
          }
        }
        addToast('error', msg);
      }
    },
  });

  const handleStartCreate = () => {
    form.reset();
    setImagenPublicIds([]);
    setEditingId(null);
    setShowForm(true);
    setStockEditOnly(false);
    setSelectedCategorias([]);
    setSelectedIngredientes([]);
  };

  const handleStartEdit = (prod: Producto) => {
    form.reset({
      nombre: prod.nombre,
      descripcion: prod.descripcion ?? "",
      receta: prod.receta ?? "",
      precio_base: prod.precio_base,
      precio_actual: prod.precio_actual,
      stock_cantidad: prod.stock_cantidad,
      tiempo_prep_min: prod.tiempo_prep_min,
      disponible: prod.disponible,
      es_insumo: prod.es_insumo,
      imagenes_url: prod.imagenes_url,
      unidad_medida_id: prod.unidad_medida_id ?? null,
    }, { keepDefaultValues: true });
    setImagenPublicIds(prod.imagenes_url.map(extractPublicId));
    setEditingId(prod.id);
    setShowForm(true);
    setStockEditOnly(false);
    setSelectedCategorias([]);
    setSelectedIngredientes([]);
    setPendingIngredientesUpdate(null);
  };

  const handleStartStockEdit = (prod: Producto) => {
    form.reset({
      nombre: prod.nombre,
      descripcion: prod.descripcion ?? "",
      receta: prod.receta ?? "",
      precio_base: prod.precio_base,
      precio_actual: prod.precio_actual,
      stock_cantidad: prod.stock_cantidad,
      tiempo_prep_min: prod.tiempo_prep_min,
      disponible: prod.disponible,
      es_insumo: prod.es_insumo,
      imagenes_url: prod.imagenes_url,
      unidad_medida_id: prod.unidad_medida_id ?? null,
    }, { keepDefaultValues: true });
    setImagenPublicIds(prod.imagenes_url.map(extractPublicId));
    setEditingId(prod.id);
    setShowForm(true);
    setStockEditOnly(true);
    setSelectedCategorias([]);
    setSelectedIngredientes([]);
    setPendingIngredientesUpdate(null);
  };

  const handleCloseForm = () => {
    form.reset();
    setImagenPublicIds([]);
    setShowForm(false);
    setEditingId(null);
    setStockEditOnly(false);
    setSelectedCategorias([]);
    setSelectedIngredientes([]);
    setShowCategoriaSelector(false);
    setShowIngredienteSelector(false);
    setPendingIngredientesUpdate(null);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Eliminar este producto?")) return;
    try {
      await deleteMutation.mutateAsync(id);
      addToast('exito', 'Producto eliminado');
    } catch (err) {
      addToast('error', (err as Error).message);
    }
  };

  // Build columns based on role
  const columns: DataTableColumn<Producto>[] = [
    ...(!readOnly ? [{ key: "id" as const, label: "Codigo", hideOnMobile: true, render: (p: Producto) => <span className="text-gray-500 text-xs">{p.id}</span> }] : []),
    { key: "nombre" as const, label: "Nombre", render: (p: Producto) => <span className="font-medium text-gray-800">{p.nombre}</span> },
    {
      key: "precio_actual" as const,
      label: "Precio",
      render: (p: Producto) => (
        <span className="font-mono text-sm">
          ${Number(p.precio_actual).toFixed(2)}
          {p.tiene_ingredientes && !p.es_insumo && role !== 'client' && (
            <span className="text-xs text-blue-600 font-medium ml-1">(calc)</span>
          )}
        </span>
      ),
    },
    ...(!readOnly ? [{
      key: "stock_cantidad" as const,
      label: "Stock",
      render: (p: Producto) => (
        p.stock_cantidad === 0 ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
            Sin stock
          </span>
        ) : (
          <span className="font-mono font-semibold text-sm text-green-700">
            {p.stock_cantidad}
          </span>
        )
      ),
    }] : []),
    ...(!readOnly && !isStockMode ? [{
      key: "tiempo_prep_min" as const,
      label: "Prep. (min)",
      hideOnMobile: true,
      render: (p: Producto) => <span className="text-sm">{p.tiempo_prep_min}</span>,
    }] : []),
    {
      key: "disponible" as const,
      label: "Disponible",
      render: (p: Producto) => (
        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${p.disponible ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {p.disponible ? "Disponible" : "No disponible"}
        </span>
      ),
    },
    ...(!readOnly ? [{
      key: "es_insumo" as const,
      label: "Insumo",
      hideOnMobile: true,
      render: (p: Producto) => p.es_insumo
        ? <span className="text-blue-600 font-bold">Si</span>
        : <span className="text-gray-400">—</span>,
    }] : []),
    ...(!readOnly && (!isStockMode || role === 'stock') ? [{
      key: "relaciones" as const,
      label: isStockMode ? "Ingredientes" : "Componentes",
      hideOnMobile: true,
      render: (p: Producto) => (
        <div className="flex gap-1">
          <button onClick={() => setIngPopup({ id: p.id, nombre: p.nombre })}
            className="bg-purple-600 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-purple-700 transition-colors">Ingredientes</button>
          {!hideCategoriasBtn && (
            <button onClick={() => setCatPopup({ id: p.id, nombre: p.nombre })}
              className="bg-teal-600 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-teal-700 transition-colors">Categorias</button>
          )}
        </div>
      ),
    }] : []),
    ...(!readOnly ? [{
      key: "acciones" as const,
      label: "Acciones",
      render: (p: Producto) => (
        <div className="flex gap-1 flex-wrap">
          {!isStockMode && (
            <EditButton onClick={() => handleStartEdit(p)} />
          )}
          {isStockMode && (
            <button onClick={() => handleStartStockEdit(p)}
              className="bg-amber-700 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-amber-800 transition-colors">Stock</button>
          )}
          {!isStockMode && !hideDelete && (
            <DeleteButton onClick={() => handleDelete(p.id)} />
          )}
        </div>
      ),
    }] : []),
    ...(isAuth && role !== 'stock' ? [{
      key: "carrito" as const,
      label: "Carrito",
      render: (p: Producto) => {
        let addable = true;
        let disabledReason = '';
        if (!p.disponible) { addable = false; disabledReason = 'No disponible'; }
        else if (p.stock_cantidad <= 0) { addable = false; disabledReason = 'Sin stock'; }

        if (!addable) {
          return (
            <button disabled className="px-2 py-1 rounded text-sm bg-gray-400 text-gray-700 cursor-not-allowed" title={disabledReason}>
              {disabledReason}
            </button>
          );
        }

        return (
          <button onClick={() => handleAddToCart(p)}
            className={`px-2 py-1 rounded text-sm cursor-pointer transition-colors ${
              recentlyAdded.has(p.id) ? "bg-green-600 text-white" : "bg-blue-600 text-white hover:bg-blue-700"
            }`}>
            {recentlyAdded.has(p.id) ? "OK Agregado" : "Agregar al carrito"}
          </button>
        );
      },
    }] : []),
  ];

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">{role === 'client' ? 'Menu' : 'Gestion de Productos'}</h1>
      <ErrorBanner isError={isError} error={error} message="Error al cargar" />

      {/* Toolbar */}
      <div className="flex gap-2 mb-4 items-center">
        {!hideCreate && (
          <button onClick={handleStartCreate}
            className="bg-green-600 text-white px-4 py-1 rounded cursor-pointer">Crear Producto</button>
        )}
        <SearchFilter onSearch={handleSearch} placeholder="Filtrar por nombre..." />
        {!hideExport && (
          <button onClick={() => exportToExcel(items.filter(p => p.nombre.toLowerCase().includes(search.toLowerCase())).map(({ id, nombre, precio_actual, stock_cantidad, disponible, tiempo_prep_min }) => ({
              id, nombre, Precio: precio_actual, Stock: stock_cantidad, "Tiempo prep. (min)": tiempo_prep_min, Disponible: disponible ? "Si" : "No",
            })), "productos")}
            className="bg-blue-600 text-white px-4 py-1 rounded cursor-pointer">Exportar Excel</button>
        )}
      </div>

      {/* Create/edit form */}
      {showForm && (!hideCreate || stockEditOnly) && (
        <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void form.handleSubmit(); }} className="border p-4 mb-4 rounded bg-gray-50">
          {stockEditOnly ? (
            <div className="grid grid-cols-2 gap-4 mb-4">
              {!readOnly && (
                <form.Field name="es_insumo">
                  {(field) => (
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={field.state.value ?? false}
                        onChange={(e) => field.handleChange(e.target.checked)}
                        className="cursor-pointer" />
                      <label className="text-sm font-medium">Es Insumo?</label>
                    </div>
                  )}
                </form.Field>
              )}
              <form.Field name="stock_cantidad">
                {(field) => (
                  <div>
                    <label className="block text-sm font-medium">Stock</label>
                    <input type="number" min="0"
                      value={field.state.value ?? 0}
                      onChange={(e) => field.handleChange(Number(e.target.value))}
                      onBlur={field.handleBlur}
                      className="border px-2 py-1 rounded w-full" />
                  </div>
                )}
              </form.Field>
              <form.Field name="disponible">
                {(field) => (
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium">Disponible</label>
                    <input type="checkbox" checked={field.state.value ?? true}
                      onChange={(e) => field.handleChange(e.target.checked)} />
                  </div>
                )}
              </form.Field>
              {!readOnly && (
                <form.Field name="unidad_medida_id">
                  {(field) => (
                    <div>
                      <label className="block text-sm font-medium">Unidad de Medida</label>
                      <select value={field.state.value ?? ""}
                        onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : null)}
                        onBlur={field.handleBlur}
                        className="border px-2 py-1 rounded w-full">
                        <option value="5">Por unidad</option>
                        {unidades.map((u) => (
                          <option key={u.id} value={u.id}>{u.simbolo} ({u.nombre})</option>
                        ))}
                      </select>
                    </div>
                  )}
                </form.Field>
              )}
            </div>
          ) : (
            <>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <form.Field name="nombre">
                {(field) => (
                  <div>
                    <label className="block text-sm font-medium">Nombre</label>
                    <input value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      className="border px-2 py-1 rounded w-full" required />
                  </div>
                )}
              </form.Field>
              <form.Field name="descripcion">
                {(field) => (
                  <div>
                    <label className="block text-sm font-medium">Descripcion</label>
                    <input value={field.state.value ?? ""}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      className="border px-2 py-1 rounded w-full" />
                  </div>
                )}
              </form.Field>
              <div>
                <label className="block text-sm font-medium">
                  Precio Base
                  {(() => {
                    const unidadId = form.getFieldValue('unidad_medida_id');
                    if (unidadId) {
                      const u = unidades.find(un => un.id === unidadId);
                      if (u) return <span className="text-gray-500 font-normal"> / {u.simbolo}</span>;
                    }
                    return null;
                  })()}
                </label>
                {(() => {
                  const editingProduct = editingId ? items.find(p => p.id === editingId) : null;
                  const hasIngredients = editingProduct?.tiene_ingredientes ?? false;
                  const isInsumoValue = form.getFieldValue('es_insumo');
                  const precioDisabled = isInsumoValue ? false : (editingId ? hasIngredients : selectedIngredientes.length > 0);
                  return (
                    <form.Field name="precio_base">
                      {(field) => (
                        <>
                          <input type="number" step="0.01" value={field.state.value ?? 0}
                            disabled={precioDisabled}
                            onChange={(e) => field.handleChange(Number(e.target.value))}
                            onBlur={field.handleBlur}
                            className={`border px-2 py-1 rounded w-full ${precioDisabled ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : ''}`} />
                          {(editingId && hasIngredients) || (!editingId && selectedIngredientes.length > 0) ? (
                            <p className="text-xs text-gray-500 mt-1 italic">
                              {!editingId
                                ? (selectedIngredientes.length === 1
                                    ? 'Calculado desde 1 ingrediente'
                                    : `Calculado desde ${selectedIngredientes.length} ingredientes`)
                                : 'Calculado desde ingredientes'}
                            </p>
                          ) : null}
                        </>
                      )}
                    </form.Field>
                  );
                })()}
              </div>
              <div>
                <label className="block text-sm font-medium">
                  Precio de venta
                  {(() => {
                    const unidadId = form.getFieldValue('unidad_medida_id');
                    if (unidadId) {
                      const u = unidades.find(un => un.id === unidadId);
                      if (u) return <span className="text-gray-500 font-normal"> / {u.simbolo}</span>;
                    }
                    return null;
                  })()}
                </label>
                <form.Field name="precio_actual">
                  {(field) => (
                    <input type="number" step="0.01" value={field.state.value ?? 0}
                      onChange={(e) => field.handleChange(Number(e.target.value))}
                      onBlur={field.handleBlur}
                      className="border px-2 py-1 rounded w-full" />
                  )}
                </form.Field>
              </div>
              {!form.getFieldValue('es_insumo') && (
                <div className="col-span-2">
                  <form.Field name="receta">
                    {(field) => (
                      <div>
                        <label className="block text-sm font-medium mb-1">Receta / Preparacion</label>
                      <textarea value={field.state.value ?? ""}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        rows={4}
                        placeholder="Ej: 200 g de harina, 2 huevos, 1 taza de leche. Mezclar y cocinar a fuego medio..."
                        className="w-full border border-gray-300 px-3 py-2 rounded text-sm" />
                    </div>
                  )}
                </form.Field>
              </div>
              )}
              <form.Field name="stock_cantidad">
                {(field) => (
                  <div>
                    <label className="block text-sm font-medium">Stock</label>
                    <input type="number" min="0" value={field.state.value ?? 0}
                      onChange={(e) => field.handleChange(Number(e.target.value))}
                      onBlur={field.handleBlur}
                      className="border px-2 py-1 rounded w-full" />
                  </div>
                )}
              </form.Field>
              <form.Field name="tiempo_prep_min">
                {(field) => (
                  <div>
                    <label className="block text-sm font-medium">Tiempo de preparacion (minutos)</label>
                    <input type="number" value={field.state.value ?? 0}
                      onChange={(e) => field.handleChange(Number(e.target.value))}
                      onBlur={field.handleBlur}
                      className="border px-2 py-1 rounded w-full" />
                  </div>
                )}
              </form.Field>
              <form.Field name="disponible">
                {(field) => (
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium">Disponible</label>
                    <input type="checkbox" checked={field.state.value ?? true}
                      onChange={(e) => field.handleChange(e.target.checked)} />
                  </div>
                )}
              </form.Field>
              <form.Field name="es_insumo">
                {(field) => (
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={field.state.value ?? false}
                      onChange={(e) => field.handleChange(e.target.checked)}
                      className="cursor-pointer" />
                    <label className="text-sm font-medium">Es Insumo? (revender sin receta)</label>
                  </div>
                )}
              </form.Field>
              <form.Field name="unidad_medida_id">
                {(field) => (
                  <div>
                    <label className="block text-sm font-medium">Unidad de Medida</label>
                    <select value={field.state.value ?? ""}
                      onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : null)}
                      className="border px-2 py-1 rounded w-full">
                      <option value="5">Por unidad</option>
                      {["masa", "volumen", "unidad", "area"].map((tipo) => {
                        const grupo = unidades.filter((u) => u.tipo === tipo);
                        if (grupo.length === 0) return null;
                        return (
                          <optgroup key={tipo} label={tipo.charAt(0).toUpperCase() + tipo.slice(1)}>
                            {grupo.map((u) => (
                              <option key={u.id} value={u.id}>{u.nombre} ({u.simbolo})</option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                  </div>
                )}
              </form.Field>
            </div>
            </>
          )}

          {!stockEditOnly && (
            <div className="border p-4 mb-4 rounded bg-gray-50">
              <h3 className="text-lg font-medium mb-2">Imagenes</h3>
              <ImageCarousel
                images={form.getFieldValue("imagenes_url") ?? []}
                publicIds={imagenPublicIds}
                onDelete={handleDeleteImagen}
                readOnly={false}
              />
              <button
                type="button"
                onClick={() => abrirWidget((secureUrl, publicId) => {
                  const currentUrls = form.getFieldValue("imagenes_url") ?? [];
                  form.setFieldValue("imagenes_url", [...currentUrls, secureUrl]);
                  setImagenPublicIds((prev) => [...prev, publicId]);
                })}
                disabled={uploadingImages}
                className="mt-3 bg-blue-600 text-white px-4 py-1 rounded cursor-pointer disabled:opacity-50 hover:bg-blue-700"
              >
                {uploadingImages ? "Subiendo..." : "Subir imagenes"}
              </button>
            </div>
          )}

          {!editingId && !hideCreate && !isStockMode && (
            <>
              <div className="border p-4 mb-4 rounded bg-gray-50">
                <h3 className="text-lg font-medium mb-2">Categorias</h3>
                {selectedCategorias.length > 0 && (
                  <table className="w-full border-collapse border mb-2">
                    <thead><tr className="bg-gray-200">
                      <th className="border p-2 text-left">Nombre</th>
                      <th className="border p-2 text-left">Descripcion</th>
                      <th className="border p-2 text-left">Accion</th>
                    </tr></thead>
                    <tbody>
                      {selectedCategorias.map((c) => (
                        <tr key={c.id}>
                          <td className="border p-2">{c.nombre}</td>
                          <td className="border p-2">{c.descripcion ?? "-"}</td>
                          <td className="border p-2">
                            <button type="button" onClick={() => setSelectedCategorias(prev => prev.filter(sc => sc.id !== c.id))} className="bg-red-600 text-white px-2 py-1 rounded text-sm cursor-pointer">Quitar</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <button type="button" onClick={() => setShowCategoriaSelector(true)} className="bg-blue-600 text-white px-4 py-1 rounded cursor-pointer">Seleccionar Categorias</button>
              </div>

              {!form.getFieldValue('es_insumo') && (
              <div className="border p-4 mb-4 rounded bg-gray-50">
                <h3 className="text-lg font-medium mb-2">Ingredientes</h3>
                {selectedIngredientes.length > 0 && (
                  <table className="w-full border-collapse border mb-2">
                    <thead><tr className="bg-gray-200">
                      <th className="border p-2 text-left">Nombre</th>
                      <th className="border p-2 text-left">Alergeno</th>
                      <th className="border p-2 text-left">Cantidad</th>
                      <th className="border p-2 text-left">Accion</th>
                    </tr></thead>
                    <tbody>
                      {selectedIngredientes.map((i) => {
                        const u = unidades.find(un => un.id === i.unidad_medida_id);
                        return (
                        <tr key={i.id}>
                          <td className="border p-2">{i.nombre}</td>
                          <td className="border p-2">{i.es_alergeno ? "Si" : "No"}</td>
                          <td className="border p-2">{i.cantidad}{u ? ` ${u.simbolo}` : ""}</td>
                          <td className="border p-2">
                            <button type="button" onClick={() => setSelectedIngredientes(prev => prev.filter(si => si.id !== i.id))} className="bg-red-600 text-white px-2 py-1 rounded text-sm cursor-pointer">Quitar</button>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                <button type="button" onClick={() => setShowIngredienteSelector(true)}
                  className="bg-blue-600 text-white px-4 py-1 rounded cursor-pointer">Seleccionar Ingredientes</button>
              </div>
              )}
            </>
          )}

          <div className="mt-4">
            <FormFooter
              isSubmitting={form.state.isSubmitting}
              isEditing={!!editingId}
              onCancel={handleCloseForm}
              updateLabel={stockEditOnly ? "Actualizar Stock" : undefined}
            />
          </div>
        </form>
      )}

      {/* Product list table via DataTable */}
      <DataTable
        columns={columns}
        data={items}
        total={total}
        skip={skip}
        limit={limit}
        onPageChange={handlePageChange}
        onLimitChange={handleLimitChange}
        isLoading={isLoading}
        getRowClassName={(p: Producto) => !p.disponible ? "bg-gray-100 opacity-60" : undefined}
      />

      {/* Extra actions below table */}
      <div className="flex gap-2 mt-4 items-center justify-between">
        <div />
        {isAuth && role !== 'stock' && (
          <button
            onClick={() => navigate("/carrito")}
            className="bg-green-700 text-white px-4 py-1.5 rounded text-sm font-semibold hover:bg-green-800 cursor-pointer"
          >
            Ver Carrito {useCartStore.getState().getItemCount() > 0 ? `(${useCartStore.getState().getItemCount()})` : ""}
          </button>
        )}
      </div>

      {/* Popups */}
      {ingPopup && <IngredientesPopup productoId={ingPopup.id} productoNombre={ingPopup.nombre} unidades={unidades} onClose={() => setIngPopup(null)} onIngredientsChange={setPendingIngredientesUpdate} />}
      {catPopup && <CategoriasPopup productoId={catPopup.id} productoNombre={catPopup.nombre} onClose={() => setCatPopup(null)} />}
      {showCategoriaSelector && (
        <CategoriaSelector
          allCategorias={allCats}
          selectedIds={selectedCategorias.map(c => c.id)}
          onSelect={(ids) => {
            const selectedCats = allCats.filter(c => ids.includes(c.id)).map(c => ({ id: c.id, nombre: c.nombre, descripcion: c.descripcion }));
            setSelectedCategorias(selectedCats);
          }}
          onClose={() => setShowCategoriaSelector(false)}
        />
      )}

      {showIngredienteSelector && !form.getFieldValue('es_insumo') && (
        <IngredienteSelector
          allIngredientes={allIngs}
          unidades={unidades}
          selected={selectedIngredientes.map(i => ({ id: i.id, cantidad: i.cantidad, unidad_medida_id: i.unidad_medida_id }))}
          onSelect={(items) => {
            const selectedIngs = items.map(item => {
              const ing = allIngs.find(i => i.id === item.id);
              return {
                id: item.id,
                nombre: ing?.nombre ?? '',
                es_alergeno: ing?.es_alergeno ?? false,
                cantidad: item.cantidad ?? 1,
                unidad_medida_id: item.unidad_medida_id ?? null,
              };
            });
            setSelectedIngredientes(selectedIngs);
          }}
          onClose={() => setShowIngredienteSelector(false)}
        />
      )}
    </div>
  );
}
