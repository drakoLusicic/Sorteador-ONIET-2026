"""Tareas de mantenimiento del sorteador, desde la línea de comandos.

    python gestion.py iniciar                 Crea las tablas que falten y prueba la conexión.
    python gestion.py demo                    Carga estudiantes, premios y el administrador de ejemplo
                                              (en las tablas que estén vacías).
    python gestion.py admin USUARIO           Crea un administrador en la base o le cambia la contraseña.
    python gestion.py clave [USUARIO]         Muestra el hash de una contraseña y el SQL para cargarlo en
                                              phpMyAdmin (si en el hosting no hay terminal).
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
    print(
        f"Cargados {cargados['estudiantes']} estudiantes, {cargados['premios']} premios y "
        f"{cargados['administradores']} administrador de ejemplo."
    )


def _usuario_valido(usuario):
    usuario = usuario.strip()
    if not usuario or len(usuario) > 50:
        sys.exit("El usuario tiene que tener entre 1 y 50 caracteres.")
    return usuario


def _hash_de_clave_nueva():
    """Pide la contraseña dos veces y devuelve su hash (PBKDF2-SHA256 con sal)."""
    from werkzeug.security import generate_password_hash

    primera = getpass.getpass("Contraseña nueva para el administrador: ")
    if len(primera) < 8:
        sys.exit("Usá al menos 8 caracteres.")
    if getpass.getpass("Repetila: ") != primera:
        sys.exit("No coinciden.")
    return generate_password_hash(primera, method="pbkdf2:sha256")


def admin(usuario):
    usuario = _usuario_valido(usuario)
    clave_hash = _hash_de_clave_nueva()
    bd.init_db()
    with bd.transaccion() as con:
        existia = bd.buscar_admin(con, usuario) is not None
        bd.guardar_admin(con, usuario, clave_hash)
    print(f"Contraseña de {usuario} cambiada." if existia else f"Administrador {usuario} creado.")


def clave(usuario):
    usuario = _usuario_valido(usuario).replace("'", "''")
    clave_hash = _hash_de_clave_nueva()
    print("\nHash de la contraseña:\n")
    print(clave_hash)
    print("\nPara cargarlo en phpMyAdmin (pestaña SQL, sobre la base del sorteo):\n")
    print(
        f"INSERT INTO administradores (usuario, clave_hash) VALUES ('{usuario}', '{clave_hash}')\n"
        "ON DUPLICATE KEY UPDATE clave_hash = VALUES(clave_hash);"
    )


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
    comando, resto = argumentos[0], argumentos[1:]
    if comando == "iniciar":
        iniciar()
    elif comando == "demo":
        demo()
    elif comando == "admin" and resto:
        admin(resto[0])
    elif comando == "clave":
        clave(resto[0] if resto else "ONIET3030")
    elif comando == "reset":
        reset()
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
