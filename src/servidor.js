// Servidor (backend) de Canastas MIA.
// Recibe pedidos del navegador y responde con datos en formato JSON.
import { app } from "./app.js";
import { prepararBase } from "./preparar.js";
import { sincronizarCanastas } from "./hoja.js";
import { db } from "./db.js";

const PUERTO = process.env.PORT || 3000;

// Antes de abrir, se asegura de que las tablas existan (no borra nada).
await prepararBase();

// La política de privacidad promete guardar los pedidos solo 2 años: los más
// antiguos se borran al arrancar y una vez al día. Los reclamos NO se tocan.
async function borrarPedidosViejos() {
  try {
    const { rowCount } = await db.query("DELETE FROM pedidos WHERE creado_en < now() - interval '2 years'");
    if (rowCount) console.log(`Se borraron ${rowCount} pedidos de hace más de 2 años`);
  } catch (e) {
    console.error("No se pudieron borrar pedidos viejos:", e.message);
  }
}
await borrarPedidosViejos();
setInterval(borrarPedidosViejos, 24 * 60 * 60 * 1000).unref();

// Las canastas (nombre, productos, precio, si se muestran) las maneja Mia desde
// la Google Sheet. Se copian a la base al arrancar y luego cada 5 minutos.
await sincronizarCanastas();
setInterval(sincronizarCanastas, 5 * 60 * 1000).unref();

app.listen(PUERTO, () => {
  console.log(`Servidor en http://localhost:${PUERTO}`);
});
