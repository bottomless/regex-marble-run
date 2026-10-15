import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { MeshStandardMaterial } from 'three';
import type { Group } from 'three';
import { useStore } from 'zustand';
import type { MachineLayout } from '../layout/pieces.ts';
import { gateMarkers, type GateMarker } from '../playback/gates.ts';
import type { PlaybackStore } from '../playback/store.ts';

const LAMP_OFFSET: Record<GateMarker['kind'], [number, number, number]> = {
  gate: [0, 1.46, 0.3],
  sensor: [0, -0.48, 0.22],
  scout: [0, -0.48, 0.22],
  mirror: [0, 0.62, 0.15],
  opaque: [0, 0.62, 0.15],
};

const DOOR_CLOSED = -1.05;

function RejectDoor({ material }: { material: MeshStandardMaterial }) {
  const ref = useRef<Group>(null);
  const angle = useRef(0);
  useFrame((state, delta) => {
    const group = ref.current;
    if (!group) return;
    const dt = Math.min(delta, 0.05);
    angle.current += (DOOR_CLOSED - angle.current) * (1 - Math.exp(-9 * dt));
    group.rotation.x = angle.current;
    if (Math.abs(DOOR_CLOSED - angle.current) > 0.01) state.invalidate();
  });
  return (
    <group ref={ref} position={[0, -0.6, 0.02]}>
      <mesh position={[0, 0, 0.24]} material={material}>
        <boxGeometry args={[0.7, 0.05, 0.48]} />
      </mesh>
    </group>
  );
}

export default function GateLamps({ machine, store }: { machine: MachineLayout; store: PlaybackStore }) {
  const state = useStore(store, (snapshot) => snapshot.machine);
  const markers = useMemo(() => gateMarkers(machine, state), [machine, state]);
  const canvas = useThree((snapshot) => snapshot.gl.domElement);
  const invalidate = useThree((snapshot) => snapshot.invalidate);
  const lamps = useMemo(
    () => ({
      pass: new MeshStandardMaterial({ color: '#6ccb73', emissive: '#2f9b43', emissiveIntensity: 0.9, roughness: 0.35 }),
      reject: new MeshStandardMaterial({ color: '#e35d3f', emissive: '#b0301c', emissiveIntensity: 0.9, roughness: 0.35 }),
      halo: new MeshStandardMaterial({ color: '#7fd6cc', emissive: '#2d8880', emissiveIntensity: 0.7, roughness: 0.4 }),
      door: new MeshStandardMaterial({ color: '#8a6a3f', roughness: 0.7 }),
    }),
    [],
  );
  useEffect(() => () => Object.values(lamps).forEach((item) => item.dispose()), [lamps]);
  useLayoutEffect(() => {
    canvas.setAttribute('data-gates', JSON.stringify(markers));
    invalidate();
    return () => canvas.removeAttribute('data-gates');
  }, [canvas, markers, invalidate]);

  return (
    <group>
      {markers.map((marker, i) => {
        const p = marker.position;
        const lamp = marker.status === null ? null : lamps[marker.status];
        return (
          <group key={`${marker.node}:${i}`} position={[p.x, p.y, p.z]}>
            {lamp && (
              <mesh position={LAMP_OFFSET[marker.kind]} material={lamp}>
                <sphereGeometry args={[marker.kind === 'gate' ? 0.13 : 0.095, 12, 8]} />
              </mesh>
            )}
            {marker.kind === 'gate' && marker.status === 'pass' && (
              <mesh position={[0, -0.58, 0.2]} material={lamps.pass}>
                <boxGeometry args={[0.78, 0.04, 0.3]} />
              </mesh>
            )}
            {marker.kind === 'gate' && marker.status === 'reject' && <RejectDoor material={lamps.door} />}
            {marker.active && (
              <mesh position={[0, marker.kind === 'gate' ? 0.15 : 0, 0.3]} material={lamps.halo}>
                <torusGeometry args={[0.66, 0.03, 8, 32]} />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}
