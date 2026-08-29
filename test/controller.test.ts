import { describe, expect, it } from 'vite-plus/test';
import createController, { ControllerInternals } from '../src/controller.ts';
import { createButton, createButtons, createGamepad } from './fixtures.ts';

const createMappedGamepad = (buttonValue: number, axes: ReadonlyArray<number>) =>
  createGamepad({ axes, buttons: createButtons([buttonValue, 0.8]) });

const createTestController = (...options: Parameters<typeof createController>) =>
  createController(...options) as ControllerInternals;

const emptyButton = { justChanged: false, pressed: false, type: 'button', value: 0 } as const;
const emptyStick = {
  inverts: [false, false],
  justChanged: false,
  pressed: false,
  type: 'stick',
  value: [0, 0],
} as const;

describe('controller inputs', () => {
  it('returns independent empty results while disconnected', () => {
    const module = createTestController();
    module.setButton('secondary', [1]);
    module.setStick('alternate', [[2, 3]]);

    const button = module.getButton('A');
    const buttons = module.getButtons('A', 'secondary');
    expect(button).toEqual(emptyButton);
    expect(button).not.toBe(emptyButton);
    expect(buttons).toEqual({
      A: emptyButton,
      secondary: emptyButton,
    });
    expect(buttons.A).not.toBe(buttons.secondary);
    expect(module.getAllButtons()).toEqual({ secondary: emptyButton });

    const stick = module.getStick('L');
    const sticks = module.getSticks('L', 'alternate');
    expect(stick).toEqual(emptyStick);
    expect(stick).not.toBe(emptyStick);
    expect(sticks).toEqual({
      alternate: emptyStick,
      L: emptyStick,
    });
    expect(sticks.L).not.toBe(sticks.alternate);
    expect(module.getAllSticks()).toEqual({ alternate: emptyStick });

    button.value = 1;
    (stick.inverts as Array<boolean>)[0] = true;
    stick.value[0] = 1;
    expect(module.getButton('A')).toEqual(emptyButton);
    expect(module.getStick('L')).toEqual(emptyStick);
  });

  it('maps individual, selected, and all inputs from current and previous snapshots', () => {
    const module = createTestController();
    module.assign(0);
    module.update(createMappedGamepad(0, [0, 0, 0, 0]));
    module.update(createMappedGamepad(1, [0.5, -0.5, 0.1, 0.1]));

    expect(module.getButton('A')).toEqual({
      justChanged: true,
      pressed: true,
      type: 'button',
      value: 1,
    });
    expect(module.getButtons('A', 'B')).toEqual({
      A: module.getButton('A'),
      B: module.getButton('B'),
    });
    expect(module.getAllButtons()).toMatchObject({
      A: module.getButton('A'),
      B: module.getButton('B'),
    });

    expect(module.getStick('L')).toEqual({
      inverts: [false, false],
      justChanged: true,
      pressed: true,
      type: 'stick',
      value: [0.5, -0.5],
    });
    expect(module.getSticks('L', 'R')).toEqual({
      L: module.getStick('L'),
      R: module.getStick('R'),
    });
    expect(module.getAllSticks()).toEqual({ L: module.getStick('L'), R: module.getStick('R') });
  });

  it('uses separate button thresholds and stick deadzones', () => {
    const module = createTestController({
      buttonThreshold: 0.8,
      gamepadIndex: 0,
      stickDeadzone: 0.4,
    });
    module.update(
      createGamepad({
        axes: [0.5, 0, 0, 0],
        buttons: [createButton(0.7, false)],
      }),
    );

    expect(module.getButton('A').pressed).toBe(false);
    expect(module.getStick('L').pressed).toBe(true);
  });

  it('applies persistent button press and release hysteresis', () => {
    const module = createTestController({
      buttonReleaseThreshold: 0.4,
      buttonThreshold: 0.6,
      gamepadIndex: 0,
    });
    const update = (value: number) =>
      module.update(createGamepad({ buttons: [createButton(value, false)] }));

    update(0.7);
    expect(module.getButton('A')).toMatchObject({ justChanged: true, pressed: true });
    expect(module.getButton('A')).toMatchObject({ justChanged: true, pressed: true });

    update(0.5);
    expect(module.getButton('A')).toMatchObject({ justChanged: false, pressed: true });

    update(0.3);
    expect(module.getButton('A')).toMatchObject({ justChanged: true, pressed: false });

    update(0.5);
    expect(module.getButton('A')).toMatchObject({ justChanged: false, pressed: false });
  });

  it('applies persistent stick press and release hysteresis', () => {
    const module = createTestController({
      gamepadIndex: 0,
      stickDeadzone: 0.6,
      stickReleaseDeadzone: 0.4,
    });
    const update = (value: number) => module.update(createGamepad({ axes: [value, 0, 0, 0] }));

    update(0.7);
    expect(module.getStick('L')).toMatchObject({ justChanged: true, pressed: true });
    update(0.5);
    expect(module.getStick('L')).toMatchObject({ justChanged: false, pressed: true });
    update(0.3);
    expect(module.getStick('L')).toMatchObject({ justChanged: true, pressed: false });
    update(0.5);
    expect(module.getStick('L')).toMatchObject({ justChanged: false, pressed: false });
  });

  it('preserves native button pressed state independently of analog value', () => {
    const module = createTestController({ buttonThreshold: 1, gamepadIndex: 0 });
    module.update(createGamepad({ buttons: [createButton(0, true)] }));

    expect(module.getButton('A')).toEqual({
      justChanged: true,
      pressed: true,
      type: 'button',
      value: 0,
    });
  });

  it('optionally rescales radial stick output after the deadzone', () => {
    const rawModule = createTestController({ gamepadIndex: 0, stickDeadzone: 0.2 });
    const rescaledModule = createTestController({
      gamepadIndex: 0,
      rescaleSticks: true,
      stickDeadzone: 0.2,
    });
    const gamepad = createGamepad({ axes: [0.6, 0, 0, 0] });
    rawModule.update(gamepad);
    rescaledModule.update(gamepad);

    expect(rawModule.getStick('L').value).toEqual([0.6, 0]);
    expect(rescaledModule.getStick('L').value[0]).toBeCloseTo(0.5);
    expect(rescaledModule.getStick('L').value[1]).toBe(0);
  });

  it('does not expose mutable stick mapping state', () => {
    const module = createTestController({ gamepadIndex: 0 });
    module.update(createGamepad({ axes: [0.5, 0, 0, 0] }));
    const result = module.getStick('L');

    expect(() => ((result.inverts as Array<boolean>)[0] = true)).toThrow(TypeError);
    expect(module.getStick('L').value).toEqual([0.5, 0]);
    const indexes = module.getStickIndexes('L');
    expect(() => ((indexes[0] as Array<number>)[0] = 9)).toThrow(TypeError);
    expect(module.getStickIndexes('L')).toEqual([[0, 1]]);
  });

  it('returns empty results for unavailable nonstandard mappings', () => {
    const module = createTestController({ gamepadIndex: 0 });
    module.update(createGamepad({ mapping: '' }));

    expect(module.getButton('A')).toEqual(emptyButton);
    expect(module.getButton('A')).not.toBe(emptyButton);
    expect(module.getStick('L')).toEqual(emptyStick);
    expect(module.getStick('L')).not.toBe(emptyStick);
    expect(module.getButtons('A')).toEqual({ A: emptyButton });
    expect(module.getSticks('L')).toEqual({ L: emptyStick });
  });
});
