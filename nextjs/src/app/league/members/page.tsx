'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';

type Role = 'COMMISSIONER' | 'MEMBER' | 'PLAYER';

interface User {
  id: string;
  name: string | null;
  username: string | null;
  email: string | null;
  role: Role;
  createdAt: string;
}

const ROLES: Role[] = ['COMMISSIONER', 'MEMBER', 'PLAYER'];

const ROLE_LABELS: Record<Role, string> = {
  COMMISSIONER: 'Commissioner',
  MEMBER: 'Member',
  PLAYER: 'Player',
};

const ROLE_ACCENT: Record<Role, string> = {
  COMMISSIONER: '#80ff49',
  MEMBER: '#888',
  PLAYER: '#c849ff',
};

export default function MembersPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const role = session?.user?.role as Role | undefined;
  const isCommissioner = role === 'COMMISSIONER';
  const isMember = role === 'MEMBER';
  const currentUserId = session?.user?.id;

  useEffect(() => {
    fetch('/api/users')
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load users');
        return r.json() as Promise<User[]>;
      })
      .then(setUsers)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load users'))
      .finally(() => setLoading(false));
  }, []);

  async function setRole(user: User, newRole: Role) {
    if (newRole === user.role) return;
    setUpdating(user.id);
    setError(null);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) throw new Error('Update failed');
      const updated = await res.json() as User;
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setUpdating(null);
    }
  }

  // PLAYER role: no access
  if (role === 'PLAYER') {
    return (
      <div className="min-h-full flex items-center justify-center px-4" style={{ color: '#e8e6df' }}>
        <div className="text-center max-w-xs">
          <p className="text-2xl mb-3">🔒</p>
          <h2 className="text-base font-medium mb-2">Access Restricted</h2>
          <p className="text-sm" style={{ color: '#555' }}>
            This page is only available to members and commissioners.
          </p>
        </div>
      </div>
    );
  }

  const grouped = ROLES.map((r) => ({
    role: r,
    users: users.filter((u) => u.role === r),
  }));

  return (
    <div className="min-h-full px-4 py-8 sm:px-8" style={{ color: '#e8e6df' }}>
      <div className="max-w-3xl mx-auto">

        <div className="mb-8">
          <h1 className="text-lg font-medium mb-1">Members</h1>
          <p className="text-xs" style={{ color: '#555' }}>
            {isCommissioner
              ? 'Manage roles for registered users.'
              : 'Promote players to members.'}
          </p>
        </div>

        {error && (
          <div
            className="mb-4 px-3 py-2 rounded text-xs border"
            style={{
              background: 'rgba(255,73,73,0.08)',
              color: '#ff4949',
              borderColor: 'rgba(255,73,73,0.2)',
            }}
          >
            {error}
          </div>
        )}

        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-12 rounded border border-[#2a2a2c] animate-pulse"
                style={{ background: '#141415' }}
              />
            ))}
          </div>
        )}

        {!loading && users.length === 0 && (
          <p className="text-xs text-center py-20" style={{ color: '#555' }}>
            No users found.
          </p>
        )}

        {!loading && users.length > 0 && (
          <div className="space-y-6">
            {grouped.map(({ role: groupRole, users: group }) => (
              <div key={groupRole}>
                <div className="flex items-center gap-2 mb-2">
                  <p
                    className="text-[10px] uppercase tracking-widest"
                    style={{ color: ROLE_ACCENT[groupRole] }}
                  >
                    {ROLE_LABELS[groupRole]}s
                  </p>
                  <span className="text-[10px]" style={{ color: '#444' }}>
                    {group.length}
                  </span>
                </div>
                <div
                  className="rounded-lg border overflow-hidden"
                  style={{ borderColor: '#1e1e20', background: '#141415' }}
                >
                  {group.length === 0 ? (
                    <p className="px-4 py-4 text-xs" style={{ color: '#444' }}>
                      No {ROLE_LABELS[groupRole].toLowerCase()}s.
                    </p>
                  ) : (
                    <table className="w-full text-sm">
                      <tbody>
                        {group.map((user) => (
                          <UserRow
                            key={user.id}
                            user={user}
                            busy={updating === user.id}
                            isSelf={user.id === currentUserId}
                            isCommissioner={isCommissioner}
                            isMember={isMember}
                            onSetRole={(r) => setRole(user, r)}
                          />
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UserRow({
  user,
  busy,
  isSelf,
  isCommissioner,
  isMember,
  onSetRole,
}: {
  user: User;
  busy: boolean;
  isSelf: boolean;
  isCommissioner: boolean;
  isMember: boolean;
  onSetRole: (role: Role) => void;
}) {
  const displayName = user.name ?? user.username ?? '—';
  const sub = user.email ?? (user.username ? `@${user.username}` : null);

  // Commissioners can reassign anyone (except themselves).
  // Members can only reassign non-commissioner users, and only to MEMBER or PLAYER.
  const canEdit =
    !isSelf &&
    (isCommissioner || (isMember && user.role !== 'COMMISSIONER'));

  const assignableRoles: Role[] = canEdit
    ? ROLES.filter((r) => {
        if (r === user.role) return false;
        if (isMember && r === 'COMMISSIONER') return false;
        return true;
      })
    : [];

  return (
    <tr className="border-b last:border-b-0" style={{ borderColor: '#1e1e20' }}>
      <td className="px-4 py-3">
        <p className="text-sm" style={{ color: '#e8e6df' }}>
          {displayName}
          {isSelf && (
            <span className="ml-1.5 text-[10px]" style={{ color: '#444' }}>
              (you)
            </span>
          )}
        </p>
        {sub && (
          <p className="text-xs mt-0.5" style={{ color: '#555' }}>
            {sub}
          </p>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {canEdit && assignableRoles.length > 0 && (
          <div className="inline-flex gap-1">
            {assignableRoles.map((r) => (
              <button
                key={r}
                onClick={() => onSetRole(r)}
                disabled={busy}
                className="text-xs px-2.5 py-1 rounded border transition-colors disabled:opacity-40 touch-manipulation"
                style={{ borderColor: '#2a2a2c', color: '#555', background: 'transparent' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = ROLE_ACCENT[r];
                  e.currentTarget.style.borderColor = ROLE_ACCENT[r] + '55';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '#555';
                  e.currentTarget.style.borderColor = '#2a2a2c';
                }}
              >
                {busy ? '…' : `→ ${ROLE_LABELS[r]}`}
              </button>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
}
