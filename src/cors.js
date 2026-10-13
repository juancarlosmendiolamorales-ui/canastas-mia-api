// CORS: qué otras páginas pueden usar esta API desde el navegador.
// Por seguridad, el navegador bloquea que una página llame a un servidor de
// otra dirección, salvo que el servidor diga "esa página sí está permitida".
// Las direcciones permitidas van en CORS_ORIGENES, separadas por comas.
const POR_DEFECTO = process.env.NODE_ENV === "production"
  ? "https://canastas-mia.onrender.com" // el catálogo publicado
  : "http://localhost:8080";
const permitidos = new Set(
  (process.env.CORS_ORIGENES || POR_DEFECTO)
    .split(",").map((o) => o.trim()).filter(Boolean)
);

export function cors(req, res, next) {
  const origen = req.headers.origin;
  res.vary("Origin");
  if (origen && permitidos.has(origen)) {
    res.set("Access-Control-Allow-Origin", origen);
    res.set("Access-Control-Allow-Methods", "GET, POST");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "86400");
  }
  // El navegador pregunta primero con OPTIONS ("¿me dejas mandar esto?").
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
}
