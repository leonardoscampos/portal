/**
 * DevOps Engineer Specialist – Extra JavaScript
 * Author: Leonardo Campos
 */

document.addEventListener('DOMContentLoaded', function () {
  initTypingAnimation();
  initLangToggle();
});

/**
 * Typing animation for the hero tagline.
 * Cycles through DevOps-themed phrases with a typewriter effect.
 */
function initTypingAnimation() {
  const taglineEl = document.getElementById('hero-tagline');
  if (!taglineEl) return;

  const isEN = window.location.pathname.includes('/en/');
  const phrases = isEN ? [
    'Automatizando tudo.',
    'Construindo pipelines resilientes.',
    'Infraestrutura como Código, sempre.',
    'Containers em escala, todo dia.',
    'Segurança desde o início.',
    'Mentalidade de observabilidade.',
    'CI/CD que nunca para.',
    'Cloud-native por padrão.',
    'Deploys orientados a GitOps.',
    'Seis domínios. Um portal.',
  ] : [
    'Automating everything.',
    'Building resilient pipelines.',
    'Infrastructure as Code, always.',
    'Containers at scale, every day.',
    'Shift-left on security.',
    'Observability-first mindset.',
    'CI/CD that never sleeps.',
    'Cloud-native by default.',
    'GitOps-driven deployments.',
    'Six domains. One portal.',
  ];

  const TYPE_SPEED   = 55;   // ms per character when typing
  const DELETE_SPEED = 30;   // ms per character when deleting
  const PAUSE_AFTER  = 2200; // ms to pause at end of phrase

  let phraseIndex = 0;
  let charIndex   = 0;
  let isDeleting  = false;

  function tick() {
    const current = phrases[phraseIndex];

    if (!isDeleting) {
      taglineEl.textContent = current.slice(0, charIndex + 1);
      charIndex++;

      if (charIndex === current.length) {
        isDeleting = true;
        setTimeout(tick, PAUSE_AFTER);
        return;
      }
    } else {
      taglineEl.textContent = current.slice(0, charIndex - 1);
      charIndex--;

      if (charIndex === 0) {
        isDeleting  = false;
        phraseIndex = (phraseIndex + 1) % phrases.length;
      }
    }

    setTimeout(tick, isDeleting ? DELETE_SPEED : TYPE_SPEED);
  }

  tick();
}

/**
 * Language toggle switch — swaps between EN and PT-BR.
 */
function initLangToggle() {
  const toggle = document.getElementById('lang-toggle');
  const btn    = document.getElementById('lang-toggle-btn');
  if (!toggle || !btn) return;

  const path = window.location.pathname;
  const isEN = path.includes('/en/');

  if (!isEN) {
    toggle.classList.add('is-pt');
    btn.setAttribute('aria-checked', 'true');
  }

  btn.addEventListener('click', function () {
    const p = window.location.pathname;
    if (p.includes('/en/')) {
      window.location.href = p.replace('/en/', '/');
    } else {
      window.location.href = p.startsWith('/portal/')
        ? p.replace('/portal/', '/portal/en/')
        : '/en' + p;
    }
  });
}
