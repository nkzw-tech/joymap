import { describe, test } from 'vite-plus/test';
import { stickMap } from '../src/common/utils.ts';
import type { CustomGamepad } from '../src/types.ts';

const previous: CustomGamepad = {
  axes: [0.1, 0.1, 0.2, 0.2, 0, 0],
  buttons: [],
  pressedButtons: [],
};

const samples: Array<CustomGamepad> = Array.from({ length: 256 }, (_, index) => ({
  axes: [
    Math.sin(index) * 0.9,
    Math.cos(index) * 0.9,
    Math.sin(index * 2) * 0.8,
    Math.cos(index * 2) * 0.8,
    Math.sin(index * 3) * 0.7,
    Math.cos(index * 3) * 0.7,
  ],
  buttons: [],
  pressedButtons: [],
}));

let sampleIndex = 0;

describe('stick mapping', () => {
  test('standard stick', async ({ bench }) => {
    await bench('standard stick', () => {
      const result = stickMap(
        samples[sampleIndex & 255],
        previous,
        [[0, 1]],
        [false, false],
        0.2,
        true,
      );
      sampleIndex += result.value[0] === 2 ? 2 : 1;
    }).run();
  });

  test('three grouped sticks', async ({ bench }) => {
    await bench('three grouped sticks', () => {
      const result = stickMap(
        samples[sampleIndex & 255],
        previous,
        [
          [0, 1],
          [2, 3],
          [4, 5],
        ],
        [true, false],
        0.2,
        true,
      );
      sampleIndex += result.value[0] === 2 ? 2 : 1;
    }).run();
  });
});
