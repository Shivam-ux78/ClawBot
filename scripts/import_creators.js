import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import 'dotenv/config';
import { validateConfig } from '../src/config.js';
import { initDb } from '../src/db.js';
import { initBot } from '../src/telegram/bot.js';
import { addCreator } from '../src/services/creatorService.js';

// Setup environment and DB
validateConfig();

const CSV_FILE = process.argv[2];

if (!CSV_FILE) {
  console.error('Usage: node import_creators.js <path-to-csv>');
  process.exit(1);
}

const resolvedPath = path.resolve(CSV_FILE);
if (!fs.existsSync(resolvedPath)) {
  console.error(`File not found: ${resolvedPath}`);
  process.exit(1);
}

async function run() {
  await initDb();
  initBot(); // Needed to send approval cards when creators are added

  console.log(`[Import] Reading ${resolvedPath}...`);

  const results = [];
  fs.createReadStream(resolvedPath)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      let successCount = 0;
      let errorCount = 0;

      for (const row of results) {
        // Assume CSV headers: username, followers, niche
        const username = row.username?.trim();
        const followers = row.followers ? parseInt(row.followers, 10) : null;
        const niche = row.niche?.trim() || null;

        if (!username) {
          console.warn('[Import] Skipped row missing username:', row);
          continue;
        }

        const cleanUsername = username.replace(/^@/, '');

        try {
          await addCreator({ username: cleanUsername, followers, niche });
          console.log(`[Import] ✅ Added @${cleanUsername}`);
          successCount++;
          // Small delay to prevent spamming the Telegram API with too many cards instantly
          await new Promise((r) => setTimeout(r, 500));
        } catch (err) {
          console.error(`[Import] ❌ Failed @${cleanUsername}: ${err.message}`);
          errorCount++;
        }
      }

      console.log(`\n[Import] Finished! ✅ ${successCount} added | ❌ ${errorCount} failed`);
      process.exit(0);
    });
}

run();
