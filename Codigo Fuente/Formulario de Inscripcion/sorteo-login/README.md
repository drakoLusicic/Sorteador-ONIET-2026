# Sorteo Login

Aplicación de login para sorteo. Usa MySQL cuando se configuran las variables `DB_*` y conserva el CSV como alternativa local de desarrollo.

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

Sin `DB_HOST`, `DB_USER` y `DB_PASSWORD`, el servidor usa el CSV local. Cuando se configuran, conecta a MySQL y no lee el CSV.

## Configurar el puerto

Puedes definir un puerto distinto con un archivo `.env`:

```env
PORT=3000
```

## MySQL en cPanel

1. En cPanel, confirma la base `sorteador_db` y asigna un usuario MySQL con permisos sobre ella. Configura estas variables en el entorno del servidor:

```env
DB_HOST=localhost
DB_PORT=3306
DB_NAME=sorteador_db
DB_USER=usuario_cpanel
DB_PASSWORD=clave
```

Usa el nombre completo asignado por cPanel (a menudo lleva prefijo) y no guardes las credenciales en Git. La tabla `estudiante` debe existir previamente con los campos `id`, `legajo`, `dni`, `nombre`, `apellido`, `email`, `inscripto` y `fecha_inscripcion`. El backend valida por `dni` y `inscripto`, y al confirmar solo actualiza `inscripto` de `0` a `1`. No crea tablas ni agrega o elimina filas. Concede al usuario MySQL permiso `SELECT` y permiso `UPDATE` únicamente sobre `inscripto`.

2. Instala dependencias, configura `NODE_ENV=production` en el hosting y usa `npm start` como comando de inicio. El servidor prueba la conexión antes de aceptar requests. Si el proveedor requiere TLS, configura `DB_SSL=true` y, si corresponde, `DB_SSL_CA_FILE` con la ruta segura del certificado.

El proceso no necesita permisos para crear o modificar el esquema ni para insertar o eliminar registros.

Si la aplicación está detrás de un proxy, configura `TRUST_PROXY_HOPS` con el número exacto de saltos confiables que indique tu proveedor. No lo configures a ciegas: el rate limit depende de la IP que Express recibe.

El rate limit actual usa memoria local del proceso. Para múltiples instancias de la aplicación, configura un store compartido compatible con `express-rate-limit` para que el límite se aplique globalmente.

## CSV local

Para producción con MySQL, no reemplaces el CSV de ejemplo por datos reales. Si excepcionalmente se usa CSV local en producción, configura el archivo fuera del proyecto, del directorio público y de carpetas sincronizadas:

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
2. El backend lo busca en MySQL o en el CSV local.
3. Si existe y todavía no participó, muestra un nombre parcial para confirmar.
4. Al confirmar, se guarda `bandera=1` en el CSV y la persona pasa a participar.

## Seguridad

- Validación del DNI tanto en cliente como en servidor.
- Rate limiting por IP para evitar enumeración de DNIs.
- Helmet habilitado con Content Security Policy y headers de seguridad.
- Las respuestas de la API no se cachean y no incluyen filas completas ni consultas.
- Solo se sirve `public/`; el servidor rechaza configurar el CSV dentro de esa carpeta.
- MySQL recibe solo consultas parametrizadas; el DNI se pasa como parámetro y no se concatena a SQL. La API no devuelve filas ni sentencias.
- En producción, usa HTTPS para cifrar el DNI durante el transporte. Configura el proxy del proveedor para que la aplicación no quede expuesta por un puerto público sin TLS.
- En modo CSV, el archivo no está cifrado en disco. En sistemas POSIX el servidor limita sus permisos a `0600`; en Windows configura ACL restrictivas.
- No guardes datos reales en una carpeta pública, repositorio Git o carpeta sincronizada en la nube sin autorización y controles de acceso adecuados. La ubicación predeterminada es solo para desarrollo.
- Las requests se originan en el navegador, así que el usuario puede ver su propio DNI en las herramientas de red. HTTPS protege el tránsito, pero no oculta la request al navegador que la envía.
