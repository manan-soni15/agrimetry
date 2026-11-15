'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Accessible InfoTip / Contextual Help Popover
 * Provides progressive disclosure for agricultural, remote sensing, and meteorological terms.
 */
export default function InfoTip({
  title,
  children,
  technicalNote,
  size = 14,
  label = 'Learn more',
  align = 'left',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <span className="fx-infotip-wrap" ref={containerRef}>
      <button
        type="button"
        className={`fx-infotip-btn ${isOpen ? 'is-active' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        aria-expanded={isOpen}
        aria-label={`${label}: ${title || 'Information'}`}
        title={`${label}: ${title || ''}`}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </button>

      {isOpen && (
        <span
          className={`fx-infotip-popover fx-infotip-align-${align}`}
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
        >
          {title && <strong className="fx-infotip-title">{title}</strong>}
          <span className="fx-infotip-body">{children}</span>
          {technicalNote && (
            <span className="fx-infotip-tech">
              <strong>Technical context:</strong> {technicalNote}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

