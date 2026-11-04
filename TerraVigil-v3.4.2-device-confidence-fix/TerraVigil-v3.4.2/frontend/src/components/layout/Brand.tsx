import { Link } from 'react-router-dom';
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="brand" aria-label="TerraVigil operations">
      <svg className="brand-mark" viewBox="0 0 28 32" fill="none" aria-hidden="true">
        <path d="M14 2 26 8v13L14 30 2 21V8L14 2Z" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="m7 19 7-11 7 11M10 15h8M14 16v8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {!compact && (
        <div className="brand-text">
          <span className="type-app-title">
            TerraVigil<span className="text-accent">.</span>
          </span>
          <small>GEOSPATIAL INTELLIGENCE</small>
        </div>
      )}
    </Link>
  );
}
