"""Base de datos del sorteador.

Funciona con SQLite (archivo local, para probar en la computadora) y con
MySQL/MariaDB (la del hosting). La conexión se configura en config.py.

Tablas del evento (en el hosting se crean importando el script de la base
en phpMyAdmin; en la computadora, las crea el sorteador):
- estudiantes: participan los que tienen inscripto = 1 (los marca el
  formulario de inscripción). El sorteador solo los lee.
- premios: cada premio se sortea una sola vez.
- ganadores: quién ganó qué y cuándo. Nadie puede ganar dos veces y ningún
  premio se entrega dos veces.
- administradores: usuarios que entran al administrador, con el hash de su
  contraseña (en el hosting se crea con administradores.sql).

Tablas propias del sorteador (las crea solo, también en el hosting):
- configuracion: clave/valor (premio elegido, orden del listado y la clave
  que firma la sesión del administrador).
- sorteo: una sola fila con el estado del sorteo en curso. Está en la base
  (y no en memoria) porque en el hosting el programa corre en varios
  procesos a la vez, y todos tienen que ver el mismo estado.
- pantallas: pantallas del sorteador abiertas (cada una avisa cada pocos
  segundos que sigue ahí).
"""

import os
import secrets
from contextlib import contextmanager
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    SmallInteger,
    String,
    Table,
    Text,
    UniqueConstraint,
    and_,
    create_engine,
    delete,
    event,
    func,
    insert,
    inspect,
    select,
    text,
    update,
)
from sqlalchemy.dialects import mysql
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError

import config

metadata = MetaData()
_MYSQL = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"}
_MYSQL_EVENTO = {**_MYSQL, "mysql_collate": "utf8mb4_unicode_ci"}

# Tipos iguales a los del script de la base (INT UNSIGNED y TINYINT(1) en MySQL).
_ID = Integer().with_variant(mysql.INTEGER(unsigned=True), "mysql", "mariadb")
_BANDERA = SmallInteger().with_variant(mysql.TINYINT(1), "mysql", "mariadb")

estudiantes = Table(
    "estudiantes",
    metadata,
    Column("id", _ID, primary_key=True, autoincrement=True),
    Column("legajo", String(20), nullable=False),
    Column("dni", String(15), nullable=False),
    Column("nombre", String(100), nullable=False),
    Column("apellido", String(100), nullable=False),
    Column("email", String(150)),
    Column("inscripto", _BANDERA, nullable=False, server_default=text("0")),
    Column("fecha_inscripcion", DateTime),
    UniqueConstraint("legajo", name="uq_estudiantes_legajo"),
    UniqueConstraint("dni", name="uq_estudiantes_dni"),
    Index("idx_estudiantes_inscripto", "inscripto"),
    **_MYSQL_EVENTO,
)

premios = Table(
    "premios",
    metadata,
    Column("id", _ID, primary_key=True, autoincrement=True),
    Column("nombre", String(150), nullable=False),
    **_MYSQL_EVENTO,
)

ganadores = Table(
    "ganadores",
    metadata,
    Column("id", _ID, primary_key=True, autoincrement=True),
    Column(
        "id_estudiante",
        _ID,
        ForeignKey("estudiantes.id", name="fk_ganadores_estudiante", ondelete="RESTRICT", onupdate="CASCADE"),
        nullable=False,
    ),
    Column(
        "id_premio",
        _ID,
        ForeignKey("premios.id", name="fk_ganadores_premio", ondelete="RESTRICT", onupdate="CASCADE"),
        nullable=False,
    ),
    Column("fecha", DateTime, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
    UniqueConstraint("id_estudiante", name="uq_ganadores_estudiante"),
    UniqueConstraint("id_premio", name="uq_ganadores_premio"),
    **_MYSQL_EVENTO,
)

administradores = Table(
    "administradores",
    metadata,
    Column("id", _ID, primary_key=True, autoincrement=True),
    # utf8mb4_bin: el usuario distingue mayúsculas y minúsculas, igual que en SQLite.
    Column(
        "usuario",
        String(50).with_variant(mysql.VARCHAR(50, charset="utf8mb4", collation="utf8mb4_bin"), "mysql", "mariadb"),
        nullable=False,
    ),
    Column("clave_hash", String(255), nullable=False),  # nunca la contraseña: solo su hash
    UniqueConstraint("usuario", name="uq_administradores_usuario"),
    **_MYSQL_EVENTO,
)

# Quienes participan del sorteo: los estudiantes inscriptos.
INSCRIPTO = estudiantes.c.inscripto == 1
# Inscriptos que todavía no ganaron: entre ellos se sortea.
EN_JUEGO = and_(INSCRIPTO, estudiantes.c.id.not_in(select(ganadores.c.id_estudiante)))
# Premios que todavía no se entregaron.
SIN_ENTREGAR = premios.c.id.not_in(select(ganadores.c.id_premio))

configuracion = Table(
    "configuracion",
    metadata,
    Column("clave", String(50), primary_key=True),
    Column("valor", String(255), nullable=False),
    **_MYSQL,
)

sorteo = Table(
    "sorteo",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=False),
    # "listo" (se puede sortear), "sorteando" (la pantalla anima el sorteo) o
    # "ganador" (la pantalla muestra al ganador hasta que el administrador
    # toca Continuar).
    Column("estado", String(20), nullable=False),
    Column("numero", Integer, nullable=False),  # cuántos sorteos se hicieron
    Column("ultimo", Text),  # JSON con el último ganador y su premio
    Column("version", Integer, nullable=False),  # sube con cada cambio
    Column("version_participantes", Integer, nullable=False),  # sube al cambiar el listado
    **_MYSQL,
)

pantallas = Table(
    "pantallas",
    metadata,
    Column("cliente", String(40), primary_key=True),
    Column("visto", DateTime, nullable=False),  # UTC
    **_MYSQL,
)

# Datos de ejemplo (nombre, apellido): se cargan solos en la base SQLite local,
# o con `python gestion.py demo`. Uno de cada cinco queda sin inscribir.
ESTUDIANTES_DEMO = [
    ("Martina", "González"), ("Tomás", "Rodríguez"), ("Valentina", "Fernández"),
    ("Joaquín", "López"), ("Camila", "Martínez"), ("Santiago", "Ávila"),
    ("Lucía", "Pérez"), ("Mateo", "Gómez"), ("Sofía", "Díaz"),
    ("Benjamín", "Sánchez"), ("Julieta", "Romero"), ("Thiago", "Sosa"),
    ("Agustina", "Álvarez"), ("Facundo", "Torres"), ("Milagros", "Ruiz"),
    ("Lautaro", "Ramírez"), ("Catalina", "Flores"), ("Franco", "Acosta"),
    ("Abril", "Benítez"), ("Nicolás", "Medina"), ("Florencia", "Herrera"),
    ("Ignacio", "Suárez"), ("Delfina", "Aguirre"), ("Bautista", "Giménez"),
    ("Paula", "Molina"), ("Emiliano", "Castro"), ("Renata", "Ortiz"),
    ("Gonzalo", "Núñez"), ("Micaela", "Luna"), ("Federico", "Juárez"),
    ("Antonella", "Cabrera"), ("Maximiliano", "Ríos"), ("Victoria", "Morales"),
    ("Ezequiel", "Ferreyra"), ("Guadalupe", "Godoy"), ("Lisandro", "Villalba"),
    ("Josefina", "Correa"), ("Bruno", "Figueroa"), ("Pilar", "Vera"),
    ("Dante", "Quiroga"),
]

PREMIOS_DEMO = ["Notebook", "Tablet", "Auriculares inalámbricos", "Parlante Bluetooth", "Mochila ONIET 30"]

# El mismo administrador que carga administradores.sql en el hosting (de la
# contraseña, solo el hash).
ADMIN_DEMO = {
    "usuario": "ONIET3030",
    "clave_hash": "pbkdf2:sha256:1000000$pACkAwTjPZrgBQ6H$e38e45968dbeb9eac76b219d0fe8218b6bb212b4fb4afad19e6dc04159bda36b",
}


# --------------------------------------------------------------------------- #
# Conexión
# --------------------------------------------------------------------------- #
_motor = None
_motor_pid = None


def motor():
    """El motor de conexiones de este proceso. En el hosting, Passenger puede
    crear procesos nuevos copiando uno existente: cada proceso abre sus
    propias conexiones."""
    global _motor, _motor_pid
    if _motor is None or _motor_pid != os.getpid():
        _motor = _crear_motor()
        _motor_pid = os.getpid()
    return _motor


def _crear_motor():
    url = make_url(config.URL_BASE_DE_DATOS)
    if url.get_backend_name() == "sqlite":
        nuevo = create_engine(url, connect_args={"check_same_thread": False, "timeout": 15})

        @event.listens_for(nuevo, "connect")
        def _activar_claves_foraneas(conexion_dbapi, _registro):
            cursor = conexion_dbapi.cursor()
            cursor.execute("PRAGMA foreign_keys = ON")
            cursor.close()

        return nuevo
    # MySQL/MariaDB en un hosting compartido cierra las conexiones inactivas:
    # se renuevan antes de que pase eso y se prueban antes de usarlas.
    return create_engine(url, pool_pre_ping=True, pool_recycle=280, pool_size=5, max_overflow=5)


def motor_nombre():
    return motor().dialect.name


@contextmanager
def conexion():
    """Conexión para leer."""
    with motor().connect() as con:
        yield con


@contextmanager
def transaccion():
    """Conexión para escribir: se confirma al terminar, o se deshace si hubo un error."""
    with motor().begin() as con:
        yield con


def ahora_local():
    """Fecha y hora local (sin zona), para registrar a los ganadores."""
    return datetime.now(ZoneInfo(config.ZONA_HORARIA)).replace(tzinfo=None, microsecond=0)


def ahora_utc():
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


# --------------------------------------------------------------------------- #
# Configuración (clave/valor)
# --------------------------------------------------------------------------- #
def leer_config(con, clave, defecto=None):
    valor = con.execute(select(configuracion.c.valor).where(configuracion.c.clave == clave)).scalar()
    return defecto if valor is None else valor


def guardar_config(con, clave, valor):
    actualizadas = con.execute(
        update(configuracion).where(configuracion.c.clave == clave).values(valor=str(valor))
    ).rowcount
    if not actualizadas:
        con.execute(insert(configuracion).values(clave=clave, valor=str(valor)))


def clave_secreta():
    """Clave para firmar la sesión del administrador cuando no se configuró
    SORTEADOR_CLAVE_SECRETA. Se genera al azar la primera vez y queda en la
    base, así es la misma en todos los procesos del hosting."""
    _insertar_si_falta(
        configuracion,
        {"clave": "clave_secreta", "valor": secrets.token_hex(32)},
        configuracion.c.clave == "clave_secreta",
    )
    with conexion() as con:
        return leer_config(con, "clave_secreta")


# --------------------------------------------------------------------------- #
# Administradores
# --------------------------------------------------------------------------- #
def buscar_admin(con, usuario):
    return con.execute(select(administradores).where(administradores.c.usuario == usuario)).mappings().first()


def guardar_admin(con, usuario, clave_hash):
    """Crea el administrador o, si ya existe, le cambia la contraseña."""
    actualizados = con.execute(
        update(administradores).where(administradores.c.usuario == usuario).values(clave_hash=clave_hash)
    ).rowcount
    if not actualizados:
        con.execute(insert(administradores).values(usuario=usuario, clave_hash=clave_hash))


# --------------------------------------------------------------------------- #
# Creación de las tablas
# --------------------------------------------------------------------------- #
def init_db():
    """Crea las tablas que falten y la fila del estado del sorteo. Se puede
    llamar muchas veces (y desde varios procesos a la vez)."""
    metadata.create_all(motor())
    _revisar_tablas()
    _insertar_si_falta(
        sorteo,
        {"id": 1, "estado": "listo", "numero": 0, "ultimo": None, "version": 0, "version_participantes": 0},
        sorteo.c.id == 1,
    )
    _insertar_si_falta(configuracion, {"clave": "orden", "valor": "apellido"}, configuracion.c.clave == "orden")
    if config.DEMO:
        cargar_demo()


def _insertar_si_falta(tabla, valores, condicion):
    try:
        with transaccion() as con:
            if con.execute(select(func.count()).select_from(tabla).where(condicion)).scalar_one() == 0:
                con.execute(insert(tabla).values(**valores))
    except IntegrityError:
        pass  # otro proceso la insertó al mismo tiempo


def _revisar_tablas():
    """La tabla ganadores de la versión anterior del sorteador (con
    participante_id) tiene otras columnas: create_all no la cambia, así que se
    avisa en vez de fallar más adelante en cada consulta."""
    columnas = {c["name"] for c in inspect(motor()).get_columns("ganadores")}
    if "id_estudiante" not in columnas:
        raise RuntimeError(
            "La tabla ganadores es de la versión anterior del sorteador. En el hosting, importá el "
            "script de la base (crea estudiantes, premios y ganadores); en la computadora, "
            "ejecutá `python gestion.py reset`."
        )


def cargar_demo():
    """Carga estudiantes, premios y el administrador de ejemplo en las tablas
    que estén vacías. Devuelve cuántos de cada uno cargó."""
    cargados = {"estudiantes": 0, "premios": 0, "administradores": 0}
    with transaccion() as con:
        if con.execute(select(func.count()).select_from(estudiantes)).scalar_one() == 0:
            ahora = ahora_local()
            filas = []
            for i, (nombre, apellido) in enumerate(ESTUDIANTES_DEMO):
                inscripto = 0 if i % 5 == 4 else 1
                filas.append({
                    "legajo": str(10001 + i),
                    "dni": str(45000001 + i),
                    "nombre": nombre,
                    "apellido": apellido,
                    "inscripto": inscripto,
                    "fecha_inscripcion": ahora if inscripto else None,
                })
            con.execute(insert(estudiantes), filas)
            cargados["estudiantes"] = len(filas)
        if con.execute(select(func.count()).select_from(premios)).scalar_one() == 0:
            con.execute(insert(premios), [{"nombre": p} for p in PREMIOS_DEMO])
            cargados["premios"] = len(PREMIOS_DEMO)
        if con.execute(select(func.count()).select_from(administradores)).scalar_one() == 0:
            con.execute(insert(administradores).values(**ADMIN_DEMO))
            cargados["administradores"] = 1
    return cargados


def borrar_pantallas_viejas(con, limite):
    con.execute(delete(pantallas).where(pantallas.c.visto < limite))
