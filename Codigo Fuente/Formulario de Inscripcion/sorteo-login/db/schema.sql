CREATE TABLE IF NOT EXISTS participantes (
  dni VARCHAR(8) PRIMARY KEY CHECK (dni ~ '^[0-9]{7,8}$'),
  nombre TEXT NOT NULL,
  apellido TEXT NOT NULL,
  bandera SMALLINT NOT NULL DEFAULT 0 CHECK (bandera IN (0, 1)),
  datos_adicionales JSONB NOT NULL DEFAULT '{}'::jsonb
);