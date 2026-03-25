import fs from 'node:fs';
import path from 'node:path';

const sourceDir = path.join(process.cwd(), 'src', 'renderer');
const targetDir = path.join(process.cwd(), 'dist', 'renderer');

fs.mkdirSync(targetDir, { recursive: true });
for (const fileName of ['index.html', 'styles.css']) {
  fs.copyFileSync(path.join(sourceDir, fileName), path.join(targetDir, fileName));
}
