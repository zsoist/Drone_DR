import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOverlayCoordinator,
  createTouchSticks,
} from '../web/flightverse/touch.js';

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const active = force === undefined ? !this.contains(name) : !!force;
    if (active) this.add(name); else this.remove(name);
    return active;
  }
}

class FakeElement extends EventTarget {
  constructor(rect = { left: 0, top: 0, width: 300, height: 300 }) {
    super();
    this.children = [];
    this.parentNode = null;
    this.rect = rect;
    this.style = {};
    this.dataset = {};
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.captures = new Set();
    this.inert = false;
    this.focused = false;
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  querySelector() { return this.children[0] || null; }
  focus() {
    this.focused = true;
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  getBoundingClientRect() {
    return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height };
  }
}

const pointer = (type, { id = 1, x = 0, y = 0 } = {}) => {
  const event = new Event(type);
  Object.defineProperties(event, {
    pointerId: { value: id },
    clientX: { value: x },
    clientY: { value: y },
  });
  return event;
};

function touchHarness() {
  const host = new FakeElement({ left: 0, top: 0, width: 800, height: 600 });
  const made = [];
  const createElement = () => {
    const element = new FakeElement({ left: 0, top: 0, width: 300, height: 260 });
    made.push(element);
    return element;
  };
  const controller = createTouchSticks(host, {
    force: true,
    radius: 50,
    createElement,
  });
  return { host, made, controller, left: made[0], right: made[3], leftBase: made[1], rightBase: made[4] };
}

test('touch origin follows pointerdown and clamps inside the stick zone', () => {
  const { left, leftBase, controller } = touchHarness();
  left.dispatchEvent(pointer('pointerdown', { id: 7, x: 4, y: 248 }));

  assert.equal(leftBase.style.left, '50px');
  assert.equal(leftBase.style.top, '210px');
  assert.equal(controller.sample().active, true);
});

test('touch movement clamps to a unit circle and preserves RC Mode 2 mapping', () => {
  const { right, controller } = touchHarness();
  right.dispatchEvent(pointer('pointerdown', { id: 2, x: 100, y: 100 }));
  right.dispatchEvent(pointer('pointermove', { id: 2, x: 200, y: 200 }));

  const sample = controller.sample();
  assert.ok(Math.abs(sample.strafe - Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(sample.fwd + Math.SQRT1_2) < 1e-9);
  assert.equal(sample.active, true);
});

test('pointer cancellation resets axes and releases activity', () => {
  const { left, controller } = touchHarness();
  left.dispatchEvent(pointer('pointerdown', { id: 4, x: 120, y: 120 }));
  left.dispatchEvent(pointer('pointermove', { id: 4, x: 150, y: 80 }));
  left.dispatchEvent(pointer('pointercancel', { id: 4, x: 150, y: 80 }));

  assert.deepEqual(controller.sample(), {
    lift: 0, yaw: 0, fwd: 0, strafe: 0, active: false,
  });
});

test('disable resets both sticks and ignores input until re-enabled', () => {
  const { left, controller } = touchHarness();
  left.dispatchEvent(pointer('pointerdown', { id: 5, x: 100, y: 100 }));
  left.dispatchEvent(pointer('pointermove', { id: 5, x: 140, y: 100 }));
  controller.setEnabled(false);
  left.dispatchEvent(pointer('pointerdown', { id: 6, x: 100, y: 100 }));
  left.dispatchEvent(pointer('pointermove', { id: 6, x: 140, y: 100 }));

  assert.deepEqual(controller.sample(), {
    lift: 0, yaw: 0, fwd: 0, strafe: 0, active: false,
  });
  assert.equal(left.getAttribute('aria-hidden'), 'true');

  controller.setEnabled(true);
  assert.equal(left.getAttribute('aria-hidden'), 'false');
});

test('dispose is idempotent, removes DOM, and rejects later pointer input', () => {
  const { host, left, controller } = touchHarness();
  controller.dispose();
  controller.dispose();
  left.dispatchEvent(pointer('pointerdown', { id: 8, x: 100, y: 100 }));
  left.dispatchEvent(pointer('pointermove', { id: 8, x: 140, y: 100 }));

  assert.equal(host.children.length, 0);
  assert.deepEqual(controller.sample(), {
    lift: 0, yaw: 0, fwd: 0, strafe: 0, active: false,
  });
});

function overlayHarness() {
  const eventRoot = new EventTarget();
  const scrim = new FakeElement();
  const names = ['menu', 'combat', 'image'];
  const overlays = Object.fromEntries(names.map(name => [
    name,
    {
      panel: new FakeElement(),
      trigger: new FakeElement(),
      openClass: name === 'image' ? 'show' : 'open',
    },
  ]));
  const coordinator = createOverlayCoordinator({ eventRoot, scrim, overlays });
  return { eventRoot, scrim, overlays, coordinator };
}

test('overlay coordinator keeps exactly one panel active', () => {
  const { overlays, coordinator } = overlayHarness();
  coordinator.open('menu');
  coordinator.open('combat');

  assert.equal(coordinator.active(), 'combat');
  assert.equal(overlays.menu.panel.classList.contains('open'), false);
  assert.equal(overlays.combat.panel.classList.contains('open'), true);
  assert.equal(overlays.image.panel.classList.contains('show'), false);
});

test('scrim dismisses the active overlay and restores accessibility state', () => {
  const { scrim, overlays, coordinator } = overlayHarness();
  coordinator.open('menu');
  assert.equal(scrim.getAttribute('aria-hidden'), 'false');
  assert.equal(overlays.menu.trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(overlays.menu.panel.getAttribute('aria-hidden'), 'false');
  assert.equal(overlays.menu.panel.getAttribute('aria-modal'), 'true');

  scrim.dispatchEvent(pointer('pointerdown'));
  assert.equal(coordinator.active(), null);
  assert.equal(scrim.getAttribute('aria-hidden'), 'true');
  assert.equal(overlays.menu.trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(overlays.menu.panel.getAttribute('aria-hidden'), 'true');
  assert.equal(overlays.menu.panel.getAttribute('aria-modal'), 'false');
});

test('Escape dismissal and dispose remove coordinator listeners', () => {
  const { eventRoot, scrim, coordinator } = overlayHarness();
  coordinator.open('image');
  const escape = new Event('keydown');
  Object.defineProperty(escape, 'key', { value: 'Escape' });
  eventRoot.dispatchEvent(escape);
  assert.equal(coordinator.active(), null);

  coordinator.open('menu');
  coordinator.dispose();
  scrim.dispatchEvent(pointer('pointerdown'));
  assert.equal(coordinator.active(), null);
  assert.equal(scrim.getAttribute('aria-hidden'), 'true');
});

test('overlay coordinator reports every active-state transition', () => {
  const eventRoot = new EventTarget();
  const scrim = new FakeElement();
  const panel = new FakeElement();
  const transitions = [];
  const coordinator = createOverlayCoordinator({
    eventRoot,
    scrim,
    overlays: { menu: { panel, openClass: 'open' } },
    onChange: name => transitions.push(name),
  });
  coordinator.open('menu');
  scrim.dispatchEvent(pointer('pointerdown'));

  assert.deepEqual(transitions, [null, 'menu', null]);
});

test('a non-dismissible overlay ignores scrim and Escape until explicitly closed', () => {
  const eventRoot = new EventTarget();
  const scrim = new FakeElement();
  const panel = new FakeElement();
  const coordinator = createOverlayCoordinator({
    eventRoot,
    scrim,
    overlays: { director: { panel, openClass: 'show', dismissible: false } },
  });
  coordinator.open('director');
  scrim.dispatchEvent(pointer('pointerdown'));
  const escape = new Event('keydown');
  Object.defineProperty(escape, 'key', { value: 'Escape' });
  eventRoot.dispatchEvent(escape);

  assert.equal(coordinator.active(), 'director');
  coordinator.close('director');
  assert.equal(coordinator.active(), null);
});

test('modal focus, role, inert background, and focus restoration follow ownership', () => {
  const eventRoot = new EventTarget();
  const scrim = new FakeElement();
  const panel = new FakeElement();
  const closeButton = panel.appendChild(new FakeElement());
  const trigger = new FakeElement();
  const background = new FakeElement();
  for (const element of [panel, closeButton, trigger]) element.ownerDocument = eventRoot;
  eventRoot.activeElement = trigger;
  const coordinator = createOverlayCoordinator({
    eventRoot,
    scrim,
    inertTargets: [background],
    overlays: { menu: { panel, trigger, openClass: 'open' } },
  });
  coordinator.open('menu');

  assert.equal(panel.getAttribute('role'), 'dialog');
  assert.equal(panel.inert, false);
  assert.equal(background.inert, true);
  assert.equal(eventRoot.activeElement, closeButton);

  coordinator.close('menu');
  assert.equal(panel.inert, true);
  assert.equal(background.inert, false);
  assert.equal(eventRoot.activeElement, trigger);
});
