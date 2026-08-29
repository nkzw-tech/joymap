import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import createBaseModule from '../src/baseModule/base.ts';
import { clearRumble, hasRumbleChannels } from '../src/baseModule/rumble.ts';
import { createButtons, createGamepad, createHapticActuator } from './fixtures.ts';

const createPadWithAxes = (axes: ReadonlyArray<number>, id = 'axes-pad') =>
  createGamepad({ axes, id });

const createPadWithButtons = (values: ReadonlyArray<number>, id = 'button-pad') =>
  createGamepad({ buttons: createButtons(values), id });

afterEach(() => {
  clearRumble(0);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('controller base state', () => {
  it('applies defaults after a standard gamepad and accepts zero thresholds', () => {
    const defaultModule = createBaseModule();
    const configured = createBaseModule({
      buttonThreshold: 0,
      clampThreshold: false,
      gamepadIndex: 4,
      stickDeadzone: 0,
    });

    expect(defaultModule.state.buttons).toEqual({});
    expect(defaultModule.state.sticks).toEqual({});
    defaultModule.module.update(createGamepad());
    expect(defaultModule.state.buttons).toMatchObject({ A: [0], home: [16], start: [9] });
    expect(defaultModule.state.sticks).toEqual({
      L: { indexes: [[0, 1]], inverts: [false, false] },
      R: { indexes: [[2, 3]], inverts: [false, false] },
    });
    expect(defaultModule.state.clampThreshold).toBe(true);
    expect(configured.state.clampThreshold).toBe(false);
    expect(configured.state.buttonThreshold).toBe(0);
    expect(configured.state.stickDeadzone).toBe(0);
    expect(configured.module.getGamepadIndex()).toBe(4);
    expect(configured.module.isConnected()).toBe(false);
  });

  it('validates thresholds, release points, and gamepad indexes', () => {
    for (const params of [
      { buttonReleaseThreshold: Number.NaN },
      { buttonThreshold: Number.POSITIVE_INFINITY },
      { stickDeadzone: -0.1 },
      { stickReleaseDeadzone: 1.1 },
    ]) {
      expect(() => createBaseModule(params)).toThrow(RangeError);
    }

    expect(() => createBaseModule({ buttonReleaseThreshold: 0.6, buttonThreshold: 0.5 })).toThrow(
      'buttonReleaseThreshold must not exceed buttonThreshold',
    );
    expect(() => createBaseModule({ stickDeadzone: 0.5, stickReleaseDeadzone: 0.6 })).toThrow(
      'stickReleaseDeadzone must not exceed stickDeadzone',
    );
    expect(() => createBaseModule({ gamepadIndex: -1 })).toThrow(
      'gamepadIndex must be a non-negative integer',
    );

    const configured = createBaseModule({
      buttonReleaseThreshold: 0.6,
      buttonThreshold: 0.7,
      stickDeadzone: 0.4,
      stickReleaseDeadzone: 0.3,
    });
    expect(configured.state).toMatchObject({
      buttonReleaseThreshold: 0.6,
      buttonThreshold: 0.7,
      stickDeadzone: 0.4,
      stickReleaseDeadzone: 0.3,
    });
  });

  it('only installs the default layout for standard-mapped gamepads', () => {
    const customizedDefaults = createBaseModule();
    customizedDefaults.module.setButton('A', [7]);
    customizedDefaults.module.setStick('L', [[6, 7]]);
    customizedDefaults.module.update(createGamepad({ mapping: 'standard' }));
    expect(customizedDefaults.state.buttons.A).toEqual([7]);
    expect(customizedDefaults.state.sticks.L.indexes).toEqual([[6, 7]]);

    const nonstandard = createBaseModule();
    nonstandard.module.setButton('custom', [2]);
    nonstandard.module.setStick('custom', [[4, 5]]);
    nonstandard.module.update(createGamepad({ mapping: '' }));
    expect(nonstandard.state.buttons).toEqual({ custom: [2] });
    expect(nonstandard.state.sticks).toEqual({
      custom: { indexes: [[4, 5]], inverts: [false, false] },
    });

    nonstandard.module.update(createGamepad({ mapping: 'standard' }));
    expect(nonstandard.state.buttons).toMatchObject({ A: [0], custom: [2] });
    expect(nonstandard.state.sticks).toMatchObject({
      custom: { indexes: [[4, 5]], inverts: [false, false] },
      L: { indexes: [[0, 1]], inverts: [false, false] },
    });

    nonstandard.module.setButton('A', [7]);
    nonstandard.module.setStick('L', [[6, 7]]);
    nonstandard.module.update(createGamepad({ mapping: '' }));
    expect(nonstandard.state.buttons).toEqual({ A: [7], custom: [2] });
    expect(nonstandard.state.sticks).toEqual({
      custom: { indexes: [[4, 5]], inverts: [false, false] },
      L: { indexes: [[6, 7]], inverts: [false, false] },
    });
  });

  it('assigns by index, tracks a live gamepad, unassigns, and destroys', () => {
    const { module, state } = createBaseModule();

    module.assign(0);
    expect(module.isConnected()).toBe(false);
    expect(module.getGamepadIndex()).toBe(0);
    expect(module.getGamepad()).toBeNull();

    const gamepad = createGamepad({ id: 'first', index: 0 });
    module.update(gamepad);
    expect(module.isConnected()).toBe(true);
    expect(module.getGamepadIndex()).toBe(0);
    expect(module.getGamepad()).toBe(gamepad);

    module.disconnect();
    expect(module.isConnected()).toBe(false);
    expect(module.getGamepadIndex()).toBe(0);
    expect(module.getGamepad()).toBeNull();

    module.unassign();
    expect(module.getGamepadIndex()).toBeNull();

    module.destroy();
    expect(module.isConnected()).toBe(false);
    expect(state.pad.rawPad).toBeUndefined();
    expect(state.prevPad.rawPad).toBeUndefined();
  });

  it('validates assigned gamepad indexes', () => {
    const { module } = createBaseModule({ gamepadIndex: 2 });
    expect(() => module.assign(2)).not.toThrow();
    expect(() => module.assign(-1)).toThrow('gamepadIndex must be a non-negative integer');
    expect(() => module.assign(0.5)).toThrow('gamepadIndex must be a non-negative integer');
  });

  it('returns deduplicated button and stick index arrays', () => {
    const { module } = createBaseModule();
    module.update(createGamepad());

    module.setButton('combo', [0, 1]);
    module.setStick('combined', [
      [0, 1],
      [4, 5],
    ]);
    expect(module.getButtonIndexes('A', 'combo')).toEqual([0, 1]);
    expect(module.getButtonIndexes('missing')).toEqual([]);
    expect(module.getStickIndexes('L', 'R', 'combined')).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
    expect(module.getStickIndexes('missing')).toEqual([]);
  });

  it('sets, validates, inverts, and swaps mappings', () => {
    const { module, state } = createBaseModule();
    module.update(createGamepad());

    expect(() => module.setButton('not valid', [1])).toThrow('invalid characters');
    expect(() => module.setButton('invalid', [-1])).toThrow('non-negative integers');
    expect(() => module.setStick('not valid', [[0, 1]])).toThrow('invalid characters');
    expect(() => module.setStick('empty', [])).toThrow('empty array');
    expect(() => module.setStick('emptyAxes', [[]])).toThrow('same non-zero length');
    expect(() => module.setStick('uneven', [[0, 1], [2]])).toThrow('same non-zero length');
    expect(() => module.setStick('invalidIndex', [[0, -1]])).toThrow('non-negative integers');
    expect(() => module.setStick('invalidInverts', [[0, 1]], [true])).toThrow(
      'inverts must match the axis count',
    );

    module.setButton('jump', [3]);
    module.setStick('camera', [[4, 5]]);
    module.setStick('flight', [[6, 7]], [true, false]);
    expect(state.buttons.jump).toEqual([3]);
    expect(state.sticks.camera).toEqual({ indexes: [[4, 5]], inverts: [false, false] });
    expect(state.sticks.flight.inverts).toEqual([true, false]);

    module.invertSticks([true, false], 'L', 'R');
    expect(state.sticks.L.inverts).toEqual([true, false]);
    expect(() => module.invertSticks([true], 'L')).toThrow("inverts' length does not match");
    expect(() => module.invertSticks([true, false], 'missing')).toThrow("unknown stick 'missing'");

    module.swapButtons('A', 'B');
    expect(state.buttons.A).toEqual([1]);
    expect(state.buttons.B).toEqual([0]);
    expect(() => module.swapButtons('A', 'missing')).toThrow("unknown button 'missing'");
    expect(() => module.swapButtons('missing', 'A')).toThrow("unknown button 'missing'");

    module.swapSticks('L', 'R');
    expect(state.sticks.L.indexes).toEqual([[2, 3]]);
    expect(state.sticks.L.inverts).toEqual([true, false]);

    module.swapSticks('L', 'R', true);
    expect(state.sticks.L.indexes).toEqual([[0, 1]]);
    expect(() => module.swapSticks('L', 'missing')).toThrow("unknown stick 'missing'");
    expect(() => module.swapSticks('missing', 'L')).toThrow("unknown stick 'missing'");
  });

  it('clones and freezes mapping metadata', () => {
    const { module, state } = createBaseModule();
    const buttonIndexes = [2];
    const stickIndexes = [[4, 5]];
    const inverts = [false, true];

    module.setButton('custom', buttonIndexes);
    module.setStick('custom', stickIndexes, inverts);
    buttonIndexes[0] = 9;
    stickIndexes[0][0] = 9;
    inverts[0] = true;

    expect(state.buttons.custom).toEqual([2]);
    expect(state.sticks.custom).toEqual({ indexes: [[4, 5]], inverts: [false, true] });
    expect(Object.isFrozen(state.buttons.custom)).toBe(true);
    expect(Object.isFrozen(state.sticks.custom.indexes)).toBe(true);
    expect(Object.isFrozen(state.sticks.custom.indexes[0])).toBe(true);
    expect(Object.isFrozen(state.sticks.custom.inverts)).toBe(true);
  });

  it('reuses press-state records across updates', () => {
    const { module, state } = createBaseModule();
    module.update(createGamepad());
    const buttonState = state.buttonPressStates.A;
    const stickState = state.stickPressStates.L;

    module.update(createGamepad({ timestamp: 2 }));

    expect(state.buttonPressStates.A).toBe(buttonState);
    expect(state.stickPressStates.L).toBe(stickState);
  });

  it('reports rumble support from arguments and current state', () => {
    const { module } = createBaseModule();
    const actuator = createHapticActuator();

    expect(module.isRumbleSupported()).toBeNull();
    expect(module.isRumbleSupported(createGamepad())).toBe(false);
    expect(module.isRumbleSupported(createGamepad({ vibrationActuator: actuator }))).toBe(true);

    module.update(createGamepad({ vibrationActuator: actuator }));
    expect(module.isRumbleSupported()).toBe(true);
  });

  it('creates a new current snapshot and button array on every update', () => {
    const { module, state } = createBaseModule();
    const first = createPadWithButtons([0.5], 'snapshot');
    const second = createPadWithButtons([1], 'snapshot');

    module.update(first);
    const firstSnapshot = state.pad;
    module.update(second);

    expect(state.prevPad).toBe(firstSnapshot);
    expect(state.pad).not.toBe(firstSnapshot);
    expect(state.pad.buttons).not.toBe(first.buttons);
    expect(state.pad.buttons).toEqual([1]);
  });
});

describe('input listeners', () => {
  it('listens for buttons by poll count and can be cancelled', () => {
    const { module } = createBaseModule();
    const callback = vi.fn();

    module.listenButton(callback, 1, { waitFor: [2, 'polls'] });
    module.update(createPadWithButtons([1]));
    expect(callback).not.toHaveBeenCalled();
    module.update(createPadWithButtons([1]));
    expect(callback).toHaveBeenCalledWith([0]);

    module.listenButton(callback);
    module.cancelListen();
    module.update(createPadWithButtons([1]));
    expect(callback).toHaveBeenCalledOnce();
  });

  it('resets poll listeners when the input stops matching', () => {
    const { module } = createBaseModule();
    const callback = vi.fn();

    module.listenButton(callback, 1, { waitFor: [2, 'polls'] });
    module.update(createPadWithButtons([1]));
    module.update(createPadWithButtons([0]));
    module.update(createPadWithButtons([1]));
    expect(callback).not.toHaveBeenCalled();
  });

  it('listens for consecutive, aligned axes after a duration', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { module } = createBaseModule();
    const callback = vi.fn();

    module.listenAxis(callback, 2, { allowOffset: false, waitFor: [100, 'ms'] });
    module.update(createPadWithAxes([0, 0.8, 0.8, 0]));
    vi.advanceTimersByTime(100);
    module.update(createPadWithAxes([0, 0.8, 0.8, 0]));
    expect(callback).not.toHaveBeenCalled();

    module.update(createPadWithAxes([0.8, 0.8, 0, 0]));
    vi.advanceTimersByTime(99);
    module.update(createPadWithAxes([0.8, 0.8, 0, 0]));
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    module.update(createPadWithAxes([0.8, 0.8, 0, 0]));
    expect(callback).toHaveBeenCalledWith([[0, 1]]);
  });

  it('supports nonconsecutive button groups', () => {
    const { module } = createBaseModule();
    const callback = vi.fn();

    module.listenButton(callback, 2, { consecutive: false });
    module.update(createPadWithButtons([1, 0, 1]));
    expect(callback).toHaveBeenCalledWith([0, 2]);
  });

  it('supports axis poll counts and monotonic button durations', () => {
    vi.useFakeTimers();
    const axisModule = createBaseModule();
    const axisCallback = vi.fn();
    axisModule.module.listenAxis(axisCallback, 2, { waitFor: [2, 'polls'] });
    axisModule.module.update(createPadWithAxes([0.8, 0.8]));
    axisModule.module.update(createPadWithAxes([0.8, 0.8]));
    expect(axisCallback).toHaveBeenCalledWith([[0, 1]]);

    const buttonModule = createBaseModule();
    const buttonCallback = vi.fn();
    buttonModule.module.listenButton(buttonCallback, 1, { waitFor: [10, 'ms'] });
    buttonModule.module.update(createPadWithButtons([1]));
    vi.advanceTimersByTime(10);
    buttonModule.module.update(createPadWithButtons([1]));
    expect(buttonCallback).toHaveBeenCalledWith([0]);
  });
});

describe('binding helpers', () => {
  it('validates names and swaps existing button bindings', () => {
    const { module, state } = createBaseModule();
    const callback = vi.fn();

    expect(() => module.buttonBindOnPress('not valid', callback)).toThrow('invalid characters');

    module.buttonBindOnPress('A', callback);
    module.update(createPadWithButtons([0, 1]));
    expect(callback).toHaveBeenCalledWith('B');
    expect(state.buttons.A).toEqual([1]);
    expect(state.buttons.B).toEqual([0]);
  });

  it('duplicates or creates button bindings when requested', () => {
    const duplicated = createBaseModule();
    duplicated.module.buttonBindOnPress('A', vi.fn(), true);
    duplicated.module.update(createPadWithButtons([0, 1]));
    expect(duplicated.state.buttons.A).toEqual([1]);
    expect(duplicated.state.buttons.B).toEqual([1]);

    const created = createBaseModule();
    const callback = vi.fn();
    created.module.buttonBindOnPress('extra', callback);
    created.module.update(createPadWithButtons([...Array.from({ length: 17 }, () => 0), 1]));
    expect(created.state.buttons.extra).toEqual([17]);
    expect(callback).not.toHaveBeenCalled();
  });

  it('validates names and swaps existing stick bindings', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { module, state } = createBaseModule();
    const callback = vi.fn();

    expect(() => module.stickBindOnPress('not valid', callback)).toThrow('invalid characters');

    module.stickBindOnPress('L', callback);
    module.update(createPadWithAxes([0, 0, 0.8, 0.8]));
    vi.advanceTimersByTime(100);
    module.update(createPadWithAxes([0, 0, 0.8, 0.8]));
    expect(callback).toHaveBeenCalledWith('R');
    expect(state.sticks.L.indexes).toEqual([[2, 3]]);
  });

  it('duplicates or creates stick bindings when requested', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const duplicated = createBaseModule();
    duplicated.module.stickBindOnPress('L', vi.fn(), true);
    duplicated.module.update(createPadWithAxes([0, 0, 0.8, 0.8]));
    vi.advanceTimersByTime(100);
    duplicated.module.update(createPadWithAxes([0, 0, 0.8, 0.8]));
    expect(duplicated.state.sticks.L.indexes).toEqual([[2, 3]]);
    expect(duplicated.state.sticks.R.indexes).toEqual([[2, 3]]);

    const created = createBaseModule();
    const callback = vi.fn();
    created.module.stickBindOnPress('extra', callback);
    created.module.update(createPadWithAxes([0, 0, 0, 0, 0.8, 0.8]));
    vi.advanceTimersByTime(100);
    created.module.update(createPadWithAxes([0, 0, 0, 0, 0.8, 0.8]));
    expect(created.state.sticks.extra.indexes).toEqual([[4, 5]]);
    expect(callback).not.toHaveBeenCalled();
  });

  it('compares candidate stick dimensions before creating a binding', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const differentStickCount = createBaseModule();
    differentStickCount.module.setStick('L', [
      [4, 5],
      [6, 7],
    ]);
    differentStickCount.module.setStick('R', [
      [4, 5],
      [6, 7],
    ]);
    differentStickCount.module.stickBindOnPress('newStick', vi.fn());
    differentStickCount.module.update(createPadWithAxes([0.8, 0.8]));
    vi.advanceTimersByTime(100);
    differentStickCount.module.update(createPadWithAxes([0.8, 0.8]));
    expect(differentStickCount.state.sticks.newStick.indexes).toEqual([[0, 1]]);

    const differentAxisCount = createBaseModule();
    differentAxisCount.module.setStick('L', [[0]]);
    differentAxisCount.module.setStick('R', [[2]]);
    differentAxisCount.module.stickBindOnPress('newStick', vi.fn());
    differentAxisCount.module.update(createPadWithAxes([0.8, 0.8]));
    vi.advanceTimersByTime(100);
    differentAxisCount.module.update(createPadWithAxes([0.8, 0.8]));
    expect(differentAxisCount.state.sticks.newStick.indexes).toEqual([[0, 1]]);
  });
});

describe('rumble integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
  });

  it('ignores rumble commands until a raw gamepad is available', () => {
    const { module } = createBaseModule();
    module.addRumble({ duration: 10, strongMagnitude: 1 });
    module.stopRumble();
  });

  it('advances timelines before applying effects and periodically refreshes them', () => {
    const actuator = createHapticActuator();
    const gamepad = createGamepad({ id: 'integration-rumble', vibrationActuator: actuator });
    const { module } = createBaseModule();

    module.update(gamepad);
    vi.advanceTimersByTime(1000);
    module.addRumble([{ duration: 10, strongMagnitude: 1 }, 5, { duration: 20, weakMagnitude: 1 }]);
    module.update(gamepad);
    expect(actuator.playEffect).toHaveBeenCalledWith(
      'dual-rumble',
      expect.objectContaining({ strongMagnitude: 1 }),
    );

    vi.setSystemTime(10_000);
    module.update(gamepad);
    expect(actuator.playEffect).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(10);
    module.update(gamepad);
    expect(actuator.playEffect).toHaveBeenLastCalledWith(
      'dual-rumble',
      expect.objectContaining({ strongMagnitude: 0 }),
    );

    vi.advanceTimersByTime(5);
    module.update(gamepad);
    expect(actuator.playEffect).toHaveBeenLastCalledWith(
      'dual-rumble',
      expect.objectContaining({ weakMagnitude: 1 }),
    );

    vi.advanceTimersByTime(20);
    module.update(gamepad);
    expect(actuator.playEffect).toHaveBeenLastCalledWith(
      'dual-rumble',
      expect.objectContaining({ weakMagnitude: 0 }),
    );

    actuator.playEffect.mockClear();
    vi.advanceTimersByTime(2500);
    module.update(gamepad);
    expect(actuator.playEffect).not.toHaveBeenCalled();

    module.addRumble({ duration: 3000, strongMagnitude: 1 });
    module.update(gamepad);
    actuator.playEffect.mockClear();
    vi.advanceTimersByTime(2500);
    module.update(gamepad);
    expect(actuator.playEffect).toHaveBeenCalledOnce();
  });

  it('resets immediately when stopped and reapplies remaining channels', () => {
    const actuator = createHapticActuator();
    const gamepad = createGamepad({ vibrationActuator: actuator });
    const { module } = createBaseModule();

    module.update(gamepad);
    module.addRumble({ duration: 20, strongMagnitude: 1 });
    module.addRumble({ duration: 20, weakMagnitude: 1 }, 'custom');
    module.update(gamepad);

    module.stopRumble('custom');
    expect(actuator.reset).toHaveBeenCalledOnce();

    module.update(gamepad);
    expect(actuator.playEffect).toHaveBeenLastCalledWith('dual-rumble', {
      duration: 5000,
      strongMagnitude: 1,
      weakMagnitude: 0,
    });
  });

  it('handles rejected actuator promises', async () => {
    const actuator = createHapticActuator();
    actuator.playEffect.mockRejectedValue(new Error('play failed'));
    actuator.reset.mockRejectedValue(new Error('reset failed'));
    const gamepad = createGamepad({ vibrationActuator: actuator });
    const { module } = createBaseModule();

    module.update(gamepad);
    module.addRumble({ duration: 10, strongMagnitude: 1 });
    expect(() => module.update(gamepad)).not.toThrow();
    expect(() => module.stopRumble()).not.toThrow();
    await Promise.resolve();

    expect(actuator.playEffect).toHaveBeenCalledOnce();
    expect(actuator.reset).toHaveBeenCalledOnce();

    const actuatorWithoutReset = {
      playEffect: vi.fn(async () => 'complete' as GamepadHapticsResult),
    } as unknown as GamepadHapticActuator;
    const moduleWithoutReset = createBaseModule().module;
    moduleWithoutReset.update(createGamepad({ vibrationActuator: actuatorWithoutReset }));
    moduleWithoutReset.addRumble({ duration: 10, strongMagnitude: 1 });
    expect(() => moduleWithoutReset.stopRumble()).not.toThrow();
  });

  it('shares actuator application and releases per-module channel ownership', () => {
    const actuator = createHapticActuator();
    const gamepad = createGamepad({ vibrationActuator: actuator });
    const first = createBaseModule({ gamepadIndex: 0 });
    const second = createBaseModule({ gamepadIndex: 0 });

    first.module.update(gamepad);
    second.module.update(gamepad);
    first.module.addRumble({ duration: 100, strongMagnitude: 1 });
    second.module.addRumble({ duration: 100, weakMagnitude: 1 });
    first.module.update(gamepad);
    second.module.update(gamepad);

    expect(actuator.playEffect).toHaveBeenCalledOnce();
    expect(actuator.playEffect).toHaveBeenLastCalledWith('dual-rumble', {
      duration: 5000,
      strongMagnitude: 1,
      weakMagnitude: 1,
    });

    first.module.destroy();
    expect(hasRumbleChannels(0)).toBe(true);
    second.module.update(gamepad);
    expect(actuator.playEffect).toHaveBeenLastCalledWith('dual-rumble', {
      duration: 5000,
      strongMagnitude: 0,
      weakMagnitude: 1,
    });

    second.module.destroy();
    expect(hasRumbleChannels(0)).toBe(false);
    expect(actuator.reset).toHaveBeenCalledTimes(2);
  });

  it('releases rumble ownership when updating to another controller index', () => {
    const actuator = createHapticActuator();
    const firstGamepad = createGamepad({ index: 0, vibrationActuator: actuator });
    const { module } = createBaseModule({ gamepadIndex: 0 });
    module.update(firstGamepad);
    module.addRumble({ duration: 100, strongMagnitude: 1 });

    module.update(createGamepad({ index: 1 }));

    expect(hasRumbleChannels(0)).toBe(false);
    expect(actuator.reset).toHaveBeenCalledOnce();
    module.destroy();
  });
});
