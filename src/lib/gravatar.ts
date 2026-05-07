import md5 from 'blueimp-md5';

export function buildGravatarUrl(email: string, size = 40): string {
  const normalized = email.trim().toLowerCase();
  const hash = md5(normalized);
  return `https://secure.gravatar.com/avatar/${hash}?s=${size}&d=identicon&r=g`;
}
