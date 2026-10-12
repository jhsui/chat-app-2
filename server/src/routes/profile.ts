import { randomUUID } from "node:crypto";
import express, { Router, type Request, type Response } from "express";
import type {
  ErrorResponse,
  ProfileResponse,
  PublicUser,
} from "../../../shared/types.js";
import { currentUser } from "../auth.js";
import { isValidId, toPublicUser, type Db, type ProfileRow } from "../db.js";
import type { Presence } from "../presence.js";
import {
  detectImageType,
  IMAGE_EXTENSIONS,
  type AvatarStorage,
} from "../storage.js";

const MAX_DISPLAY_NAME = 40;
const MAX_BIO = 160;
/** The browser resizes avatars to 256×256 before upload (~20–40 KB), so this is generous. */
export const MAX_AVATAR_BYTES = 512 * 1024;

type ProfileReply = ProfileResponse | ErrorResponse;

/** Trims text, turns "" into null, and rejects values that are too long. */
function cleanText(
  value: unknown,
  max: number,
  label: string,
  { singleLine }: { singleLine: boolean },
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string")
    return { ok: false, error: `${label} must be text` };
  let text = value.trim();
  if (singleLine) text = text.replace(/\s+/g, " ");
  if (text.length > max) {
    return { ok: false, error: `${label} can be at most ${max} characters` };
  }
  return { ok: true, value: text || null };
}

export function profileRoutes(
  db: Db,
  presence: Presence,
  storage: AvatarStorage | null,
  /** Called whenever a user's public info changes, to tell connected clients. */
  onProfileChanged: (user: PublicUser) => void,
): Router {
  const router = Router();

  const withPresence = (p: ProfileRow) => ({
    ...p,
    online: presence.isOnline(p.id),
  });

  /** Deletes a replaced avatar file. A failure here shouldn't fail the request. */
  async function removeOldAvatar(key: string | null) {
    if (!key || !storage) return;
    try {
      await storage.remove(key);
    } catch (err) {
      console.error("Couldn't delete old avatar", key, err);
    }
  }

  // Anyone's profile: GET /api/users/42
  router.get(
    "/users/:id",
    async (req: Request, res: Response<ProfileReply>) => {
      const id = Number(req.params.id);
      const profile = isValidId(id) ? await db.findUserById(id) : undefined;
      if (!profile) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json({ profile: withPresence(profile) });
    },
  );

  // Edit your display name and bio: PATCH /api/me { displayName, bio }
  router.patch("/me", async (req: Request, res: Response<ProfileReply>) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const displayName = cleanText(
      body.displayName,
      MAX_DISPLAY_NAME,
      "Display name",
      {
        singleLine: true,
      },
    );
    const bio = cleanText(body.bio, MAX_BIO, "Bio", { singleLine: false });
    if (!displayName.ok) {
      res.status(400).json({ error: displayName.error });
      return;
    }
    if (!bio.ok) {
      res.status(400).json({ error: bio.error });
      return;
    }

    const profile = await db.updateProfile(currentUser(req).id, {
      displayName: displayName.value,
      bio: bio.value,
    });
    onProfileChanged(toPublicUser(profile));
    res.json({ profile: withPresence(profile) });
  });

  // Upload a new avatar: PUT /api/me/avatar with the image bytes as the body.
  router.put(
    "/me/avatar",
    express.raw({ type: "image/*", limit: MAX_AVATAR_BYTES }),
    async (req: Request, res: Response<ProfileReply>) => {
      if (!storage) {
        res.status(503).json({
          error:
            "Avatar uploads aren't set up on this server yet (Supabase Storage isn't configured).",
        });
        return;
      }
      const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const type = detectImageType(data);
      if (!type) {
        res
          .status(400)
          .json({ error: "Please upload a PNG, JPEG or WebP image" });
        return;
      }

      const me = currentUser(req);
      // A fresh name every time, so old cached copies of the URL never show the wrong picture.
      const key = `${me.id}/${randomUUID()}.${IMAGE_EXTENSIONS[type]}`;
      let url: string;
      try {
        ({ url } = await storage.save(key, data, type));
      } catch (err) {
        console.error(err);
        res
          .status(502)
          .json({ error: "Couldn't upload the image. Please try again." });
        return;
      }

      const { profile, previousKey } = await db.setAvatar(me.id, { url, key });
      await removeOldAvatar(previousKey);
      onProfileChanged(toPublicUser(profile));
      res.json({ profile: withPresence(profile) });
    },
  );

  // Remove your avatar (go back to the initial): DELETE /api/me/avatar
  router.delete(
    "/me/avatar",
    async (req: Request, res: Response<ProfileReply>) => {
      const { profile, previousKey } = await db.setAvatar(
        currentUser(req).id,
        null,
      );
      await removeOldAvatar(previousKey);
      onProfileChanged(toPublicUser(profile));
      res.json({ profile: withPresence(profile) });
    },
  );

  return router;
}
