export function ipfsImagePath(cid: string): string {
  return `/api/ipfs/${cid}`;
}

export function cidFromImage(image: string): string | null {
  const match = image.match(/(?:\/ipfs\/|ipfs:\/\/)([A-Za-z0-9]{20,100})(?:\b|\/|$)/);
  return match?.[1] ?? null;
}
