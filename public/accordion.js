const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const running = new WeakMap();

function setExpanded(details, expanded = !details.open) {
  const previous = running.get(details);
  if (previous) previous.finish();
  if (details.open === expanded) return;

  if (reducedMotion.matches || !details.animate) {
    details.open = expanded;
    return;
  }

  const start = details.getBoundingClientRect().height;
  details.open = expanded;
  const end = details.getBoundingClientRect().height;
  if (!expanded) details.open = true;

  details.style.height = `${start}px`;
  details.style.overflow = 'hidden';
  const animation = details.animate(
    [{ height: `${start}px` }, { height: `${end}px` }],
    { duration: 340, easing: 'cubic-bezier(.22, 1, .36, 1)' }
  );
  running.set(details, animation);
  animation.onfinish = () => {
    details.open = expanded;
    details.style.removeProperty('height');
    details.style.removeProperty('overflow');
    running.delete(details);
  };
}

document.querySelectorAll('.rule-section, .faq-list details').forEach(details => {
  details.querySelector('summary').addEventListener('click', event => {
    event.preventDefault();
    setExpanded(details);
  });
});

document.querySelectorAll('a[href^="#section-"]').forEach(link => {
  link.addEventListener('click', event => {
    const target = document.getElementById(link.hash.slice(1));
    if (!target?.classList.contains('rule-section')) return;
    event.preventDefault();
    history.pushState(null, '', link.hash);
    setExpanded(target, true);
    target.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
  });
});

const hashTarget = document.getElementById(location.hash.slice(1));
if (hashTarget?.classList.contains('rule-section')) hashTarget.open = true;
