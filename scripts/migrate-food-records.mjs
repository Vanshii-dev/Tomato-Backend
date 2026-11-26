import "../config/env.js";
import mongoose from "mongoose";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import FoodModel from "../models/foodModel.js";
import cloudinary from "../config/cloudinary.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const applyChanges = process.argv.includes("--apply");
const maxImageBytes = 20 * 1024 * 1024;

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function isInTargetCloud(imageUrl) {
  try {
    const url = new URL(imageUrl);
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    return url.protocol === "https:" && url.hostname === "res.cloudinary.com" &&
      url.pathname.split("/").filter(Boolean)[0] === cloudName;
  } catch {
    return false;
  }
}

function uploadBuffer(buffer, publicId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "tomato/foods", public_id: publicId, resource_type: "image", overwrite: true, invalidate: true },
      (error, result) => error ? reject(error) : resolve(result)
    );
    stream.end(buffer);
  });
}

async function main() {
  if (!process.env.MONGO_URL) throw new Error("MONGO_URL is missing from Tomato-Backend/.env.");
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    throw new Error("The three new-account Cloudinary variables must be set in Tomato-Backend/.env.");
  }

  await mongoose.connect(process.env.MONGO_URL, { serverSelectionTimeoutMS: 10000, socketTimeoutMS: 45000 });
  try {
    await cloudinary.api.ping();
    const foods = await FoodModel.find({}, "_id name image public_id category").lean();
    const pending = foods.filter(food => food.image && !isInTargetCloud(food.image));

    console.log("Food records found: " + foods.length);
    console.log("Already using target Cloudinary: " + (foods.length - pending.length));
    console.log("Records requiring migration review: " + pending.length);

    if (!applyChanges) {
      for (const food of pending) {
        console.log("Would migrate: " + food._id + " | " + (food.name || "(unnamed)") + " | " + food.image);
      }
      console.log("Dry run only. No database records or Cloudinary files were changed.");
      console.log("Back up MongoDB, review the list, then rerun with --apply.");
      return;
    }

    const backupDirectory = path.join(backendRoot, "scripts/backups");
    await fs.mkdir(backupDirectory, { recursive: true });
    const backupPath = path.join(backupDirectory, "foods-before-cloudinary-" + timestamp() + ".json");
    await fs.writeFile(backupPath, JSON.stringify(foods, null, 2));
    console.log("Food record backup saved to: " + backupPath);

    let migrated = 0;
    let skipped = 0;
    let failed = 0;

    for (const food of pending) {
      try {
        const sourceUrl = food.image;
        const parsedUrl = new URL(sourceUrl);
        if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "res.cloudinary.com") {
          console.log("SKIP " + food._id + ": source is not a public Cloudinary HTTPS URL.");
          skipped++;
          continue;
        }

        const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error("Source image returned HTTP " + response.status);
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.toLowerCase().startsWith("image/")) {
          throw new Error("Source URL did not return an image (" + contentType + ").");
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length || buffer.length > maxImageBytes) {
          throw new Error("Image is empty or exceeds the 20 MB migration limit.");
        }

        const safeId = String(food._id).replace(/[^a-zA-Z0-9_-]/g, "");
        const uploaded = await uploadBuffer(buffer, "food-" + safeId);
        const update = await FoodModel.updateOne(
          { _id: food._id, image: sourceUrl },
          { $set: { image: uploaded.secure_url, public_id: uploaded.public_id } }
        );

        if (update.matchedCount !== 1) {
          await cloudinary.uploader.destroy(uploaded.public_id).catch(() => {});
          throw new Error("Database record changed during migration; uploaded asset was cleaned up.");
        }

        migrated++;
        console.log("MIGRATED " + food._id + " | " + (food.name || "(unnamed)"));
      } catch (error) {
        failed++;
        console.error("FAILED " + food._id + ": " + error.message);
      }
    }

    console.log("Result: " + migrated + " migrated, " + skipped + " skipped, " + failed + " failed.");
    console.log("Old Cloudinary assets were not deleted.");
    if (failed || skipped) {
      console.log("Review the skipped/failed records before retiring the old account.");
      process.exitCode = 2;
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async error => {
  console.error("Food migration failed:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});