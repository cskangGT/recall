/**
 * Who this is for, said by them in one press.
 *
 * The person Mado is for works with information for a living — plans a
 * lot, has a lot to do, saves more than they can find again. The roles are
 * the shapes that takes; picking one costs a press and buys an example that
 * is plainly theirs, a hint in their words, and an ask-back that knows what
 * a person like them is usually deciding. None is required: 'skip' is the
 * general case, and the question is the same for everyone.
 */
export const ROLES = ['planner', 'ceo', 'clevel', 'researcher', 'developer', 'designer', 'marketer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_KEY = 'mado.ob.role';

export function readRole(): Role | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(ROLE_KEY);
  return (ROLES as readonly string[]).includes(raw ?? '') ? (raw as Role) : null;
}

export function writeRole(role: Role | null): void {
  if (typeof localStorage === 'undefined') return;
  if (role) localStorage.setItem(ROLE_KEY, role);
  else localStorage.removeItem(ROLE_KEY);
}
