/* ============================================================
   Misty Sandbox Studios — Frontend JS
   Handles: mist canvas, navbar scroll, mobile menu
   ============================================================ */

// ── Mist Canvas ───────────────────────────────────────────

const canvas = document.getElementById('mist-canvas');

if (canvas) {
  const ctx = canvas.getContext('2d');
  let particles = [];

  function resizeCanvas() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  class MistParticle {
    constructor() { this.init(); }

    init() {
      this.x      = Math.random() * canvas.width;
      this.y      = Math.random() * canvas.height;
      this.radius = Math.random() * 180 + 60;
      this.alpha  = Math.random() * 0.12 + 0.02;
      this.vx     = (Math.random() - 0.5) * 0.25;
      this.vy     = (Math.random() - 0.5) * 0.12;
      // Alternate between purple and cyan mist
      this.color  = Math.random() > 0.5 ? '124, 58, 237' : '6, 182, 212';
    }

    update() {
      this.x += this.vx;
      this.y += this.vy;
      // Wrap edges
      if (this.x < -this.radius)                  this.x = canvas.width  + this.radius;
      if (this.x >  canvas.width  + this.radius)  this.x = -this.radius;
      if (this.y < -this.radius)                  this.y = canvas.height + this.radius;
      if (this.y >  canvas.height + this.radius)  this.y = -this.radius;
    }

    draw() {
      const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius);
      g.addColorStop(0, `rgba(${this.color}, ${this.alpha})`);
      g.addColorStop(1, `rgba(${this.color}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function initParticles(count = 18) {
    particles = Array.from({ length: count }, () => new MistParticle());
  }

  function animateMist() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => { p.update(); p.draw(); });
    requestAnimationFrame(animateMist);
  }

  resizeCanvas();
  initParticles();
  animateMist();

  window.addEventListener('resize', () => {
    resizeCanvas();
    initParticles();
  }, { passive: true });
}

// ── Navbar scroll effect ──────────────────────────────────

const navbar = document.getElementById('navbar');
if (navbar) {
  const onScroll = () => {
    navbar.classList.toggle('scrolled', window.scrollY > 40);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); // run once on load
}

// ── Mobile menu ───────────────────────────────────────────

const hamburger   = document.getElementById('hamburger-btn');
const mobileMenu  = document.getElementById('mobile-menu');
const closeBtn    = document.getElementById('mobile-close-btn');

function openMobileMenu() {
  if (!mobileMenu) return;
  mobileMenu.classList.add('open');
  hamburger && hamburger.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
}

function closeMobileMenu() {
  if (!mobileMenu) return;
  mobileMenu.classList.remove('open');
  hamburger && hamburger.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}

hamburger && hamburger.addEventListener('click', openMobileMenu);
closeBtn  && closeBtn.addEventListener('click', closeMobileMenu);

// Close on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMobileMenu();
});

// ── Smooth anchor scroll with navbar offset ───────────────

document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener('click', function (e) {
    const target = document.querySelector(this.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    const offset = navbar ? navbar.offsetHeight + 16 : 80;
    const top    = target.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: 'smooth' });
  });
});

// ── Scroll-reveal animation ───────────────────────────────

const revealStyle = document.createElement('style');
revealStyle.textContent = `
  .reveal { opacity: 0; transform: translateY(28px); transition: opacity 0.6s ease, transform 0.6s ease; }
  .reveal.visible { opacity: 1; transform: translateY(0); }
`;
document.head.appendChild(revealStyle);

function addRevealClasses() {
  document.querySelectorAll(
    '.game-card, .feature-item, .stat-card, .about-panel, .news-item'
  ).forEach((el) => el.classList.add('reveal'));
}

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 }
);

function observeRevealTargets() {
  document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));
}

// Run after DOM is fully parsed
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    addRevealClasses();
    observeRevealTargets();
  });
} else {
  addRevealClasses();
  observeRevealTargets();
}
