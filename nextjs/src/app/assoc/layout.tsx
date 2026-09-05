import { LeagueSidebar } from '@/components/LeagueSidebar';
import { MobileNav } from '@/components/MobileNav';

export default function AssocLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0e0e0f' }}>
      <LeagueSidebar />
      {/* Room under the scroll area for the floating nav button, which is
          fixed and so takes no space of its own. */}
      <main className="flex-1 overflow-auto min-w-0 pb-24 md:pb-0">
        {children}
      </main>
      <MobileNav />
    </div>
  );
}
