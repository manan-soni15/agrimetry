import { Suspense } from 'react';
import FarmExplorer from '../FarmExplorer';
import '../explore.css';

export const metadata = {
  title: 'Environmental Data | Agrimetry',
  description: 'NASA POWER 365-day agroclimatology fingerprint, temperature, precipitation accumulation, and seasonal rhythm.',
};

export default function EnvironmentPage() {
  return (
    <Suspense fallback={<div className="fx-loading-screen"><span className="fx-spinner" /><span>Loading Environmental Data…</span></div>}>
      <FarmExplorer initialView="environment" />
    </Suspense>
  );
}

