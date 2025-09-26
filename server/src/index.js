require('dotenv').config({ path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env' });
const http = require('http');
const app = require('./app');
const { closeDb } = require('./db');

const PORT = process.env.PORT || 3001;
const server = http.createServer(app);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`API rodando em http://localhost:${PORT}`);
});


function shutdown(sig) {
  console.log(`\nRecebido ${sig}. Encerrando...`);
  server.close(async () => {
    console.log('HTTP server fechado.');
    await closeDb();
    console.log('Pool PG encerrado.');
    process.exit(0);
  });
}
['SIGINT','SIGTERM'].forEach(s => process.on(s, () => shutdown(s)));
