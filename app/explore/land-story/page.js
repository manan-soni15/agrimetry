import "../explore.css";
import "./land-story.css";
import LandStoryteller from "./LandStoryteller";

export const metadata = {
  title: "AI Land Storyteller | Agrimetry",
  description: "Turn completed satellite and environmental analysis into an evidence-linked story about your field.",
};

export default function LandStoryPage() { return <LandStoryteller />; }
