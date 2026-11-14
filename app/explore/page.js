import Link from 'next/link';
import { Fraunces, Hanken_Grotesk } from 'next/font/google';

const display = Fraunces({ subsets: ['latin'], display: 'swap' });
const sans = Hanken_Grotesk({ subsets: ['latin'], display: 'swap' });

export const metadata = {
  title: 'Agrimetry | Platform coming soon',
  description: 'The Agrimetry platform is on its way.',
};

const C = { forest: '#173D2B', botanical: '#244F38', sage: '#A8B99A', sand: '#E8DCC5', parchment: '#F4EEDF', soil: '#927451', off: '#FAF8F1' };

export default function ExplorePage() {
  return (
    <main
      className={sans.className}
      style={{
        minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '32px 24px',
        position: 'relative', overflow: 'hidden', color: C.forest,
        background: `linear-gradient(180deg, ${C.parchment}, ${C.sand})`,
      }}
    >
      <svg aria-hidden="true" viewBox="0 0 600 600" style={{ position: 'absolute', right: '-15%', top: '-15%', width: '75%', opacity: 0.35, pointerEvents: 'none' }}>
        <g fill="none" stroke={C.soil} strokeWidth="1">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <path key={i} d="M300 40c110-10 190 70 215 160s-10 170-80 230-190 130-290 80S25 340 60 240 190 50 300 40Z"
              transform={`translate(${300 * i * 0.12} ${300 * i * 0.12}) scale(${1 - i * 0.12})`} />
          ))}
        </g>
      </svg>

      <section style={{ position: 'relative', textAlign: 'center', maxWidth: 620 }}>
        <p style={{ fontSize: '0.8rem', letterSpacing: '0.16em', fontWeight: 600, color: C.soil, margin: '0 0 20px' }}>AGRIMETRY</p>
        <h1 className={display.className} style={{ fontWeight: 500, fontSize: 'clamp(2.4rem, 6vw, 4.2rem)', lineHeight: 1.08, margin: 0 }}>
          The platform is coming soon.
        </h1>
        <p style={{ fontSize: '1.1rem', color: '#2e4a3b', margin: '22px auto 36px', maxWidth: '30rem' }}>
          We are still building the tools that turn Earth observations into crop rotation insights. More information is coming soon.
        </p>
        <Link
          href="/"
          style={{ display: 'inline-flex', padding: '14px 26px', borderRadius: 999, background: C.forest, color: C.off, fontWeight: 600, textDecoration: 'none' }}
        >
          Back to home
        </Link>
      </section>
    </main>
  );
}