import { fileURLToPath } from 'node:url';
import { createPool } from '../src/db.js';
import { getMediaConfig } from '../src/config/media.js';
import { checkDeploymentReadiness } from '../src/services/deploymentReadinessService.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const pool = createPool();

try {
  const report = await checkDeploymentReadiness({
    pool,
    mediaConfig: getMediaConfig(),
    applicationRoot: projectRoot,
  });
  console.info(JSON.stringify(report, null, 2));
  if (!report.ready) process.exitCode = 1;
} catch (error) {
  console.error('Deployment readiness check failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
