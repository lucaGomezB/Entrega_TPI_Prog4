/**
 * IngredientesCRUD — Ingredients (insumos) management admin page.
 * Uses TanStack Query for data fetching and mutations.
 */
import { useState, useEffect } from "react";
import { AxiosError } from "axios";
import type { Ingrediente, IngredienteCreate } from "@/features/productos/api/ingredientes";
import { ingredientesApi } from "@/features/productos/api/ingredientes";
import { useIngredientes, useCreateIngrediente, useUpdateIngrediente, useDeleteIngrediente } from "@/features/productos/hooks/useIngredientes";
import { exportToExcel } from "@/shared/utils/exportExcel";
import { useAppForm, required } from "@/shared/hooks/useAppForm";
import { addToast } from "@/shared/components/Toast";

const PAGE_SIZE = 10;

export default function IngredientesCRUD() {
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [inlineStockEdit, setInlineStockEdit] = useState<{ id: number; value: string } | null>(null);
  const [inlinePrecioEdit, setInlinePrecioEdit] = useState<{ id: number; value: string } | null>(null);

  // ── TanStack Query ──
  const { data: items = [], isLoading, isError, error } = useIngredientes(page * PAGE_SIZE, PAGE_SIZE);
  const createMutation = useCreateIngrediente();
  const updateMutation = useUpdateIngrediente();
  const deleteMutation = useDeleteIngrediente();

  // Auto-clear error after 3 seconds
  useEffect(() => {
    if (isError && error) {
      const timer = setTimeout(() => {}, 3000);
      return () => clearTimeout(timer);
    }
  }, [isError, error]);

  const form = useAppForm<IngredienteCreate>({
    defaultValues: { nombre: "", es_alergeno: true, precio_actual: 0, stock_actual: 0 },
    onSubmit: async ({ value }) => {
      try {
        if (editingId) {
          await updateMutation.mutateAsync({ id: editingId, data: value });
        } else {
          await createMutation.mutateAsync(value);
        }
        addToast('exito', 'Insumo guardado correctamente');
        handleCloseForm();
      } catch (err) {
        const msg = err instanceof AxiosError && err.response?.data
          ? (err.response.data as { detail?: string }).detail ?? (err as Error).message
          : (err as Error).message;
        addToast('error', msg);
      }
    },
  });

  const handleStartCreate = () => {
    form.reset();
    setEditingId(null);
    setShowForm(true);
  };

  const handleStartEdit = (ing: Ingrediente) => {
    form.setFieldValue("nombre", ing.nombre);
    form.setFieldValue("es_alergeno", ing.es_alergeno);
    form.setFieldValue("precio_actual", ing.precio_actual);
    form.setFieldValue("stock_actual", ing.stock_actual);
    setEditingId(ing.id);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    form.reset();
    setShowForm(false);
    setEditingId(null);
  };

  const handleExport = async () => {
    try {
      const allData = await ingredientesApi.getAll(0, 10000);
      const exportData = allData
        .filter((i) =>
          i.nombre.toLowerCase().includes(filter.toLowerCase())
        )
        .map(({ id, nombre, es_alergeno, precio_actual, stock_actual }) => ({
          id,
          nombre,
          "Es alergeno?": es_alergeno ? "Si" : "No",
          Precio: `$${Number(precio_actual).toFixed(2)}`,
          Stock: stock_actual,
        }));

      if (exportData.length === 0) {
        addToast('error', "No hay ingredientes para exportar");
        return;
      }
      exportToExcel(exportData, "ingredientes");
    } catch (e) {
      addToast('error', "Error al exportar: " + (e as Error).message);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Eliminar este ingrediente?")) return;
    try {
      await deleteMutation.mutateAsync(id);
      addToast('exito', 'Insumo eliminado');
    } catch (err) {
      addToast('error', (err as Error).message);
    }
  };

  const handleInlineStockSave = async (id: number) => {
    if (!inlineStockEdit) return;
    const val = Number(inlineStockEdit.value);
    if (isNaN(val) || val < 0) return;
    try {
      await ingredientesApi.updateStock(id, val);
      addToast('exito', 'Stock actualizado');
      setInlineStockEdit(null);
    } catch (err) {
      addToast('error', (err as Error).message);
    }
  };

  const handleInlinePrecioSave = async (id: number) => {
    if (!inlinePrecioEdit) return;
    const val = Number(inlinePrecioEdit.value);
    if (isNaN(val) || val < 0) return;
    try {
      await ingredientesApi.updatePrecio(id, val);
      addToast('exito', 'Precio actualizado');
      setInlinePrecioEdit(null);
    } catch (err) {
      addToast('error', (err as Error).message);
    }
  };

  const filtered = items.filter((i) =>
    i.nombre.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Insumos</h1>
      {isError && <div className="bg-red-100 text-red-700 p-2 mb-4 rounded">{(error as Error)?.message || "Error al cargar"}</div>}
      <div className="flex gap-2 mb-4 flex-wrap">
        <input type="text" placeholder="Filtrar por nombre..." value={filter}
          onChange={(e) => { setFilter(e.target.value); setPage(0); }}
          className="border px-3 py-1 rounded" />
        <button onClick={handleStartCreate}
          className="bg-green-600 text-white px-4 py-1 rounded cursor-pointer">+ Nuevo</button>
        <button onClick={handleExport}
          className="bg-blue-600 text-white px-4 py-1 rounded cursor-pointer">Exportar Excel</button>
      </div>
      {showForm && (
        <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void form.handleSubmit(); }} className="border p-4 mb-4 rounded bg-gray-50 flex gap-4 items-end flex-wrap">
          <div>
            <form.Field name="nombre" validators={{ onChange: required() }}>
              {(field) => (
                <>
                  <label className="block text-sm font-medium">Nombre</label>
                  <input value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    className="border px-2 py-1 rounded" required />
                </>
              )}
            </form.Field>
          </div>
          <div className="flex items-center gap-2">
            <form.Field name="es_alergeno">
              {(field) => (
                <>
                  <label className="text-sm font-medium">Es alergeno?</label>
                  <input type="checkbox" checked={field.state.value ?? true}
                    onChange={(e) => field.handleChange(e.target.checked)} />
                </>
              )}
            </form.Field>
          </div>
          <div>
            <form.Field name="precio_actual" validators={{ onChange: ({ value }) => value != null && value < 0 ? 'Debe ser mayor o igual a 0' : undefined }}>
              {(field) => (
                <>
                  <label className="block text-sm font-medium">Precio</label>
                  <input type="number" step="0.01" min="0" value={field.state.value}
                    onChange={(e) => field.handleChange(parseFloat(e.target.value) || 0)}
                    onBlur={field.handleBlur}
                    className="border px-2 py-1 rounded w-28" />
                </>
              )}
            </form.Field>
          </div>
          <div>
            <form.Field name="stock_actual" validators={{ onChange: ({ value }) => value != null && value < 0 ? 'Debe ser mayor o igual a 0' : undefined }}>
              {(field) => (
                <>
                  <label className="block text-sm font-medium">Stock actual</label>
                  <input type="number" step="1" min="0" value={field.state.value}
                    onChange={(e) => field.handleChange(parseInt(e.target.value) || 0)}
                    onBlur={field.handleBlur}
                    className="border px-2 py-1 rounded w-28" />
                </>
              )}
            </form.Field>
          </div>
          <button type="submit" className="bg-blue-600 text-white px-4 py-1 rounded cursor-pointer">
            {editingId ? "Actualizar" : "Crear"}</button>
          <button type="button" onClick={handleCloseForm}
            className="bg-gray-400 text-white px-4 py-1 rounded cursor-pointer">Cancelar</button>
        </form>
      )}
      {isLoading ? <p>Cargando...</p> : (
        <table className="w-full border-collapse border">
          <thead><tr className="bg-gray-200">
            <th className="border p-2 text-left">Codigo</th>
            <th className="border p-2 text-left">Nombre</th>
            <th className="border p-2 text-left">Es alergeno?</th>
            <th className="border p-2 text-left">Precio</th>
            <th className="border p-2 text-left">Stock</th>
            <th className="border p-2 text-left">Acciones</th>
          </tr></thead>
          <tbody>
            {filtered.map((ing) => (
              <tr key={ing.id} className="hover:bg-gray-100">
                <td className="border p-2">{ing.id}</td>
                <td className="border p-2">{ing.nombre}</td>
                <td className="border p-2">{ing.es_alergeno ? "Si" : "No"}</td>
                <td className="border p-2">
                  {inlinePrecioEdit?.id === ing.id ? (
                    <div className="flex gap-1 items-center">
                      <label className="text-xs text-gray-500">Nuevo precio:</label>
                      <input type="number" step="0.01" min="0"
                        value={inlinePrecioEdit.value}
                        onChange={(e) => setInlinePrecioEdit({ ...inlinePrecioEdit, value: e.target.value })}
                        className="border px-1 py-0.5 w-20 rounded text-sm" />
                      <button onClick={() => handleInlinePrecioSave(ing.id)}
                        className="bg-green-600 text-white px-2 py-0.5 rounded text-xs cursor-pointer">Guardar</button>
                      <button onClick={() => setInlinePrecioEdit(null)}
                        className="bg-gray-400 text-white px-2 py-0.5 rounded text-xs cursor-pointer">X</button>
                    </div>
                  ) : (
                    `$${Number(ing.precio_actual).toFixed(2)}`
                  )}
                </td>
                <td className="border p-2">
                  {inlineStockEdit?.id === ing.id ? (
                    <div className="flex gap-1 items-center">
                      <label className="text-xs text-gray-500">Nuevo stock:</label>
                      <input type="number" step="1" min="0"
                        value={inlineStockEdit.value}
                        onChange={(e) => setInlineStockEdit({ ...inlineStockEdit, value: e.target.value })}
                        className="border px-1 py-0.5 w-20 rounded text-sm" />
                      <button onClick={() => handleInlineStockSave(ing.id)}
                        className="bg-green-600 text-white px-2 py-0.5 rounded text-xs cursor-pointer">Guardar</button>
                      <button onClick={() => setInlineStockEdit(null)}
                        className="bg-gray-400 text-white px-2 py-0.5 rounded text-xs cursor-pointer">X</button>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-500">Actual: {ing.stock_actual}</span>
                  )}
                </td>
                <td className="border p-2">
                  <div className="flex gap-1 flex-wrap">
                    <button onClick={() => handleStartEdit(ing)}
                      className="bg-yellow-500 text-white px-2 py-1 rounded text-sm cursor-pointer">Editar</button>
                    <button onClick={() => setInlineStockEdit({ id: ing.id, value: String(ing.stock_actual) })}
                      className="bg-teal-600 text-white px-2 py-1 rounded text-sm cursor-pointer">Stock</button>
                    <button onClick={() => setInlinePrecioEdit({ id: ing.id, value: String(ing.precio_actual) })}
                      className="bg-purple-600 text-white px-2 py-1 rounded text-sm cursor-pointer">Precio</button>
                    <button onClick={() => handleDelete(ing.id)}
                      className="bg-red-600 text-white px-2 py-1 rounded text-sm cursor-pointer">Eliminar</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="border p-2 text-center text-gray-500">{filter ? "Sin resultados para el filtro" : "No hay insumos cargados"}</td></tr>}
          </tbody>
        </table>
      )}
      <div className="flex gap-2 mt-4 items-center">
        <button disabled={page === 0}
          onClick={() => setPage(page - 1)}
          className="bg-gray-300 px-3 py-1 rounded disabled:opacity-50 cursor-pointer">Anterior</button>
        <span>Pagina {page + 1}</span>
        <button disabled={items.length < PAGE_SIZE}
          onClick={() => setPage(page + 1)}
          className="bg-gray-300 px-3 py-1 rounded disabled:opacity-50 cursor-pointer">Siguiente</button>
      </div>
    </div>
  );
}
