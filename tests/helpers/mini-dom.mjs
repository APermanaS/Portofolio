/**
 * A deliberately tiny DOM for running the real browser scripts (script.js, admin.js)
 * inside node:vm — no dependencies, no network, no HTML parser.
 *
 * Only what those scripts use is implemented: elements, text nodes, attributes,
 * classList / dataset, events with bubbling, <template> (for the trusted SVG icons),
 * <dialog>, <select>, and querySelector(All) for simple selectors (tag, #id, .class,
 * [attr], [attr="v"], :not(simple), descendant " " and child ">" combinators, lists).
 *
 * Safety net: innerHTML may ONLY be set on a <template>. Every write is recorded in
 * dom.innerHTMLWrites, and setting it anywhere else throws, so a test fails loudly if
 * database text were ever parsed as HTML.
 */
import { webcrypto } from 'node:crypto';

export function createDom() {
  const innerHTMLWrites = [];
  let doc = null;

  class Node {
    constructor() {
      this.parentNode = null;
      this.childNodes = [];
      this._listeners = new Map();
    }

    get ownerDocument() {
      return doc;
    }

    get textContent() {
      return this.childNodes.map((child) => child.textContent).join('');
    }

    set textContent(value) {
      this.replaceChildren();
      if (value != null && value !== '') this.append(String(value));
    }

    get children() {
      return this.childNodes.filter((child) => child instanceof Element);
    }

    get firstElementChild() {
      return this.children[0] || null;
    }

    get nextSibling() {
      const siblings = this.parentNode?.childNodes;
      return siblings ? siblings[siblings.indexOf(this) + 1] || null : null;
    }

    get isConnected() {
      let node = this;
      while (node.parentNode) node = node.parentNode;
      return node === doc;
    }

    contains(other) {
      for (let node = other; node; node = node.parentNode) if (node === this) return true;
      return false;
    }

    _wrap(value) {
      return value instanceof Node ? value : new Text(String(value));
    }

    _insert(node, before = null) {
      if (node instanceof DocumentFragment) {
        [...node.childNodes].forEach((child) => this._insert(child, before));
        return;
      }
      node.remove();
      node.parentNode = this;
      const at = before ? this.childNodes.indexOf(before) : -1;
      if (at === -1) this.childNodes.push(node);
      else this.childNodes.splice(at, 0, node);
    }

    append(...nodes) {
      nodes.forEach((node) => this._insert(this._wrap(node)));
    }

    appendChild(node) {
      this._insert(node);
      return node;
    }

    remove() {
      if (!this.parentNode) return;
      const siblings = this.parentNode.childNodes;
      siblings.splice(siblings.indexOf(this), 1);
      this.parentNode = null;
    }

    replaceChildren(...nodes) {
      const next = nodes.map((node) => this._wrap(node));
      [...this.childNodes].forEach((child) => child.remove());
      next.forEach((node) => this._insert(node));
    }

    replaceWith(...nodes) {
      const parent = this.parentNode;
      if (!parent) return;
      const next = nodes.map((node) => parent._wrap(node));
      const anchor = this.nextSibling;
      this.remove();
      next.forEach((node) => parent._insert(node, anchor));
    }

    addEventListener(type, fn, options = {}) {
      if (typeof fn !== 'function') return;
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push({ fn, once: Boolean(options?.once) });
    }

    removeEventListener(type, fn) {
      const list = this._listeners.get(type);
      if (list) this._listeners.set(type, list.filter((entry) => entry.fn !== fn));
    }

    dispatchEvent(event) {
      Object.defineProperty(event, 'target', { value: this, configurable: true });
      for (let node = this; node; node = event.bubbles ? node.parentNode : null) {
        Object.defineProperty(event, 'currentTarget', { value: node, configurable: true });
        for (const entry of [...(node._listeners.get(event.type) || [])]) {
          if (entry.once) node.removeEventListener(event.type, entry.fn);
          entry.fn.call(node, event);
        }
        if (event.cancelBubble) break;
      }
      return !event.defaultPrevented;
    }

    querySelectorAll(selector) {
      const selectors = parseList(selector);
      const out = [];
      const walk = (node) => {
        for (const child of node.children) {
          if (selectors.some((complex) => matchComplex(child, complex))) out.push(child);
          walk(child);
        }
      };
      walk(this);
      return out;
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
  }

  class Text extends Node {
    constructor(data) {
      super();
      this.data = data;
    }

    get textContent() {
      return this.data;
    }

    set textContent(value) {
      this.data = String(value);
    }
  }

  class DocumentFragment extends Node {}

  /** Attributes whose property mirrors the attribute (boolean = presence). */
  const BOOLEAN_PROPS = ['hidden', 'disabled', 'open'];
  const STRING_PROPS = { id: 'id', className: 'class', href: 'href', src: 'src', target: 'target', rel: 'rel', type: 'type' };

  class Element extends Node {
    constructor(tag) {
      super();
      this.localName = tag.toLowerCase();
      this.tagName = tag.toUpperCase();
      this.attributes = new Map();
      this.style = {};
      if (['input', 'textarea'].includes(this.localName)) {
        this.value = '';
        this.checked = false;
      }
      const element = this;
      this.classList = {
        _list: () => (element.getAttribute('class') || '').split(/\s+/).filter(Boolean),
        _set(list) {
          element.setAttribute('class', [...new Set(list)].join(' '));
        },
        contains: (name) => element.classList._list().includes(name),
        add: (...names) => element.classList._set([...element.classList._list(), ...names]),
        remove: (...names) => element.classList._set(element.classList._list().filter((n) => !names.includes(n))),
        toggle(name, force) {
          const on = force === undefined ? !this.contains(name) : Boolean(force);
          if (on) this.add(name);
          else this.remove(name);
          return on;
        }
      };
      const toAttr = (key) => `data-${String(key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
      this.dataset = new Proxy({}, {
        get: (_, key) => (typeof key === 'string' ? element.getAttribute(toAttr(key)) ?? undefined : undefined),
        set: (_, key, value) => {
          element.setAttribute(toAttr(key), value);
          return true;
        },
        deleteProperty: (_, key) => {
          element.removeAttribute(toAttr(key));
          return true;
        },
        has: (_, key) => element.hasAttribute(toAttr(key))
      });
    }

    setAttribute(name, value) {
      this.attributes.set(String(name).toLowerCase(), String(value));
    }

    getAttribute(name) {
      const key = String(name).toLowerCase();
      return this.attributes.has(key) ? this.attributes.get(key) : null;
    }

    hasAttribute(name) {
      return this.attributes.has(String(name).toLowerCase());
    }

    removeAttribute(name) {
      this.attributes.delete(String(name).toLowerCase());
    }

    set innerHTML(html) {
      throw new Error(`innerHTML was set on <${this.localName}> (only <template> may receive trusted markup): ${String(html).slice(0, 80)}`);
    }

    focus() {
      doc.activeElement = this;
    }

    blur() {
      if (doc.activeElement === this) doc.activeElement = doc.body;
    }

    click() {
      if (this.disabled) return;
      this.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
    }

    matches(selector) {
      return parseList(selector).some((complex) => matchComplex(this, complex));
    }

    closest(selector) {
      for (let node = this; node instanceof Element; node = node.parentNode) if (node.matches(selector)) return node;
      return null;
    }
  }

  for (const prop of BOOLEAN_PROPS) {
    Object.defineProperty(Element.prototype, prop, {
      get() {
        return this.hasAttribute(prop);
      },
      set(value) {
        if (value) this.setAttribute(prop, '');
        else this.removeAttribute(prop);
      }
    });
  }
  for (const [prop, attr] of Object.entries(STRING_PROPS)) {
    Object.defineProperty(Element.prototype, prop, {
      get() {
        return this.getAttribute(attr) ?? '';
      },
      set(value) {
        this.setAttribute(attr, value);
      }
    });
  }

  class TemplateElement extends Element {
    constructor() {
      super('template');
      this.content = new DocumentFragment();
    }

    /** Records the markup and keeps it as an opaque element; it is never parsed. */
    set innerHTML(html) {
      innerHTMLWrites.push(String(html));
      const tag = /^\s*<([a-zA-Z][\w-]*)/.exec(String(html))?.[1] || 'span';
      const node = new Element(tag);
      node.rawMarkup = String(html);
      this.content.replaceChildren(node);
    }
  }

  class DialogElement extends Element {
    constructor() {
      super('dialog');
    }

    showModal() {
      this.setAttribute('open', '');
    }

    close() {
      if (!this.open) return;
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    }
  }

  class SelectElement extends Element {
    constructor() {
      super('select');
      this._value = undefined;
    }

    get value() {
      if (this._value !== undefined) return this._value;
      return this.children.find((child) => child.localName === 'option')?.value ?? '';
    }

    set value(value) {
      this._value = String(value);
    }
  }

  class Document extends Node {
    constructor() {
      super();
      this.readyState = 'complete';
      this.title = '';
      this.documentElement = new Element('html');
      this.head = new Element('head');
      this.body = new Element('body');
      this.documentElement.append(this.head, this.body);
      this._insert(this.documentElement);
      this.activeElement = this.body;
    }

    createElement(tag) {
      const name = String(tag).toLowerCase();
      if (name === 'template') return new TemplateElement();
      if (name === 'dialog') return new DialogElement();
      if (name === 'select') return new SelectElement();
      return new Element(name);
    }

    createTextNode(text) {
      return new Text(String(text));
    }

    getElementById(id) {
      return this.querySelector(`#${id}`);
    }
  }

  /* ---------------- selectors ---------------- */
  const cache = new Map();

  function splitTop(text, separator) {
    const parts = [];
    let depth = 0;
    let quote = null;
    let current = '';
    for (const ch of text) {
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '[' || ch === '(') depth += 1;
      else if (ch === ']' || ch === ')') depth -= 1;
      else if (ch === separator && depth === 0) {
        parts.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    parts.push(current);
    return parts.map((part) => part.trim()).filter(Boolean);
  }

  function parseCompound(text) {
    const compound = { tag: null, ids: [], classes: [], attrs: [], nots: [], unsupported: false };
    const re = /^(?:(\*|[a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w-]+)\s*(?:([\^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]|:not\(([^()]*)\)|(:[\w-]+(?:\([^()]*\))?))/;
    let rest = text;
    while (rest) {
      const m = re.exec(rest);
      if (!m) {
        compound.unsupported = true;
        break;
      }
      if (m[1]) compound.tag = m[1] === '*' ? null : m[1].toLowerCase();
      else if (m[2]) compound.ids.push(m[2]);
      else if (m[3]) compound.classes.push(m[3]);
      else if (m[4]) compound.attrs.push({ name: m[4].toLowerCase(), op: m[5] || null, value: m[6] ?? m[7] ?? m[8] ?? null });
      else if (m[9] !== undefined) compound.nots.push(parseCompound(m[9].trim()));
      else if (m[10]) compound.unsupported = true; // any other pseudo-class never matches
      rest = rest.slice(m[0].length);
    }
    return compound;
  }

  function parseComplex(text) {
    // "a > b c" → [{ compound: a }, { comb: '>', compound: b }, { comb: ' ', compound: c }]
    const tokens = [];
    let current = '';
    let depth = 0;
    let pending = null;
    const flush = () => {
      if (!current) return;
      tokens.push({ comb: tokens.length ? pending || ' ' : null, compound: parseCompound(current) });
      current = '';
      pending = null;
    };
    for (const ch of text) {
      if (ch === '[' || ch === '(') depth += 1;
      if (ch === ']' || ch === ')') depth -= 1;
      if (depth === 0 && (ch === ' ' || ch === '>')) {
        flush();
        if (ch === '>') pending = '>';
        continue;
      }
      current += ch;
    }
    flush();
    return tokens;
  }

  function parseList(selector) {
    if (!cache.has(selector)) cache.set(selector, splitTop(String(selector), ',').map(parseComplex));
    return cache.get(selector);
  }

  function matchCompound(el, c) {
    if (!(el instanceof Element) || c.unsupported) return false;
    if (c.tag && el.localName !== c.tag) return false;
    if (c.ids.some((id) => el.getAttribute('id') !== id)) return false;
    if (c.classes.some((name) => !el.classList.contains(name))) return false;
    for (const attr of c.attrs) {
      const actual = el.getAttribute(attr.name);
      if (actual === null) return false;
      if (attr.op === '=' && actual !== attr.value) return false;
      if (attr.op === '^=' && !actual.startsWith(attr.value)) return false;
      if (attr.op === '$=' && !actual.endsWith(attr.value)) return false;
      if (attr.op === '*=' && !actual.includes(attr.value)) return false;
    }
    if (c.nots.some((not) => matchCompound(el, not))) return false;
    return true;
  }

  function matchComplex(el, tokens, index = tokens.length - 1) {
    if (!tokens.length || !matchCompound(el, tokens[index].compound)) return false;
    if (index === 0) return true;
    const comb = tokens[index].comb;
    if (comb === '>') return el.parentNode instanceof Element && matchComplex(el.parentNode, tokens, index - 1);
    for (let node = el.parentNode; node instanceof Element; node = node.parentNode) {
      if (matchComplex(node, tokens, index - 1)) return true;
    }
    return false;
  }

  doc = new Document();

  /** Build an element tree quickly in tests: el('div', { id: 'x' }, child, 'text'). */
  function el(tag, attrs = {}, ...children) {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === true) node.setAttribute(key, '');
      else if (value != null && value !== false) node.setAttribute(key, value);
    }
    children.forEach((child) => node.append(child));
    return node;
  }

  return { document: doc, Node, Element, Text, el, innerHTMLWrites };
}

/**
 * Globals for a vm context that runs a browser script. Timers are unref'd so a pending
 * toast timer never keeps the test process alive.
 */
export function browserGlobals(dom, { fetch, supabase, config, hash = '', console: sink } = {}) {
  const location = { hash };
  const listeners = new Map();
  return {
    document: dom.document,
    Node: dom.Node,
    Element: dom.Element,
    Event,
    URL,
    AbortController,
    crypto: webcrypto,
    console: sink || console,
    setTimeout: (fn, ms, ...args) => {
      const timer = setTimeout(fn, ms, ...args);
      timer.unref?.();
      return timer;
    },
    clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    fetch,
    location,
    history: {
      replaceState(_state, _title, url) {
        if (typeof url === 'string' && url.startsWith('#')) location.hash = url;
      }
    },
    sessionStorage: {},
    navigator: {},
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
    PORTFOLIO_CONFIG: config,
    supabase
  };
}

/** Wait until `check()` returns something truthy (polls the event loop). */
export async function waitFor(check, { timeout = 2000, label = 'condition' } = {}) {
  const started = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Let every pending promise / setImmediate settle. */
export async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
}
