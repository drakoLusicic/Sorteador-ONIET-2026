# Sorteador ONIET 30

Sorteador interactivo para el evento ONIET 30. Backend en Python (Flask) con base de datos MySQL/MariaDB en el hosting (o SQLite para probar en la computadora), y frontend en HTML, CSS y JavaScript.

Tiene dos ventanas:

- **Pantalla del sorteador** (`/`): la que se proyecta al público. No tiene controles y cualquiera la puede abrir (también desde el celular).
- **Administrador** (`/admin`): desde donde se sortea y se manejan los premios y los participantes. Pide contraseña.

## Probarlo en la computadora

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Se abren las dos ventanas (http://127.0.0.1:5000 y http://127.0.0.1:5000/admin). Si está instalado Chrome o Edge, cada una se abre como aplicación (sin barra de direcciones), con un perfil propio que recuerda dónde quedó cada ventana y que deja a la pantalla reproducir sonido sin hacerle clic. Si no, se abren en el navegador predeterminado; en ese caso la pantalla pide un clic para activar el sonido.

Para levantar solo el servidor, sin abrir ventanas: `python app.py --sin-ventanas`.

Sin configuración, usa el archivo `sorteador.db` (SQLite) y, si está vacío, carga 40 participantes y 5 premios de ejemplo. En la computadora el administrador no pide contraseña, salvo que se configure una en el archivo `.env` (ver [Configuración](#configuración)).

## Subirlo al hosting (cPanel)

En el hosting el sorteador usa una base MySQL/MariaDB y corre con Passenger, a través de "Setup Python App" de cPanel. Pasos:

1. **Crear la base de datos.** En cPanel → *Bases de datos MySQL*: crear una base (por ejemplo `micuenta_sorteo`), crear un usuario con una contraseña segura y agregar ese usuario a la base con *Todos los privilegios*. Las tablas las crea el sorteador solo.
2. **Subir los archivos** a una carpeta de la cuenta que **no** esté dentro de `public_html` (por ejemplo `/home/micuenta/sorteador`), con el Administrador de archivos (subiendo un .zip y extrayéndolo) o con *Git Version Control*. Hay que subir todo menos `.venv`, `__pycache__` y `sorteador.db`. Las carpetas `recursos` y `herramientas` no hacen falta en el hosting.
3. **Crear la aplicación.** En cPanel → *Setup Python App* → *Create Application*:
   - *Python version*: 3.9 o más nueva (conviene la más nueva que ofrezca).
   - *Application root*: la carpeta del paso 2 (`sorteador`).
   - *Application URL*: el dominio o una subcarpeta (por ejemplo `midominio.com/sorteo`; funciona igual).
   - *Application startup file*: `passenger_wsgi.py`.
   - *Application Entry point*: `application`.
4. **Configurar.** En la carpeta de la aplicación, copiar `.env.ejemplo` como `.env` y completarlo: los datos de la base del paso 1, la contraseña del administrador y la clave secreta (ver [Configuración](#configuración)). En lugar del archivo se pueden cargar las mismas variables en la página de la aplicación, en *Environment variables*.
5. **Instalar las dependencias.** En la página de la aplicación, en *Configuration files*, agregar `requirements.txt` y tocar *Run Pip Install*. (O desde la *Terminal* de cPanel: activar el entorno con el comando que muestra la página de la aplicación, arriba de todo, y ejecutar `pip install -r requirements.txt`.)
6. **Reiniciar** la aplicación (botón *Restart*). Hay que hacerlo cada vez que se cambia el `.env` o se sube código nuevo.
7. **Activar https.** En cPanel → *SSL/TLS Status* (AutoSSL) el dominio tiene que tener certificado, y en *Dominios* conviene activar *Force HTTPS Redirect*. El administrador solo guarda la sesión por https.
8. **Comprobar.** Abrir `https://midominio.com/salud`: tiene que responder `"ok": true` y `"base": "mysql"`. Si dice que no hay conexión, revisar los datos de la base en el `.env`; el detalle del error queda en el archivo `stderr.log` de la carpeta de la aplicación (o en *Errores* de cPanel).
9. **Cargar los datos.** Entrar a `https://midominio.com/admin` con la contraseña, cargar los participantes (ver [Participantes](#participantes)) y agregar los premios.

El día del evento: abrir la pantalla (`https://midominio.com/`) en la computadora del proyector, ponerla en pantalla completa con F11 y **hacerle un clic** para que el navegador deje reproducir el sonido. El administrador se puede manejar desde otra computadora o desde un celular.

### Cómo funciona en el hosting

En cPanel, Passenger corre el programa en varios procesos a la vez y los puede apagar cuando no se usan. Por eso el estado del sorteo se guarda en la base de datos (tabla `sorteo`) y cada ventana consulta `/api/estado` una vez por segundo, en lugar de mantener una conexión abierta. Cada pantalla abierta, además, avisa cada pocos segundos que sigue ahí (tabla `pantallas`); así el administrador sabe si hay alguna abierta.

Cada pantalla abierta hace una consulta por segundo. Para el proyector, el administrador y algunas personas mirando desde el celular no hay problema; si se espera que la miren cientos de personas a la vez, conviene consultar con el hosting los límites del plan (procesos y CPU). El intervalo se puede cambiar en `static/js/api.js` (`INTERVALO`).

## Configuración

Se lee de variables de entorno o del archivo `.env` en la carpeta del programa (ver `.env.ejemplo`). Si una variable está en los dos lugares, gana la variable de entorno. El archivo `.env` tiene contraseñas: no lo subas a un repositorio (ya está en `.gitignore`).

| Variable | Para qué |
|----------|----------|
| `SORTEADOR_DB_NOMBRE`, `SORTEADOR_DB_USUARIO`, `SORTEADOR_DB_CLAVE`, `SORTEADOR_DB_HOST`, `SORTEADOR_DB_PUERTO` | Datos de la base MySQL/MariaDB. La contraseña puede tener cualquier símbolo. |
| `SORTEADOR_DB_URL` | En lugar de lo anterior, la URL completa de la base. |
| `SORTEADOR_CLAVE_ADMIN` | Contraseña del administrador. **Obligatoria en el hosting**: sin ella el administrador no se abre. Puede ser el texto de la contraseña o, mejor, el hash que genera `python gestion.py clave`. |
| `SORTEADOR_CLAVE_SECRETA` | Texto largo al azar para firmar la sesión del administrador (`python -c "import secrets; print(secrets.token_hex(32))"`). Si falta, se deriva de la contraseña. |
| `SORTEADOR_COOKIE_SEGURA` | `1` (por defecto): la sesión solo viaja por https. Poner `0` solo si el sitio todavía no tiene certificado. |
| `SORTEADOR_ZONA_HORARIA` | Para la hora de cada ganador. Por defecto `America/Argentina/Cordoba`. |

Sin `SORTEADOR_DB_NOMBRE` ni `SORTEADOR_DB_URL`, usa SQLite (`sorteador.db`) con datos de ejemplo.

### Seguridad

- La pantalla es pública; todo lo demás (sortear, continuar, premios, orden, participantes, lista de ganadores) necesita la sesión del administrador.
- Los pedidos que cambian algo además llevan una cabecera propia (`X-Sorteador`), que una página de otro sitio no puede agregar: así no puede aprovechar una sesión abierta.
- Después de 5 contraseñas incorrectas seguidas desde una misma dirección, hay que esperar unos minutos.
- La sesión dura 12 horas; el botón *Salir* la cierra.

## Participantes

Los participantes están en la tabla `participantes` de la base (`id`, `nombre`, `apellido`). Se cargan de tres maneras:

- **Desde el administrador** (lo más simple): en *Participantes → Cargar participantes*, elegir una planilla **.csv o .xlsx** con las columnas `nombre`, `apellido` e `id` (opcional: el número de participante; si no está, se numeran solos). Hay un enlace para descargar una planilla de ejemplo. Se aceptan variantes en los títulos ("Nombres", "APELLIDO", "ID de participante") y columnas de más, que se ignoran; los CSV pueden estar separados por coma o por punto y coma, como los guarda Excel. Se puede elegir:
  - *Agregar*: suma los nuevos; si un id ya existe, le actualiza el nombre y el apellido (sirve para corregir un dato).
  - *Reemplazar todos*: borra los participantes cargados y la lista de ganadores, y deja solo los de la planilla.

  Si la planilla tiene algún error (falta un nombre, un id repetido o que no es un número), no se carga nada y se indica en qué fila está el problema.
- **Desde la terminal**: `python gestion.py importar participantes.xlsx` (con `--reemplazar` para reemplazar todos).
- **Directamente en la base**, por ejemplo con phpMyAdmin, insertando filas en `participantes`. La pantalla lo nota sola cuando cambia la cantidad de participantes; si solo se corrigió un nombre, hay que recargarla (F5).

No se pueden cargar participantes durante un sorteo.

## Uso

### Administrador

- **Sortear**: la mascota tira de la palanca en la pantalla y el listado gira. Solo se puede sortear si la pantalla está abierta, queda alguien en juego y hay algún premio cargado; si no, abajo del botón dice qué falta.
- **Continuar**: cierra la ventana del ganador en la pantalla (también se cierra con Escape en la pantalla, si se abrió en el mismo navegador donde se inició sesión en el administrador).
- **Premios**: el marcado es el que se sortea a continuación y aparece en la pantalla como "Próximo premio". Sigue marcado después de cada sorteo, así el mismo premio se puede entregar varias veces; al lado se ve cuántas veces se entregó. Se pueden agregar y quitar premios.
- **Ordenar por**: ordena el listado de la pantalla por apellido o por ID de participante.
- **Reiniciar ganadores**: borra la lista de ganadores y todos los participantes vuelven a entrar en juego.
- **Ganadores** (columna de la derecha): cada ganador con su premio y la hora, el más reciente arriba y numerados en el orden en que salieron. El ganador aparece recién cuando la pantalla lo muestra.

Arriba se indica si la pantalla del sorteador está abierta; si no, hay un enlace para abrirla. El botón *Salir* cierra la sesión.

### Pantalla

- **El listado de participantes es el tragamonedas.** La fila que queda sobre la línea del medio es la ganadora. Mientras no gira, se puede recorrer con la rueda del mouse, arrastrando o con las flechas del teclado.
- Cuando el listado se detiene, aparece una ventana con el ganador hasta que el administrador toca Continuar.
- **No se puede ganar dos veces**: cuando el administrador toca Continuar, el ganador sale del listado (y el servidor solo sortea entre quienes no ganaron). Abajo del listado se cuenta cuántos ya ganaron.
- En cada sorteo el listado da al menos 3 vueltas completas, por más participantes que haya. Con cientos, el tramo rápido se ve borroso, como un tambor girando.
- 🔊 (arriba a la derecha) activa o desactiva el sonido.
- **Se adapta a cualquier pantalla** (computadora, tablet o celular, parado o acostado) manteniendo el mismo orden: logo y premio arriba, el listado en el centro con la palanca y la mascota a su derecha, y el logo de la Universidad abajo. Si no entra todo a lo ancho, `app.js` reparte el ancho: la máquina se queda con el 64% (`PARTE_MAQUINA`) y la mascota y la palanca se achican juntas, para que la mano siga llegando al pomo. En celulares la letra del listado es más chica para que entren los nombres, y con el celular acostado el logo y el premio van en una sola línea.

## Mascota y palanca

La palanca está al costado derecho del listado y el águila está parada a su lado. Al sortear:

1. Se agacha, levanta el ala y agarra el pomo de la palanca.
2. Tira hacia abajo: el pomo baja junto con su mano. Cuando la palanca llega al fondo, el listado arranca.
3. Suelta la palanca, que vuelve arriba como un resorte, y se cruza de brazos a mirar.
4. Cuando el listado empieza a frenar, se inclina hacia la máquina.
5. El listado frena de a poco (el giro dura entre 11 y 14 segundos, según la cantidad de participantes) y el final se elige al azar: a veces parece quedarse en una fila, duda y avanza una más; otras se pasa y vuelve una, o casi se pasa pero se queda; y otras frena derecho. Mientras duda, la mascota lo comenta. Las vueltas, las duraciones y los finales se ajustan al principio de `carrete.js` (`VUELTAS_MINIMAS`, `DURACION_RAPIDO`, `FILAS_FRENADA`, `DURACION_FRENADA` y `FINALES`).
6. Cuando se detiene, señala al ganador, y después aparece la ventana del ganador.

Mientras espera, respira y cada tanto hace algún gesto. Si le hacés clic, también.

Solo si la ventana es tan angosta que la mascota quedaría de menos de 70 px de alto (más angosta que cualquier celular), se muestra solo el listado y gira directamente.

### Poses

Las cinco poses (`static/img/mascota/jarras.png`, `alcanza.png`, `cruzado.png`, `senala.png`, `mira.png`) se generan a partir de la hoja de poses `recursos/mascota_poses.jpg`. Para regenerarlas:

```powershell
pip install pillow numpy scipy
python herramientas/procesar_mascota.py
```

El script quita el fondo de damero, separa cada figura de las capturas del listado que hay en la hoja, iguala el tamaño de las poses (usando el ancho de los anteojos) y las alinea por la remera y los pies. Si se usa otra hoja, hay que actualizar en el script la posición de cada pose (`POSES`). Si cambian las medidas que informa, también hay que actualizar `MASCOTA` en `app.js`, `MANO_Y` en `mascota.js` y `.mascota` en `styles.css`.

## Logos

`static/img/logos/oniet30.png` (encabezado) y `ubp.png` (abajo a la izquierda) se generan a partir de `recursos/logo_oniet30.jpg` y `recursos/logo_ubp.jpg`, quitándoles el fondo para ponerlos sobre la pantalla oscura:

```powershell
pip install pillow numpy scipy
python herramientas/procesar_logos.py
```

## Estructura

```
app.py                  Servidor Flask: páginas, API, sesión del administrador
passenger_wsgi.py       Punto de entrada para el hosting (cPanel / Passenger)
config.py               Configuración (variables de entorno o archivo .env)
database.py             Tablas (SQLAlchemy) y conexión a SQLite o MySQL
importacion.py          Lectura de las planillas de participantes (.csv y .xlsx)
gestion.py              Tareas desde la terminal: crear tablas, importar, contraseña
.env.ejemplo            Modelo del archivo de configuración
templates/index.html    Pantalla del sorteador
templates/admin.html    Administrador
templates/entrar.html   Contraseña del administrador
templates/error.html    Aviso cuando no hay conexión con la base
static/css/styles.css   Estilos de la pantalla (paleta del afiche del sorteo)
static/css/admin.css    Estilos del administrador
static/js/api.js        Pedidos a la API y consulta periódica del estado (compartido)
static/js/carrete.js    Listado con forma de tambor de tragamonedas
static/js/palanca.js    Palanca
static/js/mascota.js    Animaciones de la mascota
static/js/efectos.js    Sonidos (Web Audio) y confeti
static/js/app.js        Pantalla: distribución y animación del sorteo
static/js/admin.js      Administrador
static/img/mascota/     Poses de la mascota (PNG transparentes)
static/img/logos/       Logos de ONIET 30 y de la Universidad (PNG transparentes)
recursos/               Originales: hoja de poses de la mascota y logos
herramientas/           Scripts que recortan las poses y los logos
```

## Cómo se comunican las ventanas

El servidor es quien manda: guarda el premio, el orden y el estado del sorteo en la base, y las ventanas lo consultan cada segundo (`/api/estado`). El administrador no le habla a la pantalla directamente:

1. **Sortear** elige al ganador en el servidor y lo registra. El sorteo pasa a `sorteando` (y sube su número); cada pantalla, al verlo, anima el sorteo hasta ese ganador.
2. Cuando el listado se detiene, la pantalla avisa (`/api/revelado`, con el número del sorteo) y el sorteo pasa a `ganador`; recién ahí el administrador ve quién ganó.
3. **Continuar** lo vuelve a `listo` y las pantallas cierran la ventana del ganador.

Todo esto pasa en transacciones de la base: si dos pedidos de sortear llegan juntos (por ejemplo, un doble clic desde dos dispositivos), solo uno sortea. Si se recarga la pantalla en medio de un sorteo, muestra directamente al ganador. Si hay varias pantallas abiertas (el proyector y celulares), todas muestran el mismo ganador.

## Base de datos

| Tabla           | Contenido                                                             |
|-----------------|-----------------------------------------------------------------------|
| `participantes` | `id`, `nombre`, `apellido`                                            |
| `premios`       | `id`, `nombre`                                                        |
| `ganadores`     | `participante_id`, `premio` (nombre), `premio_id`, `fecha`            |
| `configuracion` | clave/valor: `orden` del listado y `premio_id` elegido como próximo   |
| `sorteo`        | Una fila: estado del sorteo, número, último ganador y versiones       |
| `pantallas`     | Pantallas abiertas y cuándo avisaron por última vez                   |

Las tablas se crean solas al arrancar (también en el hosting). Un premio se puede entregar varias veces; si se quita un premio ya entregado, los ganadores conservan su nombre. Una base SQLite de una versión anterior se actualiza sola.

Tareas desde la terminal (en el hosting, con el entorno de la aplicación activado):

```powershell
python gestion.py iniciar                      # crea las tablas y prueba la conexión
python gestion.py importar participantes.csv   # agrega participantes (--reemplazar: reemplaza todos)
python gestion.py demo                         # carga participantes y premios de ejemplo, si están vacíos
python gestion.py clave                        # genera el hash de la contraseña del administrador
python gestion.py reset                        # borra la base SQLite local (solo en la computadora)
```

## API

Las marcadas con 🔒 necesitan la sesión del administrador (y, si cambian algo, la cabecera `X-Sorteador: 1`).

| Método | Ruta                                    | Descripción                                                  |
|--------|-----------------------------------------|--------------------------------------------------------------|
| GET    | `/api/estado`                           | Estado del sorteo, premio actual, orden y contadores. La pantalla agrega `rol=pantalla&cliente=…&latido=1` para avisar que sigue abierta |
| POST   | `/api/adios?cliente=…`                  | La pantalla avisa que se cierra                              |
| GET    | `/api/participantes?orden=apellido\|id` | Lista de participantes, con estado de ganador                |
| POST   | `/api/revelado`                         | La pantalla avisa que ya muestra al ganador (`{"numero": 7}`) |
| PUT    | `/api/orden` 🔒                          | Cambia el orden del listado (`{"orden": "id"}`)              |
| GET    | `/api/premios` 🔒                        | Premios, con cuántas veces se entregó cada uno               |
| POST   | `/api/premios` 🔒                        | Agrega un premio (`{"nombre": "..."}`)                       |
| DELETE | `/api/premios/<id>` 🔒                   | Quita un premio                                              |
| PUT    | `/api/premio-actual` 🔒                  | Elige el próximo premio (`{"id": 3}`)                        |
| GET    | `/api/ganadores` 🔒                      | Ganadores en el orden en que salieron, con su premio         |
| POST   | `/api/sortear` 🔒                        | Elige y registra un ganador; las pantallas lo animan         |
| POST   | `/api/continuar` 🔒                      | Cierra la ventana del ganador                                |
| POST   | `/api/reiniciar` 🔒                      | Borra todos los ganadores                                    |
| POST   | `/api/participantes/importar` 🔒         | Carga una planilla (formulario con `archivo` y `modo=agregar\|reemplazar`) |
| GET    | `/salud`                                | Comprueba la conexión con la base (para verificar la instalación) |

El ganador se elige en el servidor con `secrets.choice`, entre quienes todavía no ganaron: todos tienen la misma probabilidad, sin importar dónde esté parado el listado ni cuántas vueltas dé. La pantalla solo anima ese resultado.
