import { describe, expect, test } from 'vite-plus/test';
import { SignalStrikeGame, type GameInput } from '../demo/src/game.ts';

const input = (overrides: Partial<GameInput> = {}): GameInput => ({
  aimX: 0,
  dashPressed: false,
  fireHeld: false,
  moveX: 0,
  moveY: 0,
  pulsePressed: false,
  resetPressed: false,
  shieldHeld: false,
  startPressed: false,
  ...overrides,
});

describe('Signal Strike demo', () => {
  test('starts with a playable game', () => {
    const game = new SignalStrikeGame(() => 0.5);

    expect(game.getSnapshot()).toEqual({
      dashReady: true,
      lives: 3,
      mode: 'playing',
      pulseReady: true,
      score: 0,
      shield: 1,
      wave: 1,
    });
  });

  test('supports pausing and resetting', () => {
    const game = new SignalStrikeGame(() => 0.5);

    game.update(0.016, input({ startPressed: true }));
    expect(game.getSnapshot().mode).toBe('paused');

    game.update(0.016, input({ startPressed: true }));
    expect(game.getSnapshot().mode).toBe('playing');

    game.update(0.016, input({ shieldHeld: true }));
    expect(game.getSnapshot().shield).toBeLessThan(1);
    game.update(0.016, input({ resetPressed: true }));
    expect(game.getSnapshot().shield).toBe(1);
  });

  test('emits actions and respects their cooldowns', () => {
    const game = new SignalStrikeGame(() => 0.5);

    expect(game.update(0.016, input({ dashPressed: true, fireHeld: true }))).toEqual([
      'dash',
      'shoot',
    ]);
    expect(game.getSnapshot().dashReady).toBe(false);
    expect(game.update(0.016, input({ dashPressed: true, fireHeld: true }))).toEqual([]);

    game.update(0.05, input());
    game.update(0.05, input());
    game.update(0.05, input());
    expect(game.update(0.016, input({ fireHeld: true, pulsePressed: true }))).toEqual([
      'shoot',
      'pulse',
    ]);
    expect(game.getSnapshot().pulseReady).toBe(false);
  });
});
