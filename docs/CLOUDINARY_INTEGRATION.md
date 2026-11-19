# Cloudinary integration

Implemented in Phase 3. Cloudinary is the permanent store for incident evidence and org media. PostgreSQL stores asset metadata only.

## Upload flow

1. Browser calls `POST /api/v1/media/sign` with purpose, filename, mime type, bytes, and optional `incidentId`.
2. API creates an `UploadGrant`, signs `timestamp`, `folder`, `public_id`, and `type=authenticated`.
3. Browser posts the file to `https://api.cloudinary.com/v1_1/{cloud}/{resourceType}/upload`.
4. Browser calls `POST /api/v1/media/confirm`. The API verifies the resource matches the grant and stores `MediaAsset`.

Folders:

- `fieldops/{organizationId}/incidents/{incidentId}/`
- `fieldops/{organizationId}/users/`
- `fieldops/{organizationId}/teams/`
- `fieldops/{organizationId}/sites/`

Delivery uses signed URLs from `GET /api/v1/media/:id/url`. Expired unused grants are deleted by the hourly `media-cleanup` BullMQ job.

Chat attachments use Nexconn Helper uploads, not Cloudinary. Incident evidence uses the Cloudinary path above.

Confirm stores the Cloudinary `public_id` returned by upload (which may append a format suffix such as `.pdf`) and records the resolved delivery type (`authenticated`, `upload`, or `private`) so signed URLs keep working.

Without Cloudinary credentials, signing returns `503`.
