// Mantiene las canastas de la base de datos iguales a la Google Sheet de Mia.
// El catálogo muestra lo que dice la hoja; si la base no se entera de un cambio
// (un precio nuevo, una canasta oculta), el panel mostraría otra cosa.
// Reglas iguales a las del catálogo: precio vacío o 0 = "por confirmar",
// Mostrar = NO la oculta, y si se borra la fila, la canasta deja de mostrarse.
import { createHash } from "node:crypto";
import { db } from "./db.js";

// HOJA_ID vacío apaga la sincronización (lo usan las pruebas).
const HOJA_ID = process.env.HOJA_ID ?? "1oHg_XLiX2UTA43lFUwkWnn8r77grOSZfo_Cucsfe5UI";
const URL_HOJA = `https://docs.google.com/spreadsheets/d/${HOJA_ID}/gviz/tq?tqx=out:csv`;

// Lee un CSV respetando las comillas: "1 Panetón, 1 Leche" es UN solo campo.
export function leerCSV(texto) {
  const filas = [];
  let fila = [], campo = "", entreComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') entreComillas = false;
      else campo += c;
    } else if (c === '"') entreComillas = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo); filas.push(fila); fila = []; campo = "";
    } else campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

// "S/ 1,250.50" -> 1250.5 · "120,5" -> 120.5 · vacío, 0 o texto -> null
export function leerPrecio(v) {
  let s = String(v ?? "").replace(/[^\d.,]/g, "");
  if (!s) return null;
  s = s.includes(",") && s.includes(".") ? s.replace(/,/g, "") : s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n * 100) / 100 : null;
}

// Convierte el CSV de la hoja en una lista de canastas. Ignora la fila de
// títulos y las filas sin un ID válido (c1, c2, ...).
export function leerHoja(texto) {
  const canastas = [];
  const vistos = new Set();
  for (const f of leerCSV(texto).slice(1)) {
    const id = (f[0] || "").trim();
    if (!/^c\d+$/.test(id) || vistos.has(id)) continue;
    vistos.add(id);
    canastas.push({
      id,
      nombre: (f[1] || "").trim().slice(0, 100),
      productos: (f[2] || "").split(",").map((p) => p.trim()).filter(Boolean).slice(0, 60),
      precio: leerPrecio(f[3]),
      visible: !/^no$/i.test((f[4] || "").trim()),
    });
  }
  return canastas;
}

// Copia la lista a la base, todo junto o nada (transacción).
// Solo toca canastas que la base ya conoce: una canasta nueva necesita su
// foto en el catálogo, así que la hoja sola no la puede crear.
export async function aplicarCanastas(lista) {
  if (!lista.length) return { cambiadas: 0 }; // hoja vacía o ilegible: no se toca nada
  const cliente = await db.connect();
  try {
    await cliente.query("BEGIN");
    const { rows: actuales } = await cliente.query("SELECT id FROM canastas");
    const existen = new Set(actuales.map((c) => c.id));
    const enHoja = new Set();
    let cambiadas = 0;
    for (const [i, c] of lista.entries()) {
      if (!existen.has(c.id)) continue;
      enHoja.add(c.id);
      const { rowCount } = await cliente.query(
        `UPDATE canastas SET nombre = COALESCE(NULLIF($2, ''), nombre), precio = $3, visible = $4, orden = $5
         WHERE id = $1 AND (nombre, precio, visible, orden) IS DISTINCT FROM
                           (COALESCE(NULLIF($2, ''), nombre), $3::numeric, $4, $5)`,
        [c.id, c.nombre, c.precio, c.visible, i + 1]
      );
      cambiadas += rowCount;
      if (c.productos.length) {
        const { rows } = await cliente.query(
          "SELECT descripcion FROM productos WHERE canasta_id = $1 ORDER BY orden", [c.id]
        );
        if (rows.map((r) => r.descripcion).join("\n") !== c.productos.join("\n")) {
          await cliente.query("DELETE FROM productos WHERE canasta_id = $1", [c.id]);
          for (const [j, p] of c.productos.entries()) {
            await cliente.query(
              "INSERT INTO productos (canasta_id, descripcion, orden) VALUES ($1, $2, $3)", [c.id, p, j + 1]
            );
          }
          cambiadas++;
        }
      }
    }
    // Una fila borrada de la hoja = canasta oculta (no se borra: hay pedidos que la usan).
    const { rowCount: ocultas } = await cliente.query(
      "UPDATE canastas SET visible = false WHERE visible AND NOT (id = ANY($1))", [[...enHoja]]
    );
    await cliente.query("COMMIT");
    return { cambiadas: cambiadas + ocultas };
  } catch (e) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }
}

let ultimaHuella = null;
let ultimaVez = 0;
let enCurso = null;

// Descarga la hoja y, solo si cambió desde la última vez, actualiza la base.
// Nunca lanza error: si Google falla, se quedan los datos que ya había.
export function sincronizarCanastas() {
  if (!HOJA_ID) return Promise.resolve();
  enCurso ??= (async () => {
    ultimaVez = Date.now();
    try {
      const r = await fetch(`${URL_HOJA}&t=${Date.now()}`, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`Google respondió ${r.status}`);
      const texto = await r.text();
      const huella = createHash("sha256").update(texto).digest("hex");
      if (huella === ultimaHuella) return;
      const { cambiadas } = await aplicarCanastas(leerHoja(texto));
      ultimaHuella = huella;
      if (cambiadas) console.log(`Hoja de canastas: ${cambiadas} cambios aplicados`);
    } catch (e) {
      console.error("No se pudo leer la hoja de canastas:", e.message);
    } finally {
      enCurso = null;
    }
  })();
  return enCurso;
}

// Para cuando llega un pedido con una canasta que la base no conoce: vuelve a
// mirar la hoja, pero como mucho una vez cada 30 segundos (si no, cualquiera
// podría hacer que el servidor descargue la hoja sin parar).
export async function sincronizarSiPasoUnRato() {
  if (Date.now() - ultimaVez < 30_000) return false;
  await sincronizarCanastas();
  return true;
}
