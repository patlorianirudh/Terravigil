import { useState } from 'react';
import L from 'leaflet';
import { TileLayer } from 'react-leaflet';
import { config } from '../../config';
import { GraticuleLayer } from './GraticuleLayer';

export type BasemapMode = 'satellite' | 'street' | 'grid';


export function BasemapLayer({ mode }: { mode: BasemapMode }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  if (mode === 'grid') return <GraticuleLayer />;
  const satellite = mode === 'satellite';
  return (
    <>
      {failed && <GraticuleLayer />}
      <TileLayer
        key={`${mode}-${String(attempt)}`}
        url={satellite ? config.tileUrl : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'}
        attribution={
          satellite
            ? config.tileAttribution
            : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }
        subdomains="abc"
        maxZoom={22}
        zIndex={1}
        maxNativeZoom={satellite ? config.tileMaxNativeZoom : 19}
        updateWhenIdle
        keepBuffer={2}
        eventHandlers={{
          tileerror: () => {
            setFailed(true);
          },
        }}
      />
      {failed && (
        <div
          className="map-tile-notice"
          role="status"
          ref={(node) => {
            if (node) {
              L.DomEvent.disableClickPropagation(node);
              L.DomEvent.disableScrollPropagation(node);
            }
          }}
        >
          <span>
            {satellite ? 'Satellite imagery' : 'Street tiles'} unavailable or incomplete. Check your
            connection or select Grid.
          </span>
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              setAttempt((value) => value + 1);
            }}
          >
            Retry imagery
          </button>
        </div>
      )}
    </>
  );
}
