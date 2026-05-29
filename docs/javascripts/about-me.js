document.addEventListener('DOMContentLoaded', function () {
  const fills = document.querySelectorAll('.am-skill-fill');
  if (!fills.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        setTimeout(() => { el.style.width = el.dataset.progress + '%'; }, 120);
        observer.unobserve(el);
      }
    });
  }, { threshold: 0.4 });

  fills.forEach(el => observer.observe(el));
});
