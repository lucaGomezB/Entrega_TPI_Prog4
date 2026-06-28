/**
 * IngredientesCRUD — Ingredients (insumos) management admin page.
 * Uses TanStack Query for data fetching and mutations.
 * Uses DataTable with server-side pagination.
 */
import { useState, useEffect, useCallback } from "react";
import { AxiosError } from "axios";
import type { Ingrediente, IngredienteCreate } from "@/features/productos/api/ingredientes";
import { ingredientesApi } from "@/features/productos/api/ingredientes";
import { useIngredientes, useCreateIngrediente, useUpdateIngrediente, useDeleteIngrediente } from "@/features/productos/hooks/useIngredientes";
import { exportToExcel } from "@/shared/utils/exportExcel";
import { useAppForm, required } from "@/shared/hooks/useAppForm";
import { addToast } from "@/shared/components/Toast";
import DataTable, { type DataTableColumn } from "@/shared/components/DataTable";
import type { UnidadMedida } from "@/features/unidades-medida/types";
import { unidadesMedidaApi } from "@/features/unidades-medida/api/unidadesMedidaApi";
import SearchFilter from "@/shared/components/SearchFilter";
import { usePagination } from "@/shared/hooks/usePagination";
import { getUserRoles } from "@/shared/api/client";
import ErrorBanner from "@/shared/components/ErrorBanner";
import { EditButton, DeleteButton } from "@/shared/components/ActionButton";
import FormFooter from "@/shared/components/FormFooter";

const DEFAULT_LIMIT = 10;

export default function IngredientesCRUD() {
  const [search, setSearch] = useState("");

  const { skip, limit, handlePageChange, handleLimitChange } = usePagination(DEFAULT_LIMIT);

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    handlePageChange(0);
  }, [handlePageChange]);

  const userRoles = getUserRoles();
  const esAdmin = userRoles.includes("ADMIN");
  const esStock = userRoles.includes("STOCK");
  const showId = esAdmin || esStock;

  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [inlineStockEdit, setInlineStockEdit] = useState<{ id: number; value: string } | null>(null);
  const [inlinePrecioEdit, setInlinePrecioEdit] = useState<{ id: number; value: string } | null>(null);
  const [unidades, setUnidades] = useState<UnidadMedida[]>([]);

  // Fetch measurement units for the dropdown
  useEffect(() => {
    unidadesMedidaApi.getAll().then(setUnidades).catch(() => {});
  }, []);

  // ── TanStack Query ──
  const { data, isLoading, isError, error } = useIngredientes(skip, limit, search || undefined);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

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
    defaultValues: { nombre: "", descripcion: "", es_alergeno: true, precio_actual: 0, stock_actual: 0, unidad_medida_id: null },
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
    form.setFieldValue("descripcion", ing.descripcion ?? "");
    form.setFieldValue("unidad_medida_id", ing.unidad_medida_id ?? null);
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
          i.nombre.toLowerCase().includes(search.toLowerCase())
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

  const columns: DataTableColumn<Ingrediente>[] = [
    ...(showId ? [{
      key: "id" as const,
      label: "Codigo",
      hideOnMobile: true,
      render: (ing: Ingrediente) => <span className="text-gray-500 text-xs">#{ing.id}</span>,
    }] : []),
    {
      key: "nombre",
      label: "Nombre",
      render: (ing) => (
        <span className="flex items-center gap-2">
          {ing.nombre}
          {ing.unidad_medida_simbolo && (
            <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
              {ing.unidad_medida_simbolo}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "descripcion",
      label: "Descripcion",
      render: (ing) => ing.descripcion ?? "—",
      hideOnMobile: true,
    },
    {
      key: "es_alergeno",
      label: "Alergeno?",
      render: (ing) => (ing.es_alergeno ? "Si" : "No"),
      hideOnMobile: true,
    },
    {
      key: "precio_actual",
      label: "Precio",
      render: (ing) =>
        inlinePrecioEdit?.id === ing.id ? (
          <div className="flex gap-1 items-center">
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
        ),
    },
    {
      key: "stock_actual",
      label: "Stock",
      render: (ing) =>
        inlineStockEdit?.id === ing.id ? (
          <div className="flex gap-1 items-center">
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
          <span>{ing.stock_actual}</span>
        ),
    },
    {
      key: "acciones",
      label: "Acciones",
      render: (ing) => (
        <div className="flex gap-1 flex-wrap">
          <EditButton onClick={() => handleStartEdit(ing)} />
          <button onClick={() => setInlineStockEdit({ id: ing.id, value: String(ing.stock_actual) })}
            className="bg-teal-600 text-white px-2 py-1 rounded text-sm cursor-pointer">Stock</button>
          <button onClick={() => setInlinePrecioEdit({ id: ing.id, value: String(ing.precio_actual) })}
            className="bg-purple-600 text-white px-2 py-1 rounded text-sm cursor-pointer">Precio</button>
          <DeleteButton onClick={() => handleDelete(ing.id)} />
        </div>
      ),
    },
  ];

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Insumos</h1>
      <ErrorBanner isError={isError} error={error} message="Error al cargar" />
      <div className="flex gap-2 mb-4 flex-wrap">
        <SearchFilter onSearch={handleSearch} placeholder="Filtrar por nombre..." />
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
          <div>
            <form.Field name="descripcion">
              {(field) => (
                <>
                  <label className="block text-sm font-medium">Descripcion</label>
                  <input value={field.state.value ?? ""}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    className="border px-2 py-1 rounded w-48" />
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
            <form.Field name="unidad_medida_id">
              {(field) => (
                <>
                  <label className="block text-sm font-medium">Unidad</label>
                  <select
                    value={field.state.value ?? ""}
                    onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : null)}
                    onBlur={field.handleBlur}
                    className="border px-1 py-1 rounded text-sm"
                  >
                    <option value="">--</option>
                    {unidades.map((u) => (
                      <option key={u.id} value={u.id}>{u.simbolo} ({u.nombre})</option>
                    ))}
                  </select>
                </>
              )}
            </form.Field>
          </div>
          <div>
            <form.Field name="precio_actual" validators={{ onChange: ({ value }) => value != null && value < 0 ? 'Debe ser mayor o igual a 0' : undefined }}>
              {(field) => (
                <>
                  <label className="block text-sm font-medium">
                    Precio
                    {(() => {
                      const uid = form.getFieldValue('unidad_medida_id');
                      if (uid) {
                        const u = unidades.find(un => un.id === uid);
                        if (u) return <span className="text-gray-500 font-normal"> / {u.simbolo}</span>;
                      }
                      return null;
                    })()}
                  </label>
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
          <FormFooter
            isSubmitting={false}
            isEditing={!!editingId}
            onCancel={handleCloseForm}
          />
        </form>
      )}
      <DataTable
        columns={columns}
        data={items}
        total={total}
        skip={skip}
        limit={limit}
        onPageChange={handlePageChange}
        onLimitChange={handleLimitChange}
        isLoading={isLoading}
      />
    </div>
  );
}
