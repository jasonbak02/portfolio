/*
 * Hero scroll + video controls
 * ----------------------------
 * The stage is pinned (position: sticky) while the taller .hero scrolls past.
 * This script turns that scroll into --p, 0 at the top and 1 when the stage
 * is about to release; styles.css parts the name and eases the video off it.
 * It also keeps the nav clear (no bar, white text) while it sits over the video.
 */
(() => {
  const hero = document.getElementById("hero");
  const nav = document.querySelector(".nav");
  const video = document.getElementById("heroVideo");
  const toggle = document.getElementById("heroToggle");

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  function measure() {
    hero.style.setProperty("--nav-h", `${nav.offsetHeight}px`);
  }

  let queued = false;
  function update() {
    queued = false;
    const rect = hero.getBoundingClientRect();
    // Clear nav while any of the video is still behind it.
    nav.classList.toggle("nav--clear", rect.bottom > nav.offsetHeight);
    if (reduced.matches) return hero.style.setProperty("--p", 0);
    const travel = hero.offsetHeight - window.innerHeight;
    const p = Math.min(1, Math.max(0, -rect.top / travel));
    hero.style.setProperty("--p", p.toFixed(4));
  }
  function queue() {
    if (!queued) { queued = true; requestAnimationFrame(update); }
  }

  measure();
  update();
  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", () => { measure(); queue(); });
  reduced.addEventListener("change", queue);

  /* ---------- Play / pause (and respect reduced-motion) ---------- */
  function setPaused(paused) {
    paused ? video.pause() : video.play().catch(() => {});
    toggle.classList.toggle("is-paused", paused);
    toggle.setAttribute("aria-label", paused ? "Play background video" : "Pause background video");
  }
  toggle.addEventListener("click", () => setPaused(!video.paused));

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    video.removeAttribute("autoplay");
    setPaused(true);
  }
})();

/*
 * McGraw Tower drawing
 * --------------------
 * Traces itself in when scrolled into view, and its clock keeps Ithaca time.
 */
(() => {
  const fig = document.getElementById("eduFig");
  if (!fig) return;
  document.documentElement.classList.add("js");

  new IntersectionObserver((entries, io) => {
    if (entries[0].isIntersecting) {
      fig.classList.add("is-drawn");
      io.disconnect();
    }
  }, { threshold: 0.35 }).observe(fig);

  const hour = document.getElementById("hourHand");
  const minute = document.getElementById("minuteHand");
  const readout = document.getElementById("ithacaTime");
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: false,
  });

  function tick() {
    const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
    const h = Number(parts.hour) % 24, m = Number(parts.minute), s = Number(parts.second);
    minute.setAttribute("transform", `rotate(${(m + s / 60) * 6} 180 290)`);
    hour.setAttribute("transform", `rotate(${((h % 12) + m / 60) * 30} 180 290)`);
    const h12 = h % 12 || 12;
    readout.textContent = `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"} ET`;
  }
  tick();
  setInterval(tick, 1000);
})();
