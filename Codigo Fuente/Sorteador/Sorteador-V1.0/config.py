"""Configuración del sorteador.

Se lee de variables de entorno. Para no tener que cargarlas una por una en el
hosting, también se pueden escribir en un archivo `.env` en la carpeta del
programa (ver `.env.ejemplo`). Si una variable está en los dos lugares, gana
la variable de entorno.

Sin configurar nada, el sorteador usa un archivo SQLite local con datos de
ejemplo: sirve para probarlo en la computadora.
"""

import os
from pathlib import Path

from sqlalchemy.engine import URL

RAIZ = Path(__file__).resolve().parent


def _cargar_env(ruta):
    """Lee líneas CLAVE=valor (se ignoran las vacías y las que empiezan con #)."""
    if not ruta.is_file():
        return
    for linea in ruta.read_text(encoding="utf-8-sig").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        clave, valor = (parte.strip() for parte in linea.split("=", 1))
        if len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in "\"'":
            valor = valor[1:-1]
        os.environ.setdefault(clave, valor)


_cargar_env(RAIZ / ".env")


def _variable(nombre, defecto=""):
    return os.environ.get(nombre, defecto).strip()


def _url_base_de_datos():
    """URL completa (SORTEADOR_DB_URL), o los datos de MySQL por separado
    (más cómodo en cPanel: la contraseña no hace falta escaparla), o SQLite."""
    url = _variable("SORTEADOR_DB_URL")
    if url:
        return url
    nombre = _variable("SORTEADOR_DB_NOMBRE")
    if nombre:
        puerto = _variable("SORTEADOR_DB_PUERTO")
        return URL.create(
            "mysql+pymysql",
            username=_variable("SORTEADOR_DB_USUARIO") or None,
            password=os.environ.get("SORTEADOR_DB_CLAVE") or None,
            host=_variable("SORTEADOR_DB_HOST", "localhost"),
            port=int(puerto) if puerto else None,
            database=nombre,
            query={"charset": "utf8mb4"},
        )
    return f"sqlite:///{RAIZ / 'sorteador.db'}"


URL_BASE_DE_DATOS = _url_base_de_datos()

# Sin base configurada se usa SQLite local y, si está vacía, se cargan
# participantes y premios de ejemplo.
DEMO = not (_variable("SORTEADOR_DB_URL") or _variable("SORTEADOR_DB_NOMBRE"))

# Contraseña del administrador (la pide la llave de la pantalla y /admin).
# Puede ser el texto de la contraseña o un hash generado con
# `python gestion.py clave`. Si no se configura, vale la predeterminada, que
# acá está guardada como hash para no dejarla escrita en el código.
CLAVE_ADMIN_PREDETERMINADA = (
    "pbkdf2:sha256:1000000$g59PQp9Mr0uWKlOY$8bb9671330c7d9061f6dad0e4124a6e2c22e87b61206a24a4eb7ca4e4377de69"
)
CLAVE_ADMIN = os.environ.get("SORTEADOR_CLAVE_ADMIN") or CLAVE_ADMIN_PREDETERMINADA

# Clave para firmar la sesión del administrador. Si no se define, se genera una
# al azar y se guarda en la base de datos (tabla configuracion).
CLAVE_SECRETA = _variable("SORTEADOR_CLAVE_SECRETA")

# La cookie de sesión solo viaja por https. Poner 0 únicamente si el sitio
# todavía no tiene https (si no, no se puede iniciar sesión).
COOKIE_SEGURA = _variable("SORTEADOR_COOKIE_SEGURA", "1") != "0"

# Para la hora en que salió cada ganador.
ZONA_HORARIA = _variable("SORTEADOR_ZONA_HORARIA", "America/Argentina/Cordoba")
