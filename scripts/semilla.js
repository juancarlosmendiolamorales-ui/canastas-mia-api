// SOLO PARA DESARROLLO: borra canastas y pedidos y los vuelve a crear desde cero.
// Los usuarios del panel no se borran.
// Uso: npm run db:reiniciar
import { db } from "../src/db.js";
import { prepararBase } from "../src/preparar.js";

if (process.env.NODE_ENV === "production") {
  console.error("No se puede reiniciar la base de datos en producción.");
  process.exit(1);
}

await db.query("DROP TABLE IF EXISTS pedido_items, pedidos, productos, canastas");
const nuevas = await prepararBase();
console.log(`Listo: ${nuevas} canastas cargadas.`);
await db.end();
