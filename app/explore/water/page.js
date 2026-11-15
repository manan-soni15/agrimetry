import { Suspense } from 'react';
import FarmExplorer from '../FarmExplorer';
import '../explore.css';

export const metadata = {
  title: 'Soil Moisture & Water Stress | Agrimetry',
  description: 'NASA SMAP L4 soil moisture, NASA GPM IMERG precipitation, and FAO-56 Penman-Monteith water stress intelligence.',
};

export default function WaterPage() {
  return (
    <Suspense fallback={<div className="fx-loading-screen"><span className="fx-spinner" /><span>Loading Soil Moisture &amp; Water Stress Intelligence…</span></div>}>
      <FarmExplorer initialView="water" />
    </Suspense>
  );
}

