// Packages the game as an Android app: release/ApexRush.apk
// The toolchain (JDK 17, Android SDK, Gradle) and the Gradle build live in S:\ApexRushAndroid
// (override with APEX_ANDROID_HOME) so nothing heavy syncs to Google Drive. First run downloads
// about 3 GB. `node tools/build-apk.mjs --setup` only installs the toolchain.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync, statSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const home = process.env.APEX_ANDROID_HOME || 'S:\\ApexRushAndroid';
const JDK = join(home, 'jdk');
const SDK = join(home, 'sdk');
const GRADLE_VER = '8.11.1';
const GRADLE = join(home, `gradle-${GRADLE_VER}`);
const SDK_PACKAGES = ['platform-tools', 'platforms;android-35', 'build-tools;35.0.0'];
const TAR = 'C:\\Windows\\System32\\tar.exe'; // bsdtar: unpacks .zip too

const env = {
  ...process.env,
  JAVA_HOME: JDK,
  ANDROID_HOME: SDK,
  ANDROID_SDK_ROOT: SDK,
  GRADLE_USER_HOME: join(home, 'gradle-home'),
  PATH: `${join(JDK, 'bin')};${process.env.PATH}`,
};
const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', env, ...opts });

async function download(url, file) {
  if (existsSync(file)) return;
  console.log(`Downloading ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(file + '.part', Buffer.from(await res.arrayBuffer()));
  renameSync(file + '.part', file);
}

function unzip(zip, dir) {
  mkdirSync(dir, { recursive: true });
  run(`"${TAR}" -xf "${zip}" -C "${dir}"`);
}

async function setup() {
  const dl = join(home, 'downloads');
  mkdirSync(dl, { recursive: true });

  if (!existsSync(join(JDK, 'bin', 'java.exe'))) {
    const zip = join(dl, 'jdk17.zip');
    await download('https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk', zip);
    const tmp = join(home, 'jdk-unpack');
    rmSync(tmp, { recursive: true, force: true });
    unzip(zip, tmp);
    renameSync(join(tmp, readdirSync(tmp)[0]), JDK); // the zip holds one jdk-17.x folder
    rmSync(tmp, { recursive: true, force: true });
  }

  const sdkmanager = join(SDK, 'cmdline-tools', 'latest', 'bin', 'sdkmanager.bat');
  if (!existsSync(sdkmanager)) {
    const zip = join(dl, 'cmdline-tools.zip');
    try {
      await download('https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip', zip);
    } catch {
      await download('https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip', zip);
    }
    const tmp = join(SDK, 'cmdline-tools', 'unpack');
    rmSync(tmp, { recursive: true, force: true });
    unzip(zip, tmp);
    renameSync(join(tmp, 'cmdline-tools'), join(SDK, 'cmdline-tools', 'latest'));
    rmSync(tmp, { recursive: true, force: true });
  }
  const missing = SDK_PACKAGES.filter((p) => !existsSync(join(SDK, ...p.split(';'))));
  if (missing.length) {
    run(`"${sdkmanager}" --sdk_root="${SDK}" --licenses`, { input: 'y\n'.repeat(30), stdio: ['pipe', 'inherit', 'inherit'] });
    run(`"${sdkmanager}" --sdk_root="${SDK}" ${missing.map((p) => `"${p}"`).join(' ')}`);
  }

  if (!existsSync(join(GRADLE, 'bin', 'gradle.bat'))) {
    const zip = join(dl, `gradle-${GRADLE_VER}.zip`);
    await download(`https://services.gradle.org/distributions/gradle-${GRADLE_VER}-bin.zip`, zip);
    unzip(zip, home);
  }
  console.log(`Android toolchain ready in ${home}`);
}

// Release signing key. It lives in android/signing (gitignored, but backed up with the Drive folder):
// keep it, or phones need an uninstall (which wipes progress) before they take the next update.
function signingKey() {
  const dir = join(root, 'android', 'signing');
  const props = join(dir, 'signing.properties');
  if (existsSync(props)) return props;
  mkdirSync(dir, { recursive: true });
  const pass = randomBytes(18).toString('base64url');
  const store = join(dir, 'apexrush-release.jks');
  run(`"${join(JDK, 'bin', 'keytool.exe')}" -genkeypair -v -keystore "${store}" -alias apexrush -keyalg RSA -keysize 2048 -validity 10000 -storepass ${pass} -keypass ${pass} -dname "CN=APEX RUSH, O=APEX RUSH, C=DE"`);
  writeFileSync(props, `storeFile=${store.replace(/\\/g, '/')}\nstorePassword=${pass}\nkeyAlias=apexrush\nkeyPassword=${pass}\n`);
  return props;
}

async function build() {
  await setup();
  const props = signingKey();
  const work = join(home, 'build');
  console.log('Staging files...');
  rmSync(join(work, 'app', 'src'), { recursive: true, force: true });
  cpSync(join(root, 'android'), work, { recursive: true, filter: (src) => !src.includes(`${join('android', 'signing')}`) });
  cpSync(join(root, 'game'), join(work, 'app', 'src', 'main', 'assets', 'game'), {
    recursive: true,
    filter: (src) => !/\.nojekyll$|desktop\.ini$/.test(src),
  });
  writeFileSync(join(work, 'local.properties'), `sdk.dir=${SDK.replace(/\\/g, '/')}\nsigning=${props.replace(/\\/g, '/')}\n`);
  const version = JSON.parse(readFileSync(join(root, 'electron', 'package.json'), 'utf8')).version;
  writeFileSync(join(work, 'version.properties'), `versionName=${process.env.APEX_VERSION || version}\nversionCode=${process.env.APEX_VERSION_CODE || Math.floor(Date.now() / 60000) - 29000000}\n`);

  console.log('Running Gradle...');
  run(`"${join(GRADLE, 'bin', 'gradle.bat')}" --no-daemon -q assembleRelease`, { cwd: work });
  const apk = join(work, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  mkdirSync(join(root, 'release'), { recursive: true });
  copyFileSync(apk, join(root, 'release', 'ApexRush.apk'));
  console.log(`\nBuilt release/ApexRush.apk (${(statSync(apk).size / 1048576).toFixed(1)} MB)`);
}

if (process.argv.includes('--setup')) await setup();
else await build();
