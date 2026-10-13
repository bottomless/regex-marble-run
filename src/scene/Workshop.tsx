import { Component, lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { useStore } from 'zustand';
import { ContactShadows, Environment, Lightformer } from '@react-three/drei';
import { ACESFilmicToneMapping } from 'three';
import type { Program } from '../engine/ir.ts';
import { layout } from '../layout/layout.ts';
import DebugLayout from '../layout/DebugLayout.tsx';
import { copy } from '../copy.ts';
import { usePlaybackController, type ViewMode } from '../playback/usePlayback.ts';
import type { PlaybackStore } from '../playback/store.ts';
import { tileStatus } from '../playback/tiles.ts';
import { captureSpans } from '../playback/captures.ts';
import Transport from '../playback/Transport.tsx';
import Hud from '../playback/Hud.tsx';
import MachineParts from '../ui/MachineParts.tsx';
import { displayMetrics, splitPlacement } from './geometry.ts';
import { highlightStore } from '../ui/highlight.ts';
import { useMaterials } from './materials.ts';
import Machine from './Machine.tsx';
import LinearSide from './LinearSide.tsx';
import { useFloodModel } from './Flood.tsx';
import Camera from './Camera.tsx';

const TraceLog = lazy(() => import('../ui/TraceLog.tsx'));

interface WorkshopProps {
  program: Program;
  input: string;
  dark: boolean;
  reducedMotion: boolean;
  resetKey: number;
  mode?: ViewMode;
  onHelp?: () => void;
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
    if (!canvas.hasAttribute('data-flood')) canvas.setAttribute('data-flood', 'false');
    const mirror = (s: ReturnType<PlaybackStore['getState']>) => {
      const activeNode = s.machine?.activeNode ?? null;
      highlightStore.getState().setActive(activeNode === null ? null : (program.nodes[activeNode]?.span ?? null));
      canvas.setAttribute('data-linear', s.linear.status);
      if (s.linear.status === 'ready') {
        const run = s.linear.run;
        canvas.setAttribute('data-linear-ticks', String(run.ticks.length));
        canvas.setAttribute('data-linear-steps', String(run.steps));
        canvas.setAttribute('data-linear-max-threads', String(run.maxThreads));
        canvas.setAttribute('data-linear-end', String(run.end));
      } else {
        for (const name of ['data-linear-ticks', 'data-linear-steps', 'data-linear-max-threads', 'data-linear-end']) {
          canvas.removeAttribute(name);
        }
      }
      canvas.setAttribute('data-event-index', String(s.eventIndex));
      canvas.setAttribute('data-event-count', String(s.eventCount));
      if (s.machine) {
        canvas.setAttribute('data-head', String(s.machine.head));
        canvas.setAttribute('data-attempt-start', String(s.machine.attemptStart));
        const lit: number[] = [];
        for (let i = 0; i < input.length; i++) {
          if (tileStatus(s.machine, i) !== 'pending') lit.push(i);
        }
        canvas.setAttribute('data-lit-tiles', lit.join(','));
        canvas.setAttribute('data-captures', JSON.stringify(captureSpans(s.machine)));
      } else {
        canvas.setAttribute('data-head', '-1');
        canvas.setAttribute('data-attempt-start', '-1');
        canvas.setAttribute('data-lit-tiles', '');
        canvas.setAttribute('data-captures', '[]');
      }
    };
    mirror(store.getState());
    const unsubscribe = store.subscribe(mirror);
    return () => {
      unsubscribe();
      highlightStore.getState().setActive(null);
      highlightStore.getState().setHover(null);
    };
  }, [canvas, machine, program, store, input]);
  const flood = useFloodModel(store);
  const linear = useStore(store, (s) => s.linear);
  const linearRun = linear.status === 'ready' ? linear.run : null;
  const metrics = useMemo(() => displayMetrics(machine, { flood: flood.model !== null }), [machine, flood.model]);
  const rightMetrics = useMemo(() => displayMetrics(machine), [machine]);
  const placement = useMemo(() => (linearRun ? splitPlacement(metrics, rightMetrics) : null), [linearRun, metrics, rightMetrics]);
  const framing = placement?.framing ?? metrics;
  const leftLabel = placement ? `${copy.split.left.toUpperCase()} · ${copy.split.leftEngines}` : undefined;
  const studio = dark ? '#22231f' : '#f3f0e8';
  return (
    <>
      <color attach="background" args={[studio]} />
      <ambientLight intensity={dark ? 1.0 : 1.7} />
      <directionalLight
        position={[6, 16, 14]}
        intensity={dark ? 2.2 : 2.6}
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
      <directionalLight position={[-9, 10, 6]} intensity={1.4} color="#e3eaf0" />
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
      <group position={[placement?.leftX ?? 0, 0, 0]}>
        <Machine
          key={`${program.source}/${machine.pieces.length}`}
          machine={machine}
          program={program}
          input={input}
          materials={materials}
          reducedMotion={reducedMotion}
          onExpand={onExpand}
          store={store}
          metrics={metrics}
          flood={flood.model ? { model: flood.model, recorded: flood.recorded } : null}
          label={leftLabel}
        />
      </group>
      {placement && linearRun && (
        <group position={[placement.rightX, 0, 0]}>
          <LinearSide
            key={`${program.source}/${machine.pieces.length}/linear`}
            machine={machine}
            program={program}
            input={input}
            materials={materials}
            metrics={rightMetrics}
            store={store}
            run={linearRun}
            reducedMotion={reducedMotion}
            onExpand={onExpand}
          />
        </group>
      )}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshBasicMaterial color={studio} toneMapped={false} />
      </mesh>
      <ContactShadows
        key={`${program.source}/${dark}/${machine.pieces.length}/${placement ? 'split' : 'single'}`}
        position={[0, 0, 0]}
        opacity={dark ? 0.45 : 0.3}
        scale={placement ? 35 + framing.boardWidth : 35}
        blur={2.2}
        far={18}
        resolution={256}
        frames={1}
        color="#3e3121"
      />
      <Camera metrics={framing} reducedMotion={reducedMotion} resetKey={resetKey} insetRight={placement ? 320 : 0} />
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
    mode: props.mode,
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
          camera={{ position: [2, 8, 24], fov: 36 }}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          fallback={fallback}
          onCreated={({ gl }) => {
            gl.toneMapping = ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.0;
            gl.domElement.tabIndex = 0;
            gl.domElement.setAttribute('aria-label', copy.scene.canvas);
            gl.domElement.setAttribute('role', 'img');
          }}
        >
          <Suspense fallback={null}>
            <Scene {...props} machine={built.machine} store={playback.store} onExpand={expand} />
          </Suspense>
        </Canvas>
        <MachineParts machine={built.machine} program={program} />
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
        <Hud
          store={playback.store}
          reducedMotion={props.reducedMotion}
          program={program}
          input={props.input}
          onHelp={props.onHelp}
        />
        <Transport store={playback.store} />
        <Suspense fallback={null}>
          <TraceLog store={playback.store} input={props.input} reducedMotion={props.reducedMotion} />
        </Suspense>
      </>
    </SceneBoundary>
  );
}

export default function Workshop(props: WorkshopProps) {
  return <BuildWorkshop {...props} />;
}
