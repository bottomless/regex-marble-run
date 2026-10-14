import type { Vec3 } from '../layout/pieces.ts';

export function holdOffset(slot: number): Vec3 {
  const index = Math.max(0, slot);
  const col = index % 4;
  const depth = Math.floor(index / 4) % 2;
  const layer = Math.floor(index / 8);
  return {
    x: (col - 1.5) * 0.3,
    y: 0.5 + layer * 0.28,
    z: (depth - 0.5) * 0.24 + 0.06,
  };
}

export function gateOffset(slot: number): Vec3 {
  const index = Math.max(0, slot);
  const col = index % 3;
  const depth = Math.floor(index / 3) % 2;
  const layer = Math.floor(index / 6);
  return {
    x: (col - 1) * 0.34,
    y: -0.44 + layer * 0.26,
    z: 0.18 + depth * 0.2,
  };
}

export function restOffset(order: number, destination: 'cup' | 'rejectTray' = 'cup'): Vec3 {
  const slot = Math.max(0, order);
  if (destination === 'rejectTray') {
    const col = slot % 5;
    const depth = Math.floor(slot / 5) % 2;
    const layer = Math.floor(slot / 10);
    return { x: (col - 2) * 0.34, y: 0.12 + layer * 0.28, z: (depth - 0.5) * 0.34 };
  }
  const col = slot % 5;
  const depth = Math.floor(slot / 5) % 2;
  const layer = Math.floor(slot / 10);
  return { x: (col - 2) * 0.38, y: 0.14 + layer * 0.28, z: (depth - 0.5) * 0.36 };
}
