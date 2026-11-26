# Tomato Cloudinary migration

This branch adds a cautious migration workflow for moving Tomato's images to a new Cloudinary account. It does not delete anything from the old Cloudinary account.

## Included scripts

- `scripts/upload-static-assets.mjs`: uploads all local image imports found in the frontend's `src/assets/assets.js`.
- `scripts/apply-static-asset-urls.mjs`: replaces local imports with Cloudinary HTTPS URLs, changes the header component to use the hosted header image, and changes new food uploads to `tomato/foods`.
- `scripts/migrate-food-records.mjs`: backs up MongoDB food records and re-uploads existing public Cloudinary food images, updating `image` and `public_id`.

Static folders: `tomato/foods`, `tomato/menu`, `tomato/branding`, `tomato/icons`, and `tomato/app-download`.

## Before running

1. Clone `Tomato-Backend` and `Tomato-Frontend` into sibling directories.
2. Make a separate MongoDB Atlas backup/export.
3. Add the new account's `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` to `Tomato-Backend/.env`, along with the existing `MONGO_URL`.
4. Keep credentials in backend environment variables only. Never put the API secret in frontend code or commit `.env`.

The scripts use the existing backend `config/env.js` loader and do not print secret values.

## Run from Tomato-Backend

Upload the frontend's imported image assets:

```bash
node scripts/upload-static-assets.mjs ../Tomato-Frontend
```

This creates `scripts/cloudinary-assets-map.json`.

Apply the hosted URLs to the frontend and backend upload folder:

```bash
node scripts/apply-static-asset-urls.mjs ../Tomato-Frontend
```

The script creates timestamped backups under `scripts/backups/`. It updates `assets.js`, `Header.jsx`, `Header.css`, and `controllers/foodController.js`. The duplicate `public/header_img.png` remains in place as a precaution.

Preview the database migration. This is a dry run and makes no changes:

```bash
node scripts/migrate-food-records.mjs
```

Review the output and make a separate MongoDB backup. Then apply the database migration:

```bash
node scripts/migrate-food-records.mjs --apply
```

The database script creates a JSON backup of the food records before updating them. It only fetches source images from public HTTPS Cloudinary URLs. Other URL types are skipped and reported for manual review. New files are uploaded under `tomato/foods`. Old assets are never deleted.

## Cutover and verification

Pause food add/delete actions in the admin panel during the migration and deployment cutover.

1. Run `npm run build` in Tomato-Frontend.
2. Test the home hero, menu categories, all 32 fallback foods, navbar, footer, cart and order pages.
3. Replace the three Cloudinary environment variables in Render with the new account's values. Keep `MONGO_URL` unchanged, then redeploy the backend.
4. Deploy the updated frontend to Vercel. No Cloudinary secret or `VITE_` Cloudinary variable is needed.
5. Test food listing, admin add-food, admin remove-food, cart and order flows.
6. Confirm static and database food images load from the new Cloudinary cloud.

Do not delete the old Cloudinary account or its assets until every production image and add/delete flow has been verified.

## Scope notes

- The frontend source imports 59 app images. `public/header_img.png` is a duplicate of the imported header image and is not uploaded separately.
- `public/vite.svg` is Vite's starter icon and is not used by the Tomato app asset module.
- The scripts do not commit generated manifests, backups, or secrets.
