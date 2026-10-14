import type { Vec3 } from '../layout/pieces.ts';

export function holdOffset(slot: number): Vec3 {
  const col = slot % 3;
  const row = Math.floor(slot / 3);
  return { x: (col - 1) * 0.34, y: 0.58 + row * 0.32, z: 0.08 };
}

export function restOffset(order: number, destination: 'cup' | 'rejectTray' = 'cup'): Vec3 {
  const slot = Math.min(Math.max(0, order), 17);
  if (destination === 'rejectTray') {
    const col = slot % 5;
    const row = Math.floor(slot / 5);
    return { x: (col - 2) * 0.32, y: 0.16 + row * 0.28, z: (row % 2) * 0.08 - 0.04 };
  }
  const col = slot % 3;
  const row = Math.floor(slot / 3);
  return { x: (col - 1) * 0.3, y: 0.26 + row * 0.3, z: (slot % 2) * 0.06 - 0.03 };
}
