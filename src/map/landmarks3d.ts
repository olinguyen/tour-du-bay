// PROTOTYPE: the Golden Gate Bridge as a three.js scene drawn through a MapLibre custom layer. Loaded on demand from
// GuideMap, so three.js (~140 KB gzipped) only arrives when the reader is in 3D.
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';
import { AmbientLight, BoxGeometry, CatmullRomCurve3, CylinderGeometry, DirectionalLight, Group, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, TubeGeometry, Vector3, WebGLRenderer } from 'three';
import { ALONG, BRIDGE_COLOR, GG, at, cableHeight } from './landmarks';

export const LANDMARK_3D = 'landmark-three';

/** the bridge in its own frame: x along the axis from mid-span, y up, z across; metres */
function bridge(): Group {
  const g = new Group();
  const steel = new MeshStandardMaterial({ color: BRIDGE_COLOR, roughness: 0.75, metalness: 0.1 });
  const box = (x: number, y: number, z: number, l: number, h: number, w: number) => {
    const m = new Mesh(new BoxGeometry(l, h, w), steel);
    m.position.set(x, y, z);
    g.add(m);
  };
  for (const s of [-GG.halfSpan, GG.halfSpan]) {
    for (const side of [-GG.leg, GG.leg]) box(s, GG.tower / 2, side, 16, GG.tower, 10);
    for (const b of [30, 100, 150, 200]) box(s, b + 5, 0, 8, 10, 2 * GG.leg + 10);
  }
  box(60, (GG.deck + GG.deckTop) / 2, 0, 2380, GG.deckTop - GG.deck, GG.width);
  const end = GG.halfSpan + GG.side;
  for (const side of [-GG.cable, GG.cable]) {
    const pts: Vector3[] = [];
    for (let x = -end; x <= end; x += 10) pts.push(new Vector3(x, cableHeight(x), side));
    g.add(new Mesh(new TubeGeometry(new CatmullRomCurve3(pts), 200, 1.4, 6), steel));
    // suspenders every 40 m of the main span; the real ones are 15 m apart but would vanish at these zooms
    for (let x = -GG.halfSpan + 40; x < GG.halfSpan; x += 40) {
      const top = cableHeight(x), h = top - GG.deckTop;
      const m = new Mesh(new CylinderGeometry(0.35, 0.35, h, 4), steel);
      m.position.set(x, GG.deckTop + h / 2, side);
      g.add(m);
    }
  }
  // turn the axis from the frame's +x to the bridge's true bearing (model space is x east, z south, y up)
  g.rotation.y = Math.atan2(ALONG[1], ALONG[0]);
  return g;
}

export function threeLandmarks(map: MlMap): CustomLayerInterface {
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  let renderer: WebGLRenderer | null = null;
  const origin = at(0, 0);
  return {
    id: LANDMARK_3D,
    type: 'custom',
    renderingMode: '3d',
    onAdd(_map, gl) {
      scene.add(bridge());
      // sun from the north-west, as the hillshade has it
      const sun = new DirectionalLight(0xfff4e0, 2.2);
      sun.position.set(-1, 1.4, -1);
      scene.add(sun, new AmbientLight(0xffffff, 0.9));
      renderer = new WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
    },
    onRemove() {
      renderer?.dispose();
      renderer = null;
    },
    render(_gl, args: CustomRenderMethodInput) {
      if (!renderer) return;
      const model = map.transform.getMatrixForModel(origin, 0);
      camera.projectionMatrix = new Matrix4().fromArray(args.defaultProjectionData.mainMatrix as unknown as number[]).multiply(new Matrix4().fromArray(model as unknown as number[]));
      renderer.resetState();
      renderer.render(scene, camera);
      map.triggerRepaint();
    },
  };
}
