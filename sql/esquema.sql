-- Tablas de la base de datos de Canastas MIA.
-- "IF NOT EXISTS": si la tabla ya existe no la toca, así se puede correr
-- cada vez que arranca el servidor sin borrar nada.

-- Una fila por canasta.
CREATE TABLE IF NOT EXISTS canastas (
  id      TEXT PRIMARY KEY,            -- c1, c2, ... (igual que en el catálogo)
  nombre  TEXT NOT NULL,
  precio  NUMERIC(10, 2),              -- vacío = "precio por confirmar"
  visible BOOLEAN NOT NULL DEFAULT TRUE,
  orden   INTEGER NOT NULL             -- posición en la página
);

-- Los productos que trae cada canasta. Una canasta tiene muchos productos.
CREATE TABLE IF NOT EXISTS productos (
  id          SERIAL PRIMARY KEY,
  canasta_id  TEXT NOT NULL REFERENCES canastas(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL,
  orden       INTEGER NOT NULL
);

-- Un pedido de un cliente. El código es lo que el cliente usa para ver su estado.
CREATE TABLE IF NOT EXISTS pedidos (
  id          SERIAL PRIMARY KEY,
  codigo      TEXT NOT NULL UNIQUE,    -- ej. MIA-7KQ2PX
  nombre      TEXT NOT NULL,
  apellido    TEXT NOT NULL,
  celular     TEXT NOT NULL,
  nota        TEXT,
  metodo_pago TEXT NOT NULL CHECK (metodo_pago IN ('yape', 'plin', 'interbank')),
  estado      TEXT NOT NULL DEFAULT 'nuevo'
              CHECK (estado IN ('nuevo', 'pagado', 'en_preparacion', 'entregado', 'cancelado')),
  total       NUMERIC(10, 2),          -- vacío si alguna canasta no tiene precio
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Agregada después: un código del catálogo para no guardar dos veces el mismo
-- pedido si el cliente toca "Enviar" dos veces.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS clave_envio TEXT UNIQUE;

-- Las canastas de cada pedido. Se copia el nombre y el precio del momento,
-- así el pedido no cambia si después se edita la canasta.
CREATE TABLE IF NOT EXISTS pedido_items (
  id              SERIAL PRIMARY KEY,
  pedido_id       INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  canasta_id      TEXT NOT NULL REFERENCES canastas(id),
  nombre_canasta  TEXT NOT NULL,
  precio_unitario NUMERIC(10, 2),
  cantidad        INTEGER NOT NULL CHECK (cantidad > 0)
);

-- Personas que pueden entrar al panel (Mia, Juan Carlos).
-- La contraseña nunca se guarda: solo su "hash" (una huella que no se puede revertir).
CREATE TABLE IF NOT EXISTS usuarios (
  id         SERIAL PRIMARY KEY,
  usuario    TEXT NOT NULL UNIQUE,
  nombre     TEXT NOT NULL,
  hash_clave TEXT NOT NULL,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sesiones abiertas. El navegador guarda un token en una cookie;
-- aquí se guarda solo el hash del token, por si alguien roba la base de datos.
CREATE TABLE IF NOT EXISTS sesiones (
  hash_token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_en  TIMESTAMPTZ NOT NULL
);

-- Libro de Reclamaciones virtual (obligatorio en Perú: Código de Protección y
-- Defensa del Consumidor y D.S. 011-2011-PCM). Cada hoja lleva un número
-- correlativo y el negocio tiene 15 días hábiles para responder.
-- Los reclamos no se borran: INDECOPI puede pedirlos (se guardan 2 años como mínimo).
CREATE TABLE IF NOT EXISTS reclamos (
  id                SERIAL PRIMARY KEY,           -- el número correlativo de la hoja
  clave_envio       TEXT UNIQUE,                  -- evita duplicados si se envía dos veces
  tipo              TEXT NOT NULL CHECK (tipo IN ('reclamo', 'queja')),
  nombre            TEXT NOT NULL,
  tipo_documento    TEXT NOT NULL CHECK (tipo_documento IN ('DNI', 'CE', 'Pasaporte', 'RUC')),
  documento         TEXT NOT NULL,
  domicilio         TEXT NOT NULL,
  telefono          TEXT NOT NULL,
  email             TEXT NOT NULL,
  apoderado         TEXT,                         -- padre o madre, si es menor de edad
  bien              TEXT NOT NULL CHECK (bien IN ('producto', 'servicio')),
  monto             NUMERIC(10, 2),
  descripcion_bien  TEXT NOT NULL,
  codigo_pedido     TEXT,
  detalle           TEXT NOT NULL,
  pedido_consumidor TEXT NOT NULL,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  respuesta         TEXT,
  respondido_en     TIMESTAMPTZ
);
