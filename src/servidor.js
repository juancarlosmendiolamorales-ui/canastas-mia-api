// Servidor (backend) de Canastas MIA.
// Recibe pedidos del navegador y responde con datos en formato JSON.
import express from "express";
import { rutasCanastas } from "./rutas/canastas.js";
import { rutasPedidos } from "./rutas/pedidos.js";
import { rutasAdmin } from "./rutas/admin.js";
import { prepararBase } from "./preparar.js";

const app = express();
const PUERTO = process.env.PORT || 3000;

// En Render cada visita pasa por 3 intermediarios antes de llegar aquí:
// visitante → Cloudflare → balanceador de Render → servidor.
// Cada uno agrega una IP a la cabecera X-Forwarded-For; se toma la que agregó
// Cloudflare (la del visitante real). Las que el visitante escriba a mano
// quedan más a la izquierda y se ignoran.
// Si Render cambia su red, revisar con: TRUST_PROXY=<número de saltos>.
if (process.env.NODE_ENV === "production") app.set("trust proxy", Number(process.env.TRUST_PROXY || 3));

// Permite leer el JSON que manda el cliente en un POST (máximo 20 KB).
app.use(express.json({ limit: "20kb" }));

// Ruta de prueba: confirma que el servidor está vivo.
app.get("/", (req, res) => {
  res.json({ mensaje: "API de Canastas MIA funcionando" });
});

app.use("/canastas", rutasCanastas);
app.use("/pedidos", rutasPedidos);
app.use("/admin", rutasAdmin);

// El panel de administración es una página normal (HTML) en /panel.
app.use("/panel", express.static(new URL("../public/panel", import.meta.url).pathname));

// Si algo falla, responde en JSON sin mostrar detalles internos al cliente.
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "JSON mal escrito" });
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
});

// Antes de abrir, se asegura de que las tablas existan (no borra nada).
await prepararBase();

app.listen(PUERTO, () => {
  console.log(`Servidor en http://localhost:${PUERTO}`);
});
