import FarmExplorer from "./FarmExplorer";
import "./explore.css";

export const metadata = {
  title: "Explore | Agrimetry",
  description: "Build an environmental fingerprint for your farm using NASA Earth observation and climate data.",
};

export default function ExplorePage() {
  return <FarmExplorer />;
}
