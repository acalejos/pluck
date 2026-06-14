// pluck site — copy buttons + docs scroll-spy. No build step, no deps.

// --- copy-to-clipboard buttons ---
document.querySelectorAll('.copy-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const text = btn.getAttribute('data-copy') || '';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard may be blocked (insecure context) — fail quietly
    }
    const original = btn.textContent;
    btn.textContent = 'Copied';
    btn.classList.add('done');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('done');
    }, 1400);
  });
});

// --- docs TOC scroll-spy (scroll listener, not IntersectionObserver) ---
const tocLinks = Array.from(document.querySelectorAll('#toc a'));
if (tocLinks.length) {
  const sections = tocLinks
    .map((a) => {
      const id = a.getAttribute('href').slice(1);
      const el = document.getElementById(id);
      return el ? { id, el, link: a } : null;
    })
    .filter(Boolean);

  let ticking = false;
  const spy = () => {
    ticking = false;
    const y = window.scrollY + 110;
    let current = sections[0];
    for (const s of sections) {
      if (s.el.offsetTop <= y) current = s;
    }
    tocLinks.forEach((a) => a.classList.remove('active'));
    if (current) current.link.classList.add('active');
  };
  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(spy);
      }
    },
    { passive: true },
  );
  spy();
}
