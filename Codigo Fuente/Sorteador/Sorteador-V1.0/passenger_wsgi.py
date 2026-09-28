"""Punto de entrada para el hosting (cPanel, "Setup Python App").

En cPanel se configura:
- Application startup file: passenger_wsgi.py
- Application Entry point: application

La configuración (base de datos, contraseña del administrador) se lee del
archivo .env de esta carpeta o de las variables de entorno de la aplicación.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import app as application  # noqa: E402
