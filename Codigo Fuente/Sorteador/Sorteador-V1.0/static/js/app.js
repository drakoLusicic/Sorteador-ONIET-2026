/**
 * Pantalla del sorteador (la que se proyecta al público). No tiene
 * controles: el sorteo, el premio y el orden del listado se manejan desde el
 * administrador (/admin), que se abre con el botón de la llave y la
 * contraseña. La pantalla escucha los avisos del servidor y anima
 * lo que corresponde: la mascota tira de la palanca, el listado gira como un
 * tragamonedas y aparece la ventana del ganador hasta que el administrador
 * toca Continuar.
 */
(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const api = window.api;

  const el = {
    escenario: $('#escenario'),
    maquina: $('.maquina'),
    carrete: $('#carrete'),
    contador: $('#contador'),
    ganadores: $('#ganadores'),
    subtitulo: $('#subtitulo'),
    premio: $('#premio'),
    btnSonido: $('#btn-sonido'),
    avisoSonido: $('#aviso-sonido'),
    btnAdmin: $('#btn-admin'),
    panelAdmin: $('#panel-admin'),
    formAdmin: $('#form-admin'),
    claveAdmin: $('#clave-admin'),
    avisoAdmin: $('#aviso-admin'),
    enlaceAdmin: $('#enlace-admin'),
    btnEntrarAdmin: $('#btn-entrar-admin'),
    btnCancelarAdmin: $('#btn-cancelar-admin'),
    modal: $('#modal'),
    modalNombre: $('#modal-nombre'),
    modalId: $('#modal-id'),
    modalPremio: $('#modal-premio'),
    toast: $('#toast'),
  };

  const estado = {
    participantes: [],
    orden: null,      // orden del listado elegido en el administrador
    girando: false,   // desde que arranca un sorteo hasta que se cierra la ventana del ganador
    compacto: false,
    servidor: null,   // último estado recibido del servidor
    conectada: true,
  };

  // ------------------------------------------------------------------ //
  // Utilidades
  // ------------------------------------------------------------------ //
  const formatearId = (id) => `#${String(id).padStart(3, '0')}`;
  const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function leerPreferencia(clave, porDefecto) {
    try {
      return localStorage.getItem(clave) ?? porDefecto;
    } catch {
      return porDefecto;
    }
  }

  function guardarPreferencia(clave, valor) {
    try {
      localStorage.setItem(clave, valor);
    } catch {
      /* sin almacenamiento disponible */
    }
  }

  let temporizadorToast;
  function mostrarToast(mensaje, esError = false) {
    el.toast.textContent = mensaje;
    el.toast.classList.toggle('error', esError);
    el.toast.classList.add('visible');
    clearTimeout(temporizadorToast);
    temporizadorToast = setTimeout(() => el.toast.classList.remove('visible'), 3500);
  }

  // ------------------------------------------------------------------ //
  // Máquina, palanca y mascota
  // ------------------------------------------------------------------ //
  let ultimoTick = 0;
  const carrete = new window.Carrete(el.carrete, {
    onTick() {
      const ahora = performance.now();
      if (ahora - ultimoTick < 35) return;
      ultimoTick = ahora;
      window.Sonido.tick();
    },
  });
  const palanca = new window.Palanca($('#palanca'));
  const mascota = new window.Mascota($('#mascota'));

  // Medidas de las poses (ver herramientas/procesar_mascota.py): proporción
  // ancho/alto y punto de la pose "alcanza" que agarra el pomo, en fracciones
  // de la imagen. MANO_Y en mascota.js tiene que coincidir con manoY.
  const MASCOTA = { proporcion: 506 / 554, manoX: 0.1, manoY: 0.18 };

  // La palanca se mide en altos de mascota (así la mano llega al pomo en
  // cualquier tamaño de pantalla): eje, separación de la máquina y pomo.
  const PALANCA = { eje: 0.442, separacion: 0.081, pomo: 0.042 };

  // Ancho que ocupa, a la derecha de la máquina, un alto de mascota: la
  // separación hasta la palanca más la mascota desde el pomo hacia la derecha.
  const DERECHA_POR_ALTO = PALANCA.separacion + MASCOTA.proporcion * (1 - MASCOTA.manoX);

  const LADO = 16;             // margen a los costados
  const PARTE_MAQUINA = 0.64;  // parte del ancho que se queda la máquina cuando no entra todo
  const MASCOTA_MINIMA = 70;   // px; con menos, se muestra solo la máquina

  /**
   * Calcula el tamaño de la máquina y de la mascota para un escenario de
   * `ancho` x `alto` px. La máquina usa todo el alto. Si a lo ancho no entra
   * todo, la máquina se angosta y la mascota se achica (repartiendo el
   * ancho), pero se mantiene el orden: listado, palanca y mascota.
   */
  function geometria(ancho, alto) {
    const margen = alto < 420 ? 8 : 16; // arriba y abajo
    const s = Math.max(200, alto - margen * 2);
    const disponible = ancho - LADO * 2;

    let anchoMaquina = Math.min(640, Math.max(340, s * 0.95));
    let altoMascota = s * 0.86;
    if (anchoMaquina + altoMascota * DERECHA_POR_ALTO > disponible) {
      anchoMaquina = Math.min(
        anchoMaquina,
        Math.max(disponible * PARTE_MAQUINA, disponible - altoMascota * DERECHA_POR_ALTO),
      );
      altoMascota = Math.min(altoMascota, (disponible - anchoMaquina) / DERECHA_POR_ALTO);
    }

    const derecha = anchoMaquina / 2 + altoMascota * DERECHA_POR_ALTO;
    const centro = Math.min(ancho / 2, ancho - LADO - derecha);
    return { s, anchoMaquina, altoMascota, centro, arriba: Math.max(0, (alto - s) / 2) };
  }

  /**
   * Ubica la máquina en el centro y la palanca y la mascota a su derecha.
   * Solo si la pantalla es tan chica que la mascota quedaría diminuta, se
   * muestra la máquina sola.
   */
  function distribuir() {
    const ancho = el.escenario.clientWidth;
    const alto = el.escenario.clientHeight;
    if (!ancho || !alto) return;

    let g = geometria(ancho, alto);
    estado.compacto = g.altoMascota < MASCOTA_MINIMA;
    if (estado.compacto) {
      g = { ...g, anchoMaquina: Math.min(640, ancho - LADO * 2), centro: ancho / 2 };
    }

    const m = g.altoMascota;
    const anchoMascota = m * MASCOTA.proporcion;
    const xPalanca = g.centro + g.anchoMaquina / 2 + m * PALANCA.separacion;
    const medidas = {
      '--s': g.s,
      '--centro': g.centro,
      '--ancho-maquina': g.anchoMaquina,
      '--x-palanca': xPalanca,
      '--y-pivote': g.s - m * PALANCA.eje,
      '--y-pomo': g.s - m * (1 - MASCOTA.manoY),
      '--r-pomo': Math.min(24, Math.max(7, m * PALANCA.pomo)),
      '--alto-mascota': m,
      '--ancho-mascota': anchoMascota,
      '--izq-mascota': xPalanca - MASCOTA.manoX * anchoMascota,
      '--arriba': g.arriba,
    };
    for (const [nombre, valor] of Object.entries(medidas)) {
      el.escenario.style.setProperty(nombre, `${valor.toFixed(1)}px`);
    }
    el.escenario.classList.toggle('compacto', estado.compacto);
    // Máquina angosta (celulares): marco, filas y globo de la mascota más compactos.
    el.escenario.classList.toggle('angosto', g.anchoMaquina < 360);
    carrete.redimensionar();
  }

  new ResizeObserver(distribuir).observe(el.escenario);

  function sacudirMaquina() {
    el.maquina.classList.remove('sacudida');
    void el.maquina.offsetWidth; // reinicia la animación CSS
    el.maquina.classList.add('sacudida');
  }

  // ------------------------------------------------------------------ //
  // Participantes y premio
  // ------------------------------------------------------------------ //
  /** Solo quienes todavía no ganaron (no se puede ganar dos veces). */
  const enJuego = () => estado.participantes.filter((p) => !p.ganador);

  function actualizarContadores() {
    const quedan = enJuego().length;
    const ganadores = estado.participantes.length - quedan;
    el.contador.textContent = quedan;
    el.ganadores.textContent =
      ganadores === 0 ? 'Todavía no hay ganadores' : `${ganadores} ${ganadores === 1 ? 'ya ganó' : 'ya ganaron'}`;
  }

  async function cargarParticipantes() {
    const orden = encodeURIComponent(estado.orden || 'apellido');
    const datos = await api(`/api/participantes?orden=${orden}`);
    estado.participantes = datos.participantes;
    // Durante el sorteo el listado no se toca: el ganador saldría antes de tiempo.
    if (!estado.girando) {
      carrete.setParticipantes(enJuego());
      actualizarContadores();
    }
  }

  function recargarParticipantes() {
    cargarParticipantes().catch((err) => mostrarToast(err.message, true));
  }

  function mostrarPremio(premio) {
    const nombre = premio ? premio.nombre : '';
    el.subtitulo.toggleAttribute('data-vacio', !nombre);
    if (el.premio.textContent === nombre) return;
    el.premio.textContent = nombre;
    // Un pequeño salto para que el público note el cambio.
    el.premio.classList.remove('cambio');
    void el.premio.offsetWidth;
    el.premio.classList.add('cambio');
  }

  /** Muestra el premio y el orden que eligió el administrador. */
  function aplicarEstado(e, recargar = false) {
    mostrarPremio(e.premio);
    if (recargar || e.orden !== estado.orden) {
      estado.orden = e.orden;
      recargarParticipantes();
    }
  }

  function recibirEstado(e) {
    estado.servidor = e;
    if (estado.girando) {
      // Durante el sorteo solo importa que el administrador cierre la ventana del ganador.
      if (e.sorteo === 'listo' && !el.modal.hidden) cerrarModal();
      return;
    }
    if (e.sorteo !== 'listo' && e.ultimo) {
      // La pantalla se abrió (o se recargó) con un sorteo sin cerrar: muestra el resultado.
      bloquear(true);
      celebrar(e.ultimo);
      return;
    }
    aplicarEstado(e);
  }

  // ------------------------------------------------------------------ //
  // Sorteo
  // ------------------------------------------------------------------ //
  function bloquear(bloqueado) {
    estado.girando = bloqueado;
    el.escenario.classList.toggle('girando', bloqueado);
  }

  /** El servidor ya eligió al ganador: la mascota tira de la palanca y el listado gira hasta él. */
  async function sortear({ ganador, premio, numero }) {
    if (estado.girando) {
      if (el.modal.hidden) return; // ya está girando
      // Quedó abierta la ventana de un ganador anterior (por ejemplo, porque se
      // reinició el servidor): se cierra para no trabar el sorteo.
      cerrarModal();
    }
    window.Sonido.activar();
    bloquear(true);
    carrete.quitarResaltado();

    try {
      await animarSorteo(ganador);
      window.Sonido.frenazo();
      mascota.festejar();
      await esperar(1000);
    } catch (err) {
      // El ganador ya quedó registrado: aunque falle la animación, se muestra.
      mostrarToast(err.message, true);
      palanca.soltar();
      mascota.reposar();
    }
    celebrar({ ganador, premio, numero });
  }

  async function animarSorteo(ganador) {
    if (!estado.compacto) await mascota.agarrarPalanca(palanca);

    if (!carrete.tiene(ganador.id)) {
      // El listado estaba desactualizado respecto de la base: se recarga,
      // dejando al ganador (que ya figura como tal) para poder llegar a él.
      await cargarParticipantes();
      carrete.setParticipantes(estado.participantes.filter((p) => !p.ganador || p.id === ganador.id));
    }

    // El listado arranca cuando la palanca llega al fondo.
    let giro;
    const arrancar = () => {
      giro = carrete.girarHacia(ganador.id, {
        alFrenar: () => mascota.mirar(),
        alDudar: () => mascota.dudar(),
      });
    };
    if (estado.compacto) {
      arrancar();
    } else {
      window.Sonido.trinquete(0.38);
      await mascota.tirarPalanca(palanca, () => {
        arrancar();
        window.Sonido.clac();
        sacudirMaquina();
        setTimeout(() => window.Sonido.resorte(), 150);
      });
      mascota.alentar();
    }
    await giro;
  }

  function celebrar({ ganador, premio, numero }) {
    window.Sonido.fanfarria();
    window.Confeti.lanzar();
    el.modalNombre.textContent = `${ganador.nombre} ${ganador.apellido}`;
    el.modalId.textContent = `Participante ${formatearId(ganador.id)}`;
    el.modalPremio.textContent = premio;
    el.modal.hidden = false;
    // El administrador espera este aviso para mostrar al ganador y habilitar
    // Continuar. Con el número, el aviso de una pantalla atrasada no afecta a
    // un sorteo posterior.
    api('/api/revelado', { method: 'POST', body: JSON.stringify({ numero }) })
      .catch((err) => mostrarToast(err.message, true));
  }

  function cerrarModal() {
    el.modal.hidden = true;
    carrete.quitarResaltado();
    mascota.reposar();
    bloquear(false);
    // El ganador queda en el centro, ya con su trofeo, y se anuncia el premio siguiente.
    if (estado.servidor) aplicarEstado(estado.servidor, true);
  }

  // Escape también cierra la ventana del ganador (pasando por el servidor,
  // para que el administrador se entere). Solo funciona en el navegador donde
  // el administrador inició sesión; en el resto (el público) no hace nada.
  document.addEventListener('keydown', (e) => {
    // Con el panel de la llave abierto, Escape solo cierra el panel.
    if (e.key === 'Escape' && !el.modal.hidden && !el.panelAdmin.open) {
      api('/api/continuar', { method: 'POST' }).catch((err) => {
        if (err.status !== 401 && err.status !== 403) mostrarToast(err.message, true);
      });
    }
  });

  // ------------------------------------------------------------------ //
  // Sonido
  // ------------------------------------------------------------------ //
  function actualizarAvisoSonido() {
    el.avisoSonido.hidden = !window.Sonido.activo || window.Sonido.habilitado;
  }

  function aplicarSonido(activo) {
    window.Sonido.activo = activo;
    el.btnSonido.textContent = activo ? '🔊' : '🔇';
    el.btnSonido.setAttribute('aria-pressed', String(activo));
    el.btnSonido.title = activo ? 'Sonido activado' : 'Sonido desactivado';
    actualizarAvisoSonido();
  }

  aplicarSonido(leerPreferencia('sorteador.sonido', '1') === '1');
  el.btnSonido.addEventListener('click', () => {
    const activo = !window.Sonido.activo;
    aplicarSonido(activo);
    guardarPreferencia('sorteador.sonido', activo ? '1' : '0');
  });

  // El sorteo llega del servidor, no de un clic, así que el audio se prepara
  // de entrada. Si el navegador no lo deja arrancar sin un clic, se avisa en
  // pantalla hasta que alguien haga clic o toque una tecla.
  window.Sonido.activar(actualizarAvisoSonido);
  for (const tipo of ['pointerdown', 'keydown']) {
    document.addEventListener(tipo, () => window.Sonido.activar(), true);
  }
  setTimeout(actualizarAvisoSonido, 1000);

  // ------------------------------------------------------------------ //
  // Administrador: la llave pide la contraseña y abre su ventana
  // ------------------------------------------------------------------ //
  /** Abre (o trae adelante) la ventana del administrador. Devuelve null si el navegador la bloqueó. */
  function abrirVentanaAdmin() {
    const ancho = Math.min(1200, screen.availWidth);
    const alto = Math.min(860, screen.availHeight);
    return window.open(window.rutaApi('/admin'), 'sorteador-admin', `popup,width=${ancho},height=${alto}`);
  }

  function limpiarPanelAdmin() {
    el.claveAdmin.value = '';
    el.avisoAdmin.textContent = '';
    el.enlaceAdmin.hidden = true;
  }

  el.btnAdmin.addEventListener('click', () => {
    limpiarPanelAdmin();
    el.panelAdmin.showModal();
  });
  el.btnCancelarAdmin.addEventListener('click', () => el.panelAdmin.close());
  el.panelAdmin.addEventListener('close', limpiarPanelAdmin);
  el.enlaceAdmin.addEventListener('click', () => el.panelAdmin.close());

  el.formAdmin.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.avisoAdmin.textContent = '';
    el.btnEntrarAdmin.disabled = true;
    try {
      await api('/api/entrar', { method: 'POST', body: JSON.stringify({ clave: el.claveAdmin.value }) });
      el.claveAdmin.value = '';
      if (abrirVentanaAdmin()) {
        el.panelAdmin.close();
      } else {
        // La sesión ya quedó abierta: el enlace la abre con un clic nuevo.
        el.avisoAdmin.textContent = 'El navegador no dejó abrir la ventana.';
        el.enlaceAdmin.hidden = false;
        el.enlaceAdmin.focus();
      }
    } catch (err) {
      el.avisoAdmin.textContent = err.message;
      el.claveAdmin.select();
    } finally {
      el.btnEntrarAdmin.disabled = false;
    }
  });

  // ------------------------------------------------------------------ //
  // Conexión con el servidor
  // ------------------------------------------------------------------ //
  window.escucharEventos(
    'pantalla',
    { estado: recibirEstado, sorteo: sortear, participantes: recargarParticipantes },
    (conectada) => {
      if (conectada === estado.conectada) return;
      estado.conectada = conectada;
      mostrarToast(conectada ? 'Conexión recuperada.' : 'Se perdió la conexión con el servidor.', !conectada);
    },
  );
})();
