import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../web/flightverse/mobile-command.js', import.meta.url);

async function loadMobileCommand() {
  const source = await readFile(sourceUrl, 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

class FakeElement extends EventTarget {
  constructor({ allowSelector } = {}) {
    super();
    this.allowSelector = allowSelector;
    this.captures = new Set();
    this.listenerAdds = [];
    this.listenerRemovals = [];
  }
  closest(selector) {
    return selector.split(',').includes(this.allowSelector) ? this : null;
  }
  addEventListener(type, handler, options) {
    this.listenerAdds.push({ type, handler });
    super.addEventListener(type, handler, options);
  }
  removeEventListener(type, handler, options) {
    this.listenerRemovals.push({ type, handler });
    super.removeEventListener(type, handler, options);
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
  const eventRoot = new FakeElement();
  const visibilityRoot = new FakeElement();
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
  const { trigger, eventRoot, visibilityRoot, releases, controller } = await controllerHarness();
  trigger.dispatchEvent(pointer('pointerdown', 3));
  controller.dispose();
  controller.dispose();
  trigger.dispatchEvent(pointer('pointerdown', 4));
  assert.deepEqual(releases, ['dispose']);
  assert.deepEqual(controller.state(), { enabled: true, held: false, pointerId: null, accepted: false });
  const listenerEvents = (property) => [
    ['trigger', trigger],
    ['event root', eventRoot],
    ['visibility root', visibilityRoot],
  ].flatMap(([name, target]) => target[property].map(({ type }) => `${name}:${type}`));
  const expectedListeners = [
    'trigger:pointerdown',
    'trigger:pointerup',
    'trigger:pointercancel',
    'trigger:lostpointercapture',
    'event root:blur',
    'event root:pagehide',
    'visibility root:visibilitychange',
  ];
  assert.deepEqual(
    listenerEvents('listenerAdds'),
    expectedListeners,
    'controller registers the seven ownership listeners',
  );
  assert.deepEqual(
    listenerEvents('listenerRemovals'),
    expectedListeners,
    'dispose removes every registered listener exactly once',
  );
});

test('fire pointer rejects dynamic disabled state before capture or press', async () => {
  const { trigger, presses, controller } = await controllerHarness({ isEnabled: () => false });
  trigger.dispatchEvent(pointer('pointerdown', 12));

  assert.deepEqual(presses, []);
  assert.equal(trigger.captures.size, 0);
  assert.deepEqual(controller.state(), { enabled: true, held: false, pointerId: null, accepted: false });
});

test('fire pointer reports a rejected press exactly once on release', async () => {
  const releases = [];
  const { trigger, controller } = await controllerHarness({
    onPress: () => false,
    onRelease: (reason, event, accepted) => releases.push({ reason, accepted }),
  });
  trigger.dispatchEvent(pointer('pointerdown', 13));
  assert.equal(controller.state().accepted, false);
  trigger.dispatchEvent(pointer('pointerup', 13));
  trigger.dispatchEvent(pointer('pointercancel', 13));

  assert.deepEqual(releases, [{ reason: 'pointerup', accepted: false }]);
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

test('scoped gesture guards block Flightverse gestures but leave form controls usable', async () => {
  const { installFlightSurfaceGuards } = await loadMobileCommand();
  const root = new EventTarget();
  const textNode = new FakeElement();
  const guards = installFlightSurfaceGuards(root);

  for (const type of ['selectstart', 'dragstart', 'contextmenu']) {
    const blocked = cancelableEvent(type, textNode);
    root.dispatchEvent(blocked);
    assert.equal(blocked.defaultPrevented, true, `${type} should be blocked on the flight surface`);
  }
  for (const [label, allowSelector] of [
    ['range input', 'input[type="range"]'],
    ['input', 'input'],
    ['textarea', 'textarea'],
    ['select', 'select'],
    ['contenteditable', '[contenteditable="true"]'],
  ]) {
    const control = new FakeElement({ allowSelector });
    for (const type of ['selectstart', 'dragstart', 'contextmenu']) {
      const event = cancelableEvent(type, control);
      root.dispatchEvent(event);
      assert.equal(event.defaultPrevented, false, `${label} should allow ${type}`);
    }
  }
  guards.dispose();

  const afterDispose = cancelableEvent('contextmenu', textNode);
  root.dispatchEvent(afterDispose);
  assert.equal(afterDispose.defaultPrevented, false);
});
