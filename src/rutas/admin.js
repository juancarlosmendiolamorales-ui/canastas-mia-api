// Rutas del panel: login y manejo de pedidos. Todo menos /login pide sesión.
import { Router } from "express";
import { randomBytes } from "node:crypto";
import { db } from "../db.js";
import {
  COOKIE, claveCorrecta, hashearClave, crearSesion, cerrarSesion,
  opcionesCookie, leerCookie, requiereLogin, hashToken,
} from "../auth.js";

export const rutasAdmin = Router();

const ESTADOS = ["nuevo", "pagado", "en_preparacion", "entregado", "cancelado"];

// Freno contra quien prueba contraseñas una y otra vez:
// después de 5 intentos fallidos, ese usuario queda bloqueado 15 minutos.
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;
const intentos = new Map(); // usuario -> { cuenta, desde }

// Cuenta el intento ANTES de revisar la contraseña. Si se contara después,
// alguien podría mandar cientos de intentos al mismo tiempo y todos pasarían
// el control antes de que se registre el primer fallo.
// Devuelve false si ese usuario ya gastó sus intentos.
function usarIntento(usuario) {
  const ahora = Date.now();
  if (intentos.size > 10000) {
    // Limpia registros viejos para que la memoria no crezca sin fin.
    for (const [u, i] of intentos) if (ahora - i.desde > BLOQUEO_MS) intentos.delete(u);
  }
  let i = intentos.get(usuario);
  if (!i || ahora - i.desde > BLOQUEO_MS) i = { cuenta: 0, desde: ahora };
  if (i.cuenta >= MAX_INTENTOS) return false;
  i.cuenta++;
  intentos.set(usuario, i);
  return true;
}

// Hash de una contraseña al azar. Se usa cuando el usuario no existe, para que
// la respuesta tarde lo mismo que con un usuario real: si no, midiendo el
// tiempo se podría saber qué usuarios existen.
const HASH_FALSO = await hashearClave(randomBytes(16).toString("hex"));

// POST /admin/login  { usuario, clave }
rutasAdmin.post("/login", async (req, res) => {
  const usuario = String(req.body?.usuario || "").trim().toLowerCase();
  const clave = String(req.body?.clave || "");
  if (!usarIntento(usuario)) {
    return res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos." });
  }
  const { rows } = await db.query("SELECT id, nombre, hash_clave FROM usuarios WHERE usuario = $1", [usuario]);
  // Siempre se calcula un hash y siempre se da el mismo mensaje,
  // exista o no el usuario.
  const correcta = await claveCorrecta(clave, rows[0]?.hash_clave ?? HASH_FALSO);
  if (!rows.length || !correcta) {
    return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  }
  intentos.delete(usuario);
  const token = await crearSesion(rows[0].id);
  res.cookie(COOKIE, token, opcionesCookie());
  res.json({ nombre: rows[0].nombre });
});

rutasAdmin.post("/logout", async (req, res) => {
  await cerrarSesion(leerCookie(req, COOKIE));
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

// De aquí para abajo, todas las rutas necesitan sesión.
rutasAdmin.use(requiereLogin);

// GET /admin/yo: quién soy (para que el panel muestre "Hola, Mia").
rutasAdmin.get("/yo", (req, res) => {
  res.json(req.usuario);
});

// POST /admin/clave  { actual, nueva }: cambiar mi contraseña.
rutasAdmin.post("/clave", async (req, res) => {
  const actual = String(req.body?.actual || "");
  const nueva = String(req.body?.nueva || "");
  if (nueva.length < 10) {
    return res.status(400).json({ error: "La nueva contraseña debe tener al menos 10 caracteres" });
  }
  const { rows } = await db.query("SELECT hash_clave FROM usuarios WHERE id = $1", [req.usuario.id]);
  if (!(await claveCorrecta(actual, rows[0].hash_clave))) {
    return res.status(400).json({ error: "La contraseña actual no es correcta" });
  }
  await db.query("UPDATE usuarios SET hash_clave = $1 WHERE id = $2", [await hashearClave(nueva), req.usuario.id]);
  // Cierra las demás sesiones abiertas con la clave vieja (por ejemplo, en otro celular).
  await db.query(
    "DELETE FROM sesiones WHERE usuario_id = $1 AND hash_token <> $2",
    [req.usuario.id, hashToken(leerCookie(req, COOKIE))]
  );
  res.json({ ok: true });
});

// GET /admin/pedidos?estado=nuevo: lista de pedidos, los más recientes primero.
rutasAdmin.get("/pedidos", async (req, res) => {
  const { estado } = req.query;
  if (estado && !ESTADOS.includes(estado)) return res.status(400).json({ error: "Estado no válido" });
  const { rows } = await db.query(
    `SELECT p.codigo, p.nombre, p.apellido, p.celular, p.nota, p.metodo_pago, p.estado,
            p.total::float AS total, p.creado_en,
            json_agg(json_build_object('canasta', i.nombre_canasta, 'cantidad', i.cantidad,
                                       'precio', i.precio_unitario::float) ORDER BY i.id) AS items
     FROM pedidos p JOIN pedido_items i ON i.pedido_id = p.id
     WHERE $1::text IS NULL OR p.estado = $1
     GROUP BY p.id
     ORDER BY p.creado_en DESC
     LIMIT 200`,
    [estado || null]
  );
  res.json(rows);
});

// PATCH /admin/pedidos/MIA-7KQ2PX  { estado: "pagado" }: cambiar el estado.
rutasAdmin.patch("/pedidos/:codigo", async (req, res) => {
  const estado = req.body?.estado;
  if (!ESTADOS.includes(estado)) {
    return res.status(400).json({ error: `El estado debe ser: ${ESTADOS.join(", ")}` });
  }
  const { rows } = await db.query(
    "UPDATE pedidos SET estado = $1 WHERE codigo = $2 RETURNING codigo, estado",
    [estado, req.params.codigo.toUpperCase()]
  );
  if (!rows.length) return res.status(404).json({ error: "Pedido no encontrado" });
  res.json(rows[0]);
});
