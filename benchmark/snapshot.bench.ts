import { afterAll, describe, test } from 'vite-plus/test';
import createBaseModule from '../src/baseModule/base.ts';
import { createControllerFromModule } from '../src/controller.ts';
import createJoymap from '../src/JoyMap.ts';
import { createGamepad } from '../test/fixtures.ts';

const moduleCount = 8;
const axes = [0, 0, 0, 0];
const buttons = Array.from({ length: 17 }, () => ({
  pressed: false,
  touched: false,
  value: 0,
}));
let timestamp = 1;

const gamepad = createGamepad({ axes, buttons, id: 'snapshot-benchmark' });
Object.defineProperty(gamepad, 'timestamp', { get: () => timestamp });

const gamepads = [gamepad];
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { getGamepads: () => gamepads },
});

afterAll(() => {
  if (navigatorDescriptor) {
    Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'navigator');
  }
});

const sharedModules = Array.from({ length: moduleCount }, () =>
  createBaseModule({ gamepadIndex: 0 }),
);
const joymap = createJoymap();
for (const base of sharedModules) {
  joymap.addController(createControllerFromModule(base));
}

const perModuleSnapshots = Array.from({ length: moduleCount }, () =>
  createBaseModule({ gamepadIndex: 0 }),
);

const advanceGamepad = () => {
  timestamp += 1;
  axes[0] = Math.sin(timestamp) * 0.9;
  axes[1] = Math.cos(timestamp) * 0.9;
  buttons[0].value = timestamp % 2;
  buttons[0].pressed = buttons[0].value === 1;
  buttons[0].touched = buttons[0].pressed;
};

advanceGamepad();
joymap.poll();
for (const { module } of perModuleSnapshots) {
  module.update(gamepad);
}

describe(`snapshot polling with ${moduleCount} controllers`, () => {
  test('one shared snapshot per controller index', async ({ bench }) => {
    await bench('one shared snapshot per controller index', () => {
      advanceGamepad();
      joymap.poll();
    }).run();
  });

  test('one fallback snapshot per controller', async ({ bench }) => {
    await bench('one fallback snapshot per controller', () => {
      advanceGamepad();
      for (const { module } of perModuleSnapshots) {
        module.update(gamepad);
      }
    }).run();
  });
});
