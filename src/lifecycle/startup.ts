import { initDatabase } from '../persistence/database.js';

export function startup(): void {
  console.log('Initializing database...');
  initDatabase();
  console.log('Database initialized.');
}
