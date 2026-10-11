/* ==========================================================================
   hero-meteors.js — Hero background: calm animated meteor shower on black
   --------------------------------------------------------------------------
   One <canvas class="hero__meteors"> behind the hero text (2D context).
   - Streaks fall top-left → bottom-right; each has a transparent tail, a
     coloured body and a bright head with a tiny glow.
   - Depth: "near" streaks are longer, thicker, brighter and faster; "far"
     ones are short, thin, dim and slow (parallax).
   - Tiny stars drift slowly and twinkle between the streaks.
   - Pauses when the tab is hidden or the hero is scrolled offscreen.
   - prefers-reduced-motion: draws ONE static frame, no animation.
   - No canvas / no JS: the CSS static gradient on .hero stays visible.
   Tune everything in CONFIG below. Independent of script.js / admin mode.
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------------
     CONFIG — all tunables. Ranges are [min, max]; for streaks, min = far,
     max = near. Sizes in CSS pixels, speeds in CSS pixels per second.
     ------------------------------------------------------------------------ */
  const CONFIG = {
    angleDeg: 37,               // fall angle, degrees below horizontal
    angleJitterDeg: 1.5,        // small per-streak variation (+/-)

    colors: ['#0a84ff', '#64d2ff', '#bf5af2'], // streak body colours
    headTint: 0.7,              // head = body colour mixed toward white (0..1)
    nearWhiteHead: '#f2fbff',   // used for "a few near-white heads"
    nearWhiteChance: 0.18,      // probability of a near-white head

    streaks: {
      desktop: [14, 22],        // count, scaled by hero area
      mobile: [6, 10],
      mobileMaxWidth: 767,      // px; at or below this width use the mobile range
      length: [70, 320],
      thickness: [0.6, 1.9],
      speed: [120, 520],
      alpha: [0.22, 0.9],
      depthBias: 1.8,           // > 1 = more far (small, dim) streaks than near ones
      respawnDelay: [0.2, 3.5], // seconds of quiet before an exited streak returns
    },

    glow: {
      radius: [3, 9],           // head glow radius, far → near
      alpha: 0.55,              // glow strength relative to the streak
    },

    stars: {
      desktop: [60, 120],       // count, scaled by hero area
      mobile: [30, 60],
      size: [0.5, 1.4],
      alpha: [0.12, 0.55],
      drift: [1.5, 6],          // slow drift along the fall direction
      twinkle: [0.3, 1.1],      // twinkle speed (radians per second)
      tints: ['#ffffff', '#cfe8ff', '#e6dcff'],
    },

    // Streaks are dimmed inside a centred ellipse so the hero text stays readable.
    textSafe: {
      rx: 0.42,                 // ellipse radius as a fraction of hero width
      ry: 0.36,                 // ... and of hero height
      minAlpha: 0.35,           // streak opacity multiplier at the centre
    },

    maxDpr: 2,                  // devicePixelRatio cap
    resizeDebounceMs: 150,
    maxDeltaSec: 0.05,          // clamp long frames (tab switches, jank)
  };

  // Hero area used to interpolate counts: [small, large] in CSS px².
  const AREA_DESKTOP = [768 * 600, 1920 * 1080];
  const AREA_MOBILE = [320 * 560, 767 * 1024];

  /* ------------------------------------------------------------------------
     Setup + feature detection (leave the CSS fallback in place on failure)
     ------------------------------------------------------------------------ */
  const hero = document.getElementById('hero');
  const canvas = hero && hero.querySelector('.hero__meteors');
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;

  hero.classList.add('hero--meteors');

  const motionQuery = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  let w = 0;
  let h = 0;
  let dpr = 1;
  let inView = true;
  let rafId = 0;
  let last = 0;
  let time = 0;

  const streaks = [];
  const stars = [];
  const spriteCache = new Map();

  /* ------------------------------------------------------------------------
     Helpers
     ------------------------------------------------------------------------ */
  const rand = (min, max) => min + Math.random() * (max - min);
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const pick = (list) => list[(Math.random() * list.length) | 0];

  function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgba(rgb, a) {
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  }

  function towardWhite(rgb, t) {
    return rgb.map((c) => Math.round(c + (255 - c) * t));
  }

  function countFor(range, areaRange) {
    const t = clamp01((w * h - areaRange[0]) / (areaRange[1] - areaRange[0]));
    return Math.round(lerp(range[0], range[1], t));
  }

  // Pre-rendered soft glow per head colour, so the per-frame cost is one drawImage.
  function glowSprite(rgb) {
    const key = rgb.join(',');
    let sprite = spriteCache.get(key);
    if (sprite) return sprite;
    const size = 32;
    sprite = document.createElement('canvas');
    sprite.width = sprite.height = size;
    const g = sprite.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, rgba(rgb, 1));
    grad.addColorStop(0.3, rgba(rgb, 0.35));
    grad.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    spriteCache.set(key, sprite);
    return sprite;
  }

  // 1 outside the text area, CONFIG.textSafe.minAlpha at the centre (smooth falloff).
  function textSafeFactor(x, y) {
    const cfg = CONFIG.textSafe;
    const nx = (x - w / 2) / (w * cfg.rx);
    const ny = (y - h / 2) / (h * cfg.ry);
    const t = clamp01((Math.sqrt(nx * nx + ny * ny) - 0.55) / 0.6);
    return cfg.minAlpha + (1 - cfg.minAlpha) * t * t * (3 - 2 * t);
  }

  /* ------------------------------------------------------------------------
     Streaks (objects are reused; gradients are built once per spawn and drawn
     in the streak's local, rotated space so they never need rebuilding per frame)
     ------------------------------------------------------------------------ */
  const PALETTE = CONFIG.colors.map(hexToRgb);
  const NEAR_WHITE = hexToRgb(CONFIG.nearWhiteHead);

  function spawnStreak(s, initial) {
    const cfg = CONFIG.streaks;
    const z = Math.pow(Math.random(), cfg.depthBias); // 0 = far, 1 = near

    s.len = lerp(cfg.length[0], cfg.length[1], z) * rand(0.85, 1.15);
    s.th = lerp(cfg.thickness[0], cfg.thickness[1], z);
    s.speed = lerp(cfg.speed[0], cfg.speed[1], z) * rand(0.9, 1.1);
    s.alpha = lerp(cfg.alpha[0], cfg.alpha[1], z);
    s.glowR = lerp(CONFIG.glow.radius[0], CONFIG.glow.radius[1], z);

    const angle = ((CONFIG.angleDeg + rand(-CONFIG.angleJitterDeg, CONFIG.angleJitterDeg)) * Math.PI) / 180;
    s.cos = Math.cos(angle);
    s.sin = Math.sin(angle);

    const body = pick(PALETTE);
    const head = Math.random() < CONFIG.nearWhiteChance ? NEAR_WHITE : towardWhite(body, CONFIG.headTint);

    // Local space: tail at (-len, 0), head at (0, 0).
    const grad = ctx.createLinearGradient(-s.len, 0, 0, 0);
    grad.addColorStop(0, rgba(body, 0));
    grad.addColorStop(0.55, rgba(body, 0.25));
    grad.addColorStop(0.88, rgba(body, 0.8));
    grad.addColorStop(1, rgba(head, 1));
    s.grad = grad;
    s.sprite = glowSprite(head);

    // Pick a point on screen; for respawns, walk it back along the path until
    // the head sits just outside the top/left edge.
    const px = rand(0, w);
    const py = rand(0, h);
    if (initial) {
      s.x = px;
      s.y = py;
      s.delay = 0;
    } else {
      const back = Math.min(px / s.cos, py / s.sin) + 8;
      s.x = px - s.cos * back;
      s.y = py - s.sin * back;
      s.delay = rand(cfg.respawnDelay[0], cfg.respawnDelay[1]);
    }
  }

  function buildStreaks() {
    const cfg = CONFIG.streaks;
    const mobile = w <= cfg.mobileMaxWidth;
    const n = countFor(mobile ? cfg.mobile : cfg.desktop, mobile ? AREA_MOBILE : AREA_DESKTOP);
    streaks.length = 0;
    for (let i = 0; i < n; i++) {
      const s = {};
      spawnStreak(s, true);
      streaks.push(s);
    }
  }

  /* ------------------------------------------------------------------------
     Stars (sorted by tint so fillStyle changes only a few times per frame)
     ------------------------------------------------------------------------ */
  function buildStars() {
    const cfg = CONFIG.stars;
    const mobile = w <= CONFIG.streaks.mobileMaxWidth;
    const n = countFor(mobile ? cfg.mobile : cfg.desktop, mobile ? AREA_MOBILE : AREA_DESKTOP);
    stars.length = 0;
    for (let i = 0; i < n; i++) {
      stars.push({
        x: rand(0, w),
        y: rand(0, h),
        size: rand(cfg.size[0], cfg.size[1]),
        alpha: rand(cfg.alpha[0], cfg.alpha[1]),
        drift: rand(cfg.drift[0], cfg.drift[1]),
        twinkle: rand(cfg.twinkle[0], cfg.twinkle[1]),
        phase: rand(0, Math.PI * 2),
        tint: pick(cfg.tints),
      });
    }
    stars.sort((a, b) => (a.tint < b.tint ? -1 : a.tint > b.tint ? 1 : 0));
  }

  /* ------------------------------------------------------------------------
     Simulation + rendering
     ------------------------------------------------------------------------ */
  const DRIFT_COS = Math.cos((CONFIG.angleDeg * Math.PI) / 180);
  const DRIFT_SIN = Math.sin((CONFIG.angleDeg * Math.PI) / 180);

  function step(dt) {
    for (let i = 0; i < streaks.length; i++) {
      const s = streaks[i];
      if (s.delay > 0) {
        s.delay -= dt;
        continue;
      }
      s.x += s.cos * s.speed * dt;
      s.y += s.sin * s.speed * dt;
      // Fully gone once the tail has crossed the right or bottom edge.
      if (s.x - s.cos * s.len > w || s.y - s.sin * s.len > h) spawnStreak(s, false);
    }

    for (let i = 0; i < stars.length; i++) {
      const st = stars[i];
      st.x += DRIFT_COS * st.drift * dt;
      st.y += DRIFT_SIN * st.drift * dt;
      if (st.x > w + 2) st.x -= w + 4;
      if (st.y > h + 2) st.y -= h + 4;
    }
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    // Tiny stars
    let tint = '';
    for (let i = 0; i < stars.length; i++) {
      const st = stars[i];
      if (st.tint !== tint) {
        tint = st.tint;
        ctx.fillStyle = tint;
      }
      ctx.globalAlpha = st.alpha * (0.55 + 0.45 * Math.sin(time * st.twinkle + st.phase));
      ctx.fillRect(st.x, st.y, st.size, st.size);
    }

    // Streaks + head glow (additive)
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < streaks.length; i++) {
      const s = streaks[i];
      if (s.delay > 0) continue;
      const a = s.alpha * textSafeFactor(s.x, s.y);

      ctx.setTransform(s.cos * dpr, s.sin * dpr, -s.sin * dpr, s.cos * dpr, s.x * dpr, s.y * dpr);
      ctx.globalAlpha = a;
      ctx.fillStyle = s.grad;
      ctx.beginPath();
      ctx.moveTo(-s.len, 0);
      ctx.lineTo(0, -s.th / 2);
      ctx.lineTo(0, s.th / 2);
      ctx.closePath();
      ctx.fill();

      ctx.globalAlpha = a * CONFIG.glow.alpha;
      ctx.drawImage(s.sprite, -s.glowR, -s.glowR, s.glowR * 2, s.glowR * 2);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------------
     Loop control: delta-time rAF, paused when hidden/offscreen/reduced motion
     ------------------------------------------------------------------------ */
  function reducedMotion() {
    return !!(motionQuery && motionQuery.matches);
  }

  function shouldRun() {
    return !reducedMotion() && !document.hidden && inView && w > 0 && h > 0;
  }

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    const dt = last ? Math.min((now - last) / 1000, CONFIG.maxDeltaSec) : 0;
    last = now;
    time += dt;
    step(dt);
    draw();
  }

  function start() {
    if (rafId || !shouldRun()) return;
    last = 0; // first frame after a pause has dt = 0, so nothing jumps
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    if (!rafId) return;
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function update() {
    if (shouldRun()) start();
    else stop();
  }

  /* ------------------------------------------------------------------------
     Sizing (debounced) — rebuilds the scene and always paints one frame, which
     is also the single static frame used under prefers-reduced-motion
     ------------------------------------------------------------------------ */
  function resize() {
    const nw = hero.clientWidth;
    const nh = hero.clientHeight;
    const ndpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxDpr);
    if (nw === w && nh === h && ndpr === dpr) return;
    w = nw;
    h = nh;
    dpr = ndpr;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    buildStars();
    buildStreaks();
    draw();
    update();
  }

  let resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, CONFIG.resizeDebounceMs);
  }

  resize();
  window.addEventListener('resize', onResize, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(hero);

  document.addEventListener('visibilitychange', update);

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      inView = entries[entries.length - 1].isIntersecting;
      update();
    }).observe(hero);
  }

  if (motionQuery) {
    const onMotionChange = () => {
      if (reducedMotion()) {
        stop();
        draw(); // freeze on a single static frame
      } else {
        update();
      }
    };
    if (motionQuery.addEventListener) motionQuery.addEventListener('change', onMotionChange);
    else if (motionQuery.addListener) motionQuery.addListener(onMotionChange);
  }
})();
