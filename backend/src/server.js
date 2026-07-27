const app = require('./app');
const config = require('./config');

app.listen(config.port, () => {
  console.log(`AI Interview Bot backend listening on port ${config.port}`);
});
