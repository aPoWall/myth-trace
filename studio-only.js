// The public build has no studio process. Keep requests and captured data in this browser.
export async function studioOnly() {
  throw new Error('Available in the local Myth Trace studio');
}
