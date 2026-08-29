import { memoryUsage, stdout } from 'node:process';
import { createController } from '../lib/index.js';

const sampleCount = 100_000;
const maxRetainedBytes = 5 * 1024 * 1024;
const collectGarbage = globalThis.gc;

if (!collectGarbage) {
  throw new Error('Run this benchmark with Node.js --expose-gc.');
}

const buttons = Array.from({ length: 17 }, () => ({
  pressed: false,
  touched: false,
  value: 0,
}));
const pads = [
  {
    axes: [0, 0, 0, 0],
    buttons,
    connected: true,
    id: 'controller-memory-benchmark',
    index: 0,
    mapping: 'standard',
    timestamp: 1,
  },
  {
    axes: [0, 0, 0, 0],
    buttons,
    connected: true,
    id: 'controller-memory-benchmark',
    index: 0,
    mapping: 'standard',
    timestamp: 2,
  },
];

const controller = createController({ gamepadIndex: 0 });
let sink = 0;

const sample = (count) => {
  for (let index = 0; index < count; index++) {
    const pad = pads[index & 1];
    pad.axes[0] = Math.sin(index) * 0.9;
    pad.axes[1] = Math.cos(index) * 0.9;
    pad.timestamp = index + 1;
    controller.update(pad);
    sink += controller.getStick('L').value[0];
  }
};

sample(10_000);
collectGarbage();
const heapBefore = memoryUsage().heapUsed;

sample(sampleCount);
collectGarbage();
const retainedBytes = Math.max(0, memoryUsage().heapUsed - heapBefore);
const retainedMiB = retainedBytes / 1024 / 1024;

stdout.write(
  `Controller-memory regression: ${sampleCount.toLocaleString()} changing samples retained ${retainedMiB.toFixed(2)} MiB.\n`,
);

if (retainedBytes > maxRetainedBytes) {
  throw new Error(
    `Controller-memory regression retained ${retainedMiB.toFixed(2)} MiB; expected at most ${maxRetainedBytes / 1024 / 1024} MiB.`,
  );
}

if (!Number.isFinite(sink)) {
  throw new Error('Unexpected non-finite controller result.');
}
