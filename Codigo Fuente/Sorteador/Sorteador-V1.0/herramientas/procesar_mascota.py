"""Recorta las poses de la mascota desde la hoja de poses.

Toma `recursos/mascota_poses.jpg` (varias poses del águila sobre un damero
gris y blanco "pintado", junto con capturas del listado) y genera un PNG
transparente por pose en `static/img/mascota/`. Todas las poses se guardan
con el mismo tamaño y alineadas por el centro de la remera y por los pies,
para poder intercambiarlas en la animación sin que el muñeco salte.

Uso (requiere Pillow, numpy y scipy):
    pip install pillow numpy scipy
    python herramientas/procesar_mascota.py
"""

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

RAIZ = Path(__file__).resolve().parent.parent
ORIGEN = RAIZ / "recursos" / "mascota_poses.jpg"
DESTINO = RAIZ / "static" / "img" / "mascota"

# Qué pose es cada figura, según la posición (x, y) aproximada de su centro
# en la hoja original (2170x1984). Las figuras que no están acá se ignoran.
POSES = {
    "senala": (760, 380),    # fila 1: señalando
    "mira": (1390, 380),     # fila 1: mirando al público
    "cruzado": (1960, 380),  # fila 1: brazos cruzados
    "alcanza": (760, 1600),  # fila 3: ala levantada (agarra la palanca)
    "jarras": (1900, 1600),  # fila 3: manos en la cintura
}

AREA_MINIMA = 40_000  # px: descarta textos y restos de las capturas
MARGEN = 8            # margen transparente alrededor de cada pose


def parece_fondo(rgb):
    """Gris claro o blanco sin color: el damero y los paneles blancos."""
    saturacion = rgb.max(axis=2) - rgb.min(axis=2)
    return (saturacion <= 24) & (rgb.min(axis=2) >= 160)


def mascara_figura(rgb, etiquetas, numero):
    """Máscara de una figura, con los huecos cerrados del damero ya vaciados.

    Entre las piernas o entre brazo y cuerpo puede quedar damero encerrado.
    Se reconoce porque es grande y mezcla gris con blanco; los blancos de los
    ojos son chicos y se conservan.
    """
    figura = etiquetas == numero
    valor = rgb.min(axis=2)
    zonas, cantidad = ndimage.label(figura & parece_fondo(rgb))
    for z in range(1, cantidad + 1):
        region = zonas == z
        area = region.sum()
        gris = (valor[region] <= 228).mean()
        blanco = (valor[region] >= 244).mean()
        if area >= 800 and gris >= 0.2 and blanco >= 0.2:
            figura &= ~region
    return figura


def ancho_anteojos(rgb, figura):
    """Ancho del marco de los anteojos (azul oscuro): sirve de escala común."""
    r, b = rgb[..., 0], rgb[..., 2]
    marco = figura & (b > r + 8) & (rgb.max(axis=2) < 120)
    xs = np.where(marco)[1]
    return np.percentile(xs, 98) - np.percentile(xs, 2)


def alfa_suave(figura):
    """Recorta 1 px del borde (mezclado con el fondo) y suaviza el contorno."""
    nucleo = ndimage.binary_erosion(figura, iterations=1)
    return np.clip(ndimage.gaussian_filter(nucleo.astype(np.float32), 0.7) * 1.15, 0, 1)


def main():
    rgb = np.array(Image.open(ORIGEN).convert("RGB")).astype(np.int16)

    # Fondo = zonas "de fondo" conectadas con el borde de la imagen.
    zonas, _ = ndimage.label(parece_fondo(rgb))
    borde = np.unique(np.concatenate([zonas[0], zonas[-1], zonas[:, 0], zonas[:, -1]]))
    fondo = np.isin(zonas, borde[borde > 0])

    etiquetas, cantidad = ndimage.label(~fondo, structure=np.ones((3, 3)))
    areas = ndimage.sum(np.ones_like(etiquetas), etiquetas, range(1, cantidad + 1))
    centros = ndimage.center_of_mass(np.ones_like(etiquetas), etiquetas, range(1, cantidad + 1))
    grandes = [i + 1 for i, a in enumerate(areas) if a >= AREA_MINIMA]

    rojo = (rgb[..., 0] > 170) & (rgb[..., 1] < 90) & (rgb[..., 2] < 90)
    figuras = {}
    for nombre, (px, py) in POSES.items():
        numero = min(grandes, key=lambda n: (centros[n - 1][1] - px) ** 2 + (centros[n - 1][0] - py) ** 2)
        figuras[nombre] = mascara_figura(rgb, etiquetas, numero)

    # Algunas poses están dibujadas más grandes que otras en la hoja: se
    # igualan usando el ancho de los anteojos como referencia.
    anteojos = {n: ancho_anteojos(rgb, f) for n, f in figuras.items()}
    referencia = float(np.median(list(anteojos.values())))

    piezas = {}
    for nombre, figura in figuras.items():
        ys, xs = np.where(figura)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        rx = np.where(rojo[y0:y1, x0:x1] & figura[y0:y1, x0:x1])[1]
        alfa = alfa_suave(figura[y0:y1, x0:x1]) * 255
        imagen = Image.fromarray(np.dstack([rgb[y0:y1, x0:x1], alfa]).round().astype(np.uint8))

        escala = referencia / anteojos[nombre]
        imagen = imagen.resize(
            (round(imagen.width * escala), round(imagen.height * escala)), Image.LANCZOS
        )
        # centro de la remera = eje del cuerpo
        piezas[nombre] = {"imagen": imagen, "centro": rx.mean() * escala}

    izquierda = max(p["centro"] for p in piezas.values()) + MARGEN
    derecha = max(p["imagen"].width - p["centro"] for p in piezas.values()) + MARGEN
    ancho = int(np.ceil(izquierda + derecha))
    alto = max(p["imagen"].height for p in piezas.values()) + MARGEN * 2

    DESTINO.mkdir(parents=True, exist_ok=True)
    for nombre, p in piezas.items():
        lienzo = Image.new("RGBA", (ancho, alto), (0, 0, 0, 0))
        dx = int(round(izquierda - p["centro"]))
        dy = alto - MARGEN - p["imagen"].height  # pies apoyados abajo
        lienzo.paste(p["imagen"], (dx, dy))
        lienzo.save(DESTINO / f"{nombre}.png", optimize=True)
        print(f"{nombre}.png  {ancho}x{alto}  (escala {referencia / anteojos[nombre]:.3f})")

    # Estos valores son los que usan .mascota en styles.css y app.js.
    print(f"Proporción ancho/alto: {ancho / alto:.4f}")
    print(f"Eje del cuerpo: {izquierda / ancho:.2%} desde la izquierda")


if __name__ == "__main__":
    main()
