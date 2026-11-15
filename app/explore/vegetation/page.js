import { Suspense } from 'react';
import FarmExplorer from '../FarmExplorer';
import '../explore.css';

export const metadata = {
  title: 'Vegetation Intelligence | Agrimetry',
  description: 'Copernicus Sentinel-2 Level-2A surface reflectance observations, cloud-masked NDVI time series, and vegetation condition analysis.',
};

export default function VegetationPage() {
  return (
    <Suspense fallback={<div className="fx-loading-screen"><span className="fx-spinner" /><span>Loading Vegetation Intelligence…</span></div>}>
      <FarmExplorer initialView="vegetation" />
    </Suspense>
  );
}

