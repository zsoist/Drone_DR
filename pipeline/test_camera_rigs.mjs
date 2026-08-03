import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAMERA_RIGS,
  createCameraRigController,
} from '../web/flightverse/camera-rigs.js';

const frame = ({
  yaw = 0,
  pitch = 0,
  speed = 0,
  velocity = null,
  dt = 1,
} = {}) => ({
  dronePosition: { x: 4, y: 18, z: -7 },
  dronePose: { yaw, pitch },
  velocity: velocity || { x: 0, y: 0, z: -speed },
  dt,
});

const allFinite = values => values.every(Number.isFinite);

test('camera metadata is immutable and contains every gameplay rig', () => {
  assert.deepEqual(
    CAMERA_RIGS.map(rig => rig.key),
    ['muycerca', 'cerca', 'lejos', 'fpv', 'top', 'orbit', 'lado'],
  );
  assert.equal(Object.isFrozen(CAMERA_RIGS), true);
  for (const rig of CAMERA_RIGS) assert.equal(Object.isFrozen(rig), true);
});

test('gimbal changes FPV pitch but cannot rotate Cenital or Orbit', () => {
  const controller = createCameraRigController({ initialKey: 'fpv' });
  assert.equal(controller.snapshot().gimbalOwner, 'fpv');
  controller.setGimbalRadians(-Math.PI / 3);
  controller.update(frame());
  const fpv = controller.snapshot();

  controller.select('top');
  controller.update(frame());
  const topBefore = controller.snapshot();
  assert.equal(topBefore.gimbalOwner, 'none');
  controller.setGimbalRadians(Math.PI / 8);
  controller.update(frame());
  const topAfter = controller.snapshot();
  assert.deepEqual(topAfter.quaternion, topBefore.quaternion);

  controller.select('orbit');
  controller.update(frame());
  const orbitBefore = controller.snapshot();
  assert.equal(orbitBefore.gimbalOwner, 'none');
  controller.setGimbalRadians(-Math.PI / 2);
  controller.update(frame({ dt: 0 }));
  assert.deepEqual(controller.snapshot().quaternion, orbitBefore.quaternion);
  assert.notDeepEqual(fpv.quaternion, topBefore.quaternion);
});

test('Cenital keeps a finite orthonormal basis and less than half-degree roll', () => {
  const controller = createCameraRigController({ initialKey: 'fpv' });
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    controller.select('top');
    controller.update(frame({ yaw }));
    const state = controller.snapshot();
    assert.equal(state.key, 'top');
    assert.equal(state.finite, true);
    assert.ok(allFinite(state.position));
    assert.ok(allFinite(state.quaternion));
    assert.ok(Math.abs(state.rollDegrees) < 0.5, `roll=${state.rollDegrees}`);
    assert.ok(Math.abs(state.forward[1] + 1) < 1e-6, `forward=${state.forward}`);
    const qLength = Math.hypot(...state.quaternion);
    assert.ok(Math.abs(qLength - 1) < 1e-9, `quaternion length=${qLength}`);
  }
});

test('Orbit resets local phase and keeps a premium close-action radius inside 5.5..16m', () => {
  const controller = createCameraRigController({ initialKey: 'orbit' });
  controller.update(frame({ speed: 0, dt: 0 }));
  assert.equal(controller.snapshot().radius, 5.5);
  controller.update(frame({ speed: 60, dt: 1 }));
  assert.equal(controller.snapshot().radius, 16);
  assert.ok(controller.snapshot().phase > 0);

  controller.select('fpv');
  controller.update(frame());
  controller.select('orbit');
  assert.equal(controller.snapshot().phase, 0);
  controller.update(frame({ speed: 8, dt: 0 }));
  assert.equal(controller.snapshot().radius, 7.5);
});

test('invalid rig and gimbal values fail closed to FPV and -7 degrees', () => {
  const controller = createCameraRigController({ initialKey: 'missing' });
  assert.equal(controller.snapshot().key, 'fpv');
  assert.ok(Math.abs(controller.snapshot().gimbalRadians - (-7 * Math.PI / 180)) < 1e-12);

  controller.setGimbalRadians(Number.NaN);
  assert.ok(Math.abs(controller.snapshot().gimbalRadians - (-7 * Math.PI / 180)) < 1e-12);
  controller.setGimbalRadians(-Math.PI);
  assert.equal(controller.snapshot().gimbalRadians, -Math.PI / 2);
  controller.setGimbalRadians(Math.PI);
  assert.equal(controller.snapshot().gimbalRadians, 25 * Math.PI / 180);
});
