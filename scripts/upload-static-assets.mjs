import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cloudinary from "../config/cloudinary.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.resolve(
  process.argv[2] || path.join(backendRoot, "../../Tomato-Frontend")
);
const assetsModulePath = path.join(frontendRoot, "src/assets/assets.js");
const assetsDirectory = path.join(frontendRoot, "src/assets");
const outputPath = path.join(backendRoot, "scripts/cloudinary-assets-map.json");

const requiredEnv = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];
const missingEnv = requiredEnv.filter((key) => !process.env[key]?.trim());

if (missingEnv.length) {
  throw new Error(
    "Missing Cloudinary environment variables in Tomato-Backend/.env: " +
      missingEnv.join(", ")
  );
}

async function main() {
  const source = await fs.readFile(assetsModulePath, "utf8");
  const importPattern = /^import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]\.\/([^'"]+)['"];?\s*$/gm;
  const imports = [...source.matchAll(importPattern)].map((match) => ({
    variable: match[1],
    filename: match[2],
  }));

  if (!imports.length) {
    throw new Error(
      "No local image imports were found in src/assets/assets.js. " +
        "Check whether the file has already been migrated."
    );
  }

  await cloudinary.api.ping();

  const assetMap = {};
  try {
    const previous = JSON.parse(await fs.readFile(outputPath, "utf8"));
    Object.assign(assetMap, previous.assets || {});
  } catch {
    // A first run has no previous manifest.
  }

  console.log("Uploading " + imports.length + " imported frontend assets.");
  console.log("Target Cloudinary folder: tomato/");

  for (const asset of imports) {
    const filePath = path.join(assetsDirectory, asset.filename);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) {
      throw new Error("Asset file is missing: " + filePath);
    }

    const basename = path.parse(asset.filename).name;
    let category = "icons";

    if (/^food_\d+$/i.test(basename)) category = "foods";
    else if (/^menu_\d+$/i.test(basename)) category = "menu";
    else if (/^(logo|header_img)$/i.test(basename)) category = "branding";
    else if (/^(app_store|play_store)$/i.test(basename)) category = "app-download";

    const result = await cloudinary.uploader.upload(filePath, {
      folder: "tomato/" + category,
      public_id: basename,
      resource_type: "image",
      overwrite: true,
      unique_filename: false,
      use_filename: false,
      invalidate: true,
    });

    assetMap[asset.filename] = {
      variable: asset.variable,
      folder: "tomato/" + category,
      public_id: result.public_id,
      secure_url: result.secure_url,
      bytes: stat.size,
    };

    await fs.writeFile(
      outputPath,
      JSON.stringify(
        {
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          generated_at: new Date().toISOString(),
          asset_count: Object.keys(assetMap).length,
          assets: assetMap,
        },
        null,
        2
      )
    );

    console.log("Uploaded: " + asset.filename + " -> " + result.public_id);
  }

  console.log("");
  console.log("Completed. Uploaded " + imports.length + " frontend imports.");
  console.log("Manifest saved to: " + outputPath);
  console.log("No GitHub files or database records were changed by this upload step.");
}

main().catch((error) => {
  console.error("Static asset migration failed:", error.message);
  process.exitCode = 1;
});