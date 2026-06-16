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
 */
import { useCallback, useEffect, useState, useRef } from "react";
import { useAppForm } from "@/shared/hooks/useAppForm";
import type { Producto, ProductoCreate, ProductoIngredienteRead, ProductoCategoriaRead } from "@/features/productos/api/productos";
import { productosApi } from "@/features/productos/api/productos";
import type { Ingrediente } from "@/features/productos/api/ingredientes";
import { ingredientesApi } from "@/features/productos/api/ingredientes";
import type { Categoria } from "@/features/categorias/api/categorias";
import { categoriasApi } from "@/features/categorias/api/categorias";
import { useProductos, useCreateProducto, useUpdateProducto, useDeleteProducto } from "@/features/productos/hooks/useProductos";
import { useCategorias } from "@/features/categorias/hooks/useCategorias";
import { useIngredientes } from "@/features/productos/hooks/useIngredientes";
import { uploadsApi } from "@/shared/api/uploads";
import ImageCarousel from "@/shared/components/ImageCarousel";
import { addToast } from "@/shared/components/Toast";
import Modal from "@/shared/components/Modal";
import { useNavigate } from "react-router-dom";
import { exportToExcel } from "@/shared/utils/exportExcel";
import { useCartStore } from "@/shared/store/cartStore";
import { AxiosError } from "axios";
import { getAccessToken } from "@/shared/api/client";

const PAGE_SIZE = 10;

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

function IngredienteSelector({ allIngredientes, selected, onSelect, onClose }: {
  allIngredientes: Ingrediente[]; selected: {id: number, cantidad: number}[]; onSelect: (items: {id: number, cantidad: number}[]) => void; onClose: () => void;
}) {
  const [localSelected, setLocalSelected] = useState<{id: number, cantidad: number}[]>(selected);

  const toggleIngredient = (id: number) => {
    setLocalSelected(prev =>
      prev.some(s => s.id === id)
        ? prev.filter(s => s.id !== id)
        : [...prev, { id, cantidad: 1 }]
    );
  };

  const handleConfirm = () => {
    onSelect(localSelected);
    onClose();
  };

  return (
    <Modal open={true} onClose={onClose} title="Seleccionar Ingredientes / Insumos" maxWidth="max-w-2xl">
      <table className="w-full border-collapse border mb-4">
          <thead><tr className="bg-gray-200">
            <th className="border p-2 text-left">Seleccionar</th>
            <th className="border p-2 text-left">Nombre</th>
            <th className="border p-2 text-left">Alergeno</th>
            <th className="border p-2 text-left">Precio</th>
            <th className="border p-2 text-left">Stock</th>
            <th className="border p-2 text-left">Cantidad</th>
            <th className="border p-2 text-left">Max Productos</th>
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
                <td className="border p-2">{ing.stock_actual}</td>
                <td className="border p-2">
                  {sel && (
                    <input type="number" min="1"
                      value={sel.cantidad}
                      onChange={(e) => {
                        const newCant = parseInt(e.target.value) || 1;
                        setLocalSelected(prev =>
                          prev.map(s => s.id === ing.id ? { ...s, cantidad: newCant } : s)
                        );
                      }}
                      className="border px-2 py-1 rounded w-20" />
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

function IngredientesPopup({ productoId, productoNombre, onClose }: {
  productoId: number; productoNombre: string; onClose: () => void;
}) {
  const [ings, setIngs] = useState<ProductoIngredienteRead[]>([]);
  const [allIngs, setAllIngs] = useState<Ingrediente[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<number | null>(null);
  const [addForm, setAddForm] = useState({ ingrediente_id: 0, cantidad: 1, es_removible: true, es_principal: false, orden: 0 });
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
  }, [productoId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!addForm.ingrediente_id) return;
    try {
      await productosApi.addIngrediente(productoId, addForm);
      setShowAdd(false);
      setAddForm({ ingrediente_id: 0, cantidad: 1, es_removible: true, es_principal: false, orden: 0 });
      refresh();
      addToast('exito', 'Ingrediente agregado correctamente');
    } catch {
      addToast('error', 'Error al agregar ingrediente');
    }
  };

  const handleCantidadChange = async (ingredienteId: number, newCantidad: number) => {
    if (newCantidad < 1) return;
    setUpdatingCantidad(ingredienteId);
    setIngs(prev => prev.map(ing =>
      ing.ingrediente_id === ingredienteId
        ? { ...ing, cantidad: newCantidad }
        : ing
    ));
    try {
      await productosApi.updateIngredienteCantidad(productoId, ingredienteId, newCantidad);
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
      refresh();
      addToast('exito', 'Ingrediente quitado correctamente');
    } catch {
      addToast('error', 'Error al quitar ingrediente');
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

  const getIngInfo = (ingredienteId: number) =>
    allIngs.find((i) => i.id === ingredienteId);

  const availableIngs = allIngs.filter(
    (ai) => !ings.some((i) => i.ingrediente_id === ai.id)
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded p-6 w-full max-w-2xl max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">Ingredientes / Insumos de &quot;{productoNombre}&quot;</h2>
          <button onClick={onClose} className="text-gray-500 text-xl cursor-pointer">X</button>
        </div>

        {loading ? <p>Cargando...</p> : (
          <>
            {ings.length === 0 ? (
              <p className="text-gray-500 mb-4">Sin ingredientes asignados.</p>
            ) : (
              <table className="w-full border-collapse border mb-4">
                <thead><tr className="bg-gray-200">
                  <th className="border p-2 text-left">Orden</th>
                  <th className="border p-2 text-left">Ingrediente</th>
                  <th className="border p-2 text-left">Cantidad</th>
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
                              <td className="border p-2">{ing.orden}</td>
                              <td className="border p-2">{ing.ingrediente_nombre}</td>
                              <td className="border p-2">
                                <input type="number" min="1"
                                  value={ing.cantidad}
                                  disabled={updatingCantidad === ing.ingrediente_id}
                                  onChange={(e) => handleCantidadChange(ing.ingrediente_id, parseInt(e.target.value) || 1)}
                                  className="border px-2 py-1 rounded w-20" />
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
                              <td className="border p-2">{ing.es_removible ? "Si" : "No"}</td>
                              <td className="border p-2">{ing.es_principal ? "Si" : "No"}</td>
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
                    <input type="number" min="1" value={addForm.cantidad}
                      onChange={(e) => setAddForm({ ...addForm, cantidad: parseInt(e.target.value) || 1 })}
                      className="border px-2 py-1 rounded w-full" />
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
      </div>
    </div>
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded p-6 w-full max-w-lg max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">Categorias de &quot;{productoNombre}&quot;</h2>
          <button onClick={onClose} className="text-gray-500 text-xl cursor-pointer">X</button>
        </div>
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
      </div>
    </div>
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
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [stockEditOnly, setStockEditOnly] = useState(false);
  const [selectedCategorias, setSelectedCategorias] = useState<{id: number, nombre: string, descripcion: string | null}[]>([]);
  const [selectedIngredientes, setSelectedIngredientes] = useState<{id: number, nombre: string, es_alergeno: boolean, cantidad: number}[]>([]);
  const [showCategoriaSelector, setShowCategoriaSelector] = useState(false);
  const [showIngredienteSelector, setShowIngredienteSelector] = useState(false);
  const [ingPopup, setIngPopup] = useState<{ id: number; nombre: string } | null>(null);
  const [catPopup, setCatPopup] = useState<{ id: number; nombre: string } | null>(null);
  const [recentlyAdded, setRecentlyAdded] = useState<Set<number>>(new Set());
  const addTimerRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // Cloudinary Upload Widget state
  const cloudinaryWidgetRef = useRef<unknown>(null);
  const [imagenPublicIds, setImagenPublicIds] = useState<string[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);

  // ── TanStack Query: products (paginated) ──
  const { data: items = [], isLoading, isError, error } = useProductos(page * PAGE_SIZE, PAGE_SIZE);

  // ── TanStack Query: categories and ingredients for selectors ──
  const { data: allCats = [] } = useCategorias(0, 1000);
  const { data: allIngs = [] } = useIngredientes(0, 1000);

  // ── TanStack Query mutations ──
  const createMutation = useCreateProducto();
  const updateMutation = useUpdateProducto();
  const deleteMutation = useDeleteProducto();

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

  // Load Cloudinary Upload Widget CDN script
  useEffect(() => {
    if (readOnly) return;
    const scriptId = "cloudinary-upload-widget";
    if (document.getElementById(scriptId)) return;
    const script = document.createElement("script");
    script.id = scriptId;
    script.src = "https://upload-widget.cloudinary.com/global/all.js";
    script.async = true;
    document.body.appendChild(script);
    return () => {
      const el = document.getElementById(scriptId);
      if (el) el.remove();
    };
  }, [readOnly]);

  const abrirWidgetCloudinary = () => {
    const cloudinary = (window as unknown as Record<string, unknown>).cloudinary as Record<string, unknown> | undefined;
    if (!cloudinary || typeof cloudinary.createUploadWidget !== "function") {
      addToast("error", "El widget de Cloudinary no se ha cargado. Recargue la pagina.");
      return;
    }
    const widget = (cloudinary.createUploadWidget as Function)(
      {
        cloudName: "dqp5n999t",
        uploadPreset: "fs_default",
        multiple: true,
        maxFiles: 10,
      },
      (error: unknown, result: { event: string; info?: { secure_url: string; public_id: string } }) => {
        if (error) {
          addToast("error", "Error al subir imagen a Cloudinary");
          return;
        }
        if (result?.event === "success" && result.info) {
          const newUrl = result.info.secure_url;
          const newPublicId = result.info.public_id;
          const currentUrls = form.getFieldValue("imagenes_url") ?? [];
          form.setFieldValue("imagenes_url", [...currentUrls, newUrl]);
          setImagenPublicIds((prev) => [...prev, newPublicId]);
        }
      }
    );
    cloudinaryWidgetRef.current = widget;
    (widget as { open: () => void }).open();
  };

  const handleDeleteImagen = async (publicId: string) => {
    if (!confirm("Eliminar esta imagen?")) return;
    setUploadingImages(true);
    try {
      await uploadsApi.deleteImage(publicId);
      const idx = imagenPublicIds.indexOf(publicId);
      if (idx >= 0) {
        const currentUrls = form.getFieldValue("imagenes_url") ?? [];
        const newUrls = [...currentUrls];
        newUrls.splice(idx, 1);
        form.setFieldValue("imagenes_url", newUrls);
        setImagenPublicIds((prev) => prev.filter((id) => id !== publicId));
      }
      addToast("exito", "Imagen eliminada correctamente");
    } catch {
      addToast("error", "Error al eliminar la imagen");
    } finally {
      setUploadingImages(false);
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
      const total = selectedIngredientes.reduce((sum, ing) => {
        const fullIng = allIngs.find(a => a.id === ing.id);
        return sum + Number(fullIng?.precio_actual ?? 0) * (ing.cantidad ?? 1);
      }, 0);
      precioCalculadoRef.current = total;
      form.setFieldValue('precio_base', total);
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
    },
    onSubmit: async ({ value }) => {
      try {
        if (editingId) {
          if (stockEditOnly) {
            await updateMutation.mutateAsync({ id: editingId, data: {
              stock_cantidad: value.stock_cantidad,
              disponible: value.disponible,
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
            await updateMutation.mutateAsync({ id: editingId, data: changed });
          }
          addToast('exito', 'Producto actualizado correctamente');
        } else {
          if (!value.es_insumo && selectedIngredientes.length === 0 && value.precio_base <= 0) {
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
            })),
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
              for (const [, value] of Object.entries(detail)) {
                if (Array.isArray(value)) {
                  messages.push(value.join('. '));
                } else if (typeof value === 'string') {
                  messages.push(value);
                } else {
                  messages.push(JSON.stringify(value));
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
    }, { keepDefaultValues: true });
    setImagenPublicIds(prod.imagenes_url.map(extractPublicId));
    setEditingId(prod.id);
    setShowForm(true);
    setStockEditOnly(false);
    setSelectedCategorias([]);
    setSelectedIngredientes([]);
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
    }, { keepDefaultValues: true });
    setImagenPublicIds(prod.imagenes_url.map(extractPublicId));
    setEditingId(prod.id);
    setShowForm(true);
    setStockEditOnly(true);
    setSelectedCategorias([]);
    setSelectedIngredientes([]);
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

  // Client-side filter
  const filtered = items.filter((p) =>
    (role !== 'client' || p.disponible === true) &&
    p.nombre.toLowerCase().includes(filter.toLowerCase())
  );

  // ── RENDER ──

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">{role === 'client' ? 'Menu' : 'Gestion de Productos'}</h1>
      {isError && <pre className="text-red-500 mb-4 whitespace-pre-wrap font-sans">{(error as Error)?.message || "Error al cargar"}</pre>}

      {/* Toolbar */}
      <div className="flex gap-2 mb-4 items-center">
        {!hideCreate && (
          <button onClick={handleStartCreate}
            className="bg-green-600 text-white px-4 py-1 rounded cursor-pointer">Crear Producto</button>
        )}
        <input type="text" placeholder="Filtrar por nombre..." value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border px-2 py-1 rounded flex-grow" />
        {!hideExport && (
          <button onClick={() => exportToExcel(filtered.map(({ id, nombre, precio_actual, stock_cantidad, disponible, tiempo_prep_min }) => ({
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
            </div>
          ) : (
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
                <label className="block text-sm font-medium">Precio Base</label>
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
                <label className="block text-sm font-medium">Precio de venta</label>
                <form.Field name="precio_actual">
                  {(field) => (
                    <input type="number" step="0.01" value={field.state.value ?? 0}
                      onChange={(e) => field.handleChange(Number(e.target.value))}
                      onBlur={field.handleBlur}
                      className="border px-2 py-1 rounded w-full" />
                  )}
                </form.Field>
              </div>
              <div className="col-span-2">
                <form.Field name="receta">
                  {(field) => (
                    <div>
                      <label className="block text-sm font-medium mb-1">Receta / Preparacion</label>
                      <textarea
                        value={field.state.value ?? ""}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        rows={4}
                        placeholder="Ej: 200 g de harina, 2 huevos, 1 taza de leche. Mezclar y cocinar a fuego medio..."
                        className="w-full border border-gray-300 px-3 py-2 rounded text-sm"
                      />
                    </div>
                  )}
                </form.Field>
              </div>
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
            </div>
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
                onClick={abrirWidgetCloudinary}
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
                <h3 className="text-lg font-medium mb-2">
                  Ingredientes / Insumos
                </h3>
                {selectedIngredientes.length > 0 && (
                  <table className="w-full border-collapse border mb-2">
                    <thead><tr className="bg-gray-200">
                      <th className="border p-2 text-left">Nombre</th>
                      <th className="border p-2 text-left">Alergeno</th>
                      <th className="border p-2 text-left">Cantidad</th>
                      <th className="border p-2 text-left">Accion</th>
                    </tr></thead>
                    <tbody>
                      {selectedIngredientes.map((i) => (
                        <tr key={i.id}>
                          <td className="border p-2">{i.nombre}</td>
                          <td className="border p-2">{i.es_alergeno ? "Si" : "No"}</td>
                          <td className="border p-2">{i.cantidad}</td>
                          <td className="border p-2">
                            <button type="button" onClick={() => setSelectedIngredientes(prev => prev.filter(si => si.id !== i.id))} className="bg-red-600 text-white px-2 py-1 rounded text-sm cursor-pointer">Quitar</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <button type="button"
                  onClick={() => setShowIngredienteSelector(true)}
                  className="bg-blue-600 text-white px-4 py-1 rounded cursor-pointer">Seleccionar Insumos</button>
              </div>
              )}
            </>
          )}

          <div className="flex gap-2 mt-4">
            <button type="submit" disabled={form.state.isSubmitting}
              className="bg-blue-600 text-white px-4 py-1 rounded cursor-pointer disabled:opacity-50">
              {form.state.isSubmitting ? "Guardando..." : (stockEditOnly ? "Actualizar Stock" : (editingId ? "Actualizar" : "Crear"))}</button>
            <button type="button" onClick={handleCloseForm}
              className="bg-gray-400 text-white px-4 py-1 rounded cursor-pointer">Cancelar</button>
          </div>
        </form>
      )}

      {/* Product list table */}
      {isLoading ? <p>Cargando...</p> : (
        <div className="overflow-x-auto rounded-lg shadow border border-gray-200">
          <table className="w-full border-collapse text-sm">
          <thead><tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
            {!readOnly && <th className="px-3 py-3 text-left font-semibold">Codigo</th>}
            <th className="px-3 py-3 text-left font-semibold">Nombre</th>
            <th className="px-3 py-3 text-left font-semibold">Precio</th>
            {!readOnly && <th className="px-3 py-3 text-left font-semibold">Stock</th>}
            {!readOnly && !isStockMode && <th className="px-3 py-3 text-left font-semibold">Prep. (min)</th>}
            <th className="px-3 py-3 text-left font-semibold">Disponible</th>
            {!readOnly && <th className="px-3 py-3 text-left font-semibold">Insumo</th>}
            {!readOnly && (!isStockMode || role === 'stock') && (
              <th className="px-3 py-3 text-left font-semibold">{isStockMode ? 'Ingredientes' : 'Relaciones'}</th>
            )}
            {!readOnly && <th className="px-3 py-3 text-left font-semibold">Acciones</th>}
            {isAuth && role !== 'stock' && <th className="px-3 py-3 text-left font-semibold">Carrito</th>}
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((prod) => (
              <tr key={prod.id} className="hover:bg-blue-50 transition-colors" style={{ backgroundColor: prod.stock_cantidad === 0 ? '#fef2f2' : prod.stock_cantidad < 50 ? '#fefce8' : undefined }}>
                {!readOnly && <td className="px-3 py-2.5 text-gray-500 text-xs">{prod.id}</td>}
                <td className="px-3 py-2.5 font-medium text-gray-800">{prod.nombre}</td>
                <td className="px-3 py-2.5">
                  <span className="font-mono text-sm">
                    ${Number(prod.precio_actual).toFixed(2)}
                    {prod.tiene_ingredientes && !prod.es_insumo && role !== 'client' && (
                      <span className="text-xs text-blue-600 font-medium ml-1">(calc)</span>
                    )}
                  </span>
                </td>
                {!readOnly && (
                  <td className="px-3 py-2.5">
                    <span className={`font-mono font-semibold text-sm ${prod.stock_cantidad === 0 ? 'text-red-600' : 'text-green-700'}`}>
                      {prod.stock_cantidad}
                    </span>
                  </td>
                )}
                {!readOnly && !isStockMode && <td className="px-3 py-2.5 text-sm">{prod.tiempo_prep_min}</td>}
                <td className="px-3 py-2.5">
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${prod.disponible ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {prod.disponible ? "Si" : "No"}
                  </span>
                </td>
                {!readOnly && (
                  <td className="px-3 py-2.5 text-center">
                    {prod.es_insumo
                      ? <span className="text-blue-600 font-bold">Si</span>
                      : <span className="text-gray-400">—</span>}
                  </td>
                )}
                {!readOnly && (!isStockMode || role === 'stock') && (
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1">
                      <button onClick={() => setIngPopup({ id: prod.id, nombre: prod.nombre })}
                        className="bg-purple-600 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-purple-700 transition-colors">Insumos</button>
                      {!hideCategoriasBtn && (
                        <button onClick={() => setCatPopup({ id: prod.id, nombre: prod.nombre })}
                          className="bg-teal-600 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-teal-700 transition-colors">Categorias</button>
                      )}
                    </div>
                  </td>
                )}
                {!readOnly && (
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1 flex-wrap">
                      {!isStockMode && (
                        <button onClick={() => handleStartEdit(prod)}
                          className="bg-yellow-500 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-yellow-600 transition-colors">Editar</button>
                      )}
                      <button onClick={() => handleStartStockEdit(prod)}
                        className="bg-amber-700 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-amber-800 transition-colors">Stock</button>
                      {!isStockMode && !hideDelete && (
                        <button onClick={() => handleDelete(prod.id)}
                          className="bg-red-600 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-red-700 transition-colors">Eliminar</button>
                      )}
                    </div>
                  </td>
                )}
                {isAuth && role !== 'stock' && (
                  <td className="px-3 py-2.5">
                    {(() => {
                      let addable = true;
                      let disabledReason = '';

                      if (!prod.disponible) {
                        addable = false;
                        disabledReason = 'No disponible';
                      } else if (prod.stock_cantidad <= 0) {
                        addable = false;
                        disabledReason = 'Sin stock';
                      }

                      if (!addable) {
                        return (
                          <button
                            disabled
                            className="px-2 py-1 rounded text-sm bg-gray-400 text-gray-700 cursor-not-allowed"
                            title={disabledReason}
                          >
                            {disabledReason}
                          </button>
                        );
                      }

                      return (
                        <button
                          onClick={() => handleAddToCart(prod)}
                          className={`px-2 py-1 rounded text-sm cursor-pointer transition-colors ${
                            recentlyAdded.has(prod.id)
                              ? "bg-green-600 text-white"
                              : "bg-blue-600 text-white hover:bg-blue-700"
                          }`}
                        >
                          {recentlyAdded.has(prod.id) ? "OK Agregado" : "Agregar al carrito"}
                        </button>
                      );
                    })()}
                  </td>
                )}
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={readOnly ? 4 : (isStockMode ? 7 : isAuth ? 9 : 8)} className="px-3 py-6 text-center text-gray-400">Sin resultados</td></tr>}
          </tbody>
        </table>
        </div>
      )}

      {/* Pagination + cart button */}
      <div className="flex gap-2 mt-4 items-center justify-between">
        <div className="flex gap-2 items-center">
          <button disabled={page === 0}
            onClick={() => setPage(page - 1)}
            className="bg-gray-300 px-3 py-1 rounded disabled:opacity-50 cursor-pointer">Anterior</button>
          <span>Pagina {page + 1}</span>
          <button disabled={items.length < PAGE_SIZE}
            onClick={() => setPage(page + 1)}
            className="bg-gray-300 px-3 py-1 rounded disabled:opacity-50 cursor-pointer">Siguiente</button>
        </div>
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
      {ingPopup && <IngredientesPopup productoId={ingPopup.id} productoNombre={ingPopup.nombre} onClose={() => setIngPopup(null)} />}
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
          selected={selectedIngredientes.map(i => ({ id: i.id, cantidad: i.cantidad }))}
          onSelect={(items) => {
            const selectedIngs = items.map(item => {
              const ing = allIngs.find(i => i.id === item.id);
              return {
                id: item.id,
                nombre: ing?.nombre ?? '',
                es_alergeno: ing?.es_alergeno ?? false,
                cantidad: item.cantidad ?? 1,
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
