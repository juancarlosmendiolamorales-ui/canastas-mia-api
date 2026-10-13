// Crea una cuenta para el panel, o le pone una contraseña nueva si ya existe.
// Uso: npm run usuario -- mia "Mia"
// La contraseña se genera al azar y se muestra una sola vez.
import { randomBytes } from "node:crypto";
import { db } from "../src/db.js";
import { hashearClave } from "../src/auth.js";

const [usuario, nombre] = process.argv.slice(2);
if (!usuario || !nombre) {
  console.log('Uso: npm run usuario -- <usuario> "<Nombre>"');
  process.exit(1);
}

const clave = randomBytes(9).toString("base64url"); // 12 caracteres
await db.query(
  `INSERT INTO usuarios (usuario, nombre, hash_clave) VALUES ($1, $2, $3)
   ON CONFLICT (usuario) DO UPDATE SET nombre = $2, hash_clave = $3`,
  [usuario.toLowerCase(), nombre, await hashearClave(clave)]
);
// Si ya existía, cierra sus sesiones abiertas.
await db.query("DELETE FROM sesiones WHERE usuario_id = (SELECT id FROM usuarios WHERE usuario = $1)", [usuario.toLowerCase()]);

console.log(`Usuario: ${usuario.toLowerCase()}\nContraseña: ${clave}\nGuárdala: no se vuelve a mostrar. Se puede cambiar desde el panel.`);
await db.end();
