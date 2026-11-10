export const PANE_STORAGE_KEY = 'notes-pane-layout-v1';
const SIDEBAR_MIN = 72;
const SIDEBAR_MAX = 420;
const MOBILE_WIDTH = 720;

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function panePreferences(raw) {
  if (!raw || raw.version !== 1) return {version:1, sidebarWidth:null, headerHeight:null};
  return {
    version:1,
    sidebarWidth:Number.isFinite(raw.sidebarWidth) ? clamp(raw.sidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX) : null,
    headerHeight:Number.isFinite(raw.headerHeight) && raw.headerHeight > 0 ? Math.min(raw.headerHeight, 2000) : null,
  };
}

export function sidebarBounds(viewportWidth) {
  return {min:SIDEBAR_MIN, max:Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, viewportWidth - 480 - 8))};
}

export function headerBounds(workspaceHeight, contentHeight) {
  const min = Math.ceil(contentHeight);
  return {min, max:Math.max(min, Math.min(360, workspaceHeight - 280 - 8))};
}

export function installPaneLayout({initialPreferences = null, persistPreference = () => {}} = {}) {
  const sidebar = document.querySelector('.sidebar');
  const sidebarGrip = document.querySelector('#sidebar-splitter');
  const preferences = panePreferences(initialPreferences);
  let headingBinding = null;
  let cancelDrag = null;

  function persist() {
    persistPreference(PANE_STORAGE_KEY, JSON.stringify(preferences));
  }

  function refreshSidebarLabels() {
    sidebar.querySelectorAll('button, .brand').forEach(button => {
      if (!button.getAttribute('aria-label')) {
        const label = button.querySelector('.topic-name')?.textContent ||
          [...button.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim() ||
          (button.classList.contains('brand') ? '笔记主页' : button.textContent.trim());
        button.setAttribute('aria-label', label);
      }
      button.title = button.getAttribute('aria-label');
    });
  }

  function applySidebar() {
    const mobile = window.innerWidth <= MOBILE_WIDTH;
    const bounds = sidebarBounds(window.innerWidth);
    const fallback = window.innerWidth <= 900 ? 190 : window.innerWidth <= 1150 ? 202 : 226;
    const width = clamp(preferences.sidebarWidth ?? fallback, bounds.min, bounds.max);
    sidebar.style.setProperty('--notes-sidebar-width', `${width}px`);
    sidebar.classList.toggle('is-compact-sidebar', !mobile && width < 160);
    sidebarGrip.tabIndex = mobile ? -1 : 0;
    sidebarGrip.setAttribute('aria-valuemin', bounds.min);
    sidebarGrip.setAttribute('aria-valuemax', bounds.max);
    sidebarGrip.setAttribute('aria-valuenow', Math.round(width));
    refreshSidebarLabels();
  }

  function bindGrip(grip, field, axis, currentValue, getBounds, apply, signal) {
    let drag = null;
    const coordinate = event => axis === 'x' ? event.clientX : event.clientY;
    function finish(commit) {
      if (!drag) return;
      const previous = drag;
      drag = null;
      cancelDrag = null;
      if (!commit) { preferences[field] = previous.preference; apply(); }
      else persist();
      grip.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing-panes', `is-resizing-${axis}`);
      if (grip.hasPointerCapture(previous.pointerId)) grip.releasePointerCapture(previous.pointerId);
    }
    grip.addEventListener('pointerdown', event => {
      if (event.button !== 0 || grip.tabIndex < 0) return;
      cancelDrag?.();
      event.preventDefault();
      grip.focus({preventScroll:true});
      drag = {pointerId:event.pointerId, start:coordinate(event), value:currentValue(), preference:preferences[field]};
      cancelDrag = () => finish(false);
      grip.setPointerCapture(event.pointerId);
      grip.classList.add('is-dragging');
      document.body.classList.add('is-resizing-panes', `is-resizing-${axis}`);
    }, {signal});
    grip.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const bounds = getBounds();
      preferences[field] = clamp(drag.value + coordinate(event) - drag.start, bounds.min, bounds.max);
      apply();
    }, {signal});
    grip.addEventListener('pointerup', event => {
      if (event.pointerId === drag?.pointerId) finish(true);
    }, {signal});
    grip.addEventListener('pointercancel', () => finish(false), {signal});
    grip.addEventListener('lostpointercapture', () => finish(false), {signal});
    grip.addEventListener('dblclick', () => {
      finish(false); preferences[field] = null; apply(); persist();
    }, {signal});
    grip.addEventListener('keydown', event => {
      if (event.key === 'Escape' && drag) { event.preventDefault(); finish(false); return; }
      const negative = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
      const positive = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
      if (![negative, positive, 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      finish(false);
      const bounds = getBounds();
      const value = event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max :
        currentValue() + (event.key === negative ? -1 : 1) * (event.shiftKey ? 32 : 16);
      preferences[field] = clamp(value, bounds.min, bounds.max);
      apply(); persist();
    }, {signal});
    return () => finish(false);
  }

  const sidebarController = new AbortController();
  bindGrip(sidebarGrip, 'sidebarWidth', 'x', () => sidebar.getBoundingClientRect().width,
    () => sidebarBounds(window.innerWidth), applySidebar, sidebarController.signal);

  function detachTopic() {
    headingBinding?.dispose();
    headingBinding = null;
  }

  function bindTopic(workspace) {
    detachTopic();
    const heading = workspace.querySelector('.topic-heading');
    const grip = workspace.querySelector('#topic-splitter');
    const controller = new AbortController();
    function bounds() {
      const compact = heading.classList.contains('is-compact-heading');
      heading.classList.add('is-compact-heading');
      const contentHeight = [...heading.children].reduce((height, child) => height + child.getBoundingClientRect().height, 0);
      heading.classList.toggle('is-compact-heading', compact);
      return headerBounds(workspace.getBoundingClientRect().height, contentHeight);
    }
    function applyHeading() {
      const range = bounds();
      heading.classList.toggle('is-compact-heading', preferences.headerHeight !== null);
      if (preferences.headerHeight === null) heading.style.removeProperty('--notes-topic-header-height');
      else heading.style.setProperty('--notes-topic-header-height', `${clamp(preferences.headerHeight, range.min, range.max)}px`);
      grip.setAttribute('aria-valuemin', range.min);
      grip.setAttribute('aria-valuemax', range.max);
      grip.setAttribute('aria-valuenow', Math.round(heading.getBoundingClientRect().height));
    }
    const stop = bindGrip(grip, 'headerHeight', 'y', () => heading.getBoundingClientRect().height, bounds, applyHeading, controller.signal);
    const observer = new ResizeObserver(applyHeading);
    observer.observe(workspace);
    applyHeading();
    headingBinding = {apply:applyHeading, dispose() { stop(); observer.disconnect(); controller.abort(); }};
  }

  window.addEventListener('resize', () => {
    if (window.innerWidth <= MOBILE_WIDTH) cancelDrag?.();
    applySidebar(); headingBinding?.apply();
  }, {signal:sidebarController.signal});
  applySidebar();
  return {bindTopic, detachTopic, refreshSidebarLabels};
}
