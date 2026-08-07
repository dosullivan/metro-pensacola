import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { Map as LibreMap, Marker } from 'maplibre-gl';
import { circle } from '@turf/turf';
import { PENSACOLA_CENTER } from '../../data/pensacola/bounds';
import { PENSACOLA_ZONES } from '../../data/pensacola/zones';
import { selectActiveScenario, useScenarioStore } from '../../store/scenarioStore';
import {
  snapCoordinateToLineGeometry,
  snapCoordinateToRoadCorridors,
  type CorridorCollection
} from '../../simulation/snapping';
import type { Coordinate, OverlayKey, Scenario, SimulationResults, SimulationZone, TransitLine } from '../../types';

const overlayPriority: OverlayKey[] = [
  'development',
  'accessibility',
  'ridership',
  'landValue',
  'density',
  'employment',
  'population'
];

const minMaxOverlays = new Set<OverlayKey>(['density', 'landValue']);
const resultOverlays = new Set<OverlayKey>(['accessibility', 'ridership', 'development']);

const mapStyle: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors'
    }
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
      paint: {
        'raster-saturation': -0.55,
        'raster-brightness-min': 0.1,
        'raster-brightness-max': 0.72,
        'raster-contrast': 0.18
      }
    }
  ]
};

function activeOverlay(
  overlays: Record<OverlayKey, boolean>,
  results?: SimulationResults
): OverlayKey | undefined {
  return overlayPriority.find((overlay) => overlays[overlay] && (results || !resultOverlays.has(overlay)));
}

function zoneMetric(
  zone: SimulationZone,
  overlay: OverlayKey | undefined,
  results?: SimulationResults
): number {
  const zoneResult = results?.zoneResults.find((result) => result.zoneId === zone.id);
  switch (overlay) {
    case 'employment':
      return zone.jobs;
    case 'density':
      return zone.density;
    case 'accessibility':
      return zoneResult?.accessibilityScore ?? 0;
    case 'ridership':
      return zoneResult?.transitTrips ?? 0;
    case 'development':
      return zoneResult?.developmentPressure ?? 0;
    case 'landValue':
      return zone.landValueIndex + (zoneResult?.landValueGrowth ?? 0);
    case 'population':
      return zone.population;
    default:
      return 0;
  }
}

function quantile(values: number[], percentile: number): number {
  if (values.length === 0) {
    return 0;
  }
  const index = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * percentile)));
  return values[index];
}

function normalizeOverlayValues(values: number[], overlay: OverlayKey | undefined): number[] {
  if (!overlay) {
    return values.map(() => 0);
  }

  const sortedValues = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sortedValues.length === 0) {
    return values.map(() => 0);
  }

  const lowerBound = minMaxOverlays.has(overlay) ? sortedValues[0] : 0;
  const percentileCap = quantile(sortedValues, 0.95);
  const upperBound =
    percentileCap > lowerBound ? percentileCap : sortedValues[sortedValues.length - 1];

  if (upperBound <= lowerBound) {
    return values.map((value) => (value > 0 ? 0.65 : 0));
  }

  return values.map((value) => Math.min(1, Math.max(0, (value - lowerBound) / (upperBound - lowerBound))));
}

function zoneFeatures(
  zones: SimulationZone[],
  scenario: Scenario,
  overlays: Record<OverlayKey, boolean>
): GeoJSON.FeatureCollection {
  const overlay = activeOverlay(overlays, scenario.results);
  const rawValues = zones.map((zone) => zoneMetric(zone, overlay, scenario.results));
  const overlayValues = normalizeOverlayValues(rawValues, overlay);

  return {
    type: 'FeatureCollection',
    features: zones.map((zone, index) => ({
      type: 'Feature',
      properties: {
        id: zone.id,
        name: zone.name,
        countyName: zone.countyName ?? '',
        overlay: overlay ?? 'none',
        overlayValue: overlayValues[index],
        population: zone.population,
        jobs: zone.jobs
      },
      geometry: zone.geometry ?? {
        type: 'Polygon',
        coordinates: [zone.polygon]
      }
    }))
  };
}

function lineFeatures(lines: TransitLine[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: lines
      .filter((line) => line.geometry.length >= 2)
      .map((line) => ({
        type: 'Feature',
        properties: {
          id: line.id,
          name: line.name,
          color: line.color
        },
        geometry: {
          type: 'LineString',
          coordinates: line.geometry
        }
      }))
  };
}

function catchmentFeatures(lines: TransitLine[], enabled: boolean): GeoJSON.FeatureCollection {
  if (!enabled) {
    return { type: 'FeatureCollection', features: [] };
  }

  const features = lines.flatMap((line) =>
    line.stations.flatMap((station) => {
      const halfMile = circle(station.coordinate, 0.5, { steps: 48, units: 'miles' });
      const oneMile = circle(station.coordinate, 1, { steps: 48, units: 'miles' });
      return [
        {
          ...oneMile,
          properties: { id: `${station.id}-one`, stationId: station.id, radius: 1, color: line.color }
        },
        {
          ...halfMile,
          properties: { id: `${station.id}-half`, stationId: station.id, radius: 0.5, color: line.color }
        }
      ];
    })
  );

  return { type: 'FeatureCollection', features };
}

function coordinatesMatch(a: Coordinate, b: Coordinate): boolean {
  return Math.abs(a[0] - b[0]) < 0.000001 && Math.abs(a[1] - b[1]) < 0.000001;
}

function isStopCoordinate(line: TransitLine, coordinate: Coordinate): boolean {
  return line.stations.some((station) => coordinatesMatch(station.coordinate, coordinate));
}

function setGeoJsonSource(map: LibreMap, sourceId: string, data: GeoJSON.FeatureCollection) {
  const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(data);
  }
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function addMapSourcesAndLayers(map: LibreMap) {
  if (!map.getSource('zones')) {
    map.addSource('zones', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    map.addLayer({
      id: 'zones-fill',
      type: 'fill',
      source: 'zones',
      paint: {
        'fill-color': [
          'interpolate',
          ['linear'],
          ['get', 'overlayValue'],
          0,
          'rgba(20, 184, 166, 0.0)',
          0.35,
          'rgba(250, 204, 21, 0.36)',
          1,
          'rgba(239, 68, 68, 0.46)'
        ],
        'fill-opacity': 0.75
      }
    });
    map.addLayer({
      id: 'zones-outline',
      type: 'line',
      source: 'zones',
      paint: {
        'line-color': 'rgba(226, 232, 240, 0.32)',
        'line-width': 1
      }
    });
  }

  if (!map.getSource('catchments')) {
    map.addSource('catchments', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    map.addLayer({
      id: 'catchments-fill',
      type: 'fill',
      source: 'catchments',
      paint: {
        'fill-color': ['case', ['==', ['get', 'radius'], 0.5], 'rgba(96, 165, 250, 0.16)', 'rgba(45, 212, 191, 0.08)'],
        'fill-outline-color': 'rgba(191, 219, 254, 0.34)'
      }
    });
  }

  if (!map.getSource('transit-lines')) {
    map.addSource('transit-lines', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    map.addLayer({
      id: 'transit-lines-casing',
      type: 'line',
      source: 'transit-lines',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': 'rgba(15, 23, 42, 0.9)',
        'line-width': 9
      }
    });
    map.addLayer({
      id: 'transit-lines',
      type: 'line',
      source: 'transit-lines',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 5,
        'line-opacity': 0.95
      }
    });
  }

  if (!map.getSource('osm-corridors')) {
    map.addSource('osm-corridors', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    map.addLayer({
      id: 'osm-corridors',
      type: 'line',
      source: 'osm-corridors',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': 'rgba(45, 212, 191, 0.35)',
        'line-width': 1.4
      }
    });
  }
}

export function TransitMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const markersRef = useRef<globalThis.Map<string, Marker>>(new globalThis.Map());
  const routeVertexMarkersRef = useRef<globalThis.Map<string, Marker>>(new globalThis.Map());
  const [osmCorridors, setOsmCorridors] = useState<CorridorCollection | undefined>();

  const scenario = useScenarioStore(selectActiveScenario);
  const mode = useScenarioStore((state) => state.mode);
  const buildTool = useScenarioStore((state) => state.buildTool);
  const roadSnapEnabled = useScenarioStore((state) => state.roadSnapEnabled);
  const selectedTechnology = useScenarioStore((state) => state.selectedTechnology);
  const overlays = useScenarioStore((state) => state.overlays);
  const selectedLineId = useScenarioStore((state) => state.selectedLineId);
  const selectedStationId = useScenarioStore((state) => state.selectedStationId);
  const selectedRoutePointIndex = useScenarioStore((state) => state.selectedRoutePointIndex);
  const addRouteStop = useScenarioStore((state) => state.addRouteStop);
  const addStation = useScenarioStore((state) => state.addStation);
  const selectRoutePoint = useScenarioStore((state) => state.selectRoutePoint);
  const updateRoutePointCoordinate = useScenarioStore((state) => state.updateRoutePointCoordinate);
  const updateStationCoordinate = useScenarioStore((state) => state.updateStationCoordinate);
  const selectLine = useScenarioStore((state) => state.selectLine);
  const setInspectedFeature = useScenarioStore((state) => state.setInspectedFeature);
  const selectedLine = scenario.lines.find((line) => line.id === selectedLineId);
  const snapTechnology = selectedLine?.technology ?? selectedTechnology;
  const canSnapRouteClicks = roadSnapEnabled && (snapTechnology === 'brt' || snapTechnology === 'light-rail');
  const snapStationToLine = (coordinate: Coordinate, line: TransitLine | undefined): Coordinate =>
    line && line.geometry.length >= 2 ? snapCoordinateToLineGeometry(coordinate, line.geometry).coordinate : coordinate;

  const sourceData = useMemo(
    () => ({
      zones: zoneFeatures(PENSACOLA_ZONES, scenario, overlays),
      lines: lineFeatures(scenario.lines),
      corridors:
        roadSnapEnabled && osmCorridors
          ? (osmCorridors as GeoJSON.FeatureCollection)
          : emptyFeatureCollection(),
      catchments: catchmentFeatures(scenario.lines, overlays.catchments)
    }),
    [scenario, overlays, roadSnapEnabled, osmCorridors]
  );
  const sourceDataRef = useRef(sourceData);

  useEffect(() => {
    sourceDataRef.current = sourceData;
  }, [sourceData]);

  useEffect(() => {
    let isMounted = true;
    fetch('/data/pensacola/osm-corridors.geojson')
      .then((response) => (response.ok ? response.json() : undefined))
      .then((data: CorridorCollection | undefined) => {
        if (isMounted && data?.type === 'FeatureCollection') {
          setOsmCorridors(data);
        }
      })
      .catch(() => {
        if (isMounted) {
          setOsmCorridors(undefined);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle,
      center: PENSACOLA_CENTER,
      zoom: 11,
      minZoom: 9,
      maxZoom: 17
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('load', () => {
      addMapSourcesAndLayers(map);
      setGeoJsonSource(map, 'zones', sourceDataRef.current.zones);
      setGeoJsonSource(map, 'transit-lines', sourceDataRef.current.lines);
      setGeoJsonSource(map, 'osm-corridors', sourceDataRef.current.corridors);
      setGeoJsonSource(map, 'catchments', sourceDataRef.current.catchments);
    });

    mapRef.current = map;
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current.clear();
      routeVertexMarkersRef.current.forEach((marker) => marker.remove());
      routeVertexMarkersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) {
      return;
    }
    addMapSourcesAndLayers(map);
    setGeoJsonSource(map, 'zones', sourceData.zones);
    setGeoJsonSource(map, 'transit-lines', sourceData.lines);
    setGeoJsonSource(map, 'osm-corridors', sourceData.corridors);
    setGeoJsonSource(map, 'catchments', sourceData.catchments);
  }, [sourceData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const handleClick = (event: maplibregl.MapMouseEvent) => {
      let coordinate: Coordinate = [event.lngLat.lng, event.lngLat.lat];
      if (mode === 'build') {
        if (buildTool === 'draw-line') {
          if (canSnapRouteClicks) {
            const snapResult = snapCoordinateToRoadCorridors(
              coordinate,
              osmCorridors,
              scenario.assumptions.roadSnapDistanceFeet ?? 650
            );
            coordinate = snapResult.coordinate;
          }
          addRouteStop(coordinate);
        } else {
          addStation(snapStationToLine(coordinate, selectedLine));
        }
        return;
      }

      const features = map.queryRenderedFeatures(event.point, {
        layers: ['transit-lines', 'zones-fill']
      });
      const lineFeature = features.find((feature) => feature.layer.id === 'transit-lines');
      if (lineFeature?.properties?.id) {
        const lineId = String(lineFeature.properties.id);
        selectLine(lineId);
        setInspectedFeature({ type: 'line', id: lineId });
        return;
      }

      const zoneFeature = features.find((feature) => feature.layer.id === 'zones-fill');
      if (zoneFeature?.properties?.id) {
        setInspectedFeature({ type: 'zone', id: String(zoneFeature.properties.id) });
      } else {
        setInspectedFeature(undefined);
      }
    };

    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [
    addRouteStop,
    addStation,
    buildTool,
    canSnapRouteClicks,
    mode,
    osmCorridors,
    scenario.assumptions.roadSnapDistanceFeet,
    selectLine,
    selectedLine,
    setInspectedFeature
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    map.getCanvas().style.cursor = mode === 'build' ? 'crosshair' : 'grab';
  }, [mode, buildTool]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current.clear();

    for (const line of scenario.lines) {
      for (const station of line.stations) {
        const element = document.createElement('button');
        element.className = `station-marker${station.id === selectedStationId ? ' is-selected' : ''}`;
        element.style.setProperty('--station-color', line.color);
        element.title = station.name;
        element.type = 'button';
        element.addEventListener('click', (event) => {
          event.stopPropagation();
          selectLine(line.id);
          setInspectedFeature({ type: 'station', lineId: line.id, stationId: station.id });
        });

        const marker = new maplibregl.Marker({ element, draggable: mode === 'build' })
          .setLngLat(station.coordinate)
          .addTo(map);
        marker.on('dragend', () => {
          const lngLat = marker.getLngLat();
          const coordinate: Coordinate = [lngLat.lng, lngLat.lat];
          marker.setLngLat(coordinate);
          updateStationCoordinate(line.id, station.id, coordinate);
        });
        markersRef.current.set(station.id, marker);
      }
    }
  }, [mode, scenario.lines, selectedLineId, selectedStationId, selectLine, setInspectedFeature, updateStationCoordinate]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    routeVertexMarkersRef.current.forEach((marker) => marker.remove());
    routeVertexMarkersRef.current.clear();

    if (!selectedLine) {
      return;
    }

    selectedLine.geometry.forEach((coordinate, index) => {
      if (isStopCoordinate(selectedLine, coordinate)) {
        return;
      }

      const element = document.createElement('button');
      element.className = `route-vertex-marker${index === selectedRoutePointIndex ? ' is-selected' : ''}`;
      element.style.setProperty('--line-color', selectedLine.color);
      element.title = `Route bend ${index + 1}`;
      element.type = 'button';
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        selectRoutePoint(selectedLine.id, index);
      });

      const marker = new maplibregl.Marker({ element, draggable: true })
        .setLngLat(coordinate)
        .addTo(map);
      marker.on('dragend', () => {
        const lngLat = marker.getLngLat();
        updateRoutePointCoordinate(selectedLine.id, index, [lngLat.lng, lngLat.lat]);
      });
      routeVertexMarkersRef.current.set(`${selectedLine.id}-${index}`, marker);
    });
  }, [
    selectedLine,
    selectedRoutePointIndex,
    selectRoutePoint,
    updateRoutePointCoordinate
  ]);

  return (
    <div className="map-shell">
      <div ref={containerRef} className="map-container" />
    </div>
  );
}
