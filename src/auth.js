// Login del panel: contraseñas, sesiones y cookies.
import { scrypt, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { db } from "./db.js";

const scryptAsync = promisify(scrypt);
const DURACION_SESION_MS = 7 * 24 * 60 * 60 * 1000; // 7 días
export const COOKIE = "sesion";

// Convierte una contraseña en "sal:hash". Scrypt es lento a propósito,
// para que adivinar contraseñas a la fuerza tome muchísimo tiempo.
export async function hashearClave(clave) {
  const sal = randomBytes(16).toString("hex");
  const hash = await scryptAsync(clave, sal, 64);
  return `${sal}:${hash.toString("hex")}`;
}

export async function claveCorrecta(clave, guardado) {
  const [sal, hash] = guardado.split(":");
  const calculado = await scryptAsync(clave, sal, 64);
  return timingSafeEqual(calculado, Buffer.from(hash, "hex"));
}

export const hashToken = (token) => createHash("sha256").update(token).digest("hex");

// Crea una sesión y devuelve el token que irá en la cookie.
export async function crearSesion(usuarioId) {
  const token = randomBytes(32).toString("base64url");
  await db.query(
    "INSERT INTO sesiones (hash_token, usuario_id, expira_en) VALUES ($1, $2, $3)",
    [hashToken(token), usuarioId, new Date(Date.now() + DURACION_SESION_MS)]
  );
  return token;
}

export async function cerrarSesion(token) {
  if (token) await db.query("DELETE FROM sesiones WHERE hash_token = $1", [hashToken(token)]);
}

// HttpOnly: JavaScript de la página no puede leerla (protege contra robo de sesión).
// SameSite=Strict: otras páginas no pueden usarla para hacer acciones a tu nombre.
export function opcionesCookie() {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: DURACION_SESION_MS,
    path: "/",
  };
}

export function leerCookie(req, nombre) {
  for (const parte of (req.headers.cookie || "").split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nombre) return decodeURIComponent(v.join("="));
  }
  return null;
}

// "Portero": deja pasar solo si hay una sesión válida. Guarda el usuario en req.usuario.
export async function requiereLogin(req, res, next) {
  const token = leerCookie(req, COOKIE);
  if (token) {
    const { rows } = await db.query(
      `SELECT u.id, u.usuario, u.nombre FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
       WHERE s.hash_token = $1 AND s.expira_en > now()`,
      [hashToken(token)]
    );
    if (rows.length) {
      req.usuario = rows[0];
      return next();
    }
  }
  res.status(401).json({ error: "Necesitas iniciar sesión" });
}
