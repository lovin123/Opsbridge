"use client";

import { useRef, useState } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { ApiError, api } from "@/lib/api";
import { Button, ErrorCallout, SuccessCallout } from "@/components/ui";

interface SignResponse {
  grantId: string;
  signature: string;
  timestamp: number;
  folder: string;
  publicId: string;
  apiKey: string;
  cloudName: string;
  type: string;
  mimeType: string;
}

export function MediaUpload({
  orgId,
  incidentId,
  purpose = "INCIDENT_PHOTO",
  onUploaded,
}: {
  orgId: string;
  incidentId?: string;
  purpose?: "INCIDENT_PHOTO" | "EQUIPMENT" | "RESOLUTION_EVIDENCE" | "DOCUMENT";
  onUploaded?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function uploadFile(file: File) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const signed = await api<SignResponse>("/media/sign", {
        method: "POST",
        orgId,
        body: {
          purpose,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          bytes: file.size,
          incidentId,
        },
      });
      const resourceType = file.type.startsWith("video/")
        ? "video"
        : file.type === "application/pdf" || file.type.includes("word")
          ? "raw"
          : "image";
      const form = new FormData();
      form.append("file", file);
      form.append("api_key", signed.apiKey);
      form.append("timestamp", String(signed.timestamp));
      form.append("signature", signed.signature);
      form.append("folder", signed.folder);
      form.append("public_id", signed.publicId);
      form.append("type", signed.type);
      const upload = await fetch(
        `https://api.cloudinary.com/v1_1/${signed.cloudName}/${resourceType}/upload`,
        { method: "POST", body: form },
      );
      const payload = (await upload.json()) as {
        public_id?: string;
        asset_id?: string;
        bytes?: number;
        format?: string;
        width?: number;
        height?: number;
        duration?: number;
        error?: { message?: string };
      };
      if (!upload.ok || !payload.public_id) {
        throw new Error(payload.error?.message ?? "Cloudinary upload failed");
      }
      await api("/media/confirm", {
        method: "POST",
        orgId,
        body: {
          grantId: signed.grantId,
          publicId: payload.public_id,
          assetId: payload.asset_id,
          filename: file.name,
          resourceType,
          mimeType: file.type || signed.mimeType,
          bytes: payload.bytes ?? file.size,
          format: payload.format,
          width: payload.width,
          height: payload.height,
          duration: payload.duration,
        },
      });
      setMessage("Uploaded.");
      onUploaded?.();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "Upload failed",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Flex direction="column" gap="2">
      <Flex align="center" gap="2" wrap="wrap">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          loading={busy}
          onClick={() => inputRef.current?.click()}
        >
          Upload file
        </Button>
        <input
          ref={inputRef}
          type="file"
          hidden
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,application/pdf"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) {
              void uploadFile(file);
            }
          }}
        />
        <Text size="1" color="gray">
          Images, MP4, or PDF
        </Text>
      </Flex>
      {message ? <SuccessCallout>{message}</SuccessCallout> : null}
      {error ? <ErrorCallout>{error}</ErrorCallout> : null}
    </Flex>
  );
}
