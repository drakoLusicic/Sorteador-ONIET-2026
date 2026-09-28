"""Base de datos del sorteador.

Funciona con SQLite (archivo local, para probar en la computadora) y con
MySQL/MariaDB (la del hosting). La conexión se configura en config.py.

Tablas:
- participantes: quienes entran en el sorteo.
- premios: los premios que se pueden sortear.
- ganadores: quién ganó qué y cuándo (nadie puede ganar dos veces).
- configuracion: clave/valor (premio elegido y orden del listado).
- sorteo: una sola fila con el estado del sorteo en curso. Está en la base
  (y no en memoria) porque en el hosting el programa corre en varios
  procesos a la vez, y todos tienen que ver el mismo estado.
- pantallas: pantallas del sorteador abiertas (cada una avisa cada pocos
  segundos que sigue ahí).
"""

import os
from contextlib import contextmanager
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Table,
    Text,
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
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError

import config

metadata = MetaData()
_MYSQL = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"}

participantes = Table(
    "participantes",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("nombre", String(100), nullable=False),
    Column("apellido", String(100), nullable=False),
    **_MYSQL,
)

premios = Table(
    "premios",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("nombre", String(80), nullable=False),
    **_MYSQL,
)

ganadores = Table(
    "ganadores",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column(
        "participante_id",
        Integer,
        ForeignKey("participantes.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    ),
    Column("premio", String(80), nullable=False),  # el nombre queda aunque se borre el premio
    Column("premio_id", Integer, ForeignKey("premios.id", ondelete="SET NULL")),
    Column("fecha", DateTime, nullable=False),
    **_MYSQL,
)

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
# o con `python gestion.py demo`.
PARTICIPANTES_DEMO = [
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


# --------------------------------------------------------------------------- #
# Creación de las tablas
# --------------------------------------------------------------------------- #
def init_db():
    """Crea las tablas que falten y la fila del estado del sorteo. Se puede
    llamar muchas veces (y desde varios procesos a la vez)."""
    metadata.create_all(motor())
    _migrar()
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


def _migrar():
    """Adapta una base SQLite creada con una versión anterior del sorteador."""
    columnas = {c["name"] for c in inspect(motor()).get_columns("ganadores")}
    if "premio_id" not in columnas:
        with transaccion() as con:
            con.execute(text("ALTER TABLE ganadores ADD COLUMN premio_id INTEGER REFERENCES premios(id)"))
    with transaccion() as con:
        con.execute(delete(configuracion).where(configuracion.c.clave == "premio"))


def cargar_demo():
    """Carga participantes y premios de ejemplo en las tablas que estén vacías.
    Devuelve cuántos de cada uno cargó."""
    cargados = {"participantes": 0, "premios": 0}
    with transaccion() as con:
        if con.execute(select(func.count()).select_from(participantes)).scalar_one() == 0:
            con.execute(insert(participantes), [{"nombre": n, "apellido": a} for n, a in PARTICIPANTES_DEMO])
            cargados["participantes"] = len(PARTICIPANTES_DEMO)
        if con.execute(select(func.count()).select_from(premios)).scalar_one() == 0:
            con.execute(insert(premios), [{"nombre": p} for p in PREMIOS_DEMO])
            cargados["premios"] = len(PREMIOS_DEMO)
    return cargados


# --------------------------------------------------------------------------- #
# Carga de participantes
# --------------------------------------------------------------------------- #
def importar_participantes(con, filas, reemplazar=False):
    """Carga participantes (dicts con nombre, apellido y, opcionalmente, id).

    - reemplazar=True: borra todos los participantes (y los ganadores) antes.
    - reemplazar=False: agrega los nuevos; si un id ya existe, le actualiza el
      nombre y el apellido (así se puede corregir un dato volviendo a importar).
    """
    if reemplazar:
        con.execute(delete(ganadores))
        con.execute(delete(participantes))
        existentes = set()
    else:
        existentes = set(con.execute(select(participantes.c.id)).scalars())

    con_id = [f for f in filas if f.get("id") is not None and f["id"] not in existentes]
    sin_id = [f for f in filas if f.get("id") is None]
    a_actualizar = [f for f in filas if f.get("id") is not None and f["id"] in existentes]

    # Primero los que traen id, así los autonuméricos siguen después del mayor.
    if con_id:
        con.execute(insert(participantes), [{"id": f["id"], "nombre": f["nombre"], "apellido": f["apellido"]} for f in con_id])
    if sin_id:
        con.execute(insert(participantes), [{"nombre": f["nombre"], "apellido": f["apellido"]} for f in sin_id])
    for f in a_actualizar:
        con.execute(
            update(participantes)
            .where(participantes.c.id == f["id"])
            .values(nombre=f["nombre"], apellido=f["apellido"])
        )

    if con_id and con.dialect.name == "postgresql":
        # En PostgreSQL insertar ids a mano no mueve el contador automático.
        con.execute(
            text("SELECT setval(pg_get_serial_sequence('participantes', 'id'), (SELECT MAX(id) FROM participantes))")
        )

    total = con.execute(select(func.count()).select_from(participantes)).scalar_one()
    return {"agregados": len(con_id) + len(sin_id), "actualizados": len(a_actualizar), "total": total}


def borrar_pantallas_viejas(con, limite):
    con.execute(delete(pantallas).where(pantallas.c.visto < limite))
