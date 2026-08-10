// A token's human-readable label: its own name, else its linked monster's name,
// else the given fallback. Shared by the initiative tracker and the token bar so
// both derive the display name the same way.
export function tokenDisplayName(
  token: { name?: string | null; monster?: string | null },
  fallback = "",
): string {
  return token.name || token.monster || fallback;
}
