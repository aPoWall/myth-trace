export function classifyCamera(label='') {
  const text=String(label).toLowerCase();
  const phone=/iphone|continuity|\bphone\b|camo|\bobs\b/.test(text);
  const preferred=!phone && /macbook|facetime|built[ -]?in|studio display/.test(text);
  return {phone,preferred};
}
export function chooseCamera(devices, preference='auto-mac') {
  const available=devices.filter(d=>d.kind==='videoinput' && d.deviceId);
  if(preference==='iphone') return available.find(d=>classifyCamera(d.label).phone && !/camo|\bobs\b/i.test(d.label)) || null;
  if(preference && preference!=='auto-mac') return available.find(d=>d.deviceId===preference) || null;
  return available.find(d=>classifyCamera(d.label).preferred) || available.find(d=>d.label && !classifyCamera(d.label).phone) || null;
}
