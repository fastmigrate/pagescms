type RepositoryRef = { owner: string; repo: string; branch: string };

export function isConfigurationPath(pathname: string | null, ref: RepositoryRef | null): boolean {
  if (!pathname || !ref) return false;
  const parts = pathname.split("/");
  return parts.length === 5
    && parts[0] === ""
    && parts[1].toLowerCase() === ref.owner.toLowerCase()
    && parts[2].toLowerCase() === ref.repo.toLowerCase()
    && parts[3] === encodeURIComponent(ref.branch)
    && parts[4] === "configuration";
}
