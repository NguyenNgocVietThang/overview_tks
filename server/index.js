const path = require('path');
const express = require('express');
const CONFIG = require('./config');
const routes = require('./routes');

const app = express();

app.use(express.json());
app.use(routes);
app.use(express.static(path.join(__dirname, 'public')));

app.listen(CONFIG.PORT, () => {
  console.log(`TOKOSI dashboard server dang chay tren port ${CONFIG.PORT}`);
});
