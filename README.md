# Canastas MIA · API y panel de pedidos

[![Pruebas](https://github.com/juancarlosmendiolamorales-ui/canastas-mia-api/actions/workflows/pruebas.yml/badge.svg)](https://github.com/juancarlosmendiolamorales-ui/canastas-mia-api/actions/workflows/pruebas.yml)

Backend para el [catálogo navideño de Canastas MIA](https://github.com/juancarlosmendiolamorales-ui/catalogo-canastas-navidad),
un negocio real de canastas en Lima. Guarda los pedidos de los clientes en una base de datos y
da a la dueña un panel con login para seguirlos: nuevo → pagado → en preparación → entregado.

**En vivo:** [lista de canastas (API)](https://canastas-mia-api.onrender.com/canastas) ·
[panel](https://canastas-mia-api.onrender.com/panel/) (requiere cuenta). Está en el plan gratis de
Render: si nadie lo usó en un rato, la primera visita tarda unos 50 segundos en despertar.

![Panel de pedidos](docs/panel.png)

## Cómo funciona

```
 Catálogo (cliente)          API (Node.js + Express)            PostgreSQL
 ──────────────────          ───────────────────────            ──────────
 ver canastas      ──GET───▶ /canastas            ──SQL──▶  canastas, productos
 enviar pedido     ──POST──▶ /pedidos             ──SQL──▶  pedidos, pedido_items
 ver mi pedido     ──GET───▶ /pedidos/:codigo

 Panel (Mia)
 iniciar sesión    ──POST──▶ /admin/login         ──SQL──▶  usuarios, sesiones
 ver / actualizar  ──────▶ /admin/pedidos        ──SQL──▶  pedidos
 reclamos          ──────▶ /admin/reclamos       ──SQL──▶  reclamos
```

## Rutas de la API

| Método | Ruta | Qué hace | Login |
|---|---|---|---|
| GET | `/canastas` | Lista de canastas visibles con sus productos | No |
| GET | `/canastas/:id` | Una canasta | No |
| POST | `/pedidos` | Crea un pedido y devuelve su código (ej. `MIA-7KQ2PX`). Acepta `clave_envio` para no duplicar | No |
| GET | `/pedidos/:codigo` | Estado del pedido, sin datos privados del cliente | No |
| POST | `/admin/login` · `/admin/logout` | Iniciar y cerrar sesión | — |
| GET | `/admin/pedidos?estado=` | Todos los pedidos, con filtro por estado | Sí |
| PATCH | `/admin/pedidos/:codigo` | Cambiar el estado de un pedido | Sí |
| POST | `/admin/clave` | Cambiar mi contraseña | Sí |
| POST | `/reclamos` | Libro de Reclamaciones: registra un reclamo o queja y devuelve su número (`R-000001`) | No |
| GET | `/admin/reclamos` | Hojas del Libro de Reclamaciones con su plazo de respuesta | Sí |
| PATCH | `/admin/reclamos/:id` | Registrar la respuesta al cliente | Sí |
| — | `/panel` | Panel web (HTML + JavaScript) | Sí |

Ejemplo de pedido:

```json
POST /pedidos
{
  "nombre": "Rosa", "apellido": "Quispe", "celular": "987111222",
  "metodo_pago": "yape",
  "items": [{ "canasta_id": "c1", "cantidad": 3 }]
}
→ 201 { "codigo": "MIA-PZLSXU", "estado": "nuevo", "total": 269.7 }
```

## Decisiones de diseño

- **El precio lo pone el servidor, no el cliente.** El total se calcula con los precios de la base
  de datos; si alguien manda un precio en el pedido, se ignora.
- **Pedidos sin duplicados:** el catálogo manda una `clave_envio` al azar; si el cliente toca
  "Enviar" dos veces (o llegan dos envíos al mismo tiempo), el servidor devuelve el mismo pedido.
- **CORS:** solo la página del catálogo puede mandar pedidos desde el navegador.
- **Anti-spam:** como mucho 10 pedidos por hora desde una misma IP.
- **Transacciones:** el pedido y sus canastas se guardan juntos o no se guarda nada.
- **El pedido guarda una copia** del nombre y precio de cada canasta, así no cambia si después se
  edita el catálogo.
- **Validación** de todos los datos que llegan (celular peruano, método de pago, cantidades),
  con mensajes de error claros.
- **Consultas parametrizadas** (`$1, $2…`) contra inyección SQL.
- **Contraseñas con scrypt** (hash con sal); nunca se guardan en texto.
- **Sesiones en cookies `HttpOnly` y `SameSite=Strict`**; en la base solo se guarda el hash del token.
- **Límite de intentos de login** cada 15 minutos: 5 por usuario desde una IP, 20 por IP y 100
  por cuenta sumando todas las IP. Se cuenta antes de revisar la clave (así no se salta con
  intentos en paralelo), y el límite por cuenta es alto para que nadie pueda bloquear la cuenta
  de otra persona fallando unas pocas veces. Las contraseñas son aleatorias de 12 caracteres,
  así que adivinarlas a ese ritmo tomaría millones de años.
- **Mismo mensaje y mismo tiempo de respuesta** si el usuario no existe o la clave está mal,
  para no revelar qué usuarios existen.
- **El panel nunca inserta HTML** con datos del cliente (usa `textContent`), para evitar XSS.
- **Cabeceras de seguridad** en todas las respuestas: Content-Security-Policy (el panel solo carga
  scripts propios), anti-clickjacking (`frame-ancestors 'none'`), `nosniff`, HSTS y `no-store` en
  las rutas con datos personales.
- **Libro de Reclamaciones virtual** (obligatorio en Perú): hojas con número correlativo, plazo de
  15 días hábiles visible en el panel y constancia para el cliente.
- **Retención de datos:** los pedidos se borran solos a los 2 años, como dice la política de
  privacidad; los reclamos se conservan.
- **Una sola fuente para las canastas:** Mia edita nombres, productos, precios y qué se muestra en
  una Google Sheet. El catálogo la lee al abrirse y el servidor la copia a la base al arrancar y cada
  5 minutos (solo escribe si la hoja cambió). Si Google falla o la hoja llega vacía, se quedan los
  datos que ya había.
- **Tolerante a cortes de la base:** si Neon cierra una conexión inactiva, el servidor no se cae.

## Tecnologías

Node.js · Express 5 · PostgreSQL · `pg` · Docker · HTML/CSS/JavaScript sin frameworks · Render · Neon ·
pruebas con `node:test` · GitHub Actions

## Correrlo en tu computadora

Necesitas Node.js 22 o más y Docker.

```bash
cp .env.example .env          # y cambia la contraseña
npm install
npm run db:encender           # enciende PostgreSQL en Docker
npm run db:reiniciar          # crea las tablas y carga las canastas
npm run usuario -- mia "Mia"  # crea una cuenta para el panel y muestra su contraseña
npm run dev                   # http://localhost:3000  ·  panel en /panel
```

## Pruebas

```bash
npm test
```

36 pruebas con el *test runner* que ya trae Node (sin librerías extra). Las de la API corren contra
una base aparte, `canastas_pruebas`, que se crea y se vacía sola; se niegan a correr si la base no es
local. Revisan, entre otras cosas, que:

- el precio salga de la base de datos aunque el navegador mande otro;
- tocar "Enviar" varias veces, o dos veces al mismo tiempo, guarde un solo pedido;
- un texto con SQL se guarde como texto y no se ejecute;
- el login dé el mismo mensaje exista o no el usuario, frene a los 5 intentos y use cookies `HttpOnly`;
- el Libro de Reclamaciones nunca devuelva datos personales;
- un precio nuevo en la Google Sheet llegue al total del pedido, y una hoja rota no borre nada.

GitHub Actions las corre en cada `push` con un PostgreSQL de verdad.

## Estructura

```
src/
  app.js             rutas, cabeceras de seguridad y manejo de errores
  servidor.js        arranque: prepara la base y abre el puerto
  db.js              conexión a PostgreSQL
  cors.js            qué páginas pueden usar la API
  ip.js · limite.js  IP del visitante y límites anti-spam
  auth.js            contraseñas, sesiones y cookies
  preparar.js        crea tablas y carga canastas (sin borrar nada)
  hoja.js            copia las canastas de la Google Sheet a la base
  rutas/             canastas, pedidos, reclamos y admin
test/                pruebas automáticas (npm test)
public/panel/        panel web
sql/esquema.sql      tablas
scripts/             reiniciar la base y crear usuarios
```

## Autor

**Juan Carlos Mendiola**, estudiante de Ingeniería de Sistemas en la UPC.
Hecho con ayuda de [Claude Code](https://claude.com/claude-code) como asistente de programación.
