/**
 * 导出 HTML 内的演示运行时（纯浏览器脚本，无 import/export）
 * ------------------------------------------------------------------
 * 会被 server/export.js 原样内联进 <script type="module">，
 * 与服务端渲染好的 slide 结构配合，提供：
 * 键盘翻页 / 点击翻页 / 触摸滑动 / 全屏 / 总览 / 主题切换 / 讲者备注 / 打印 PDF
 */
(() => {
  const deckEl = document.getElementById('deck');
  const stage = document.getElementById('stage');
  const viewport = document.getElementById('viewport');
  const bar = document.getElementById('progress-bar');
  const counter = document.getElementById('page-counter');
  const overview = document.getElementById('overview');
  const overviewGrid = document.getElementById('overview-grid');
  const themeBar = document.getElementById('theme-bar');
  if (!deckEl || !stage) return;

  const slides = Array.from(stage.querySelectorAll('.slide'));
  if (!slides.length) return;

  const store = {
    get(key, fallback) {
      try {
        const v = window.localStorage.getItem(key);
        return v === null ? fallback : v;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* file:// 下可能被禁用，忽略 */
      }
    },
  };

  const total = slides.length;
  let index = 0;

  const parseHash = () => {
    const m = String(location.hash || '').match(/(\d+)/);
    if (!m) return 0;
    return Math.min(total, Math.max(1, Number(m[1]))) - 1;
  };

  const render = (next, options = {}) => {
    index = Math.min(total - 1, Math.max(0, next));
    slides.forEach((slide, i) => {
      const active = i === index;
      slide.classList.toggle('is-active', active);
      slide.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    if (bar) bar.style.width = `${((index + 1) / total) * 100}%`;
    if (counter) counter.textContent = `${index + 1} / ${total}`;
    if (overviewGrid) {
      Array.from(overviewGrid.children).forEach((el, i) => el.classList.toggle('is-active', i === index));
    }
    if (!options.silent) {
      try {
        history.replaceState(null, '', `#/${index + 1}`);
      } catch {
        /* 某些环境（file://）可能不允许，忽略 */
      }
    }
  };

  const go = (delta) => render(index + delta);
  const goTo = (i) => render(i);
  const toggleFullscreen = () => {
    const target = viewport || stage;
    if (!document.fullscreenElement) {
      (target.requestFullscreen ? target.requestFullscreen() : Promise.reject()).catch(() => {
        document.documentElement.classList.toggle('is-pseudo-fullscreen');
      });
    } else {
      document.exitFullscreen();
    }
  };

  const buildOverview = () => {
    if (!overviewGrid) return;
    if (overviewGrid.childElementCount) return;
    slides.forEach((slide, i) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'deck__thumb';
      item.setAttribute('aria-label', `跳到第 ${i + 1} 页`);
      const inner = document.createElement('div');
      inner.className = 'deck__thumb-stage';
      const clone = slide.cloneNode(true);
      clone.classList.add('is-active');
      inner.appendChild(clone);
      const label = document.createElement('span');
      label.className = 'deck__thumb-label';
      label.textContent = `${i + 1}`;
      item.appendChild(inner);
      item.appendChild(label);
      item.addEventListener('click', () => {
        goTo(i);
        toggleOverview(false);
      });
      overviewGrid.appendChild(item);
    });
    render(index, { silent: true });
  };

  const toggleOverview = (force) => {
    if (!overview) return;
    const show = force === undefined ? overview.hidden : force;
    if (show) buildOverview();
    overview.hidden = !show;
    deckEl.classList.toggle('is-overview', show);
  };

  const setTheme = (id) => {
    document.body.setAttribute('data-theme', id);
    store.set('ppt-theme', id);
    if (themeBar) {
      Array.from(themeBar.querySelectorAll('[data-theme-id]')).forEach((btn) => {
        btn.classList.toggle('is-active', btn.getAttribute('data-theme-id') === id);
      });
    }
  };

  const cycleTheme = () => {
    const ids = THEMES.map((t) => t.id);
    const current = document.body.getAttribute('data-theme') || ids[0];
    const next = ids[(ids.indexOf(current) + 1) % ids.length];
    setTheme(next);
  };

  const toggleNotes = () => {
    document.body.classList.toggle('show-notes');
    store.set('ppt-notes', document.body.classList.contains('show-notes') ? '1' : '0');
  };

  const printDeck = () => {
    deckEl.setAttribute('data-mode', 'flow');
    document.body.classList.add('is-print');
    const cleanup = () => {
      deckEl.removeAttribute('data-mode');
      document.body.classList.remove('is-print');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.setTimeout(() => {
      window.print();
      window.setTimeout(cleanup, 800);
    }, 120);
  };

  // ------------------------------ 事件绑定 ------------------------------
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    const key = event.key;
    const lower = key.toLowerCase();
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(key)) {
      event.preventDefault();
      go(1);
    } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(key)) {
      event.preventDefault();
      go(-1);
    } else if (key === 'Home') {
      event.preventDefault();
      goTo(0);
    } else if (key === 'End') {
      event.preventDefault();
      goTo(total - 1);
    } else if (lower === 'f') {
      toggleFullscreen();
    } else if (lower === 'o') {
      toggleOverview();
    } else if (lower === 't') {
      cycleTheme();
    } else if (lower === 'n') {
      toggleNotes();
    } else if (lower === 'p') {
      printDeck();
    } else if (key === 'Escape') {
      toggleOverview(false);
    } else if (/^[1-9]$/.test(key)) {
      goTo(Number(key) - 1);
    }
  });

  document.querySelectorAll('[data-action]').forEach((el) => {
    el.addEventListener('click', (event) => {
      event.preventDefault();
      const action = el.getAttribute('data-action');
      if (action === 'prev') go(-1);
      else if (action === 'next') go(1);
      else if (action === 'fullscreen') toggleFullscreen();
      else if (action === 'overview') toggleOverview();
      else if (action === 'theme') cycleTheme();
      else if (action === 'notes') toggleNotes();
      else if (action === 'print') printDeck();
    });
  });

  // 点击舞台：左 20% 上一页，其余下一页
  stage.addEventListener('click', (event) => {
    const rect = stage.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / Math.max(1, rect.width);
    go(ratio < 0.2 ? -1 : 1);
  });

  // 触摸滑动
  let touchStartX = 0;
  let touchStartY = 0;
  stage.addEventListener(
    'touchstart',
    (event) => {
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
    },
    { passive: true },
  );
  stage.addEventListener(
    'touchend',
    (event) => {
      const dx = event.changedTouches[0].clientX - touchStartX;
      const dy = event.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    },
    { passive: true },
  );

  // 鼠标滚轮（节流）
  let wheelLock = 0;
  stage.addEventListener(
    'wheel',
    (event) => {
      const now = Date.now();
      if (now - wheelLock < 700) return;
      if (Math.abs(event.deltaY) < 12) return;
      wheelLock = now;
      go(event.deltaY > 0 ? 1 : -1);
    },
    { passive: true },
  );

  window.addEventListener('hashchange', () => {
    const target = parseHash();
    if (target !== index) render(target, { silent: true });
  });

  // 空闲时淡化控制条
  let idleTimer = 0;
  const wake = () => {
    deckEl.classList.remove('is-idle');
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => deckEl.classList.add('is-idle'), 3200);
  };
  ['mousemove', 'touchstart', 'keydown'].forEach((evt) => window.addEventListener(evt, wake, { passive: true }));

  if (themeBar) {
    THEMES.forEach((theme) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'deck__theme-dot';
      btn.setAttribute('data-theme-id', theme.id);
      btn.setAttribute('title', `${theme.name} · ${theme.desc}`);
      btn.setAttribute('aria-label', `切换到主题 ${theme.name}`);
      btn.style.setProperty('--dot', theme.accent);
      btn.style.setProperty('--dot-bg', theme.bg);
      btn.addEventListener('click', () => setTheme(theme.id));
      themeBar.appendChild(btn);
    });
  }

  if (store.get('ppt-notes', '0') === '1') document.body.classList.add('show-notes');
  setTheme(store.get('ppt-theme', document.body.getAttribute('data-theme') || THEMES[0].id));

  document.title = DECK.title ? `${DECK.title} · 演示` : document.title;

  render(parseHash(), { silent: true });
  wake();
})();
