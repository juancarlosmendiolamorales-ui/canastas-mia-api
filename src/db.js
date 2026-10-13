// Conexión a la base de datos. Los demás archivos usan "db.query(...)".
import pg from "pg";

export const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
