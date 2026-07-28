import assert from 'node:assert/strict';
import test from 'node:test';

import { createFlightTools } from '../web/flightverse/flight-tools.js';

class FakeElement extends EventTarget {
  constructor() {
    super();
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = false;
    this.value = '0';
    this.textContent = '';
    this.focusCount = 0;
    this.listenerAdds = [];
    this.listenerRemovals = [];
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  contains(node) { return node === this; }
  focus() { this.focusCount += 1; }
  addEventListener(type, handler, options) {
    this.listenerAdds.push({ type, handler, options });
    super.addEventListener(type, handler, options);
  }
  removeEventListener(type, handler, options) {
    this.listenerRemovals.push({ type, handler, options });
    super.removeEventListener(type, handler, options);
  }
}

const eventWith = (type, properties = {}) => {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(properties)) {
    Object.defineProperty(event, key, { value });
  }
  return event;
};

function harness() {
  const cameraTrigger = new FakeElement();
  const cameraPickerTrigger = new FakeElement();
  const cameraPanel = new FakeElement();
  const gimbalTrigger = new FakeElement();
  const gimbalTray = new FakeElement();
  const gimbalRange = new FakeElement();
  const gimbalValue = new FakeElement();
  const gimbalReset = new FakeElement();
  gimbalReset.dataset.gimbalReset = '';
  const gimbalDown = new FakeElement();
  gimbalDown.dataset.gimbal = '-5';
  const gimbalUp = new FakeElement();
  gimbalUp.dataset.gimbal = '5';
  const eventRoot = new FakeElement();
  const orientationRoot = new FakeElement();
  eventRoot.defaultView = orientationRoot;
  const visibilityRoot = new FakeElement();
  visibilityRoot.hidden = false;
  const cameraItems = ['fpv', 'top', 'orbit'].map(key => {
    const item = new FakeElement();
    item.dataset.camera = key;
    return item;
  });
  const cycles = [];
  const selected = [];
  const gimbal = [];
  const tools = createFlightTools({
    cameraTrigger,
    cameraPickerTrigger,
    cameraPanel,
    cameraItems,
    gimbalTrigger,
    gimbalTray,
    gimbalRange,
    gimbalValue,
    gimbalButtons: [gimbalDown, gimbalReset, gimbalUp],
    eventRoot,
    visibilityRoot,
    onCycleCamera: direction => cycles.push(direction),
    onSelectCamera: key => selected.push(key),
    onGimbal: radians => gimbal.push(radians),
  });
  return {
    cameraTrigger, cameraPickerTrigger, cameraPanel, cameraItems, gimbalTrigger, gimbalTray,
    gimbalRange, gimbalValue, gimbalReset, gimbalDown, gimbalUp,
    eventRoot, orientationRoot, visibilityRoot, cycles, selected, gimbal, tools,
  };
}

test('Camera cycles once, exposes current rig, and picker selection closes cleanly', () => {
  const h = harness();
  h.tools.syncCamera({ key: 'fpv', code: 'FPV', label: 'FPV' });
  h.cameraTrigger.dispatchEvent(new Event('click'));
  assert.deepEqual(h.cycles, [1]);
  assert.equal(h.cameraTrigger.getAttribute('aria-label'), 'Cambiar cámara. Actual: FPV');

  h.cameraPickerTrigger.dispatchEvent(new Event('click'));
  assert.equal(h.cameraPanel.hidden, false);
  assert.equal(h.gimbalTrigger.hidden, true);
  assert.equal(h.cameraPickerTrigger.getAttribute('aria-expanded'), 'true');
  h.cameraItems[1].dispatchEvent(new Event('click'));
  assert.deepEqual(h.selected, ['top']);
  assert.equal(h.cameraPanel.hidden, true);
  assert.equal(h.gimbalTrigger.hidden, false);
  assert.equal(h.cameraPickerTrigger.getAttribute('aria-expanded'), 'false');
  assert.equal(h.cameraPickerTrigger.focusCount, 1);
});

test('Gimbal opens independently, clamps -90..25, steps, resets, and restores focus', () => {
  const h = harness();
  h.tools.openCamera();
  h.gimbalTrigger.dispatchEvent(new Event('click'));
  assert.equal(h.cameraPanel.hidden, true);
  assert.equal(h.gimbalTray.hidden, false);
  assert.equal(h.gimbalTrigger.getAttribute('aria-expanded'), 'true');

  h.gimbalRange.value = '-120';
  h.gimbalRange.dispatchEvent(new Event('input'));
  assert.ok(Math.abs(h.gimbal.at(-1) - (-Math.PI / 2)) < 1e-12);
  h.gimbalUp.dispatchEvent(new Event('click'));
  assert.ok(Math.abs(h.gimbal.at(-1) - (-85 * Math.PI / 180)) < 1e-12);
  h.gimbalReset.dispatchEvent(new Event('click'));
  assert.equal(h.gimbal.at(-1), 0);

  h.tools.closeGimbal('escape');
  assert.equal(h.gimbalTray.hidden, true);
  assert.equal(h.gimbalTrigger.focusCount, 1);
});

test('outside, Escape, overlay, orientation, visibility, pagehide, and dispose close tools', () => {
  const h = harness();
  const outside = new FakeElement();

  h.tools.openGimbal();
  h.eventRoot.dispatchEvent(eventWith('pointerdown', { target: outside }));
  assert.equal(h.gimbalTray.hidden, true);

  h.tools.openCamera();
  h.eventRoot.dispatchEvent(eventWith('keydown', { key: 'Escape' }));
  assert.equal(h.cameraPanel.hidden, true);

  for (const close of [
    () => h.tools.closeAll('overlay'),
    () => h.orientationRoot.dispatchEvent(new Event('orientationchange')),
    () => {
      h.visibilityRoot.hidden = true;
      h.visibilityRoot.dispatchEvent(new Event('visibilitychange'));
      h.visibilityRoot.hidden = false;
    },
    () => h.eventRoot.dispatchEvent(new Event('pagehide')),
  ]) {
    h.tools.openCamera();
    h.tools.openGimbal();
    close();
    assert.equal(h.cameraPanel.hidden, true);
    assert.equal(h.gimbalTray.hidden, true);
  }

  h.tools.dispose();
  h.tools.dispose();
  h.cameraTrigger.dispatchEvent(new Event('click'));
  h.gimbalTrigger.dispatchEvent(new Event('click'));
  assert.deepEqual(h.cycles, []);
  assert.equal(h.gimbalTray.hidden, true);
  assert.equal(h.cameraPanel.hidden, true);

  const added = [
    h.cameraTrigger, h.cameraPickerTrigger, h.gimbalTrigger, h.gimbalRange, h.eventRoot,
    h.orientationRoot, h.visibilityRoot, ...h.cameraItems,
    h.gimbalDown, h.gimbalReset, h.gimbalUp,
  ].reduce((sum, element) => sum + element.listenerAdds.length, 0);
  const removed = [
    h.cameraTrigger, h.cameraPickerTrigger, h.gimbalTrigger, h.gimbalRange, h.eventRoot,
    h.orientationRoot, h.visibilityRoot, ...h.cameraItems,
    h.gimbalDown, h.gimbalReset, h.gimbalUp,
  ].reduce((sum, element) => sum + element.listenerRemovals.length, 0);
  assert.equal(removed, added);
});
