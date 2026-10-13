// Límite simple de "N veces cada X minutos" por clave (por ejemplo, por IP).
// Guarda como mucho `maxRegistros` claves; si se llena, borra las más antiguas.
export function crearLimite({ max, ventanaMs, maxRegistros = 10000 }) {
  const registros = new Map(); // clave -> { cuenta, desde }  (en orden de llegada)
  return function permitir(clave) {
    const ahora = Date.now();
    let r = registros.get(clave);
    if (!r || ahora - r.desde > ventanaMs) {
      registros.delete(clave);
      r = { cuenta: 0, desde: ahora };
    }
    if (r.cuenta >= max) return false;
    r.cuenta++;
    registros.set(clave, r);
    for (const k of registros.keys()) {
      if (registros.size <= maxRegistros) break;
      registros.delete(k);
    }
    return true;
  };
}
