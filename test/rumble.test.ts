import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  addRumble,
  applyRumble,
  clearRumble,
  getCurrentEffect,
  hasRumbleChannels,
  makeEffectStrict,
  MAX_DURATION,
  registerRumbleOwner,
  releaseRumbleOwner,
  requestRumbleRefresh,
  resetRumble,
  stopRumble,
  updateChannels,
} from '../src/baseModule/rumble.ts';
import { createGamepad, createHapticActuator } from './fixtures.ts';

const indexes = [100, 101, 102, 103, 104, 105, 106, 107, 108];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
});

afterEach(() => {
  for (const index of indexes) {
    clearRumble(index);
  }
  vi.useRealTimers();
});

describe('rumble effects', () => {
  it('normalizes pauses and clamps effect values', () => {
    expect(makeEffectStrict(25)).toEqual({
      duration: 25,
      strongMagnitude: 0,
      weakMagnitude: 0,
    });
    expect(makeEffectStrict({ duration: -1, strongMagnitude: 2, weakMagnitude: -1 })).toEqual({
      duration: 0,
      strongMagnitude: 1,
      weakMagnitude: 0,
    });
    expect(makeEffectStrict({ duration: 10 })).toEqual({
      duration: 10,
      strongMagnitude: 0,
      weakMagnitude: 0,
    });
    expect(makeEffectStrict(-10).duration).toBe(0);
    expect(makeEffectStrict({ duration: Number.NaN }).duration).toBe(0);
  });

  it('plays and resets supported effects and rejects unsupported gamepads', async () => {
    const actuator = createHapticActuator();
    const gamepad = createGamepad({ id: 'rumble-supported', vibrationActuator: actuator });
    const effect = makeEffectStrict({ duration: 10, strongMagnitude: 0.5 });

    await expect(applyRumble(gamepad, effect)).resolves.toBe('complete');
    expect(actuator.playEffect).toHaveBeenCalledWith('dual-rumble', effect);
    await expect(resetRumble(gamepad)).resolves.toBe('complete');
    expect(actuator.reset).toHaveBeenCalledOnce();

    await expect(applyRumble(createGamepad({ id: 'rumble-unsupported' }), effect)).rejects.toBe(
      'Joymap rumble applyRumble: Gamepad rumble-unsupported does not support haptic feedback',
    );
    expect(resetRumble(createGamepad())).toBeNull();
  });

  it('turns synchronous actuator failures into promise rejections', async () => {
    const failure = new Error('actuator failed');
    const actuator = createHapticActuator();
    actuator.playEffect.mockImplementation(() => {
      throw failure;
    });
    actuator.reset.mockImplementation(() => {
      throw failure;
    });
    const gamepad = createGamepad({ vibrationActuator: actuator });
    const effect = makeEffectStrict({ duration: 10 });

    await expect(applyRumble(gamepad, effect)).rejects.toBe(failure);
    await expect(resetRumble(gamepad)).rejects.toBe(failure);
  });
});

describe('rumble channels', () => {
  it('returns silence for new and explicitly stopped channels', () => {
    expect(getCurrentEffect(100)).toEqual({
      duration: MAX_DURATION,
      strongMagnitude: 0,
      weakMagnitude: 0,
    });
    expect(hasRumbleChannels(100)).toBe(false);

    stopRumble(101);
    updateChannels(102);
    expect(getCurrentEffect(102)).toMatchObject({
      strongMagnitude: 0,
      weakMagnitude: 0,
    });

    addRumble(103, { duration: 10, strongMagnitude: 1 });
    expect(hasRumbleChannels(103)).toBe(true);
    stopRumble(103);
    expect(getCurrentEffect(103).strongMagnitude).toBe(0);
    expect(hasRumbleChannels(103)).toBe(false);

    addRumble(108, { duration: 0, strongMagnitude: 1 });
    expect(hasRumbleChannels(108)).toBe(false);
  });

  it('combines channels and clamps their magnitudes', () => {
    addRumble(104, { duration: 20, strongMagnitude: 0.7 }, 'left');
    addRumble(104, { duration: 20, strongMagnitude: 0.6, weakMagnitude: 0.4 }, 'right');

    expect(getCurrentEffect(104)).toEqual({
      duration: MAX_DURATION,
      strongMagnitude: 1,
      weakMagnitude: 0.4,
    });
  });

  it('keeps channels separate for identical controller IDs at different indexes', () => {
    addRumble(105, { duration: 20, strongMagnitude: 1 });

    expect(getCurrentEffect(105).strongMagnitude).toBe(1);
    expect(getCurrentEffect(106).strongMagnitude).toBe(0);
  });

  it('advances array timelines and retains later effects', () => {
    addRumble(107, [{ duration: 10, strongMagnitude: 1 }, 5, { duration: 20, weakMagnitude: 1 }]);

    vi.advanceTimersByTime(6);
    updateChannels(107);
    updateChannels(107);
    expect(getCurrentEffect(107)).toMatchObject({ strongMagnitude: 1, weakMagnitude: 0 });

    vi.advanceTimersByTime(4);
    updateChannels(107);
    expect(getCurrentEffect(107)).toMatchObject({ strongMagnitude: 0, weakMagnitude: 0 });

    vi.advanceTimersByTime(5);
    updateChannels(107);
    expect(getCurrentEffect(107)).toMatchObject({ strongMagnitude: 0, weakMagnitude: 1 });

    vi.advanceTimersByTime(25);
    updateChannels(107);
    expect(getCurrentEffect(107)).toMatchObject({ strongMagnitude: 0, weakMagnitude: 0 });
    expect(hasRumbleChannels(107)).toBe(false);
  });

  it('uses monotonic time instead of wall-clock time', () => {
    addRumble(108, { duration: 10, strongMagnitude: 1 });

    vi.setSystemTime(10_000);
    updateChannels(108);

    expect(getCurrentEffect(108).strongMagnitude).toBe(1);

    vi.advanceTimersByTime(10);
    updateChannels(108);
    expect(hasRumbleChannels(108)).toBe(false);
  });

  it('registers and releases owners without channels', () => {
    const owner = {};
    const remainingOwner = {};
    const gamepad = createGamepad({ index: 108 });

    requestRumbleRefresh(108);
    releaseRumbleOwner(gamepad, owner);
    registerRumbleOwner(108, owner);
    registerRumbleOwner(108, remainingOwner);
    releaseRumbleOwner(gamepad, owner);
    addRumble(108, { duration: 10, strongMagnitude: 1 }, 'owned', remainingOwner);
    releaseRumbleOwner(gamepad, remainingOwner);

    expect(hasRumbleChannels(108)).toBe(false);
  });

  it('handles rejected reset promises while releasing an owner', async () => {
    const owner = {};
    const actuator = createHapticActuator();
    actuator.reset.mockRejectedValue(new Error('reset failed'));
    const gamepad = createGamepad({ index: 108, vibrationActuator: actuator });
    registerRumbleOwner(108, owner);
    addRumble(108, { duration: 10, strongMagnitude: 1 }, 'owned', owner);

    releaseRumbleOwner(gamepad, owner);
    await Promise.resolve();

    expect(actuator.reset).toHaveBeenCalledOnce();
    expect(hasRumbleChannels(108)).toBe(false);
  });
});
