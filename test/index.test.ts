import { describe, expect, expectTypeOf, it } from 'vite-plus/test';
import createController from '../src/controller.ts';
import {
  createController as exportedCreateController,
  createJoymap as exportedCreateJoymap,
  isJustPressed,
  isJustReleased,
} from '../src/index.ts';
import {
  ControllerOptions,
  Button,
  ButtonResult,
  Controller,
  CustomGamepad,
  Effect,
  EffectObject,
  GamepadSnapshots,
  InputResult,
  JoymapOptions,
  RawGamepad,
  Stick,
  StickResult,
} from '../src/index.ts';
import createJoymap from '../src/JoyMap.ts';

describe('public exports', () => {
  it('exports every public factory', () => {
    expect(exportedCreateController).toBe(createController);
    expect(exportedCreateJoymap).toBe(createJoymap);
  });

  it('exports named rumble effect types', () => {
    expectTypeOf<EffectObject>().toExtend<Effect>();
    expectTypeOf<number>().toExtend<Effect>();
  });

  it('exports input transition helpers', () => {
    expect(isJustPressed({ justChanged: true, pressed: true, type: 'button', value: 1 })).toBe(
      true,
    );
    expect(isJustPressed()).toBe(false);
    expect(isJustReleased({ justChanged: true, pressed: false, type: 'button', value: 0 })).toBe(
      true,
    );
    expect(isJustReleased()).toBe(false);
  });

  it('exports public configuration, mapping, snapshot, and result types', () => {
    expectTypeOf<ControllerOptions>().toBeObject();
    expectTypeOf<Button>().toExtend<ReadonlyArray<number>>();
    expectTypeOf<ButtonResult>().toExtend<InputResult>();
    expectTypeOf<Controller>().toHaveProperty('assign');
    expectTypeOf<Controller>().toHaveProperty('getGamepad');
    expectTypeOf<'disconnect'>().not.toExtend<keyof Controller>();
    expectTypeOf<'update'>().not.toExtend<keyof Controller>();
    expectTypeOf<CustomGamepad>().toHaveProperty('axes');
    expectTypeOf<GamepadSnapshots>().toHaveProperty('current');
    expectTypeOf<JoymapOptions>().toBeObject();
    expectTypeOf<RawGamepad>().toEqualTypeOf<Gamepad>();
    expectTypeOf<Stick>().toHaveProperty('indexes');
    expectTypeOf<StickResult>().toExtend<InputResult>();
  });
});
