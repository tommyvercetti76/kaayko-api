const https = require('https');

async function testOverpassQuery() {
  const lat = 32.7767;
  const lng = -96.7970;
  const radiusMeters = 20000; // 20km

  // First test simple query that worked before
  const simpleQuery = `
[out:json][timeout:90];
(
  way(around:${radiusMeters},${lat},${lng})["natural"="water"];
  relation(around:${radiusMeters},${lat},${lng})["natural"="water"];
);
out tags center bounds;
  `.trim();

  console.log('Testing simple query first...');
  console.log('Query:', simpleQuery);

  return new Promise((resolve, reject) => {
    const postData = simpleQuery;
    
    const options = {
      hostname: 'overpass-api.de',
      path: '/api/interpreter',
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log('Raw response:', data.substring(0, 500) + '...');
        
        try {
          const jsonData = JSON.parse(data);
          console.log('Elements found:', jsonData.elements?.length || 0);
          if (jsonData.elements && jsonData.elements.length > 0) {
            jsonData.elements.slice(0, 5).forEach((el, i) => {
              console.log(`${i+1}. ${el.tags?.name || 'Unnamed'} (${el.tags?.water || el.tags?.natural || el.tags?.waterway})`);
            });
          }
          resolve(jsonData);
        } catch (parseErr) {
          console.log('Failed to parse JSON, raw response:', data);
          reject(parseErr);
        }
      });
    });

    req.on('error', (error) => {
      console.error('Error:', error.message);
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

testOverpassQuery();
