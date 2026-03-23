const express = require('express');
const app = express();

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
