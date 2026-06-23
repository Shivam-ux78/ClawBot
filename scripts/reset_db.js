import 'dotenv/config';
import { initDb, getDb } from '../src/db.js';

async function reset() {
  try {
    await initDb();
    const pool = getDb();
    
    console.log('Resetting database...');
    // Cascade ensures foreign key constraints are handled
    await pool.query('TRUNCATE TABLE deals, dm_log, conversations, creators RESTART IDENTITY CASCADE;');
    
    console.log('✅ Database reset complete!');
  } catch (err) {
    console.error('❌ Error resetting database:', err);
  } finally {
    process.exit(0);
  }
}

reset();
