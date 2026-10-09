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
  birch: '#dec69d',
  edge: '#a1845a',
  brass: '#c79c50',
  steel: '#a5afac',
  cobalt: '#365f99',
  vermilion: '#b74730',
  teal: '#2d8880',
  scout: '#8ea5a3',
  captures: ['#377d76', '#ab734a', '#65759a', '#95634b'],
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

export function useMaterials(dark: boolean) {
  const materials = useMemo(() => {
    const wood = woodTexture();
    const tracks = Object.fromEntries(
      Object.entries(palette)
        .filter(([key]) => key !== 'captures')
        .map(([key, color]) => [
          key,
          new MeshStandardMaterial({
            color: color as string,
            map: key === 'birch' ? wood : null,
            roughness: key === 'brass' ? 0.3 : key === 'steel' ? 0.36 : 0.66,
            metalness: key === 'brass' || key === 'steel' ? 0.78 : 0.12,
            transparent: key === 'scout',
            opacity: key === 'scout' ? 0.58 : 1,
          }),
        ]),
    ) as Record<TrackFinish, MeshStandardMaterial>;
    return {
      tracks,
      wood,
      board: new MeshStandardMaterial({ color: dark ? '#ad8c61' : '#d6bb8d', map: wood, roughness: 0.78 }),
      brass: tracks.brass,
      steel: tracks.steel,
      ink: new MeshStandardMaterial({ color: '#34372f', roughness: 0.65 }),
      marble: new MeshPhysicalMaterial({ color: '#e1e8e8', metalness: 0.98, roughness: 0.12, clearcoat: 1 }),
      mirror: new MeshStandardMaterial({ color: '#e2efee', metalness: 1, roughness: 0.08 }),
    };
  }, [dark]);
  useEffect(
    () => () => {
      for (const material of Object.values(materials.tracks)) material.dispose();
      materials.board.dispose();
      materials.ink.dispose();
      materials.marble.dispose();
      materials.mirror.dispose();
      materials.wood.dispose();
    },
    [materials],
  );
  return materials;
}

export type Materials = ReturnType<typeof useMaterials>;
