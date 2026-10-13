// Conexión a la base de datos. Los demás archivos usan "db.query(...)".
import pg from "pg";

export const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Neon apaga la base cuando nadie la usa y corta las conexiones abiertas.
// Sin esto, ese corte llega como un error sin atender y tumba el servidor;
// así solo se anota y la próxima consulta abre una conexión nueva.
db.on("error", (e) => console.error("Conexión a la base cerrada:", e.message));
