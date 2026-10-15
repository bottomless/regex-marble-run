import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { zoomAtPoint } from '../../src/scene/Camera.tsx';

type Bounds = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;

const desktop: Bounds = { left: 0, top: 0, width: 1096, height: 900 };

function setup(bounds: Bounds = desktop) {
  const target = new Vector3(2, 3, -1);
  const camera = new PerspectiveCamera(36, bounds.width / bounds.height, 0.01, 1000);
  camera.position.copy(target).add(new Vector3(0, 0, 20));
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  return { camera, target };
}

function clientPoint(bounds: Bounds, x: number, y: number) {
  return new Vector2(bounds.left + bounds.width * x, bounds.top + bounds.height * y);
}

function anchorAt(camera: PerspectiveCamera, target: Vector3, bounds: Bounds, point: Vector2) {
  camera.updateMatrixWorld(true);
  const normal = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const plane = new Plane().setFromNormalAndCoplanarPoint(normal, target);
  const raycaster = new Raycaster();
  raycaster.setFromCamera(
    new Vector2(
      ((point.x - bounds.left) / bounds.width) * 2 - 1,
      1 - ((point.y - bounds.top) / bounds.height) * 2,
    ),
    camera,
  );
  const anchor = raycaster.ray.intersectPlane(plane, new Vector3());
  expect(anchor).not.toBeNull();
  return anchor!;
}

function expectAtScreen(camera: PerspectiveCamera, bounds: Bounds, anchor: Vector3, point: Vector2) {
  camera.updateMatrixWorld(true);
  const projected = anchor.clone().project(camera);
  expect(bounds.left + ((projected.x + 1) / 2) * bounds.width).toBeCloseTo(point.x, 6);
  expect(bounds.top + ((1 - projected.y) / 2) * bounds.height).toBeCloseTo(point.y, 6);
  expect(projected.z).toBeGreaterThan(-1);
  expect(projected.z).toBeLessThan(1);
}

function expectVectorClose(actual: Vector3, expected: Vector3) {
  expect(actual.distanceTo(expected)).toBeLessThan(1e-8);
}

describe('zoomAtPoint', () => {
  it.each([
    { scale: 0.45, x: 0.18, y: 0.23 },
    { scale: 0.45, x: 0.82, y: 0.77 },
    { scale: 1.8, x: 0.18, y: 0.23 },
    { scale: 1.8, x: 0.82, y: 0.77 },
  ])('keeps an off-center anchor at ($x, $y) fixed with scale $scale', ({ scale, x, y }) => {
    const { camera, target } = setup();
    const point = clientPoint(desktop, x, y);
    const anchor = anchorAt(camera, target, desktop, point);
    const initialTarget = target.clone();
    const direction = camera.position.clone().sub(target).normalize();
    const rotation = camera.quaternion.clone();
    const projection = camera.projectionMatrix.clone();

    expectAtScreen(camera, desktop, anchor, point);
    zoomAtPoint(camera, target, desktop, point, point, scale, 1, 100);

    expectAtScreen(camera, desktop, anchor, point);
    expect(camera.position.distanceTo(target)).toBeCloseTo(20 * scale, 8);
    expectVectorClose(camera.position.clone().sub(target).normalize(), direction);
    expect(camera.quaternion.equals(rotation)).toBe(true);
    expect(camera.projectionMatrix.equals(projection)).toBe(true);
    expect(target.distanceTo(initialTarget)).toBeGreaterThan(0.1);
    expect(point).toEqual(clientPoint(desktop, x, y));
  });

  it.each([
    { previousSpan: 160, nextSpan: 320 },
    { previousSpan: 320, nextSpan: 160 },
    { previousSpan: 200, nextSpan: 200 },
  ])(
    'combines midpoint pan with a pinch from $previousSpan to $nextSpan pixels',
    ({ previousSpan, nextSpan }) => {
      const { camera, target } = setup();
      const previousTouches = [
        new Vector2(350 - previousSpan / 2, 260),
        new Vector2(350 + previousSpan / 2, 260),
      ];
      const nextTouches = [new Vector2(650 - nextSpan / 2, 510), new Vector2(650 + nextSpan / 2, 510)];
      const from = previousTouches[0].clone().add(previousTouches[1]).multiplyScalar(0.5);
      const to = nextTouches[0].clone().add(nextTouches[1]).multiplyScalar(0.5);
      const scale =
        previousTouches[0].distanceTo(previousTouches[1]) / nextTouches[0].distanceTo(nextTouches[1]);
      const anchor = anchorAt(camera, target, desktop, from);
      const initialTarget = target.clone();

      zoomAtPoint(camera, target, desktop, from, to, scale, 1, 100);

      expectAtScreen(camera, desktop, anchor, to);
      expect(camera.position.distanceTo(target)).toBeCloseTo(20 * scale, 8);
      expect(target.distanceTo(initialTarget)).toBeGreaterThan(0.1);
      expectVectorClose(camera.position.clone().sub(target).normalize(), new Vector3(0, 0, 1));
    },
  );

  it.each([
    { name: 'minimum', scale: 0.001, limit: 4 },
    { name: 'maximum', scale: 100, limit: 32 },
  ])('clamps at the $name distance without anchor drift and still pans', ({ scale, limit }) => {
    const { camera, target } = setup();
    const from = clientPoint(desktop, 0.79, 0.22);
    const to = clientPoint(desktop, 0.43, 0.68);
    const anchor = anchorAt(camera, target, desktop, from);

    zoomAtPoint(camera, target, desktop, from, from, scale, 4, 32);

    expect(camera.position.distanceTo(target)).toBeCloseTo(limit, 8);
    expectAtScreen(camera, desktop, anchor, from);
    const atLimitPosition = camera.position.clone();
    const atLimitTarget = target.clone();

    for (let i = 0; i < 5; i++) {
      zoomAtPoint(camera, target, desktop, from, from, scale, 4, 32);
      expectAtScreen(camera, desktop, anchor, from);
      expectVectorClose(camera.position, atLimitPosition);
      expectVectorClose(target, atLimitTarget);
    }

    zoomAtPoint(camera, target, desktop, from, to, scale, 4, 32);

    expect(camera.position.distanceTo(target)).toBeCloseTo(limit, 8);
    expectAtScreen(camera, desktop, anchor, to);
    const cameraTranslation = camera.position.clone().sub(atLimitPosition);
    const targetTranslation = target.clone().sub(atLimitTarget);
    expect(targetTranslation.length()).toBeGreaterThan(0.1);
    expectVectorClose(cameraTranslation, targetTranslation);

    zoomAtPoint(camera, target, desktop, to, from, scale, 4, 32);

    expectAtScreen(camera, desktop, anchor, from);
    expectVectorClose(camera.position, atLimitPosition);
    expectVectorClose(target, atLimitTarget);
  });

  it.each([0.55, 1.6])('anchors on the camera-facing plane of a rotated camera with scale %s', (scale) => {
    const { camera, target } = setup();
    target.set(-3, 5, 2);
    camera.position.copy(target).add(new Vector3(13, 9, 17));
    camera.up.set(0.2, 1, 0.1).normalize();
    camera.lookAt(target);
    camera.zoom = 1.3;
    camera.updateProjectionMatrix();
    const from = clientPoint(desktop, 0.77, 0.21);
    const to = clientPoint(desktop, 0.36, 0.68);
    const anchor = anchorAt(camera, target, desktop, from);
    const initialTarget = target.clone();
    const offset = camera.position.clone().sub(target);
    const rotation = camera.quaternion.clone();
    const normal = new Vector3(0, 0, -1).applyQuaternion(rotation);

    zoomAtPoint(camera, target, desktop, from, to, scale, 1, 100);

    expectAtScreen(camera, desktop, anchor, to);
    expectVectorClose(camera.position.clone().sub(target), offset.multiplyScalar(scale));
    expect(target.clone().sub(initialTarget).dot(normal)).toBeCloseTo(0, 8);
    expect(camera.quaternion.equals(rotation)).toBe(true);
    expect(camera.zoom).toBe(1.3);
  });

  it.each([0.6, 1.6])('preserves the anchor with the desktop framing view offset and scale %s', (scale) => {
    const { camera, target } = setup();
    camera.setViewOffset(desktop.width, desktop.height, 0, (68 - 108) / 2, desktop.width, desktop.height);
    const view = { ...camera.view };
    const projection = camera.projectionMatrix.clone();
    const from = clientPoint(desktop, 0.81, 0.18);
    const to = clientPoint(desktop, 0.58, 0.61);
    const anchor = anchorAt(camera, target, desktop, from);

    zoomAtPoint(camera, target, desktop, from, to, scale, 1, 100);

    expectAtScreen(camera, desktop, anchor, to);
    expect(camera.position.distanceTo(target)).toBeCloseTo(20 * scale, 8);
    expect(camera.view).toEqual(view);
    expect(camera.projectionMatrix.equals(projection)).toBe(true);
  });

  it('accounts for horizontal and vertical projection offsets in a cropped view', () => {
    const { camera, target } = setup();
    camera.setViewOffset(2200, 1600, 320, 125, desktop.width, desktop.height);
    const point = clientPoint(desktop, 0.74, 0.28);
    const anchor = anchorAt(camera, target, desktop, point);

    zoomAtPoint(camera, target, desktop, point, point, 0.5, 1, 100);

    expectAtScreen(camera, desktop, anchor, point);
    expect(camera.position.distanceTo(target)).toBeCloseTo(10, 8);
  });

  it.each([0.5, 1.8])('accounts for mobile canvas DOM offsets with scale %s', (scale) => {
    const bounds: Bounds = { left: 18.5, top: 134.25, width: 390, height: 520 };
    const localBounds: Bounds = { ...bounds, left: 0, top: 0 };
    const { camera, target } = setup(bounds);
    const local = setup(localBounds);
    const from = clientPoint(bounds, 0.24, 0.33);
    const to = clientPoint(bounds, 0.68, 0.57);
    const anchor = anchorAt(camera, target, bounds, from);

    zoomAtPoint(camera, target, bounds, from, to, scale, 1, 100);
    zoomAtPoint(
      local.camera,
      local.target,
      localBounds,
      clientPoint(localBounds, 0.24, 0.33),
      clientPoint(localBounds, 0.68, 0.57),
      scale,
      1,
      100,
    );

    expectAtScreen(camera, bounds, anchor, to);
    expect(camera.position.distanceTo(target)).toBeCloseTo(20 * scale, 8);
    expectVectorClose(camera.position, local.camera.position);
    expectVectorClose(target, local.target);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])(
    'ignores invalid scale %s without moving the camera or target',
    (scale) => {
      const { camera, target } = setup();
      const position = camera.position.clone();
      const initialTarget = target.clone();
      const rotation = camera.quaternion.clone();
      const projection = camera.projectionMatrix.clone();

      zoomAtPoint(camera, target, desktop, new Vector2(200, 300), new Vector2(600, 500), scale, 1, 100);

      expect(camera.position).toEqual(position);
      expect(target).toEqual(initialTarget);
      expect(camera.quaternion.toArray()).toEqual(rotation.toArray());
      expect(camera.projectionMatrix).toEqual(projection);
    },
  );

  it.each([
    { width: 0, height: 900 },
    { width: 1096, height: 0 },
    { width: -1, height: 900 },
    { width: 1096, height: -1 },
    { width: 0, height: 0 },
  ])('ignores degenerate viewport dimensions $width x $height', ({ width, height }) => {
    const { camera, target } = setup();
    const position = camera.position.clone();
    const initialTarget = target.clone();
    const bounds = { ...desktop, width, height };

    zoomAtPoint(camera, target, bounds, new Vector2(200, 300), new Vector2(600, 500), 0.5, 1, 100);

    expect(camera.position).toEqual(position);
    expect(target).toEqual(initialTarget);
  });

  it('leaves coincident camera and target positions finite and unchanged', () => {
    const { camera, target } = setup();
    camera.position.copy(target);
    const position = camera.position.clone();
    const initialTarget = target.clone();

    zoomAtPoint(camera, target, desktop, new Vector2(200, 300), new Vector2(600, 500), 0.5, 1, 100);

    expect(camera.position).toEqual(position);
    expect(target).toEqual(initialTarget);
    expect(camera.position.toArray().every(Number.isFinite)).toBe(true);
    expect(target.toArray().every(Number.isFinite)).toBe(true);
  });

  it('treats unit scale at a stationary midpoint as a no-op', () => {
    const { camera, target } = setup();
    const position = camera.position.clone();
    const initialTarget = target.clone();
    const point = clientPoint(desktop, 0.83, 0.19);

    zoomAtPoint(camera, target, desktop, point, point, 1, 1, 100);

    expectVectorClose(camera.position, position);
    expectVectorClose(target, initialTarget);
  });

  it('avoids cumulative anchor drift over repeated zoom-in and inverse zoom-out steps', () => {
    const { camera, target } = setup();
    camera.setViewOffset(desktop.width, desktop.height, 0, -20, desktop.width, desktop.height);
    const position = camera.position.clone();
    const initialTarget = target.clone();
    const point = clientPoint(desktop, 0.23, 0.71);
    const anchor = anchorAt(camera, target, desktop, point);
    let distance = camera.position.distanceTo(target);

    for (const scale of [...Array<number>(20).fill(0.9), ...Array<number>(20).fill(1 / 0.9)]) {
      zoomAtPoint(camera, target, desktop, point, point, scale, 0.1, 100);
      distance *= scale;
      expectAtScreen(camera, desktop, anchor, point);
      expect(camera.position.distanceTo(target)).toBeCloseTo(distance, 8);
    }

    expectVectorClose(camera.position, position);
    expectVectorClose(target, initialTarget);
  });
});
