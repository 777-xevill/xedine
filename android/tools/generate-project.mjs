/**
 * (Re)generates the Android project in android/ from android/twa-manifest.json with Bubblewrap's
 * generator, then applies Xedine's changes (ADR 0065). Run from the repo root:
 *
 *   node android/tools/generate-project.mjs            # icons from https://xedine.org
 *   node android/tools/generate-project.mjs --local    # icons from public/ (before they are deployed)
 *
 * Needs @bubblewrap/core 1.27 installed outside the repo (it is a tool, not an app dependency):
 *   npm install @bubblewrap/core@1.27.0 --prefix E:\android-tools\bubblewrap
 * or set BUBBLEWRAP_CORE to its folder. It overwrites the generated files, so change the app by
 * changing twa-manifest.json or this script, never by hand-editing the generated files.
 */
import { createReadStream, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ANDROID = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(ANDROID, '..');
const SITE = 'https://xedine.org';
const CORE =
  process.env.BUBBLEWRAP_CORE ?? 'E:/android-tools/bubblewrap/node_modules/@bubblewrap/core';
if (!existsSync(join(CORE, 'package.json'))) {
  throw new Error(
    `@bubblewrap/core not found at ${CORE} (see the comment at the top of this file)`,
  );
}
const { TwaGenerator, TwaManifest, ConsoleLog } = createRequire(join(CORE, 'package.json'))(CORE);

const local = process.argv.includes('--local');
const json = JSON.parse(readFileSync(join(ANDROID, 'twa-manifest.json'), 'utf8'));

// --local: serve public/ so the generator can fetch icons that are not deployed yet.
let server;
let base = SITE;
if (local) {
  const TYPES = { '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = join(ROOT, 'public', path);
    if (!file.startsWith(join(ROOT, 'public')) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
}
const at = (url) => (url ? url.replace(SITE, base) : url);

try {
  const manifest = new TwaManifest({
    ...json,
    iconUrl: at(json.iconUrl),
    maskableIconUrl: at(json.maskableIconUrl),
    monochromeIconUrl: at(json.monochromeIconUrl),
    webManifestUrl: at(json.webManifestUrl),
    shortcuts: json.shortcuts.map((s) => ({
      ...s,
      chosenIconUrl: at(s.chosenIconUrl),
      chosenMaskableIconUrl: at(s.chosenMaskableIconUrl),
    })),
  });
  const generator = new TwaGenerator();
  await generator.createTwaProject(ANDROID, manifest, new ConsoleLog('generate'));

  // Android 13+ themed icon: the chef's silhouette, at the maskable icon's sizes.
  await generator.generateIcons(
    at(json.monochromeIconUrl),
    ANDROID,
    [
      ['mdpi', 82],
      ['hdpi', 123],
      ['xhdpi', 164],
      ['xxhdpi', 246],
      ['xxxhdpi', 328],
    ].map(([d, size]) => ({ dest: `app/src/main/res/mipmap-${d}/ic_monochrome.png`, size })),
  );
} finally {
  // The generator's HTTP client keeps connections alive; drop them so the script can exit.
  server?.closeAllConnections();
  server?.close();
}

/** Replaces `from` with `to` in a generated file, failing loudly if the template changed. */
function patch(file, from, to, count = 1) {
  const path = join(ANDROID, file);
  const text = readFileSync(path, 'utf8');
  const found = text.split(from).length - 1;
  if (found !== count)
    throw new Error(`${file}: expected ${count} x ${JSON.stringify(from)}, found ${found}`);
  writeFileSync(path, text.split(from).join(to));
}

// 1. Repositories: jcenter is retired, mavenCentral replaces it. (The founder's PC blocks
//    dl.google.com, where google() lives, in its hosts file; a Gradle init script on that PC points
//    google() at the dl-ssl.google.com mirror instead, see android/README.md. The repo stays standard.)
patch(
  'build.gradle',
  '        google()\n        jcenter()\n',
  '        google()\n        mavenCentral()\n',
  2,
);

// 2. Signing. The upload key stays outside the repo (E:\Xedine-Android-Keys, ADR 0065); without it the
//    release build is left unsigned and Gradle says so.
patch(
  'app/build.gradle',
  '    buildTypes {\n        release {\n            minifyEnabled true\n        }\n    }',
  `    // The upload key lives outside the repo (ADR 0065). XEDINE_KEYSTORE_PROPERTIES may point elsewhere.
    def keystoreProps = new Properties()
    def keystorePropsFile = file(System.getenv('XEDINE_KEYSTORE_PROPERTIES') ?: '../../../Xedine-Android-Keys/keystore.properties')
    if (keystorePropsFile.exists()) {
        keystorePropsFile.withInputStream { keystoreProps.load(it) }
    } else {
        logger.warn("No upload key at \${keystorePropsFile}: the release build will be unsigned.")
    }
    signingConfigs {
        release {
            if (keystorePropsFile.exists()) {
                storeFile file(keystoreProps['storeFile'])
                storePassword keystoreProps['storePassword']
                keyAlias keystoreProps['keyAlias']
                keyPassword keystoreProps['keyPassword']
            }
        }
    }
    buildTypes {
        release {
            minifyEnabled true
            if (keystorePropsFile.exists()) {
                signingConfig signingConfigs.release
            }
        }
    }`,
);

// 2b. AGP 8 takes the package from `namespace` in build.gradle and warns about the old attribute.
patch('app/src/main/AndroidManifest.xml', `\n    package="${json.packageId}">`, '>');

// 3. The web manifest URL is the live one even when the icons came from --local.
if (local) {
  const appGradle = readFileSync(join(ANDROID, 'app/build.gradle'), 'utf8');
  writeFileSync(join(ANDROID, 'app/build.gradle'), appGradle.split(base).join(SITE));
}

// 4. Adaptive icon: the chef tile's own paper colour behind the maskable icon (Bubblewrap uses white),
//    and the themed (monochrome) layer for Android 13+.
patch(
  'app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
  '<item android:drawable="@android:color/white" />',
  '<item android:drawable="@color/iconPaper" />',
);
patch(
  'app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
  '    <foreground android:drawable="@android:color/transparent" />',
  `    <foreground android:drawable="@android:color/transparent" />
    <monochrome>
        <inset android:drawable="@mipmap/ic_monochrome" android:inset="8.5dp" />
    </monochrome>`,
);
patch(
  'app/src/main/res/values/colors.xml',
  '<color name="shortcut_background">#F5F5F5</color>',
  `<color name="shortcut_background">#F5F5F5</color>
    <!-- The chef tile's paper, behind the adaptive icon (ADR 0065). -->
    <color name="iconPaper">#EEEEEE</color>`,
);

// Bubblewrap's own Play icon: Xedine's is docs/play-store/graphics/icon-512.png (android/make-icons.py).
rmSync(join(ANDROID, 'store_icon.png'), { force: true });

console.log(`Android project generated in ${ANDROID}${local ? ' (icons from public/)' : ''}`);
// The generator's fetch client can keep the event loop alive after the work is done.
process.exit(0);
