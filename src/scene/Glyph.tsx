import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import type { ThreeEvent } from '@react-three/fiber';

export default function Glyph({
  text,
  position,
  size = 0.28,
  color = '#30362d',
  width = 2.5,
  onClick,
}: {
  text: string;
  position: [number, number, number];
  size?: number;
  color?: string;
  width?: number;
  onClick?: (event: ThreeEvent<MouseEvent>) => void;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.font = '400 56px "IBM Plex Mono", monospace';
    canvas.width = Math.min(2048, Math.max(64, Math.ceil(ctx.measureText(text).width) + 24));
    canvas.height = 88;
    ctx.fillStyle = color;
    ctx.font = '400 56px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, 46, canvas.width - 12);
    const image = new CanvasTexture(canvas);
    image.colorSpace = SRGBColorSpace;
    return image;
  }, [text, color]);
  useEffect(() => () => texture.dispose(), [texture]);
  const actualWidth = Math.min(width, Math.max(size * 0.7, [...text].length * size * 0.62));
  return (
    <mesh position={position} onClick={onClick} renderOrder={2}>
      <planeGeometry args={[actualWidth, size * 1.6]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
