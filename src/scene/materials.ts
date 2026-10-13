import { useEffect, useMemo } from 'react';
import {
  CanvasTexture,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import type { TrackFinish } from './geometry.ts';

export const palette = {
  birch: '#e6d4b2',
  edge: '#9c7c52',
  brass: '#c9a35c',
  steel: '#a5afac',
  cobalt: '#3b63a6',
  vermilion: '#c0432e',
  teal: '#2d8880',
  scout: '#8ea5a3',
  captures: ['#9b4a86', '#b8762f', '#4a62a8', '#a3503a'],
};

function woodTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e9d4ad';
  ctx.fillRect(0, 0, 128, 512);
  for (let x = 0; x < 128; x++) {
    ctx.strokeStyle = `rgba(114, 83, 41, ${0.025 + (Math.sin(x * 6.1) + 1) * 0.025})`;
    ctx.lineWidth = 0.6 + (x % 3) * 0.15;
    ctx.beginPath();
    for (let y = 0; y < 520; y += 12) {
      const bend = Math.sin(y / 130 + x / 13) * 2 + Math.sin(y / 51 + x) * 0.6;
      if (y === 0) ctx.moveTo(x + bend, y);
      else ctx.lineTo(x + bend, y);
    }
    ctx.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.anisotropy = 4;
  return texture;
}

/** Classic glass marble: milky body with a cobalt ribbon and a thin vermilion thread twisted through it. */
function marbleTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f1f4f3';
  ctx.fillRect(0, 0, 256, 128);
  const ribbon = (color: string, width: number, phase: number, amplitude: number, alpha: number) => {
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let x = -8; x <= 264; x += 4) {
      const y = 64 + Math.sin((x / 256) * Math.PI * 2 + phase) * amplitude;
      if (x === -8) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  ribbon(palette.cobalt, 18, 0, 34, 0.85);
  ribbon('#ffffff', 5, 0.35, 34, 0.5);
  ribbon(palette.vermilion, 6, Math.PI, 30, 0.8);
  ctx.globalAlpha = 1;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

export function useMaterials(dark: boolean) {
  const materials = useMemo(() => {
    const wood = woodTexture();
    const swirl = marbleTexture();
    const tracks = Object.fromEntries(
      Object.entries(palette)
        .filter(([key]) => key !== 'captures')
        .map(([key, color]) => [
          key,
          new MeshStandardMaterial({
            color: color as string,
            map: key === 'birch' ? wood : null,
            roughness: key === 'brass' ? 0.5 : key === 'steel' ? 0.36 : 0.7,
            metalness: key === 'brass' ? 0.35 : key === 'steel' ? 0.78 : 0.05,
            transparent: key === 'scout',
            opacity: key === 'scout' ? 0.58 : 1,
          }),
        ]),
    ) as Record<TrackFinish, MeshStandardMaterial>;
    return {
      tracks,
      wood,
      board: new MeshStandardMaterial({ color: dark ? '#ad8c61' : '#d6bb8d', map: wood, roughness: 0.78 }),
      backboard: new MeshStandardMaterial({ color: dark ? '#8d7352' : '#c9b08a', map: wood, roughness: 0.85 }),
      tile: new MeshStandardMaterial({ color: dark ? '#c9a45a' : '#d9b366', map: wood, roughness: 0.72 }),
      brass: tracks.brass,
      steel: tracks.steel,
      ink: new MeshStandardMaterial({ color: '#34372f', roughness: 0.65 }),
      swirl,
      marble: new MeshPhysicalMaterial({
        color: '#ffffff',
        map: swirl,
        metalness: 0.1,
        roughness: 0.12,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        envMapIntensity: 1.4,
        emissive: '#2a3034',
        emissiveIntensity: 0.12,
      }),
      mirror: new MeshStandardMaterial({ color: '#e2efee', metalness: 1, roughness: 0.08 }),
    };
  }, [dark]);
  useEffect(
    () => () => {
      for (const material of Object.values(materials.tracks)) material.dispose();
      materials.board.dispose();
      materials.backboard.dispose();
      materials.tile.dispose();
      materials.ink.dispose();
      materials.marble.dispose();
      materials.mirror.dispose();
      materials.wood.dispose();
      materials.swirl.dispose();
    },
    [materials],
  );
  return materials;
}

export type Materials = ReturnType<typeof useMaterials>;
