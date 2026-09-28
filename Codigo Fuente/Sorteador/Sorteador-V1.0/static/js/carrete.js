/**
 * Carrete tipo tragamonedas hecho con el listado de participantes.
 *
 * Las filas se dibujan sobre un tambor: cada una se ubica según su ángulo
 * respecto del centro (el seno da la altura y el coseno el achatamiento), y
 * el listado da la vuelta (después del último viene el primero). La fila que
 * queda en el centro, sobre la línea de premio, es la ganadora.
 *
 * El sorteo tiene tres partes:
 * 1. Un tramo rápido que recorre el listado completo al menos VUELTAS_MINIMAS
 *    veces, por más participantes que haya (con cientos va tan rápido que se
 *    ve borroso).
 * 2. La frenada: las últimas FILAS_FRENADA filas pasan cada vez más despacio.
 * 3. Un final elegido al azar (ver FINALES): a veces parece quedarse en una
 *    fila, duda y avanza una más, o se pasa y vuelve una. Así, hasta que se
 *    detiene, no se sabe quién gana.
 * El ganador ya lo eligió el servidor; el giro solo lleva el listado hasta él.
 *
 * Mientras no gira se puede recorrer con la rueda del mouse, arrastrando,
 * con las flechas del teclado o haciendo clic en una fila.
 */
(function () {
  'use strict';

  const ANGULO_BORDE = (80 * Math.PI) / 180; // las filas de arriba y abajo quedan a 80°
  const VUELTAS_MINIMAS = 3;      // vueltas completas al listado en cada sorteo
  const FILAS_MINIMAS = 120;      // recorrido mínimo, aunque haya pocos participantes
  const DURACION_RAPIDO = 3500;   // ms del tramo rápido; con listados largos, algo más (ver girarHacia)
  const FILAS_FRENADA = 30;       // filas que pasan durante la frenada
  const DURACION_FRENADA = 6000;  // ms de la frenada, más hasta 800 al azar
  const INICIO_FRENADO = 0.35;    // fracción de la frenada en la que avisa que va despacio

  const mod = (a, n) => ((a % n) + n) % n;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  /**
   * Curva del tramo rápido: arranca a toda velocidad y la va bajando hasta
   * `velocidadFinal` (filas por ms), la misma con la que empieza la frenada,
   * para que no se note el paso de un tramo al otro.
   */
  function curvaRapida(distancia, duracion, velocidadFinal) {
    const constante = Math.min(distancia, velocidadFinal * duracion);
    const extra = distancia - constante; // lo que suma el arranque rápido
    return (t) => (constante * t + extra * (1 - Math.pow(1 - t, 3))) / distancia;
  }

  /*
   * Cómo termina el giro. Las posiciones son relativas a la fila ganadora:
   * 0 es la ganadora centrada en la línea, -1 la fila anterior y +1 la
   * siguiente. `frena` es donde queda casi detenido al terminar la frenada;
   * después vienen los tramos del final. En el tramo con `duda`
   * apenas se mueve, como si no supiera para qué lado ir (su duración varía
   * un poco en cada sorteo).
   */
  const FINALES = [
    {
      // Parece que se queda en la fila anterior, duda y avanza una más.
      peso: 35,
      frena: -0.66,
      tramos: [
        { hasta: -0.6, duracion: 800, curva: easeInOut, duda: true },
        { hasta: 0.1, duracion: 700, curva: easeInOut },
        { hasta: 0, duracion: 350, curva: easeOutQuad },
      ],
    },
    {
      // Se pasa a la fila siguiente, duda y vuelve una.
      peso: 30,
      frena: 0.7,
      tramos: [
        { hasta: 0.64, duracion: 700, curva: easeInOut, duda: true },
        { hasta: -0.1, duracion: 800, curva: easeInOut },
        { hasta: 0, duracion: 350, curva: easeOutQuad },
      ],
    },
    {
      // Casi se pasa a la siguiente, pero se queda.
      peso: 20,
      frena: 0.42,
      tramos: [
        { hasta: 0.47, duracion: 700, curva: easeInOut, duda: true },
        { hasta: 0, duracion: 700, curva: easeInOut },
      ],
    },
    {
      // Frena derecho, con un pequeño rebote.
      peso: 15,
      frena: 0.3,
      tramos: [{ hasta: 0, duracion: 600, curva: easeInOut }],
    },
  ];

  function elegirFinal() {
    let azar = Math.random() * FINALES.reduce((suma, f) => suma + f.peso, 0);
    return FINALES.find((f) => (azar -= f.peso) < 0) || FINALES[0];
  }

  class Carrete {
    constructor(ventana, opciones = {}) {
      this.ventana = ventana;
      this.capa = ventana.querySelector('.carrete-filas');
      this.desenfoque = document.querySelector('#desenfoque-carrete feGaussianBlur');
      this.onTick = opciones.onTick || (() => {});

      this.items = [];
      this.filas = [];
      this.pos = 0;        // índice (con decimales) de la fila que está en el centro
      this.objetivo = 0;   // hacia dónde se desliza al recorrerlo a mano
      this.anim = null;
      this.arrastre = null;
      this.resaltadoId = null;
      this.filaCentro = null;
      this.ultimoTiempo = performance.now();
      this.cuadroPedido = false;
      this.altoFila = 52;

      this._cuadro = this._cuadro.bind(this);
      this._escucharInteraccion();
    }

    get girando() {
      return this.anim !== null;
    }

    redimensionar() {
      const alto = this.ventana.clientHeight;
      if (!alto) return;
      // En máquinas angostas (celulares) las filas son más bajas: la letra se
      // achica para que entren los nombres y a lo alto entran más filas.
      const ancho = this.ventana.clientWidth || alto;
      this.altoFila = Math.max(34, Math.min(60, alto * 0.115, ancho * 0.16));
      this.radio = alto / 2 / Math.sin(ANGULO_BORDE);
      this.anguloFila = this.altoFila / this.radio;
      this.mitad = Math.ceil(ANGULO_BORDE / this.anguloFila) + 1;
      this.ventana.style.setProperty('--alto-fila', `${this.altoFila}px`);

      const cantidad = this.mitad * 2 + 1;
      while (this.filas.length < cantidad) {
        const fila = document.createElement('div');
        fila.className = 'fila';
        this.capa.append(fila);
        this.filas.push(fila);
      }
      while (this.filas.length > cantidad) this.filas.pop().remove();
      this._invalidarFilas();
      this._pedirCuadro();
    }

    /**
     * Cambia el listado manteniendo en el centro al mismo participante. Si ya
     * no está (como el ganador, que sale del listado), queda el que le seguía.
     */
    setParticipantes(lista) {
      const anteriores = this.items;
      const centro = Math.round(this.pos);
      this.items = lista.slice();
      const indices = new Map(this.items.map((p, i) => [p.id, i]));
      let idx = 0;
      for (let k = 0; k < anteriores.length; k++) {
        const i = indices.get(anteriores[mod(centro + k, anteriores.length)].id);
        if (i !== undefined) {
          idx = i;
          break;
        }
      }
      // filaCentro también, para que el cambio no suene como un paso de fila.
      this.pos = this.objetivo = this.filaCentro = idx;
      this.ventana.classList.toggle('vacio', this.items.length === 0);
      this._invalidarFilas();
      this._pedirCuadro();
    }

    tiene(id) {
      return this.items.some((p) => p.id === id);
    }

    quitarResaltado() {
      this.resaltadoId = null;
      this.ventana.classList.remove('resaltado');
      this._pedirCuadro();
    }

    /**
     * Gira hasta dejar al participante `id` sobre la línea de premio.
     * Devuelve una promesa que se resuelve cuando se detiene.
     * `alFrenar` se llama una vez, cuando empieza a ir despacio, y `alDudar`
     * cuando queda dudando si avanzar o volver (no en todos los finales).
     */
    girarHacia(id, { alFrenar, alDudar } = {}) {
      const n = this.items.length;
      const idx = this.items.findIndex((p) => p.id === id);
      if (idx < 0) return Promise.reject(new Error('El ganador no está en el listado.'));
      if (this.anim) return Promise.reject(new Error('El listado ya está girando.'));

      this.arrastre = null;
      this.quitarResaltado();
      const vueltas = Math.max(VUELTAS_MINIMAS, Math.ceil(FILAS_MINIMAS / n));
      const destino = this.pos + mod(idx - this.pos, n) + vueltas * n;
      const final = elegirFinal();
      const frena = destino + final.frena;
      const inicioFrenada = frena - FILAS_FRENADA;
      const frenada = DURACION_FRENADA + Math.random() * 800;
      // Con cientos de participantes el tramo rápido dura hasta 2,5 s más.
      const rapido = DURACION_RAPIDO + Math.min(2500, n * 4) + Math.random() * 700;
      // Velocidad con la que empieza la frenada (derivada de easeOutCubic en 0).
      const velocidad = (3 * FILAS_FRENADA) / frenada;

      const tramos = [
        {
          hasta: inicioFrenada,
          duracion: rapido,
          curva: curvaRapida(inicioFrenada - this.pos, rapido, velocidad),
        },
        { hasta: frena, duracion: frenada, curva: easeOutCubic },
        ...final.tramos.map((t) => ({
          ...t,
          hasta: destino + t.hasta,
          duracion: t.duda ? t.duracion * (0.75 + Math.random() * 0.6) : t.duracion,
        })),
      ];

      // Momentos (ms desde el inicio) en los que se avisa.
      const avisos = [];
      if (alFrenar) avisos.push({ en: rapido + frenada * INICIO_FRENADO, avisar: alFrenar });
      let inicioTramo = 0;
      for (const tramo of tramos) {
        if (tramo.duda && alDudar) avisos.push({ en: inicioTramo, avisar: alDudar });
        inicioTramo += tramo.duracion;
      }

      return new Promise((resolve) => {
        this.anim = { inicio: performance.now(), desde: this.pos, tramos, avisos, idx, resolve };
        this._pedirCuadro();
      });
    }

    // ------------------------------------------------------------------ //
    // Animación
    // ------------------------------------------------------------------ //
    _pedirCuadro() {
      if (this.cuadroPedido) return;
      this.cuadroPedido = true;
      requestAnimationFrame(this._cuadro);
    }

    _cuadro(ahora) {
      this.cuadroPedido = false;
      const previa = this.pos;
      let seguir = false;

      if (this.anim) {
        seguir = this._avanzarGiro(ahora);
      } else if (!this.arrastre && this.pos !== this.objetivo) {
        this.pos += (this.objetivo - this.pos) * 0.22;
        if (Math.abs(this.objetivo - this.pos) < 0.002) this.pos = this.objetivo;
        seguir = true;
      }

      const dt = Math.max(1, ahora - this.ultimoTiempo);
      this.ultimoTiempo = ahora;
      this._aplicarDesenfoque(seguir ? (Math.abs(this.pos - previa) / dt) * 1000 : 0);
      this._detectarTick();
      this._dibujar();
      if (seguir) this._pedirCuadro();
    }

    _avanzarGiro(ahora) {
      const a = this.anim;
      let t = ahora - a.inicio;
      while (a.avisos.length && t >= a.avisos[0].en) a.avisos.shift().avisar();

      let desde = a.desde;
      for (const tramo of a.tramos) {
        if (t < tramo.duracion) {
          this.pos = desde + (tramo.hasta - desde) * tramo.curva(t / tramo.duracion);
          return true;
        }
        t -= tramo.duracion;
        desde = tramo.hasta;
      }

      this.anim = null;
      // Misma fila que el destino (la posición se reduce a una sola vuelta),
      // así que no cuenta como un paso de fila.
      this.pos = this.objetivo = this.filaCentro = a.idx;
      this.resaltadoId = this.items[a.idx].id;
      this.ventana.classList.add('resaltado');
      a.resolve(this.items[a.idx]);
      return false;
    }

    _aplicarDesenfoque(velocidad) {
      if (!this.desenfoque) return;
      // Con cientos de participantes pasan varias filas por cuadro: se
      // desenfoca hasta media fila, así se ve como un giro y no como nombres
      // que parpadean en el lugar.
      const valor = Math.min(this.altoFila * 0.5, velocidad / 12);
      if (valor < 0.3) {
        this.capa.style.filter = '';
        return;
      }
      this.desenfoque.setAttribute('stdDeviation', `0 ${valor.toFixed(2)}`);
      this.capa.style.filter = 'url(#desenfoque-carrete)';
    }

    _detectarTick() {
      const centro = Math.round(this.pos);
      if (centro !== this.filaCentro) {
        if (this.filaCentro !== null) this.onTick();
        this.filaCentro = centro;
      }
    }

    _dibujar() {
      const n = this.items.length;
      const base = Math.round(this.pos);

      for (let j = 0; j < this.filas.length; j++) {
        const fila = this.filas[j];
        const absoluto = base + j - this.mitad;
        const angulo = (absoluto - this.pos) * this.anguloFila;
        if (!n || Math.abs(angulo) > Math.PI / 2 - 0.02) {
          fila.style.visibility = 'hidden';
          continue;
        }

        const p = this.items[mod(absoluto, n)];
        this._pintar(fila, p);
        const coseno = Math.cos(angulo);
        fila.dataset.absoluto = absoluto;
        fila.style.visibility = '';
        fila.style.transform = `translateY(${(this.radio * Math.sin(angulo)).toFixed(2)}px) scaleY(${coseno.toFixed(4)})`;
        fila.style.opacity = (0.12 + 0.88 * coseno).toFixed(3);

        const enCentro = absoluto === base;
        fila.classList.toggle('centro', enCentro && !this.anim);
        fila.classList.toggle('ganadora', enCentro && p.id === this.resaltadoId);
      }
    }

    _pintar(fila, p) {
      const clave = String(p.id);
      if (fila.dataset.clave === clave) return;
      fila.dataset.clave = clave;

      const id = document.createElement('span');
      id.className = 'f-id';
      id.textContent = `#${String(p.id).padStart(3, '0')}`;

      const nombre = document.createElement('span');
      nombre.className = 'f-nombre';
      const apellido = document.createElement('strong');
      apellido.textContent = p.apellido;
      nombre.append(apellido, `, ${p.nombre}`);

      fila.replaceChildren(id, nombre);
    }

    _invalidarFilas() {
      for (const fila of this.filas) fila.dataset.clave = '';
    }

    // ------------------------------------------------------------------ //
    // Recorrido manual
    // ------------------------------------------------------------------ //
    _puedeMoverse() {
      return !this.anim && this.items.length > 0;
    }

    _mover(filas) {
      this.objetivo = Math.round(this.objetivo + filas);
      this._pedirCuadro();
    }

    _escucharInteraccion() {
      const v = this.ventana;

      v.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          if (!this._puedeMoverse()) return;
          const paso = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaY / 100;
          this.objetivo += paso;
          clearTimeout(this._ajuste);
          this._ajuste = setTimeout(() => this._mover(0), 120);
          this._pedirCuadro();
        },
        { passive: false },
      );

      v.addEventListener('pointerdown', (e) => {
        if (!this._puedeMoverse() || e.button !== 0) return;
        this.arrastre = { y: e.clientY, pos: this.pos, movio: false, fila: e.target.closest('.fila') };
        v.setPointerCapture(e.pointerId);
      });

      v.addEventListener('pointermove', (e) => {
        if (!this.arrastre) return;
        const dy = e.clientY - this.arrastre.y;
        if (Math.abs(dy) > 4) {
          this.arrastre.movio = true;
          v.classList.add('arrastrando');
        }
        if (this.arrastre.movio) {
          this.pos = this.objetivo = this.arrastre.pos - dy / this.altoFila;
          this._pedirCuadro();
        }
      });

      const soltar = () => {
        if (!this.arrastre) return;
        const { movio, fila } = this.arrastre;
        this.arrastre = null;
        v.classList.remove('arrastrando');
        // Un clic sin arrastrar lleva esa fila al centro.
        if (!movio && fila && fila.dataset.absoluto !== undefined) {
          this.objetivo = Number(fila.dataset.absoluto);
        }
        this._mover(0);
      };
      v.addEventListener('pointerup', soltar);
      v.addEventListener('pointercancel', soltar);

      v.addEventListener('keydown', (e) => {
        const pasos = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 };
        if (!(e.key in pasos)) return;
        e.preventDefault();
        if (this._puedeMoverse()) this._mover(pasos[e.key]);
      });
    }
  }

  window.Carrete = Carrete;
})();
