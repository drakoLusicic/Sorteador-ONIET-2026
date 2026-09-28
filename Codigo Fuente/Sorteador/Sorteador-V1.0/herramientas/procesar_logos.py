"""Prepara los logos para la pantalla del sorteador.

- `recursos/logo_oniet30.jpg`: letras blancas y un "30" de colores sobre un
  gris muy claro (247). Se separa el blanco por brillo y el "30" por
  saturación, y se guarda como PNG transparente para ponerlo sobre el fondo
  oscuro. El halo gris oscuro que dejó la compresión alrededor de las letras
  queda afuera porque no es ni blanco ni de color.
- `recursos/logo_ubp.jpg`: logo blanco sobre negro. Se usa el brillo como
  transparencia; la caja negra del afiche la dibuja el CSS.

Uso (requiere Pillow, numpy y scipy):
    pip install pillow numpy scipy
    python herramientas/procesar_logos.py
"""

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

RAIZ = Path(__file__).resolve().parent.parent
RECURSOS = RAIZ / "recursos"
DESTINO = RAIZ / "static" / "img" / "logos"

MARGEN = 4          # margen transparente alrededor de cada logo
ANCHO_UBP = 600     # px: se muestra a ~170 px, así queda nítido en pantallas densas
AREA_MINIMA = 6     # px: manchas sueltas de la compresión que se descartan


def recortar(rgba):
    """Recorta al contenido visible dejando MARGEN px alrededor."""
    ys, xs = np.nonzero(rgba[..., 3] > 8)
    y0, y1 = max(0, ys.min() - MARGEN), min(rgba.shape[0], ys.max() + 1 + MARGEN)
    x0, x1 = max(0, xs.min() - MARGEN), min(rgba.shape[1], xs.max() + 1 + MARGEN)
    return rgba[y0:y1, x0:x1]


def sin_manchas(alfa):
    """Quita los puntitos aislados que deja el ruido del JPG."""
    zonas, cantidad = ndimage.label(alfa > 0.1)
    areas = ndimage.sum(np.ones_like(alfa), zonas, range(1, cantidad + 1))
    chicas = np.isin(zonas, np.nonzero(areas < AREA_MINIMA)[0] + 1)
    return np.where(chicas, 0, alfa)


def logo_oniet():
    rgb = np.asarray(Image.open(RECURSOS / "logo_oniet30.jpg").convert("RGB")).astype(np.float32)
    fondo = float(np.median(rgb[:6].reshape(-1, 3)))  # gris del fondo (247)

    # Blanco: cuánto más claro que el fondo es el canal más oscuro. El halo
    # se lleva primero al gris del fondo; si no, al suavizar apaga los trazos
    # finos del subtítulo (miden 1 o 2 px).
    brillo = ndimage.gaussian_filter(np.maximum(rgb.min(axis=2), fondo), 0.35)
    alfa_blanco = np.clip((brillo - (fondo + 0.8)) / 4.2, 0, 1)

    # Color ("30"): saturación. Los bordes mezclados con el fondo quedan
    # semitransparentes y se les quita el gris para no dejar un aura clara.
    saturacion = rgb.max(axis=2) - rgb.min(axis=2)
    alfa_color = np.clip((saturacion - 16) / 70, 0, 1)
    divisor = np.maximum(alfa_color, 1e-3)[..., None]
    color = np.clip(fondo + (rgb - fondo) / divisor, 0, 255)

    es_color = alfa_color >= alfa_blanco
    alfa = sin_manchas(np.where(es_color, alfa_color, alfa_blanco))
    salida = np.where(es_color[..., None], color, 255.0)

    rgba = np.dstack([salida, alfa * 255]).round().astype(np.uint8)
    return Image.fromarray(recortar(rgba), "RGBA")


def logo_ubp():
    gris = np.asarray(Image.open(RECURSOS / "logo_ubp.jpg").convert("L")).astype(np.float32)
    alfa = sin_manchas(np.clip((gris - 14) / (235 - 14), 0, 1))
    rgba = np.dstack([np.full((*gris.shape, 3), 255.0), alfa * 255]).round().astype(np.uint8)
    imagen = Image.fromarray(recortar(rgba), "RGBA")
    alto = round(imagen.height * ANCHO_UBP / imagen.width)
    return imagen.resize((ANCHO_UBP, alto), Image.LANCZOS)


def main():
    DESTINO.mkdir(parents=True, exist_ok=True)
    for nombre, generar in (("oniet30.png", logo_oniet), ("ubp.png", logo_ubp)):
        imagen = generar()
        imagen.save(DESTINO / nombre, optimize=True)
        print(f"{nombre}  {imagen.width}x{imagen.height}  (proporción {imagen.width / imagen.height:.4f})")


if __name__ == "__main__":
    main()
