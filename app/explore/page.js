import { Suspense } from 'react';
import FarmExplorer from './FarmExplorer';
import './explore.css';

export const metadata = {
  title: 'Explore | Agrimetry',
  description: 'Build an environmental fingerprint for your farm using NASA Earth observation and climate data.',
};

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="fx-loading-screen"><span className="fx-spinner" /><span>Loading Agrimetry Workspace…</span></div>}>
      <FarmExplorer />
    </Suspense>
  );
}
