// Leaflet renderers redraw everything on every moveend, and the preview ends a pan every 50 ms. These only redraw
// once the view has left what they last drew (their padding) or the zoom changed; in between, the panes carry them.
import L from 'leaflet';

interface RendererInternals {
  _map?: L.Map & { _animatingZoom?: boolean };
  _bounds?: L.Bounds;
  _zoom?: number;
}

function stillCovered(r: RendererInternals): boolean {
  const map = r._map;
  if (!map || !r._bounds || r._zoom !== map.getZoom() || map._animatingZoom) return false;
  const size = map.getSize();
  const viewport = L.bounds(map.containerPointToLayerPoint([0, 0]), map.containerPointToLayerPoint(size));
  return r._bounds.contains(viewport);
}

const LazyCanvas = (L.Canvas as unknown as { extend(p: object): new (o?: L.RendererOptions) => L.Canvas }).extend({
  _update(this: RendererInternals) {
    if (stillCovered(this)) return;
    (L.Canvas.prototype as unknown as { _update(): void })._update.call(this);
  },
});
const LazySVG = (L.SVG as unknown as { extend(p: object): new (o?: L.RendererOptions) => L.SVG }).extend({
  _update(this: RendererInternals) {
    if (stillCovered(this)) return;
    (L.SVG.prototype as unknown as { _update(): void })._update.call(this);
  },
});

export const lazyCanvas = (options?: L.RendererOptions) => new LazyCanvas(options);
export const lazySvg = (options?: L.RendererOptions) => new LazySVG(options);
