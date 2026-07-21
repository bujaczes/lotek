import { createApp } from './src/server/app.js';
import { openDatabase } from './db/index.js';

const PORT = process.env.PORT || 3005;
const DB_PATH = process.env.DB_PATH || 'db/lotek.db';

const db = openDatabase(DB_PATH);
const app = createApp(db);

app.listen(PORT, () => {
  console.log(`LOTEK API listening on port ${PORT}`);
});
