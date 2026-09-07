import { LeagueSidebar } from '@/components/LeagueSidebar';
import { MobileNav } from '@/components/MobileNav';
import { AppIntro } from '@/components/intro/AppIntro';

export default function LeagueLayout({ children }: { children: React.ReactNode }) {
  return (
    // The shell is exactly as tall as what the phone is actually showing, and
    // `main` is the only thing that scrolls. `h-screen` alone is 100vh, which on
    // a phone means the viewport with the browser's toolbars *retracted* — taller
    // than the visible area while they are on screen, so the document itself
    // picked up a toolbar's worth of scroll. That extra scroll carried the whole
    // shell up with it, taking the dashboard's sticky tab bar off the top of the
    // screen with it (sticky pins to `main`, and `main`'s own top was moving).
    // `100dvh` is the height that is really visible, so there is nothing left for
    // the document to scroll and the tab bar stays put. The inline value wins
    // where `dvh` is understood and is dropped where it is not, which leaves the
    // `h-screen` class as the fallback.
    <div
      className="flex h-screen overflow-hidden"
      style={{ height: '100dvh', background: '#0e0e0f' }}
    >
      {/* The rail from `md` up; below it the floating hamburger below takes
          over and the rail removes itself from the row entirely. */}
      <LeagueSidebar />
      {/* The padding is what keeps the floating button off the last row of a
          page — a fixed element takes no space of its own. `overscroll-none`
          stops a flick at either end of this pane from chaining out to the
          document and bouncing the shell. */}
      <main className="flex-1 overflow-auto overscroll-none min-w-0 pb-24 md:pb-0">
        {children}
      </main>
      <MobileNav />
      {/* First visit to any page of the portal gets the tour. It opens itself,
          so there is nothing to pass down. */}
      <AppIntro />
    </div>
  );
}
