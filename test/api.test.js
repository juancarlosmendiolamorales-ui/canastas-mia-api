// Pruebas de la API completa contra una base de datos de PRUEBA.
// Usa la base "canastas_pruebas" del mismo PostgreSQL local (la crea si falta)
// y la vacía al empezar: nunca toca la base de verdad ni la de Neon.
// Necesita Docker encendido: npm run db:encender
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const base = new URL(process.env.DATABASE_URL || "postgres://mia@localhost:5432/canastas");
if (!["localhost", "127.0.0.1"].includes(base.hostname)) {
  throw new Error("Las pruebas solo corren contra una base local, nunca contra la de internet.");
}
const NOMBRE_BASE = "canastas_pruebas";
const prueba = new URL(base);
prueba.pathname = "/" + NOMBRE_BASE;

let servidor, URL_API, db;
const CATALOGO = "http://localhost:8080"; // el origen permitido fuera de producción

async function pedir(ruta, { metodo = "GET", cuerpo, cookie, origen, crudo } = {}) {
  const headers = {};
  if (cuerpo !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  if (origen) headers.Origin = origen;
  const r = await fetch(URL_API + ruta, {
    method: metodo, headers, body: crudo ?? (cuerpo === undefined ? undefined : JSON.stringify(cuerpo)),
  });
  const texto = await r.text();
  return { status: r.status, headers: r.headers, json: texto ? JSON.parse(texto) : null };
}

const pedido = (extra = {}) => ({
  nombre: "Ana", apellido: "Pérez", celular: "+51 987 654 321", metodo_pago: "yape",
  items: [{ canasta_id: "c1", cantidad: 2 }], ...extra,
});

before(async () => {
  // 1. Crea la base de prueba si no existe.
  const admin = new pg.Client({ connectionString: base.href });
  await admin.connect();
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [NOMBRE_BASE]);
  if (!rowCount) await admin.query(`CREATE DATABASE ${NOMBRE_BASE}`);
  await admin.end();

  // 2. La app lee DATABASE_URL al importarse: se cambia ANTES de importarla.
  process.env.DATABASE_URL = prueba.href;
  delete process.env.CORS_ORIGENES;
  const { prepararBase } = await import("../src/preparar.js");
  const { hashearClave } = await import("../src/auth.js");
  ({ db } = await import("../src/db.js"));
  await prepararBase();

  // 3. Empieza de cero, con una canasta de precio conocido y una cuenta del panel.
  await db.query("TRUNCATE pedidos, pedido_items, reclamos, sesiones, usuarios RESTART IDENTITY CASCADE");
  await db.query("UPDATE canastas SET precio = 100, visible = true WHERE id = 'c1'");
  await db.query("UPDATE canastas SET visible = false WHERE id = 'c2'");
  await db.query("INSERT INTO usuarios (usuario, nombre, hash_clave) VALUES ('mia', 'Mia', $1)",
    [await hashearClave("clave-de-prueba-123")]);

  const { app } = await import("../src/app.js");
  servidor = app.listen(0);
  await new Promise((listo) => servidor.once("listening", listo));
  URL_API = `http://localhost:${servidor.address().port}`;
});

after(async () => {
  servidor?.close();
  await db?.end();
});

// ---------- General ----------

test("responde con las cabeceras de seguridad", async () => {
  const r = await pedir("/");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-powered-by"), null, "no dice que usa Express");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
});

test("dirección que no existe: 404 en JSON", async () => {
  const r = await pedir("/no-existe");
  assert.equal(r.status, 404);
  assert.deepEqual(r.json, { error: "No existe esa dirección" });
});

test("JSON mal escrito: 400 sin mostrar detalles internos", async () => {
  const r = await pedir("/pedidos", { metodo: "POST", cuerpo: {}, crudo: "{esto no es json" });
  assert.equal(r.status, 400);
  assert.deepEqual(r.json, { error: "JSON mal escrito" });
});

test("CORS: solo el catálogo está invitado", async () => {
  const invitado = await pedir("/canastas", { origen: CATALOGO });
  assert.equal(invitado.headers.get("access-control-allow-origin"), CATALOGO);
  const extrano = await pedir("/canastas", { origen: "https://pagina-trampa.com" });
  assert.equal(extrano.headers.get("access-control-allow-origin"), null);
});

// ---------- Canastas ----------

test("lista solo las canastas visibles, con sus productos", async () => {
  const r = await pedir("/canastas");
  assert.equal(r.status, 200);
  const ids = r.json.map((c) => c.id);
  assert.ok(ids.includes("c1"));
  assert.ok(!ids.includes("c2"), "c2 está oculta");
  assert.ok(r.json[0].productos.length > 0);
});

// ---------- Pedidos ----------

test("el precio lo pone el servidor, no el navegador", async () => {
  const trampa = pedido({ total: 1, items: [{ canasta_id: "c1", cantidad: 2, precio: 1 }] });
  const r = await pedir("/pedidos", { metodo: "POST", cuerpo: trampa });
  assert.equal(r.status, 201);
  assert.equal(r.json.total, 200, "2 x S/ 100 de la base de datos");
  assert.match(r.json.codigo, /^MIA-[A-Z0-9]{6}$/);
  const { rows } = await db.query("SELECT celular FROM pedidos WHERE codigo = $1", [r.json.codigo]);
  assert.equal(rows[0].celular, "987654321", "celular guardado sin +51 ni espacios");
});

test("tocar Enviar 3 veces guarda UN solo pedido (idempotencia)", async () => {
  const p = pedido({ clave_envio: "prueba-idempotencia-1" });
  const respuestas = [];
  for (let i = 0; i < 3; i++) respuestas.push(await pedir("/pedidos", { metodo: "POST", cuerpo: p }));
  assert.deepEqual(respuestas.map((r) => r.status), [201, 200, 200]);
  assert.equal(new Set(respuestas.map((r) => r.json.codigo)).size, 1, "siempre el mismo código");
  const { rows } = await db.query("SELECT count(*)::int AS n FROM pedidos WHERE clave_envio = $1", [p.clave_envio]);
  assert.equal(rows[0].n, 1);
});

test("dos envíos al MISMO tiempo tampoco se duplican", async () => {
  const p = pedido({ clave_envio: "prueba-a-la-vez-1" });
  const [a, b] = await Promise.all([
    pedir("/pedidos", { metodo: "POST", cuerpo: p }),
    pedir("/pedidos", { metodo: "POST", cuerpo: p }),
  ]);
  assert.equal(a.json.codigo, b.json.codigo);
  const { rows } = await db.query("SELECT count(*)::int AS n FROM pedidos WHERE clave_envio = $1", [p.clave_envio]);
  assert.equal(rows[0].n, 1);
});

test("canasta inexistente u oculta: 400 y no se guarda nada", async () => {
  const antes = (await db.query("SELECT count(*)::int AS n FROM pedidos")).rows[0].n;
  for (const canasta_id of ["c999", "c2"]) {
    const r = await pedir("/pedidos", {
      metodo: "POST", cuerpo: pedido({ items: [{ canasta_id: "c1", cantidad: 1 }, { canasta_id, cantidad: 1 }] }),
    });
    assert.equal(r.status, 400, canasta_id);
    assert.match(r.json.errores[0], /No existen las canastas/);
  }
  const despues = (await db.query("SELECT count(*)::int AS n FROM pedidos")).rows[0].n;
  assert.equal(despues, antes);
});

test("datos inválidos: 400 con la lista de errores", async () => {
  const r = await pedir("/pedidos", { metodo: "POST", cuerpo: pedido({ celular: "123", metodo_pago: "tarjeta" }) });
  assert.equal(r.status, 400);
  assert.equal(r.json.errores.length, 2);
});

test("inyección SQL: el texto se guarda como texto, no se ejecuta", async () => {
  const malicioso = "Robert'); DROP TABLE pedidos; --";
  const r = await pedir("/pedidos", { metodo: "POST", cuerpo: pedido({ nombre: malicioso }) });
  assert.equal(r.status, 201);
  const { rows } = await db.query("SELECT nombre FROM pedidos WHERE codigo = $1", [r.json.codigo]);
  assert.equal(rows[0].nombre, malicioso, "la tabla sigue ahí y el nombre se guardó tal cual");
});

test("consultar un pedido no muestra celular ni apellido", async () => {
  const { json: { codigo } } = await pedir("/pedidos", { metodo: "POST", cuerpo: pedido() });
  const r = await pedir(`/pedidos/${codigo.toLowerCase()}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.nombre, "Ana");
  assert.equal(r.json.celular, undefined);
  assert.equal(r.json.apellido, undefined);
  assert.deepEqual(r.json.items, [{ canasta: "Dulce Navidad", cantidad: 2 }]);
});

// ---------- Panel (login) ----------

test("el panel sin sesión responde 401 y no se guarda en caché", async () => {
  const r = await pedir("/admin/pedidos");
  assert.equal(r.status, 401);
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("login: mismo mensaje si el usuario no existe o la clave está mal", async () => {
  const noExiste = await pedir("/admin/login", { metodo: "POST", cuerpo: { usuario: "nadie", clave: "x" } });
  const claveMala = await pedir("/admin/login", { metodo: "POST", cuerpo: { usuario: "mia", clave: "x" } });
  assert.equal(noExiste.status, 401);
  assert.deepEqual(noExiste.json, claveMala.json);
});

test("login correcto: cookie segura y acceso a los pedidos", async () => {
  const r = await fetch(URL_API + "/admin/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario: "MIA ", clave: "clave-de-prueba-123" }),
  });
  assert.equal(r.status, 200);
  const galleta = r.headers.get("set-cookie");
  assert.match(galleta, /HttpOnly/i);
  assert.match(galleta, /SameSite=Strict/i);
  const cookie = galleta.split(";")[0];

  const pedidos = await pedir("/admin/pedidos", { cookie });
  assert.equal(pedidos.status, 200);
  assert.ok(pedidos.json.length >= 1);
  assert.equal(pedidos.json[0].celular, "987654321", "Mia sí ve el celular");

  const cambio = await pedir(`/admin/pedidos/${pedidos.json[0].codigo}`, {
    metodo: "PATCH", cookie, cuerpo: { estado: "pagado" },
  });
  assert.equal(cambio.json.estado, "pagado");

  await pedir("/admin/logout", { metodo: "POST", cookie });
  assert.equal((await pedir("/admin/pedidos", { cookie })).status, 401, "la pulsera ya no sirve");
});

test("demasiados intentos de login: 429", async () => {
  const intentos = [];
  for (let i = 0; i < 6; i++) {
    intentos.push((await pedir("/admin/login", { metodo: "POST", cuerpo: { usuario: "ladron", clave: `x${i}` } })).status);
  }
  assert.deepEqual(intentos, [401, 401, 401, 401, 401, 429]);
});

// ---------- Libro de Reclamaciones ----------

test("reclamo: devuelve el número de hoja y nunca los datos personales", async () => {
  const hoja = {
    clave_envio: "prueba-reclamo-1", tipo: "reclamo", bien: "producto",
    nombre: "Ana Pérez", tipo_documento: "DNI", documento: "12345678", domicilio: "Av. Siempre Viva 123",
    telefono: "987654321", email: "ana@ejemplo.com", descripcion_bien: "1 canasta Dulce Navidad",
    detalle: "Llegó un producto vencido", pedido_consumidor: "Cambio del producto",
  };
  const r = await pedir("/reclamos", { metodo: "POST", cuerpo: hoja });
  assert.equal(r.status, 201);
  assert.match(r.json.numero, /^R-\d{6}$/);
  assert.deepEqual(Object.keys(r.json).sort(), ["creado_en", "numero", "tipo"]);

  const otraVez = await pedir("/reclamos", { metodo: "POST", cuerpo: hoja });
  assert.equal(otraVez.json.numero, r.json.numero, "reenviar no crea otra hoja");
  assert.equal(otraVez.json.documento, undefined, "ni filtra el DNI");
});
