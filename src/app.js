// La aplicación de Canastas MIA: rutas y cabeceras de seguridad.
// No abre el puerto: eso lo hace servidor.js. Así las pruebas pueden usarla
// sin encender el servidor de verdad.
import express from "express";
import { rutasCanastas } from "./rutas/canastas.js";
import { rutasPedidos } from "./rutas/pedidos.js";
import { rutasAdmin } from "./rutas/admin.js";
import { rutasReclamos } from "./rutas/reclamos.js";
import { cors } from "./cors.js";

export const app = express();
const PRODUCCION = process.env.NODE_ENV === "production";

// No anunciar que el servidor usa Express (es una pista gratis para atacantes).
app.disable("x-powered-by");

// En Render cada visita pasa por 3 intermediarios antes de llegar aquí:
// visitante → Cloudflare → balanceador de Render → servidor.
// Cada uno agrega una IP a la cabecera X-Forwarded-For; se toma la que agregó
// Cloudflare (la del visitante real). Las que el visitante escriba a mano
// quedan más a la izquierda y se ignoran.
// Si Render cambia su red, revisar con: TRUST_PROXY=<número de saltos>.
if (PRODUCCION) app.set("trust proxy", Number(process.env.TRUST_PROXY || 3));

// Cabeceras de seguridad en todas las respuestas (lo mismo que haría "helmet"):
//  - CSP: el panel solo puede cargar scripts y datos de este mismo servidor,
//    así un texto malicioso guardado en un pedido no puede ejecutar código.
//  - frame-ancestors / X-Frame-Options: nadie puede meter el panel dentro de
//    otra página para engañar a Mia y hacerla tocar botones (clickjacking).
//  - nosniff: el navegador no "adivina" tipos de archivo.
//  - HSTS: el navegador siempre usa https.
app.use((req, res, next) => {
  res.set({
    "Content-Security-Policy":
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
      "connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  });
  if (PRODUCCION) res.set("Strict-Transport-Security", "max-age=31536000");
  next();
});

// Permite leer el JSON que manda el cliente en un POST (máximo 20 KB).
app.use(express.json({ limit: "20kb" }));

// Ruta de prueba: confirma que el servidor está vivo.
app.get("/", (req, res) => {
  res.json({ mensaje: "API de Canastas MIA funcionando" });
});

// El catálogo (otra página) solo usa estas dos rutas. El panel vive aquí
// mismo, así que /admin no necesita CORS.
app.use("/canastas", cors, rutasCanastas);
app.use("/pedidos", cors, rutasPedidos);
app.use("/reclamos", cors, rutasReclamos);
// Lo del panel tiene datos personales: que el navegador no lo guarde en caché.
app.use("/admin", (req, res, next) => { res.set("Cache-Control", "no-store"); next(); }, rutasAdmin);

// El panel de administración es una página normal (HTML) en /panel.
app.use("/panel", express.static(new URL("../public/panel", import.meta.url).pathname));

// Cualquier otra dirección: 404 en JSON.
app.use((req, res) => res.status(404).json({ error: "No existe esa dirección" }));

// Si algo falla, responde en JSON sin mostrar detalles internos al cliente.
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "JSON mal escrito" });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Los datos enviados son demasiado grandes" });
  if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: "Solicitud no válida" });
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
});
