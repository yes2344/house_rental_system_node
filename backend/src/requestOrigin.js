export function requestOrigin(request) {
  const forwardedProtocol = request.get('x-forwarded-proto')
    ?.split(',')[0]
    .trim()
    .toLowerCase();
  const protocol = request.protocol === 'https' || forwardedProtocol === 'https'
    ? 'https'
    : request.protocol;
  return `${protocol}://${request.get('host')}`;
}
