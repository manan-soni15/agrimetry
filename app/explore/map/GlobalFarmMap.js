"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { area as calculateArea } from "@turf/area";

const STORAGE_KEY = "agrimetry:global-farm-map:v1";
const NASA_ATTRIBUTION = "Imagery provided by NASA Global Imagery Browse Services (GIBS), operated by NASA/GSFC ESDIS.";
const FTW_PM_TILES_URL = "https://data.source.coop/ftw/global-field-boundaries/pmtiles/ftw-global-fields-2025.pmtiles";
const FTW_ATTRIBUTION = "Field boundary predictions © Fields of the World / Taylor Geospatial Institute and Microsoft AI for Good Research Lab, CC BY 4.0.";

function Icon({ name, size = 18 }) {
  const paths = {
    leaf: <><path d="M20.5 3.5C12 3.5 5 6.6 5 13.2c0 3.3 2.3 5.3 5.2 5.3 6.3 0 9.9-7.3 10.3-15Z"/><path d="M3.5 21c3.1-5.1 7.4-8.4 13-11"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></>,
    pin: <><path d="M20 10.2c0 5.2-8 11.3-8 11.3S4 15.4 4 10.2a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    crosshair: <><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/><path d="M12 1.5v3m0 15v3m10.5-10.5h-3m-15 0h-3"/></>,
    polygon: <path d="m12 3 8 5-2 10-11 3-3-10 8-8Z"/>,
    rectangle: <rect x="4" y="5" width="16" height="14" rx="1.5"/>,
    edit: <><path d="m14 5 5 5M4 20l4.3-.8L20 7.5 16.5 4 4.8 15.7 4 20Z"/><path d="M13 20h7"/></>,
    trash: <><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></>,
    upload: <><path d="M12 16V4m-5 5 5-5 5 5"/><path d="M4 16v4h16v-4"/></>,
    download: <><path d="M12 4v12m-5-5 5 5 5-5"/><path d="M4 17v3h16v-3"/></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5m-18 4 9 5 9-5"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6"/></>,
    back: <path d="m15 18-6-6 6-6"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.info}</svg>;
}

function polygonFeatures(geojson) {
  if (!geojson || typeof geojson !== "object") return [];
  let input = [];
  if (geojson.type === "FeatureCollection" && Array.isArray(geojson.features)) input = geojson.features;
  else if (geojson.type === "Feature") input = [geojson];
  else if (["Polygon", "MultiPolygon"].includes(geojson.type)) input = [{ type: "Feature", properties: {}, geometry: geojson }];

  const normalized = [];
  for (const feature of input) {
    const geometry = feature?.geometry;
    const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
    for (const coordinates of polygons) {
      const ring = coordinates?.[0];
      if (!Array.isArray(ring) || ring.length < 4) continue;
      const valid = ring.every((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])) && Math.abs(Number(point[0])) <= 180 && Math.abs(Number(point[1])) <= 90);
      if (!valid) continue;
      normalized.push({
        type: "Feature",
        properties: { ...(feature.properties || {}), mode: "polygon", fieldName: feature.properties?.fieldName || feature.properties?.name || `Field ${normalized.length + 1}` },
        geometry: { type: "Polygon", coordinates },
      });
    }
  }
  return normalized;
}

function featureArea(feature) {
  try {
    const value = calculateArea(feature);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function normalizeFtwCandidate(mapFeature) {
  if (!mapFeature?.geometry) return null;
  const rawProperties = mapFeature.properties || {};
  const normalized = polygonFeatures({
    type: "Feature",
    properties: rawProperties,
    geometry: mapFeature.geometry,
  });
  if (!normalized.length) return null;

  const feature = normalized[0];
  const id = rawProperties.id || mapFeature.id || `ftw-${Math.random().toString(36).slice(2, 10)}`;
  const rawDate = rawProperties["determination:datetime"] || rawProperties.determination_datetime || "2025";
  const yearMatch = String(rawDate).match(/20\d{2}/);
  const mappedArea = Number(rawProperties["metrics:area"] || rawProperties.metrics_area);
  const area = Number.isFinite(mappedArea) && mappedArea > 0 ? mappedArea : featureArea(feature);

  return {
    ...feature,
    id: String(id),
    properties: {
      ...feature.properties,
      candidateId: `ftw-${id}`,
      fieldName: `Predicted field ${String(id).slice(0, 10)}`,
      source: "Fields of the World / PRUE",
      predictionYear: yearMatch ? yearMatch[0] : "2025",
      confidence: rawProperties.confidence == null ? null : Number(rawProperties.confidence),
      areaSquareMetres: area,
      reviewRequired: true,
    },
  };
}

function formatArea(squareMetres) {
  const hectares = squareMetres / 10000;
  return hectares >= 100 ? `${hectares.toLocaleString("en", { maximumFractionDigits: 1 })} ha` : `${hectares.toFixed(2)} ha`;
}

function latestModisDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 3);
  return date.toISOString().slice(0, 10);
}

export default function GlobalFarmMap() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const drawRef = useRef(null);
  const markerRef = useRef(null);
  const importRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [basemap, setBasemap] = useState("satellite");
  const [nasaOverlay, setNasaOverlay] = useState(false);
  const [tool, setTool] = useState("select");
  const [query, setQuery] = useState("");
  const [latitudeInput, setLatitudeInput] = useState("");
  const [longitudeInput, setLongitudeInput] = useState("");
  const basemapRef = useRef("satellite");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [selectedPlace, setSelectedPlace] = useState("Global view");
  const [ftwLayerVisible, setFtwLayerVisible] = useState(false);
  const [selectedFtwCandidate, setSelectedFtwCandidate] = useState(null);
  const [detectionError, setDetectionError] = useState("");
  const [fields, setFields] = useState([]);
  const [savedAt, setSavedAt] = useState("");
  const [notice, setNotice] = useState("Draw a polygon or rectangle to mark your farm boundary.");
  const [showLayers, setShowLayers] = useState(true);
  const totalArea = useMemo(() => fields.reduce((sum, feature) => sum + featureArea(feature), 0), [fields]);

  const syncFields = useCallback((drawInstance) => {
    if (!drawInstance) return;
    const snapshot = drawInstance.getSnapshot().filter((feature) =>
      feature.geometry?.type === "Polygon" && !feature.properties?.midPoint && !feature.properties?.selectionPoint && !feature.properties?.closingPoint,
    );
    setFields(snapshot);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch (error) {
      console.warn("Could not persist farm boundaries in this browser:", error);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    let mapInstance;

    async function initializeMap() {
      try {
        const modisDate = latestModisDate();
        const [maplibregl, pmtilesModule] = await Promise.all([
          import("maplibre-gl"),
          import("pmtiles"),
        ]);
        if (!alive || !mapContainerRef.current) return;

        // Register the PMTiles protocol once. The archive is streamed by HTTP
        // range requests, so the browser does not download the global dataset.
        if (!window.__agrimetryPmtilesProtocol) {
          const protocol = new pmtilesModule.Protocol();
          maplibregl.addProtocol("pmtiles", protocol.tile);
          window.__agrimetryPmtilesProtocol = protocol;
        }
        if (maplibregl.setWorkerUrl) {
          maplibregl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
        }

        const style = {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              maxzoom: 19,
              attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
            },
            esri: {
              type: "raster",
              tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
              tileSize: 256,
              maxzoom: 19,
              attribution: 'Tiles © <a href="https://www.esri.com/" target="_blank" rel="noreferrer">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community',
            },
            nasaGibs: {
              type: "raster",
              tiles: [`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${modisDate}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`],
              tileSize: 256,
              minzoom: 0,
              maxzoom: 9,
              attribution: NASA_ATTRIBUTION,
            },
            ftwFields: {
              type: "vector",
              url: `pmtiles://${FTW_PM_TILES_URL}`,
              attribution: FTW_ATTRIBUTION,
            },
            ftwSelected: {
              type: "geojson",
              data: { type: "FeatureCollection", features: [] },
            },
          },
          layers: [
            { id: "osm-base", type: "raster", source: "osm", layout: { visibility: "none" } },
            { id: "esri-satellite", type: "raster", source: "esri", layout: { visibility: "visible" } },
            { id: "nasa-modis-context", type: "raster", source: "nasaGibs", layout: { visibility: "none" }, paint: { "raster-opacity": 0.78 } },
            {
              id: "ftw-field-boundaries-fill",
              type: "fill",
              source: "ftwFields",
              "source-layer": "fields",
              minzoom: 9,
              layout: { visibility: "none" },
              paint: {
                "fill-color": [
                  "interpolate", ["linear"], ["to-number", ["get", "confidence"], 55],
                  0, "#b86f55", 55, "#c7a05d", 69, "#8da66c", 100, "#3f7850",
                ],
                "fill-opacity": 0.12,
              },
            },
            {
              id: "ftw-field-boundaries-outline",
              type: "line",
              source: "ftwFields",
              "source-layer": "fields",
              minzoom: 9,
              layout: { visibility: "none" },
              paint: {
                "line-color": [
                  "interpolate", ["linear"], ["to-number", ["get", "confidence"], 55],
                  0, "#b86f55", 55, "#c7a05d", 69, "#8da66c", 100, "#3f7850",
                ],
                "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.45, 13, 1.1, 17, 2],
                "line-opacity": 0.94,
              },
            },
            {
              id: "ftw-selected-fill",
              type: "fill",
              source: "ftwSelected",
              paint: { "fill-color": "#f3c66d", "fill-opacity": 0.32 },
            },
            {
              id: "ftw-selected-outline",
              type: "line",
              source: "ftwSelected",
              paint: { "line-color": "#f0b949", "line-width": 3.5 },
            },
          ],
        };

        mapInstance = new maplibregl.Map({
          container: mapContainerRef.current,
          style,
          center: [0, 20],
          zoom: 1.65,
          minZoom: 1,
          maxZoom: 19,
          attributionControl: { compact: true },
          cooperativeGestures: true,
        });
        mapRef.current = mapInstance;
        mapInstance.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
        mapInstance.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");

        mapInstance.on("load", async () => {
          if (!alive) return;
          try {
            mapInstance.on("mouseenter", "ftw-field-boundaries-fill", () => {
              mapInstance.getCanvas().style.cursor = "pointer";
            });
            mapInstance.on("mouseleave", "ftw-field-boundaries-fill", () => {
              mapInstance.getCanvas().style.cursor = "";
            });
            mapInstance.on("click", "ftw-field-boundaries-fill", (event) => {
              const candidate = normalizeFtwCandidate(event.features?.[0]);
              if (!candidate) {
                setDetectionError("This map outline could not be converted into a field polygon. Use Trace points to verify the boundary manually.");
                return;
              }
              setSelectedFtwCandidate(candidate);
              mapInstance.getSource("ftwSelected")?.setData({ type: "FeatureCollection", features: [candidate] });
              const confidence = candidate.properties.confidence;
              setDetectionError("");
              setNotice(`Selected a ${candidate.properties.predictionYear} predicted field${confidence == null || !Number.isFinite(confidence) ? ". No model-context confidence value is available here." : ` · model-context confidence ${Math.round(confidence)}/100.`} Review and edit it before using it for analysis.`);
            });

            const terra = await import("terra-draw");
            const adapterModule = await import("terra-draw-maplibre-gl-adapter");
            if (!alive) return;
            const selectFlags = {
              polygon: { feature: { draggable: true }, coordinates: { midpoints: true, draggable: true, deletable: true } },
              freehand: { feature: { draggable: true }, coordinates: { midpoints: true, draggable: true, deletable: true } },
              rectangle: { feature: { draggable: true }, coordinates: { midpoints: true, draggable: true, deletable: true } },
            };
            const draw = new terra.TerraDraw({
              adapter: new adapterModule.TerraDrawMapLibreGLAdapter({ map: mapInstance, lib: maplibregl }),
              modes: [new terra.TerraDrawPolygonMode(), new terra.TerraDrawFreehandMode(), new terra.TerraDrawRectangleMode(), new terra.TerraDrawSelectMode({ flags: selectFlags })],
            });
            draw.start();
            draw.setMode("select");
            drawRef.current = draw;
            draw.on("change", () => syncFields(draw));
            draw.on("finish", () => syncFields(draw));
            // Keep the initial basemap in sync once the style is fully ready.
            mapInstance.setLayoutProperty("osm-base", "visibility", basemapRef.current === "street" ? "visible" : "none");
            mapInstance.setLayoutProperty("esri-satellite", "visibility", basemapRef.current === "satellite" ? "visible" : "none");

            try {
              const saved = localStorage.getItem(STORAGE_KEY);
              if (saved) {
                const restored = polygonFeatures({ type: "FeatureCollection", features: JSON.parse(saved) });
                if (restored.length) {
                  draw.addFeatures(restored);
                  syncFields(draw);
                  setNotice("Your previously saved field boundaries were restored from this browser.");
                }
              }
            } catch (storageError) {
              console.warn("Saved farm boundaries could not be restored:", storageError);
            }
            setMapReady(true);
          } catch (drawError) {
            console.error("Farm drawing tools failed to initialize:", drawError);
            setMapError("The map loaded, but field drawing tools could not start. Check the mapping package installation.");
          }
        });
        mapInstance.on("error", (event) => {
          if (event?.error) console.warn("Map tile or style warning:", event.error.message);
          if (event?.sourceId === "ftwFields") {
            setDetectionError("The global field-boundary archive could not be loaded. Check your connection and PMTiles requests in the browser Network panel.");
          }
        });
      } catch (error) {
        console.error("Map initialization failed:", error);
        if (alive) setMapError("The map could not be initialized. Check your connection and package installation, then reload.");
      }
    }

    initializeMap();
    return () => {
      alive = false;
      if (drawRef.current) {
        try { drawRef.current.stop(); } catch { /* Map may already be disposed. */ }
        drawRef.current = null;
      }
      markerRef.current?.remove();
      mapInstance?.remove();
      mapRef.current = null;
    };
  }, [syncFields]);

  useEffect(() => {
    basemapRef.current = basemap;
    const map = mapRef.current;
    if (!map) return;
    const applyBasemap = () => {
      if (!map.getLayer("osm-base") || !map.getLayer("esri-satellite")) return;
      map.setLayoutProperty("osm-base", "visibility", basemap === "street" ? "visible" : "none");
      map.setLayoutProperty("esri-satellite", "visibility", basemap === "satellite" ? "visible" : "none");
    };
    if (map.isStyleLoaded()) applyBasemap();
    else map.once("load", applyBasemap);
  }, [basemap, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    map.setLayoutProperty("nasa-modis-context", "visibility", nasaOverlay ? "visible" : "none");
  }, [nasaOverlay, mapReady]);

  const goToLocation = useCallback(async (latitude, longitude, label) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [longitude, latitude], zoom: 15, speed: 1.25, curve: 1.35, essential: true });
    markerRef.current?.remove();
    const maplibregl = await import("maplibre-gl");
    if (mapRef.current) {
      markerRef.current = new maplibregl.Marker({ color: "#244f38" })
        .setLngLat([longitude, latitude])
        .setPopup(new maplibregl.Popup({ offset: 22 }).setText(label || "Selected farm location"))
        .addTo(mapRef.current);
    }
    setSelectedPlace(label || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
  }, []);

  function parseCoordinatePair(value) {
    const match = value.trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!match) return null;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    return { latitude, longitude };
  }

  function goToEnteredCoordinates(event) {
    event?.preventDefault();
    const latitude = Number(latitudeInput);
    const longitude = Number(longitudeInput);
    if (!latitudeInput.trim() || !longitudeInput.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      setSearchError("Enter a valid latitude (−90 to 90) and longitude (−180 to 180).");
      return;
    }
    setSearchError("");
    setSearchResults([]);
    goToLocation(latitude, longitude, `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
  }

  async function handleSearch(event) {
    event?.preventDefault();
    const coordinatePair = parseCoordinatePair(query);
    if (coordinatePair) {
      setSearchError("");
      setSearchResults([]);
      setLatitudeInput(String(coordinatePair.latitude));
      setLongitudeInput(String(coordinatePair.longitude));
      goToLocation(coordinatePair.latitude, coordinatePair.longitude, `${coordinatePair.latitude.toFixed(5)}, ${coordinatePair.longitude.toFixed(5)}`);
      return;
    }
    if (query.trim().length < 2) {
      setSearchError("Enter a place name or a latitude, longitude pair.");
      return;
    }
    setSearchLoading(true);
    setSearchError("");
    setSearchResults([]);
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query.trim())}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Location search failed.");
      if (!payload.results?.length) setSearchError("No matching places found. Try adding a region or country.");
      else setSearchResults(payload.results);
    } catch (error) {
      setSearchError(error.message || "The location service is unavailable.");
    } finally {
      setSearchLoading(false);
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setSearchError("Your browser does not support device location.");
      return;
    }
    setSearchError("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => goToLocation(coords.latitude, coords.longitude, "Current device location"),
      () => setSearchError("Location permission was unavailable. Search for a place instead."),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  function activateTool(nextTool) {
    if (!drawRef.current) return;
    drawRef.current.setMode(nextTool);
    setTool(nextTool);
    const messages = {
      select: "Select a field to move it or adjust its boundary points.",
      polygon: "Trace irregular field edges point by point. Click the first point to close the boundary.",
      freehand: "Hold and drag across the field edge to sketch a freeform boundary. Best with a mouse or trackpad.",
      rectangle: "Use for regular fields: click and drag to create a rectangle.",
    };
    setNotice(messages[nextTool]);
  }

  function discoverMappedFields() {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    setDetectionError("");
    setSelectedFtwCandidate(null);
    map.getSource("ftwSelected")?.setData({ type: "FeatureCollection", features: [] });
    map.setLayoutProperty("ftw-field-boundaries-fill", "visibility", "visible");
    map.setLayoutProperty("ftw-field-boundaries-outline", "visibility", "visible");
    setFtwLayerVisible(true);

    if (map.getZoom() < 11) map.easeTo({ zoom: 11.5, duration: 650 });
    setNotice("Loading global Fields of the World field predictions. Click an outline on the map to inspect it and add it to your fields.");

    map.once("idle", () => {
      if (!mapRef.current || mapRef.current !== map) return;
      try {
        const visibleFeatures = map.queryRenderedFeatures({ layers: ["ftw-field-boundaries-fill"] });
        if (!visibleFeatures.length) {
          setDetectionError("No predicted field outlines are available in this view at the current zoom. This is a model-coverage or tile-availability limitation, not proof that no farm exists. Try a nearby area, zoom further in, or trace the boundary manually.");
        } else {
          const ids = new Set(visibleFeatures.map((feature) => feature.properties?.id || feature.id).filter(Boolean));
          const count = ids.size || visibleFeatures.length;
          setNotice(`${count} predicted field outline${count === 1 ? "" : "s"} visible. Click one outline to inspect its estimated area and model-context confidence.`);
        }
      } catch (error) {
        console.warn("Could not inspect global field tiles:", error);
        setDetectionError("The global field layer could not be queried. Check PMTiles requests in the browser Network panel.");
      }
    });
  }

  function toggleFtwLayer(visible) {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const visibility = visible ? "visible" : "none";
    map.setLayoutProperty("ftw-field-boundaries-fill", "visibility", visibility);
    map.setLayoutProperty("ftw-field-boundaries-outline", "visibility", visibility);
    setFtwLayerVisible(visible);
    if (!visible) {
      setSelectedFtwCandidate(null);
      map.getSource("ftwSelected")?.setData({ type: "FeatureCollection", features: [] });
      setNotice("Global predicted field boundaries hidden. Your saved field boundaries are unchanged.");
    } else {
      setNotice("Global predicted field boundaries are visible. Click an outline to inspect it.");
    }
  }

  function addSelectedFtwField() {
    const draw = drawRef.current;
    if (!draw || !selectedFtwCandidate) return;
    try {
      const fieldNumber = fields.length + 1;
      const feature = {
        ...selectedFtwCandidate,
        properties: {
          ...selectedFtwCandidate.properties,
          mode: "polygon",
          fieldName: `FTW field ${fieldNumber}`,
          source: "Fields of the World / PRUE",
          reviewRequired: true,
          farmerVerified: false,
        },
      };
      const result = draw.addFeatures([feature]);
      const wasAdded = !Array.isArray(result) || result.some((item) => item.valid !== false);
      if (!wasAdded) throw new Error("The predicted outline could not be added. Trace the boundary manually instead.");
      draw.setMode("select");
      setTool("select");
      syncFields(draw);
      setSelectedFtwCandidate(null);
      mapRef.current?.getSource("ftwSelected")?.setData({ type: "FeatureCollection", features: [] });
      setNotice("Predicted field outline added to your editable fields. Adjust its vertices to match the real farm boundary before analysis.");
    } catch (error) {
      setDetectionError(error.message || "Could not add this predicted field outline.");
    }
  }

  function saveBoundaries() {
    if (!drawRef.current) return;
    syncFields(drawRef.current);
    setNotice("Field boundaries saved in this browser.");
  }

  function clearBoundaries() {
    if (!drawRef.current) return;
    drawRef.current.clear();
    syncFields(drawRef.current);
    setNotice("All field boundaries have been cleared.");
  }

  function downloadGeoJSON() {
    const featuresNow = drawRef.current?.getSnapshot().filter((feature) => feature.geometry?.type === "Polygon" && !feature.properties?.midPoint && !feature.properties?.selectionPoint) || [];
    if (!featuresNow.length) {
      setNotice("Draw or import a field boundary before exporting.");
      return;
    }
    const blob = new Blob([JSON.stringify({ type: "FeatureCollection", features: featuresNow }, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "agrimetry-farm-boundaries.geojson";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("GeoJSON boundary file exported.");
  }

  async function importGeoJSON(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !drawRef.current) return;
    if (file.size > 10 * 1024 * 1024) {
      setNotice("The GeoJSON file is larger than 10 MB. Please use a smaller file.");
      return;
    }
    try {
      const parsed = JSON.parse(await file.text());
      const toAdd = polygonFeatures(parsed);
      if (!toAdd.length) throw new Error("No valid Polygon or MultiPolygon features were found.");
      drawRef.current.clear();
      const results = drawRef.current.addFeatures(toAdd);
      const added = results.filter((item) => item.valid).length;
      syncFields(drawRef.current);
      drawRef.current.setMode("select");
      setTool("select");
      setNotice(`${added} field boundary${added === 1 ? "" : "ies"} imported. Review the boundary before using it for analysis.`);
    } catch (error) {
      setNotice(error.message || "Unable to read this GeoJSON file.");
    }
  }

  function addDemoField() {
    const map = mapRef.current;
    const draw = drawRef.current;
    if (!map || !draw) return;
    const [longitude, latitude] = map.getCenter().toArray();
    const latOffset = 0.003;
    const lonOffset = 0.004;
    draw.addFeatures([{
      type: "Feature",
      properties: { mode: "polygon", fieldName: `Field ${fields.length + 1}` },
      geometry: { type: "Polygon", coordinates: [[
        [longitude - lonOffset, latitude - latOffset],
        [longitude + lonOffset, latitude - latOffset * 0.8],
        [longitude + lonOffset * 0.8, latitude + latOffset],
        [longitude - lonOffset * 0.9, latitude + latOffset * 0.8],
        [longitude - lonOffset, latitude - latOffset],
      ]] },
    }]);
    draw.setMode("select");
    setTool("select");
    setNotice("Demo boundary added near the map centre. This is illustrative geometry; replace it with the true farm boundary.");
  }

  async function focusField(feature) {
    const ring = feature.geometry.coordinates?.[0] || [];
    if (!ring.length || !mapRef.current) return;
    const maplibregl = await import("maplibre-gl");
    const bounds = new maplibregl.LngLatBounds(ring[0], ring[0]);
    ring.forEach((coordinate) => bounds.extend(coordinate));
    mapRef.current.fitBounds(bounds, { padding: 100, maxZoom: 17, duration: 900 });
  }

  const totalHectares = totalArea / 10000;
  const totalAcres = totalArea / 4046.8564224;

  return (
    <main className="agm-shell">
      <header className="agm-header">
        <div className="agm-header-brand">
          <Link href="/explore" className="agm-back-link" aria-label="Back to farm explorer"><Icon name="back" size={18} /></Link>
          <Link href="/" className="agm-brand"><span className="agm-brand-mark"><Icon name="leaf" size={19} /></span><span>agrimetry<span className="agm-brand-dot">.</span></span></Link>
          <span className="agm-header-divider" />
          <div className="agm-header-title"><span>FIELD INTELLIGENCE</span><strong>Global farm map</strong></div>
        </div>
        <div className="agm-header-right"><span className="agm-save-state"><i /> {savedAt ? `Saved ${savedAt}` : "Local boundary workspace"}</span><button className="agm-button agm-button-dark" onClick={saveBoundaries} disabled={!mapReady}><Icon name="check" size={15} /> Save fields</button></div>
      </header>

      <div className="agm-workspace">
        <aside className="agm-panel">
          <div className="agm-panel-intro"><span className="agm-overline">YOUR LAND, ON THE MAP</span><h1>Find your <em>field.</em></h1><p>Navigate anywhere on Earth, trace your farm boundary and keep its geometry ready for environmental analysis.</p></div>

          <section className="agm-panel-section agm-search-section">
            <div className="agm-section-label"><span>01</span><h2>Find a location</h2></div>
            <form className="agm-search-form" onSubmit={handleSearch}>
              <Icon name="search" size={17}/>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Village, district, farm or country" aria-label="Search global location" />
              <button type="submit" disabled={searchLoading}>{searchLoading ? "…" : "Search"}</button>
            </form>
            {searchError && <p className="agm-error">{searchError}</p>}
            {searchResults.length > 0 && <div className="agm-search-results">{searchResults.map((place) => <button type="button" key={place.id} onClick={() => { goToLocation(place.latitude, place.longitude, place.label); setSearchResults([]); setQuery(place.label); }}><span className="agm-result-pin"><Icon name="pin" size={15}/></span><span><strong>{place.name}</strong><small>{[place.admin1, place.country].filter(Boolean).join(", ")}</small></span><Icon name="arrow" size={15}/></button>)}<small>Location search via Open-Meteo Geocoding · GeoNames</small></div>}
            <form className="agm-coordinate-form" onSubmit={goToEnteredCoordinates}>
              <div className="agm-coordinate-heading"><span>OR GO TO COORDINATES</span><small>Decimal degrees</small></div>
              <div className="agm-coordinate-fields">
                <label><span>Latitude</span><input inputMode="decimal" value={latitudeInput} onChange={(event) => setLatitudeInput(event.target.value)} placeholder="e.g. 41.5868" aria-label="Latitude" /></label>
                <label><span>Longitude</span><input inputMode="decimal" value={longitudeInput} onChange={(event) => setLongitudeInput(event.target.value)} placeholder="e.g. -93.6250" aria-label="Longitude" /></label>
                <button type="submit">Go</button>
              </div>
              <small className="agm-coordinate-help">You can also paste “latitude, longitude” into the location search above.</small>
            </form>
            <div className="agm-search-actions"><button type="button" onClick={useCurrentLocation}><Icon name="crosshair" size={14}/> Use my location</button><button type="button" onClick={() => mapRef.current?.flyTo({ center: [0, 20], zoom: 1.65, duration: 900 })}><Icon name="globe" size={14}/> Reset global view</button></div>
            <div className="agm-current-place"><Icon name="pin" size={15}/><span><small>MAP FOCUS</small><strong>{selectedPlace}</strong></span></div>
          </section>

          <section className="agm-panel-section">
            <div className="agm-section-label"><span>02</span><h2>Trace farm boundaries</h2></div>
            <div className="agm-draw-tools" role="group" aria-label="Farm boundary drawing tools">
              <button type="button" className={tool === "polygon" ? "is-active" : ""} onClick={() => activateTool("polygon")} disabled={!mapReady}><Icon name="polygon" size={17}/><span>Trace points</span></button>
              <button type="button" className={tool === "freehand" ? "is-active" : ""} onClick={() => activateTool("freehand")} disabled={!mapReady}><Icon name="edit" size={17}/><span>Freehand</span></button>
              <button type="button" className={tool === "rectangle" ? "is-active" : ""} onClick={() => activateTool("rectangle")} disabled={!mapReady}><Icon name="rectangle" size={17}/><span>Rectangle</span></button>
              <button type="button" className={tool === "select" ? "is-active" : ""} onClick={() => activateTool("select")} disabled={!mapReady}><Icon name="check" size={17}/><span>Edit</span></button>
            </div>
            <div className="agm-tool-hint"><Icon name="info" size={14}/><span>{notice}</span></div>
            <div className="agm-import-actions">
              <button type="button" onClick={() => importRef.current?.click()} disabled={!mapReady}><Icon name="upload" size={15}/> Import GeoJSON</button>
              <input ref={importRef} type="file" accept=".geojson,.json,application/geo+json,application/json" hidden onChange={importGeoJSON}/>
              <button type="button" onClick={downloadGeoJSON} disabled={!fields.length}><Icon name="download" size={15}/> Export</button>
            </div>
                          <div style={{ marginTop: 13, padding: 12, border: "1px solid #dce3d4", borderRadius: 10, background: "linear-gradient(135deg, rgba(240,244,235,.92), rgba(251,249,243,.78))" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                  <strong style={{ color: "#36563a", fontSize: 10 }}>Global field discovery</strong>
                  <span style={{ color: "#87917e", fontSize: 7, fontWeight: 800, letterSpacing: ".08em" }}>FIELDS OF THE WORLD · 2025</span>
                </div>
                <p style={{ margin: "0 0 10px", color: "#788477", fontSize: 8, lineHeight: 1.55 }}>
                  Show model-predicted agricultural field outlines from a global Sentinel-2-based dataset. Zoom to field level, then click an outline to inspect and add it.
                </p>
                <button type="button" onClick={discoverMappedFields} disabled={!mapReady} style={{ width: "100%", minHeight: 36, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, border: "1px solid #244f38", borderRadius: 7, color: "#fff", background: "#244f38", font: "inherit", fontSize: 9, fontWeight: 800, cursor: !mapReady ? "wait" : "pointer", opacity: !mapReady ? .55 : 1 }}>
                  <Icon name="search" size={14}/>Show predicted field boundaries
                </button>
                {detectionError && <p role="status" style={{ margin: "8px 0 0", color: "#a75d45", fontSize: 8, lineHeight: 1.5 }}>{detectionError}</p>}
                {selectedFtwCandidate && <div style={{ display: "grid", gap: 8, marginTop: 10, padding: 10, border: "1px solid #dfd1b6", borderRadius: 8, background: "rgba(255,255,255,.72)" }}>
                  <strong style={{ color: "#40563b", fontSize: 9 }}>Selected predicted field</strong>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: "#788477", fontSize: 8 }}><span>Estimated area</span><strong style={{ color: "#40563b" }}>{formatArea(selectedFtwCandidate.properties.areaSquareMetres)}</strong></div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: "#788477", fontSize: 8 }}><span>Model-context confidence</span><strong style={{ color: "#40563b" }}>{selectedFtwCandidate.properties.confidence == null || !Number.isFinite(selectedFtwCandidate.properties.confidence) ? "Not available" : `${Math.round(selectedFtwCandidate.properties.confidence)}/100`}</strong></div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" onClick={() => focusField(selectedFtwCandidate)} style={{ flex: 1, minHeight: 30, border: "1px solid #d8d1c2", borderRadius: 6, color: "#536a4d", background: "#fbf9f3", font: "inherit", fontSize: 8, fontWeight: 800, cursor: "pointer" }}>View outline</button>
                    <button type="button" onClick={addSelectedFtwField} style={{ flex: 1, minHeight: 30, border: 0, borderRadius: 6, color: "#fff", background: "#6b845e", font: "inherit", fontSize: 8, fontWeight: 800, cursor: "pointer" }}>Use boundary</button>
                  </div>
                </div>}
                <small style={{ display: "block", marginTop: 9, color: "#929486", fontSize: 7, lineHeight: 1.5 }}>
                  Source: Fields of the World / PRUE, 2024–2025 predictions derived from Sentinel-2, approximately 10 m. These are model-derived remote-sensing field units, not legal or cadastral parcel boundaries. Confidence is a regional model-reliability indicator, not guaranteed accuracy of an individual outline. Review and edit every boundary. CC BY 4.0.
                </small>
              </div>
          </section>

          <section className="agm-area-card">
            <div className="agm-area-head"><span>MEASURED FIELD AREA</span><span className="agm-area-icon"><Icon name="layers" size={16}/></span></div>
            <div className="agm-area-number">{formatArea(totalArea)}</div>
            <div className="agm-area-sub">{totalAcres.toFixed(2)} acres <span>·</span> {fields.length} field{fields.length === 1 ? "" : "s"}</div>
            <div className="agm-area-foot"><span>Geodesic area · Turf.js</span><span>{totalHectares.toFixed(2)} ha</span></div>
          </section>

          <section className="agm-panel-section agm-fields-section">
            <div className="agm-fields-heading"><div className="agm-section-label"><span>03</span><h2>Saved fields</h2></div><button type="button" onClick={addDemoField} disabled={!mapReady} title="Add a sample boundary">+ Sample</button></div>
            {fields.length ? <div className="agm-field-list">{fields.map((feature, index) => {
              const fieldArea = featureArea(feature);
              return <button className="agm-field-item" type="button" key={feature.id || `${index}-${fieldArea}`} onClick={() => focusField(feature)}><span className="agm-field-swatch">{String(index + 1).padStart(2, "0")}</span><span className="agm-field-meta"><strong>{feature.properties?.fieldName || feature.properties?.name || `Field ${index + 1}`}</strong><small>{formatArea(fieldArea)}</small></span><Icon name="arrow" size={15}/></button>;
            })}</div> : <div className="agm-empty-fields"><span><Icon name="polygon" size={18}/></span><p>No field boundaries yet.</p><small>Choose Trace points or Freehand to outline an irregular field.</small></div>}
            <button type="button" className="agm-clear-button" onClick={clearBoundaries} disabled={!fields.length}><Icon name="trash" size={14}/> Clear all boundaries</button>
          </section>

          <section className="agm-layer-panel">
            <button className="agm-layer-panel-head" type="button" onClick={() => setShowLayers((value) => !value)} aria-expanded={showLayers}><span><Icon name="layers" size={16}/> Map layers</span><span>{showLayers ? "−" : "+"}</span></button>
            {showLayers && <div className="agm-layer-controls">
              <span className="agm-layer-caption">BASEMAP</span>
              <div className="agm-basemap-switch"><button type="button" className={basemap === "street" ? "is-active" : ""} onClick={() => setBasemap("street")}>Street</button><button type="button" className={basemap === "satellite" ? "is-active" : ""} onClick={() => setBasemap("satellite")}>Satellite</button></div>
              <span className="agm-layer-caption">AGRICULTURAL FIELD DATA</span>
              <label className="agm-layer-toggle"><span><strong>Predicted field boundaries · FTW 2025</strong><small>Global model-derived outlines · approx. 10 m · confidence varies</small></span><input type="checkbox" checked={ftwLayerVisible} onChange={(event) => toggleFtwLayer(event.target.checked)}/></label>
              <span className="agm-layer-caption">EARTH OBSERVATION</span>
              <label className="agm-layer-toggle"><span><strong>NASA MODIS true colour</strong><small>Global imagery · approx. 250 m · max zoom 9</small></span><input type="checkbox" checked={nasaOverlay} onChange={(event) => setNasaOverlay(event.target.checked)}/></label>
              <Link className="agm-planned-layer agm-available-layer" href="/explore/vegetation"><span>Vegetation · Sentinel-2 NDVI</span><em>Analyze field ↗</em></Link>
              <div className="agm-planned-layer"><span>Soil moisture · SMAP</span><em>Next integration</em></div>
              <div className="agm-planned-layer"><span>Rainfall · GPM</span><em>Next integration</em></div>
              <div className="agm-planned-layer"><span>Terrain · SRTM</span><em>Next integration</em></div>
            </div>}
          </section>

          <div className="agm-panel-note"><Icon name="info" size={15}/><p>Field boundaries are saved locally in this browser. Drawing a precise boundary does not make coarse satellite datasets field-resolution; each layer will show its native resolution.</p></div>
        </aside>

        <section className="agm-map-stage" aria-label="Global farm map workspace">
          <div ref={mapContainerRef} className="agm-map-canvas" />
          {!mapReady && <div className="agm-map-loading"><span className="agm-map-spinner"/><strong>Preparing the global map</strong><small>Loading map tiles and field drawing tools</small></div>}
          {mapError && <div className="agm-map-error"><Icon name="info" size={18}/><span>{mapError}</span></div>}
          <div className="agm-map-toolbar"><div className="agm-map-toolbar-label"><span className="agm-live-dot"/> GLOBAL FIELD WORKSPACE</div><span>WGS 84 · GeoJSON boundaries</span></div>
          <div className="agm-map-bottom-left"><span className="agm-map-scale-note">Use the map to zoom to field level</span></div>
          <div className="agm-map-attribution-note">Street map © OpenStreetMap contributors · Satellite tiles © Esri · Field boundaries © Fields of the World (CC BY 4.0) · NASA overlay © NASA GIBS</div>
        </section>
      </div>
    </main>
  );
}
