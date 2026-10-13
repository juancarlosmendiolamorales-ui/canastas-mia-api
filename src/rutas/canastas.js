// Rutas para ver las canastas del catálogo.
import { Router } from "express";
import { db } from "../db.js";

export const rutasCanastas = Router();

// Junta cada canasta con su lista de productos, en el orden de la página.
const CONSULTA_CANASTAS = `
  SELECT c.id, c.nombre, c.precio::float AS precio,
         COALESCE(json_agg(p.descripcion ORDER BY p.orden)
                  FILTER (WHERE p.id IS NOT NULL), '[]') AS productos
  FROM canastas c
  LEFT JOIN productos p ON p.canasta_id = c.id
  WHERE c.visible
`;

// GET /canastas: devuelve todas las canastas visibles.
rutasCanastas.get("/", async (req, res) => {
  const { rows } = await db.query(CONSULTA_CANASTAS + " GROUP BY c.id ORDER BY c.orden");
  res.json(rows);
});

// GET /canastas/c3: devuelve una sola canasta por su id.
rutasCanastas.get("/:id", async (req, res) => {
  const { rows } = await db.query(CONSULTA_CANASTAS + " AND c.id = $1 GROUP BY c.id", [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "Canasta no encontrada" });
  res.json(rows[0]);
});
