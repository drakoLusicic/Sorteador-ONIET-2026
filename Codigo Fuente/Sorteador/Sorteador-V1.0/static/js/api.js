/**
 * Acceso a la API del servidor, compartido por la pantalla del sorteador y
 * el administrador.
 *
 * Las ventanas se enteran de los cambios consultando el estado cada segundo
 * (y no con una conexión abierta): así funciona también en hostings
 * compartidos como cPanel, donde el programa corre en varios procesos.
 */
(function () {
  'use strict';

  // Si el hosting publica el sorteador dentro de una carpeta (por ejemplo
  // /sorteo), las plantillas lo indican en <html data-base="/sorteo">.
  const BASE = document.documentElement.dataset.base || '';
  const INTERVALO = 1000;          // ms entre consultas
  const INTERVALO_OCULTA = 5000;   // con la pestaña en segundo plano
  const CADA_CUANTAS_LATIDO = 4;   // la pantalla avisa que sigue abierta cada tantas consultas

  const ruta = (url) => (url.startsWith('/') ? BASE + url : url);

  /**
   * Pide `url` y devuelve el JSON. Si el servidor responde con error, lanza
   * su mensaje (el error trae `status`). Si la sesión del administrador se
   * cerró, vuelve a la página para entrar.
   */
  async function api(url, opciones = {}) {
    const esFormulario = opciones.body instanceof FormData;
    const resp = await fetch(ruta(url), {
      ...opciones,
      headers: {
        ...(esFormulario ? {} : { 'Content-Type': 'application/json' }),
        'X-Sorteador': '1',
        ...(opciones.headers || {}),
      },
    });
    const datos = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      if (resp.status === 401 && document.body.dataset.pagina === 'admin') {
        window.location.href = ruta('/admin/entrar');
      }
      const error = new Error(datos.error || `Error ${resp.status}`);
      error.status = resp.status;
      throw error;
    }
    return datos;
  }

  /**
   * Consulta el estado cada segundo y avisa a los `manejadores`:
   * - estado(e): cada vez que el estado cambia (y la primera vez).
   * - sorteo(ultimo): cuando empieza un sorteo nuevo.
   * - participantes(): cuando cambia el listado (se importó, se reiniciaron los
   *   ganadores o cambió la cantidad de participantes en la base).
   * `conexion(ok)` avisa cuando se corta o se recupera la comunicación.
   * La pantalla (rol "pantalla") además avisa cada pocos segundos que sigue abierta.
   */
  function escuchar(rol, manejadores, conexion = () => {}) {
    const cliente = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    let anterior = null;
    let numero = null;
    let versionParticipantes = null;
    let cantidadParticipantes = null;
    let conectada = null;
    let consultas = 0;

    async function consultar() {
      const latido = rol === 'pantalla' && consultas % CADA_CUANTAS_LATIDO === 0;
      consultas += 1;
      try {
        const e = await api(`/api/estado?rol=${rol}&cliente=${cliente}${latido ? '&latido=1' : ''}`);
        if (conectada !== true) {
          conectada = true;
          conexion(true);
        }
        // Un sorteo nuevo (si la ventana se abre a mitad de un sorteo, solo
        // recibe el estado y muestra el resultado sin animarlo).
        if (numero !== null && e.numero !== numero && e.sorteo === 'sorteando' && e.ultimo && manejadores.sorteo) {
          manejadores.sorteo(e.ultimo);
        }
        numero = e.numero;
        // El listado cambió desde el administrador (versión) o directamente en
        // la base de datos, por ejemplo desde phpMyAdmin (cantidad).
        const cambioListado = versionParticipantes !== null &&
          (e.version_participantes !== versionParticipantes || e.participantes !== cantidadParticipantes);
        if (cambioListado && manejadores.participantes) manejadores.participantes();
        versionParticipantes = e.version_participantes;
        cantidadParticipantes = e.participantes;
        const texto = JSON.stringify(e);
        if (texto !== anterior) {
          anterior = texto;
          if (manejadores.estado) manejadores.estado(e);
        }
      } catch {
        if (conectada !== false) {
          conectada = false;
          conexion(false);
        }
      }
      setTimeout(consultar, document.hidden ? INTERVALO_OCULTA : INTERVALO);
    }

    if (rol === 'pantalla') {
      // Al cerrar la pantalla, el administrador lo ve enseguida (y no a los pocos segundos).
      window.addEventListener('pagehide', () => {
        navigator.sendBeacon(ruta(`/api/adios?cliente=${cliente}`));
      });
    }
    consultar();
  }

  window.api = api;
  window.rutaApi = ruta;
  window.escucharEventos = escuchar;
})();
