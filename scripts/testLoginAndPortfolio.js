const http = require('http');
const loginData = JSON.stringify({ username: 'TESTUSER', password: 'TESTPASS123' });
const loginOpts = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(loginData)
  }
};

const req = http.request(loginOpts, res => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    console.log('login status', res.statusCode);
    console.log('login body', body);
    try {
      const j = JSON.parse(body);
      const token = j.token;
      if (!token) {
        console.error('No token returned');
        return;
      }

      const opts2 = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/portefeuille',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      };

      const req2 = http.request(opts2, res2 => {
        let b2 = '';
        res2.on('data', c => b2 += c);
        res2.on('end', () => {
          console.log('portefeuille status', res2.statusCode);
          console.log('portefeuille body', b2);
        });
      });

      req2.on('error', e => console.error('portefeuille req err', e));
      req2.end();
    } catch (e) {
      console.error('parse/login err', e.message);
    }
  });
});

req.on('error', e => console.error('login req err', e));
req.write(loginData);
req.end();
