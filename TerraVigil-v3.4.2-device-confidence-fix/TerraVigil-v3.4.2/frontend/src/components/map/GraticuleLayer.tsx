import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { TOKENS } from '../../styles/tokens';

/** Accurate, network-independent geographic references. This layer deliberately
 * does not invent terrain or imply that unsurveyed ground has been examined. */
const GraticuleGrid = L.GridLayer.extend({
  createTile(this: L.GridLayer & { _map: L.Map }, coords: L.Coords): HTMLCanvasElement {
    const size = this.getTileSize();
    const canvas = document.createElement('canvas');
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size.x * ratio;
    canvas.height = size.y * ratio;
    canvas.style.width = `${String(size.x)}px`;
    canvas.style.height = `${String(size.y)}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = TOKENS.surfaces.surfaceSunken;
    ctx.fillRect(0, 0, size.x, size.y);
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = TOKENS.borders.border;
    ctx.globalAlpha = 0.55;
    for (let i = 1; i < 8; i += 1) {
      const at = Math.round((size.x / 8) * i) + 0.5;
      ctx.beginPath();
      ctx.moveTo(at, 0);
      ctx.lineTo(at, size.y);
      ctx.moveTo(0, at);
      ctx.lineTo(size.x, at);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.65;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size.x - 1, size.y - 1);
    ctx.strokeStyle = TOKENS.borders.borderStrong;
    for (let x = 0; x < size.x; x += 128)
      for (let y = 0; y < size.y; y += 128) {
        ctx.beginPath();
        ctx.moveTo(x - 4, y);
        ctx.lineTo(x + 4, y);
        ctx.moveTo(x, y - 4);
        ctx.lineTo(x, y + 4);
        ctx.stroke();
      }
    const nw = this._map.unproject(L.point(coords.x * size.x, coords.y * size.y), coords.z);
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = TOKENS.text.muted;
    ctx.font = '9px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillText(`${nw.lat.toFixed(4)}° / ${nw.lng.toFixed(4)}°`, 9, 17);
    return canvas;
  },
}) as unknown as new (options?: L.GridLayerOptions) => L.GridLayer;
export const GraticuleLayer: React.FC = () => {
  const map = useMap();
  useEffect(() => {
    const layer = new GraticuleGrid({ tileSize: 256, minZoom: 0, maxZoom: 22, zIndex: 0 });
    layer.addTo(map);
    return () => {
      layer.remove();
    };
  }, [map]);
  return null;
};
export const ScaleBar: React.FC = () => {
  const map = useMap();
  useEffect(() => {
    const control = L.control.scale({ imperial: false, position: 'bottomright', maxWidth: 110 });
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map]);
  return null;
};
