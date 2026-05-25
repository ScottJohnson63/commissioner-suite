import { LeagueSidebar } from '@/components/LeagueSidebar';

export default function AssocLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0e0e0f' }}>
      <LeagueSidebar />
      <main className="flex-1 overflow-auto min-w-0">
        {children}
      </main>
    </div>
  );
}
