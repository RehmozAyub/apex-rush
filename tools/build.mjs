// Packages the game as a portable Windows exe: release/ApexRush.exe
// Build happens in %LOCALAPPDATA%\ApexRushBuild so node_modules never syncs to Google Drive.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(process.env.LOCALAPPDATA || join(root, '.build'), 'ApexRushBuild');
mkdirSync(build, { recursive: true });

const run = (cmd) => execSync(cmd, { cwd: build, stdio: 'inherit' });

const pkg = JSON.parse(readFileSync(join(root, 'electron', 'package.json'), 'utf8'));
if (!existsSync(join(build, 'node_modules', 'electron')) || !existsSync(join(build, 'node_modules', 'electron-builder'))) {
  writeFileSync(join(build, 'package.json'), JSON.stringify({ ...pkg, devDependencies: {} }, null, 2));
  run('npm install --save-dev electron electron-builder --no-audit --no-fund');
}
const ver = (m) => JSON.parse(readFileSync(join(build, 'node_modules', m, 'package.json'), 'utf8')).version;
pkg.devDependencies = { electron: ver('electron'), 'electron-builder': ver('electron-builder') };
writeFileSync(join(build, 'package.json'), JSON.stringify(pkg, null, 2));

console.log('Staging files...');
rmSync(join(build, 'game'), { recursive: true, force: true });
rmSync(join(build, 'dist'), { recursive: true, force: true });
cpSync(join(root, 'game'), join(build, 'game'), { recursive: true });
copyFileSync(join(root, 'electron', 'main.cjs'), join(build, 'main.cjs'));
copyFileSync(join(root, 'electron', 'icon.png'), join(build, 'icon.png'));

console.log('Running electron-builder...');
run('npx electron-builder --win portable --x64');

const exe = join(build, 'dist', 'ApexRush.exe');
mkdirSync(join(root, 'release'), { recursive: true });
copyFileSync(exe, join(root, 'release', 'ApexRush.exe'));
console.log(`\nBuilt release/ApexRush.exe (${(statSync(exe).size / 1048576).toFixed(1)} MB)`);
