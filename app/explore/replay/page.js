import "../vegetation/vegetation.css";
import "../water-stress/water-stress.css";
import "../bare-field/bare-field.css";
import "../soil-health/soil-health.css";
import "../rotation/rotation.css";
import "./replay.css";
import ReplayIntelligence from "./ReplayIntelligence";

export const metadata = {
  title: "Historical Climate Replay | Agrimetry",
  description: "Replay crop rotations against 25 years of real rainfall and temperature, see which seasons were unfavourable, and test drier or warmer scenarios.",
};

export default function ReplayPage() {
  return <ReplayIntelligence />;
}
