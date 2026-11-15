import "../vegetation/vegetation.css";
import "../water-stress/water-stress.css";
import "../bare-field/bare-field.css";
import "./soil-health.css";
import SoilHealthIntelligence from "./SoilHealthIntelligence";

export const metadata = {
  title: "Soil Health Intelligence | Agrimetry",
  description: "Soil organic carbon, pH, texture and bulk density for your field from ISRIC SoilGrids, combined with your own soil-test results and explained for crop rotation planning.",
};

export default function SoilHealthPage() {
  return <SoilHealthIntelligence />;
}
