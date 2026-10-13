const ESTADOS = [
  ["nuevo", "Nuevo"], ["pagado", "Pagado"], ["en_preparacion", "En preparación"],
  ["entregado", "Entregado"], ["cancelado", "Cancelado"],
];
const NOMBRE_ESTADO = Object.fromEntries(ESTADOS);
const PAGOS = { yape: "Yape", plin: "Plin", interbank: "Interbank" };
const $ = (id) => document.getElementById(id);
let pedidos = [];
let filtro = "nuevo";
let reclamos = [];

// Llama a la API y devuelve el JSON. Si la sesión venció, vuelve al login.
async function api(ruta, opciones = {}) {
  let r;
  try {
    r = await fetch("/admin" + ruta, {
      ...opciones,
      headers: opciones.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch {
    throw new Error("No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.");
  }
  const datos = await r.json().catch(() => ({}));
  if (r.status === 401 && ruta !== "/login" && ruta !== "/clave") { mostrarLogin(); throw new Error("sesión"); }
  if (!r.ok) throw new Error(datos.error || "Algo salió mal");
  return datos;
}

function avisar(texto) {
  const a = $("aviso");
  a.textContent = texto; a.hidden = false;
  clearTimeout(avisar.t); avisar.t = setTimeout(() => (a.hidden = true), 2500);
}

function mostrarLogin() {
  $("vista-panel").hidden = true; $("vista-login").hidden = false; $("l-usuario").focus();
}

async function mostrarPanel(nombre) {
  $("hola").textContent = "Hola, " + nombre;
  $("vista-login").hidden = true; $("vista-panel").hidden = false;
  await cargar();
}

async function cargar() {
  [pedidos, reclamos] = await Promise.all([api("/pedidos"), api("/reclamos")]);
  pintar();
  pintarReclamos();
}

// Crea un elemento con texto seguro (nunca se interpreta como HTML).
function el(tag, props = {}, ...hijos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) k.includes("-") ? e.setAttribute(k, v) : (e[k] = v);
  e.append(...hijos.filter((h) => h != null));
  return e;
}

const soles = (n) => "S/ " + n.toFixed(2);
const fecha = (iso) => new Date(iso).toLocaleString("es-PE", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Lima" });

function pintar() {
  const cuenta = (est) => pedidos.filter((p) => !est || p.estado === est).length;
  $("filtros").replaceChildren(
    ...[["", "Todos"], ...ESTADOS].map(([est, nombre]) => {
      const b = el("button", { type: "button" }, nombre, el("span", { className: "n", textContent: cuenta(est) }));
      b.setAttribute("aria-pressed", filtro === est);
      b.onclick = () => { filtro = est; pintar(); };
      return b;
    })
  );

  const visibles = pedidos.filter((p) => !filtro || p.estado === filtro);
  $("resumen").textContent = visibles.length + (visibles.length === 1 ? " pedido" : " pedidos");
  if (!visibles.length) {
    $("lista").replaceChildren(el("p", { className: "vacio", textContent: "No hay pedidos aquí." }));
    return;
  }

  $("lista").replaceChildren(...visibles.map((p) => {
    const select = el("select", { "aria-label": "Estado del pedido " + p.codigo },
      ...ESTADOS.map(([v, n]) => el("option", { value: v, textContent: n, selected: v === p.estado })));
    select.onchange = async () => {
      const anterior = p.estado;
      try {
        await api("/pedidos/" + p.codigo, { method: "PATCH", body: JSON.stringify({ estado: select.value }) });
        p.estado = select.value;
        avisar(p.codigo + " → " + NOMBRE_ESTADO[p.estado]);
        pintar();
      } catch (e) {
        select.value = anterior;
        if (e.message !== "sesión") avisar(e.message);
      }
    };

    const wa = el("a", {
      href: "https://wa.me/51" + p.celular, target: "_blank", rel: "noopener",
      textContent: p.celular.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3"),
    });

    const tarjeta = el("article", { className: "pedido" },
      el("div", { className: "top" },
        el("span", { className: "codigo", textContent: p.codigo }),
        el("span", { className: "fecha", textContent: fecha(p.creado_en) })),
      el("p", { className: "cliente", textContent: p.nombre + " " + p.apellido }),
      el("p", { className: "contacto" }, "WhatsApp: ", wa, " · " + PAGOS[p.metodo_pago]),
      el("ul", {}, ...p.items.map((i) => el("li", {
        textContent: i.cantidad + " × " + i.canasta + (i.precio != null ? " (" + soles(i.precio) + ")" : ""),
      }))),
      p.nota ? el("p", { className: "nota", textContent: "📝 " + p.nota }) : null,
      el("div", { className: "pie" },
        p.total != null
          ? el("span", { className: "total", textContent: "Total: " + soles(p.total) })
          : el("span", { className: "total sin", textContent: "Precio por confirmar" }),
        select)
    );
    tarjeta.style.setProperty("--color", `var(--${p.estado})`);
    return tarjeta;
  }));
}

$("form-login").onsubmit = async (e) => {
  e.preventDefault();
  $("l-error").textContent = "";
  try {
    const { nombre } = await api("/login", {
      method: "POST",
      body: JSON.stringify({ usuario: $("l-usuario").value, clave: $("l-clave").value }),
    });
    $("l-clave").value = "";
    await mostrarPanel(nombre);
  } catch (err) {
    $("l-error").textContent = err.message;
  }
};

$("btn-salir").onclick = async () => { await api("/logout", { method: "POST" }).catch(() => {}); mostrarLogin(); };
$("btn-recargar").onclick = () => cargar().then(() => avisar("Actualizado")).catch(() => {});

$("btn-clave").onclick = () => { $("form-clave").reset(); $("c-error").textContent = ""; $("dlg-clave").showModal(); };
$("c-cancelar").onclick = () => $("dlg-clave").close();
$("form-clave").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api("/clave", { method: "POST", body: JSON.stringify({ actual: $("c-actual").value, nueva: $("c-nueva").value }) });
    $("dlg-clave").close();
    avisar("Contraseña cambiada");
  } catch (err) {
    $("c-error").textContent = err.message;
  }
};

// ----- Pestañas -----
function verPestana(cual) {
  for (const t of ["pedidos", "reclamos"]) {
    $("tab-" + t).setAttribute("aria-selected", t === cual);
    $("sec-" + t).hidden = t !== cual;
  }
}
$("tab-pedidos").onclick = () => verPestana("pedidos");
$("tab-reclamos").onclick = () => verPestana("reclamos");

// ----- Libro de Reclamaciones -----
// Fecha límite: 15 días hábiles (lunes a viernes) desde que llegó el reclamo.
// No descuenta feriados, así que la fecha real es igual o un poco después.
function fechaLimite(iso) {
  const d = new Date(iso);
  for (let n = 0; n < 15; ) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) n++;
  }
  return d;
}
const soloFecha = (d) => new Date(d).toLocaleDateString("es-PE", { dateStyle: "long", timeZone: "America/Lima" });

// Texto de la hoja, para mandarla por correo al cliente.
function textoHoja(r) {
  const filas = [
    "LIBRO DE RECLAMACIONES - Canastas MIA",
    "Hoja de reclamación N.° " + r.numero + " · " + fecha(r.creado_en),
    "",
    "1. Consumidor: " + r.nombre,
    r.tipo_documento + ": " + r.documento,
    "Domicilio: " + r.domicilio,
    "Teléfono: " + r.telefono + " · Correo: " + r.email,
    r.apoderado ? "Padre/madre o apoderado: " + r.apoderado : null,
    "",
    "2. Bien contratado: " + (r.bien === "producto" ? "Producto" : "Servicio"),
    "Monto reclamado: " + (r.monto != null ? soles(r.monto) : "—"),
    "Descripción: " + r.descripcion_bien,
    r.codigo_pedido ? "Pedido: " + r.codigo_pedido : null,
    "",
    "3. " + (r.tipo === "reclamo" ? "RECLAMO" : "QUEJA"),
    "Detalle: " + r.detalle,
    "Pedido del consumidor: " + r.pedido_consumidor,
  ];
  if (r.respuesta) filas.push("", "4. Respuesta del proveedor (" + soloFecha(r.respondido_en) + "):", r.respuesta);
  return filas.filter((f) => f != null).join("\n");
}

const pendientes = () => reclamos.filter((r) => !r.respuesta).length;

function pintarReclamos() {
  const n = pendientes();
  $("n-reclamos").textContent = n;
  $("n-reclamos").hidden = !n;
  if (!reclamos.length) {
    $("lista-reclamos").replaceChildren(el("p", { className: "vacio", textContent: "No hay reclamos. 🎉" }));
    return;
  }
  $("lista-reclamos").replaceChildren(...reclamos.map((r) => {
    const limite = fechaLimite(r.creado_en);
    const vencido = !r.respuesta && limite < new Date();
    const color = r.respuesta ? "var(--entregado)" : vencido ? "#b91c1c" : "var(--en_preparacion)";
    const dato = (k, v) => (v ? [el("dt", { textContent: k }), el("dd", { textContent: v })] : []);

    const asunto = "Libro de Reclamaciones - Hoja " + r.numero + " - Canastas MIA";
    const correo = el("a", {
      className: "btn btn-borde",
      href: "mailto:" + encodeURIComponent(r.email) + "?subject=" + encodeURIComponent(asunto) +
        "&body=" + encodeURIComponent(textoHoja(r)),
      textContent: r.respuesta ? "Enviar respuesta por correo" : "Enviar constancia por correo",
    });
    const responder = el("button", {
      type: "button", className: "btn btn-principal",
      textContent: r.respuesta ? "Editar respuesta" : "Registrar respuesta",
    });
    responder.onclick = () => abrirRespuesta(r);

    const tarjeta = el("article", { className: "reclamo" },
      el("div", { className: "top" },
        el("span", { className: "codigo", textContent: r.numero + " · " + (r.tipo === "reclamo" ? "Reclamo" : "Queja") }),
        el("span", { className: "fecha", textContent: fecha(r.creado_en) })),
      el("p", { className: "plazo", textContent: r.respuesta
        ? "✓ Respondido el " + soloFecha(r.respondido_en)
        : (vencido ? "⚠ Venció el plazo: " : "Responder hasta el ") + soloFecha(limite) }),
      el("dl", {},
        ...dato("Cliente", r.nombre),
        ...dato(r.tipo_documento, r.documento),
        ...dato("Teléfono", r.telefono),
        ...dato("Correo", r.email),
        ...dato("Domicilio", r.domicilio),
        ...dato("Apoderado", r.apoderado),
        ...dato(r.bien === "producto" ? "Producto" : "Servicio", r.descripcion_bien),
        ...dato("Monto", r.monto != null ? soles(r.monto) : ""),
        ...dato("Pedido", r.codigo_pedido),
        ...dato("Detalle", r.detalle),
        ...dato("Pide", r.pedido_consumidor),
        ...dato("Respuesta", r.respuesta)),
      el("div", { className: "botones" }, correo, responder));
    tarjeta.style.setProperty("--color", color);
    return tarjeta;
  }));
}

let reclamoAbierto = null;
function abrirRespuesta(r) {
  reclamoAbierto = r;
  $("r-numero").textContent = r.numero;
  $("r-texto").value = r.respuesta || "";
  $("r-error").textContent = "";
  $("dlg-respuesta").showModal();
}
$("r-cancelar").onclick = () => $("dlg-respuesta").close();
$("form-respuesta").onsubmit = async (e) => {
  e.preventDefault();
  const r = reclamoAbierto;
  try {
    const hecho = await api("/reclamos/" + r.id, { method: "PATCH", body: JSON.stringify({ respuesta: $("r-texto").value }) });
    Object.assign(r, hecho);
    $("dlg-respuesta").close();
    pintarReclamos();
    avisar("Respuesta guardada. Ahora envíasela al cliente por correo.");
  } catch (err) {
    $("r-error").textContent = err.message;
  }
};

// Al abrir: si ya hay sesión, entra directo; si no, muestra el login.
api("/yo").then((u) => mostrarPanel(u.nombre)).catch((e) => {
  mostrarLogin();
  if (e.message !== "sesión") $("l-error").textContent = e.message;
});
