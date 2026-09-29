const form = document.getElementById('dni-form');
const dniInput = document.getElementById('dni-input');
const submitBtn = document.getElementById('submit-btn');
const confirmBtn = document.getElementById('confirm-btn');
const cancelBtn = document.getElementById('cancel-btn');
const statusMessage = document.getElementById('status-message');
const nombreParcial = document.getElementById('nombre-parcial');

const screens = {
  login: document.getElementById('screen-login'),
  confirm: document.getElementById('screen-confirm'),
  success: document.getElementById('screen-success')
};

let currentDni = '';

function setStatus(message, type = '') {
  statusMessage.textContent = message || '';
  statusMessage.classList.remove('success');

  if (type === 'success') {
    statusMessage.classList.add('success');
  }
}

function showScreen(name) {
  Object.entries(screens).forEach(([key, screen]) => {
    screen.classList.toggle('active', key === name);
  });
}

function setLoading(button, isLoading, label) {
  button.disabled = isLoading;
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.textContent = label;
    return;
  }

  button.textContent = button.dataset.originalText || label;
}

function normalizeDni(value) {
  return String(value || '').replace(/[.\s]/g, '').replace(/\D/g, '');
}

function isValidDni(value) {
  return /^\d{7,8}$/.test(String(value || ''));
}

function clearFields() {
  dniInput.value = '';
  currentDni = '';
}

async function requestJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Error del servidor');
  }

  return data;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const dni = normalizeDni(dniInput.value);

  if (!isValidDni(dni)) {
    setStatus('DNI inválido');
    dniInput.focus();
    return;
  }

  setLoading(submitBtn, true, 'Cargando...');
  setStatus('');

  try {
    const data = await requestJson('/api/verificar', { dni });

    if (data.estado === 'pendiente') {
      currentDni = dni;
      nombreParcial.textContent = data.nombreParcial;
      showScreen('confirm');
      setStatus('');
      return;
    }

    if (data.estado === 'ya_participa') {
      currentDni = dni;
      showScreen('success');
      setStatus('Ya estás participando', 'success');
      return;
    }

    setStatus('No se pudo continuar.');
  } catch (error) {
    setStatus(error.message || 'No se pudo continuar.');
  } finally {
    setLoading(submitBtn, false, 'Continuar');
  }
});

confirmBtn.addEventListener('click', async () => {
  if (!currentDni) {
    showScreen('login');
    return;
  }

  setLoading(confirmBtn, true, 'Procesando...');
  setStatus('');

  try {
    const data = await requestJson('/api/confirmar', { dni: currentDni });

    if (data.estado === 'confirmado') {
      showScreen('success');
      setStatus('Ya estás participando', 'success');
      return;
    }

    setStatus('No se pudo confirmar.');
  } catch (error) {
    setStatus(error.message || 'No se pudo confirmar.');
  } finally {
    setLoading(confirmBtn, false, 'Sí, soy yo');
  }
});

cancelBtn.addEventListener('click', () => {
  clearFields();
  setStatus('');
  showScreen('login');
});

dniInput.addEventListener('input', () => {
  dniInput.value = normalizeDni(dniInput.value).slice(0, 8);
});

showScreen('login');
