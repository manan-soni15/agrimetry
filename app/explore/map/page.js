import "maplibre-gl/dist/maplibre-gl.css";
import "./global-farm-map.css";
import GlobalFarmMap from "./GlobalFarmMap";

export const metadata = {
  title: "Global Farm Map | Agrimetry",
  description: "Map, draw and manage farm boundaries around the world with Agrimetry.",
};

export default function GlobalFarmMapPage() {
  return <GlobalFarmMap />;
}

