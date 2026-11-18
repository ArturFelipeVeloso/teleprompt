(() => {
  const $ = id => document.getElementById(id);
  const KEY_CFG = 'tp.cfg', KEY_TXT = 'tp.text';

  const DEFAULTS = {
    speed: 60, countdown: 3, easing: 1, loop: false, autoStop: true, wheel: true,
    font: 'system-ui, sans-serif', size: 64, lineHeight: 1.5, letterSpacing: 0, paraGap: 1,
    weight: '600', align: 'center', upper: false,
    color: '#ffffff', bg: '#000000', cueColor: '#ffd34e', guideColor: '#ff4040',
    dim: false, dimAmount: 0.7,
    width: 80, padV: 40, guidePos: 40, guide: true, guideArrows: true,
    progress: true, clock: false, showControls: false,
    flipX: false, flipY: false
  };
  const UNITS = { speed: ' px/s', countdown: 's', size: 'px', width: '%', padV: 'vh', guidePos: '%', dimAmount: '' };

  let cfg = { ...DEFAULTS };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY_CFG) || '{}')); } catch {}

  const save = () => { try { localStorage.setItem(KEY_CFG, JSON.stringify(cfg)); } catch {} };

  /* ---------- settings binding ---------- */
  const inputs = Object.keys(DEFAULTS).map(k => [k, $(k)]).filter(([, el]) => el);

  function syncInputs() {
    for (const [k, el] of inputs) {
      if (el.type === 'checkbox') el.checked = !!cfg[k]; else el.value = cfg[k];
      const out = document.querySelector(`output[data-for="${k}"]`);
      if (out) out.textContent = cfg[k] + (UNITS[k] ?? '');
    }
  }
  for (const [k, el] of inputs) {
    el.addEventListener('input', () => {
      cfg[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? parseFloat(el.value) : el.value;
      const out = document.querySelector(`output[data-for="${k}"]`);
      if (out) out.textContent = cfg[k] + (UNITS[k] ?? '');
      save(); applyStyle();
    });
  }

  /* ---------- text ---------- */
  const text = $('text');
  try { text.value = localStorage.getItem(KEY_TXT) ?? ''; } catch {}
  function updateStats() {
    const words = (text.value.replace(/\/\/.*$/gm, '').match(/\S+/g) || []).length;
    const secs = Math.round(words / 2.5); // ~150 wpm
    $('stats').textContent = `${words} palavras · leitura ~${Math.floor(secs / 60)}min ${secs % 60}s (150 ppm)`;
  }
  text.addEventListener('input', () => { try { localStorage.setItem(KEY_TXT, text.value); } catch {} updateStats(); });
  $('clear').onclick = () => { if (!text.value || confirm('Apagar o roteiro?')) { text.value = ''; text.dispatchEvent(new Event('input')); } };
  $('file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    text.value = await f.text(); text.dispatchEvent(new Event('input')); e.target.value = '';
  };

  /* ---------- profile ---------- */
  $('export').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' }));
    a.download = 'teleprompter-config.json'; a.click(); URL.revokeObjectURL(a.href);
  };
  $('importCfg').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { Object.assign(cfg, DEFAULTS, JSON.parse(await f.text())); save(); syncInputs(); applyStyle(); }
    catch { alert('Arquivo inválido'); }
    e.target.value = '';
  };
  $('reset').onclick = () => { cfg = { ...DEFAULTS }; save(); syncInputs(); applyStyle(); };

  /* ---------- prompter ---------- */
  const prompter = $('prompter'), viewport = $('viewport'), scroller = $('scroller'),
        content = $('content'), guideLine = $('guideLine');
  let pos = 0, vel = 0, playing = false, last = 0, raf = 0, maxPos = 0, cdTimer = 0, active = false, ctrlTimer = 0;

  function applyStyle() {
    const s = prompter.style;
    s.setProperty('--bg', cfg.bg); s.setProperty('--color', cfg.color); s.setProperty('--cue', cfg.cueColor);
    s.setProperty('--guide', cfg.guideColor); s.setProperty('--font', cfg.font);
    s.setProperty('--size', cfg.size + 'px'); s.setProperty('--lh', cfg.lineHeight);
    s.setProperty('--ls', cfg.letterSpacing + 'px'); s.setProperty('--weight', cfg.weight);
    s.setProperty('--align', cfg.align); s.setProperty('--width', cfg.width + '%');
    s.setProperty('--padV', cfg.padV + 'vh'); s.setProperty('--gap', cfg.paraGap + 'em');
    s.setProperty('--guidePos', cfg.guidePos + '%'); s.setProperty('--dimOpacity', 1 - cfg.dimAmount);
    content.classList.toggle('upper', cfg.upper);
    content.classList.toggle('dim', cfg.dim);
    viewport.classList.toggle('flipX', cfg.flipX);
    viewport.classList.toggle('flipY', cfg.flipY);
    guideLine.classList.toggle('off', !cfg.guide);
    guideLine.classList.toggle('arrows', cfg.guideArrows);
    $('progressBar').classList.toggle('off', !cfg.progress);
    $('clockBox').classList.toggle('on', cfg.clock);
    $('speedLbl').textContent = Math.round(cfg.speed) + ' px/s';
    if (active) { measure(); render(); }
  }

  function buildContent() {
    content.innerHTML = '';
    const lines = text.value.split('\n').filter(l => !l.trim().startsWith('//'));
    for (const raw of lines) {
      const p = document.createElement('p');
      if (!raw.trim()) { p.className = 'blank'; content.appendChild(p); continue; }
      // [cue] highlight, safe via DOM nodes
      raw.split(/(\[[^\]]*\])/).forEach(part => {
        if (!part) return;
        if (/^\[[^\]]*\]$/.test(part)) { const s = document.createElement('span'); s.className = 'cue'; s.textContent = part; p.appendChild(s); }
        else p.appendChild(document.createTextNode(part));
      });
      content.appendChild(p);
    }
  }

  function measure() { maxPos = Math.max(0, scroller.offsetHeight - viewport.clientHeight); }

  function render() {
    pos = Math.max(0, Math.min(pos, maxPos));
    scroller.style.transform = `translate3d(0,${-pos}px,0)`;
    $('progressBar').firstElementChild.style.width = (maxPos ? pos / maxPos * 100 : 0) + '%';
    const remain = cfg.speed > 0 ? Math.max(0, (maxPos - pos) / cfg.speed) : 0;
    $('clockBox').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) +
      '  ·  -' + Math.floor(remain / 60) + ':' + String(Math.floor(remain % 60)).padStart(2, '0');
    if (cfg.dim) updateActive();
  }

  let lastActive = null;
  function updateActive() {
    const y = pos + viewport.clientHeight * cfg.guidePos / 100 - parseFloat(getComputedStyle(content).paddingTop);
    let found = null;
    for (const p of content.children) {
      if (p.offsetTop <= y + content.offsetTop - content.offsetTop && p.offsetTop + p.offsetHeight > y) { found = p; break; }
    }
    if (found !== lastActive) { lastActive?.classList.remove('active'); found?.classList.add('active'); lastActive = found; }
  }

  function tick(t) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    const target = playing ? cfg.speed : 0;
    // easing: 0 = instant, higher = slower ramp
    if (cfg.easing <= 0) vel = target; else vel += (target - vel) * Math.min(1, dt * (6 / cfg.easing));
    if (Math.abs(vel) < 0.05 && !playing) vel = 0;
    if (vel) {
      pos += vel * dt;
      if (pos >= maxPos) {
        if (cfg.loop) pos = 0;
        else if (cfg.autoStop) { pos = maxPos; setPlaying(false); }
      }
    }
    render();
  }

  function setPlaying(v) {
    playing = v; $('bPlay').textContent = v ? '⏸' : '▶';
  }

  function toggle() {
    if (cdTimer) { cancelCountdown(); return; }
    if (playing) { setPlaying(false); return; }
    if (pos >= maxPos && maxPos > 0) pos = 0;
    if (cfg.countdown > 0 && pos === 0) startCountdown(); else setPlaying(true);
  }

  function startCountdown() {
    let n = cfg.countdown; const box = $('countdownBox'); box.hidden = false; box.textContent = n;
    cdTimer = setInterval(() => {
      n--; if (n <= 0) { cancelCountdown(); setPlaying(true); } else box.textContent = n;
    }, 1000);
  }
  function cancelCountdown() { clearInterval(cdTimer); cdTimer = 0; $('countdownBox').hidden = true; }

  function open() {
    if (!text.value.trim()) { text.focus(); return; }
    buildContent(); active = true; prompter.hidden = false; $('editor').hidden = true;
    pos = 0; vel = 0; lastActive = null; applyStyle(); measure(); render(); setPlaying(false);
    last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
    flashControls();
  }
  function close() {
    cancelCountdown(); setPlaying(false); active = false; cancelAnimationFrame(raf);
    prompter.hidden = true; $('editor').hidden = false;
    if (document.fullscreenElement) document.exitFullscreen();
  }

  function flashControls() {
    const c = $('controls'); c.classList.remove('hide'); viewport.classList.add('showCursor');
    clearTimeout(ctrlTimer);
    if (!cfg.showControls) ctrlTimer = setTimeout(() => { if (playing) { c.classList.add('hide'); viewport.classList.remove('showCursor'); } }, 2500);
  }

  const setSpeed = v => { cfg.speed = Math.max(5, Math.min(400, v)); save(); syncInputs(); applyStyle(); };
  const setSize = v => { cfg.size = Math.max(16, Math.min(260, v)); save(); syncInputs(); applyStyle(); };
  const jump = px => { pos += px; render(); };
  const toggleFull = () => document.fullscreenElement ? document.exitFullscreen() : prompter.requestFullscreen?.();
  const flip = k => { cfg[k] = !cfg[k]; save(); syncInputs(); applyStyle(); };

  $('start').onclick = open;
  $('bBack').onclick = close;
  $('bPlay').onclick = toggle;
  $('bRestart').onclick = () => { pos = 0; render(); };
  $('bRew').onclick = () => jump(-cfg.speed * 5);
  $('bFwd').onclick = () => jump(cfg.speed * 5);
  $('bSlow').onclick = () => setSpeed(cfg.speed - 5);
  $('bFast').onclick = () => setSpeed(cfg.speed + 5);
  $('bSmall').onclick = () => setSize(cfg.size - 4);
  $('bBig').onclick = () => setSize(cfg.size + 4);
  $('bMirror').onclick = () => flip('flipX');
  $('bFull').onclick = toggleFull;

  viewport.addEventListener('mousemove', flashControls);
  viewport.addEventListener('click', e => { if (!e.target.closest('#controls')) toggle(); flashControls(); });
  viewport.addEventListener('wheel', e => {
    if (!active) return; e.preventDefault();
    if (cfg.wheel && playing) setSpeed(cfg.speed - Math.sign(e.deltaY) * 5); else jump(e.deltaY);
  }, { passive: false });
  // touch drag
  let ty = null;
  viewport.addEventListener('touchstart', e => { ty = e.touches[0].clientY; }, { passive: true });
  viewport.addEventListener('touchmove', e => { if (ty == null) return; const y = e.touches[0].clientY; jump((ty - y) * (cfg.flipY ? -1 : 1)); ty = y; }, { passive: true });
  viewport.addEventListener('touchend', () => { ty = null; });
  window.addEventListener('resize', () => { if (active) { measure(); render(); } });

  document.addEventListener('keydown', e => {
    if (!active) return;
    const k = e.key;
    const map = {
      ' ': toggle, ArrowUp: () => setSpeed(cfg.speed + 5), ArrowDown: () => setSpeed(cfg.speed - 5),
      '+': () => setSize(cfg.size + 4), '=': () => setSize(cfg.size + 4), '-': () => setSize(cfg.size - 4),
      ArrowLeft: () => jump(-cfg.speed * 5), ArrowRight: () => jump(cfg.speed * 5),
      PageUp: () => jump(-viewport.clientHeight * 0.8), PageDown: () => jump(viewport.clientHeight * 0.8),
      Home: () => { pos = 0; render(); }, r: () => { pos = 0; render(); }, R: () => { pos = 0; render(); },
      m: () => flip('flipX'), M: () => flip('flipX'), v: () => flip('flipY'), V: () => flip('flipY'),
      g: () => flip('guide'), G: () => flip('guide'),
      c: () => flip('showControls'), C: () => flip('showControls'),
      f: toggleFull, F: toggleFull, Escape: () => { if (!document.fullscreenElement) close(); }
    };
    if (map[k]) { e.preventDefault(); map[k](); flashControls(); }
  });

  syncInputs(); applyStyle(); updateStats();
})();
