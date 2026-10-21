// The fast lane's strict speed check on its own: the app's checks to an order leaving for MT5 under 1 ms (median)
import { spawnSync } from 'node:child_process';
const r = spawnSync(process.execPath, ['--test', 'tests/unit/fastlane.test.js'], { stdio: 'inherit', env: { ...process.env, QUANTBOT_SPEED: '1' } });
process.exit(r.status ?? 1);
