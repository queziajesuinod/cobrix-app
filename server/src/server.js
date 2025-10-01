require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📊 Schema do banco: ${process.env.DB_SCHEMA || 'public'}`);
  console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
});