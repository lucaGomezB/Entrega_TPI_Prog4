/**
 * DireccionSelector — Address selection component extracted from Carrito.
 *
 * Props receive all data from the parent; no shared form state.
 * Renders: retiro-en-local message (when esRetiroLocal) OR address dropdown
 * with "agregar nueva" option. Uses formatDireccion for display labels.
 */
import { formatDireccion, type DireccionEntrega } from '@/features/pedidos/api/direcciones'

interface DireccionSelectorProps {
  direccionSelId: number | "nueva" | null
  direcciones: DireccionEntrega[]
  loadingDirs: boolean
  esRetiroLocal: boolean
  onChange: (value: string) => void
  onNuevaDireccion: () => void
}

export function DireccionSelector({
  direccionSelId,
  direcciones,
  loadingDirs,
  esRetiroLocal,
  onChange,
  onNuevaDireccion,
}: DireccionSelectorProps) {
  return (
    <div className="border-t pt-4 mb-4">
      <h2 className="text-sm font-semibold text-gray-700 mb-2">Direccion de entrega</h2>
      {loadingDirs ? (
        <p className="text-sm text-gray-400">Cargando direcciones...</p>
      ) : esRetiroLocal ? (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-sm border border-green-300 bg-green-50 rounded px-3 py-2 text-green-800">
            Retiro en el local mas cercano (sin costo de envio)
          </span>
          <span className="text-xs text-green-600 font-medium whitespace-nowrap">Gratis</span>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <select
            value={direccionSelId === null ? "retiro" : direccionSelId}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "nueva") onNuevaDireccion();
              else onChange(val);
            }}
            className="border border-gray-300 rounded px-3 py-2 text-sm w-full sm:flex-1"
          >
            <option value="retiro">Retirar en el local mas cercano (gratis)</option>
            {direcciones.length > 0 && (
              <optgroup label="--- Tus direcciones ---">
                {direcciones.map((d) => (
                  <option key={d.id} value={d.id}>
                    {formatDireccion(d)}{d.es_principal ? " (Principal)" : ""}
                  </option>
                ))}
              </optgroup>
            )}
            <option value="nueva" disabled={direcciones.length >= 10}>
              + Agregar nueva direccion
            </option>
          </select>
          {direccionSelId === null ? (
            <span className="text-xs text-green-600 font-medium whitespace-nowrap">Retiro en local (gratis)</span>
          ) : (
            <span className="text-xs text-blue-600 font-medium whitespace-nowrap">Con envio (+$50.00)</span>
          )}
        </div>
      )}
    </div>
  )
}
