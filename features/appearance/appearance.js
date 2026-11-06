// popup/features/appearance/appearance.js
// Manages color theme (accent) + mode (light / classic-dark / dark) for the popup.
// Settings are persisted in chrome.storage.sync so they survive browser restarts.

var OAIAppearance = (function () {
  'use strict';

  var DEFAULT_COLOR = 'slate';
  var DEFAULT_MODE  = 'light';

  // Fast custom tooltip for the colour swatches (the native title attribute has a ~1s delay).
  var _swTip = null, _swTipTimer = null;
  function swatchTipEl() {
    if (!_swTip) { _swTip = document.createElement('div'); _swTip.className = 'oai-sw-tip'; document.body.appendChild(_swTip); }
    return _swTip;
  }

  var COLOR_OPTIONS = [
    { value: 'slate', label: 'Netsuite Slate', hex: '#44536B', dark: '#303d50' },
    { value: 'nam',   label: 'Nam Blue',                 hex: '#1B3D82', dark: '#143061' },
    { value: 'becky', label: 'Becky Maroon',             hex: '#550000', dark: '#3D0000' },
    { value: 'jenna', label: 'Jenna Purple',             hex: '#6C3BAA', dark: '#572E89' },
    { value: 'omkar', label: 'Omkar Gold',               hex: '#DAA520', dark: '#B8860B' },
    { value: 'alec',  label: 'Alec Green',               hex: '#40826D', dark: '#336654' },
  ];

  var MODE_OPTIONS = [
    { value: 'light',        label: 'Light', sub: 'default' },
    { value: 'classic-dark', label: 'Dark',  sub: null      },
    { value: 'dark',         label: 'Cool',  sub: null      },
  ];

  // ── Apply to popup ──────────────────────────────────────────────────────────

  function applyColorToPopup(color) {
    var opt = COLOR_OPTIONS.filter(function (c) { return c.value === color; })[0] || COLOR_OPTIONS[0];
    document.documentElement.style.setProperty('--accent',      opt.hex);
    document.documentElement.style.setProperty('--accent-dark', opt.dark);
  }

  function applyModeToPopup(mode) {
    MODE_OPTIONS.forEach(function (m) {
      document.body.classList.remove('oai-mode-' + m.value);
    });
    document.body.classList.add('oai-mode-' + (mode || DEFAULT_MODE));
  }

  // ── Notify content script ───────────────────────────────────────────────────

  function notifyContentScript(color, mode) {
    // Message every tab (not just the active one); tabs without the content script just error, which we ignore.
    chrome.tabs.query({}, function (tabs) {
      (tabs || []).forEach(function (tab) {
        if (!tab || tab.id == null) return;
        chrome.tabs.sendMessage(tab.id, { action: 'applyTheme', color: color, mode: mode }, function () {
          void chrome.runtime.lastError;
        });
      });
    });
  }

  // ── Persist + apply ─────────────────────────────────────────────────────────

  function saveAndApply(color, mode, containerEl) {
    chrome.storage.sync.set({ oai_theme_color: color, oai_theme_mode: mode });
    applyColorToPopup(color);
    applyModeToPopup(mode);
    notifyContentScript(color, mode);
  }

  // ── Render widget ───────────────────────────────────────────────────────────

  function render(containerEl, currentColor, currentMode) {
    containerEl.innerHTML = [
      '<div class="oai-appear-row">',
        '<span class="oai-appear-field-label">Color Theme</span>',
        '<div class="oai-appear-swatches">',
          COLOR_OPTIONS.map(function (c) {
            return '<button type="button" class="oai-appear-swatch' + (c.value === currentColor ? ' is-active' : '') + '"' +
              ' data-color="' + c.value + '" aria-label="' + c.label + '"' +
              ' style="background:' + c.hex + '"></button>';
          }).join(''),
        '</div>',
      '</div>',
      '<div class="oai-appear-row oai-appear-row--modes">',
        '<span class="oai-appear-field-label">Theme</span>',
        '<div class="oai-appear-modes">',
          MODE_OPTIONS.map(function (m) {
            var active = m.value === currentMode;
            return '<button type="button" class="oai-appear-mode-btn' + (active ? ' is-active' : '') + '" data-mode="' + m.value + '">' +
              '<span class="oai-mode-radio"></span>' +
              '<span class="oai-mode-label">' + m.label + '</span>' +
              '</button>';
          }).join(''),
        '</div>',
      '</div>',
    ].join('');

    // Colour swatch clicks + fast custom tooltip
    containerEl.querySelectorAll('.oai-appear-swatch').forEach(function (btn) {
      btn.addEventListener('click', function () {
        containerEl.querySelectorAll('.oai-appear-swatch').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        var activeMode = containerEl.querySelector('.oai-appear-mode-btn.is-active');
        saveAndApply(btn.dataset.color, activeMode ? activeMode.dataset.mode : currentMode, containerEl);
      });
      btn.addEventListener('mouseenter', function () {
        clearTimeout(_swTipTimer);
        _swTipTimer = setTimeout(function () {
          var t = swatchTipEl();
          t.textContent = btn.getAttribute('aria-label') || '';
          var r = btn.getBoundingClientRect();
          t.style.left = (r.left + r.width / 2) + 'px';
          t.style.top  = (r.top - 6) + 'px';
          t.classList.add('is-visible');
        }, 50);
      });
      btn.addEventListener('mouseleave', function () {
        clearTimeout(_swTipTimer);
        swatchTipEl().classList.remove('is-visible');
      });
    });

    // Mode radio clicks
    containerEl.querySelectorAll('.oai-appear-mode-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        containerEl.querySelectorAll('.oai-appear-mode-btn').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        var activeSwatch = containerEl.querySelector('.oai-appear-swatch.is-active');
        saveAndApply(activeSwatch ? activeSwatch.dataset.color : currentColor, btn.dataset.mode, containerEl);
      });
    });
  }

  // ── Public init ─────────────────────────────────────────────────────────────

  function init(containerEl) {
    if (!containerEl) return;
    chrome.storage.sync.get(['oai_theme_color', 'oai_theme_mode'], function (prefs) {
      var color = prefs.oai_theme_color || DEFAULT_COLOR;
      var mode  = prefs.oai_theme_mode  || DEFAULT_MODE;
      applyColorToPopup(color);
      applyModeToPopup(mode);
      render(containerEl, color, mode);
    });
  }

  return { init: init };
})();
