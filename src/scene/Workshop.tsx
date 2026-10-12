import { Component, Suspense, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer } from '@react-three/drei';
import { ACESFilmicToneMapping } from 'three';
import type { Program } from '../engine/ir.ts';
import { layout } from '../layout/layout.ts';
import DebugLayout from '../layout/DebugLayout.tsx';
import { copy } from '../copy.ts';
import { usePlaybackController } from '../playback/usePlayback.ts';
import type { PlaybackStore } from '../playback/store.ts';
import Transport from '../playback/Transport.tsx';
import { displayMetrics } from './geometry.ts';
import { useMaterials } from './materials.ts';
import Machine from './Machine.tsx';
import Camera from './Camera.tsx';

interface WorkshopProps {
  program: Program;
  input: string;
  dark: boolean;
  reducedMotion: boolean;
  resetKey: number;
}

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Scene({
  machine,
  program,
  input,
  dark,
  reducedMotion,
  resetKey,
  store,
  onExpand,
}: WorkshopProps & {
  machine: ReturnType<typeof layout>;
  store: PlaybackStore;
  onExpand: (id: number) => void;
}) {
  const materials = useMaterials(dark);
  const canvas = useThree((state) => state.gl.domElement);
  useEffect(() => {
    canvas.setAttribute('data-pattern', program.source);
    canvas.setAttribute('data-pieces', String(machine.pieces.length));
  }, [canvas, machine, program]);
  const metrics = useMemo(() => displayMetrics(machine), [machine]);
  const studio = dark ? '#22231f' : '#f3f0e8';
  return (
    <>
      <color attach="background" args={[studio]} />
      <ambientLight intensity={dark ? 0.9 : 1.5} />
      <directionalLight
        position={[8, 17, 10]}
        intensity={dark ? 3 : 4}
        color="#fff0d8"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={18}
        shadow-camera-bottom={-14}
        shadow-bias={-0.0007}
        shadow-normalBias={0.04}
      />
      <directionalLight position={[-9, 10, -4]} intensity={1.8} color="#e3eaf0" />
      <Environment resolution={64}>
        <Lightformer
          intensity={4}
          position={[-5, 8, 5]}
          scale={[9, 5, 1]}
          rotation={[0, Math.PI / 4, 0]}
          color="#fff6e5"
        />
        <Lightformer
          intensity={3}
          position={[5, 6, -5]}
          scale={[5, 9, 1]}
          rotation={[0, -Math.PI / 3, 0]}
          color="#d9e1e0"
        />
        <Lightformer
          intensity={2}
          position={[0, 13, 0]}
          scale={[8, 8, 1]}
          rotation={[Math.PI / 2, 0, 0]}
          color="#ffffff"
        />
      </Environment>
      <Machine
        key={`${program.source}/${machine.pieces.length}`}
        machine={machine}
        program={program}
        input={input}
        materials={materials}
        reducedMotion={reducedMotion}
        onExpand={onExpand}
        store={store}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshBasicMaterial color={studio} toneMapped={false} />
      </mesh>
      <ContactShadows
        key={`${program.source}/${dark}/${machine.pieces.length}`}
        position={[0, 0, 0]}
        opacity={dark ? 0.5 : 0.36}
        scale={35}
        blur={2.2}
        far={18}
        resolution={256}
        frames={1}
        color="#3e3121"
      />
      <Camera metrics={metrics} reducedMotion={reducedMotion} resetKey={resetKey} />
    </>
  );
}

const EMPTY_MODULES: number[] = [];

function BuildWorkshop(props: WorkshopProps) {
  const { program } = props;
  const moduleKey = `${program.source}/${program.flagsText}`;
  const [expansion, setExpansion] = useState<{ key: string; ids: number[] }>({ key: '', ids: [] });
  const expandedModules = expansion.key === moduleKey ? expansion.ids : EMPTY_MODULES;
  function expand(id: number) {
    setExpansion((current) => {
      const ids = current.key === moduleKey ? current.ids : [];
      return { key: moduleKey, ids: ids.includes(id) ? ids : [...ids, id] };
    });
  }
  const built = useMemo(() => {
    try {
      return { machine: layout(program, { expandedModules }), error: null };
    } catch (error) {
      return { machine: null, error: error instanceof Error ? error.message : copy.scene.tooLarge };
    }
  }, [program, expandedModules]);
  const playback = usePlaybackController({
    pattern: program.source,
    flags: program.flagsText,
    input: props.input,
    program,
    layout: built.machine,
    reducedMotion: props.reducedMotion,
  });
  const fallback = (
    <div className="scene-fallback">
      <p role="status">{copy.scene.error}</p>
      <DebugLayout pattern={program.source} flags={program.flagsText} />
    </div>
  );
  if (!built.machine)
    return (
      <p className="stage-message" role="status">
        {built.error}
      </p>
    );
  return (
    <SceneBoundary fallback={fallback}>
      <>
        <Canvas
          shadows="percentage"
          dpr={[1, 1.5]}
          frameloop="demand"
          camera={{ position: [4, 10, 22], fov: 42 }}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          fallback={fallback}
          onCreated={({ gl }) => {
            gl.toneMapping = ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.05;
            gl.domElement.tabIndex = 0;
            gl.domElement.setAttribute('aria-label', copy.scene.canvas);
            gl.domElement.setAttribute('role', 'img');
          }}
        >
          <Suspense fallback={null}>
            <Scene {...props} machine={built.machine} store={playback.store} onExpand={expand} />
          </Suspense>
        </Canvas>
        {built.machine.pieces.some((piece) => piece.kind === 'module') && (
          <div className="module-tools" aria-label={copy.scene.expand}>
            {built.machine.pieces
              .filter((piece) => piece.kind === 'module')
              .map((piece) => (
                <button type="button" key={piece.node} onClick={() => expand(piece.node!)}>
                  {copy.scene.expandModule(piece.label ?? String(piece.node))}
                </button>
              ))}
          </div>
        )}
        <Transport store={playback.store} />
      </>
    </SceneBoundary>
  );
}

export default function Workshop(props: WorkshopProps) {
  return <BuildWorkshop {...props} />;
}
