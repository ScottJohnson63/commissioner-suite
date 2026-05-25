import Link from 'next/link';

export default function UnauthorizedPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: '#0e0e0f' }}
    >
      <div className="w-full max-w-sm text-center">
        <p className="text-[10px] uppercase tracking-[0.25em] mb-2" style={{ color: '#555' }}>
          Commissioner Suite
        </p>
        <h1 className="text-2xl font-semibold tracking-tight mb-2" style={{ color: '#e8e6df' }}>
          Unauthorized
        </h1>
        <p className="text-sm mb-8" style={{ color: '#555' }}>
          You don&apos;t have access to this page.
        </p>
        <Link
          href="/"
          className="inline-block px-5 py-2.5 rounded text-sm font-medium"
          style={{ background: '#80ff49', color: '#0e0e0f' }}
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
