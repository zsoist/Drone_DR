import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../web/flightverse/mobile-command.js', import.meta.url);

async function loadMobileCommand() {
  const source = await readFile(sourceUrl, 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

class FakeElement extends EventTarget {
  constructor({ allowed = false } = {}) {
    super();
    this.allowed = allowed;
    this.captures = new Set();
  }
  closest(selector) {
    return this.allowed && selector.includes('input[type="range"]') ? this : null;
  }
  setPointerCapture(pointerId) { this.captures.add(pointerId); }
  hasPointerCapture(pointerId) { return this.captures.has(pointerId); }
  releasePointerCapture(pointerId) { this.captures.delete(pointerId); }
}

const pointer = (type, pointerId) => {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
};

const cancelableEvent = (type, target) => {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'target', { value: target });
  return event;
};

async function controllerHarness(options = {}) {
  const { createFirePointerController } = await loadMobileCommand();
  const trigger = new FakeElement();
  const eventRoot = new EventTarget();
  const visibilityRoot = new EventTarget();
  visibilityRoot.hidden = false;
  const presses = [];
  const releases = [];
  const controller = createFirePointerController({
    element: trigger,
    eventRoot,
    visibilityRoot,
    onPress: pointerId => { presses.push(pointerId); return true; },
    onRelease: reason => releases.push(reason),
    ...options,
  });
  return { trigger, eventRoot, visibilityRoot, presses, releases, controller };
}

test('fire pointer owns its first pointer and releases only once after cancellation', async () => {
  const { trigger, presses, releases, controller } = await controllerHarness();
  trigger.dispatchEvent(pointer('pointerdown', 7));
  trigger.dispatchEvent(pointer('pointerdown', 8));
  assert.deepEqual(presses, [7]);
  assert.equal(controller.state().pointerId, 7);

  trigger.dispatchEvent(pointer('pointercancel', 7));
  assert.deepEqual(releases, ['pointercancel']);
  assert.equal(controller.state().held, false);

  trigger.dispatchEvent(pointer('pointerup', 7));
  assert.deepEqual(releases, ['pointercancel']);
});

for (const [label, eventType, root] of [
  ['pointerup', 'pointerup', 'trigger'],
  ['lost capture', 'lostpointercapture', 'trigger'],
  ['blur', 'blur', 'eventRoot'],
  ['pagehide', 'pagehide', 'eventRoot'],
]) {
  test(`fire pointer releases on ${label}`, async () => {
    const harness = await controllerHarness();
    harness.trigger.dispatchEvent(pointer('pointerdown', 7));
    harness[root].dispatchEvent(eventType === 'pointerup' || eventType === 'lostpointercapture'
      ? pointer(eventType, 7) : new Event(eventType));
    assert.deepEqual(harness.releases, [eventType]);
    assert.equal(harness.controller.state().held, false);
  });
}

test('fire pointer releases on hidden visibility and disabling', async () => {
  const visibility = await controllerHarness();
  visibility.trigger.dispatchEvent(pointer('pointerdown', 4));
  visibility.visibilityRoot.hidden = true;
  visibility.visibilityRoot.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(visibility.releases, ['visibilitychange']);

  const disabled = await controllerHarness();
  disabled.trigger.dispatchEvent(pointer('pointerdown', 5));
  disabled.controller.setEnabled(false);
  assert.deepEqual(disabled.releases, ['disabled']);
  assert.equal(disabled.controller.state().enabled, false);
});

test('fire pointer disposal releases ownership and permanently removes input listeners', async () => {
  const { trigger, releases, controller } = await controllerHarness();
  trigger.dispatchEvent(pointer('pointerdown', 3));
  controller.dispose();
  controller.dispose();
  trigger.dispatchEvent(pointer('pointerdown', 4));
  assert.deepEqual(releases, ['dispose']);
  assert.deepEqual(controller.state(), { enabled: true, held: false, pointerId: null, accepted: false });
});

test('secondary pointer release does not steal an owned press and a fresh press works after release', async () => {
  const { trigger, presses, releases, controller } = await controllerHarness();
  trigger.dispatchEvent(pointer('pointerdown', 9));
  trigger.dispatchEvent(pointer('pointerup', 10));
  assert.equal(controller.state().pointerId, 9);
  assert.deepEqual(releases, []);
  trigger.dispatchEvent(pointer('pointerup', 9));
  trigger.dispatchEvent(pointer('pointerdown', 10));
  assert.deepEqual(presses, [9, 10]);
  assert.equal(controller.state().pointerId, 10);
});

test('scoped gesture guards block Flightverse gestures but leave marked controls usable', async () => {
  const { installFlightSurfaceGuards } = await loadMobileCommand();
  const root = new EventTarget();
  const textNode = new FakeElement();
  const rangeInput = new FakeElement({ allowed: true });
  const guards = installFlightSurfaceGuards(root);

  for (const type of ['selectstart', 'dragstart', 'contextmenu']) {
    const blocked = cancelableEvent(type, textNode);
    root.dispatchEvent(blocked);
    assert.equal(blocked.defaultPrevented, true, `${type} should be blocked on the flight surface`);
  }
  const rangeSelection = cancelableEvent('selectstart', rangeInput);
  root.dispatchEvent(rangeSelection);
  assert.equal(rangeSelection.defaultPrevented, false);
  guards.dispose();

  const afterDispose = cancelableEvent('contextmenu', textNode);
  root.dispatchEvent(afterDispose);
  assert.equal(afterDispose.defaultPrevented, false);
});
