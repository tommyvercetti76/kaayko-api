// Quick debug script to test Overpass query directly
const https = require('https');

async function testOverpassQuery() {
  const lat = 33.1975;
  const lng = -96.6153;
  const radiusMeters = 30000; // 30km
  
  // Ultra simple test
  const testQuery = `[out:json][timeout:60];
(
  way(around:${radiusMeters},${lat},${lng})["natural"="water"]["name"];
);
out tags center;`;
  
  console.log('Testing query:', testQuery);
  
  const postData = `data=${encodeURIComponent(testQuery)}`;
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'overpass-api.de',
      port: 443,
      path: '/api/interpreter',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Kaayko-Debug/1.0'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          console.log(`Got ${data.elements?.length || 0} elements`);
          if (data.elements?.length > 0) {
            console.log('First 3 results:');
            data.elements.slice(0, 3).forEach((el, i) => {
              console.log(`${i+1}. ${el.tags?.name} (${el.type})`);
            });
          }
          resolve(data);
        } catch (e) {
          console.error('JSON parse error:', e);
          console.log('Raw response:', body.slice(0, 500));
          reject(e);
        }
      });
    });

    req.on('error', (e) => {
      console.error('Request error:', e);
      reject(e);
    });

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });

    req.write(postData);
    req.end();
  });
}

testOverpassQuery().then(() => {
  console.log('Done');
}).catch(err => {
  console.error('Failed:', err);
});
