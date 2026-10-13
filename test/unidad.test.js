// Pruebas de las funciones sueltas: no necesitan base de datos ni servidor.
// Correr con: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { validarPedido, normalizarCelular, nuevoCodigo } from "../src/rutas/pedidos.js";
import { validarReclamo, numeroHoja } from "../src/rutas/reclamos.js";
import { claveIp } from "../src/ip.js";
import { crearLimite } from "../src/limite.js";
import { hashearClave, claveCorrecta } from "../src/auth.js";

const pedidoBueno = () => ({
  nombre: "Ana", apellido: "Pérez", celular: "987654321", metodo_pago: "yape",
  items: [{ canasta_id: "c1", cantidad: 2 }],
});

test("un pedido completo no tiene errores", () => {
  assert.deepEqual(validarPedido(pedidoBueno()), []);
});

test("el celular se acepta escrito de varias formas", () => {
  assert.equal(normalizarCelular("+51 987-654-321"), "987654321");
  assert.equal(normalizarCelular("987 654 321"), "987654321");
  for (const celular of ["+51 987 654 321", "51987654321", "987-654-321"]) {
    assert.deepEqual(validarPedido({ ...pedidoBueno(), celular }), [], celular);
  }
});

test("rechaza celulares que no son peruanos", () => {
  for (const celular of ["12345678", "887654321", "9876543210", "", "abc"]) {
    assert.ok(validarPedido({ ...pedidoBueno(), celular }).length, celular);
  }
});

test("junta todos los errores a la vez", () => {
  const errores = validarPedido({ nombre: "  ", items: [] });
  assert.ok(errores.length >= 5, errores.join(" | "));
});

test("rechaza más de 50 canastas distintas", () => {
  const items = Array.from({ length: 51 }, (_, i) => ({ canasta_id: `c${i}`, cantidad: 1 }));
  assert.deepEqual(validarPedido({ ...pedidoBueno(), items }), ["El pedido debe tener entre 1 y 50 canastas"]);
});

test("la cantidad debe ser un entero entre 1 y 500", () => {
  for (const cantidad of [0, -1, 1.5, 501, "2"]) {
    const p = { ...pedidoBueno(), items: [{ canasta_id: "c1", cantidad }] };
    assert.equal(validarPedido(p).length, 1, String(cantidad));
  }
});

test("el método de pago debe ser uno de los aceptados", () => {
  assert.equal(validarPedido({ ...pedidoBueno(), metodo_pago: "tarjeta" }).length, 1);
});

test("el código de pedido no usa letras que se confunden", () => {
  for (let i = 0; i < 200; i++) {
    const codigo = nuevoCodigo();
    assert.match(codigo, /^MIA-[A-HJ-NP-Z2-9]{6}$/);
  }
});

test("las hojas de reclamación se numeran con 6 cifras", () => {
  assert.equal(numeroHoja(7), "R-000007");
  assert.equal(numeroHoja(123456), "R-123456");
});

test("el reclamo exige los datos que pide INDECOPI", () => {
  const errores = validarReclamo({ tipo: "reclamo", bien: "producto", tipo_documento: "DNI" });
  for (const campo of ["nombre", "documento", "domicilio", "telefono", "email", "detalle", "pedido_consumidor"]) {
    assert.ok(errores.includes(`Falta: ${campo}`), campo);
  }
  assert.ok(!errores.includes("Falta: apoderado"), "apoderado es opcional");
});

test("IPv6: toda una red /64 cuenta como un solo visitante", () => {
  assert.equal(claveIp("2001:db8:1:2:aaaa::1"), claveIp("2001:db8:1:2:bbbb::9"));
  assert.notEqual(claveIp("2001:db8:1:2::1"), claveIp("2001:db8:1:3::1"));
  assert.equal(claveIp("::ffff:1.2.3.4"), "1.2.3.4");
});

test("el límite deja pasar N veces y luego frena", () => {
  const permitir = crearLimite({ max: 3, ventanaMs: 60_000 });
  assert.deepEqual([1, 2, 3, 4].map(() => permitir("ip-a")), [true, true, true, false]);
  assert.equal(permitir("ip-b"), true, "otra IP tiene su propio contador");
});

test("la contraseña se guarda como hash con sal, nunca tal cual", async () => {
  const a = await hashearClave("navidad2026");
  const b = await hashearClave("navidad2026");
  assert.ok(!a.includes("navidad2026"));
  assert.notEqual(a, b, "misma contraseña, distinto hash gracias a la sal");
  assert.equal(await claveCorrecta("navidad2026", a), true);
  assert.equal(await claveCorrecta("navidad2027", a), false);
});
