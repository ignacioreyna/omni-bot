import { initDatabase } from '../persistence/database.js';
import { preventSleep } from '../utils/caffeinate.js';

export function startup(): void {
  console.log('Initializing database...');
  initDatabase();
  console.log('Database initialized.');

  preventSleep();
}
