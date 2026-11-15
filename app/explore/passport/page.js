import "../vegetation/vegetation.css";
import "../water-stress/water-stress.css";
import "../bare-field/bare-field.css";
import "../soil-health/soil-health.css";
import "../rotation/rotation.css";
import "./passport.css";
import PassportIntelligence from "./PassportIntelligence";

export const metadata = {
  title: "Evidence Passport | Agrimetry",
  description: "A printable evidence report for each suggested crop rotation: why it was suggested, which datasets support it, the history it was tested against, soil and water effects, risks, uncertainties and what to validate locally.",
};

export default function PassportPage() {
  return <PassportIntelligence />;
}
