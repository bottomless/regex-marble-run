import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { MathUtils, PerspectiveCamera, Plane, Ray, Spherical, Vector2, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { SIGN_RISE, type DisplayMetrics } from './geometry.ts';

export interface CameraProps {
  metrics: DisplayMetrics;
  resetKey: number;
  reducedMotion: boolean;
}

export function cameraPose(metrics: DisplayMetrics, aspect: number, fov = 36) {
  const top = metrics.height + 1.6 + SIGN_RISE;
  const target = new Vector3(0, top / 2, 0);
  const direction = new Vector3(0.08, 0.17, 1).normalize();
  const right = new Vector3().crossVectors(new Vector3(0, 1, 0), direction).normalize();
  const up = new Vector3().crossVectors(direction, right);
  const verticalSlope = Math.tan(MathUtils.degToRad(fov) / 2);
  const horizontalSlope = verticalSlope * Math.max(0.01, aspect);
  let distance = 1;

  const bounds = [
    { width: metrics.width, depth: metrics.depth, bottom: 0.6, top },
    { width: metrics.boardWidth, depth: metrics.boardDepth, bottom: 0.1, top: 0.3 },
  ];
  for (const { width, depth, bottom, top } of bounds) {
    for (const x of [-width / 2, width / 2]) {
      for (const y of [bottom, top]) {
        for (const z of [-depth / 2, depth / 2]) {
          const corner = new Vector3(x, y, z).sub(target);
          const nearward = corner.dot(direction);
          distance = Math.max(
            distance,
            nearward + Math.abs(corner.dot(right)) / horizontalSlope,
            nearward + Math.abs(corner.dot(up)) / verticalSlope,
          );
        }
      }
    }
  }

  return { target, position: target.clone().addScaledVector(direction, distance), distance };
}

export function zoomAtPoint(
  camera: PerspectiveCamera,
  target: Vector3,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  from: Vector2,
  to: Vector2,
  scale: number,
  minDistance: number,
  maxDistance: number,
) {
  const distance = camera.position.distanceTo(target);
  if (bounds.width <= 0 || bounds.height <= 0 || distance <= 0 || !Number.isFinite(scale) || scale <= 0) {
    return;
  }

  camera.updateMatrixWorld();
  const plane = new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()), target);
  const ray = new Ray();
  function pointOnPlane(point: Vector2) {
    const direction = new Vector3(
      ((point.x - bounds.left) / bounds.width) * 2 - 1,
      -((point.y - bounds.top) / bounds.height) * 2 + 1,
      0.5,
    )
      .unproject(camera)
      .sub(camera.position)
      .normalize();
    ray.set(camera.position, direction);
    return ray.intersectPlane(plane, new Vector3());
  }

  const anchor = pointOnPlane(from);
  if (!anchor) return;
  const nextDistance = MathUtils.clamp(distance * scale, minDistance, maxDistance);
  camera.position
    .sub(target)
    .multiplyScalar(nextDistance / distance)
    .add(target);
  camera.updateMatrixWorld();
  const shiftedAnchor = pointOnPlane(to);
  if (shiftedAnchor) {
    const shift = anchor.sub(shiftedAnchor);
    camera.position.add(shift);
    target.add(shift);
    camera.updateMatrixWorld();
  }
}

function updateImmediately(controls: OrbitControlsImpl, change: () => void) {
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  change();
  controls.update();
  controls.enableDamping = damping;
}

export function Camera({ metrics, resetKey, reducedMotion }: CameraProps) {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const { width, height } = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const controlsRef = useRef<OrbitControlsImpl>(null);

  const frame = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls || !(camera instanceof PerspectiveCamera) || width < 1 || height < 1) return;

    const compact = width <= 760;
    const topInset = compact ? 0 : 108;
    const bottomInset = compact ? 0 : 68;
    const usableHeight = Math.max(1, height - topInset - bottomInset);
    const fullFov = camera.getEffectiveFOV();
    const fitFov = MathUtils.radToDeg(
      2 * Math.atan(Math.tan(MathUtils.degToRad(fullFov) / 2) * (usableHeight / height)),
    );
    const pose = cameraPose(metrics, width / usableHeight, fitFov);
    pose.position
      .sub(pose.target)
      .multiplyScalar(compact ? 1.02 : 1.06)
      .add(pose.target);
    updateImmediately(controls, () => {
      camera.aspect = width / height;
      if (topInset || bottomInset) {
        camera.setViewOffset(width, height, 0, (bottomInset - topInset) / 2, width, height);
      } else {
        camera.clearViewOffset();
      }
      camera.near = Math.max(0.01, pose.distance / 1000);
      camera.far = Math.max(100, pose.distance * 20);
      camera.up.set(0, 1, 0);
      camera.position.copy(pose.position);
      controls.target.copy(pose.target);
      controls.minDistance = Math.max(0.25, pose.distance * 0.04);
      controls.maxDistance = pose.distance * 3;
      camera.updateProjectionMatrix();
    });
    controls.saveState();
    invalidate();
  }, [camera, height, invalidate, metrics, width]);

  useLayoutEffect(() => {
    frame();
  }, [frame, resetKey]);

  useLayoutEffect(() => {
    return () => {
      if (camera instanceof PerspectiveCamera) {
        camera.clearViewOffset();
        invalidate();
      }
    };
  }, [camera, invalidate]);

  useEffect(() => {
    const pointers = new Map<number, Vector2>();
    const document = canvas.ownerDocument;

    function pinch() {
      if (pointers.size !== 2) return null;
      const [first, second] = [...pointers.values()];
      return {
        center: first.clone().add(second).multiplyScalar(0.5),
        distance: first.distanceTo(second),
      };
    }

    function onPointerDown(event: PointerEvent) {
      if (event.pointerType !== 'touch' || !controlsRef.current?.enabled) return;
      pointers.set(event.pointerId, new Vector2(event.clientX, event.clientY));
    }

    function onPointerMove(event: PointerEvent) {
      if (!pointers.has(event.pointerId)) return;
      const previous = pinch();
      pointers.get(event.pointerId)!.set(event.clientX, event.clientY);
      const current = pinch();
      const controls = controlsRef.current;
      if (
        !previous ||
        !current ||
        !controls?.enabled ||
        !controls.enableZoom ||
        !(camera instanceof PerspectiveCamera)
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      if (previous.distance <= 0 || current.distance <= 0) return;
      updateImmediately(controls, () => {
        zoomAtPoint(
          camera,
          controls.target,
          canvas.getBoundingClientRect(),
          previous.center,
          controls.enablePan ? current.center : previous.center,
          Math.pow(previous.distance / current.distance, controls.zoomSpeed),
          controls.minDistance,
          controls.maxDistance,
        );
      });
      invalidate();
    }

    function onPointerUp(event: PointerEvent) {
      pointers.delete(event.pointerId);
    }

    canvas.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
    };
  }, [camera, canvas, invalidate]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const controls = controlsRef.current;
      if (
        !controls?.enabled ||
        event.target !== canvas ||
        canvas.ownerDocument.activeElement !== canvas ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }
      const key = event.key;
      if (key === 'r' || key === 'R') {
        event.preventDefault();
        frame();
        return;
      }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'].includes(key)) {
        return;
      }
      event.preventDefault();
      updateImmediately(controls, () => {
        const offset = new Vector3().subVectors(camera.position, controls.target);
        const spherical = new Spherical().setFromVector3(offset);
        const step = Math.PI / 36;
        if (event.shiftKey && key.startsWith('Arrow')) {
          const direction = new Vector3().setFromMatrixColumn(
            camera.matrix,
            key === 'ArrowLeft' || key === 'ArrowRight' ? 0 : 1,
          );
          const sign = key === 'ArrowLeft' || key === 'ArrowDown' ? -1 : 1;
          direction.multiplyScalar(spherical.radius * 0.06 * sign);
          controls.target.add(direction);
          camera.position.add(direction);
          return;
        }
        switch (key) {
          case 'ArrowLeft':
            spherical.theta -= step;
            break;
          case 'ArrowRight':
            spherical.theta += step;
            break;
          case 'ArrowUp':
            spherical.phi -= step;
            break;
          case 'ArrowDown':
            spherical.phi += step;
            break;
          case '+':
          case '=':
            spherical.radius /= 1.1;
            break;
          case '-':
          case '_':
            spherical.radius *= 1.1;
            break;
        }
        spherical.phi = MathUtils.clamp(spherical.phi, controls.minPolarAngle, controls.maxPolarAngle);
        spherical.radius = MathUtils.clamp(spherical.radius, controls.minDistance, controls.maxDistance);
        camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
      });
      invalidate();
    }
    canvas.addEventListener('keydown', onKeyDown);
    return () => canvas.removeEventListener('keydown', onKeyDown);
  }, [camera, canvas, frame, invalidate]);

  return (
    <OrbitControls
      ref={controlsRef}
      domElement={canvas}
      makeDefault
      keyEvents={false}
      zoomToCursor
      enablePan
      enableDamping={!reducedMotion}
      dampingFactor={0.08}
      minPolarAngle={Math.PI / 12}
      maxPolarAngle={Math.PI / 2 - 0.05}
    />
  );
}

export default Camera;
