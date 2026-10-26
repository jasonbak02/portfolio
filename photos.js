/*
 * Photos page: filters, scroll-in reveal and a full-screen viewer.
 * Everything reads from the <figure class="ph"> markup in photos.html,
 * so adding a photo there is all it takes.
 */
(() => {
  const gallery = document.getElementById("gallery");
  const figures = [...gallery.querySelectorAll(".ph")];
  const chips = [...document.querySelectorAll(".chip")];

  /* ---------- Reveal on scroll ---------- */
  document.documentElement.classList.add("reveal");
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
    }
  }, { rootMargin: "0px 0px -8% 0px" });
  figures.forEach((f) => io.observe(f));

  /* ---------- Filters ---------- */
  function applyFilter(cat) {
    chips.forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.filter === cat)));
    gallery.classList.toggle("is-filtered", cat !== "all");
    figures.forEach((f) => { f.hidden = cat !== "all" && f.dataset.cat !== cat; });
  }
  chips.forEach((c) => c.addEventListener("click", () => applyFilter(c.dataset.filter)));

  /* ---------- Lightbox ---------- */
  const box = document.getElementById("lightbox");
  const img = document.getElementById("lbImg");
  const count = document.getElementById("lbCount");
  const exif = document.getElementById("lbExif");
  let list = [], index = 0, opener = null;

  // Largest candidate from a srcset, for full-screen viewing.
  const largest = (el) => {
    const sources = (el.getAttribute("srcset") || "").split(",").map((s) => s.trim().split(/\s+/));
    sources.sort((a, b) => parseInt(b[1]) - parseInt(a[1]));
    return sources.length ? sources[0][0] : el.src;
  };

  function show(i) {
    index = (i + list.length) % list.length;
    const fig = list[index];
    const thumb = fig.querySelector("img");
    img.classList.remove("is-loaded");
    img.alt = thumb.alt;
    img.src = thumb.currentSrc || thumb.src;          // instant, already cached
    const full = largest(thumb);
    const hi = new Image();
    hi.onload = () => { if (list[index] === fig) img.src = full; };
    hi.src = full;
    requestAnimationFrame(() => img.classList.add("is-loaded"));
    count.textContent = `${String(index + 1).padStart(2, "0")} / ${String(list.length).padStart(2, "0")}`;
    exif.textContent = `${fig.querySelector(".ph__cat").textContent} · ${fig.querySelector(".ph__exif").textContent}`;
  }

  function open(fig) {
    list = figures.filter((f) => !f.hidden);
    opener = fig.querySelector(".ph__open");
    show(list.indexOf(fig));
    box.showModal();
    document.body.style.overflow = "hidden";
  }
  function close() { box.close(); }

  box.addEventListener("close", () => {
    document.body.style.overflow = "";
    opener?.focus();
  });

  figures.forEach((f) => f.querySelector(".ph__open").addEventListener("click", () => open(f)));
  document.getElementById("lbClose").addEventListener("click", close);
  document.getElementById("lbPrev").addEventListener("click", () => show(index - 1));
  document.getElementById("lbNext").addEventListener("click", () => show(index + 1));

  box.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") show(index - 1);
    if (e.key === "ArrowRight") show(index + 1);
  });
  // Clicking the dark area around the photo closes the viewer.
  box.addEventListener("click", (e) => { if (e.target === box) close(); });

  // Swipe left/right on touch screens.
  let startX = null;
  box.addEventListener("touchstart", (e) => { startX = e.touches[0].clientX; }, { passive: true });
  box.addEventListener("touchend", (e) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
    startX = null;
  });
})();
