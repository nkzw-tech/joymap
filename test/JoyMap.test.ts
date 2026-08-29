import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import createBaseModule from '../src/baseModule/base.ts';
import { clearRumble, hasRumbleChannels } from '../src/baseModule/rumble.ts';
import createController, { Controller } from '../src/controller.ts';
import createJoymap from '../src/JoyMap.ts';
import {
  createButtons,
  createGamepad,
  createHapticActuator,
  installNavigator,
  installWindow,
} from './fixtures.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('JoyMap polling and assignment', () => {
  it('accepts omitted options and onPoll callbacks', () => {
    installNavigator([createGamepad()]);

    expect(() => createJoymap().poll()).not.toThrow();
    expect(() => createJoymap({}).poll()).not.toThrow();
  });

  it('filters invalid gamepads and invokes onPoll', () => {
    const onPoll = vi.fn();
    installNavigator([
      null,
      createGamepad({ connected: false, id: 'disconnected' }),
      createGamepad({ id: 'valid', index: 3 }),
    ]);
    const joymap = createJoymap({ onPoll });

    joymap.poll();

    expect(joymap.getGamepads()).toEqual([expect.objectContaining({ id: 'valid' })]);
    expect(onPoll).toHaveBeenCalledOnce();
  });

  it('invokes onPoll when no controllers are connected', () => {
    installNavigator([]);
    const onPoll = vi.fn();
    const joymap = createJoymap({ onPoll });

    joymap.poll();

    expect(onPoll).toHaveBeenCalledOnce();
  });

  it('keeps previously returned gamepad lists stable across polls', () => {
    const gamepads: Array<Gamepad | null> = [createGamepad()];
    installNavigator(gamepads);
    const joymap = createJoymap({ onPoll: vi.fn() });

    joymap.poll();
    const firstPoll = joymap.getGamepads();
    expect(Object.isFrozen(firstPoll)).toBe(true);
    expect(() => (firstPoll as Array<Gamepad>).pop()).toThrow(TypeError);
    gamepads.length = 0;
    joymap.poll();

    expect(firstPoll).toHaveLength(1);
    expect(joymap.getGamepads()).toEqual([]);
    expect(joymap.getGamepads()).not.toBe(firstPoll);
  });

  it('connects, updates, and disconnects manually assigned controllers', () => {
    const gamepads: Array<Gamepad | null> = [createGamepad({ id: 'manual', index: 4 })];
    const getGamepads = installNavigator(gamepads);
    const onPoll = vi.fn();
    const { module, state } = createBaseModule({ gamepadIndex: 4 });
    const joymap = createJoymap({ onPoll });
    joymap.addController(module as unknown as Controller);

    joymap.poll();
    expect(module.isConnected()).toBe(true);
    expect(module.getGamepadIndex()).toBe(4);
    expect(state.pad.rawPad?.id).toBe('manual');

    gamepads.length = 0;
    getGamepads.mockImplementation(() => gamepads);
    joymap.poll();
    expect(module.isConnected()).toBe(false);
    expect(onPoll).toHaveBeenCalledTimes(2);
  });

  it('reconnects a disconnected controller when its assigned gamepad returns', () => {
    installNavigator([createGamepad({ id: 'returning', index: 7 })]);
    const { module } = createBaseModule({ gamepadIndex: 7 });
    module.disconnect();
    const assign = vi.spyOn(module, 'assign');
    const joymap = createJoymap({ onPoll: vi.fn() });
    joymap.addController(module as unknown as Controller);

    joymap.poll();
    expect(assign).not.toHaveBeenCalled();
    expect(module.isConnected()).toBe(true);
  });

  it('leaves disconnected controllers alone when auto-connect is disabled', () => {
    installNavigator([]);
    const { module } = createBaseModule();
    const disconnect = vi.spyOn(module, 'disconnect');
    const joymap = createJoymap({ onPoll: vi.fn() });
    joymap.addController(module as unknown as Controller);

    joymap.poll();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('auto-connects controllers and reports unused gamepad indexes', () => {
    installNavigator([
      createGamepad({ id: 'first', index: 0 }),
      createGamepad({ id: 'second', index: 1 }),
    ]);
    const first = createBaseModule();
    const second = createBaseModule();
    const joymap = createJoymap({ autoConnect: true, onPoll: vi.fn() });
    joymap.addController(first.module as unknown as Controller);

    joymap.poll();
    expect(first.module.getGamepadIndex()).toBe(0);
    expect(first.module.getGamepad()?.id).toBe('first');
    expect(first.state.pad.rawPad?.id).toBe('first');
    expect(joymap.getUnusedGamepadIndex()).toBe(1);
    expect(joymap.getUnusedGamepadIndexes()).toEqual([1]);

    joymap.addController(second.module as unknown as Controller);
    expect(second.module.getGamepadIndex()).toBe(1);
    joymap.poll();
    expect(second.module.getGamepad()?.id).toBe('second');
    expect(joymap.getUnusedGamepadIndex()).toBeUndefined();
    expect(joymap.getUnusedGamepadIndexes()).toEqual([]);
  });

  it('operates two controllers with identical IDs independently', () => {
    installNavigator([
      createGamepad({ axes: [0.8, 0, 0, 0], id: 'identical', index: 0 }),
      createGamepad({ axes: [0, -0.6, 0, 0], id: 'identical', index: 1 }),
    ]);
    const first = createController();
    const second = createController();
    const joymap = createJoymap({ autoConnect: true, onPoll: vi.fn() });
    joymap.addController(first);
    joymap.addController(second);

    joymap.poll();

    expect(first.getGamepadIndex()).toBe(0);
    expect(second.getGamepadIndex()).toBe(1);
    expect(first.getGamepad()?.id).toBe('identical');
    expect(second.getGamepad()?.id).toBe('identical');
    expect(first.getStick('L').value).toEqual([0.8, 0]);
    expect(second.getStick('L').value).toEqual([0, -0.6]);
    expect(joymap.getUnusedGamepadIndexes()).toEqual([]);
  });

  it('shares one current and previous snapshot between controllers on the same index', () => {
    installNavigator([
      createGamepad({
        axes: [0.5, -0.5],
        buttons: createButtons([1, 0]),
        index: 4,
        timestamp: 10,
      }),
    ]);
    const first = createBaseModule({ gamepadIndex: 4 });
    const second = createBaseModule({ gamepadIndex: 4 });
    const joymap = createJoymap({ onPoll: vi.fn() });
    joymap.addController(first.module as unknown as Controller);
    joymap.addController(second.module as unknown as Controller);

    joymap.poll();

    expect(first.state.pad).toBe(second.state.pad);
    expect(first.state.prevPad).toBe(second.state.prevPad);
    expect(first.state.pad.buttons).toBe(second.state.pad.buttons);
    expect(first.state.pad.pressedButtons).toBe(second.state.pad.pressedButtons);
    expect(first.state.pad.pressedButtons).toEqual([true, false]);
    expect(first.state.pad.axes).toBe(second.state.pad.axes);
  });

  it('double-buffers and resizes snapshot arrays when timestamps advance', () => {
    const gamepads: Array<Gamepad | null> = [
      createGamepad({ axes: [0, 0], buttons: createButtons([0]), timestamp: 1 }),
    ];
    installNavigator(gamepads);
    const { module, state } = createBaseModule({ gamepadIndex: 0 });
    const joymap = createJoymap({ onPoll: vi.fn() });
    joymap.addController(module as unknown as Controller);

    joymap.poll();
    const firstSnapshot = state.pad;
    const firstAxes = state.pad.axes;
    const firstButtons = state.pad.buttons;

    gamepads[0] = createGamepad({
      axes: [0.25, 0.5, 0.75],
      buttons: createButtons([1, 0.5, 0.25]),
      timestamp: 2,
    });
    joymap.poll();
    expect(state.prevPad).toBe(firstSnapshot);
    expect(state.pad).not.toBe(firstSnapshot);
    expect(state.pad.axes).toEqual([0.25, 0.5, 0.75]);
    expect(state.pad.buttons).toEqual([1, 0.5, 0.25]);

    gamepads[0] = createGamepad({
      axes: [-0.5],
      buttons: createButtons([0.75, 0]),
      timestamp: 3,
    });
    joymap.poll();
    expect(state.pad).toBe(firstSnapshot);
    expect(state.pad.axes).toBe(firstAxes);
    expect(state.pad.buttons).toBe(firstButtons);
    expect(state.pad.axes).toEqual([-0.5]);
    expect(state.pad.buttons).toEqual([0.75, 0]);
  });

  it('skips unchanged timestamps while expiring justChanged after one poll', () => {
    const gamepads: Array<Gamepad | null> = [
      createGamepad({ buttons: createButtons([1]), timestamp: 1 }),
    ];
    installNavigator(gamepads);
    const module = createController({ gamepadIndex: 0 });
    const joymap = createJoymap({ onPoll: vi.fn() });
    joymap.addController(module as unknown as Controller);

    joymap.poll();
    expect(module.getButton('A')).toMatchObject({ justChanged: true, pressed: true, value: 1 });

    gamepads[0] = createGamepad({ buttons: createButtons([0]), timestamp: 1 });
    joymap.poll();
    expect(module.getButton('A')).toMatchObject({ justChanged: false, pressed: true, value: 1 });

    gamepads[0] = createGamepad({ buttons: createButtons([0]), timestamp: 2 });
    joymap.poll();
    expect(module.getButton('A')).toMatchObject({ justChanged: true, pressed: false, value: 0 });
  });

  it('copies changing input from gamepads whose timestamp remains zero', () => {
    const axes = [0.5, 0, 0, 0];
    installNavigator([createGamepad({ axes, timestamp: 0 })]);
    const module = createController({ gamepadIndex: 0 });
    const joymap = createJoymap();
    joymap.addController(module as unknown as Controller);

    joymap.poll();
    expect(module.getStick('L').value[0]).toBe(0.5);

    axes[0] = -0.75;
    joymap.poll();
    expect(module.getStick('L').value[0]).toBe(-0.75);
  });

  it('drops snapshots for disconnected indexes before they reconnect', () => {
    const gamepads: Array<Gamepad | null> = [
      createGamepad({ buttons: createButtons([1]), timestamp: 1 }),
    ];
    installNavigator(gamepads);
    const module = createController({ gamepadIndex: 0 });
    const joymap = createJoymap({ onPoll: vi.fn() });
    joymap.addController(module as unknown as Controller);

    joymap.poll();
    gamepads.length = 0;
    joymap.poll();
    gamepads.push(createGamepad({ buttons: createButtons([1]), timestamp: 1 }));
    joymap.poll();

    expect(module.getButton('A')).toMatchObject({ justChanged: true, pressed: true });
  });

  it('clears and resets rumble state when a controller disconnects', async () => {
    const actuator = createHapticActuator();
    actuator.reset.mockRejectedValue(new Error('disconnected'));
    const gamepads: Array<Gamepad | null> = [
      createGamepad({ index: 9, vibrationActuator: actuator }),
    ];
    installNavigator(gamepads);
    const { module } = createBaseModule({ gamepadIndex: 9 });
    const joymap = createJoymap({ onPoll: vi.fn() });
    joymap.addController(module as unknown as Controller);

    joymap.poll();
    module.addRumble({ duration: 100, strongMagnitude: 1 });
    expect(hasRumbleChannels(9)).toBe(true);

    gamepads.length = 0;
    joymap.poll();
    await Promise.resolve();

    expect(hasRumbleChannels(9)).toBe(false);
    expect(actuator.reset).toHaveBeenCalledOnce();
    clearRumble(9);
  });

  it('exposes controllers and destroys removed and cleared controllers', () => {
    installNavigator([]);
    const first = createBaseModule();
    const second = createBaseModule();
    const firstDestroy = vi.spyOn(first.module, 'destroy');
    const secondDestroy = vi.spyOn(second.module, 'destroy');
    const joymap = createJoymap({ onPoll: vi.fn() });

    expect(joymap.addController(first.module as unknown as Controller)).toBe(first.module);
    expect(joymap.addController(first.module as unknown as Controller)).toBe(first.module);
    joymap.addController(second.module as unknown as Controller);
    expect(joymap.getControllers()).toEqual([first.module, second.module]);
    const controllers = joymap.getControllers() as Array<Controller>;
    controllers.length = 0;
    expect(joymap.getControllers()).toEqual([first.module, second.module]);

    expect(joymap.removeController(first.module as unknown as Controller)).toBe(true);
    expect(joymap.removeController(first.module as unknown as Controller)).toBe(false);
    expect(firstDestroy).toHaveBeenCalledOnce();
    expect(first.module.getGamepadIndex()).toBeNull();
    expect(joymap.getControllers()).toEqual([second.module]);

    joymap.clearControllers();
    expect(secondDestroy).toHaveBeenCalledOnce();
    expect(joymap.getControllers()).toEqual([]);
  });
});

describe('JoyMap animation loop', () => {
  it('starts once, installs listeners, and stops cleanly', () => {
    installNavigator([createGamepad()]);
    const browser = installWindow();
    const onPoll = vi.fn();
    const joymap = createJoymap({ onPoll });

    joymap.start();
    joymap.start();
    expect(onPoll).toHaveBeenCalledOnce();
    expect(browser.requestAnimationFrame).toHaveBeenCalledOnce();
    expect(browser.addEventListener).toHaveBeenCalledTimes(2);

    joymap.stop();
    expect(browser.cancelAnimationFrame).toHaveBeenCalledOnce();
    expect(browser.removeEventListener).toHaveBeenCalledTimes(2);
  });

  it('runs frames while connected and stops scheduling once no gamepads remain', () => {
    const gamepads: Array<Gamepad | null> = [createGamepad()];
    installNavigator(gamepads);
    const browser = installWindow();
    const onPoll = vi.fn();
    const joymap = createJoymap({ onPoll });
    joymap.start();

    browser.runFrame(1);
    expect(browser.callbacks.has(2)).toBe(true);

    gamepads.length = 0;
    browser.runFrame(2);
    expect(browser.callbacks.size).toBe(0);
    expect(onPoll).toHaveBeenCalledTimes(3);

    joymap.stop();
    expect(browser.cancelAnimationFrame).not.toHaveBeenCalled();
  });

  it('restarts from gamepad events after an empty loop', () => {
    installNavigator([]);
    const browser = installWindow();
    const joymap = createJoymap({ onPoll: vi.fn() });
    joymap.start();
    browser.runFrame(1);

    browser.listeners.get('gamepadconnected')?.(new Event('gamepadconnected'));
    expect(browser.requestAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it('does not schedule when stop is called during the initial onPoll', () => {
    installNavigator([createGamepad()]);
    const browser = installWindow();
    const state: { joymap?: ReturnType<typeof createJoymap> } = {};
    const onPoll = vi.fn(() => state.joymap?.stop());
    const joymap = createJoymap({ onPoll });
    state.joymap = joymap;

    joymap.start();
    expect(browser.callbacks.size).toBe(0);
    expect(browser.requestAnimationFrame).not.toHaveBeenCalled();
    expect(browser.removeEventListener).toHaveBeenCalledTimes(2);
  });

  it('does not reschedule when stop is called during a frame onPoll', () => {
    installNavigator([createGamepad()]);
    const browser = installWindow();
    const state: { joymap?: ReturnType<typeof createJoymap> } = {};
    const onPoll = vi.fn(() => {
      if (onPoll.mock.calls.length === 2) {
        state.joymap?.stop();
      }
    });
    const joymap = createJoymap({ onPoll });
    state.joymap = joymap;

    joymap.start();
    browser.runFrame(1);
    expect(browser.callbacks.size).toBe(0);
    expect(browser.requestAnimationFrame).toHaveBeenCalledOnce();
    expect(browser.removeEventListener).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale frame callback that arrives after stop', () => {
    installNavigator([createGamepad()]);
    const browser = installWindow();
    const onPoll = vi.fn();
    const joymap = createJoymap({ onPoll });

    joymap.start();
    const staleFrame = browser.callbacks.get(1);
    joymap.stop();
    staleFrame?.(0);

    expect(onPoll).toHaveBeenCalledOnce();
    expect(browser.callbacks.size).toBe(0);
  });

  it('can restart after onPoll throws during initial polling', () => {
    installNavigator([]);
    const browser = installWindow();
    const onPoll = vi.fn(() => {
      if (onPoll.mock.calls.length === 1) {
        throw new Error('poll failed');
      }
    });
    const joymap = createJoymap({ onPoll });

    expect(() => joymap.start()).toThrow('poll failed');
    expect(browser.removeEventListener).toHaveBeenCalledTimes(2);

    joymap.start();
    expect(onPoll).toHaveBeenCalledTimes(2);
    expect(browser.requestAnimationFrame).toHaveBeenCalledOnce();
  });

  it('can restart after onPoll throws during an animation frame', () => {
    installNavigator([createGamepad()]);
    const browser = installWindow();
    const onPoll = vi.fn(() => {
      if (onPoll.mock.calls.length === 2) {
        throw new Error('frame failed');
      }
    });
    const joymap = createJoymap({ onPoll });

    joymap.start();
    expect(() => browser.runFrame(1)).toThrow('frame failed');
    expect(browser.callbacks.size).toBe(0);

    joymap.start();
    expect(onPoll).toHaveBeenCalledTimes(3);
    expect(browser.callbacks.has(2)).toBe(true);
  });

  it('connects otherwise unassigned controllers during start', () => {
    installNavigator([createGamepad({ id: 'start-pad' })]);
    installWindow();
    const { module } = createBaseModule();
    const joymap = createJoymap({ autoConnect: true, onPoll: vi.fn() });
    joymap.addController(module as unknown as Controller);

    joymap.start();
    expect(module.getGamepadIndex()).toBe(0);
    expect(module.getGamepad()?.id).toBe('start-pad');
  });

  it('cannot assign a controller during start when no gamepad is available', () => {
    installNavigator([]);
    installWindow();
    const { module } = createBaseModule();
    const assign = vi.spyOn(module, 'assign');
    const joymap = createJoymap({ autoConnect: true, onPoll: vi.fn() });
    joymap.addController(module as unknown as Controller);

    joymap.start();
    expect(assign).not.toHaveBeenCalled();
  });
});
