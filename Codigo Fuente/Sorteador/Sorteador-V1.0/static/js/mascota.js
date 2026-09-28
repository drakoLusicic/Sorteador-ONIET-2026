/**
 * Mascota animada (el águila de ONIET 30) que tira de la palanca.
 *
 * Usa cinco poses recortadas de la ilustración y las combina con movimientos
 * del cuerpo (Web Animations API): agacharse, estirarse, inclinarse, saltar.
 * Está parada a la derecha de la palanca. En la pose "alcanza" la punta del
 * ala queda justo sobre el pomo (app.js ubica la palanca para que coincida).
 *
 * Cada secuencia pública interrumpe la anterior y arranca desde la posición
 * en la que quedó el muñeco, así no hay saltos bruscos.
 */
(function () {
  'use strict';

  // Punto de la pose "alcanza" que agarra el pomo y punto de apoyo de los
  // pies (ver .mascota en styles.css), en fracciones del alto de la imagen.
  const MANO_Y = 0.18;
  const PIES_Y = 0.98;

  const FRASES = {
    preparar: ['¡Allá vamos!', '¡Atención!', '¡A jugar!'],
    alentar: ['¡Gira, gira!', '¡Suerte a todos!', '¡Vamos!'],
    mirar: ['¿Quién será…?', '¡Ya casi!', '¡Se está frenando!'],
    dudar: ['¡Uy, uy, uy…!', '¡No respiren!', '¿Ahí queda…?'],
    festejar: ['¡Felicitaciones!', '¡Tenemos ganador!', '¡Bravo!'],
  };

  const SALUDOS = [
    { pose: 'senala', frase: '¡Suerte a todos!', cuadro: { r: -3 } },
    { pose: 'senala', frase: '¡Atentos al premio!', cuadro: { r: -3 } },
    { pose: 'mira', frase: '¿Listos?', cuadro: { x: 1, r: 3 } },
    { pose: 'cruzado', frase: '¿Sorteamos?', cuadro: { r: -2, sy: 1.02 } },
  ];

  const azar = (lista) => lista[Math.floor(Math.random() * lista.length)];
  const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Un "cuadro" describe la postura del cuerpo: x/y en % del tamaño de la
  // mascota, r en grados (negativo = hacia la máquina), sx/sy escala.
  function transformar({ x = 0, y = 0, r = 0, sx = 1, sy = 1 }) {
    return `translate(${x}%, ${y}%) rotate(${r}deg) scale(${sx}, ${sy})`;
  }

  // La sombra mide 40% del ancho de la mascota; se achica y aclara al saltar.
  function posturaSombra({ x = 0, y = 0 }) {
    return {
      transform: `translateX(${x * 2.5}%) scale(${Math.max(0.5, 1 + y / 40)})`,
      opacity: Math.max(0.25, 0.6 + y / 50),
    };
  }

  class Mascota {
    constructor(raiz) {
      this.raiz = raiz;
      this.cuerpo = raiz.querySelector('.mascota-cuerpo');
      this.sombra = raiz.querySelector('.mascota-sombra');
      this.globo = raiz.querySelector('.mascota-globo');
      this.imagenes = [...raiz.querySelectorAll('[data-pose]')];
      this.animaciones = [];
      this.secuencia = 0;
      this.ocupada = false;

      raiz.querySelector('.mascota-toque').addEventListener('click', () => {
        if (!this.ocupada) this.saludar();
      });
      this._programarSaludo();
    }

    pose(nombre) {
      for (const img of this.imagenes) img.classList.toggle('activa', img.dataset.pose === nombre);
    }

    decir(texto, duracion = 0) {
      clearTimeout(this._temporizadorGlobo);
      if (!texto) {
        this.globo.classList.remove('visible');
        return;
      }
      this.globo.textContent = texto;
      this.globo.classList.remove('visible');
      void this.globo.offsetWidth; // reinicia la animación de aparición
      this.globo.classList.add('visible');
      if (duracion) {
        this._temporizadorGlobo = setTimeout(() => this.globo.classList.remove('visible'), duracion);
      }
    }

    // ------------------------------------------------------------------ //
    // Tirar de la palanca
    // ------------------------------------------------------------------ //

    /** Se prepara, levanta el ala y agarra el pomo. */
    async agarrarPalanca(palanca) {
      const id = this._iniciar(true);
      await this._mover([{ sx: 1.04, sy: 0.93 }], 160, 'ease-out');
      if (id !== this.secuencia) return;

      // Se estira hacia arriba y baja hasta que la mano queda sobre el pomo.
      this.pose('alcanza');
      this.decir(azar(FRASES.preparar));
      await this._mover(
        [{ y: -4, sx: 0.97, sy: 1.05, offset: 0.55, easing: 'ease-in-out' }, {}],
        320,
        'linear',
      );
      if (id !== this.secuencia) return;
      palanca.agarrar();
      await esperar(140);
    }

    /**
     * Tira del pomo hacia abajo (el pomo acompaña a la mano), llama a
     * `alBajar` cuando la palanca llega al fondo y después la suelta.
     */
    async tirarPalanca(palanca, alBajar) {
      const id = this._iniciar(true);
      this.pose('alcanza');

      // Cuánto baja la mano: la traslación más el achatamiento desde los pies.
      const tiron = { y: 4, sx: 1.02, sy: 0.86 };
      const alto = this.raiz.offsetHeight;
      const caida = alto * (tiron.y / 100 + (1 - tiron.sy) * (PIES_Y - MANO_Y));
      const curva = 'cubic-bezier(.5,0,.75,1)';

      await Promise.all([this._mover([tiron], 380, curva), palanca.bajar(caida, 380, curva)]);
      alBajar(); // siempre, aunque se haya interrumpido, para no trabar el sorteo
      if (id !== this.secuencia) return;
      await esperar(150);

      // La suelta y se cruza de brazos, con un pequeño rebote.
      palanca.soltar();
      this.pose('cruzado');
      await this._mover(
        [
          { y: -5, sx: 0.97, sy: 1.05, offset: 0.45, easing: 'cubic-bezier(.6,0,.9,.5)' },
          { sx: 1.04, sy: 0.95, offset: 0.75 },
          {},
        ],
        480,
      );
    }

    // ------------------------------------------------------------------ //
    // Mientras gira y al terminar
    // ------------------------------------------------------------------ //

    /** De brazos cruzados, cabeceando al ritmo del listado. */
    async alentar() {
      const id = this._iniciar(true);
      this.pose('cruzado');
      this.decir(azar(FRASES.alentar), 2400);
      await this._mover([{}], 120, 'ease-out');
      if (id !== this.secuencia) return;
      this._mover(
        [{}, { y: -2.5, r: -2, sy: 1.025, offset: 0.5, easing: 'ease-in' }, {}],
        520,
        'ease-out',
        Infinity,
      );
    }

    /** Se inclina hacia la máquina, nervioso, mientras frena. */
    async mirar() {
      const id = this._iniciar(true);
      this.pose('cruzado');
      this.decir(azar(FRASES.mirar));
      await this._mover([{ x: -2, r: -5 }], 300, 'ease-out');
      if (id !== this.secuencia) return;
      this._mover(
        [{ x: -2, r: -5 }, { x: -3, y: -1.5, r: -7, sx: 1.01, sy: 1.02 }],
        600,
        'ease-in-out',
        Infinity,
        'alternate',
      );
    }

    /** El listado casi se detiene y no se sabe si avanza o vuelve: solo cambia la frase. */
    dudar() {
      this.decir(azar(FRASES.dudar));
    }

    /** Señala al ganador con un salto. */
    async festejar() {
      this._iniciar(true);
      this.pose('senala');
      this.decir(azar(FRASES.festejar));
      await this._mover(
        [
          { sx: 1.07, sy: 0.9, offset: 0.15, easing: 'cubic-bezier(.2,.8,.4,1)' },
          { y: -12, r: -4, sx: 0.96, sy: 1.05, offset: 0.45, easing: 'cubic-bezier(.6,0,.9,.5)' },
          { sx: 1.06, sy: 0.93, offset: 0.7 },
          { r: -2 },
        ],
        850,
      );
    }

    /** Vuelve a la pose de espera. */
    async reposar() {
      this._iniciar(false);
      this.decir('');
      this.pose('jarras');
      await this._mover([{}], 400, 'cubic-bezier(.2,.8,.3,1)');
    }

    /** Gesto espontáneo mientras espera (o al hacerle clic). */
    async saludar() {
      const id = this._iniciar(true);
      const saludo = azar(SALUDOS);
      this.pose(saludo.pose);
      this.decir(saludo.frase, 1800);
      await this._mover(
        [
          { y: -6, sx: 0.97, sy: 1.04, ...saludo.cuadro, offset: 0.4, easing: 'cubic-bezier(.6,0,.9,.5)' },
          { sx: 1.04, sy: 0.95, offset: 0.7 },
          saludo.cuadro,
        ],
        650,
      );
      if (id !== this.secuencia) return;
      await esperar(1300);
      if (id === this.secuencia) this.reposar();
    }

    // ------------------------------------------------------------------ //
    // Internos
    // ------------------------------------------------------------------ //

    /** Corta la secuencia en curso dejando el cuerpo donde estaba. */
    _iniciar(ocupada) {
      this.secuencia += 1;
      this.ocupada = ocupada;
      this.raiz.classList.toggle('en-accion', ocupada);
      for (const anim of this.animaciones) {
        try {
          anim.commitStyles();
        } catch {
          /* el elemento no se está mostrando */
        }
        anim.cancel();
      }
      this.animaciones = [];
      if (!ocupada) this._programarSaludo();
      return this.secuencia;
    }

    _mover(cuadros, duracion, easing = 'linear', iteraciones = 1, direccion = 'normal') {
      const opciones = { duration: duracion, easing, iterations: iteraciones, direction: direccion, fill: 'forwards' };
      const tiempo = (c) => ({ offset: c.offset ?? null, easing: c.easing ?? 'linear' });
      const cuerpo = this.cuerpo.animate(cuadros.map((c) => ({ ...tiempo(c), transform: transformar(c) })), opciones);
      const sombra = this.sombra.animate(cuadros.map((c) => ({ ...tiempo(c), ...posturaSombra(c) })), opciones);
      this.animaciones.push(cuerpo, sombra);
      return cuerpo.finished.then(() => true, () => false);
    }

    _programarSaludo() {
      clearTimeout(this._temporizadorSaludo);
      this._temporizadorSaludo = setTimeout(() => {
        if (!this.ocupada) this.saludar();
        else this._programarSaludo();
      }, 9000 + Math.random() * 7000);
    }
  }

  window.Mascota = Mascota;
})();
