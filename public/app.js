const landingScreen = document.getElementById('landing-screen');
const formScreen = document.getElementById('form-screen');
const doneScreen = document.getElementById('done-screen');
const twitchButton = document.getElementById('twitch-button');
const demoButton = document.getElementById('demo-button');
const authHint = document.getElementById('auth-hint');
const logoutButton = document.getElementById('logout-button');
const doneLogout = document.getElementById('done-logout');
const applicationForm = document.getElementById('application-form');
const formError = document.getElementById('form-error');
const submitButton = document.getElementById('submit-button');
const toastElement = document.getElementById('toast');
let session = null;
let toastTimeout;
const apiOrigin = window.APEX_API_ORIGIN || '';
if (apiOrigin) twitchButton.href = `${apiOrigin}/auth/twitch`;

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`${apiOrigin}${path}`, {
      credentials: 'include',
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
    });
  } catch {
    throw new Error('Сервер заявок сейчас недоступен.');
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Не удалось выполнить запрос.');
  return body;
}

function show(screen) {
  landingScreen.hidden = screen !== 'landing';
  formScreen.hidden = screen !== 'form';
  doneScreen.hidden = screen !== 'done';
  document.body.classList.remove('is-loading');
}

function toast(message) {
  toastElement.textContent = message;
  toastElement.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toastElement.hidden = true; }, 5500);
}

function render(state) {
  session = state.authenticated ? state : null;
  logoutButton.hidden = !state.authenticated;
  if (!state.authenticated) {
    twitchButton.hidden = !state.authConfigured;
    demoButton.hidden = !state.demoAllowed;
    authHint.textContent = state.unavailable
      ? 'Приём заявок временно недоступен. Попробуй позже.'
      : state.demoAllowed
        ? 'Демо работает без ключей Twitch. Настройка входа описана в README.'
        : 'Авторизация займёт всего несколько секунд.';
    show('landing');
    return;
  }

  document.getElementById('identity-name').textContent = state.user.displayName;
  document.getElementById('twitch-name').value = state.user.displayName;
  const avatar = document.getElementById('identity-avatar');
  avatar.textContent = state.user.displayName.slice(0, 1).toUpperCase();
  if (state.user.avatar) {
    avatar.style.backgroundImage = `url("${encodeURI(state.user.avatar)}")`;
    avatar.textContent = '';
  } else {
    avatar.style.backgroundImage = '';
  }

  if (state.application) {
    document.getElementById('done-player').textContent = state.application.minecraft;
    document.getElementById('done-twitch').textContent = state.user.displayName;
    show('done');
  } else {
    show('form');
  }
}

async function loadState() {
  const state = await api('/api/me');
  render(state);
}

demoButton.addEventListener('click', async () => {
  demoButton.disabled = true;
  try {
    await api('/api/demo-login', { method: 'POST' });
    await loadState();
  } catch (error) {
    toast(error.message);
  } finally {
    demoButton.disabled = false;
  }
});

async function logout() {
  if (!session) return;
  try {
    await api('/api/logout', {
      method: 'POST',
      headers: { 'X-CSRF-Token': session.csrfToken }
    });
    applicationForm.reset();
    await loadState();
  } catch (error) {
    toast(error.message);
  }
}

logoutButton.addEventListener('click', logout);
doneLogout.addEventListener('click', logout);

function setFormError(message) {
  formError.textContent = message;
  formError.hidden = !message;
}

for (const input of applicationForm.querySelectorAll('input')) {
  input.addEventListener('input', () => {
    input.setCustomValidity('');
    setFormError('');
  });
  input.addEventListener('change', () => setFormError(''));
}

applicationForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!session) return;
  setFormError('');

  const name = document.getElementById('name');
  const minecraft = document.getElementById('minecraft');
  const discord = document.getElementById('discord');
  const license = applicationForm.querySelector('input[name="license"]:checked');
  const fairPlay = document.getElementById('fair-play');
  name.value = name.value.trim().replace(/\s+/g, ' ');
  minecraft.value = minecraft.value.trim();
  discord.value = discord.value.trim();

  if (name.value.length < 2 || name.value.length > 40) {
    name.setCustomValidity('Укажите имя от 2 до 40 символов.');
    name.reportValidity();
    name.focus();
    return;
  }
  if (!/^[A-Za-z0-9_]{3,16}$/.test(minecraft.value)) {
    minecraft.setCustomValidity('Ник: 3–16 латинских букв, цифр или _.');
    minecraft.reportValidity();
    minecraft.focus();
    return;
  }
  if (!/^@?[A-Za-z0-9_.]{2,32}$/.test(discord.value)) {
    discord.setCustomValidity('Укажи имя пользователя Discord: 2–32 символа, можно с @ в начале.');
    discord.reportValidity();
    discord.focus();
    return;
  }
  if (!license) {
    setFormError('Укажи, есть ли у тебя лицензия Minecraft.');
    applicationForm.querySelector('input[name="license"]').focus();
    return;
  }
  if (!fairPlay.checked) {
    setFormError('Подтверди согласие с правилом честной игры.');
    fairPlay.focus();
    return;
  }

  submitButton.disabled = true;
  submitButton.querySelector('span:nth-child(2)').textContent = 'Отправляем...';
  try {
    await api('/api/applications', {
      method: 'POST',
      headers: { 'X-CSRF-Token': session.csrfToken },
      body: JSON.stringify({
        name: name.value,
        minecraft: minecraft.value,
        discord: discord.value.replace(/^@/, ''),
        license: license.value,
        fairPlay: true
      })
    });
    await loadState();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    setFormError(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector('span:nth-child(2)').textContent = 'Отправить заявку';
  }
});

const authMessages = {
  cancelled: 'Вход через Twitch отменён.',
  'invalid-state': 'Не удалось подтвердить вход. Попробуй ещё раз.',
  failed: 'Twitch не завершил вход. Попробуй ещё раз.',
  'not-configured': 'Для входа нужно настроить ключи Twitch на сервере.'
};
const authStatus = new URLSearchParams(location.search).get('auth');
if (authStatus && authMessages[authStatus]) {
  toast(authMessages[authStatus]);
  history.replaceState(null, '', location.pathname);
}

loadState().catch(() => {
  render({ authenticated: false, authConfigured: false, demoAllowed: false, unavailable: true });
});
