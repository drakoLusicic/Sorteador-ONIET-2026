"""Tareas de mantenimiento del sorteador, desde la línea de comandos.

    python gestion.py iniciar                 Crea las tablas que falten y prueba la conexión.
    python gestion.py demo                    Carga estudiantes y premios de ejemplo (si están vacíos).
    python gestion.py clave                   Genera el hash de una contraseña para SORTEADOR_CLAVE_ADMIN.
    python gestion.py reset                   Borra la base SQLite local (solo para pruebas).

En el hosting se ejecuta desde la terminal de cPanel, con el entorno virtual
de la aplicación activado (cPanel muestra el comando para activarlo arriba
de la configuración de la aplicación).
"""

import getpass
import sys
from pathlib import Path

from sqlalchemy.engine import make_url

import config
import database as bd


def iniciar():
    bd.init_db()
    url = make_url(config.URL_BASE_DE_DATOS)
    print(f"Tablas listas en {url.render_as_string(hide_password=True)}")


def demo():
    bd.init_db()
    cargados = bd.cargar_demo()
    print(f"Cargados {cargados['estudiantes']} estudiantes y {cargados['premios']} premios de ejemplo.")


def clave():
    from werkzeug.security import generate_password_hash

    primera = getpass.getpass("Contraseña nueva para el administrador: ")
    if len(primera) < 8:
        sys.exit("Usá al menos 8 caracteres.")
    if getpass.getpass("Repetila: ") != primera:
        sys.exit("No coinciden.")
    print("\nCopiá esta línea en el archivo .env:\n")
    print(f"SORTEADOR_CLAVE_ADMIN={generate_password_hash(primera)}")


def reset():
    url = make_url(config.URL_BASE_DE_DATOS)
    if url.get_backend_name() != "sqlite":
        sys.exit("reset solo borra la base SQLite local, no la del hosting.")
    Path(url.database).unlink(missing_ok=True)
    bd.init_db()
    print(f"Base local reiniciada: {url.database}")


def main(argumentos):
    if not argumentos:
        sys.exit(__doc__)
    comando = argumentos[0]
    if comando == "iniciar":
        iniciar()
    elif comando == "demo":
        demo()
    elif comando == "clave":
        clave()
    elif comando == "reset":
        reset()
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
