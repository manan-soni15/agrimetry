import { redirect } from "next/navigation";

export const metadata = {
  title: "Agrimetry | Global Farm Map",
  description: "Select a field boundary and explore its satellite-derived agricultural intelligence.",
};

export default function ExplorePage() {
  redirect("/explore/map");
}
