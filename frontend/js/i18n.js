/**
 * i18n.js — Internationalization module
 * Supports DE (default) and EN. Loads locale JSON files dynamically.
 */

const I18n = (() => {
  let _lang = localStorage.getItem('lang') || 'de';
  let _translations = {};

  async function init(lang) {
    _lang = lang || _lang;
    try {
      const resp = await fetch(`locales/${_lang}.json`);
      if (!resp.ok) throw new Error(`Could not load locale: ${_lang}`);
      _translations = await resp.json();
    } catch (e) {
      console.error('[i18n] Failed to load translations:', e);
      _translations = {};
    }
  }

  function setLang(lang) {
    _lang = lang;
    localStorage.setItem('lang', lang);
  }

  function getLang() {
    return _lang;
  }

  /**
   * Translate a dot-notation key, e.g. t('step1.title')
   * Supports simple template variables: t('app.step', { n: 1, total: 7 })
   */
  function t(key, vars) {
    const parts = key.split('.');
    let val = _translations;
    for (const p of parts) {
      if (val == null || typeof val !== 'object') return key;
      val = val[p];
    }
    if (val == null) return key;
    if (typeof val !== 'string') return key;
    if (vars) {
      return val.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
    }
    return val;
  }

  /** Translate all [data-i18n] elements in a container (default: document) */
  function applyDom(container) {
    const root = container || document;
    root.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const attr = el.getAttribute('data-i18n-attr');
      const translated = t(key);
      if (attr) {
        el.setAttribute(attr, translated);
      } else {
        el.textContent = translated;
      }
    });
    root.querySelectorAll('[data-i18n-html]').forEach(el => {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
  }

  return { init, setLang, getLang, t, applyDom };
})();

window.I18n = I18n;
