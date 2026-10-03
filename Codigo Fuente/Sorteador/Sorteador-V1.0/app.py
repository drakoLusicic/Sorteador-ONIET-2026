"""Sorteador ONIET 30 - servidor Flask.

Todo el programa necesita usuario y contraseña (tabla administradores).
Al entrar a la dirección del sorteador (`/`) aparece primero el ingreso; con
los datos correctos, esa ventana pasa a ser la pantalla del sorteador (la
ruleta, que se proyecta, con el botón Sortear) y el administrador (`/admin`)
se abre en otra ventana. Desde el administrador se ordena el listado, se
manejan los premios y se cierra la ventana del ganador; en la pantalla, el
botón de la llave lo vuelve a abrir. Los participantes son los estudiantes
inscriptos (tabla estudiantes, inscripto = 1).

Las ventanas consultan el estado cada segundo (`/api/estado`). El estado del
sorteo se guarda en la base de datos y no en memoria: en el hosting
(cPanel/Passenger) el programa corre en varios procesos a la vez y todos
tienen que ver lo mismo.

En la computadora se ejecuta con `python app.py`; en el hosting lo carga
`passenger_wsgi.py`.
"""

import json
import logging
import os
import random
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unicodedata
import webbrowser
from contextlib import closing
from datetime import timedelta
from functools import wraps
from pathlib import Path

from flask import Flask, jsonify, redirect, render_template, request, session, url_for
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.exc import IntegrityError
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.security import check_password_hash

import config
import database as bd
from database import administradores, estudiantes, ganadores, pantallas, premios
from database import sorteo as tabla_sorteo

PUERTO = 5000
MAX_LARGO_PREMIO = 150  # premios.nombre es VARCHAR(150)
PANTALLA_VIGENTE = timedelta(seconds=12)  # una pantalla cuenta como abierta si avisó hace menos
CACHE_ESTADO = 0.5  # segundos que se reutiliza el estado calculado (muchas pantallas consultan a la vez)
CLIENTE_VALIDO = re.compile(r"[A-Za-z0-9_-]{6,40}")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("sorteador")

app = Flask(__name__)


app.config.update(
    # Sin SORTEADOR_CLAVE_SECRETA, la clave se toma de la base al prepararla
    # (ver preparar_base); hasta entonces, una al azar.
    SECRET_KEY=config.CLAVE_SECRETA or secrets.token_hex(32),
    SESSION_COOKIE_NAME="sorteador_sesion",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=config.COOKIE_SEGURA,
    PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
    MAX_CONTENT_LENGTH=64 * 1024,  # los pedidos son JSON chicos
)


# --------------------------------------------------------------------------- #
# Base de datos: se prepara al arrancar y, si falla (por ejemplo, datos de
# conexión mal escritos), se reintenta en cada pedido hasta que funcione.
# --------------------------------------------------------------------------- #
_base_lista = False
_base_ultimo_intento = 0.0
_base_bloqueo = threading.Lock()


def preparar_base():
    global _base_lista, _base_ultimo_intento
    if _base_lista:
        return True
    with _base_bloqueo:
        if _base_lista:
            return True
        if time.monotonic() - _base_ultimo_intento < 5:
            return False
        _base_ultimo_intento = time.monotonic()
        try:
            bd.init_db()
            if not config.CLAVE_SECRETA:
                app.secret_key = bd.clave_secreta()
            _base_lista = True
            log.info("Base de datos lista (%s).", bd.motor_nombre())
        except Exception:
            log.exception("No se pudo preparar la base de datos. Revisá la configuración (.env).")
        return _base_lista


@app.before_request
def _exigir_base():
    if request.endpoint in ("static", "salud"):
        return None
    if not preparar_base():
        mensaje = "El sorteador no se puede conectar con la base de datos. Revisá la configuración."
        if request.path.startswith("/api/"):
            return error(mensaje, 503)
        return render_template("error.html", mensaje=mensaje), 503
    return None


class ErrorApi(Exception):
    def __init__(self, mensaje, codigo=409):
        super().__init__(mensaje)
        self.mensaje = mensaje
        self.codigo = codigo


def error(texto, codigo=409):
    return jsonify(error=texto), codigo


@app.errorhandler(ErrorApi)
def _error_api(exc):
    return error(exc.mensaje, exc.codigo)


@app.errorhandler(RequestEntityTooLarge)
def _archivo_grande(_exc):
    return error("El pedido es demasiado grande.", 413)


@app.after_request
def _cabeceras_seguridad(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    return resp


# --------------------------------------------------------------------------- #
# Usuario, contraseña y sesión (para todo el programa)
# --------------------------------------------------------------------------- #
MAX_LARGO_USUARIO = 50  # administradores.usuario es VARCHAR(50)
MAX_LARGO_CLAVE = 200

# Si el usuario no existe se compara igual contra este hash (de una clave al
# azar que nadie conoce), así la respuesta tarda lo mismo y no deja averiguar
# qué usuarios existen.
HASH_DE_RELLENO = (
    "pbkdf2:sha256:1000000$rxrbFb324OtDyCoF$225046f8297879447c3d078b7014d16b83a67af6c783f56a9ca264f121b202bd"
)


def es_admin():
    """La sesión guarda el usuario; si lo borraron de la base, se cierra."""
    usuario = session.get("admin")
    if not isinstance(usuario, str):
        return False
    with bd.conexion() as con:
        return bd.buscar_admin(con, usuario) is not None


def credenciales_correctas(usuario, clave):
    """Compara la contraseña con el hash guardado en la tabla administradores."""
    if not usuario or len(usuario) > MAX_LARGO_USUARIO or len(clave) > MAX_LARGO_CLAVE:
        return False
    with bd.conexion() as con:
        admin = bd.buscar_admin(con, usuario)
    correcta = check_password_hash(admin["clave_hash"] if admin else HASH_DE_RELLENO, clave)
    return admin is not None and correcta


def hay_admins():
    with bd.conexion() as con:
        return contar(con, administradores) > 0


# Intentos fallidos por dirección IP (por proceso; alcanza para frenar a
# quien prueba contraseñas a mano o con un programa simple).
_fallos = {}
_fallos_bloqueo = threading.Lock()
MAX_FALLOS = 5
VENTANA_FALLOS = 300  # segundos


def demasiados_fallos(ip):
    ahora = time.monotonic()
    with _fallos_bloqueo:
        recientes = [t for t in _fallos.get(ip, []) if ahora - t < VENTANA_FALLOS]
        _fallos[ip] = recientes
        return len(recientes) >= MAX_FALLOS


def anotar_fallo(ip):
    with _fallos_bloqueo:
        _fallos.setdefault(ip, []).append(time.monotonic())


def intentar_entrar(usuario, clave):
    """Si el usuario y la contraseña son correctos, abre la sesión del
    administrador y devuelve None; si no, devuelve el aviso para mostrar."""
    ip = request.remote_addr or "?"
    if demasiados_fallos(ip):
        return "Demasiados intentos fallidos. Esperá unos minutos."
    usuario = usuario.strip()
    if not credenciales_correctas(usuario, clave):
        anotar_fallo(ip)
        time.sleep(1)
        if not hay_admins():
            return "Todavía no hay administradores en la base: falta importar administradores.sql."
        return "Usuario o contraseña incorrectos."
    session.clear()
    session.permanent = True
    session["admin"] = usuario
    return None


def requiere_admin(vista):
    """Para la API (toda necesita la sesión, salvo el ingreso). Los pedidos
    que cambian algo además tienen que traer la cabecera X-Sorteador (la
    agrega api.js): una página de otro sitio no puede agregarla, así no puede
    usar la sesión abierta."""

    @wraps(vista)
    def envoltura(*args, **kwargs):
        if not es_admin():
            return error("La sesión se cerró. Volvé a entrar.", 401)
        if request.method not in ("GET", "HEAD") and request.headers.get("X-Sorteador") != "1":
            return error("Pedido no permitido.", 403)
        return vista(*args, **kwargs)

    return envoltura


# --------------------------------------------------------------------------- #
# Estado del sorteo
# --------------------------------------------------------------------------- #
def _normalizar(texto):
    """Quita tildes y pasa a minúsculas para ordenar alfabéticamente."""
    return unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode().casefold()


ORDENES = {
    "apellido": lambda p: (_normalizar(p["apellido"]), _normalizar(p["nombre"]), p["id"]),
    "id": lambda p: p["id"],
}


def limpiar_premio(valor):
    return str(valor or "").strip()[:MAX_LARGO_PREMIO]


def primero_sin_entregar(con):
    """El primer premio de la lista que todavía no se entregó, o None."""
    fila = con.execute(
        select(premios.c.id, premios.c.nombre).where(bd.SIN_ENTREGAR).order_by(premios.c.id).limit(1)
    ).mappings().first()
    return dict(fila) if fila else None


def premio_actual(con):
    """El premio que se sortea a continuación: el elegido en el administrador,
    aunque ya se haya entregado (un premio se puede entregar más de una vez).
    Si no hay uno elegido (o se quitó), el primero de la lista que falta
    entregar o, si ya se entregaron todos, el primero. None si no hay premios."""
    lista = con.execute(select(premios.c.id, premios.c.nombre).order_by(premios.c.id)).mappings().all()
    if not lista:
        return None
    elegido = bd.leer_config(con, "premio_id")
    for premio in lista:
        if str(premio["id"]) == elegido:
            return dict(premio)
    return primero_sin_entregar(con) or dict(lista[0])


def leer_sorteo(con):
    return con.execute(select(tabla_sorteo).where(tabla_sorteo.c.id == 1)).mappings().one()


def contar_pantallas(con):
    limite = bd.ahora_utc() - PANTALLA_VIGENTE
    return con.execute(select(func.count()).select_from(pantallas).where(pantallas.c.visto >= limite)).scalar_one()


def contar(con, tabla, *condiciones):
    return con.execute(select(func.count()).select_from(tabla).where(*condiciones)).scalar_one()


def foto_estado(con):
    """Todo lo que las ventanas necesitan saber para dibujarse. Los
    participantes son los estudiantes inscriptos."""
    s = leer_sorteo(con)
    return {
        "sorteo": s["estado"],
        "numero": s["numero"],
        "ultimo": json.loads(s["ultimo"]) if s["ultimo"] else None,
        "version": s["version"],
        "version_participantes": s["version_participantes"],
        "premio": premio_actual(con),
        "orden": bd.leer_config(con, "orden", "apellido"),
        "participantes": contar(con, estudiantes, bd.INSCRIPTO),
        "ganadores": contar(con, ganadores),
        "en_juego": contar(con, estudiantes, bd.EN_JUEGO),
        "pantallas": contar_pantallas(con),
    }


_cache = {"datos": None, "hasta": 0.0}
_cache_bloqueo = threading.Lock()


def estado_actual():
    ahora = time.monotonic()
    with _cache_bloqueo:
        if _cache["datos"] is not None and ahora < _cache["hasta"]:
            return _cache["datos"]
    with bd.conexion() as con:
        datos = foto_estado(con)
    with _cache_bloqueo:
        _cache.update(datos=datos, hasta=time.monotonic() + CACHE_ESTADO)
    return datos


def olvidar_estado():
    """Después de un cambio, el próximo pedido recalcula el estado."""
    with _cache_bloqueo:
        _cache["datos"] = None


def tocar(con, participantes_cambiaron=False):
    """Marca que algo cambió: las ventanas lo notan en su próxima consulta."""
    valores = {"version": tabla_sorteo.c.version + 1}
    if participantes_cambiaron:
        valores["version_participantes"] = tabla_sorteo.c.version_participantes + 1
    con.execute(update(tabla_sorteo).where(tabla_sorteo.c.id == 1).values(**valores))


def registrar_pantalla(cliente):
    """La pantalla avisa que sigue abierta. Devuelve True si es nueva."""
    ahora = bd.ahora_utc()
    with bd.transaccion() as con:
        if con.execute(update(pantallas).where(pantallas.c.cliente == cliente).values(visto=ahora)).rowcount:
            nueva = False
        else:
            con.execute(insert(pantallas).values(cliente=cliente, visto=ahora))
            nueva = True
        if random.random() < 0.05:
            bd.borrar_pantallas_viejas(con, ahora - timedelta(hours=1))
    return nueva


# --------------------------------------------------------------------------- #
# Páginas
# --------------------------------------------------------------------------- #
@app.get("/")
def pantalla():
    """La pantalla del sorteador. Sin sesión, primero el ingreso (entrar.js
    abre la sesión y el administrador en otra ventana, y vuelve acá)."""
    if not es_admin():
        # Con la cookie segura, sin https el navegador no la guarda.
        sin_https = app.config["SESSION_COOKIE_SECURE"] and not request.is_secure
        return render_template("entrar.html", sin_https=sin_https)
    with bd.conexion() as con:
        premio = premio_actual(con)
    return render_template("index.html", premio=premio)


@app.get("/admin")
def administrador():
    if not es_admin():
        return redirect(url_for("pantalla"))
    return render_template("admin.html")


@app.post("/admin/salir")
def salir():
    """Cierra la sesión: el administrador y las pantallas vuelven al ingreso."""
    session.clear()
    return redirect(url_for("pantalla"))


@app.get("/salud")
def salud():
    """Para comprobar la instalación: responde si la base de datos anda."""
    if not preparar_base():
        return jsonify(ok=False, base="sin conexión"), 503
    try:
        with bd.conexion() as con:
            cantidad = contar(con, estudiantes, bd.INSCRIPTO)
    except Exception:
        log.exception("Falló la consulta de /salud")
        return jsonify(ok=False, base="error"), 503
    return jsonify(ok=True, base=bd.motor_nombre(), participantes=cantidad)


# --------------------------------------------------------------------------- #
# API de la pantalla del sorteador
# --------------------------------------------------------------------------- #
@app.get("/api/estado")
@requiere_admin
def ver_estado():
    """Lo consultan las ventanas cada segundo. Las pantallas agregan
    `latido=1` cada pocos segundos para avisar que siguen abiertas."""
    cliente = request.args.get("cliente", "")
    if request.args.get("rol") == "pantalla" and request.args.get("latido") and CLIENTE_VALIDO.fullmatch(cliente):
        if registrar_pantalla(cliente):
            olvidar_estado()  # el administrador ve enseguida que se abrió
    resp = jsonify(estado_actual())
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.post("/api/adios")
def adios():
    """La pantalla avisa que se cierra (así el administrador lo ve enseguida).
    Llega con sendBeacon, que no puede agregar la cabecera X-Sorteador, así
    que no pide la sesión: solo borra el aviso de esa pantalla (su id es al
    azar)."""
    cliente = request.args.get("cliente", "")
    if CLIENTE_VALIDO.fullmatch(cliente):
        with bd.transaccion() as con:
            con.execute(delete(pantallas).where(pantallas.c.cliente == cliente))
        olvidar_estado()
    return "", 204


@app.get("/api/participantes")
@requiere_admin
def listar_participantes():
    """Los estudiantes inscriptos, con el premio de quienes ya ganaron. Solo
    lleva el id, el nombre y el apellido (ni DNI ni email)."""
    with bd.conexion() as con:
        orden = request.args.get("orden") or bd.leer_config(con, "orden", "apellido")
        if orden not in ORDENES:
            raise ErrorApi(f"Orden inválido: {orden}", 400)
        filas = con.execute(
            select(estudiantes.c.id, estudiantes.c.nombre, estudiantes.c.apellido, premios.c.nombre.label("premio"))
            .select_from(
                estudiantes.outerjoin(ganadores, ganadores.c.id_estudiante == estudiantes.c.id)
                .outerjoin(premios, premios.c.id == ganadores.c.id_premio)
            )
            .where(bd.INSCRIPTO)
        ).mappings().all()

    lista = [
        {
            "id": f["id"],
            "nombre": f["nombre"],
            "apellido": f["apellido"],
            "ganador": f["premio"] is not None,
            "premio": f["premio"],
        }
        for f in filas
    ]
    lista.sort(key=ORDENES[orden])
    return jsonify(participantes=lista)


@app.post("/api/revelado")
@requiere_admin
def revelado():
    """La pantalla avisa que el listado se detuvo y ya muestra al ganador."""
    numero = (request.get_json(silent=True) or {}).get("numero")
    condiciones = [tabla_sorteo.c.id == 1, tabla_sorteo.c.estado == "sorteando"]
    if isinstance(numero, int):
        condiciones.append(tabla_sorteo.c.numero == numero)
    with bd.transaccion() as con:
        cambio = con.execute(
            update(tabla_sorteo).where(*condiciones).values(estado="ganador", version=tabla_sorteo.c.version + 1)
        ).rowcount
    if cambio:
        olvidar_estado()
    return jsonify(ok=True)


@app.post("/api/entrar")
def entrar():
    """El ingreso: con el usuario y la contraseña correctos abre la sesión, y
    la página abre la pantalla del sorteador y el administrador."""
    if request.headers.get("X-Sorteador") != "1":
        return error("Pedido no permitido.", 403)
    datos = request.get_json(silent=True) or {}
    aviso = intentar_entrar(str(datos.get("usuario") or ""), str(datos.get("clave") or ""))
    if aviso:
        return error(aviso, 401)
    return jsonify(ok=True)


# --------------------------------------------------------------------------- #
# API del administrador
# --------------------------------------------------------------------------- #
@app.put("/api/orden")
@requiere_admin
def cambiar_orden():
    orden = (request.get_json(silent=True) or {}).get("orden")
    if orden not in ORDENES:
        raise ErrorApi(f"Orden inválido: {orden}", 400)
    with bd.transaccion() as con:
        bd.guardar_config(con, "orden", orden)
        tocar(con)
    olvidar_estado()
    return jsonify(orden=orden)


@app.get("/api/premios")
@requiere_admin
def listar_premios():
    """Premios y a quiénes se entregó cada uno (en el orden en que salieron)."""
    with bd.conexion() as con:
        lista = con.execute(select(premios.c.id, premios.c.nombre).order_by(premios.c.id)).mappings().all()
        entregas = con.execute(
            select(ganadores.c.id_premio, estudiantes.c.id, estudiantes.c.nombre, estudiantes.c.apellido)
            .select_from(ganadores.join(estudiantes, estudiantes.c.id == ganadores.c.id_estudiante))
            .order_by(ganadores.c.id)
        ).mappings().all()
    por_premio = {}
    for f in entregas:
        por_premio.setdefault(f["id_premio"], []).append({"id": f["id"], "nombre": f"{f['apellido']}, {f['nombre']}"})
    return jsonify(premios=[
        {"id": p["id"], "nombre": p["nombre"], "ganadores": por_premio.get(p["id"], [])} for p in lista
    ])


@app.get("/api/ganadores")
@requiere_admin
def listar_ganadores():
    """Ganadores en el orden en que salieron, con el premio de cada uno."""
    with bd.conexion() as con:
        filas = con.execute(
            select(
                estudiantes.c.id,
                estudiantes.c.nombre,
                estudiantes.c.apellido,
                premios.c.nombre.label("premio"),
                ganadores.c.fecha,
            )
            .select_from(
                ganadores.join(estudiantes, estudiantes.c.id == ganadores.c.id_estudiante)
                .join(premios, premios.c.id == ganadores.c.id_premio)
            )
            .order_by(ganadores.c.id)
        ).mappings().all()
    return jsonify(ganadores=[{**f, "fecha": f["fecha"].strftime("%Y-%m-%d %H:%M:%S")} for f in filas])


@app.post("/api/premios")
@requiere_admin
def agregar_premio():
    nombre = limpiar_premio((request.get_json(silent=True) or {}).get("nombre"))
    if not nombre:
        raise ErrorApi("Escribí el nombre del premio.", 400)
    with bd.transaccion() as con:
        nuevo_id = con.execute(insert(premios).values(nombre=nombre)).inserted_primary_key[0]
        tocar(con)
    olvidar_estado()
    return jsonify(id=nuevo_id, nombre=nombre), 201


@app.delete("/api/premios/<int:premio_id>")
@requiere_admin
def quitar_premio(premio_id):
    with bd.transaccion() as con:
        # La base no deja borrar un premio entregado (ganadores.id_premio).
        if con.execute(select(ganadores.c.id).where(ganadores.c.id_premio == premio_id)).first() is not None:
            raise ErrorApi("Ese premio ya se entregó: no se puede quitar.")
        if not con.execute(delete(premios).where(premios.c.id == premio_id)).rowcount:
            raise ErrorApi("Ese premio no existe.", 404)
        tocar(con)
    olvidar_estado()
    return jsonify(ok=True)


@app.put("/api/premio-actual")
@requiere_admin
def elegir_premio():
    premio_id = (request.get_json(silent=True) or {}).get("id")
    with bd.transaccion() as con:
        # Puede estar entregado: un premio se puede entregar más de una vez.
        if con.execute(select(premios.c.id).where(premios.c.id == premio_id)).first() is None:
            raise ErrorApi("Ese premio no existe.", 404)
        bd.guardar_config(con, "premio_id", premio_id)
        tocar(con)
    olvidar_estado()
    return jsonify(ok=True)


@app.post("/api/sortear")
@requiere_admin
def sortear():
    """Elige un ganador al azar entre los inscriptos que todavía no ganaron,
    para el premio actual. Después el próximo premio pasa a ser el primero de
    la lista que falta entregar (si ya se entregaron todos, sigue el mismo);
    desde el administrador se puede volver a elegir uno ya entregado.

    El ganador se decide en el servidor. La pantalla recibe el resultado y
    solo lo anima: la mascota tira de la palanca y el listado gira hasta él.
    Lo pide el botón Sortear de la pantalla, que recibe el resultado en la
    respuesta y lo anima enseguida; las demás pantallas se enteran al
    consultar el estado.
    Todo pasa en una transacción: si dos pedidos llegan juntos, la base deja
    pasar a uno solo (el otro encuentra el sorteo ya en curso).
    """
    with bd.transaccion() as con:
        tomado = con.execute(
            update(tabla_sorteo)
            .where(tabla_sorteo.c.id == 1, tabla_sorteo.c.estado == "listo")
            .values(estado="sorteando", numero=tabla_sorteo.c.numero + 1, version=tabla_sorteo.c.version + 1)
        ).rowcount
        if not tomado:
            raise ErrorApi("Ya hay un sorteo en curso.")
        if not contar_pantallas(con):
            raise ErrorApi("La pantalla del sorteador no está abierta.")
        premio = premio_actual(con)
        if premio is None:
            raise ErrorApi("No hay premios. Agregá uno para poder sortear.")

        candidatos = con.execute(
            select(estudiantes.c.id, estudiantes.c.nombre, estudiantes.c.apellido)
            .where(bd.EN_JUEGO)
            .order_by(estudiantes.c.id)
        ).mappings().all()
        if not candidatos:
            raise ErrorApi("No quedan participantes para sortear.")

        elegido = dict(secrets.choice(candidatos))
        try:
            con.execute(
                insert(ganadores).values(id_estudiante=elegido["id"], id_premio=premio["id"], fecha=bd.ahora_local())
            )
        except IntegrityError as exc:
            # La base todavía tiene la clave única en ganadores.id_premio (ver database.py).
            raise ErrorApi(
                "La base de datos todavía no deja entregar un premio más de una vez. Reiniciá la aplicación; "
                "si sigue igual, quitá la clave única de ganadores.id_premio (ver README)."
            ) from exc
        bd.guardar_config(con, "premio_id", (primero_sin_entregar(con) or premio)["id"])
        numero = con.execute(select(tabla_sorteo.c.numero).where(tabla_sorteo.c.id == 1)).scalar_one()
        ultimo = {"numero": numero, "ganador": elegido, "premio": premio["nombre"], "premio_id": premio["id"]}
        con.execute(
            update(tabla_sorteo).where(tabla_sorteo.c.id == 1).values(ultimo=json.dumps(ultimo, ensure_ascii=False))
        )
    olvidar_estado()
    return jsonify(ok=True, ultimo=ultimo)


@app.post("/api/continuar")
@requiere_admin
def continuar():
    """Cierra la ventana del ganador en la pantalla."""
    with bd.transaccion() as con:
        # Sin pantalla abierta nadie va a avisar que terminó: se permite cerrar igual.
        if leer_sorteo(con)["estado"] == "sorteando" and contar_pantallas(con):
            raise ErrorApi("Esperá a que termine el sorteo.")
        con.execute(
            update(tabla_sorteo).where(tabla_sorteo.c.id == 1).values(estado="listo", version=tabla_sorteo.c.version + 1)
        )
    olvidar_estado()
    return jsonify(ok=True)


@app.post("/api/reiniciar")
@requiere_admin
def reiniciar():
    """Borra los ganadores: todos vuelven al sorteo y los premios quedan sin entregar."""
    with bd.transaccion() as con:
        if leer_sorteo(con)["estado"] != "listo":
            raise ErrorApi("Esperá a que termine el sorteo.")
        con.execute(delete(ganadores))
        con.execute(update(tabla_sorteo).where(tabla_sorteo.c.id == 1).values(ultimo=None))
        tocar(con, participantes_cambiaron=True)
    olvidar_estado()
    return jsonify(ok=True)


# --------------------------------------------------------------------------- #
# Uso en la computadora: `python app.py` abre el ingreso, que después abre la
# pantalla del sorteador y el administrador
# --------------------------------------------------------------------------- #
def buscar_navegador():
    """Chrome o Edge: abren la página como una ventana propia, sin barra de
    direcciones, y permiten que la pantalla tenga sonido sin hacerle clic."""
    candidatos = []
    for variable in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
        base = os.environ.get(variable)
        if base:
            candidatos += [
                Path(base, "Google", "Chrome", "Application", "chrome.exe"),
                Path(base, "Microsoft", "Edge", "Application", "msedge.exe"),
            ]
    candidatos += [
        Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
    ]
    for ruta in candidatos:
        if ruta.is_file():
            return str(ruta)
    for nombre in ("google-chrome", "chromium", "chromium-browser", "microsoft-edge"):
        ruta = shutil.which(nombre)
        if ruta:
            return ruta
    return None


def esperar_servidor(segundos=20):
    limite = time.monotonic() + segundos
    while time.monotonic() < limite:
        try:
            with closing(socket.create_connection(("127.0.0.1", PUERTO), timeout=0.5)):
                return
        except OSError:
            time.sleep(0.2)


def abrir_pantalla(url):
    """Abre la pantalla del sorteador."""
    esperar_servidor()
    pagina = f"{url}/"
    navegador = buscar_navegador()
    if navegador is None:
        webbrowser.open_new(pagina)
        return

    # Un perfil propio hace que estas opciones se apliquen aunque el navegador
    # ya esté abierto, y que recuerde dónde quedó la ventana. El administrador
    # que se abre al entrar usa el mismo perfil (y la misma sesión).
    perfil = Path(tempfile.gettempdir()) / "sorteador-oniet30"
    opciones = [
        f"--user-data-dir={perfil}",
        "--no-first-run",
        "--no-default-browser-check",
        "--autoplay-policy=no-user-gesture-required",
        "--disable-features=Translate",
    ]
    subprocess.Popen(
        [navegador, *opciones, f"--app={pagina}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


preparar_base()

if __name__ == "__main__":
    # En la computadora se usa http (sin https): la cookie de sesión no puede ser "segura".
    app.config.update(SESSION_COOKIE_SECURE=False)
    url = f"http://127.0.0.1:{PUERTO}"
    # Con debug, Flask ejecuta este archivo dos veces: el proceso que vigila
    # los cambios del código y el servidor (WERKZEUG_RUN_MAIN). La pantalla
    # se abre una sola vez, desde el primero.
    if not os.environ.get("WERKZEUG_RUN_MAIN"):
        print(f"Sorteador (pide usuario y contraseña): {url}/")
        if "--sin-ventanas" not in sys.argv:
            threading.Thread(target=abrir_pantalla, args=(url,), daemon=True).start()
    app.run(debug=True, port=PUERTO, threaded=True)
