import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

function extractTag(source, tag) {
  const match = source.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  assert.ok(match, `Missing <${tag}> block`);
  return match[1];
}

function createMockDom() {
  const elements = new Map();
  const listeners = new Map();
  const storage = new Map();

  function makeClassList(el) {
    const set = new Set(el.className ? el.className.split(/\s+/).filter(Boolean) : []);
    return {
      add(...cls) { cls.forEach(c => set.add(c)); el._className = [...set].join(' '); },
      remove(...cls) { cls.forEach(c => set.delete(c)); el._className = [...set].join(' '); },
      toggle(c, force) {
        const has = force !== undefined ? force : !set.has(c);
        if (has) set.add(c); else set.delete(c);
        el._className = [...set].join(' ');
        return has;
      },
      contains(c) { return set.has(c); },
    };
  }

  function makeEl(tag, id = '') {
    const attrs = new Map();
    const children = [];
    const el = {
      tagName: tag.toUpperCase(),
      id,
      _className: '',
      _innerHTML: '',
      _textContent: '',
      value: '',
      title: '',
      type: '',
      disabled: false,
      inert: false,
      open: false,
      returnValue: '',
      style: {},
      children,
      parentNode: null,
      get childElementCount() { return children.length; },
      get firstElementChild() { return children[0] || null; },
      get textContent() { return this._textContent; },
      set textContent(v) { this._textContent = String(v ?? ''); },
      get className() { return this._className; },
      set className(v) {
        this._className = String(v);
        this.classList = makeClassList(this);
      },
      get innerHTML() { return this._innerHTML; },
      set innerHTML(v) {
        this._innerHTML = String(v);
        children.length = 0;
        const idRe = /id="([^"]+)"/g;
        let m;
        while ((m = idRe.exec(this._innerHTML)) !== null) {
          if (!elements.has(m[1])) {
            const child = makeEl('div', m[1]);
            child.parentNode = el;
            elements.set(m[1], child);
          }
        }
      },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.get(k) ?? null; },
      removeAttribute(k) { attrs.delete(k); },
      hasAttribute(k) { return attrs.has(k); },
      append(...nodes) {
        for (const n of nodes) {
          n.parentNode = el;
          children.push(n);
        }
      },
      appendChild(n) {
        n.parentNode = el;
        children.push(n);
        return n;
      },
      remove() {
        if (el.parentNode) {
          const idx = el.parentNode.children.indexOf(el);
          if (idx >= 0) el.parentNode.children.splice(idx, 1);
          el.parentNode = null;
        }
      },
      focus() {},
      click() { if (el.onclick) el.onclick({ preventDefault() {} }); },
      matches() { return false; },
      addEventListener(type, fn) {
        if (!listeners.has(el)) listeners.set(el, {});
        const map = listeners.get(el);
        (map[type] ||= []).push(fn);
      },
      dispatch(type, ev = {}) {
        const map = listeners.get(el) || {};
        for (const fn of map[type] || []) fn({ preventDefault() {}, target: el, ...ev });
      },
      querySelector(sel) {
        if (sel === '[autofocus]') return elements.get('cancelReset') || elements.get('newName') || null;
        return null;
      },
      querySelectorAll(sel) {
        if (sel === '.chip-close') {
          const out = [];
          for (const ch of children) {
            for (const sub of ch.children || []) {
              if (sub.className === 'chip-close') out.push(sub);
            }
          }
          return out;
        }
        return [];
      },
      showModal() { el.open = true; },
      close() { el.open = false; el.dispatch('close'); },
      getBoundingClientRect() { return { left: 0, top: 0, right: 500, bottom: 500 }; },
    };
    el.classList = makeClassList(el);
    if (id) elements.set(id, el);
    return el;
  }

  const staticIds = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  for (const id of staticIds) {
    if (!elements.has(id)) makeEl('div', id);
  }
  const dialogEl = elements.get('appDialog');
  dialogEl.closedBy = 'any';

  const docListeners = {};
  const document = {
    getElementById(id) { return elements.get(id) || null; },
    createElement(tag) { return makeEl(tag); },
    body: makeEl('body'),
    addEventListener(t, fn) { (docListeners[t] ||= []).push(fn); },
    dispatch(t, ev) { for (const fn of docListeners[t] || []) fn(ev); },
  };

  const windowObj = {
    matchMedia() {
      return { matches: false, addEventListener() {} };
    },
  };

  const localStorage = {
    getItem(k) { return storage.has(k) ? storage.get(k) : null; },
    setItem(k, v) { storage.set(k, String(v)); },
  };

  let lastBlob = null;
  const BaseBlob = class Blob { constructor(parts) { this.parts = parts; lastBlob = parts.join(''); } };

  return {
    elements,
    storage,
    getLastBlob: () => lastBlob,
    sandbox: {
      window: windowObj,
      document,
      localStorage,
      HTMLElement: function HTMLElement() {},
      HTMLDialogElement: function HTMLDialogElement() {},
      Blob: BaseBlob,
      URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
      requestAnimationFrame: cb => cb(),
      setTimeout,
      clearTimeout,
      Math,
      JSON,
      String,
      Number,
      Array,
      Set,
      Object,
    },
  };
}

test('README preserves attribution and joke', () => {
  assert.match(readme, /56Mugiwara/);
  assert.match(readme, /joke repo/i);
});

test('index.html has valid metadata, landmarks, labels, and native dialog', () => {
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<html lang="en">/i);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/i);
  assert.match(html, /<title>.*Daniel App Factory.*<\/title>/i);
  assert.match(html, /<label class="field-label" for="featureInput"/);
  assert.match(html, /<dialog class="modal" id="appDialog" closedby="any" aria-labelledby="modalTitle">/);
  assert.doesNotMatch(html, /<div class="footer">/);
  assert.match(html, /<footer class="footer">/);

  const script = extractTag(html, 'script');
  assert.doesNotThrow(() => new vm.Script(script, { filename: 'index.html' }));

  const style = extractTag(html, 'style');
  const opens = (style.match(/\{/g) || []).length;
  const closes = (style.match(/\}/g) || []).length;
  assert.equal(opens, closes, 'CSS braces must balance');
});

test('inline script renders, mutates state, handles edge cases, and escapes generated HTML', () => {
  const script = extractTag(html, 'script');
  const dom = createMockDom();
  dom.sandbox.HTMLDialogElement.prototype = { closedBy: 'any' };
  dom.sandbox.HTMLElement.prototype = {};

  vm.runInNewContext(script, dom.sandbox, { filename: 'index.html' });

  assert.equal(dom.elements.get('metricApps').textContent, '4');
  assert.equal(dom.elements.get('metricFeatures').textContent, '27');
  assert.equal(dom.elements.get('metricShipped').textContent, '0');
  assert.equal(dom.elements.get('previewName').textContent, 'Kokori');

  // Add a feature and verify state + escaping
  dom.elements.get('featureInput').value = '<script>alert(1)<\/script>';
  dom.elements.get('addFeatureButton').click();
  assert.equal(dom.elements.get('metricFeatures').textContent, '29');

  dom.elements.get('downloadHomepage').click();
  const exportedHtml = dom.getLastBlob();
  assert.ok(exportedHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!exportedHtml.includes('<li><script>alert(1)<\/script></li>'));

  const saved = JSON.parse(dom.storage.get('daf-v1'));
  assert.equal(saved.projects[0].features.at(-1), '<script>alert(1)<\/script>');

  // Duplicate feature should be rejected
  dom.elements.get('featureInput').value = '<script>alert(1)<\/script>';
  dom.elements.get('addFeatureButton').click();
  assert.equal(dom.elements.get('metricFeatures').textContent, '29');

  // Generate ideas and verify scope-creep spree works
  dom.elements.get('featureSpreeButton').click();
  assert.equal(dom.elements.get('metricFeatures').textContent, '32');

  // Open new project modal and submit
  dom.elements.get('newProjectTop').click();
  assert.equal(dom.elements.get('appDialog').open, true);
  dom.elements.get('newName').value = 'ToasterOS';
  dom.elements.get('newDesc').value = 'An OS for bread.';
  dom.elements.get('newForm').onsubmit({ preventDefault() {} });
  assert.equal(dom.elements.get('appDialog').open, false);
  assert.equal(dom.elements.get('metricApps').textContent, '5');
  assert.equal(dom.elements.get('previewName').textContent, 'ToasterOS');
  assert.equal(dom.elements.get('browserAddress').textContent, 'toasteros.coming-soon.local');

  // Reset empire restores defaults
  dom.elements.get('resetButton').click();
  assert.equal(dom.elements.get('appDialog').open, true);
  dom.elements.get('doReset').click();
  assert.equal(dom.elements.get('appDialog').open, false);
  assert.equal(dom.elements.get('metricApps').textContent, '4');
  assert.equal(dom.elements.get('metricFeatures').textContent, '27');
  assert.equal(dom.elements.get('previewName').textContent, 'Kokori');
});
