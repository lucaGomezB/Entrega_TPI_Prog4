/**
 * Formats a number or numeric string as Argentine Peso currency.
 *
 * @param value - The number or numeric string to format.
 * @returns A locale-formatted currency string (e.g., "$ 1.234,56").
 */
export function formatCurrency(value: string | number): string {
  const num = typeof value === "string" ? Number(value) : value;
  return num.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}
