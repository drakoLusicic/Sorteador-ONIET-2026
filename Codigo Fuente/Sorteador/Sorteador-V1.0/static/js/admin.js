/**
 * Ventana del administrador: cierra la ventana del ganador, maneja los
 * premios y el orden del listado, y lleva la lista de ganadores. El sorteo se
 * lanza con el botón Sortear de la pantalla. Todo lo que cambia acá lo guarda
 * el servidor y se lo avisa a la pantalla del sorteador.
 */
(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const api = window.api;

  const el = {
    conexion: $('#conexion'),
    estadoSorteo: $('#estado-sorteo'),
    btnContinuar: $('#btn-continuar'),
    motivo: $('#motivo'),
    premios: $('#premios'),
    formPremio: $('#form-premio'),
    nombrePremio: $('#nombre-premio'),
    orden: $('#orden'),
    participantes: $('#participantes'),
    btnReiniciar: $('#btn-reiniciar'),
    ganadores: $('#lista-ganadores'),
    cantidadGanadores: $('#cantidad-ganadores'),
    toast: $('#toast'),
  };

  let estado = null;      // último estado recibido del servidor
  let premios = [];
  let ganadores = [];     // en el orden en que salieron
  let conectado = false;  // canal de eventos abierto

  const formatearId = (id) => `#${String(id).padStart(3, '0')}`;

  let temporizadorToast;
  function mostrarToast(mensaje, esError = false) {
    el.toast.textContent = mensaje;
    el.toast.classList.toggle('error', esError);
    el.toast.classList.add('visible');
    clearTimeout(temporizadorToast);
    temporizadorToast = setTimeout(() => el.toast.classList.remove('visible'), 3500);
  }

  /** Ejecuta un pedido a la API y muestra el error si falla. */
  async function pedir(url, opciones) {
    try {
      return await api(url, opciones);
    } catch (err) {
      mostrarToast(err.message, true);
      return null;
    }
  }

  const enviar = (metodo, url, datos) =>
    pedir(url, { method: metodo, body: datos === undefined ? undefined : JSON.stringify(datos) });

  // ------------------------------------------------------------------ //
  // Dibujo
  // ------------------------------------------------------------------ //
  function dibujarConexion() {
    el.conexion.className = 'conexion';
    el.conexion.replaceChildren();
    if (!conectado || !estado) {
      el.conexion.classList.add('error');
      el.conexion.textContent = 'Sin conexión con el servidor. Reintentando…';
    } else if (estado.pantallas > 0) {
      el.conexion.classList.add('ok');
      el.conexion.textContent = 'Pantalla del sorteador abierta';
    } else {
      el.conexion.classList.add('error');
      const abrir = document.createElement('a');
      abrir.href = window.rutaApi('/');
      abrir.target = 'sorteador-pantalla';
      abrir.textContent = 'Abrirla';
      el.conexion.append('La pantalla del sorteador no está abierta. ', abrir);
    }
  }

  function dibujarSorteo() {
    const e = estado;
    const listo = conectado && e.sorteo === 'listo';

    if (e.sorteo === 'sorteando') {
      el.estadoSorteo.textContent = `Sorteando «${e.ultimo.premio}»…`;
    } else if (e.sorteo === 'ganador') {
      const g = e.ultimo.ganador;
      el.estadoSorteo.textContent = `Ganó ${g.nombre} ${g.apellido} (${formatearId(g.id)}): «${e.ultimo.premio}».`;
    } else if (e.premio) {
      el.estadoSorteo.textContent = `Próximo premio: «${e.premio.nombre}».`;
    } else {
      el.estadoSorteo.textContent = 'No hay premio para sortear.';
    }

    let motivo = '';
    if (e.sorteo === 'ganador') motivo = 'La pantalla muestra al ganador. Tocá Continuar para cerrar esa ventana.';
    else if (e.sorteo === 'sorteando') motivo = e.pantallas ? '' : 'Se cerró la pantalla durante el sorteo. Tocá Continuar.';
    else if (!e.pantallas) motivo = 'Abrí la pantalla del sorteador para poder sortear.';
    else if (!e.participantes) motivo = 'Todavía no hay estudiantes inscriptos.';
    else if (!e.en_juego) motivo = 'No quedan participantes en juego.';
    else if (!e.premio) motivo = 'No hay premios: agregá uno abajo.';
    el.motivo.textContent = motivo;

    el.btnContinuar.disabled = !(conectado && (e.sorteo === 'ganador' || (e.sorteo === 'sorteando' && !e.pantallas)));

    el.orden.value = e.orden;
    el.orden.disabled = !listo;
    el.participantes.textContent = `${e.participantes} inscriptos · ${e.en_juego} en juego`;
    el.btnReiniciar.disabled = !(listo && e.ganadores);
  }

  /** "Próximo" y a quién se entregó (o cuántas veces, con los nombres al pasar el mouse). */
  function detallePremio(detalle, p, esActual) {
    const partes = esActual ? ['Próximo'] : [];
    const n = p.ganadores.length;
    if (n === 1) partes.push(`Entregado a ${p.ganadores[0].nombre}`);
    else if (n > 1) partes.push(`Entregado ${n} veces`);
    detalle.textContent = partes.join(' · ');
    detalle.title = n > 1 ? p.ganadores.map((g) => g.nombre).join('\n') : '';
  }

  /** Un premio se puede entregar más de una vez: los entregados se pueden volver a elegir. */
  function dibujarPremios() {
    const actual = estado && estado.premio ? estado.premio.id : null;
    // Mientras gira, el administrador tampoco ve a quién se entregó.
    const sorteando = estado && estado.sorteo === 'sorteando' ? estado.ultimo.premio_id : null;

    el.premios.replaceChildren(
      ...premios.map((p) => {
        const item = document.createElement('li');
        item.className = 'premio';
        item.classList.toggle('actual', p.id === actual);

        const etiqueta = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'premio-actual';
        radio.value = p.id;
        radio.checked = p.id === actual;
        const nombre = document.createElement('span');
        nombre.className = 'premio-nombre';
        nombre.textContent = p.nombre;
        etiqueta.append(radio, nombre);

        const detalle = document.createElement('span');
        detalle.className = 'premio-detalle';
        if (p.id === sorteando) detalle.textContent = 'Sorteando…';
        else detallePremio(detalle, p, p.id === actual);

        const quitar = document.createElement('button');
        quitar.type = 'button';
        quitar.className = 'btn-quitar';
        quitar.dataset.id = p.id;
        quitar.textContent = '✕';
        quitar.title = 'Quitar premio';
        quitar.setAttribute('aria-label', `Quitar ${p.nombre}`);
        quitar.disabled = p.ganadores.length > 0; // la base no deja borrar un premio entregado

        item.append(etiqueta, detalle, quitar);
        return item;
      }),
    );
  }

  /** Columna lateral: el ganador más reciente arriba, numerados en el orden en que salieron. */
  function dibujarGanadores() {
    // Mientras gira, el administrador tampoco ve quién ganó.
    const oculto = estado && estado.sorteo === 'sorteando' ? estado.ultimo.ganador.id : null;
    const visibles = ganadores.filter((g) => g.id !== oculto);
    el.cantidadGanadores.textContent = visibles.length || '';

    const items = visibles.map((g, i) => {
      const item = document.createElement('li');
      item.className = 'ganador';

      const numero = document.createElement('span');
      numero.className = 'ganador-numero';
      numero.textContent = `${i + 1}.`;

      const nombre = document.createElement('span');
      nombre.className = 'ganador-nombre';
      const id = document.createElement('span');
      id.className = 'ganador-id';
      id.textContent = formatearId(g.id);
      nombre.append(`${g.apellido}, ${g.nombre}`, id);

      const hora = document.createElement('time');
      hora.className = 'ganador-hora';
      hora.dateTime = g.fecha;
      hora.textContent = g.fecha.slice(11, 16); // "AAAA-MM-DD HH:MM:SS" -> "HH:MM"

      const premio = document.createElement('span');
      premio.className = 'ganador-premio';
      premio.textContent = g.premio;

      item.append(numero, nombre, hora, premio);
      return item;
    });
    el.ganadores.replaceChildren(...items.reverse());
  }

  function dibujar() {
    dibujarConexion();
    if (!estado) return;
    dibujarSorteo();
    dibujarPremios();
    dibujarGanadores();
  }

  /** Premios (y a quién se entregó cada uno) y ganadores. */
  async function cargarListas() {
    const [datosPremios, datosGanadores] = await Promise.all([pedir('/api/premios'), pedir('/api/ganadores')]);
    if (datosPremios) {
      premios = datosPremios.premios;
      dibujarPremios();
    }
    if (datosGanadores) {
      ganadores = datosGanadores.ganadores;
      dibujarGanadores();
    }
  }

  // ------------------------------------------------------------------ //
  // Acciones
  // ------------------------------------------------------------------ //
  el.btnContinuar.addEventListener('click', () => {
    el.btnContinuar.disabled = true;
    enviar('POST', '/api/continuar').then((ok) => {
      if (!ok) dibujar();
    });
  });

  el.premios.addEventListener('change', (e) => {
    if (e.target.name !== 'premio-actual') return;
    enviar('PUT', '/api/premio-actual', { id: Number(e.target.value) }).then((ok) => {
      if (!ok) dibujarPremios(); // vuelve a marcar el premio que sigue elegido
    });
  });

  el.premios.addEventListener('click', (e) => {
    const boton = e.target.closest('.btn-quitar');
    if (!boton) return;
    const premio = premios.find((p) => p.id === Number(boton.dataset.id));
    if (premio && confirm(`¿Quitar «${premio.nombre}» de la lista de premios?`)) {
      enviar('DELETE', `/api/premios/${premio.id}`);
    }
  });

  el.formPremio.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = el.nombrePremio.value.trim();
    if (!nombre) return;
    if (await enviar('POST', '/api/premios', { nombre })) {
      el.nombrePremio.value = '';
      el.nombrePremio.focus();
    }
  });

  el.orden.addEventListener('change', () => enviar('PUT', '/api/orden', { orden: el.orden.value }));

  el.btnReiniciar.addEventListener('click', async () => {
    if (!confirm('¿Reiniciar los ganadores? Se borra la lista de ganadores: todos los participantes vuelven a entrar en juego y los premios quedan sin entregar.')) return;
    if (await enviar('POST', '/api/reiniciar')) mostrarToast('Ganadores reiniciados.');
  });

  // ------------------------------------------------------------------ //
  // Conexión con el servidor
  // ------------------------------------------------------------------ //
  window.escucharEventos(
    'admin',
    {
      estado(e) {
        estado = e;
        dibujar();
        cargarListas(); // pudieron cambiar los premios o haber un ganador nuevo
      },
    },
    (abierta) => {
      conectado = abierta;
      dibujar();
    },
  );
  dibujar();
})();
