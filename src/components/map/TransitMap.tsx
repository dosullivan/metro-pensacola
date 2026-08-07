import { useEffect, useMemo, useRef } from 'react';
import maplibregl, { Map as LibreMap, Marker } from 'maplibre-gl';
import { circle } from '@turf/turf';
import { PENSACOLA_CENTER } from '../../data/pensacola/bounds';
import { PENSACOLA_ZONES } from '../../data/pensacola/zones';
import { selectActiveScenario, useScenarioStore } from '../../store/scenarioStore';
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

function activeOverlay(overlays: Record<OverlayKey, boolean>): OverlayKey | undefined {
  return overlayPriority.find((overlay) => overlays[overlay]);
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

function zoneFeatures(
  zones: SimulationZone[],
  scenario: Scenario,
  overlays: Record<OverlayKey, boolean>
): GeoJSON.FeatureCollection {
  const overlay = activeOverlay(overlays);
  const rawValues = zones.map((zone) => zoneMetric(zone, overlay, scenario.results));
  const maxValue = Math.max(...rawValues, 1);

  return {
    type: 'FeatureCollection',
    features: zones.map((zone, index) => ({
      type: 'Feature',
      properties: {
        id: zone.id,
        name: zone.name,
        countyName: zone.countyName ?? '',
        overlay: overlay ?? 'none',
        overlayValue: rawValues[index] / maxValue,
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

function routePointFeatures(lines: TransitLine[], selectedLineId?: string): GeoJSON.FeatureCollection {
  const selectedLine = lines.find((line) => line.id === selectedLineId);
  if (!selectedLine) {
    return { type: 'FeatureCollection', features: [] };
  }

  return {
    type: 'FeatureCollection',
    features: selectedLine.geometry.map((coordinate, index) => ({
      type: 'Feature',
      properties: {
        id: `${selectedLine.id}-route-point-${index}`,
        lineId: selectedLine.id,
        index,
        color: selectedLine.color
      },
      geometry: {
        type: 'Point',
        coordinates: coordinate
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

function setGeoJsonSource(map: LibreMap, sourceId: string, data: GeoJSON.FeatureCollection) {
  const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(data);
  }
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

  if (!map.getSource('route-points')) {
    map.addSource('route-points', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    map.addLayer({
      id: 'route-points-halo',
      type: 'circle',
      source: 'route-points',
      paint: {
        'circle-color': 'rgba(15, 23, 42, 0.92)',
        'circle-radius': 8,
        'circle-stroke-color': 'rgba(244, 241, 234, 0.85)',
        'circle-stroke-width': 1.5
      }
    });
    map.addLayer({
      id: 'route-points',
      type: 'circle',
      source: 'route-points',
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': 4.5
      }
    });
  }
}

export function TransitMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const markersRef = useRef<globalThis.Map<string, Marker>>(new globalThis.Map());

  const scenario = useScenarioStore(selectActiveScenario);
  const mode = useScenarioStore((state) => state.mode);
  const buildTool = useScenarioStore((state) => state.buildTool);
  const overlays = useScenarioStore((state) => state.overlays);
  const selectedLineId = useScenarioStore((state) => state.selectedLineId);
  const selectedStationId = useScenarioStore((state) => state.selectedStationId);
  const addRoutePoint = useScenarioStore((state) => state.addRoutePoint);
  const addStation = useScenarioStore((state) => state.addStation);
  const updateStationCoordinate = useScenarioStore((state) => state.updateStationCoordinate);
  const selectLine = useScenarioStore((state) => state.selectLine);
  const setInspectedFeature = useScenarioStore((state) => state.setInspectedFeature);

  const sourceData = useMemo(
    () => ({
      zones: zoneFeatures(PENSACOLA_ZONES, scenario, overlays),
      lines: lineFeatures(scenario.lines),
      routePoints: routePointFeatures(scenario.lines, selectedLineId),
      catchments: catchmentFeatures(scenario.lines, overlays.catchments)
    }),
    [scenario, overlays, selectedLineId]
  );
  const sourceDataRef = useRef(sourceData);

  useEffect(() => {
    sourceDataRef.current = sourceData;
  }, [sourceData]);

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
      setGeoJsonSource(map, 'route-points', sourceDataRef.current.routePoints);
      setGeoJsonSource(map, 'catchments', sourceDataRef.current.catchments);
    });

    mapRef.current = map;
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current.clear();
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
    setGeoJsonSource(map, 'route-points', sourceData.routePoints);
    setGeoJsonSource(map, 'catchments', sourceData.catchments);
  }, [sourceData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const handleClick = (event: maplibregl.MapMouseEvent) => {
      const coordinate: Coordinate = [event.lngLat.lng, event.lngLat.lat];
      if (mode === 'build') {
        if (buildTool === 'draw-line') {
          addRoutePoint(coordinate);
        } else {
          addStation(coordinate);
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
  }, [addRoutePoint, addStation, buildTool, mode, selectLine, setInspectedFeature]);

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

        const marker = new maplibregl.Marker({ element, draggable: true })
          .setLngLat(station.coordinate)
          .addTo(map);
        marker.on('dragend', () => {
          const lngLat = marker.getLngLat();
          updateStationCoordinate(line.id, station.id, [lngLat.lng, lngLat.lat]);
        });
        markersRef.current.set(station.id, marker);
      }
    }
  }, [scenario.lines, selectedLineId, selectedStationId, selectLine, setInspectedFeature, updateStationCoordinate]);

  return (
    <div className="map-shell">
      <div ref={containerRef} className="map-container" />
    </div>
  );
}
