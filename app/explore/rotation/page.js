import "../vegetation/vegetation.css";
import "../water-stress/water-stress.css";
import "../bare-field/bare-field.css";
import "../soil-health/soil-health.css";
import "./rotation.css";
import RotationIntelligence from "./RotationIntelligence";

export const metadata = {
  title: "Crop Rotation Intelligence | Agrimetry",
  description: "Compare your current crop rotation with alternatives using local climate, soil, nitrogen balance, sequence compatibility, erosion, water, market and equipment, with every score explained.",
};

export default function RotationPage() {
  return <RotationIntelligence />;
}
