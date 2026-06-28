const http = require('http');
const data = JSON.stringify({ username: 'TESTUSER', password: 'TESTPASS123' });
const opts = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/register',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(opts, res => {
  console.log('status', res.statusCode);
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => console.log('body', body));
});

req.on('error', e => console.error('req error', e));
req.write(data);
req.end();
