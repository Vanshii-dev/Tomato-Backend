import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.resolve(process.argv[2] || path.join(backendRoot, "../../Tomato-Frontend"));
const manifestPath = path.join(backendRoot, "scripts/cloudinary-assets-map.json");

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function backupFile(sourcePath, backupDirectory) {
  await fs.mkdir(backupDirectory, { recursive: true });
  await fs.copyFile(sourcePath, path.join(backupDirectory, path.basename(sourcePath)));
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const assets = manifest.assets || {};
  const assetsModulePath = path.join(frontendRoot, "src/assets/assets.js");
  const headerJsPath = path.join(frontendRoot, "src/components/Header/Header.jsx");
  const headerCssPath = path.join(frontendRoot, "src/components/Header/Header.css");
  const controllerPath = path.join(backendRoot, "controllers/foodController.js");

  let assetsSource = await fs.readFile(assetsModulePath, "utf8");
  let headerJs = await fs.readFile(headerJsPath, "utf8");
  let headerCss = await fs.readFile(headerCssPath, "utf8");
  let controller = await fs.readFile(controllerPath, "utf8");

  const importPattern = /^import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]\.\/([^'"]+)['"];?\s*$/gm;
  const imports = [...assetsSource.matchAll(importPattern)];

  if (!imports.length) {
    throw new Error("assets.js contains no local image imports. Check whether it is already migrated.");
  }
  for (const match of imports) {
    if (!assets[match[2]]?.secure_url) {
      throw new Error("Upload manifest has no secure_url for " + match[2]);
    }
  }

  const migratedAssets = assetsSource.replace(
    importPattern,
    (_line, variable, filename) => "const " + variable + " = " + JSON.stringify(assets[filename].secure_url) + ";"
  );

  if (!headerJs.includes("import { assets } from '../../assets/assets'")) {
    const cssImport = "import './Header.css'";
    if (!headerJs.includes(cssImport)) throw new Error("Could not find Header.css import.");
    headerJs = headerJs.replace(cssImport, cssImport + "\nimport { assets } from '../../assets/assets'");
  }

  if (!headerJs.includes("backgroundImage: 'url(' + assets.header_img + ')'")) {
    const headerTag = /<div\s+className=['"]header['"]\s*>/;
    if (!headerTag.test(headerJs)) throw new Error("Could not locate header root element.");
    headerJs = headerJs.replace(
      headerTag,
      "<div className='header' style={{ backgroundImage: 'url(' + assets.header_img + ')' }}>"
    );
  }

  const headerRule = /background:\s*url\(['"]?\/header_img\.png['"]?\)\s*no-repeat\s*;/;
  if (headerRule.test(headerCss)) {
    headerCss = headerCss.replace(headerRule, "background-repeat: no-repeat;");
  } else if (!headerCss.includes("background-repeat: no-repeat;")) {
    throw new Error("Could not identify existing header image CSS rule.");
  }

  const oldFolder = /folder:\s*["']food-delivery["']/;
  if (oldFolder.test(controller)) {
    controller = controller.replace(oldFolder, 'folder: "tomato/foods"');
  } else if (!/folder:\s*["']tomato\/foods["']/.test(controller)) {
    throw new Error("Could not identify Cloudinary upload folder in foodController.js.");
  }

  const backupDirectory = path.join(backendRoot, "scripts/backups", "pre-cloudinary-url-patch-" + timestamp());
  await Promise.all([
    backupFile(assetsModulePath, backupDirectory),
    backupFile(headerJsPath, backupDirectory),
    backupFile(headerCssPath, backupDirectory),
    backupFile(controllerPath, backupDirectory),
  ]);

  await Promise.all([
    fs.writeFile(assetsModulePath, migratedAssets),
    fs.writeFile(headerJsPath, headerJs),
    fs.writeFile(headerCssPath, headerCss),
    fs.writeFile(controllerPath, controller),
  ]);

  console.log("Updated " + imports.length + " frontend image imports to Cloudinary URLs.");
  console.log("Updated header background and new-food upload folder.");
  console.log("Backups saved to " + backupDirectory);
  console.log("public/header_img.png is intentionally left in place as a precaution.");
}

main().catch((error) => {
  console.error("Applying Cloudinary URLs failed:", error.message);
  process.exitCode = 1;
});