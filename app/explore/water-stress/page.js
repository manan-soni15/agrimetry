import "maplibre-gl/dist/maplibre-gl.css";
import "../vegetation/vegetation.css";
import "./water-stress.css";
import WaterStressIntelligence from "./WaterStressIntelligence";

export const metadata = {
  title: "Soil Moisture & Water Stress Intelligence | Agrimetry",
  description: "Compare a field's rainfall, soil wetness and temperature with 25 years of NASA POWER history and see SMAP and GPM IMERG context from NASA GIBS.",
};

export default function WaterStressPage() {
  return <WaterStressIntelligence />;
}
