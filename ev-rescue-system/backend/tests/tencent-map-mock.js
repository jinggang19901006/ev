const http = require('http');

function haversineKm(lat1, lng1, lat2, lng2) {
  const radiusKm = 6371.0088;
  const toRad = degree => (degree * Math.PI) / 180;
  const deltaLat = toRad(lat2 - lat1);
  const deltaLng = toRad(lng2 - lng1);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(deltaLng / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.sqrt(a));
}

function parsePoint(value) {
  const [lat, lng] = String(value || '').split(',').map(Number);
  return { lat, lng };
}

function createTencentMapMock(port) {
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname !== '/ws/direction/v1/driving/' || url.searchParams.get('key') !== 'TEST-TENCENT-MAP-KEY') {
      res.end(JSON.stringify({ status: 110, message: 'invalid key or path' }));
      return;
    }
    requestCount += 1;
    const from = parsePoint(url.searchParams.get('from'));
    const to = parsePoint(url.searchParams.get('to'));
    // Deliberately differs from the removed straight-line * 1.3 fallback.
    const distance = Math.round(haversineKm(from.lat, from.lng, to.lat, to.lng) * 1400 + 321);
    res.end(JSON.stringify({
      status: 0,
      message: 'query ok',
      request_id: `mock-route-${requestCount}`,
      result: {
        routes: [{
          mode: 'DRIVING',
          distance,
          duration: Math.max(1, Math.round(distance / 500)),
          toll: 0
        }]
      }
    }));
  });

  return {
    start: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    }),
    close: () => new Promise(resolve => server.close(resolve)),
    getRequestCount: () => requestCount
  };
}

module.exports = { createTencentMapMock };
