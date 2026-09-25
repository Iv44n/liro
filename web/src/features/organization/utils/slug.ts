/**
 * Convierte un nombre de organización en un slug estable y único por nombre.
 *
 * El slug es determinista (sin sufijos aleatorios) a propósito: si el
 * formulario se envía dos veces seguidas, ambos intentos generan el mismo
 * slug y la restricción `unique` del backend evita crear una organización
 * duplicada.
 */
export function slugify(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'organizacion'
}
