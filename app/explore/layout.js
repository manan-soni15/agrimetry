import "./explore.css";
import "./sidebar-interaction.css";
import ExplorerShell from "./ExplorerShell";

export default function ExploreLayout({ children }) {
  return <ExplorerShell>{children}</ExplorerShell>;
}
