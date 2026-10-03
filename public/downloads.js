const accessPanel = document.getElementById('download-access');
const downloadGrid = document.getElementById('download-grid');
const accessTitle = document.getElementById('access-title');
const accessMessage = document.getElementById('access-message');
const accessAction = document.getElementById('access-action');
const accessRetry = document.getElementById('access-retry');
const downloadsApiOrigin = window.AERO_API_ORIGIN || '';

function showAccess(title, message, action, href) {
  downloadGrid.hidden = true;
  accessPanel.hidden = false;
  accessTitle.textContent = title;
  accessMessage.textContent = message;
  accessAction.hidden = !action;
  if (action) {
    accessAction.textContent = `${action} ↗`;
    accessAction.href = href;
  }
}

accessRetry.addEventListener('click', () => location.reload());

async function loadDownloads() {
  const state = await window.aerolandSession;
  if (!state) throw new Error('Сервер сейчас недоступен. Попробуй ещё раз.');
  if (!state.authenticated) {
    showAccess('Войди через Twitch', 'Сборка доступна игрокам с одобренной заявкой.', 'Войти через Twitch', `${downloadsApiOrigin}/auth/twitch`);
    return;
  }
  if (state.application?.status !== 'accepted') {
    const message = !state.application
      ? 'Подай заявку на сервер. После одобрения здесь появятся файлы сборки.'
      : state.application.status === 'rejected'
        ? 'Заявка отклонена. Попробуй в следующем сезоне.'
        : 'Заявка на рассмотрении. После одобрения здесь появятся файлы сборки.';
    showAccess('Доступ после одобрения', message, state.application ? 'Моя заявка' : 'Подать заявку', state.application ? './#done-screen' : './#application');
    return;
  }
  const response = await fetch(`${downloadsApiOrigin}/api/downloads`, { credentials: 'include', cache: 'no-store' });
  const result = await response.json();
  if (response.status === 401) {
    showAccess('Войди через Twitch', result.error, 'Войти через Twitch', `${downloadsApiOrigin}/auth/twitch`);
    return;
  }
  if (response.status === 403) {
    showAccess('Доступ к сборке закрыт', result.error, 'Моя заявка', './#done-screen');
    for (const link of document.querySelectorAll('[data-download-link]')) link.hidden = true;
    return;
  }
  if (!response.ok) throw new Error(result.error || 'Не удалось получить сборку.');
  for (const format of ['mrpack', 'zip']) {
    const file = result.files?.find(item => item.format === format);
    if (!file?.url) throw new Error('Файлы сборки временно недоступны.');
    document.getElementById(`download-${format}`).href = new URL(file.url, downloadsApiOrigin || location.origin).href;
  }
  accessPanel.hidden = true;
  downloadGrid.hidden = false;
}

loadDownloads().catch(error => {
  showAccess('Не удалось проверить доступ', error.message || 'Попробуй ещё раз.');
  accessRetry.hidden = false;
});
