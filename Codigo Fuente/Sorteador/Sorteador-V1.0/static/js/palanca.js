/**
 * Palanca tipo tragamonedas al costado de la máquina. Solo la mueve la
 * mascota: el sorteo se lanza desde el administrador.
 *
 * El pomo baja en línea recta y el brazo se acorta (escala vertical desde el
 * eje), como si la palanca se inclinara hacia el frente. Las animaciones
 * aceptan la misma duración y curva que el tirón de la mascota para que el
 * pomo acompañe a la mano.
 */
(function () {
  'use strict';

  class Palanca {
    constructor(raiz) {
      this.raiz = raiz;
      this.brazo = raiz.querySelector('.palanca-brazo');
      this.pomo = raiz.querySelector('.palanca-pomo');
      this.animaciones = [];
    }

    /** Pequeño apretón del pomo cuando la mascota lo agarra. */
    agarrar() {
      this.pomo.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(0.9, 0.84)' }, { transform: 'scale(1)' }],
        { duration: 220, easing: 'ease-out' },
      );
    }

    /** Baja el pomo `caida` px. Resuelve cuando llega abajo. */
    bajar(caida, duracion, easing) {
      const largo = this.brazo.offsetHeight;
      const escala = Math.max(0.05, (largo - caida) / largo);
      return Promise.all([
        this._animar(this.pomo, [{ transform: `translateY(${caida}px)` }], duracion, easing),
        this._animar(this.brazo, [{ transform: `scaleY(${escala})` }], duracion, easing),
      ]);
    }

    /** La suelta: vuelve arriba como un resorte, pasándose un poco. */
    async soltar() {
      const largo = this.brazo.offsetHeight;
      const tramos = [
        { desplazamiento: -0.12, offset: 0.35, easing: 'cubic-bezier(.3,0,.6,1)' },
        { desplazamiento: 0.05, offset: 0.65, easing: 'ease-in-out' },
        { desplazamiento: -0.015, offset: 0.85, easing: 'ease-in-out' },
        { desplazamiento: 0 },
      ];
      const pomo = tramos.map(({ desplazamiento, offset, easing }) => ({
        transform: `translateY(${desplazamiento * largo}px)`,
        offset,
        easing,
      }));
      const brazo = tramos.map(({ desplazamiento, offset, easing }) => ({
        transform: `scaleY(${1 - desplazamiento})`,
        offset,
        easing,
      }));
      await Promise.all([this._animar(this.pomo, pomo, 700), this._animar(this.brazo, brazo, 700)]);
      this._limpiar();
    }

    _animar(elemento, cuadros, duracion, easing = 'linear') {
      const anim = elemento.animate(cuadros, { duration: duracion, easing, fill: 'forwards' });
      this.animaciones.push(anim);
      return anim.finished.catch(() => {});
    }

    /** Quita las animaciones terminadas (la palanca ya está en reposo). */
    _limpiar() {
      for (const anim of this.animaciones) anim.cancel();
      this.animaciones = [];
    }
  }

  window.Palanca = Palanca;
})();
