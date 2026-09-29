# Sorteo Login

Aplicación de login para sorteo. Usa PostgreSQL cuando se configura `DATABASE_URL` y conserva el CSV como alternativa local de desarrollo.

## Requisitos

- Node.js 18+ recomendado
- npm

## Instalar dependencias

```bash
npm install
```

## Ejecutar la app

```bash
npm start
```

O en modo desarrollo:

```bash
npm run dev
```

La app queda disponible en http://localhost:3000.

Sin `DATABASE_URL`, el servidor usa el CSV local. Si `DATABASE_URL` está configurada, usa PostgreSQL y no lee el CSV.

## Configurar el puerto

Puedes definir un puerto distinto con un archivo `.env`:

```env
PORT=3000
```

## PostgreSQL para hosting

1. Crea una base PostgreSQL administrada en tu proveedor de hosting y configura `DATABASE_URL` como variable secreta del servicio. No la guardes en Git.
2. Ejecuta una vez, contra esa base, el setup y la importación:

```bash
npm run db:setup
npm run db:import-csv
```

El importador lee `data/participantes.csv` por defecto. También puedes pasar otra ruta como argumento:

```bash
npm run db:import-csv -- "C:/ruta-privada/participantes.csv"
```

La importación agrega participantes nuevos y no modifica filas que ya existan, incluida su bandera. Las columnas del CSV aparte de `dni`, `nombre`, `apellido` y `bandera` quedan preservadas en `datos_adicionales` como JSONB. El esquema está en `db/schema.sql`.

3. Configura `NODE_ENV=production` en el hosting y usa `npm start` como comando de inicio. El servidor prueba la conexión antes de aceptar requests y usa TLS con validación de certificado. Si el proveedor requiere una CA propia, configura `PGSSL_CA_FILE` con la ruta segura del certificado.

El proceso de ejecución necesita permisos de lectura y actualización sobre `participantes`; reserva permisos de creación/modificación del esquema para el paso de setup cuando el proveedor permita separar roles.

Si la aplicación está detrás de un proxy, configura `TRUST_PROXY_HOPS` con el número exacto de saltos confiables que indique tu proveedor. No lo configures a ciegas: el rate limit depende de la IP que Express recibe.

El rate limit actual usa memoria local del proceso. Para múltiples instancias de la aplicación, configura un store compartido compatible con `express-rate-limit` para que el límite se aplique globalmente.

## CSV local

Para producción con PostgreSQL, no reemplaces el CSV de ejemplo por datos reales. Si excepcionalmente se usa CSV local en producción, configura el archivo fuera del proyecto, del directorio público y de carpetas sincronizadas:

```env
CSV_PATH=C:/ruta-privada/participantes.csv
```

## Reemplazar el CSV real

El archivo base se encuentra en:

```text
data/participantes.csv
```

Debe tener encabezado con al menos `dni,nombre,apellido,bandera`.

- Mantén todas las columnas existentes.
- No cambies la estructura principal del CSV, salvo agregar la columna `bandera` si no existe.
- El servidor la crea automáticamente con valor `0` para todas las filas si hace falta.

## Flujo de uso

1. El usuario ingresa su DNI.
2. El backend lo busca en PostgreSQL o en el CSV local.
3. Si existe y todavía no participó, muestra un nombre parcial para confirmar.
4. Al confirmar, se guarda `bandera=1` en el CSV y la persona pasa a participar.

## Seguridad

- Validación del DNI tanto en cliente como en servidor.
- Rate limiting por IP para evitar enumeración de DNIs.
- Helmet habilitado con Content Security Policy y headers de seguridad.
- Las respuestas de la API no se cachean y no incluyen filas completas ni consultas.
- Solo se sirve `public/`; el servidor rechaza configurar el CSV dentro de esa carpeta.
- PostgreSQL recibe solo consultas parametrizadas; el DNI se pasa como parámetro y no se concatena a SQL. La API no devuelve filas ni sentencias.
- En producción, usa HTTPS para cifrar el DNI durante el transporte. Configura el proxy del proveedor para que la aplicación no quede expuesta por un puerto público sin TLS.
- En modo CSV, el archivo no está cifrado en disco. En sistemas POSIX el servidor limita sus permisos a `0600`; en Windows configura ACL restrictivas.
- No guardes datos reales en una carpeta pública, repositorio Git o carpeta sincronizada en la nube sin autorización y controles de acceso adecuados. La ubicación predeterminada es solo para desarrollo.
- Las requests se originan en el navegador, así que el usuario puede ver su propio DNI en las herramientas de red. HTTPS protege el tránsito, pero no oculta la request al navegador que la envía.
