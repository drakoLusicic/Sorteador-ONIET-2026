const form = document.getElementById('dni-form');
const dniInput = document.getElementById('dni-input');
const submitBtn = document.getElementById('submit-btn');
const confirmBtn = document.getElementById('confirm-btn');
const cancelBtn = document.getElementById('cancel-btn');
const statusMessage = document.getElementById('status-message');
const nombreParcial = document.getElementById('nombre-parcial');
const winnerDialog = document.getElementById('winner-dialog');
const winnerStudentId = document.getElementById('winner-student-id');
const winnerStudentName = document.getElementById('winner-student-name');
const winnerPrize = document.getElementById('winner-prize');
const winnerCloseBtn = document.getElementById('winner-close');

const screens = {
  login: document.getElementById('screen-login'),
  confirm: document.getElementById('screen-confirm'),
  success: document.getElementById('screen-success')
};

let currentDni = '';
let winnerToken = '';
let winnerPollingTimer = null;
let winnerPollInProgress = false;
const winnerPollIntervalMs = 5000;

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
  stopWinnerPolling();
  dniInput.value = '';
  currentDni = '';
}

function stopWinnerPolling() {
  if (winnerPollingTimer !== null) {
    window.clearTimeout(winnerPollingTimer);
    winnerPollingTimer = null;
  }
  winnerToken = '';
}

function startWinnerPolling(token) {
  stopWinnerPolling();
  winnerToken = token || '';
  if (winnerToken) pollForWinner();
}

function showWinner(ganador) {
  stopWinnerPolling();
  winnerStudentId.textContent = String(ganador.estudianteId);
  winnerStudentName.textContent = `${ganador.nombre} ${ganador.apellido}`.trim();
  winnerPrize.textContent = ganador.premio;
  winnerDialog.showModal();
}

async function pollForWinner() {
  if (!winnerToken || winnerPollInProgress || winnerDialog.open) return;

  winnerPollInProgress = true;
  try {
    const data = await requestJson('/api/ganador', { token: winnerToken });
    if (data.ganador) {
      showWinner(data.ganador);
      return;
    }
  } catch (error) {
    if (error.status === 401 && currentDni) {
      try {
        const verification = await requestJson('/api/verificar', { dni: currentDni });
        winnerToken = verification.winnerToken || '';
      } catch {
        stopWinnerPolling();
      }
    }
  } finally {
    winnerPollInProgress = false;
    if (winnerToken && !winnerDialog.open) {
      winnerPollingTimer = window.setTimeout(pollForWinner, winnerPollIntervalMs);
    }
  }
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
    const error = new Error(data.error || 'Error del servidor');
    error.status = response.status;
    throw error;
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
      startWinnerPolling(data.winnerToken);
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
      startWinnerPolling(data.winnerToken);
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

winnerCloseBtn.addEventListener('click', () => winnerDialog.close());

dniInput.addEventListener('input', () => {
  dniInput.value = normalizeDni(dniInput.value).slice(0, 8);
});

showScreen('login');
