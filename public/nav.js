const applicationLinks = document.querySelectorAll('a[href="./#application"]');

fetch(`${window.AERO_API_ORIGIN || ''}/api/me`, { credentials: 'include', cache: 'no-store' })
  .then(response => response.ok ? response.json() : null)
  .then(state => {
    if (!state?.authenticated) return;
    const hasApplication = Boolean(state.application);
    const label = hasApplication ? 'Моя заявка' : 'Заполнить анкету';
    const target = hasApplication ? './#done-screen' : './#form-screen';
    for (const link of applicationLinks) {
      link.href = target;
      link.textContent = link.closest('.faq-after') ? `${label} ↗` : label;
    }
  })
  .catch(() => {});
