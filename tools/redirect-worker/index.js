// Permanent redirect for the former Kernel hostname and www to the canonical origin. Path and query are kept; nothing
// is logged or stored, and no cookies are set.
export default {
  fetch(request) {
    const url = new URL(request.url);
    return new Response(null, {status: 301, headers: {
      location: `https://shouldiworkthere.com${url.pathname}${url.search}`,
      'cache-control': 'public, max-age=86400, no-transform',
      nel: '{"max_age":0}',
      'strict-transport-security': 'max-age=63072000; includeSubDomains',
      'referrer-policy': 'no-referrer',
    }});
  },
};
