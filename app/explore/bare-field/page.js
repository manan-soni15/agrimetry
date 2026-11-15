import "../vegetation/vegetation.css";
import "../water-stress/water-stress.css";
import "./bare-field.css";
import BareFieldIntelligence from "./BareFieldIntelligence";

export const metadata = {
  title: "Automatic Bare-Field Detection | Agrimetry",
  description: "Find bare and low-cover periods, gaps between crop cycles, cover-crop opportunities and erosion exposure from Sentinel-2 NDVI and NASA POWER rainfall.",
};

export default function BareFieldPage() {
  return <BareFieldIntelligence />;
}
