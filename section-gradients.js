/* ==========================================================================
   section-gradients.js — animated gradient backgrounds for every non-hero section
   --------------------------------------------------------------------------
   DARK  "Bloom Field" (21st.dev) on .section--dark
   LIGHT "Pipo"        (21st.dev) on .section--light / .section--white

   How it works
   • The look lives in style.css §18. Each section has one decorative layer
     <div class="section-gradient" aria-hidden="true">; this file only moves the
     blob centres by writing offset custom properties (--b1dx, --b1dy, …) on it.
     All offsets are 0 at ph = 0, so the static CSS is exactly the first frame:
     no snap when motion starts, and no-JS / reduced-motion shows the same design.
   • Motion (per blob i, static phases p, p2):
       ph   = t * speed            spin = ph * dir
       dx   = (sin(spin * 0.55 + p)  - sin(p))  * 14 * amt * U   (% of width)
       dy   = (sin(spin * 0.43 + p2) - sin(p2)) * 14 * amt * U   (% of height)
     p / p2 are a fixed golden-ratio hash of the blob index, computed ONCE.
     Nothing is rounded or quantised; the grain layer is never touched.
   • Theme comes from the section's class, so sections re-striped by script.js
     (data-theme="auto") and sections added later get the right gradient.
     data-gradient="none" on a section opts it out.
   • Performance: one shared requestAnimationFrame loop, ~30 fps (20 fps on
     small screens), only sections in the viewport (IntersectionObserver), paused
     while the tab is hidden; no per-frame object allocation.
   • prefers-reduced-motion: the loop never starts (static frame at ph = 0).
   ========================================================================== */
(() => {
  'use strict';

  /* ------------------------------------------------------------------------
     CONFIG — tune here
     ------------------------------------------------------------------------ */
  const CONFIG = {
    U: 0.25,                 // unit scale: 1 unit = 0.25% of the layer width (x) / height (y)
    fps: 30,                 // update cap on larger screens
    fpsSmall: 20,            // update cap on small screens
    smallScreen: '(max-width: 733px)',
    rootMargin: '120px 0px', // start animating a little before a section scrolls in
    sections: 'main > section:not(.hero)',
    themes: {
      // speed: ph = t * speed · amt: movement amount · dir: 1 or -1 (direction)
      dark:  { speed: 0.77, amt: 1.00, dir: 1, blobs: 4 }, // Bloom Field
      light: { speed: 0.86, amt: 0.72, dir: 1, blobs: 3 }  // Pipo (grain layer excluded)
    }
  };

  const MAX_BLOBS = 4;
  const TAU = Math.PI * 2;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const smallScreen = window.matchMedia(CONFIG.smallScreen);

  /* Static per-blob phases: additive-recurrence (golden ratio) hash of the index.
     Computed once — never animated, no fract(sin(x) * 43758) style hash. */
  const fract = (x) => x - Math.floor(x);
  const PHASE_X = new Float64Array(MAX_BLOBS);
  const PHASE_Y = new Float64Array(MAX_BLOBS);
  const SIN_PX = new Float64Array(MAX_BLOBS);
  const SIN_PY = new Float64Array(MAX_BLOBS);
  const PROP_X = [];
  const PROP_Y = [];
  for (let i = 0; i < MAX_BLOBS; i++) {
    PHASE_X[i] = fract((i + 1) * 0.6180339887498949) * TAU;
    PHASE_Y[i] = fract((i + 1) * 0.7548776662466927 + 0.5) * TAU;
    SIN_PX[i] = Math.sin(PHASE_X[i]);
    SIN_PY[i] = Math.sin(PHASE_Y[i]);
    PROP_X.push(`--b${i + 1}dx`);
    PROP_Y.push(`--b${i + 1}dy`);
  }

  /** One entry per section: { section, layer, theme (CONFIG.themes.* or null), inView } */
  const states = [];
  const bySection = new Map();
  let active = [];          // states currently in view with a theme (reused array)
  let rafId = 0;
  let lastNow = 0;          // timestamp of the last rendered frame (0 = loop just (re)started)
  let t = 0;                // elapsed animation seconds (survives pauses, so no jump on resume)

  /* ------------------------------------------------------------------------
     Theme + layer setup
     ------------------------------------------------------------------------ */
  function themeOf(section) {
    if (section.dataset.gradient === 'none') return null;
    const list = section.classList;
    if (list.contains('section--dark')) return CONFIG.themes.dark;
    if (list.contains('section--light') || list.contains('section--white')) return CONFIG.themes.light;
    return null;
  }

  function clearOffsets(layer) {
    for (let i = 0; i < MAX_BLOBS; i++) {
      layer.style.removeProperty(PROP_X[i]);
      layer.style.removeProperty(PROP_Y[i]);
    }
  }

  function setup(section) {
    if (states.some((s) => s.section === section)) return;
    let layer = section.querySelector(':scope > .section-gradient');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'section-gradient';
      layer.setAttribute('aria-hidden', 'true');
      section.prepend(layer);
    }
    const state = { section, layer, theme: themeOf(section), inView: !io };
    states.push(state);
    bySection.set(section, state);
    if (io) io.observe(section);
    classObserver.observe(section, { attributes: true, attributeFilter: ['class', 'data-gradient'] });
  }

  /* ------------------------------------------------------------------------
     Rendering
     ------------------------------------------------------------------------ */
  function renderState(state) {
    const theme = state.theme;
    const spin = t * theme.speed * theme.dir;     // ph * dir
    const k = 14 * theme.amt * CONFIG.U;
    const style = state.layer.style;
    for (let i = 0; i < theme.blobs; i++) {
      const dx = (Math.sin(spin * 0.55 + PHASE_X[i]) - SIN_PX[i]) * k;
      const dy = (Math.sin(spin * 0.43 + PHASE_Y[i]) - SIN_PY[i]) * k;
      style.setProperty(PROP_X[i], dx + '%');
      style.setProperty(PROP_Y[i], dy + '%');
    }
  }

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (lastNow === 0) {             // first frame after (re)start: keep t, no catch-up jump
      lastNow = now;
      return;
    }
    const interval = 1000 / (smallScreen.matches ? CONFIG.fpsSmall : CONFIG.fps);
    const elapsed = now - lastNow;
    if (elapsed < interval - 2) return; // ~30 fps cap (2ms tolerance for 60/120 Hz jitter)
    lastNow = now;
    t += Math.min(elapsed, 100) / 1000; // clamp long frames (e.g. a stalled tab)
    for (let i = 0; i < active.length; i++) renderState(active[i]);
  }

  /* ------------------------------------------------------------------------
     Start / stop
     ------------------------------------------------------------------------ */
  function refresh() {
    active.length = 0;
    for (let i = 0; i < states.length; i++) {
      if (states[i].inView && states[i].theme) active.push(states[i]);
    }
    const shouldRun = !reducedMotion.matches && !document.hidden && active.length > 0;
    if (shouldRun && !rafId) {
      lastNow = 0;
      rafId = requestAnimationFrame(frame);
    } else if (!shouldRun && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function onThemeChange(state) {
    const theme = themeOf(state.section);
    if (theme === state.theme) return;
    state.theme = theme;
    clearOffsets(state.layer);            // unused blob vars (dark has 4, light 3) go back to 0
    if (theme && !reducedMotion.matches) renderState(state);
  }

  function onReducedMotionChange() {
    if (reducedMotion.matches) {
      t = 0;                              // static frame at ph = 0 = the base CSS
      states.forEach((s) => clearOffsets(s.layer));
    }
    refresh();
  }

  /* ------------------------------------------------------------------------
     Observers + boot
     ------------------------------------------------------------------------ */
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const state = bySection.get(entry.target);
          if (!state) continue;
          // Entering: bring the layer to the current t right away (it was frozen while offscreen)
          if (entry.isIntersecting && !state.inView && state.theme && !reducedMotion.matches && t > 0) renderState(state);
          state.inView = entry.isIntersecting;
        }
        refresh();
      }, { rootMargin: CONFIG.rootMargin })
    : null;

  const classObserver = new MutationObserver((records) => {
    for (const record of records) {
      const state = bySection.get(record.target);
      if (state) onThemeChange(state);
    }
    refresh();
  });

  function scan() {
    document.querySelectorAll(CONFIG.sections).forEach(setup);
    refresh();
  }

  function boot() {
    scan();

    // Sections inserted later (by script or edits) get a layer automatically
    const main = document.querySelector('main');
    if (main) {
      new MutationObserver((records) => {
        if (records.some((r) => r.addedNodes.length)) scan();
      }).observe(main, { childList: true });
    }

    document.addEventListener('visibilitychange', refresh);
    reducedMotion.addEventListener?.('change', onReducedMotionChange);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
