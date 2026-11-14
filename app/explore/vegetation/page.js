import "maplibre-gl/dist/maplibre-gl.css";
import "./vegetation.css";
import VegetationIntelligence from "./VegetationIntelligence";

export const metadata = {
  title: "Field Vegetation Intelligence | Agrimetry",
  description: "Analyze field-specific vegetation patterns from cloud-masked Sentinel-2 surface reflectance imagery.",
};

export default function VegetationPage() {
  return <VegetationIntelligence />;
}

