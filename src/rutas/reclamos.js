// Libro de Reclamaciones virtual: el cliente deja su reclamo o queja y recibe
// una hoja con número correlativo. Mia los ve y responde desde el panel.
import { Router } from "express";
import { db } from "../db.js";
import { claveIp } from "../ip.js";
import { crearLimite } from "../limite.js";

export const rutasReclamos = Router();

const permitirReclamo = crearLimite({ max: 5, ventanaMs: 60 * 60 * 1000 });

// campo -> largo máximo. Todos son obligatorios salvo los que están en OPCIONALES.
const TEXTOS = {
  nombre: 150, documento: 20, domicilio: 250, telefono: 20, email: 150, apoderado: 150,
  descripcion_bien: 500, codigo_pedido: 20, detalle: 3000, pedido_consumidor: 2000,
};
const OPCIONALES = ["apoderado", "codigo_pedido"];

export const numeroHoja = (id) => "R-" + String(id).padStart(6, "0");

function validarReclamo(r) {
  if (!r || typeof r !== "object") return ["Los datos deben ser un objeto JSON"];
  const errores = [];
  for (const [campo, max] of Object.entries(TEXTOS)) {
    const v = r[campo];
    if (v == null || v === "") {
      if (!OPCIONALES.includes(campo)) errores.push(`Falta: ${campo}`);
    } else if (typeof v !== "string" || !v.trim()) errores.push(`${campo} no es válido`);
    else if (v.length > max) errores.push(`${campo} es demasiado largo`);
  }
  if (!["reclamo", "queja"].includes(r.tipo)) errores.push("El tipo debe ser reclamo o queja");
  if (!["DNI", "CE", "Pasaporte", "RUC"].includes(r.tipo_documento)) errores.push("Tipo de documento no válido");
  if (!["producto", "servicio"].includes(r.bien)) errores.push("Indica si es un producto o un servicio");
  if (typeof r.email === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email.trim())) errores.push("El correo no es válido");
  if (r.monto != null && r.monto !== "" && !(Number(r.monto) >= 0 && Number(r.monto) < 1e8)) errores.push("El monto no es válido");
  if (r.clave_envio != null && (typeof r.clave_envio !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(r.clave_envio))) {
    errores.push("clave_envio no es válida");
  }
  return errores;
}

const COLUMNAS = `id, tipo, nombre, tipo_documento, documento, domicilio, telefono, email, apoderado,
  bien, monto::float AS monto, descripcion_bien, codigo_pedido, detalle, pedido_consumidor, creado_en`;

// POST /reclamos: guarda la hoja y devuelve su número y una copia de lo registrado.
rutasReclamos.post("/", async (req, res) => {
  const errores = validarReclamo(req.body);
  if (errores.length) return res.status(400).json({ errores });
  const r = req.body;

  const buscar = async () =>
    (await db.query(`SELECT ${COLUMNAS} FROM reclamos WHERE clave_envio = $1`, [r.clave_envio])).rows[0];
  if (r.clave_envio) {
    const ya = await buscar();
    if (ya) return res.json({ ...ya, numero: numeroHoja(ya.id) });
  }
  if (!permitirReclamo(claveIp(req.ip))) {
    return res.status(429).json({ errores: ["Demasiados envíos seguidos. Intenta más tarde o escríbenos a canastademia@gmail.com."] });
  }

  const t = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  try {
    const { rows: [h] } = await db.query(
      `INSERT INTO reclamos (clave_envio, tipo, nombre, tipo_documento, documento, domicilio, telefono, email,
         apoderado, bien, monto, descripcion_bien, codigo_pedido, detalle, pedido_consumidor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING ${COLUMNAS}`,
      [r.clave_envio || null, r.tipo, t(r.nombre), r.tipo_documento, t(r.documento), t(r.domicilio),
       t(r.telefono), t(r.email), t(r.apoderado), r.bien, r.monto === "" || r.monto == null ? null : Number(r.monto),
       t(r.descripcion_bien), t(r.codigo_pedido), t(r.detalle), t(r.pedido_consumidor)]
    );
    res.status(201).json({ ...h, numero: numeroHoja(h.id) });
  } catch (e) {
    if (e.code === "23505" && e.constraint?.includes("clave_envio")) {
      const ya = await buscar();
      return res.json({ ...ya, numero: numeroHoja(ya.id) });
    }
    throw e;
  }
});
