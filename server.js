const express = require('express');
const app = express();

// Disable X-Powered-By header to prevent server technology disclosure
app.disable('x-powered-by');

// Set security headers on all responses to prevent MIME type sniffing
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  next();
});

const port = 3000;

app.get('/', (req, res) => {
  res.type('text/plain').send('Hello, World!\n');
});

app.get('/evening', (req, res) => {
  res.type('text/plain').send('Good evening');
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});
