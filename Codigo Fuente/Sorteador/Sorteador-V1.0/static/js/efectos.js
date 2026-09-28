/**
 * Efectos de celebración: sonidos sintetizados (Web Audio, sin archivos) y
 * lluvia de confeti en un canvas a pantalla completa.
 */
(function () {
  'use strict';

  const TAU = Math.PI * 2;

  // ------------------------------------------------------------------ //
  // Sonido
  // ------------------------------------------------------------------ //
  const Sonido = (() => {
    let ctx = null;
    let activo = true;

    /**
     * Prepara el audio. Salvo que el navegador se haya abierto con
     * --autoplay-policy=no-user-gesture-required (como lo abre app.py), solo
     * arranca si se llama desde un gesto del usuario (clic o tecla).
     * `alCambiar` se llama cuando el audio se habilita o se suspende.
     */
    function activar(alCambiar) {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
      }
      if (alCambiar) ctx.addEventListener('statechange', alCambiar);
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    }

    function tono(frecuencia, duracion, { tipo = 'sine', volumen = 0.1, retraso = 0, hasta = null } = {}) {
      if (!activo || !ctx) return;
      const t0 = ctx.currentTime + retraso;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = tipo;
      osc.frequency.setValueAtTime(frecuencia, t0);
      if (hasta) osc.frequency.exponentialRampToValueAtTime(hasta, t0 + duracion);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(volumen, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duracion);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + duracion + 0.02);
    }

    return {
      activar,
      get activo() {
        return activo;
      },
      set activo(valor) {
        activo = Boolean(valor);
      },
      /** true si el navegador ya deja reproducir sonido. */
      get habilitado() {
        return Boolean(ctx) && ctx.state === 'running';
      },
      tick() {
        tono(1500 + Math.random() * 200, 0.04, { tipo: 'square', volumen: 0.035 });
      },
      /** Trinquete de la palanca mientras baja (`duracion` en segundos). */
      trinquete(duracion) {
        const clics = 6;
        for (let i = 0; i < clics; i++) {
          tono(700 + i * 60, 0.025, { tipo: 'square', volumen: 0.05, retraso: (duracion / clics) * i });
        }
      },
      /** La palanca llega al fondo: golpe grave con un clic metálico. */
      clac() {
        tono(95, 0.25, { tipo: 'sine', volumen: 0.4 });
        tono(2600, 0.05, { tipo: 'triangle', volumen: 0.12 });
      },
      /** La palanca vuelve arriba como un resorte. */
      resorte() {
        tono(240, 0.35, { tipo: 'sine', volumen: 0.12, hasta: 620 });
      },
      /** El listado se detiene en la línea de premio. */
      frenazo() {
        tono(150, 0.18, { tipo: 'sine', volumen: 0.3 });
        tono(1900, 0.04, { tipo: 'square', volumen: 0.05 });
      },
      fanfarria() {
        const notas = [523.25, 659.25, 783.99, 1046.5];
        notas.forEach((f, i) => tono(f, 0.28, { tipo: 'triangle', volumen: 0.16, retraso: i * 0.11 }));
        notas.forEach((f) => tono(f, 1.4, { tipo: 'triangle', volumen: 0.06, retraso: 0.5 }));
      },
    };
  })();

  // ------------------------------------------------------------------ //
  // Confeti
  // ------------------------------------------------------------------ //
  const Confeti = (() => {
    const canvas = document.getElementById('confeti');
    const ctx = canvas.getContext('2d');
    // Los colores del "30" del logo de ONIET.
    const COLORES = ['#ff2fa0', '#9b1b8e', '#00aeef', '#1e88e5', '#f5e400', '#76ff03', '#f04e23', '#ffffff'];
    let piezas = [];
    let animando = false;
    let dpr = 1;

    function ajustar() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
    }
    window.addEventListener('resize', ajustar);
    ajustar();

    function pieza(x, y, angulo, velocidad) {
      return {
        x,
        y,
        vx: Math.cos(angulo) * velocidad,
        vy: Math.sin(angulo) * velocidad,
        rot: Math.random() * TAU,
        vrot: (Math.random() - 0.5) * 0.3,
        ancho: 6 + Math.random() * 8,
        alto: 8 + Math.random() * 10,
        oscil: Math.random() * TAU,
        caidaMax: 2.5 + Math.random() * 2.5,
        circulo: Math.random() < 0.25,
        color: COLORES[Math.floor(Math.random() * COLORES.length)],
      };
    }

    function lanzar() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      for (let i = 0; i < 130; i++) {
        const abertura = 0.12 + Math.random() * 0.55;
        const vel = 13 + Math.random() * 11;
        piezas.push(pieza(0, h * 0.9, -Math.PI / 2 + abertura, vel));
        piezas.push(pieza(w, h * 0.9, -Math.PI / 2 - abertura, vel));
      }
      for (let i = 0; i < 120; i++) {
        piezas.push(pieza(Math.random() * w, -Math.random() * h * 0.6, Math.PI / 2, 2 + Math.random() * 3));
      }
      if (!animando) {
        animando = true;
        requestAnimationFrame(paso);
      }
    }

    function paso() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      piezas = piezas.filter((p) => p.y < window.innerHeight + 40);
      for (const p of piezas) {
        p.vx *= 0.985;
        p.vy = Math.min(p.vy * 0.985 + 0.3, p.caidaMax);
        p.oscil += 0.08;
        p.x += p.vx + Math.sin(p.oscil) * 0.8;
        p.y += p.vy;
        p.rot += p.vrot;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.oscil));
        ctx.fillStyle = p.color;
        if (p.circulo) {
          ctx.beginPath();
          ctx.arc(0, 0, p.ancho / 2, 0, TAU);
          ctx.fill();
        } else {
          ctx.fillRect(-p.ancho / 2, -p.alto / 2, p.ancho, p.alto);
        }
        ctx.restore();
      }

      if (piezas.length) {
        requestAnimationFrame(paso);
      } else {
        animando = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    return { lanzar };
  })();

  window.Sonido = Sonido;
  window.Confeti = Confeti;
})();
