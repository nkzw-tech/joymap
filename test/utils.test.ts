import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  buttonMap,
  findIndexes,
  gamepadIsValid,
  getRawGamepads,
  isButtonSignificant,
  isConsecutive,
  isStickSignificant,
  mapValues,
  nameIsValid,
  rescaleStick,
  roundSticks,
  stickMap,
} from '../src/common/utils.ts';
import { CustomGamepad } from '../src/types.ts';
import { createGamepad, installNavigator } from './fixtures.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

const createButtonPad = (
  buttons: Array<number>,
  pressedButtons = buttons.map(() => false),
): CustomGamepad => ({ axes: [], buttons, pressedButtons });
const createStickPad = (axes: Array<number>): CustomGamepad => ({
  axes,
  buttons: [],
  pressedButtons: [],
});

describe('collection helpers', () => {
  it('checks whether indexes are consecutive', () => {
    expect(isConsecutive([])).toBe(true);
    expect(isConsecutive([4])).toBe(true);
    expect(isConsecutive([2, 3, 4])).toBe(true);
    expect(isConsecutive([2, 4])).toBe(false);
  });

  it('finds matching indexes', () => {
    expect(findIndexes((value) => value > 1, [0, 2, 1, 3])).toEqual([1, 3]);
  });

  it('maps record values without mutating the input', () => {
    const input = { first: 1, second: 2 };
    expect(mapValues((value, key) => `${key}:${value * 2}`, input)).toEqual({
      first: 'first:2',
      second: 'second:4',
    });
    expect(input).toEqual({ first: 1, second: 2 });
  });

  it('validates names', () => {
    expect(nameIsValid('Player2')).toBe(true);
    expect(nameIsValid('Player 2')).toBe(false);
  });
});

describe('raw gamepads', () => {
  it('compacts valid gamepads in one pass', () => {
    const gamepad = createGamepad();
    const getGamepads = installNavigator([gamepad, null]);

    expect(getRawGamepads()).toEqual([gamepad]);
    expect(getGamepads).toHaveBeenCalledOnce();
  });

  it('returns an empty list when getGamepads is unavailable', () => {
    vi.stubGlobal('navigator', {});
    expect(getRawGamepads()).toEqual([]);
  });

  it('returns an empty list when navigator is absent', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Reflect.deleteProperty(globalThis, 'navigator');

    expect(getRawGamepads()).toEqual([]);

    if (descriptor) {
      Object.defineProperty(globalThis, 'navigator', descriptor);
    }
  });

  it('accepts any connected gamepad regardless of controls, timestamp, or ID', () => {
    expect(gamepadIsValid(createGamepad())).toBe(true);
    expect(gamepadIsValid(null)).toBe(false);
    expect(gamepadIsValid(createGamepad({ connected: false }))).toBe(false);
    expect(gamepadIsValid(createGamepad({ axes: [] }))).toBe(true);
    expect(gamepadIsValid(createGamepad({ buttons: [] }))).toBe(true);
    expect(gamepadIsValid(createGamepad({ axes: [], buttons: [] }))).toBe(true);
    expect(gamepadIsValid(createGamepad({ timestamp: 0 }))).toBe(true);
    expect(gamepadIsValid(createGamepad({ id: '' }))).toBe(true);
  });
});

describe('input significance', () => {
  it('uses absolute button values and a strict threshold', () => {
    expect(isButtonSignificant(undefined, 0.2)).toBe(false);
    expect(isButtonSignificant(0.2, 0.2)).toBe(false);
    expect(isButtonSignificant(-0.3, 0.2)).toBe(true);
  });

  it('uses radial stick magnitude and a strict threshold', () => {
    expect(isStickSignificant([0.3, 0.4], 0.5)).toBe(false);
    expect(isStickSignificant([0.4, 0.4], 0.5)).toBe(true);
  });
});

describe('button mapping', () => {
  it('maps grouped buttons and reports transitions', () => {
    expect(
      buttonMap(createButtonPad([0, 0.8]), createButtonPad([0, 0]), [0, 1], 0.2, true),
    ).toEqual({
      justChanged: true,
      pressed: true,
      type: 'button',
      value: 0.8,
    });

    expect(
      buttonMap(createButtonPad([0, 0]), createButtonPad([0.7, 0]), [0, 1], 0.2, true),
    ).toEqual({
      justChanged: true,
      pressed: false,
      type: 'button',
      value: 0,
    });
  });

  it('preserves insignificant values when clamping is disabled', () => {
    expect(buttonMap(createButtonPad([0.1]), createButtonPad([0]), [0], 0.2, false)).toMatchObject({
      justChanged: false,
      pressed: false,
      value: 0.1,
    });
  });

  it('does not reevaluate pressed state after a grouped button is active', () => {
    expect(
      buttonMap(createButtonPad([0.8, 0.1]), createButtonPad([0, 0]), [0, 1], 0.2, true),
    ).toMatchObject({
      pressed: true,
      value: 0.8,
    });
  });

  it('preserves native pressed state and accepts precomputed hysteresis state', () => {
    expect(
      buttonMap(createButtonPad([0], [true]), createButtonPad([0]), [0], 1, true),
    ).toMatchObject({ justChanged: true, pressed: true, value: 0 });
    expect(
      buttonMap(createButtonPad([0.1]), createButtonPad([0.8]), [0], 0.5, true, {
        current: true,
        previous: true,
        threshold: 0.25,
      }),
    ).toMatchObject({ justChanged: false, pressed: true, value: 0.1 });
  });
});

describe('stick mapping', () => {
  it('averages significant grouped sticks', () => {
    const result = roundSticks(
      [
        [0, 1],
        [2, 3],
      ],
      [0.6, 0.4, 0.2, 0.8],
      0.2,
    );

    expect(result[0]).toBeCloseTo(0.4);
    expect(result[1]).toBeCloseTo(0.6);
  });

  it('returns zeroes when every grouped stick is inside the deadzone', () => {
    expect(roundSticks([[0, 1]], [0.1, 0.1], 0.2)).toEqual([0, 0]);
  });

  it('can reuse a caller-owned output vector', () => {
    const output = [99, 99, 99];
    const result = roundSticks([[0, 1]], [0.6, 0.4], 0.2, output);

    expect(result).toBe(output);
    expect(result).toEqual([0.6, 0.4]);
  });

  it('maps inversion, clamping, and transitions', () => {
    expect(
      stickMap(
        createStickPad([0.5, -0.25]),
        createStickPad([0, 0]),
        [[0, 1]],
        [true, false],
        0.2,
        true,
      ),
    ).toEqual({
      inverts: [true, false],
      justChanged: true,
      pressed: true,
      type: 'stick',
      value: [-0.5, -0.25],
    });

    expect(
      stickMap(
        createStickPad([0.1, 0.1]),
        createStickPad([0.5, 0]),
        [[0, 1]],
        [false, false],
        0.2,
        true,
      ),
    ).toMatchObject({ justChanged: true, pressed: false, value: [0, 0] });
  });

  it('rescales radial values outside the deadzone', () => {
    expect(rescaleStick([0, 0], 0.2)).toEqual([0, 0]);
    expect(rescaleStick([1, 0], 1)).toEqual([0, 0]);
    expect(rescaleStick([0.6, 0], 0.2)[0]).toBeCloseTo(0.5);
    expect(rescaleStick([1, 1], 0.2)).toEqual([
      expect.closeTo(Math.SQRT1_2),
      expect.closeTo(Math.SQRT1_2),
    ]);
  });

  it('maps precomputed hysteresis and rescaled inverted output', () => {
    const result = stickMap(
      createStickPad([0.5, 0]),
      createStickPad([0.8, 0]),
      [[0, 1]],
      [true, false],
      0.2,
      true,
      { current: true, previous: true, threshold: 0.1 },
      true,
    );

    expect(result).toMatchObject({ justChanged: false, pressed: true });
    expect(result.value[0]).toBeCloseTo(-0.375);
    expect(result.value[1]).toBe(0);
  });

  it('checks grouped previous state without constructing its output vector', () => {
    const currentPad = createStickPad([0.7, 0, 0, 0, 0, 0]);

    expect(
      stickMap(
        currentPad,
        createStickPad([0.6, 0, 0.2, -0.6, 0, -0.2]),
        [
          [0, 1, 2],
          [3, 4, 5],
        ],
        [false, false, false],
        0.2,
        true,
      ),
    ).toMatchObject({ justChanged: true, pressed: true });

    expect(
      stickMap(
        currentPad,
        createStickPad([0.1, 0.1, 0.1, 0, 0, 0]),
        [
          [0, 1, 2],
          [3, 4, 5],
        ],
        [false, false, false],
        0.2,
        true,
      ),
    ).toMatchObject({ justChanged: true, pressed: true });

    expect(
      stickMap(
        currentPad,
        createStickPad([0.6, 0, 0.2, 0, 0, 0]),
        [
          [0, 1, 2],
          [3, 4, 5],
        ],
        [false, false, false],
        0.2,
        true,
      ),
    ).toMatchObject({ justChanged: false, pressed: true });
  });
});
