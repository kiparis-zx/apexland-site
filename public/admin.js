const loginScreen = document.getElementById('admin-login');
const dashboard = document.getElementById('admin-dashboard');
const loginForm = document.getElementById('admin-login-form');
const loginError = document.getElementById('admin-login-error');
const loginButton = document.getElementById('admin-login-button');
const list = document.getElementById('admin-applications');
const search = document.getElementById('admin-search');
let csrfToken = null;
let applications = [];
const apiOrigin = window.APEX_API_ORIGIN || '';

async function api(path, options = {}) {
  const response = await fetch(`${apiOrigin}${path}`, {
    credentials: 'include',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Ошибка сервера.');
  return body;
}

function showDashboard(visible) {
  loginScreen.hidden = visible;
  dashboard.hidden = !visible;
  document.body.classList.remove('is-loading');
}

function setError(message) {
  loginError.textContent = message;
  loginError.hidden = !message;
}

function label(text, value) {
  const wrapper = document.createElement('div');
  const name = document.createElement('small');
  name.textContent = text;
  const content = document.createElement('strong');
  content.textContent = value;
  wrapper.append(name, content);
  return wrapper;
}

function renderApplications() {
  const query = search.value.trim().toLocaleLowerCase('ru');
  const filtered = applications.filter(item =>
    [item.name, item.minecraft, item.twitchLogin, item.twitchDisplayName, item.twitchId]
      .some(value => String(value || '').toLocaleLowerCase('ru').includes(query))
  );
  list.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'admin-empty';
    empty.textContent = applications.length
      ? 'По запросу ничего не найдено.'
      : 'Заявок пока нет. Новые заявки появятся здесь после отправки формы.';
    list.append(empty);
    return;
  }
  for (const item of filtered) {
    const card = document.createElement('article');
    card.className = 'application-card';
    const header = document.createElement('header');
    const player = document.createElement('div');
    player.className = 'application-player';
    const cube = document.createElement('span');
    cube.setAttribute('aria-hidden', 'true');
    cube.textContent = '▣';
    const title = document.createElement('div');
    const nickname = document.createElement('h3');
    nickname.textContent = item.minecraft;
    const name = document.createElement('small');
    name.textContent = `Имя: ${item.name}`;
    title.append(nickname, name);
    player.append(cube, title);
    const date = document.createElement('time');
    const submitted = new Date(item.submittedAt);
    date.dateTime = item.submittedAt;
    date.textContent = Number.isNaN(submitted.getTime())
      ? item.submittedAt
      : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(submitted);
    header.append(player, date);
    const details = document.createElement('div');
    details.className = 'application-details';
    details.append(
      label('TWITCH', item.twitchDisplayName || item.twitchLogin),
      label('TWITCH ID', item.twitchId),
      label('ЛИЦЕНЗИЯ', item.license === 'yes' ? 'Да' : 'Нет'),
      label('ПРАВИЛО ЧЕСТНОЙ ИГРЫ', item.fairPlayAccepted ? 'Принято' : 'Не подтверждено')
    );
    card.append(header, details);
    list.append(card);
  }
}

async function loadApplications() {
  const result = await api('/api/admin/applications');
  applications = result.applications;
  document.getElementById('applications-count').textContent = String(applications.length);
  document.getElementById('licensed-count').textContent = String(applications.filter(item => item.license === 'yes').length);
  document.getElementById('unlicensed-count').textContent = String(applications.filter(item => item.license === 'no').length);
  renderApplications();
}

async function checkSession() {
  const session = await api('/api/admin/session');
  csrfToken = session.authenticated ? session.csrfToken : null;
  showDashboard(Boolean(session.authenticated));
  if (session.authenticated) await loadApplications();
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  setError('');
  loginButton.disabled = true;
  try {
    await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('admin-username').value.trim(),
        password: document.getElementById('admin-password').value
      })
    });
    loginForm.reset();
    await checkSession();
  } catch (error) {
    setError(error.message);
  } finally {
    loginButton.disabled = false;
  }
});

document.getElementById('admin-logout').addEventListener('click', async () => {
  if (!csrfToken) return;
  try {
    await api('/api/admin/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } });
    applications = [];
    csrfToken = null;
    showDashboard(false);
  } catch (error) {
    alert(error.message);
  }
});

document.getElementById('admin-refresh').addEventListener('click', async () => {
  try {
    await loadApplications();
  } catch (error) {
    list.textContent = error.message;
  }
});

search.addEventListener('input', renderApplications);
checkSession().catch(error => {
  showDashboard(false);
  setError(error.message);
});
