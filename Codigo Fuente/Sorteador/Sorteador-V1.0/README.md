# Sorteador ONIET 30

Sorteador interactivo para el evento ONIET 30. Backend en Python (Flask) con base de datos MySQL/MariaDB en el hosting (o SQLite para probar en la computadora), y frontend en HTML, CSS y JavaScript.

Tiene dos ventanas:

- **Pantalla del sorteador** (`/`): la que se proyecta al público. No tiene controles del sorteo y cualquiera la puede abrir (también desde el celular).
- **Administrador** (`/admin`): desde donde se sortea y se manejan los premios y los participantes. Pide usuario y contraseña, que están en la base (tabla `administradores`). Se abre desde el botón 🔑 de la pantalla o entrando directamente a `/admin`.

## Probarlo en la computadora

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Se abre solo la pantalla del sorteador (http://127.0.0.1:5000). Si está instalado Chrome o Edge, se abre como aplicación (sin barra de direcciones), con un perfil propio que recuerda dónde quedó la ventana y que deja a la pantalla reproducir sonido sin hacerle clic. Si no, se abre en el navegador predeterminado; en ese caso la pantalla pide un clic para activar el sonido.

Para abrir el administrador, tocar el botón 🔑 (arriba a la derecha, abajo del de sonido) e ingresar el usuario y la contraseña: si son correctos, el administrador se abre en otra ventana.

Para levantar solo el servidor, sin abrir ventanas: `python app.py --sin-ventanas`.

Sin configuración, usa el archivo `sorteador.db` (SQLite) y, si está vacío, carga 40 estudiantes de ejemplo (32 inscriptos), 5 premios y el mismo administrador que `administradores.sql` (usuario `ONIET3030`).

## Subirlo al hosting (cPanel)

En el hosting el sorteador usa una base MySQL/MariaDB y corre con Passenger, a través de "Setup Python App" de cPanel. Pasos:

1. **Crear la base de datos.** En cPanel → *Bases de datos MySQL*: crear una base (por ejemplo `micuenta_sorteo`), crear un usuario con una contraseña segura y agregar ese usuario a la base con *Todos los privilegios*. Después, en *phpMyAdmin*, elegir esa base e **importar el script de la base** (crea `estudiantes`, `premios` y `ganadores`) y después **`administradores.sql`** (carpeta `Base de Datos` del repositorio: crea la tabla `administradores` con el usuario `ONIET3030`). Ver [Base de datos](#base-de-datos). Las tablas propias del sorteador (`configuracion`, `sorteo` y `pantallas`) las crea él solo al arrancar.
2. **Subir los archivos** a una carpeta de la cuenta que **no** esté dentro de `public_html` (por ejemplo `/home/micuenta/sorteador`), con el Administrador de archivos (subiendo un .zip y extrayéndolo) o con *Git Version Control*. Hay que subir todo menos `.venv`, `__pycache__` y `sorteador.db`. Las carpetas `recursos` y `herramientas` no hacen falta en el hosting.
3. **Crear la aplicación.** En cPanel → *Setup Python App* → *Create Application*:
   - *Python version*: 3.9 o más nueva (conviene la más nueva que ofrezca).
   - *Application root*: la carpeta del paso 2 (`sorteador`).
   - *Application URL*: el dominio o una subcarpeta (por ejemplo `midominio.com/sorteo`; funciona igual).
   - *Application startup file*: `passenger_wsgi.py`.
   - *Application Entry point*: `application`.
4. **Configurar.** En la carpeta de la aplicación, copiar `.env.ejemplo` como `.env` y completarlo con los datos de la base del paso 1 (ver [Configuración](#configuración)). En lugar del archivo se pueden cargar las mismas variables en la página de la aplicación, en *Environment variables*.
5. **Instalar las dependencias.** En la página de la aplicación, en *Configuration files*, agregar `requirements.txt` y tocar *Run Pip Install*. (O desde la *Terminal* de cPanel: activar el entorno con el comando que muestra la página de la aplicación, arriba de todo, y ejecutar `pip install -r requirements.txt`.)
6. **Reiniciar** la aplicación (botón *Restart*). Hay que hacerlo cada vez que se cambia el `.env` o se sube código nuevo.
7. **Activar https.** En cPanel → *SSL/TLS Status* (AutoSSL) el dominio tiene que tener certificado, y en *Dominios* conviene activar *Force HTTPS Redirect*. El administrador solo guarda la sesión por https.
8. **Comprobar.** Abrir `https://midominio.com/salud`: tiene que responder `"ok": true`, `"base": "mysql"` y en `"participantes"` la cantidad de estudiantes inscriptos. Si dice que no hay conexión, revisar los datos de la base en el `.env`; el detalle del error queda en el archivo `stderr.log` de la carpeta de la aplicación (o en *Errores* de cPanel).
9. **Revisar los datos.** Los estudiantes y los premios salen de la base. Desde el administrador (🔑 en la pantalla, o `https://midominio.com/admin`) se ve cuántos inscriptos hay y se pueden agregar premios.

El día del evento: abrir la pantalla (`https://midominio.com/`) en la computadora del proyector, **entrar con la llave 🔑** (así aparece el botón *Sortear* a la izquierda del listado), ponerla en pantalla completa con F11 y **hacerle un clic** para que el navegador deje reproducir el sonido. El resto del administrador (premios, Continuar) se puede manejar desde otra computadora o desde un celular.

### Cómo funciona en el hosting

En cPanel, Passenger corre el programa en varios procesos a la vez y los puede apagar cuando no se usan. Por eso el estado del sorteo se guarda en la base de datos (tabla `sorteo`) y cada ventana consulta `/api/estado` una vez por segundo, en lugar de mantener una conexión abierta. Cada pantalla abierta, además, avisa cada pocos segundos que sigue ahí (tabla `pantallas`); así el administrador sabe si hay alguna abierta.

Cada pantalla abierta hace una consulta por segundo. Para el proyector, el administrador y algunas personas mirando desde el celular no hay problema; si se espera que la miren cientos de personas a la vez, conviene consultar con el hosting los límites del plan (procesos y CPU). El intervalo se puede cambiar en `static/js/api.js` (`INTERVALO`).

## Configuración

Se lee de variables de entorno o del archivo `.env` en la carpeta del programa (ver `.env.ejemplo`). Si una variable está en los dos lugares, gana la variable de entorno. El archivo `.env` tiene contraseñas: no lo subas a un repositorio (ya está en `.gitignore`).

| Variable | Para qué |
|----------|----------|
| `SORTEADOR_DB_NOMBRE`, `SORTEADOR_DB_USUARIO`, `SORTEADOR_DB_CLAVE`, `SORTEADOR_DB_HOST`, `SORTEADOR_DB_PUERTO` | Datos de la base MySQL/MariaDB. La contraseña puede tener cualquier símbolo. |
| `SORTEADOR_DB_URL` | En lugar de lo anterior, la URL completa de la base. |
| `SORTEADOR_CLAVE_SECRETA` | Texto largo al azar para firmar la sesión del administrador (`python -c "import secrets; print(secrets.token_hex(32))"`). Si falta, se genera una al azar y se guarda en la base (tabla `configuracion`). |
| `SORTEADOR_COOKIE_SEGURA` | `1` (por defecto): la sesión solo viaja por https. Poner `0` solo si el sitio todavía no tiene certificado. |
| `SORTEADOR_ZONA_HORARIA` | Para la hora de cada ganador. Por defecto `America/Argentina/Cordoba`. |

Sin `SORTEADOR_DB_NOMBRE` ni `SORTEADOR_DB_URL`, usa SQLite (`sorteador.db`) con datos de ejemplo.

### Seguridad

- La pantalla es pública; todo lo demás (sortear, continuar, premios, orden, lista de ganadores) necesita la sesión del administrador. La llave de la pantalla la abre solo con un usuario y una contraseña correctos.
- Los usuarios están en la tabla `administradores`. De la contraseña se guarda solo un hash PBKDF2-SHA256 (1.000.000 de iteraciones, con sal al azar): no se puede revertir para obtener la contraseña. El usuario distingue mayúsculas y minúsculas.
- Si se borra un usuario de la tabla, su sesión se cierra en el siguiente pedido.
- Cuando el usuario o la contraseña no coinciden, la respuesta es la misma (y tarda lo mismo) exista o no el usuario.
- Los pedidos que cambian algo además llevan una cabecera propia (`X-Sorteador`), que una página de otro sitio no puede agregar: así no puede aprovechar una sesión abierta.
- El listado público de participantes solo lleva el id, el nombre y el apellido: nunca el DNI, el legajo ni el email.
- Después de 5 intentos fallidos seguidos desde una misma dirección (en la llave o en `/admin`), hay que esperar unos minutos.
- La sesión dura 12 horas; el botón *Salir* la cierra.

## Participantes

Participan los estudiantes **inscriptos**: las filas de la tabla `estudiantes` con `inscripto = 1`. Los marca el formulario de inscripción (o se pueden marcar a mano en phpMyAdmin). El sorteador no modifica esa tabla: solo la lee.

- La pantalla muestra el id, el nombre y el apellido de cada inscripto que todavía no ganó.
- Cuando alguien se inscribe, la pantalla lo suma sola (nota que cambió la cantidad de inscriptos) y el listado se desliza hasta dejarlo en el centro. Si solo se corrigió un nombre, hay que recargarla (F5).
- El sorteo se hace entre los inscriptos que todavía no ganaron. Quien se inscribe durante un giro entra desde el sorteo siguiente.

## Uso

### Administrador

- **Continuar**: cierra la ventana del ganador en la pantalla (también se cierra con Escape en la pantalla, si se abrió en el mismo navegador donde se inició sesión en el administrador).
- **Premios**: el marcado es el que se sortea a continuación y aparece en la pantalla como "Próximo premio". **Cada premio se entrega una sola vez**: después del sorteo queda tachado, con el nombre de quien lo ganó, y pasa solo al primero de la lista que falta entregar. Se pueden agregar premios y quitar los que todavía no se entregaron.
- **Ordenar por**: ordena el listado de la pantalla por apellido o por ID de participante.
- **Reiniciar ganadores**: borra la lista de ganadores (tabla `ganadores`): todos los inscriptos vuelven a entrar en juego y los premios quedan sin entregar.
- **Ganadores** (columna de la derecha): cada ganador con su premio y la hora, el más reciente arriba y numerados en el orden en que salieron. El ganador aparece recién cuando la pantalla lo muestra.

Arriba se indica si la pantalla del sorteador está abierta; si no, hay un enlace para abrirla. En la sección *Sorteo* dice qué falta para poder sortear. El botón *Salir* cierra la sesión.

### Pantalla

- **Sortear** (el botón redondo a la izquierda del listado): la mascota tira de la palanca y el listado gira. Es un botón de arcade que se hunde al apretarlo y queda hundido, con su aro de luces girando, hasta que termina el sorteo. Aparece solo en el navegador donde se entró con la llave 🔑 (el público que mira la pantalla desde otro lado no lo ve, y para ellos el listado sigue centrado). Está apagado si no queda algún inscripto en juego o algún premio sin entregar; al pasarle el mouse dice qué falta.
- **El listado de participantes es el tragamonedas.** La fila que queda sobre la línea del medio es la ganadora. Mientras no gira, se puede recorrer con la rueda del mouse, arrastrando o con las flechas del teclado.
- Cuando el listado se detiene, aparece una ventana con el ganador hasta que el administrador toca Continuar.
- **No se puede ganar dos veces**: cuando el administrador toca Continuar, el ganador sale del listado (y el servidor solo sortea entre quienes no ganaron).
- En cada sorteo el listado da al menos 3 vueltas completas, por más participantes que haya. Con cientos, el tramo rápido se ve borroso, como un tambor girando.
- 🔊 (arriba a la derecha) activa o desactiva el sonido.
- 🔑 (abajo del sonido) pide usuario y contraseña y, si son correctos, abre el administrador en otra ventana. Si el navegador bloquea la ventana nueva, en el mismo panel aparece un enlace para abrirla.
- **Se adapta a cualquier pantalla** (computadora, tablet o celular, parado o acostado) manteniendo el mismo orden: logo y premio arriba, el listado en el centro con el botón *Sortear* a su izquierda (si se muestra) y la palanca y la mascota a su derecha, y el logo de la Universidad abajo. El botón mide el 80% del ancho de la máquina (`BOTON` en `app.js`). Si no entra todo a lo ancho, `app.js` reparte el ancho: la máquina se queda con el 64% (`PARTE_MAQUINA`; 60% con el botón) y la mascota, la palanca y el botón se achican juntos, para que la mano siga llegando al pomo. En celulares la letra del listado es más chica para que entren los nombres, y con el celular acostado el logo y el premio van en una sola línea.

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
gestion.py              Tareas desde la terminal: crear tablas, datos de ejemplo, administradores
.env.ejemplo            Modelo del archivo de configuración
templates/index.html    Pantalla del sorteador
templates/admin.html    Administrador
templates/entrar.html   Usuario y contraseña del administrador
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

1. **Sortear** (el botón de la pantalla) elige al ganador en el servidor y lo registra. El sorteo pasa a `sorteando` (y sube su número); la pantalla que lo pidió lo anima enseguida y las demás, al verlo, animan el sorteo hasta ese ganador.
2. Cuando el listado se detiene, la pantalla avisa (`/api/revelado`, con el número del sorteo) y el sorteo pasa a `ganador`; recién ahí el administrador ve quién ganó.
3. **Continuar** lo vuelve a `listo` y las pantallas cierran la ventana del ganador.

Todo esto pasa en transacciones de la base: si dos pedidos de sortear llegan juntos (por ejemplo, un doble clic desde dos dispositivos), solo uno sortea. Si se recarga la pantalla en medio de un sorteo, muestra directamente al ganador. Si hay varias pantallas abiertas (el proyector y celulares), todas muestran el mismo ganador.

## Base de datos

Tablas del evento. En el hosting se crean importando el script de la base en phpMyAdmin; si no existen, el sorteador las crea vacías con la misma estructura:

| Tabla         | Contenido                                                                                  |
|---------------|--------------------------------------------------------------------------------------------|
| `estudiantes` | `id`, `legajo`, `dni`, `nombre`, `apellido`, `email`, `inscripto` (0/1), `fecha_inscripcion`. Participan los que tienen `inscripto = 1` |
| `premios`     | `id`, `nombre` (hasta 150 caracteres)                                                      |
| `ganadores`   | `id_estudiante`, `id_premio`, `fecha`. Nadie gana dos veces y cada premio se entrega una sola vez (claves únicas) |
| `administradores` | `id`, `usuario` (único, distingue mayúsculas), `clave_hash`. Se crea con `administradores.sql` |

Tablas propias del sorteador, que crea solo al arrancar:

| Tabla           | Contenido                                                             |
|-----------------|-----------------------------------------------------------------------|
| `configuracion` | clave/valor: `orden` del listado, `premio_id` elegido como próximo y `clave_secreta` de la sesión |
| `sorteo`        | Una fila: estado del sorteo, número, último ganador y versiones       |
| `pantallas`     | Pantallas abiertas y cuándo avisaron por última vez                   |

**Administradores.** `Base de Datos/administradores.sql` crea la tabla y el usuario `ONIET3030`; se puede volver a importar (si el usuario existe, le vuelve a poner esa contraseña). Para agregar un usuario o cambiar una contraseña:

- Con terminal: `python gestion.py admin USUARIO` (pide la contraseña y la guarda como hash).
- Sin terminal: en la computadora, `python gestion.py clave USUARIO` muestra el SQL con el hash, para ejecutarlo en phpMyAdmin (pestaña *SQL*).
- Para quitar un usuario: borrar su fila de `administradores`.

La base no deja borrar un estudiante que ganó ni un premio entregado. Para el día del evento se vacían los ganadores con *Reiniciar ganadores* (o con el reset que trae el script de la base).

Si en la computadora quedó un `sorteador.db` de la versión anterior (con la tabla `participantes`), el sorteador avisa que no lo puede usar: se borra con `python gestion.py reset`.

Tareas desde la terminal (en el hosting, con el entorno de la aplicación activado):

```powershell
python gestion.py iniciar                      # crea las tablas que falten y prueba la conexión
python gestion.py demo                         # carga estudiantes, premios y el administrador de ejemplo, si están vacíos
python gestion.py admin USUARIO                # crea un administrador o le cambia la contraseña
python gestion.py clave USUARIO                # muestra el SQL con el hash, para phpMyAdmin
python gestion.py reset                        # borra la base SQLite local (solo en la computadora)
```

## API

Las marcadas con 🔒 necesitan la sesión del administrador (y, si cambian algo, la cabecera `X-Sorteador: 1`).

| Método | Ruta                                    | Descripción                                                  |
|--------|-----------------------------------------|--------------------------------------------------------------|
| GET    | `/api/estado`                           | Estado del sorteo, premio actual, orden y contadores. La pantalla agrega `rol=pantalla&cliente=…&latido=1` para avisar que sigue abierta |
| POST   | `/api/adios?cliente=…`                  | La pantalla avisa que se cierra                              |
| GET    | `/api/participantes?orden=apellido\|id` | Estudiantes inscriptos (id, nombre y apellido), con estado de ganador |
| POST   | `/api/revelado`                         | La pantalla avisa que ya muestra al ganador (`{"numero": 7}`) |
| POST   | `/api/entrar`                           | La llave de la pantalla: abre la sesión del administrador (`{"usuario": "...", "clave": "..."}`) |
| PUT    | `/api/orden` 🔒                          | Cambia el orden del listado (`{"orden": "id"}`)              |
| GET    | `/api/premios` 🔒                        | Premios y, si ya se entregó, a quién                         |
| POST   | `/api/premios` 🔒                        | Agrega un premio (`{"nombre": "..."}`)                       |
| DELETE | `/api/premios/<id>` 🔒                   | Quita un premio                                              |
| PUT    | `/api/premio-actual` 🔒                  | Elige el próximo premio (`{"id": 3}`)                        |
| GET    | `/api/ganadores` 🔒                      | Ganadores en el orden en que salieron, con su premio         |
| POST   | `/api/sortear` 🔒                        | Elige y registra un ganador; las pantallas lo animan         |
| POST   | `/api/continuar` 🔒                      | Cierra la ventana del ganador                                |
| POST   | `/api/reiniciar` 🔒                      | Borra todos los ganadores                                    |
| GET    | `/salud`                                | Comprueba la conexión con la base (para verificar la instalación) |

El ganador se elige en el servidor con `secrets.choice`, entre los inscriptos que todavía no ganaron: todos tienen la misma probabilidad, sin importar dónde esté parado el listado ni cuántas vueltas dé. La pantalla solo anima ese resultado.
