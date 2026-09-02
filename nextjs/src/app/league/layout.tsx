import { LeagueSidebar } from '@/components/LeagueSidebar';
import { AppIntro } from '@/components/intro/AppIntro';

export default function LeagueLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0e0e0f' }}>
      <LeagueSidebar />
      <main className="flex-1 overflow-auto min-w-0">
        {children}
      </main>
      {/* First visit to any page of the portal gets the tour. It opens itself,
          so there is nothing to pass down. */}
      <AppIntro />
    </div>
  );
}
