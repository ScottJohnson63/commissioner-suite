import { LeagueSidebar } from '@/components/LeagueSidebar';
import { MobileNav } from '@/components/MobileNav';
import { AppIntro } from '@/components/intro/AppIntro';

export default function LeagueLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0e0e0f' }}>
      {/* The rail from `md` up; below it the floating hamburger below takes
          over and the rail removes itself from the row entirely. */}
      <LeagueSidebar />
      {/* The padding is what keeps the floating button off the last row of a
          page — a fixed element takes no space of its own. */}
      <main className="flex-1 overflow-auto min-w-0 pb-24 md:pb-0">
        {children}
      </main>
      <MobileNav />
      {/* First visit to any page of the portal gets the tour. It opens itself,
          so there is nothing to pass down. */}
      <AppIntro />
    </div>
  );
}
