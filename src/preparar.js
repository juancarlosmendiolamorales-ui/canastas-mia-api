// Deja la base de datos lista: crea las tablas que falten y carga las canastas
// de datos/canastas.json que todavía no estén. Nunca borra nada.
import { readFile } from "node:fs/promises";
import { db } from "./db.js";

export async function prepararBase() {
  const esquema = await readFile(new URL("../sql/esquema.sql", import.meta.url), "utf-8");
  const canastas = JSON.parse(await readFile(new URL("../datos/canastas.json", import.meta.url), "utf-8"));

  await db.query(esquema);

  let nuevas = 0;
  for (const [i, c] of canastas.entries()) {
    // Los $1, $2... evitan la "inyección SQL": el dato nunca se mezcla con el código.
    const { rowCount } = await db.query(
      "INSERT INTO canastas (id, nombre, precio, orden) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
      [c.id, c.nombre, c.precio, i + 1]
    );
    if (!rowCount) continue; // ya existía: no se toca, por si la editaron
    nuevas++;
    for (const [j, p] of c.productos.entries()) {
      await db.query(
        "INSERT INTO productos (canasta_id, descripcion, orden) VALUES ($1, $2, $3)",
        [c.id, p, j + 1]
      );
    }
  }
  return nuevas;
}
