/**
 * Ingreso al sorteador (lo primero que aparece). Con el usuario y la
 * contraseña correctos se abre la sesión, el administrador se abre en otra
 * ventana y esta pasa a ser la pantalla del sorteador (la ruleta).
 */
(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);

  const el = {
    form: $('#form-ingreso'),
    usuario: $('#usuario'),
    clave: $('#clave'),
    aviso: $('#aviso'),
    entrar: $('#btn-entrar'),
  };

  el.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.aviso.textContent = '';
    el.entrar.disabled = true;
    try {
      await window.api('/api/entrar', {
        method: 'POST',
        body: JSON.stringify({ usuario: el.usuario.value, clave: el.clave.value }),
      });
    } catch (err) {
      el.aviso.textContent = err.message;
      el.clave.select();
      el.entrar.disabled = false;
      return;
    }

    // Si esta es la ventana del administrador (se tocó Salir), vuelve a él.
    if (window.name === window.VENTANA_ADMIN) {
      window.location.replace(window.rutaApi('/admin'));
      return;
    }
    // El administrador se abre ahora, todavía dentro del clic (si no, el
    // navegador lo bloquea). Si igual lo bloqueó, la pantalla lo avisa.
    const abierto = window.abrirAdministrador();
    window.location.replace(window.rutaApi(abierto ? '/' : '/?sin-admin=1'));
  });
})();
