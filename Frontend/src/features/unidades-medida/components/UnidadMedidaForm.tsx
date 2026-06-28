/**
 * UnidadMedidaForm — Create/Edit form for measurement units.
 *
 * Used as an inline form (not a modal) embedded in the admin page.
 * When editingId is set, the form pre-fills with existing data and submits a PUT.
 * When editingId is null, the form is blank and submits a POST.
 */
import { useAppForm, required } from "@/shared/hooks/useAppForm";
import type { UnidadMedidaCreate } from "@/features/unidades-medida/types";
import type { UnidadMedidaTipo } from "@/features/unidades-medida/types";
import FormFooter from "@/shared/components/FormFooter";

const TIPO_OPTIONS: { value: UnidadMedidaTipo; label: string }[] = [
  { value: "masa", label: "Masa" },
  { value: "volumen", label: "Volumen" },
  { value: "unidad", label: "Unidad" },
  { value: "area", label: "Area" },
];

interface UnidadMedidaFormProps {
  editingId: number | null;
  initialValues?: UnidadMedidaCreate;
  onSubmit: (data: UnidadMedidaCreate) => Promise<void>;
  onCancel: () => void;
  submitting: boolean;
}

export default function UnidadMedidaForm({
  editingId,
  initialValues,
  onSubmit,
  onCancel,
  submitting,
}: UnidadMedidaFormProps) {
  const form = useAppForm<UnidadMedidaCreate>({
    defaultValues: initialValues ?? { nombre: "", simbolo: "", tipo: "masa" },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
      className="border p-4 mb-4 rounded bg-gray-50 grid grid-cols-2 gap-3"
    >
      <div>
        <label className="block text-sm font-medium">Nombre</label>
        <form.Field name="nombre" validators={{ onChange: required() }}>
          {(field) => (
            <input
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              className="border px-2 py-1 rounded w-full"
              placeholder="e.g. kilogramo"
            />
          )}
        </form.Field>
      </div>

      <div>
        <label className="block text-sm font-medium">Simbolo</label>
        <form.Field name="simbolo" validators={{ onChange: required() }}>
          {(field) => (
            <input
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              className="border px-2 py-1 rounded w-full"
              placeholder="e.g. kg"
            />
          )}
        </form.Field>
      </div>

      <div>
        <label className="block text-sm font-medium">Tipo</label>
        <form.Field name="tipo">
          {(field) => (
            <select
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value as UnidadMedidaTipo)}
              className="border px-2 py-1 rounded w-full"
            >
              {TIPO_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        </form.Field>
      </div>

      <div className="col-span-2 mt-2">
        <FormFooter
          isSubmitting={submitting}
          isEditing={!!editingId}
          onCancel={onCancel}
        />
      </div>
    </form>
  );
}
