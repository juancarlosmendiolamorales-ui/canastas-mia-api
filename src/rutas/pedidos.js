// Rutas para crear pedidos y ver en qué estado están.
import { Router } from "express";
import { randomInt } from "node:crypto";
import { db } from "../db.js";

export const rutasPedidos = Router();

const METODOS_PAGO = ["yape", "plin", "interbank"];

// Revisa que el pedido venga completo y con datos que tengan sentido.
// Devuelve la lista de errores (vacía si todo está bien).
function validarPedido(p) {
  const errores = [];
  if (!p || typeof p !== "object") return ["El pedido debe ser un objeto JSON"];
  for (const campo of ["nombre", "apellido"]) {
    if (typeof p[campo] !== "string" || !p[campo].trim()) errores.push(`Falta el ${campo}`);
  }
  if (typeof p.celular !== "string" || !/^9\d{8}$/.test(p.celular.replace(/\s/g, ""))) {
    errores.push("El celular debe tener 9 dígitos y empezar con 9");
  }
  if (!METODOS_PAGO.includes(p.metodo_pago)) {
    errores.push(`El método de pago debe ser: ${METODOS_PAGO.join(", ")}`);
  }
  if (p.nota != null && typeof p.nota !== "string") errores.push("La nota debe ser texto");
  if (!Array.isArray(p.items) || !p.items.length) {
    errores.push("El pedido debe tener al menos una canasta");
  } else {
    p.items.forEach((item, i) => {
      if (typeof item?.canasta_id !== "string") errores.push(`Canasta ${i + 1}: falta canasta_id`);
      if (!Number.isInteger(item?.cantidad) || item.cantidad < 1 || item.cantidad > 500) {
        errores.push(`Canasta ${i + 1}: la cantidad debe ser un número entero entre 1 y 500`);
      }
    });
  }
  return errores;
}

// Código corto y fácil de dictar por teléfono (sin 0/O ni 1/I).
function nuevoCodigo() {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let codigo = "MIA-";
  for (let i = 0; i < 6; i++) codigo += letras[randomInt(letras.length)];
  return codigo;
}

// POST /pedidos: el cliente manda su pedido y se guarda en la base de datos.
rutasPedidos.post("/", async (req, res) => {
  const errores = validarPedido(req.body);
  if (errores.length) return res.status(400).json({ errores });
  const p = req.body;

  // Precio y nombre salen de la base de datos, nunca del cliente,
  // para que nadie pueda mandar un precio inventado.
  const ids = [...new Set(p.items.map((i) => i.canasta_id))];
  const { rows: canastas } = await db.query(
    "SELECT id, nombre, precio FROM canastas WHERE visible AND id = ANY($1)",
    [ids]
  );
  const porId = Object.fromEntries(canastas.map((c) => [c.id, c]));
  const noExisten = ids.filter((id) => !porId[id]);
  if (noExisten.length) {
    return res.status(400).json({ errores: [`No existen las canastas: ${noExisten.join(", ")}`] });
  }

  // El total solo se calcula si todas las canastas tienen precio.
  const todasConPrecio = p.items.every((i) => porId[i.canasta_id].precio != null);
  const total = todasConPrecio
    ? p.items.reduce((suma, i) => suma + Number(porId[i.canasta_id].precio) * i.cantidad, 0)
    : null;

  // Transacción: se guarda el pedido y sus canastas juntos, o no se guarda nada.
  const cliente = await db.connect();
  try {
    await cliente.query("BEGIN");
    const { rows: [pedido] } = await cliente.query(
      `INSERT INTO pedidos (codigo, nombre, apellido, celular, nota, metodo_pago, total)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, codigo, estado, creado_en`,
      [nuevoCodigo(), p.nombre.trim(), p.apellido.trim(), p.celular.replace(/\s/g, ""),
       p.nota?.trim() || null, p.metodo_pago, total]
    );
    for (const i of p.items) {
      const c = porId[i.canasta_id];
      await cliente.query(
        `INSERT INTO pedido_items (pedido_id, canasta_id, nombre_canasta, precio_unitario, cantidad)
         VALUES ($1, $2, $3, $4, $5)`,
        [pedido.id, c.id, c.nombre, c.precio, i.cantidad]
      );
    }
    await cliente.query("COMMIT");
    res.status(201).json({ codigo: pedido.codigo, estado: pedido.estado, total, creado_en: pedido.creado_en });
  } catch (e) {
    await cliente.query("ROLLBACK");
    throw e;
  } finally {
    cliente.release();
  }
});

// GET /pedidos/MIA-7KQ2PX: el cliente ve el estado de su pedido.
// No devuelve celular ni apellido: cualquiera con el código podría verlo.
rutasPedidos.get("/:codigo", async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.codigo, p.nombre, p.estado, p.total::float AS total, p.creado_en,
            json_agg(json_build_object('canasta', i.nombre_canasta, 'cantidad', i.cantidad)
                     ORDER BY i.id) AS items
     FROM pedidos p JOIN pedido_items i ON i.pedido_id = p.id
     WHERE p.codigo = $1
     GROUP BY p.id`,
    [req.params.codigo.toUpperCase()]
  );
  if (!rows.length) return res.status(404).json({ error: "Pedido no encontrado" });
  res.json(rows[0]);
});
