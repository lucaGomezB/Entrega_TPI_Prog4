/**
 * UnidadesMedidaAdminPage — Admin CRUD page for measurement units.
 *
 * Features:
 *   - Data table with columns: Nombre, Simbolo, Tipo, Acciones
 *   - Filter tabs/dropdown by tipo (todos, masa, volumen, unidad, area)
 *   - Inline create/edit form via UnidadMedidaForm
 *   - Delete with confirmation dialog; FK-protected (catches 400 errors)
 *   - Client-side pagination via DataTable
 *   - Gated to ADMIN role via router
 */
import { useState, useEffect, useCallback } from "react";
import type { UnidadMedida, UnidadMedidaCreate } from "@/features/unidades-medida/types";
import { unidadesMedidaApi } from "@/features/unidades-medida/api/unidadesMedidaApi";
import UnidadMedidaForm from "@/features/unidades-medida/components/UnidadMedidaForm";
import { addToast } from "@/shared/components/Toast";
import DataTable, { type DataTableColumn } from "@/shared/components/DataTable";

const DEFAULT_LIMIT = 10;

const TIPO_FILTERS = [
  { value: "", label: "Todos" },
  { value: "masa", label: "Masa" },
  { value: "volumen", label: "Volumen" },
  { value: "unidad", label: "Unidad" },
  { value: "area", label: "Area" },
];

export default function UnidadesMedidaAdminPage() {
  const [units, setUnits] = useState<UnidadMedida[]>([]);
  const [loading, setLoading] = useState(true);
  const [tipoFilter, setTipoFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<UnidadMedidaCreate | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);

  const fetchUnits = useCallback(async () => {
    setLoading(true);
    try {
      const data = await unidadesMedidaApi.getAll(tipoFilter || undefined);
      setUnits(data);
    } catch {
      addToast("error", "Error al cargar unidades de medida");
    } finally {
      setLoading(false);
    }
  }, [tipoFilter]);

  useEffect(() => {
    void fetchUnits();
  }, [fetchUnits]);

  const handleCreate = () => {
    setEditingId(null);
    setEditValues(undefined);
    setShowForm(true);
  };

  const handleEdit = (unit: UnidadMedida) => {
    setEditingId(unit.id);
    setEditValues({ nombre: unit.nombre, simbolo: unit.simbolo, tipo: unit.tipo });
    setShowForm(true);
  };

  const handleFormSubmit = async (data: UnidadMedidaCreate) => {
    setSubmitting(true);
    try {
      if (editingId) {
        await unidadesMedidaApi.update(editingId, {
          nombre: data.nombre,
          simbolo: data.simbolo,
          tipo: data.tipo,
        });
        addToast("exito", "Unidad de medida actualizada correctamente");
      } else {
        await unidadesMedidaApi.create(data);
        addToast("exito", "Unidad de medida creada correctamente");
      }
      setShowForm(false);
      setEditingId(null);
      void fetchUnits();
    } catch (err) {
      addToast("error", (err as Error)?.message || "Error al guardar");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (unit: UnidadMedida) => {
    if (!confirm(`Eliminar la unidad "${unit.nombre}"?`)) return;
    try {
      await unidadesMedidaApi.remove(unit.id);
      addToast("exito", "Unidad de medida eliminada correctamente");
      void fetchUnits();
    } catch (err) {
      const msg = (err as Error)?.message || "";
      if (msg.toLowerCase().includes("uso") || msg.toLowerCase().includes("referencia")) {
        addToast("error", `No se puede eliminar: la unidad "${unit.nombre}" esta en uso`);
      } else {
        addToast("error", "Error al eliminar la unidad de medida");
      }
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
  };

  // Client-side pagination
  const total = units.length;
  const pagedUnits = units.slice(skip, skip + limit);

  const handlePageChange = (newSkip: number) => setSkip(newSkip);
  const handleLimitChange = (newLimit: number) => { setLimit(newLimit); setSkip(0); };

  const columns: DataTableColumn<UnidadMedida>[] = [
    {
      key: "nombre",
      label: "Nombre",
      render: (u) => <span className="font-semibold text-gray-900">{u.nombre}</span>,
    },
    {
      key: "simbolo",
      label: "Simbolo",
      render: (u) => <span className="text-sm text-gray-600">{u.simbolo}</span>,
    },
    {
      key: "tipo",
      label: "Tipo",
      render: (u) => <span className="text-sm text-gray-600 capitalize">{u.tipo}</span>,
    },
    {
      key: "acciones",
      label: "Acciones",
      render: (unit) => (
        <div className="flex gap-1">
          <button
            onClick={() => handleEdit(unit)}
            className="bg-yellow-500 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-yellow-600"
          >
            Editar
          </button>
          <button
            onClick={() => handleDelete(unit)}
            className="bg-red-600 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-red-700"
          >
            Eliminar
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Unidades de Medida</h1>

      {/* Filter tabs + Create button */}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        {TIPO_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => { setTipoFilter(f.value); setSkip(0); }}
            className={`px-3 py-1 rounded text-sm cursor-pointer border ${
              tipoFilter === f.value
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="flex-1" />
        <button
          onClick={handleCreate}
          className="bg-green-600 text-white px-4 py-1.5 rounded cursor-pointer hover:bg-green-700"
        >
          + Nueva
        </button>
      </div>

      {/* Create/Edit form */}
      {showForm && (
        <UnidadMedidaForm
          editingId={editingId}
          initialValues={editValues}
          onSubmit={handleFormSubmit}
          onCancel={handleCancel}
          submitting={submitting}
        />
      )}

      {/* Data table with client-side pagination */}
      <DataTable
        columns={columns}
        data={pagedUnits}
        total={total}
        skip={skip}
        limit={limit}
        onPageChange={handlePageChange}
        onLimitChange={handleLimitChange}
        isLoading={loading}
      />
    </div>
  );
}
