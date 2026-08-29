// The app opens on the dashboard, not on a login wall: its Statistics and News
// tabs are public, and the dashboard header carries the Sign in button for
// everything else. The login page itself lives at /login.
//
// A permanent redirect would be cached by browsers and by any proxy in front of
// the app, so this stays temporary — / is a routing decision that may change.

import { redirect } from 'next/navigation';

export default function RootPage() {
  redirect('/league/dashboard');
}
