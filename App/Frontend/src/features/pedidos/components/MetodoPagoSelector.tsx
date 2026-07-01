/**
 * MetodoPagoSelector — Payment method radio buttons extracted from Carrito.
 *
 * Renders three radio buttons: PAGO_LOCAL, MERCADOPAGO, and TRANSFERENCIA.
 * EFECTIVO was removed (duplicate of PAGO_LOCAL) — see change locales-retiro-y-eliminar-efectivo.
 * Props receive the current value and change handler from parent.
 */
interface MetodoPagoSelectorProps {
  formaPago: string
  onChange: (value: string) => void
}

export function MetodoPagoSelector({ formaPago, onChange }: MetodoPagoSelectorProps) {
  return (
    <div className="border-t pt-4 mb-4">
      <h2 className="text-sm font-semibold text-gray-700 mb-2">Metodo de pago</h2>
      <div className="flex gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="formaPago"
            value="PAGO_LOCAL"
            checked={formaPago === "PAGO_LOCAL"}
            onChange={() => onChange("PAGO_LOCAL")}
            className="cursor-pointer"
          />
          <span className="text-sm">Pago y retiro en local</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="formaPago"
            value="MERCADOPAGO"
            checked={formaPago === "MERCADOPAGO"}
            onChange={() => onChange("MERCADOPAGO")}
            className="cursor-pointer"
          />
          <span className="text-sm">MercadoPago (tarjeta/debito)</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="formaPago"
            value="TRANSFERENCIA"
            checked={formaPago === "TRANSFERENCIA"}
            onChange={() => onChange("TRANSFERENCIA")}
            className="cursor-pointer"
          />
          <span className="text-sm">Transferencia bancaria</span>
        </label>
      </div>
    </div>
  )
}
